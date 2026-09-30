import app from "./ui-stability-wrapper.js";
import {handleWeather} from "./weather.js";
import {guardApi} from "./api-guard.js";
import providerPolicyScheduler,{refreshProviderQueue} from "./provider-policy-scheduler.js";
import {runFr24DepQueue} from "./fr24dep-queue-runner.js";
import {runFlighteraQueue} from "./flightera-queue-runner.js";
import {runFlightradar1Queue,runFlightradar8Queue} from "./flightradar1-queue-runner.js";
import {handleOpenSkyIngest} from "./opensky-live-wrapper.js";

const FIRST_PAINT=String.raw`<style id="alyzia-first-paint-guard-css">html:not(.alyzia-ui-stability-ready) #app{visibility:hidden!important}</style>`;

function patch(html){
  const s=String(html||'');
  if(s.includes('id="alyzia-first-paint-guard-css"'))return s;
  const h=s.indexOf('<head>');
  return h>=0?s.slice(0,h+6)+FIRST_PAINT+s.slice(h+6):FIRST_PAINT+s;
}

const jsonResp=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});
// Bouton PUSH de l'ADMIN : lance tout de suite le même enchaînement que le cron (file d'attente + fournisseurs),
// sans attendre le prochain passage et en ignorant les cadences (jamais les plafonds jour / mois). 1 push / 60 s.
async function adminPushNow(request,env,ctx){
  if(request.method!=="POST")return jsonResp({ok:false,error:"METHOD"},405);
  const day=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris"}).format(new Date());
  try{
    await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
    const last=await env.OPS_DB.prepare(`SELECT last_at FROM api_provider_usage WHERE provider='ADMIN_PUSH' AND period='last'`).first();
    const wait=60000-(Date.now()-(Date.parse(last?.last_at||"")||0));
    if(wait>0)return jsonResp({ok:false,error:"TROP_RAPIDE",retryInSeconds:Math.ceil(wait/1000)},429);
    await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('ADMIN_PUSH','last',1,1,0,200,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,last_at=excluded.last_at`).bind(new Date().toISOString()).run();
  }catch(_){}
  const snapshot=async()=>{try{const {results=[]}=await env.OPS_DB.prepare(`SELECT provider,calls FROM api_provider_usage WHERE period=?`).bind(day).all();const m={};for(const r of results){const k=String(r.provider||"").toUpperCase().replace(/_.*/,"");m[k]=(m[k]||0)+Number(r.calls||0)}return m}catch{return {}}};
  const before=await snapshot(),t0=Date.now();
  globalThis.__ALYZIA_MANUAL_PUSH=true;
  // On n'exécute PAS tout le cron (trop long pour une requête HTTP : il ne répondait pas) mais l'essentiel : mise à jour de la file
  // puis les fournisseurs qui rattrapent ATD/ATA/ETD/ETA/STA/porte/immat., dans l'ordre d'efficacité, avec un budget de 25 s.
  const steps=[["QUEUE",refreshProviderQueue],["FR24DEP",runFr24DepQueue],["FLIGHTERA",runFlighteraQueue],["FLIGHTRADAR8",runFlightradar8Queue],["FLIGHTRADAR1",runFlightradar1Queue]];
  const results={},started=Date.now();
  const work=(async()=>{for(const [name,fn] of steps){if(Date.now()-started>22000){results[name]="ignoré (temps)";continue}try{const r=await fn(env);results[name]=r?.skipped||"ok"}catch(e){results[name]="erreur: "+String(e?.message||e).slice(0,80)}}})();
  const timedOut=await Promise.race([work.then(()=>false),new Promise(r=>setTimeout(()=>r(true),26000))]);
  if(timedOut){ctx?.waitUntil?.(work.finally(()=>{globalThis.__ALYZIA_MANUAL_PUSH=false}))}
  else globalThis.__ALYZIA_MANUAL_PUSH=false;
  const after=await snapshot(),calls={};
  for(const k of Object.keys(after)){const d=after[k]-(before[k]||0);if(d>0&&k!=="ADMIN")calls[k]=d}
  return jsonResp({ok:true,durationMs:Date.now()-t0,calls,steps:results,partial:timedOut});
}

export default {
  async fetch(request,env,ctx){
    const denied=guardApi(request,env);
    if(denied)return denied;
    // Page finale fabriquée au déploiement (scripts/bake-html.mjs) : servie telle quelle, sans repasser par les wrappers.
    // "no-cache" = revalidation à chaque ouverture (ETag) : jamais une ancienne version, mais 304 sans téléchargement si rien n'a changé.
    let bakeFallback="";
    if(!globalThis.__ALYZIA_BAKING&&(request.method==="GET"||request.method==="HEAD")){
      const path=new URL(request.url).pathname;
      if(path==="/"||path==="/index.html"){
        try{
          // ETag = empreinte écrite à la fabrication (public/baked-version, quelques octets) : si le navigateur a déjà cette version,
          // on répond 304 sans même lire la page de 5 Mo.
          let etag="",lastMod="";
          try{
            const v=await env.ASSETS.fetch(new Request(new URL("/baked-version",request.url)));
            if(v.status===200){
              const m=String(await v.text()).trim().match(/^([0-9a-f]{8,64})(?: (\d{9,11}))?$/);
              if(m){etag=`"b-${m[1]}"`;if(m[2])lastMod=new Date(Number(m[2])*1000).toUTCString()}
              else bakeFallback+="version-invalide;";
            }else bakeFallback+=`version-${v.status};`;
          }catch(e){bakeFallback+="version-erreur:"+String(e?.message||e).slice(0,60)+";"}
          // Revalidation : If-None-Match (ETag) ou, si Cloudflare retire l'ETag, If-Modified-Since (date de fabrication).
          const inm=String(request.headers.get("if-none-match")||"").split(",").map(x=>x.trim().replace(/^W\//,""));
          const ims=Date.parse(request.headers.get("if-modified-since")||"");
          const base={"cache-control":"no-cache","x-alyzia-page":"baked",...(etag?{etag}:{}),...(lastMod?{"last-modified":lastMod}:{})};
          if((etag&&inm.includes(etag))||(lastMod&&Number.isFinite(ims)&&ims>=Date.parse(lastMod)&&!request.headers.get("if-none-match")))return new Response(null,{status:304,headers:base});
          const r=await env.ASSETS.fetch(new Request(new URL("/baked-index",request.url),{method:request.method}));
          if(r.status===200){
            const h=new Headers(base);h.set("content-type","text/html; charset=UTF-8");
            return new Response(r.body,{status:200,headers:h});
          }
          bakeFallback+=`page-${r.status};`;
        }catch(e){bakeFallback+="page-erreur:"+String(e?.message||e).slice(0,60)+";"}
      }
    }
    if(new URL(request.url).pathname==="/api/opensky/ingest")return handleOpenSkyIngest(request,env);
    if(new URL(request.url).pathname==="/api/weather")return handleWeather(request,ctx);
    if(new URL(request.url).pathname==="/api/admin/push-now")return adminPushNow(request,env,ctx);
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text();
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');
    if(bakeFallback)headers.set('x-alyzia-bake-fallback',bakeFallback);
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof providerPolicyScheduler.scheduled==='function')return providerPolicyScheduler.scheduled(controller,env,ctx);
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
