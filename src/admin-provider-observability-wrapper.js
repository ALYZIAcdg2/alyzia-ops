import {readProviderErrors} from "./provider-errors.js";
import {readProviderStates} from "./provider-state.js";
import app from "./home-filter-ui-stability-wrapper.js";

const clean=v=>String(v??"").trim();
function parisDate(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
const DISPLAY={OAG_SCHEDULE:"OAG",OAG_STATUS:"OAG",AIRLABS:"AIRLABS",SKYLINK:"SKYLINK",OPENSKY:"OPENSKY",QUARK:"QUARK",AVIATIONDATA:"AVIATIONDATA",FLIGHTERA:"FLIGHTERA",KAYAK:"KAYAK",SERPAPI:"SERPAPI",FR24API:"FR24API",CDGBOARD:"CDGBOARD",FLIGHTRADAR1:"FLIGHTRADAR1",FLIGHTRADAR8:"FLIGHTRADAR8",FR24DEP:"FR24DEP",AERODATABOX:"AERODATABOX"};
const ORDER=["OAG","AIRLABS","SKYLINK","OPENSKY","QUARK","AVIATIONDATA","FLIGHTERA","KAYAK","SERPAPI","FR24API","CDGBOARD","FLIGHTRADAR1","FLIGHTRADAR8","FR24DEP","AERODATABOX"];
const FALLBACK={OAG:"PRIMAIRE",AIRLABS:"BATCH / PRIMAIRE",SKYLINK:"FALLBACK 1",OPENSKY:"ADS-B",QUARK:"FALLBACK 2",AVIATIONDATA:"DERNIER RECOURS ATD/ATA",FLIGHTERA:"RATTRAPAGE ATD/ATA",KAYAK:"RATTRAPAGE ATD/ATA",SERPAPI:"ETD / ATD / ETA (GOOGLE)",FR24API:"ETA / IMMAT / TYPE (FR24 OFFICIEL)",CDGBOARD:"TABLEAU DÉPARTS CDG (KAYAK)",FLIGHTRADAR1:"IMMAT / APPAREIL EN VOL",FLIGHTRADAR8:"IMMAT / APPAREIL EN VOL",FR24DEP:"RATTRAPAGE GROUPÉ",AERODATABOX:"DERNIER RECOURS"};

async function observability(env){
  const date=parisDate();
  try{
    const [{results:snap=[]},{results:queue=[]},{results:usage=[]}]=await Promise.all([
      env.OPS_DB.prepare(`SELECT provider,potential,waiting,avoided,stop_all,evaluated_at FROM provider_observability_snapshot WHERE flight_date=?`).bind(date).all(),
      env.OPS_DB.prepare(`SELECT flight_identity,provider,fields_json,evaluated_at FROM provider_enrichment_queue WHERE flight_date=?`).bind(date).all(),
      env.OPS_DB.prepare(`SELECT provider,calls,successes,errors,last_status,last_at FROM api_provider_usage WHERE period=?`).bind(date).all()
    ]);
    const rows=Object.fromEntries(ORDER.map(provider=>[provider,{provider,waitingFlights:new Set(),fieldCounts:{},avoided:0,performed:0,successes:0,errors:0,stop:0,potential:0,lastStatus:null,lastAt:"",evaluatedAt:"",fallback:FALLBACK[provider]}]));
    for(const s of snap){const p=DISPLAY[s.provider];if(!rows[p])continue;rows[p].avoided+=Number(s.avoided||0);rows[p].potential+=Number(s.potential||0);rows[p].stop=Math.max(rows[p].stop,Number(s.stop_all||0));if(clean(s.evaluated_at)>rows[p].evaluatedAt)rows[p].evaluatedAt=clean(s.evaluated_at)}
    for(const q of queue){const p=DISPLAY[q.provider];if(!rows[p])continue;rows[p].waitingFlights.add(q.flight_identity);let fields=[];try{fields=JSON.parse(q.fields_json||"[]")}catch{}for(const f of fields)rows[p].fieldCounts[f]=(rows[p].fieldCounts[f]||0)+1;if(clean(q.evaluated_at)>rows[p].evaluatedAt)rows[p].evaluatedAt=clean(q.evaluated_at)}
    for(const u of usage){const raw=String(u.provider||"").toUpperCase();let p="";if(raw.startsWith("OAG"))p="OAG";else if(raw.startsWith("AIRLABS"))p="AIRLABS";else if(raw.startsWith("SKYLINK"))p="SKYLINK";else if(raw.startsWith("OPENSKY"))p="OPENSKY";else if(raw.startsWith("QUARK"))p="QUARK";else if(raw.startsWith("AVIATIONDATA"))p="AVIATIONDATA";else if(raw.startsWith("FLIGHTERA"))p="FLIGHTERA";else if(raw.startsWith("KAYAK"))p="KAYAK";else if(raw.startsWith("SERPAPI"))p="SERPAPI";else if(raw.startsWith("FR24API"))p="FR24API";else if(raw.startsWith("CDGBOARD"))p="CDGBOARD";else if(raw.startsWith("FLIGHTRADAR1"))p="FLIGHTRADAR1";else if(raw.startsWith("FLIGHTRADAR8"))p="FLIGHTRADAR8";else if(raw.startsWith("FR24DEP"))p="FR24DEP";else if(raw.startsWith("AERODATABOX"))p="AERODATABOX";if(!rows[p])continue;rows[p].performed+=Number(u.calls||0);rows[p].successes+=Number(u.successes||0);rows[p].errors+=Number(u.errors||0);if(clean(u.last_at)>=rows[p].lastAt){rows[p].lastAt=clean(u.last_at);rows[p].lastStatus=u.last_status}}
    const errs=await readProviderErrors(env),states=await readProviderStates(env);
    return {ok:true,date,rows:ORDER.map(p=>({...rows[p],state:states[p]?{label:states[p].label||'',at:states[p].at||''}:(p==='OAG'&&Number(rows[p].lastStatus)===429?{label:'Limite OAG (HTTP 429) : plus aucun appel accepté depuis '+(rows[p].lastAt||'').slice(11,16)+' UTC — vérifier le forfait OAG',at:rows[p].lastAt||''}:null),lastError:errs[p]?{status:errs[p].status,message:errs[p].message||'',at:errs[p].at||'',until:errs[p].until||''}:null,waiting:rows[p].waitingFlights.size,waitingFlights:undefined,fields:Object.entries(rows[p].fieldCounts).sort((a,b)=>b[1]-a[1]).map(([field,count])=>({field,count})),fieldCounts:undefined}))};
  }catch(e){return {ok:false,date,error:String(e?.message||e),rows:[]}}
}

const UI=String.raw`<style id="alyzia-provider-observability-css">
#app .provider-observability{margin:16px 0;padding:14px;border:1px solid #dfe8f2;border-radius:18px;background:#fff;box-shadow:0 5px 18px rgba(21,54,83,.05)}
#app .provider-observability-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}
#app .provider-observability-title{font-size:13px;font-weight:950;color:#153653}.provider-observability-sub{font-size:10px;font-weight:800;color:#7890a6}
#app .provider-observability-wrap{overflow:auto;border:1px solid #edf2f7;border-radius:13px}
#app .provider-observability table{width:100%;border-collapse:collapse;min-width:850px;font-size:10px}
#app .provider-observability th{padding:9px 10px;text-align:left;background:#f6f9fc;color:#60768b;font-size:9px;font-weight:950;letter-spacing:.04em;white-space:nowrap}
#app .provider-observability td{padding:10px;border-top:1px solid #edf2f7;color:#263f56;font-weight:850;vertical-align:middle}
#app .provider-observability .prov{font-size:11px;color:#0d5f9f;font-weight:950}.provider-observability .num{font-size:13px;font-weight:950;color:#173b5b}.provider-observability .saved{color:#087a4b}.provider-observability .stop{color:#7d8791}.provider-observability .bad{color:#b42318}.provider-observability .ok{color:#087a4b}
#app .provider-observability .why{display:inline-block;max-width:360px;white-space:normal;color:#5b6f84;font-weight:800;line-height:1.35}
#app .provider-observability .fields{max-width:270px;white-space:normal;line-height:1.5}.provider-observability .fallback{white-space:nowrap;color:#5b6f84}
@media(max-width:700px){#app .provider-observability{padding:10px;margin:12px 0}.provider-observability-head{align-items:flex-start;flex-direction:column}}
</style><script id="alyzia-provider-observability-js">(()=>{'use strict';if(window.__alyziaProviderObservability)return;window.__alyziaProviderObservability=true;
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'—'};
function fieldsText(fields){return Array.isArray(fields)&&fields.length?fields.map(x=>String(x.field||'').toUpperCase()+' ×'+Number(x.count||0)).join(' · '):'—'}
function rowHtml(x){const st=x.lastStatus==null?'—':String(x.lastStatus);const stClass=Number(st)>=400?'bad':Number(st)>=200?'ok':'';return '<tr><td class="prov">'+esc(x.provider)+'</td><td><span class="num">'+Number(x.waiting||0)+'</span></td><td class="fields">'+esc(fieldsText(x.fields))+'</td><td><span class="num saved">'+Number(x.avoided||0)+'</span></td><td><span class="num">'+Number(x.performed||0)+'</span><br><small class="'+stClass+'">HTTP '+esc(st)+' · '+esc(fmt(x.lastAt))+'</small>'+(x.state&&x.state.label?'<br><small class="why">POURQUOI : '+esc(x.state.label)+(x.state.at?' · '+esc(fmt(x.state.at)):'')+'</small>':'')+(x.lastError?'<br><small class="bad">'+esc(x.lastError.message||('HTTP '+x.lastError.status))+(x.lastError.until?' · EN PAUSE JUSQU’À '+esc(fmt(x.lastError.until)):'')+'</small>':'')+'</td><td class="fallback">'+esc(x.fallback||'—')+'</td><td><span class="num stop">'+Number(x.stop||0)+'</span></td></tr>'}
function mount(data){const admin=document.querySelector('#app .admin-native');if(!admin||!data?.ok)return;document.querySelectorAll('#providerObservability').forEach((n,i)=>{if(i>0)n.remove()});let box=document.getElementById('providerObservability');if(!box){box=document.createElement('section');box.id='providerObservability';box.className='provider-observability';const cards=admin.querySelector('.adn-cards');if(cards)cards.insertAdjacentElement('afterend',box);else admin.prepend(box)}const html='<div class="provider-observability-head"><div><div class="provider-observability-title">PROVIDER OBSERVABILITY</div><div class="provider-observability-sub">QUEUE D1 · ÉCONOMIE DE QUOTA · '+esc(data.date||'')+'</div></div><div class="provider-observability-sub">MAJ '+esc(fmt(data.rows?.[0]?.evaluatedAt))+'</div></div><div class="provider-observability-wrap"><table><thead><tr><th>FOURNISSEUR</th><th>VOLS EN ATTENTE</th><th>CHAMPS DEMANDÉS</th><th>APPELS ÉVITÉS</th><th>APPELS EFFECTUÉS</th><th>FALLBACK ACTUEL</th><th>STOP</th></tr></thead><tbody>'+((data.rows||[]).map(rowHtml).join(''))+'</tbody></table></div>';if(box.__h===html)return;box.__h=html;box.innerHTML=html}
// One request at a time and at most one every 5 s (unless forced by a click): the observer used to refetch on every DOM change,
// including the ones caused by mount() itself, which made the admin tab jump.
const NAMES=['OAG','AIRLABS','SKYLINK','OPENSKY','QUARK','AVIATIONDATA','FLIGHTERA','KAYAK','SERPAPI','FR24API','CDGBOARD','FLIGHTRADAR1','FLIGHTRADAR8','FR24DEP','AERODATABOX'];
const SKEL={ok:true,date:'',rows:NAMES.map(p=>({provider:p,waiting:0,fields:[],avoided:0,performed:0,stop:0,lastStatus:null,lastAt:'',fallback:''}))};
let busy=false,lastAt=0;
async function refresh(force){if(busy)return;if(!force&&Date.now()-lastAt<5000)return;busy=true;try{const r=await fetch('/api/admin/provider-observability',{cache:'no-store'}),d=await r.json();if(r.ok&&d?.ok)mount(d)}catch{}finally{busy=false;lastAt=Date.now()}}
const obs=new MutationObserver(recs=>{if(recs.every(r=>r.target?.closest?.('#providerObservability')))return;if(document.querySelector('#app .admin-native')){if(!document.getElementById('providerObservability'))mount(SKEL);refresh()}});obs.observe(document.documentElement,{childList:true,subtree:true});document.addEventListener('click',e=>{if(e.target?.closest?.('#adminRefreshBtn,.adn-v4-btn,[data-nav="admin"],.bottom-nav'))setTimeout(()=>refresh(true),150)},true);setInterval(()=>{if(document.querySelector('#app .admin-native'))refresh()},30000);setTimeout(()=>refresh(true),800);
})();</script>`;
function patch(html){let s=String(html||"");if(s.includes('id="alyzia-provider-observability-js"'))return s;const i=s.lastIndexOf("</body>");return i>=0?s.slice(0,i)+UI+"\n"+s.slice(i):s+UI}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/admin/provider-observability")return new Response(JSON.stringify(await observability(env)),{headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});
    const response=await app.fetch(request,env,ctx),type=String(response.headers.get("content-type")||"").toLowerCase();if(!type.includes("text/html"))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete("content-length");headers.set("cache-control","no-store");return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx)}
};
