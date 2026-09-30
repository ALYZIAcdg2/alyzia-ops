import app from "./admin-dashboard-v4-wrapper.js";

const UI=String.raw`<style id="alyzia-admin-dashboard-v5-css">
#app .admin-native .adn-next-plan{display:flex;flex-direction:column;gap:2px;line-height:1.15}
#app .admin-native .adn-next-plan b{font-size:10px;color:#0a6abf}
#app .admin-native .adn-next-plan small{font-size:9px;color:#667b91;font-weight:900}
#app .admin-native .adn-card-next{margin-top:7px;padding-top:7px;border-top:1px solid #edf1f5;font-size:10px;font-weight:900;color:#48657e;min-height:12px;line-height:12px}
#app .admin-native .adn-cards .adn-card:not(:has(.adn-card-next))::after{content:'\00a0';display:block;margin-top:7px;padding-top:7px;border-top:1px solid #edf1f5;font-size:10px;min-height:12px;line-height:12px}
.adn-api-timing{border:1px solid #dbe7f3;border-radius:12px;padding:10px;background:#f8fbff;font-size:11px;line-height:1.8;color:#52677d;font-weight:850}
.adn-api-timing b{color:#153653}.adn-api-timing .api-next{font-size:13px;color:#0874d1;font-weight:950}
</style><script id="alyzia-admin-dashboard-v5-js">(()=>{'use strict';
if(window.__alyziaAdminV5)return;window.__alyziaAdminV5=true;
let adminData=null;
const PROVIDERS=['AIRLABS','SKYLINK','OAG','AERODATABOX','OPENSKY','QUARK','AVIATIONDATA','FLIGHTERA','FLIGHTRADAR1','FLIGHTRADAR8','FR24DEP'];
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const missing=v=>!v||v==='—'||v==='-'||v==='N/A';
const fmt=d=>d&&Number.isFinite(d.getTime())?d.toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const fmtLong=d=>d&&Number.isFinite(d.getTime())?d.toLocaleString('fr-FR'):'—';
function nextFive(d=new Date()){const x=new Date(d);x.setSeconds(0,0);const m=x.getMinutes();x.setMinutes(m+(5-m%5||5));return x}
function ceilFive(d){return nextFive(new Date(d.getTime()-1))}
function atLocal(date,hhmm='00:00'){const [h,m]=String(hhmm||'00:00').split(':').map(Number);const d=new Date(date+'T00:00:00');d.setHours(Number.isFinite(h)?h:0,Number.isFinite(m)?m:0,0,0);return d}
function stateText(tr){return String(tr.cells?.[11]?.textContent||'').trim().toUpperCase()}
function missText(tr){return String(tr.cells?.[12]?.textContent||'').toUpperCase()}
function futureBaseTime(date,std,now){
  if(/^\d{2}:\d{2}$/.test(std)){const at=atLocal(date,std);at.setMinutes(at.getMinutes()-180);return at>now?ceilFive(at):nextFive(now)}
  return atLocal(date,'00:05');
}
function planFromRow(tr){
  const date=document.getElementById('adminDateInput')?.value||'';if(!date)return null;
  const std=String(tr.cells?.[3]?.textContent||'').trim(),sta=String(tr.cells?.[4]?.textContent||'').trim(),atd=String(tr.cells?.[6]?.textContent||'').trim(),reg=String(tr.cells?.[10]?.textContent||'').trim();
  const state=stateText(tr),miss=missText(tr),today=adminData?.date||new Date().toISOString().slice(0,10),now=new Date();
  if(state==='OK'&&date<=today)return {done:true,label:'TERMINÉ'};
  if(date>today){
    if(missing(sta)||miss.includes('STA'))return {at:futureBaseTime(date,std,now),provider:'AIRLABS ROUTES → OAG',label:'COMPLÉTER STA'};
    if(/^\d{2}:\d{2}$/.test(std)){const at=atLocal(date,std);at.setMinutes(at.getMinutes()-180);return {at:ceilFive(at),provider:'AIRLABS',label:'DÉBUT CONTRÔLE LIVE · PUIS SKYLINK / OAG / ADB'}};
    return {at:atLocal(date,'00:05'),provider:'AIRLABS ROUTES → OAG',label:'CONTRÔLE J0'};
  }
  if(missing(sta)||miss.includes('STA'))return {at:nextFive(now),provider:'AIRLABS ROUTES → OAG',label:'COMPLÉTER STA'};
  if(/^\d{2}:\d{2}$/.test(std)){
    const dep=atLocal(date,std),h180=new Date(dep.getTime()-180*60000),h20=new Date(dep.getTime()-20*60000);
    if(now<h180)return {at:ceilFive(h180),provider:'AIRLABS',label:'DÉBUT CONTRÔLE LIVE'};
    if((missing(atd)||miss.includes('ATD'))&&now>=h20)return {at:nextFive(now),provider:'OPENSKY SI COMPATIBLE · AIRLABS / SKYLINK / OAG',label:'CONFIRMER DÉPART'};
  }
  const provider=(missing(reg)||miss.includes('REG'))?'AIRLABS / SKYLINK / OAG → AERODATABOX':'AIRLABS / SKYLINK / OAG';
  return {at:nextFive(now),provider,label:state.includes('CONTRÔLER')?'RECONTRÔLE PRIORITAIRE':'COMPLÉTER DONNÉES'};
}
function patchRows(){
  const rows=[...document.querySelectorAll('#app .admin-native .adn-table tbody tr')];
  rows.forEach(tr=>{const td=tr.querySelector('.adn-next');if(!td)return;const p=planFromRow(tr);if(!p)return;if(p.done){td.innerHTML='<div class="adn-next-plan"><b>TERMINÉ</b></div>';return}td.innerHTML='<div class="adn-next-plan"><b>'+esc(fmt(p.at))+' · '+esc(p.provider)+'</b><small>'+esc(p.label)+'</small></div>'});
}
function planFromFlight(x){
  if(!x||!x.date)return null;const fake=document.createElement('tr');
  const vals=[x.flight,x.destination,'',x.std,x.sta,x.etd,x.atd,x.eta,x.ata,x.gate,x.reg,x.state,(x.missing||[]).join(', '),'',''];
  vals.forEach(v=>{const td=document.createElement('td');td.textContent=v||'—';fake.appendChild(td)});
  const input=document.getElementById('adminDateInput'),saved=input?.value;if(input)input.value=x.date;const p=planFromRow(fake);if(input&&saved)input.value=saved;return p;
}
function patchSummaryCards(){
  const cards=[...document.querySelectorAll('#app .admin-native .adn-cards .adn-card')];if(cards.length<2||!adminData)return;
  
  const groups=[
    {card:cards[0],rows:(adminData.flights||[]).filter(x=>x.date===adminData.date),label:'PROCHAIN TRAITEMENT AUJOURD’HUI'},
    {card:cards[1],rows:(adminData.flights||[]).filter(x=>x.date>adminData.date),label:'PROCHAIN TRAITEMENT FUTUR'}
  ];
  for(const g of groups){
    const plans=g.rows.map(x=>({x,p:planFromFlight(x)})).filter(z=>z.p?.at&&!z.p?.done).sort((a,b)=>a.p.at-b.p.at);
    let el=g.card.querySelector('.adn-card-next');if(!plans.length){el?.remove();continue}const z=plans[0],txt=g.label+' : '+fmt(z.p.at)+' · '+z.x.flight+' · '+z.p.provider;if(!el){el=document.createElement('div');el.className='adn-card-next';g.card.appendChild(el)}if(el.textContent!==txt)el.textContent=txt;
  }
}
async function refreshAdminData(){try{const r=await fetch('/api/admin/flight-processing',{cache:'no-store'});const d=await r.json();if(r.ok&&d?.ok)adminData=d}catch{}setTimeout(()=>{patchRows();patchSummaryCards()},0)}
function timing(provider,q){
  const now=new Date(),cron=nextFive(now),last=q?.lastAt?new Date(q.lastAt):null;
  const cfg={
    AIRLABS:{min:20,cadence:'20 MIN URGENT / 45 MIN STANDARD',condition:'SI VOL LIVE INCOMPLET ET QUOTA DISPONIBLE'},
    SKYLINK:{min:30,cadence:'30 MIN GLOBAL / 90 MIN PAR VOL',condition:'SI DONNÉES IMPORTANTES ENCORE MANQUANTES'},
    OAG:{min:15,cadence:'DYNAMIQUE 15 / 30 / 60 / 120 MIN',condition:'FALLBACK SELON PHASE DU VOL ET DONNÉES MANQUANTES'},
    AERODATABOX:{min:75,cadence:'75 MIN GLOBAL',condition:'DERNIER RECOURS IMMATRICULATION / MODE-S'},
    OPENSKY:{min:10,cadence:'10 MIN',condition:'SI VOL CANDIDAT PROCHE DU DÉPART ET ATD MANQUANT'},
    QUARK:{min:5,cadence:'5 MIN · 4 VOLS MAX PAR PASSAGE',condition:'ETD / ETA / GATE MANQUANTS · 1 ESSAI PAR HEURE ET PAR VOL'},
    AVIATIONDATA:{min:5,cadence:'1 VOL PAR PASSAGE · 12 APPELS PAR JOUR',condition:'DERNIER RECOURS ATD / ATA · 3 ESSAIS MAX PAR VOL'},
    FR24DEP:{min:45,cadence:'1 PASSAGE / 45 MIN · 100 DÉPARTS CDG PAR APPEL · 12 APPELS PAR JOUR',condition:'RATTRAPAGE GROUPÉ ATD / ATA / ETD / ETA / PORTE / IMMAT. + STATUT ANNULÉ'},
    FLIGHTRADAR8:{min:5,cadence:'1 VOL PAR PASSAGE · 25 APPELS PAR JOUR',condition:'VOL EN L\'AIR : ATD / ATA / ETD / ETA / STA / PORTE / IMMAT. / APPAREIL (MOITIÉ DES VOLS)'},
    FLIGHTRADAR1:{min:5,cadence:'1 VOL PAR PASSAGE · 25 APPELS PAR JOUR',condition:'VOL EN L\'AIR : ATD / ATA / ETD / ETA / STA / PORTE / IMMAT. / APPAREIL (MOITIÉ DES VOLS)'},
    FLIGHTERA:{min:5,cadence:'1 VOL PAR PASSAGE · 10 APPELS PAR JOUR',condition:'DÉPART PASSÉ SANS ATD / ATA · 3 ESSAIS MAX PAR VOL'}
  }[provider]||{min:5,cadence:'SELON LOGIQUE FOURNISSEUR',condition:'SI CANDIDAT'};
  let eligible=cron;if(last&&Number.isFinite(last.getTime())){const e=new Date(last.getTime()+cfg.min*60000);eligible=ceilFive(e>now?e:now)}
  return {cron,eligible,cfg,last};
}
const baseShow=window.showModal;
if(typeof baseShow==='function')window.showModal=function(title,subtitle,html,...rest){
  const provider=String(title||'').toUpperCase();
  if(PROVIDERS.includes(provider)&&String(subtitle||'').toUpperCase().includes('QUOTA API')){
    const q=(adminData?.quotas||[]).find(x=>x.provider===provider)||null,t=timing(provider,q);
    html=String(html||'')+'<div class="adn-api-timing"><b>HORODATAGE TRAITEMENT</b><br>DERNIER APPEL : '+esc(t.last?fmtLong(t.last):'AUCUN APPEL ENREGISTRÉ')+'<br>PROCHAIN PASSAGE CRON : <span class="api-next">'+esc(fmtLong(t.cron))+'</span><br>PROCHAINE ÉLIGIBILITÉ API : <span class="api-next">'+esc(fmtLong(t.eligible))+'</span><br>CADENCE : '+esc(t.cfg.cadence)+'<br>CONDITION : '+esc(t.cfg.condition)+'</div>';
  }
  return baseShow.call(this,title,subtitle,html,...rest)
};
const baseRender=window.renderAdminDashboard;
if(typeof baseRender==='function')window.renderAdminDashboard=async function(...args){const r=await baseRender.apply(this,args);await refreshAdminData();return r};
document.addEventListener('click',e=>{const c=e.target?.closest?.('#adminPrev,#adminNext,#adminDateBtn,[data-terminal],#adminRefreshBtn,.adn-status-active,.adn-mini span,.adn-v4-btn');if(c)setTimeout(()=>{patchRows();patchSummaryCards()},20)},true);
document.addEventListener('change',e=>{if(e.target?.id==='adminDateInput')setTimeout(()=>{patchRows();patchSummaryCards()},20)},true);
setTimeout(refreshAdminData,0);
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-admin-dashboard-v5-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}

export default {
  async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
