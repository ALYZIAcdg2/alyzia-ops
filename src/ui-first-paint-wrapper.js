import app from "./ui-stability-wrapper.js";
import providerPolicyScheduler from "./provider-policy-scheduler.js";
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
  try{await Promise.resolve(providerPolicyScheduler.scheduled({cron:"manual",scheduledTime:Date.now()},env,{waitUntil:p=>{ctx?.waitUntil?.(p);globalThis.__ALYZIA_PUSH_PENDING=p}}));if(globalThis.__ALYZIA_PUSH_PENDING)await globalThis.__ALYZIA_PUSH_PENDING}
  catch(e){return jsonResp({ok:false,error:String(e?.message||e)},500)}
  finally{globalThis.__ALYZIA_MANUAL_PUSH=false;globalThis.__ALYZIA_PUSH_PENDING=null}
  const after=await snapshot(),calls={};
  for(const k of Object.keys(after)){const d=after[k]-(before[k]||0);if(d>0&&k!=="ADMIN")calls[k]=d}
  return jsonResp({ok:true,durationMs:Date.now()-t0,calls});
}

export default {
  async fetch(request,env,ctx){
    if(new URL(request.url).pathname==="/api/opensky/ingest")return handleOpenSkyIngest(request,env);
    if(new URL(request.url).pathname==="/api/admin/push-now")return adminPushNow(request,env,ctx);
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text();
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof providerPolicyScheduler.scheduled==='function')return providerPolicyScheduler.scheduled(controller,env,ctx);
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
