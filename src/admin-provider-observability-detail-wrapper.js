import app from "./admin-provider-observability-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisDate(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
const DISPLAY={OAG_SCHEDULE:"OAG",OAG_STATUS:"OAG",AIRLABS:"AIRLABS",SKYLINK:"SKYLINK",OPENSKY:"OPENSKY",AERODATABOX:"AERODATABOX"};
const PROVIDER_RAW={OAG:["OAG_SCHEDULE","OAG_STATUS"],AIRLABS:["AIRLABS"],SKYLINK:["SKYLINK"],OPENSKY:["OPENSKY"],AERODATABOX:["AERODATABOX"],QUARK:["QUARK"],AVIATIONDATA:["AVIATIONDATA"],FLIGHTERA:["FLIGHTERA"],FLIGHTRADAR1:["FLIGHTRADAR1"],FLIGHTRADAR8:["FLIGHTRADAR8"],FR24DEP:["FR24DEP"]};
function parseFields(v){try{const a=JSON.parse(v||"[]");return Array.isArray(a)?a:[]}catch{return []}}
function reason(provider,fields,d,x={}){
  const f=fields.map(upper);
  if(provider==="OAG")return f.some(v=>v==="STD"||v==="STA")?"Horaire planifié à compléter via source primaire OAG":"Donnée opérationnelle prioritaire encore manquante";
  if(provider==="AIRLABS")return "Batch CDG autorisé par la policy pour compléter uniquement les champs manquants";
  if(provider==="SKYLINK")return "Fallback 1 autorisé après source primaire déjà tentée ou vol proche du départ";
  if(provider==="OPENSKY")return f.includes("ATD")?"Confirmation ADS-B de départ recherchée":"ICAO24 / présence ADS-B utile pour retrouver l’immatriculation";
  if(provider==="AERODATABOX")return d<=0?"Dernier recours opérationnel après tentative préalable d’un provider moins coûteux":"Dernier recours après au moins deux providers moins coûteux déjà tentés";
  return "Éligible selon la policy provider";
}
async function details(env,provider){
  const date=parisDate(),name=upper(provider),raw=PROVIDER_RAW[name]||[];
  if(!raw.length)return {ok:false,date,provider:name,error:"PROVIDER_INVALIDE",items:[]};
  const marks=raw.map(()=>"?").join(",");
  try{
    const {results=[]}=await env.OPS_DB.prepare(`SELECT q.flight_identity,q.provider,q.fields_json,q.delta_minutes,q.evaluated_at,f.airline,f.flight_number,f.std,f.data_json FROM provider_enrichment_queue q LEFT JOIN flights f ON f.identity=q.flight_identity WHERE q.flight_date=? AND q.provider IN (${marks}) ORDER BY q.delta_minutes ASC,q.flight_identity`).bind(date,...raw).all();
    const items=results.map(r=>{let x={};try{x=JSON.parse(r.data_json||"{}")}catch{}const fields=parseFields(r.fields_json),flight=clean(x.flight)||`${clean(r.airline)}${clean(r.flight_number)}`;return {identity:r.flight_identity,provider:DISPLAY[r.provider]||r.provider,providerRaw:r.provider,flight,destination:clean(x.destination||x.dest),origin:clean(x.origin||x.dep||"CDG"),std:clean(x.std||r.std),fields,deltaMinutes:Number(r.delta_minutes),reason:reason(name,fields,Number(r.delta_minutes),x),evaluatedAt:clean(r.evaluated_at)};});
    return {ok:true,date,provider:name,count:items.length,items};
  }catch(e){return {ok:false,date,provider:name,error:String(e?.message||e),items:[]}}
}

