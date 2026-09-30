import app from "./flight-card-v2-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
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
function statusText(x){return upper([x.opsStatus,x.status,x.flight_status,x.providerStatusRaw].filter(Boolean).join(" "))}
function isCancelled(x){const s=statusText(x);return s.includes("CANCEL")||s.includes("ANNUL")}
function classify({row,x},now){
  const date=row.flight_date;
  const std=hhmm(x.std||row.std),sta=hhmm(x.sta),etd=hhmm(x.etd||x.edt),atd=hhmm(x.atd),eta=hhmm(x.eta),ata=hhmm(x.ata);
  const gate=clean(x.gate||x.departureGate||x.departure_gate),reg=clean(x.reg||x.registration||x.aircraftRegistration);
  const flight=upper(x.flight||x.flight_number||row.flight_number),destination=upper(x.destination||x.dest||x.arrival||"");
  const miss=[]; if(!std)miss.push("STD"); if(!sta)miss.push("STA");
  const today=date===now.date,future=date>now.date,nowMin=minute(now.hhmm),stdMin=minute(std),delta=today&&nowMin!==null&&stdMin!==null?stdMin-nowMin:null;
  const cancelled=isCancelled(x),final=cancelled||Boolean(atd&&ata); let state="OK";
  if(future){if(!std&&!sta)state="NON TRAITÉ";else if(!std||!sta)state="PARTIEL"}
  else if(today){
    if(cancelled||final)state="OK";
    else if(delta!==null&&delta<0&&!atd){
      // Grace period: only flag once the expected departure (ETD, else STD) is 20+ min past.
      const depMin=minute(etd)??stdMin,late=(depMin!==null&&depMin<=nowMin&&nowMin-depMin>20)||(!etd&&delta>=-60);
      // Fenêtre H-1 / H+1 : sans ETD ni ATD, le vol est à contrôler (voir plus bas pour H+1).
      miss.push("ATD");state=late?"À CONTRÔLER":"PARTIEL";
      // Sans ATD mais heure d'arrivée (ETA, sinon STA) dépassée de 20+ min (même jour) : le vol a forcément volé, il est considéré arrivé.
      const arrMin0=minute(eta)??minute(sta);
      if(arrMin0!==null&&stdMin!==null&&arrMin0>=stdMin&&arrMin0<=nowMin&&nowMin-arrMin0>20){state="OK";miss.push("ATA")}
    }
    else if(atd&&!ata){
      // Airborne is normal. Once ETA (else STA) is 20+ min past, the flight is considered arrived (OK)
      // even without ATA; ATA stays listed as missing and provider recovery keeps chasing it.
      const arrMin=minute(eta)??minute(sta),atdMin=minute(atd),sameDay=arrMin!==null&&atdMin!==null&&arrMin>=atdMin;
      if(sameDay&&arrMin<=nowMin&&nowMin-arrMin>20)miss.push("ATA")
    }
    else if(delta!==null&&delta<=60){const noDep=!etd&&!atd;if(noDep)miss.push("ETD/ATD");if(!gate&&!atd)miss.push("GATE");if(!reg)miss.push("REG");state=noDep?"À CONTRÔLER":miss.length?"PARTIEL":"OK"}
    else if(!std||!sta)state="PARTIEL";
    if(!sta&&!etd&&!atd&&!eta&&!ata&&!gate&&!reg)state="NON TRAITÉ";
  }
  return {date,flight,destination,std,sta,etd,atd,eta,ata,gate,reg,state,missing:[...new Set(miss)],checkedAt:clean(x.liveLastCheckedAt||x.oagLastCheckedAt||x.skylinkRecoveryLastCheckedAt||x.updatedAt||row.updated_at)};
}
function baseProvider(v){const p=upper(v);if(p.startsWith("AIRLABS"))return "AIRLABS";if(p.startsWith("SKYLINK"))return "SKYLINK";if(p.startsWith("OAG"))return "OAG";if(p.includes("AERODATABOX")||p.startsWith("ADB"))return "AERODATABOX";if(p.startsWith("OPENSKY"))return "OPENSKY";if(p.startsWith("QUARK"))return "QUARK";if(p.startsWith("AVIATIONDATA"))return "AVIATIONDATA";if(p.startsWith("FLIGHTERA"))return "FLIGHTERA";if(p.startsWith("FLIGHTRADAR1"))return "FLIGHTRADAR1";if(p.startsWith("FR24DEP"))return "FR24DEP";return p}
function quotaLimit(env,key){
  if(key==="AIRLABS")return {period:"month",limit:Number(env.AIRLABS_MONTHLY_LIMIT||1000),reserve:Number(env.AIRLABS_MONTHLY_RESERVE||180)};
  if(key==="SKYLINK")return {period:"month",limit:Number(env.SKYLINK_MONTHLY_LIMIT||1000),reserve:Number(env.SKYLINK_MONTHLY_RESERVE||220)};
  if(key==="OAG")return {period:"month",limit:Number(env.OAG_MONTHLY_LIMIT||0),reserve:Number(env.OAG_MONTHLY_RESERVE||0)};
  if(key==="AERODATABOX")return {period:"month",limit:Number(env.AERODATABOX_MONTHLY_LIMIT||env.ADB_MONTHLY_LIMIT||0),reserve:Number(env.AERODATABOX_MONTHLY_RESERVE||0)};
  if(key==="QUARK")return {period:"month",limit:Number(env.QUARK_MONTHLY_LIMIT||20000),reserve:0};
  if(key==="FR24DEP")return {period:"month",limit:Number(env.FR24DEP_MONTHLY_LIMIT||500),reserve:Number(env.FR24DEP_MONTHLY_RESERVE||70)};
  if(key==="FLIGHTRADAR1")return {period:"month",limit:Number(env.FLIGHTRADAR1_MONTHLY_LIMIT||500),reserve:Number(env.FLIGHTRADAR1_MONTHLY_RESERVE||70)};
  if(key==="FLIGHTERA")return {period:"month",limit:Number(env.FLIGHTERA_MONTHLY_LIMIT||200),reserve:Number(env.FLIGHTERA_MONTHLY_RESERVE||30)};
  if(key==="AVIATIONDATA")return {period:"month",limit:Number(env.AVIATIONDATA_MONTHLY_LIMIT||500),reserve:Number(env.AVIATIONDATA_MONTHLY_RESERVE||100)};
  return {period:"day",limit:Number(env.OPENSKY_DAILY_LIMIT||4000),reserve:0};
}
async function dashboard(env){
  const now=parisParts(),until=addDays(now.date,7);
  const {results=[]}=await env.OPS_DB.prepare(`SELECT flight_date,flight_number,std,updated_at,data_json FROM flights WHERE flight_date>=? AND flight_date<=? ORDER BY flight_date,std,flight_number`).bind(now.date,until).all();
  const flights=results.map(parseRow).map(z=>classify(z,now));
  const today=flights.filter(x=>x.date===now.date),future=flights.filter(x=>x.date>now.date);
  const summarize=list=>({total:list.length,ok:list.filter(x=>x.state==="OK").length,partial:list.filter(x=>x.state==="PARTIEL").length,check:list.filter(x=>x.state==="À CONTRÔLER").length,untreated:list.filter(x=>x.state==="NON TRAITÉ").length});
  let quotas=[];
  try{
    const month=now.date.slice(0,7),{results:q=[]}=await env.OPS_DB.prepare(`SELECT provider,period,calls,last_status,last_at FROM api_provider_usage WHERE period IN (?,?) ORDER BY provider,period`).bind(month,now.date).all();
    const map=new Map();
    for(const r of q){const k=baseProvider(r.provider);if(!map.has(k))map.set(k,{provider:k,today:0,month:0,lastStatus:null,lastAt:""});const o=map.get(k);if(r.period===now.date)o.today+=Number(r.calls||0);if(r.period===month)o.month+=Number(r.calls||0);if(!o.lastAt||clean(r.last_at)>o.lastAt){o.lastAt=clean(r.last_at);o.lastStatus=r.last_status}}
    quotas=["AIRLABS","SKYLINK","OAG","AERODATABOX","OPENSKY","QUARK","AVIATIONDATA","FLIGHTERA","FLIGHTRADAR1","FR24DEP"].map(k=>{const o=map.get(k)||{provider:k,today:0,month:0,lastStatus:null,lastAt:""},cfg=quotaLimit(env,k),used=cfg.period==="day"?o.today:o.month;return {...o,...cfg,remaining:cfg.limit?Math.max(0,cfg.limit-cfg.reserve-used):null}});
  }catch{}
  return {ok:true,generatedAt:new Date().toISOString(),date:now.date,until,summary:{today:summarize(today),future:summarize(future)},flights,quotas};
}

