import app from "./operational-state-wrapper.js";

const UI=String.raw`
<style id="alyzia-v2-full-style">
#app .flight-home-row.v2-ready{display:block!important;position:relative!important;padding:0!important;overflow:hidden!important;border-radius:24px!important;background:#fff!important;border:1px solid #e1e8f0!important;box-shadow:0 7px 24px rgba(22,48,86,.08)!important;min-height:0!important}
#app .flight-home-row.v2-ready>*:not(.v2-card){display:none!important}
#app .flight-home-row.v2-ready .v2-card{display:block!important;padding:18px!important;color:#0b1d3a;font-family:inherit;cursor:pointer}
.v2-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:start}
.v2-brand{display:flex;align-items:flex-start;gap:12px;flex-wrap:nowrap}.v2-logo{width:112px;height:38px;object-fit:contain;object-position:left center;flex:0 0 auto}.v2-logo-text{font-size:22px;font-weight:950;color:#1577b8}.v2-flight-stack{display:flex;flex-direction:column;align-items:flex-start;gap:7px;min-width:0}.v2-flight{font-size:31px;font-weight:950;color:#102b63;white-space:nowrap;line-height:1}
.v2-status{display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;font-size:12px;font-weight:950;line-height:1;white-space:nowrap;background:#eaf0f6;color:#596d86}.v2-status.programme{background:#e7f2ff;color:#086bc1}.v2-status.retarde{background:#fee8ec;color:#d91f34}.v2-status.embarquement{background:#fff0c8;color:#8b6200}.v2-status.decolle{background:#e1f6eb;color:#087443}.v2-status.arrive{background:#e1f6eb;color:#087443}.v2-status.annule{background:#f1f1f3;color:#666d77}.v2-status.aconfirmer{background:#fff3df;color:#b15d00}
.v2-actions{display:flex;gap:9px}.v2-btn{width:46px;height:46px;border:1px solid #dce5ef;border-radius:16px;background:#fff;color:#7185a0;font-size:27px;display:grid;place-items:center;padding:0}.v2-btn.open{background:#edf6ff;color:#0874d1;border-color:#edf6ff;font-size:34px;font-weight:900}
.v2-route-line{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;white-space:nowrap;margin-top:16px;min-width:0}.v2-route{font-size:27px;font-weight:950;flex:0 1 auto;min-width:0}.v2-pills{display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;white-space:nowrap;margin-left:14px}.v2-pill{background:#f3f6fa;color:#607590;border-radius:999px;padding:6px 10px;font-size:14px;font-weight:900}.v2-subroute{margin-top:4px;font-size:16px;font-weight:850;color:#74859d}
.v2-times{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.v2-timebox{border-radius:20px;padding:15px 16px 16px;background:#f4f8fd}.v2-timebox.arr{background:#f0faf9}.v2-time-title{font-size:15px;font-weight:950;color:#7486a0;margin-bottom:10px}.v2-time-grid{display:grid;grid-template-columns:1fr 1fr}.v2-time-cell+.v2-time-cell{border-left:1px solid #dce5ee;padding-left:15px}.v2-time-label{font-size:12px;font-weight:900;color:#7b8ca5}.v2-time-value{font-size:30px;line-height:1.05;font-weight:950;margin-top:3px}.v2-time-value.late{color:#df2438}.v2-time-value.ok{color:#14804a}.v2-time-value.neutral{color:#078d96}
.v2-metrics{display:grid;grid-template-columns:1.45fr 1.1fr .8fr;gap:0;margin-top:17px;padding-top:15px;border-top:1px solid #e8edf3}.v2-metric{text-align:center;padding:0 9px;min-width:0}.v2-metric+.v2-metric{border-left:1px solid #e1e7ee}.v2-metric-label{font-size:11px;font-weight:950;color:#7c8ca2}.v2-metric-value{font-size:19px;font-weight:950;margin-top:5px;line-height:1.25;white-space:normal;overflow:visible}
@media(max-width:900px){.v2-route-line{width:100%;gap:8px}.v2-route{font-size:23px;flex:1 1 auto}.v2-pills{margin-left:auto;gap:6px}.v2-pill{font-size:13px;padding:5px 8px}}
@media(max-width:620px){#app .flight-home-row.v2-ready{border-radius:21px!important}#app .flight-home-row.v2-ready .v2-card{padding:15px!important}.v2-logo{width:92px;height:32px}.v2-brand{gap:9px}.v2-flight-stack{gap:6px}.v2-flight{font-size:26px}.v2-status{font-size:10px;padding:7px 10px}.v2-btn{width:40px;height:40px;border-radius:13px}.v2-route-line{gap:5px;width:100%}.v2-route{font-size:18px;flex:1 1 auto}.v2-pill{font-size:11px;padding:4px 6px}.v2-pills{gap:4px;margin-left:auto}.v2-subroute{font-size:14px}.v2-times{gap:9px;margin-top:14px}.v2-timebox{padding:12px 11px;border-radius:16px}.v2-time-title{font-size:12px}.v2-time-value{font-size:23px}.v2-time-cell+.v2-time-cell{padding-left:9px}.v2-metrics{margin-top:13px;padding-top:12px}.v2-metric{padding:0 4px}.v2-metric-label{font-size:9px}.v2-metric-value{font-size:16px}}
</style>
<script id="alyzia-v2-full-js">
(()=>{
  'use strict';
  const txt=v=>String(v??'').trim();
  const up=v=>txt(v).toUpperCase();
  const esc=s=>txt(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const hh=v=>{const m=txt(v).match(/(\d{2}:\d{2})/);return m?m[1]:''};
  const minuteOfDay=v=>{const h=hh(v);if(!h)return null;const p=h.split(':').map(Number);return p[0]*60+p[1]};
  const minuteDelta=(scheduled,actual)=>{const a=minuteOfDay(scheduled),b=minuteOfDay(actual);if(a===null||b===null)return null;let d=b-a;if(d<-720)d+=1440;if(d>720)d-=1440;return d};
  const statusClass=s=>up(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]+/g,'');
  const flightNo=v=>up(v).replace(/\s+/g,'');
  const flights=()=>{try{if(typeof FLIGHTS!=='undefined'&&Array.isArray(FLIGHTS))return FLIGHTS}catch(e){}return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]};
  const scheduleFor=x=>{try{if(typeof schedule==='function')return schedule(x)||{}}catch(e){}try{if(typeof window.schedule==='function')return window.schedule(x)||{}}catch(e){}return {}};
  const rowIndex=row=>{const src=String(row.getAttribute('onclick')||row.querySelector('.home-open')?.getAttribute('onclick')||'');const m=src.match(/openFlightFromHomeList\((\d+)\)/);return m?Number(m[1]):null};
  const getFlight=row=>{const i=rowIndex(row),list=flights();if(i!==null&&list[i])return list[i];const shown=flightNo(row.querySelector('.home-flight')?.textContent||'');return list.find(x=>flightNo(x.flight||x.flight_number)===shown)||null};
  const objText=v=>{if(v==null||v==='')return '—';if(typeof v!=='object')return txt(v);const order=['F','J','C','S','W','Y','M'],keys=Object.keys(v);return [...order.filter(k=>k in v),...keys.filter(k=>!order.includes(k))].map(k=>k+Number(v[k]??0)).join(' ')||'—'};
  const config=x=>objText(x.config||x.cabinConfig||x.capacity||x.cabin_configuration);
  const booking=x=>objText(x.booked||x.booking||x.load?.booked);
  const available=x=>{const a=x.available??x.availability??x.load?.availability;if(typeof a==='number')return String(a);if(a&&typeof a==='object')return String(Object.values(a).reduce((s,n)=>s+Number(n||0),0));return '—'};
  const normalizeStatus=x=>{const raw=up(x.opsStatus||x.status||x.flight_status||x.providerStatusRaw);if(raw.includes('CANCEL')||raw.includes('ANNUL'))return 'ANNULÉ';if(raw.includes('ARRIV'))return 'ARRIVÉ';if(raw.includes('DEPART')||raw.includes('DÉCOLL')||raw.includes('DECOLL')||raw.includes('AIRBORNE'))return 'DÉCOLLÉ';if(raw.includes('BOARD')||raw.includes('EMBAR'))return 'EMBARQUEMENT';if(raw.includes('DELAY')||raw.includes('RETARD'))return 'RETARDÉ';if(raw.includes('CONFIRM'))return 'À CONFIRMER';return 'PROGRAMMÉ'};
  const cityFromRow=row=>{const s=txt(row.querySelector('.home-sub')?.textContent);const p=s.split('·');return txt(p[p.length-1]||'')};
  const routeFromRow=row=>{const r=txt(row.querySelector('.home-route')?.textContent);const m=r.match(/([A-Z]{3})\s*→\s*([A-Z]{3})/i);return m?{origin:up(m[1]),dest:up(m[2])}:{origin:'CDG',dest:''}};
  const action=row=>({
    fav:[...row.querySelectorAll('button,[role="button"]')].find(el=>!/v2-/.test(String(el.className||''))&&/home-pin|star|fav|favorite|favori/i.test(String(el.className||'')+' '+String(el.title||'')+' '+String(el.getAttribute('aria-label')||''))),
    open:[...row.querySelectorAll('button,[role="button"]')].find(el=>!/v2-/.test(String(el.className||''))&&/home-open|open|detail|ouvrir|chevron|arrow/i.test(String(el.className||'')+' '+String(el.title||'')+' '+String(el.getAttribute('aria-label')||'')))
  });
  function render(row){
    const x=getFlight(row);if(!x)return;
    const sched=scheduleFor(x),route=routeFromRow(row),flight=flightNo(x.flight||x.flight_number||row.querySelector('.home-flight')?.textContent),airline=up(x.airline||flight.replace(/\d.*$/,''));
    const origin=up(x.origin||route.origin||'CDG'),dest=up(x.destination||x.dest||route.dest||'—'),city=up(x.destinationCity||x.destination_city||x.city||cityFromRow(row)||dest);
    const status=normalizeStatus(x),std=hh(x.std)||hh(sched.std),etd=hh(x.etd||x.edt)||hh(sched.etd),atd=hh(x.atd)||hh(sched.atd),sta=hh(x.sta)||hh(sched.sta),eta=hh(x.eta)||hh(sched.eta),ata=hh(x.ata)||hh(sched.ata);
    const gate=txt(x.gate||x.departureGate||x.departure_gate)||'—',aircraft=txt(x.aircraft||x.aircraftType||x.aircraft_type)||'—';
    const logo=[...row.querySelectorAll('img')].find(img=>!img.closest('.v2-card'))?.src||'';
    const old=action(row),star=String(old.fav?.textContent||'').includes('★')?'★':'☆';
    const sig=[flight,status,std,etd,atd,sta,eta,ata,gate,aircraft,config(x),booking(x),available(x),logo,star].join('|');
    let card=row.querySelector('.v2-card');if(card&&card.dataset.sig===sig)return;
    if(!card){card=document.createElement('div');card.className='v2-card';row.appendChild(card)}
    card.dataset.sig=sig;row.classList.add('v2-ready');
    const depLabel=atd?'ATD':'ETD',depValue=atd||etd||'—',arrLabel=ata?'ATA':'ETA',arrValue=ata||eta||'—';
    const depDelta=depValue!=='—'?minuteDelta(std,depValue):null;
    const arrDelta=arrValue!=='—'?minuteDelta(sta,arrValue):null;
    const depTone=depValue==='—'?'neutral':(depDelta!==null&&depDelta>0?'late':(atd?'ok':'neutral'));
    const arrTone=arrValue==='—'?'neutral':(arrDelta!==null&&arrDelta>1?'late':'ok');
    card.innerHTML='<div class="v2-top"><div><div class="v2-brand">'+(logo?'<img class="v2-logo" src="'+esc(logo)+'" alt="">':'<span class="v2-logo-text">'+esc(airline)+'</span>')+'<span class="v2-flight-stack"><span class="v2-flight">'+esc(flight)+'</span><span class="v2-status '+statusClass(status)+'">'+esc(status)+'</span></span></div><div class="v2-route-line"><span class="v2-route">'+esc(origin)+' → '+esc(dest)+'</span><span class="v2-pills"><span class="v2-pill">A/C '+esc(aircraft)+'</span><span class="v2-pill">GATE '+esc(gate)+'</span></span></div><div class="v2-subroute">'+esc(airline)+' · '+esc(city)+'</div></div><div class="v2-actions"><button class="v2-btn fav" type="button">'+star+'</button><button class="v2-btn open" type="button">›</button></div></div><div class="v2-times"><div class="v2-timebox"><div class="v2-time-title">✈️ DÉPART</div><div class="v2-time-grid"><div class="v2-time-cell"><div class="v2-time-label">STD</div><div class="v2-time-value">'+esc(std||'—')+'</div></div><div class="v2-time-cell"><div class="v2-time-label">'+depLabel+'</div><div class="v2-time-value '+depTone+'">'+esc(depValue)+'</div></div></div></div><div class="v2-timebox arr"><div class="v2-time-title">✈️ ARRIVÉE</div><div class="v2-time-grid"><div class="v2-time-cell"><div class="v2-time-label">STA</div><div class="v2-time-value">'+esc(sta||'—')+'</div></div><div class="v2-time-cell"><div class="v2-time-label">'+arrLabel+'</div><div class="v2-time-value '+arrTone+'">'+esc(arrValue)+'</div></div></div></div></div><div class="v2-metrics"><div class="v2-metric"><div class="v2-metric-label">CONFIG</div><div class="v2-metric-value">'+esc(config(x))+'</div></div><div class="v2-metric"><div class="v2-metric-label">BOOKING</div><div class="v2-metric-value">'+esc(booking(x))+'</div></div><div class="v2-metric"><div class="v2-metric-label">AVAILABLE</div><div class="v2-metric-value">'+esc(available(x))+'</div></div></div>';
    card.querySelector('.v2-btn.fav')?.addEventListener('click',e=>{e.stopPropagation();old.fav?.click()});
    card.querySelector('.v2-btn.open')?.addEventListener('click',e=>{e.stopPropagation();if(old.open)old.open.click();else row.click()});
    card.addEventListener('click',e=>{if(e.target.closest('button'))return;if(old.open)old.open.click();else row.click()},{once:true});
  }
  function clean(){
    document.querySelectorAll('button,[role="button"]').forEach(el=>{const t=up(el.textContent).replace(/[^A-ZÀ-ÖØ-Þ]/g,'');if(t==='IMPRIMER')el.style.setProperty('display','none','important')});
    document.querySelectorAll('body *').forEach(el=>{const t=txt(el.textContent);if(el.children.length===0&&/^V\d+(?:\.\d+)+$/i.test(t))el.style.setProperty('display','none','important')});
    const nav=document.querySelector('.mobile-bottom-nav [data-mobile-nav="home"] span');if(nav&&nav.textContent!=='✈️')nav.textContent='✈️';
    document.querySelectorAll('.flight-home-row').forEach(render);
  }
  clean();document.addEventListener('DOMContentLoaded',clean,{once:true});new MutationObserver(clean).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

function patch(html){
  const s=String(html||'');
  if(s.includes('id="alyzia-v2-full-js"')) return s;
  const i=s.lastIndexOf('</body>');
  return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html')) return response;
    const html=await response.text();
    const headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};