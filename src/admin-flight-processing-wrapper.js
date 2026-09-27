import app from "./flight-card-v2-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const m=clean(v).match(/(\d{2}:\d{2})/);return m?m[1]:""};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});

function parisParts(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
  const x=Object.fromEntries(p.map(v=>[v.type,v.value]));
  return {date:`${x.year}-${x.month}-${x.day}`,hhmm:`${x.hour}:${x.minute}`};
}
function addDays(date,days){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function minute(v){const h=hhmm(v);if(!h)return null;const [a,b]=h.split(":").map(Number);return a*60+b}
function parseRow(row){let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}return {row,x}}
function flightName(row,x){return upper(x.flight||x.flight_number||row.flight_number)}
function destination(x){return upper(x.destination||x.dest||x.arrival||"")}
function statusText(x){return upper([x.opsStatus,x.status,x.flight_status,x.providerStatusRaw].filter(Boolean).join(" "))}
function isCancelled(x){const s=statusText(x);return s.includes("CANCEL")||s.includes("ANNUL")}
function classify(z,now){
  const {row,x}=z,date=row.flight_date;
  const std=hhmm(x.std||row.std),sta=hhmm(x.sta),etd=hhmm(x.etd||x.edt),atd=hhmm(x.atd),eta=hhmm(x.eta),ata=hhmm(x.ata),gate=clean(x.gate||x.departureGate||x.departure_gate),reg=clean(x.reg||x.registration||x.aircraftRegistration);
  const miss=[];
  if(!std)miss.push("STD"); if(!sta)miss.push("STA");
  const future=date>now.date, today=date===now.date;
  const nowMin=minute(now.hhmm),stdMin=minute(std),delta=today&&nowMin!==null&&stdMin!==null?stdMin-nowMin:null;
  const cancelled=isCancelled(x),final=cancelled||Boolean(atd&&ata);
  let state="OK";
  if(future){
    if(!std&&!sta)state="NON TRAITÉ";
    else if(!std||!sta)state="PARTIEL";
  }else if(today){
    if(cancelled||final)state="OK";
    else if(delta!==null&&delta<0&&!atd){state="À CONTRÔLER";miss.push("ATD")}
    else if(atd&&!ata){state="À CONTRÔLER";miss.push("ATA")}
    else if(delta!==null&&delta<=60){
      if(!etd&&!atd)miss.push("ETD/ATD");
      if(!gate)miss.push("GATE");
      if(!reg)miss.push("REG");
      state=miss.length?"PARTIEL":"OK";
    }else if(!std||!sta)state="PARTIEL";
    if(!sta&&!etd&&!atd&&!eta&&!ata&&!gate&&!reg)state="NON TRAITÉ";
  }
  return {date,flight:flightName(row,x),destination:destination(x),std,sta,etd,atd,eta,ata,gate,reg,state,missing:[...new Set(miss)],source:clean(x.staSource||x.liveSource||x.provider||x.source),checkedAt:clean(x.liveLastCheckedAt||x.oagLastCheckedAt||x.skylinkRecoveryLastCheckedAt||x.updatedAt||row.updated_at)};
}
function quotaLimit(env,key){
  if(key==="AIRLABS")return {period:"month",limit:Number(env.AIRLABS_MONTHLY_LIMIT||1000),reserve:Number(env.AIRLABS_MONTHLY_RESERVE||180)};
  if(key==="SKYLINK")return {period:"month",limit:Number(env.SKYLINK_MONTHLY_LIMIT||1000),reserve:Number(env.SKYLINK_MONTHLY_RESERVE||220)};
  if(key==="OAG")return {period:"month",limit:Number(env.OAG_MONTHLY_LIMIT||0),reserve:Number(env.OAG_MONTHLY_RESERVE||0)};
  if(key==="AERODATABOX")return {period:"month",limit:Number(env.AERODATABOX_MONTHLY_LIMIT||env.ADB_MONTHLY_LIMIT||0),reserve:Number(env.AERODATABOX_MONTHLY_RESERVE||0)};
  if(key==="OPENSKY")return {period:"day",limit:Number(env.OPENSKY_DAILY_LIMIT||4000),reserve:0};
  return {period:"month",limit:0,reserve:0};
}
function baseProvider(v){const p=upper(v);if(p.startsWith("AIRLABS"))return "AIRLABS";if(p.startsWith("SKYLINK"))return "SKYLINK";if(p.startsWith("OAG"))return "OAG";if(p.includes("AERODATABOX")||p.startsWith("ADB"))return "AERODATABOX";if(p.startsWith("OPENSKY"))return "OPENSKY";return p}
async function dashboard(env){
  const now=parisParts(),until=addDays(now.date,7);
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,updated_at,data_json FROM flights WHERE flight_date>=? AND flight_date<=? ORDER BY flight_date,std,flight_number`).bind(now.date,until).all();
  const flights=results.map(parseRow).map(z=>classify(z,now));
  const today=flights.filter(x=>x.date===now.date),future=flights.filter(x=>x.date>now.date);
  const summarize=list=>({total:list.length,ok:list.filter(x=>x.state==="OK").length,partial:list.filter(x=>x.state==="PARTIEL").length,check:list.filter(x=>x.state==="À CONTRÔLER").length,untreated:list.filter(x=>x.state==="NON TRAITÉ").length});
  let quotas=[];
  try{
    const month=now.date.slice(0,7);
    const {results:q=[]}=await env.OPS_DB.prepare(`SELECT provider,period,calls,successes,errors,last_status,last_at FROM api_provider_usage WHERE period IN (?,?) ORDER BY provider,period`).bind(month,now.date).all();
    const map=new Map();
    for(const r of q){const k=baseProvider(r.provider);if(!map.has(k))map.set(k,{provider:k,today:0,month:0,successes:0,errors:0,lastStatus:null,lastAt:""});const o=map.get(k);if(r.period===now.date)o.today+=Number(r.calls||0);if(r.period===month)o.month+=Number(r.calls||0);o.successes+=Number(r.successes||0);o.errors+=Number(r.errors||0);if(!o.lastAt||clean(r.last_at)>o.lastAt){o.lastAt=clean(r.last_at);o.lastStatus=r.last_status}}
    quotas=["AIRLABS","SKYLINK","OAG","AERODATABOX","OPENSKY"].map(k=>{const o=map.get(k)||{provider:k,today:0,month:0,successes:0,errors:0,lastStatus:null,lastAt:""};const cfg=quotaLimit(env,k),used=cfg.period==="day"?o.today:o.month,remaining=cfg.limit?Math.max(0,cfg.limit-cfg.reserve-used):null;return {...o,...cfg,remaining}});
  }catch(_){quotas=[]}
  return {ok:true,generatedAt:new Date().toISOString(),date:now.date,until,summary:{today:summarize(today),future:summarize(future)},flights,quotas};
}

const UI=String.raw`<style id="alyzia-admin-processing-css">
#alyzia-processing-dashboard{margin:16px 0 26px;padding:18px;border:1px solid #dfe7f1;border-radius:22px;background:#f8fbff;color:#10233f;font-family:inherit}
.apd-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.apd-title{font-size:20px;font-weight:950}.apd-sub{font-size:12px;color:#6f8198;font-weight:800}.apd-refresh{border:0;border-radius:12px;background:#e9f3ff;color:#0874d1;padding:9px 12px;font-weight:900}
.apd-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:14px}.apd-card{background:#fff;border:1px solid #e4eaf1;border-radius:16px;padding:13px}.apd-card b{font-size:18px}.apd-mini{display:flex;gap:9px;flex-wrap:wrap;margin-top:8px;font-size:12px;font-weight:900}.apd-ok{color:#087443}.apd-partial{color:#b66a00}.apd-check{color:#d43a48}.apd-none{color:#6e7785}
.apd-section{background:#fff;border:1px solid #e4eaf1;border-radius:16px;padding:12px;margin-top:12px;overflow:auto}.apd-section h3{margin:0 0 10px;font-size:14px}.apd-filters{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}.apd-filter{border:1px solid #d8e1eb;background:#fff;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:900}.apd-filter.active{background:#0c75c7;color:#fff;border-color:#0c75c7}
.apd-table{width:100%;border-collapse:collapse;min-width:980px;font-size:11px}.apd-table th,.apd-table td{padding:8px 7px;border-bottom:1px solid #eef2f6;text-align:left;white-space:nowrap}.apd-table th{color:#6e8098;font-size:10px}.apd-state{display:inline-flex;padding:5px 8px;border-radius:999px;font-weight:950}.apd-state.OK{background:#e3f6ec;color:#087443}.apd-state.PARTIEL{background:#fff1d6;color:#9b6200}.apd-state.CONTROLER{background:#ffe7ea;color:#c9273a}.apd-state.NONTRAITE{background:#eef1f4;color:#626e7c}
.apd-quota{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px}.apd-q{border:1px solid #e7edf3;border-radius:13px;padding:10px}.apd-qtop{display:flex;justify-content:space-between;font-size:12px;font-weight:950}.apd-bar{height:6px;background:#edf1f5;border-radius:99px;overflow:hidden;margin:8px 0}.apd-bar>i{display:block;height:100%;background:#1882cf}.apd-qsmall{font-size:10px;color:#72849a;font-weight:800}
@media(max-width:700px){#alyzia-processing-dashboard{margin:10px 0;padding:12px;border-radius:17px}.apd-cards{grid-template-columns:1fr}.apd-title{font-size:17px}}
</style><script id="alyzia-admin-processing-js">(()=>{'use strict';
const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));let currentFilter='ALL',data=null,loading=false;
const norm=s=>String(s||'').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
function visible(el){if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'}
function adminAnchor(){const candidates=[...document.querySelectorAll('#app [id*="admin" i],#app [class*="admin" i]')].filter(visible);if(candidates.length)return candidates.sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height)[0];return document.querySelector('#app')}
function activeAdmin(){return [...document.querySelectorAll('#app .active,#app [aria-selected="true"]')].some(el=>/^ADMIN(?:ISTRATION)?$/.test(norm(el.textContent)))}
function clickedAdmin(target){let el=target;for(let i=0;el&&i<5;i++,el=el.parentElement){if(/^ADMIN(?:ISTRATION)?$/.test(norm(el.textContent)))return true}return false}
function stateClass(s){return norm(s).replace(/A /g,'').replace(/[^A-Z]/g,'')}
function summaryCard(title,s){return '<div class="apd-card"><b>'+title+' · '+s.total+'</b><div class="apd-mini"><span class="apd-ok">OK '+s.ok+'</span><span class="apd-partial">PARTIEL '+s.partial+'</span><span class="apd-check">À CONTRÔLER '+s.check+'</span><span class="apd-none">NON TRAITÉ '+s.untreated+'</span></div></div>'}
function render(){const box=document.getElementById('alyzia-processing-dashboard');if(!box||!data)return;const rows=data.flights.filter(x=>currentFilter==='ALL'||x.state===currentFilter);box.innerHTML='<div class="apd-head"><div><div class="apd-title">Traitement des vols</div><div class="apd-sub">Aujourd’hui + 7 jours · dernière lecture '+new Date(data.generatedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</div></div><button class="apd-refresh">Actualiser</button></div><div class="apd-cards">'+summaryCard('AUJOURD’HUI',data.summary.today)+summaryCard('FUTUR',data.summary.future)+'</div><div class="apd-section"><h3>QUOTAS API</h3><div class="apd-quota">'+data.quotas.map(q=>{const used=q.period==='day'?q.today:q.month,pct=q.limit?Math.min(100,Math.round(used*100/q.limit)):0,remain=q.remaining==null?'—':q.remaining;return '<div class="apd-q"><div class="apd-qtop"><span>'+esc(q.provider)+'</span><span>'+used+(q.limit?' / '+q.limit:'')+'</span></div><div class="apd-bar"><i style="width:'+pct+'%"></i></div><div class="apd-qsmall">Aujourd’hui '+q.today+' · Mois '+q.month+' · Restant '+remain+' · HTTP '+(q.lastStatus??'—')+'</div></div>'}).join('')+'</div></div><div class="apd-section"><h3>VOLs À SURVEILLER / TRAITÉS</h3><div class="apd-filters">'+[['ALL','TOUS'],['À CONTRÔLER','À CONTRÔLER'],['PARTIEL','PARTIEL'],['NON TRAITÉ','NON TRAITÉ'],['OK','OK']].map(([k,l])=>'<button class="apd-filter '+(currentFilter===k?'active':'')+'" data-f="'+k+'">'+l+'</button>').join('')+'</div><table class="apd-table"><thead><tr><th>DATE</th><th>VOL</th><th>DEST</th><th>STD</th><th>STA</th><th>ETD</th><th>ATD</th><th>ETA</th><th>ATA</th><th>GATE</th><th>REG</th><th>ÉTAT</th><th>MANQUE</th><th>DERNIER CONTRÔLE</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.date.slice(5))+'</td><td><b>'+esc(x.flight)+'</b></td><td>'+esc(x.destination||'—')+'</td><td>'+esc(x.std||'—')+'</td><td>'+esc(x.sta||'—')+'</td><td>'+esc(x.etd||'—')+'</td><td>'+esc(x.atd||'—')+'</td><td>'+esc(x.eta||'—')+'</td><td>'+esc(x.ata||'—')+'</td><td>'+esc(x.gate||'—')+'</td><td>'+esc(x.reg||'—')+'</td><td><span class="apd-state '+stateClass(x.state)+'">'+esc(x.state)+'</span></td><td>'+esc(x.missing.join(', ')||'—')+'</td><td>'+esc(x.checkedAt?new Date(x.checkedAt).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—')+'</td></tr>').join('')+'</tbody></table></div>';box.querySelector('.apd-refresh').onclick=load;box.querySelectorAll('.apd-filter').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.f;render()})}
async function load(){if(loading)return;loading=true;try{const r=await fetch('/api/admin/flight-processing',{cache:'no-store'});data=await r.json();render()}catch(e){const box=document.getElementById('alyzia-processing-dashboard');if(box)box.innerHTML='<b>Impossible de charger le suivi des vols.</b>'}finally{loading=false}}
function mount(){if(document.getElementById('alyzia-processing-dashboard'))return;const host=adminAnchor();if(!host)return;const box=document.createElement('section');box.id='alyzia-processing-dashboard';host.prepend(box);box.innerHTML='<b>Chargement du traitement des vols…</b>';load()}
document.addEventListener('click',e=>{if(clickedAdmin(e.target))setTimeout(mount,120)},true);const obs=new MutationObserver(()=>{if(activeAdmin())mount()});obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-selected']});setTimeout(()=>{if(activeAdmin())mount()},500);
})();</script>`;

function patch(html){let s=String(html||"");if(s.includes('id="alyzia-admin-processing-css"'))return s;const i=s.lastIndexOf("</body>");return i>=0?s.slice(0,i)+UI+"\n"+s.slice(i):s+UI}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/admin/flight-processing"){
      try{return json(await dashboard(env))}catch(error){return json({ok:false,error:clean(error?.message||error)},500)}
    }
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get("content-type")||"").toLowerCase();
    if(!type.includes("text/html"))return response;
    const html=await response.text(),headers=new Headers(response.headers);headers.delete("content-length");headers.set("cache-control","no-store");
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx)}
};