const UI=String.raw`<style id="alyzia-provider-observability-detail-css">
#app #providerObservability tbody tr{cursor:pointer;transition:background .15s ease}#app #providerObservability tbody tr:hover{background:#f7fbff}
.provider-detail-backdrop{position:fixed;inset:0;background:rgba(8,25,43,.42);z-index:99998;display:flex;align-items:center;justify-content:center;padding:18px}
.provider-detail-modal{width:min(880px,96vw);max-height:86vh;overflow:auto;background:#fff;border-radius:20px;box-shadow:0 24px 80px rgba(8,25,43,.28);padding:18px;color:#19344d;font-family:inherit}
.provider-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.provider-detail-title{font-size:16px;font-weight:950}.provider-detail-sub{font-size:10px;color:#74889c;font-weight:850;margin-top:3px}.provider-detail-close{border:0;background:#edf3f8;border-radius:10px;width:34px;height:34px;font-size:20px;cursor:pointer;color:#36546d}
.provider-detail-list{display:flex;flex-direction:column;gap:8px}.provider-detail-item{border:1px solid #e4edf5;border-radius:14px;padding:11px 12px;background:#fbfdff}.provider-detail-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.provider-detail-flight{font-size:13px;font-weight:950;color:#0a65aa}.provider-detail-route{font-size:10px;font-weight:850;color:#6f8295}.provider-detail-fields{margin-top:7px;font-size:10px;font-weight:900;color:#294760}.provider-detail-fields b{display:inline-block;background:#eaf4fd;color:#0d659f;padding:3px 6px;border-radius:7px;margin:2px}.provider-detail-reason{margin-top:7px;font-size:10px;line-height:1.45;color:#5e7388;font-weight:800}.provider-detail-empty{padding:24px;text-align:center;color:#7b8da0;font-weight:850}
</style><script id="alyzia-provider-observability-detail-js">(()=>{'use strict';if(window.__alyziaProviderDetail)return;window.__alyziaProviderDetail=true;
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
function close(){document.querySelector('.provider-detail-backdrop')?.remove()}
function itemHtml(x){const fs=(x.fields||[]).map(f=>'<b>'+esc(String(f).toUpperCase())+'</b>').join('');const d=Number(x.deltaMinutes);const timing=Number.isFinite(d)?(d>=0?'T-'+d+' min':'T+'+Math.abs(d)+' min'):'—';return '<div class="provider-detail-item"><div class="provider-detail-top"><div><div class="provider-detail-flight">'+esc(x.flight||x.identity)+'</div><div class="provider-detail-route">'+esc((x.origin||'CDG')+' → '+(x.destination||'—')+' · STD '+(x.std||'—'))+'</div></div><div class="provider-detail-route">'+esc(timing)+'</div></div><div class="provider-detail-fields">CHAMPS : '+(fs||'—')+'</div><div class="provider-detail-reason">'+esc(x.reason||'')+'</div></div>'}
async function open(provider){close();const back=document.createElement('div');back.className='provider-detail-backdrop';back.innerHTML='<div class="provider-detail-modal"><div class="provider-detail-head"><div><div class="provider-detail-title">'+esc(provider)+'</div><div class="provider-detail-sub">Chargement des vols autorisés par la queue…</div></div><button class="provider-detail-close" aria-label="Fermer">×</button></div><div class="provider-detail-list"><div class="provider-detail-empty">Chargement…</div></div></div>';document.body.appendChild(back);back.addEventListener('click',e=>{if(e.target===back||e.target.closest('.provider-detail-close'))close()});
try{const r=await fetch('/api/admin/provider-observability/detail?provider='+encodeURIComponent(provider),{cache:'no-store'}),d=await r.json();const list=back.querySelector('.provider-detail-list'),sub=back.querySelector('.provider-detail-sub');if(!d?.ok){list.innerHTML='<div class="provider-detail-empty">Détail indisponible</div>';return}sub.textContent=d.count+' vol(s) en attente · '+d.date;list.innerHTML=d.items?.length?d.items.map(itemHtml).join(''):'<div class="provider-detail-empty">Aucun vol actuellement autorisé pour ce fournisseur.</div>'}catch{back.querySelector('.provider-detail-list').innerHTML='<div class="provider-detail-empty">Erreur de chargement</div>'}}
document.addEventListener('click',e=>{const tr=e.target?.closest?.('#providerObservability tbody tr');if(!tr)return;const provider=String(tr.querySelector('.prov')?.textContent||'').trim().toUpperCase();if(provider)open(provider)},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
})();</script>`;
function patch(html){let s=String(html||"");if(s.includes('id="alyzia-provider-observability-detail-js"'))return s;const i=s.lastIndexOf("</body>");return i>=0?s.slice(0,i)+UI+"\n"+s.slice(i):s+UI}

export default {
  async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==="/api/admin/provider-observability/detail")return new Response(JSON.stringify(await details(env,url.searchParams.get("provider")||"")),{headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});const response=await app.fetch(request,env,ctx),type=String(response.headers.get("content-type")||"").toLowerCase();if(!type.includes("text/html"))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete("content-length");headers.set("cache-control","no-store");return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},
  scheduled(controller,env,ctx){if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx)}
};