const UI=String.raw`<style id="alyzia-admin-native-css">
#app .admin-native{padding:8px 0 100px;color:#10233f}.adn-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:8px 0 14px}.adn-title{font-size:25px;font-weight:950}.adn-sub{font-size:11px;color:#708299;font-weight:800}.adn-refresh{border:1px solid #cfe0f1;background:#eef6ff;color:#076fd1;border-radius:12px;padding:9px 12px;font-weight:950}.adn-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}.adn-card,.adn-section{background:#fff;border:1px solid #dfe7f1;border-radius:16px;padding:13px}.adn-card b{font-size:18px}.adn-mini{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px;font-size:11px;font-weight:900}.ok{color:#087443}.part{color:#a76a00}.check{color:#cc2f43}.none{color:#6b7787}.adn-section{margin-top:10px;overflow:auto}.adn-section h3{margin:0 0 10px;font-size:13px}.adn-quota{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:8px}.adn-q{border:1px solid #e6ecf2;border-radius:12px;padding:9px}.adn-qtop{display:flex;justify-content:space-between;font-size:11px;font-weight:950}.adn-qsmall{margin-top:5px;font-size:10px;color:#71839a;font-weight:800}.adn-table{width:100%;border-collapse:collapse;min-width:980px;font-size:11px}.adn-table th,.adn-table td{padding:7px 6px;border-bottom:1px solid #edf1f5;text-align:left;white-space:nowrap}.adn-table th{font-size:10px;color:#6f8098}.adn-badge{display:inline-flex;padding:4px 7px;border-radius:999px;font-weight:950}.adn-badge.OK{background:#e2f6eb;color:#087443}.adn-badge.PARTIEL{background:#fff0d2;color:#986100}.adn-badge.CTRL{background:#ffe5e9;color:#c6283c}.adn-badge.NONE{background:#eef1f4;color:#616d7c}@media(max-width:700px){#app .admin-native{padding:4px 0 100px}.adn-cards{grid-template-columns:1fr}.adn-title{font-size:21px}}
</style><script id="alyzia-admin-native-js">(()=>{'use strict';
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const cls=s=>s==='OK'?'OK':s==='PARTIEL'?'PARTIEL':String(s).includes('CONTRÔLER')?'CTRL':'NONE';
const card=(title,s)=>'<div class="adn-card"><b>'+title+' · '+(s?.total||0)+'</b><div class="adn-mini"><span class="ok">OK '+(s?.ok||0)+'</span><span class="part">PARTIEL '+(s?.partial||0)+'</span><span class="check">À CONTRÔLER '+(s?.check||0)+'</span><span class="none">NON TRAITÉ '+(s?.untreated||0)+'</span></div></div>';
window.renderAdminDashboard=async function(){
  const app=document.getElementById('app');if(!app)return;
  document.querySelectorAll('[data-mobile-nav]').forEach(b=>b.classList.toggle('active',b.dataset.mobileNav==='admin'));
  app.innerHTML='<section class="admin-native"><div class="adn-head"><div><div class="adn-title">TABLEAU DE BORD ADMIN</div><div class="adn-sub">TRAITEMENT DES VOLS · AUJOURD’HUI + 7 JOURS</div></div></div><div class="adn-section"><b>CHARGEMENT DU TRAITEMENT DES VOLS…</b></div></section>';
  try{
    const r=await fetch('/api/admin/flight-processing',{cache:'no-store'}),d=await r.json();if(!r.ok||!d?.ok)throw new Error(d?.error||('HTTP '+r.status));
    const rows=(d.flights||[]).slice(0,220);
    app.innerHTML='<section class="admin-native"><div class="adn-head"><div><div class="adn-title">TABLEAU DE BORD ADMIN</div><div class="adn-sub">DERNIÈRE LECTURE '+new Date(d.generatedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</div></div><button class="adn-refresh" onclick="renderAdminDashboard()">ACTUALISER</button></div><div class="adn-cards">'+card('AUJOURD’HUI',d.summary?.today)+card('FUTUR',d.summary?.future)+'</div><div class="adn-section"><h3>QUOTAS API</h3><div class="adn-quota">'+(d.quotas||[]).map(q=>'<div class="adn-q"><div class="adn-qtop"><span>'+esc(q.provider)+'</span><span>'+((q.period==='day'?q.today:q.month)||0)+(q.limit?' / '+q.limit:'')+'</span></div><div class="adn-qsmall">JOUR '+(q.today||0)+' · MOIS '+(q.month||0)+' · RESTANT '+(q.remaining==null?'—':q.remaining)+' · HTTP '+(q.lastStatus??'—')+'</div></div>').join('')+'</div></div><div class="adn-section"><h3>VOLS TRAITÉS / À SURVEILLER</h3><table class="adn-table"><thead><tr><th>DATE</th><th>VOL</th><th>DEST</th><th>STD</th><th>STA</th><th>ETD</th><th>ATD</th><th>ETA</th><th>ATA</th><th>GATE</th><th>REG</th><th>ÉTAT</th><th>MANQUE</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(String(x.date||'').slice(5))+'</td><td><b>'+esc(x.flight||'—')+'</b></td><td>'+esc(x.destination||'—')+'</td><td>'+esc(x.std||'—')+'</td><td>'+esc(x.sta||'—')+'</td><td>'+esc(x.etd||'—')+'</td><td>'+esc(x.atd||'—')+'</td><td>'+esc(x.eta||'—')+'</td><td>'+esc(x.ata||'—')+'</td><td>'+esc(x.gate||'—')+'</td><td>'+esc(x.reg||'—')+'</td><td><span class="adn-badge '+cls(x.state)+'">'+esc(x.state||'—')+'</span></td><td>'+esc((x.missing||[]).join(', ')||'—')+'</td></tr>').join('')+'</tbody></table></div></section>';
  }catch(e){app.innerHTML='<section class="admin-native"><div class="adn-section"><b>ERREUR TABLEAU DE BORD :</b> '+esc(e.message||e)+'</div></section>'}
};
})();</script>`;

function patch(html){
  let s=String(html||'');
  s=s.replace('<button>ADMIN</button>','<button onclick="renderAdminDashboard()">ADMIN</button>');
  s=s.replace('<button data-mobile-nav="admin">','<button onclick="renderAdminDashboard()" data-mobile-nav="admin">');
  if(!s.includes('id="alyzia-admin-native-css"')){const i=s.lastIndexOf('</body>');s=i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
  return s;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/admin/flight-processing"){
      try{return json(await dashboard(env))}catch(error){return json({ok:false,error:clean(error?.message||error)},500)}
    }
    const response=await app.fetch(request,env,ctx),type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
