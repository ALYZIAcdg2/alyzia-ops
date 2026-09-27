import app from "./operational-state-wrapper.js";

const UI=String.raw`
<style id="alyzia-flight-card-v2-style">
#app .flight-home-row.ops-card-v2-ready{display:block!important;position:relative!important;padding:0!important;overflow:hidden!important;border-radius:26px!important;background:#fff!important;box-shadow:0 7px 24px rgba(22,48,86,.08)!important;border:1px solid #e3eaf2!important;min-height:0!important}
#app .flight-home-row.ops-card-v2-ready>*:not(.ops-card-v2){display:none!important}
#app .flight-home-row.ops-card-v2-ready .ops-card-v2{display:block!important;position:relative!important;inset:auto!important;width:auto!important;height:auto!important;margin:0!important;padding:18px 20px 16px!important;color:#0b1d3a;font-family:inherit;cursor:pointer}
.ops-v2-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start}.ops-v2-brandline{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.ops-v2-logo{width:112px;height:38px;object-fit:contain;object-position:left center}.ops-v2-logo-text{font-size:21px;font-weight:900;color:#217db3}.ops-v2-flight{font-size:29px;font-weight:950;color:#102b63;white-space:nowrap}.ops-v2-status{font-size:12px;font-weight:950;padding:7px 11px;border-radius:999px;background:#eef3f8;color:#596d86;white-space:nowrap}.ops-v2-status.retarde{background:#feecef;color:#db2638}.ops-v2-status.embarquement{background:#fff4d9;color:#966300}.ops-v2-status.decolle{background:#e7f3ff;color:#0870c9}.ops-v2-status.arrive{background:#e7f7ef;color:#14804a}.ops-v2-status.annule{background:#f2f3f5;color:#6c7480}
.ops-v2-actions{display:flex;gap:8px}.ops-v2-action{width:43px;height:43px;border:1px solid #dfe7f0;border-radius:14px;background:#fff;color:#7185a0;font-size:24px;display:grid;place-items:center;padding:0}.ops-v2-action.open{background:#edf6ff;color:#0874d1;border-color:#edf6ff;font-size:31px;font-weight:800}.ops-v2-route{font-size:24px;font-weight:950;margin-top:10px}.ops-v2-subroute{font-size:15px;font-weight:850;color:#74859d;margin-top:2px}
.ops-v2-times{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:15px}.ops-v2-timebox{border-radius:20px;padding:13px 15px 14px;background:#f4f8fd}.ops-v2-timebox.arr{background:#f0faf9}.ops-v2-time-title{font-size:12px;font-weight:950;color:#7486a0;margin-bottom:9px}.ops-v2-time-grid{display:grid;grid-template-columns:1fr 1fr}.ops-v2-time-cell+.ops-v2-time-cell{border-left:1px solid #dce5ee;padding-left:14px}.ops-v2-time-label{font-size:11px;font-weight:900;color:#7b8ca5}.ops-v2-time-value{font-size:25px;line-height:1.05;font-weight:950;margin-top:2px}.ops-v2-time-value.estimate-dep{color:#df2438}.ops-v2-time-value.actual{color:#14804a}.ops-v2-time-value.estimate-arr{color:#078d96}
.ops-v2-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:15px;padding-top:13px;border-top:1px solid #edf1f5}.ops-v2-metric{text-align:center;padding:0 8px}.ops-v2-metric+.ops-v2-metric{border-left:1px solid #e5eaf0}.ops-v2-metric-label{font-size:10px;font-weight:900;color:#7c8ca2}.ops-v2-metric-value{font-size:19px;font-weight:950;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:620px){#app .flight-home-row.ops-card-v2-ready{border-radius:22px!important}#app .flight-home-row.ops-card-v2-ready .ops-card-v2{padding:15px 15px 13px!important}.ops-v2-logo{width:92px;height:31px}.ops-v2-flight{font-size:25px}.ops-v2-status{font-size:10px;padding:6px 9px}.ops-v2-action{width:38px;height:38px}.ops-v2-route{font-size:21px}.ops-v2-times{gap:8px;margin-top:12px}.ops-v2-timebox{padding:11px;border-radius:16px}.ops-v2-time-value{font-size:21px}.ops-v2-time-cell+.ops-v2-time-cell{padding-left:9px}.ops-v2-metrics{margin-top:12px;padding-top:11px}.ops-v2-metric{padding:0 3px}.ops-v2-metric-label{font-size:8px}.ops-v2-metric-value{font-size:15px}}
</style>
<script id="alyzia-flight-card-v2-js">
(()=>{
 'use strict';
 const t=v=>String(v??'').trim(),up=v=>t(v).toUpperCase();
 const esc=s=>t(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
 const hh=v=>{const m=t(v).match(/(\d{2}:\d{2})/);return m?m[1]:''};
 const flightNo=v=>{const m=up(v).match(/([A-Z0-9]{2,3}\s*\d{1,4}[A-Z]?)$/);return m?m[1].replace(/\s+/g,''):up(v)};
 const objText=(v,order=['F','J','C','S','W','Y','M'])=>{if(v==null||v==='')return '—';if(typeof v!=='object')return t(v);const keys=Object.keys(v);return [...order.filter(k=>k in v),...keys.filter(k=>!order.includes(k))].map(k=>k+Number(v[k]??0)).join(' ')||'—'};
 const capacity=x=>objText(x.config||x.cabinConfig||x.capacity),booked=x=>objText(x.booked||x.booking||x.load?.booked);
 const available=x=>{const a=x.available||x.availability||x.load?.availability;if(typeof a==='number')return String(a);if(a&&typeof a==='object')return String(Object.values(a).reduce((s,n)=>s+Number(n||0),0));const cfg=x.config,book=x.booked;if(cfg&&book&&typeof cfg==='object'&&typeof book==='object')return String(Object.keys(cfg).reduce((s,k)=>s+Math.max(0,Number(cfg[k]||0)-Number(book[k]||0)),0));return '—'};
 const flights=()=>{try{if(typeof FLIGHTS!=='undefined'&&Array.isArray(FLIGHTS))return FLIGHTS}catch(_){}return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]};
 const statusClass=s=>up(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]+/g,'');
 const isDeparted=s=>/(DÉCOLLÉ|DEPARTED|AIRBORNE|EN\s*ROUTE|ARRIVÉ|ARRIVED|LANDED|COMPLETED)/i.test(t(s));
 const isArrived=s=>/(ARRIVÉ|ARRIVED|LANDED|COMPLETED)/i.test(t(s));
 function oldSnapshot(row){
   const text=[...row.children].filter(el=>!el.classList?.contains('ops-card-v2')).map(el=>el.innerText||'').join('\n');
   const val=label=>{const m=text.match(new RegExp('(?:^|\\n)\\s*'+label+'\\s*(\\d{2}:\\d{2})','i'));return m?m[1]:''};
   let std='';const tm=row.querySelector('.home-time');if(tm){const m=t(tm.innerText).match(/^\s*(\d{2}:\d{2})/);if(m)std=m[1]}
   if(!std){const m=text.match(/(?:^|\n)\s*(\d{2}:\d{2})(?=\s*(?:\n|$))/);if(m)std=m[1]}
   return {text,std,etd:val('ETD'),atd:val('ATD'),sta:val('STA'),eta:val('ETA'),ata:val('ATA')};
 }
 function findFlight(row,snap){const list=flights();if(!list.length)return null;let f=flightNo(row.querySelector('.home-flight')?.textContent||'');if(!f){const m=up(snap.text).match(/\b[A-Z0-9]{2,3}\s*\d{2,4}[A-Z]?\b/);f=m?m[0].replace(/\s+/g,''):''}return list.find(x=>flightNo(x?.flight||x?.flight_number)===f)||null}
 function render(row){
   const snap=oldSnapshot(row),x=findFlight(row,snap);if(!x)return;
   const flight=flightNo(x.flight||x.flight_number),airline=up(x.airline||flight.replace(/\d.*$/,'')),origin=up(x.origin||'CDG')||'CDG',dest=up(x.destination||x.dest)||'—',city=up(x.destinationCity||x.destination_city||x.city||x.destinationName||dest);
   let status=up(x.opsStatus||x.status||'PROGRAMMÉ');
   const std=hh(x.std)||snap.std,sta=hh(x.sta)||snap.sta;
   const rawAtd=hh(x.atd)||snap.atd,rawAta=hh(x.ata)||snap.ata,etd=hh(x.etd||x.edt)||snap.etd||(!isDeparted(status)?rawAtd:''),eta=hh(x.eta)||snap.eta||(!isArrived(status)?rawAta:'');
   const depActual=isDeparted(status)?rawAtd:'',arrActual=isArrived(status)?rawAta:'';
   if(status==='PROGRAMMÉ'&&std&&etd){const [sh,sm]=std.split(':').map(Number),[eh,em]=etd.split(':').map(Number);if((eh*60+em)-(sh*60+sm)>=5)status='RETARDÉ'}
   const depLabel=depActual?'ATD':'ETD',depSecond=depActual||etd,arrLabel=arrActual?'ATA':'ETA',arrSecond=arrActual||eta;
   const imgs=[...row.querySelectorAll('img')].filter(i=>!i.closest('.ops-card-v2'));const logo=imgs.map(i=>i.src).find(Boolean)||'';
   const fav=[...row.querySelectorAll('button,[role="button"]')].find(el=>!el.closest('.ops-card-v2')&&/home-pin|star|fav|favorite|favori/i.test((el.className||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.title||'')));
   const open=[...row.querySelectorAll('button,[role="button"]')].find(el=>!el.closest('.ops-card-v2')&&/open|detail|chevron|arrow|ouvrir/i.test((el.className||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.title||'')));
   const sig=[flight,status,std,depSecond,sta,arrSecond,x.aircraft,x.gate,capacity(x),booked(x),available(x),logo].join('|');if(row.dataset.opsV2Sig===sig)return;row.dataset.opsV2Sig=sig;
   let card=row.querySelector('.ops-card-v2');if(!card){card=document.createElement('div');card.className='ops-card-v2';row.appendChild(card)}
   [...row.children].forEach(el=>{if(el!==card)el.style.setProperty('display','none','important')});row.classList.add('ops-card-v2-ready');
   const tv=v=>esc(v||'—');
   card.innerHTML='<div class="ops-v2-top"><div><div class="ops-v2-brandline">'+(logo?'<img class="ops-v2-logo" src="'+esc(logo)+'" alt="">':'<span class="ops-v2-logo-text">'+esc(airline)+'</span>')+'<span class="ops-v2-flight">'+esc(flight)+'</span><span class="ops-v2-status '+statusClass(status)+'">'+esc(status)+'</span></div><div class="ops-v2-route">'+esc(origin)+' → '+esc(dest)+'</div><div class="ops-v2-subroute">'+esc(airline)+' · '+esc(city)+'</div></div><div class="ops-v2-actions"><button class="ops-v2-action fav" type="button">☆</button><button class="ops-v2-action open" type="button">›</button></div></div><div class="ops-v2-times"><div class="ops-v2-timebox"><div class="ops-v2-time-title">✈ DÉPART</div><div class="ops-v2-time-grid"><div class="ops-v2-time-cell"><div class="ops-v2-time-label">STD</div><div class="ops-v2-time-value">'+tv(std)+'</div></div><div class="ops-v2-time-cell"><div class="ops-v2-time-label">'+depLabel+'</div><div class="ops-v2-time-value '+(depActual?'actual':'estimate-dep')+'">'+tv(depSecond)+'</div></div></div></div><div class="ops-v2-timebox arr"><div class="ops-v2-time-title">✈ ARRIVÉE</div><div class="ops-v2-time-grid"><div class="ops-v2-time-cell"><div class="ops-v2-time-label">STA</div><div class="ops-v2-time-value">'+tv(sta)+'</div></div><div class="ops-v2-time-cell"><div class="ops-v2-time-label">'+arrLabel+'</div><div class="ops-v2-time-value '+(arrActual?'actual':'estimate-arr')+'">'+tv(arrSecond)+'</div></div></div></div></div><div class="ops-v2-metrics"><div class="ops-v2-metric"><div class="ops-v2-metric-label">A/C</div><div class="ops-v2-metric-value">'+tv(x.aircraft)+'</div></div><div class="ops-v2-metric"><div class="ops-v2-metric-label">GATE</div><div class="ops-v2-metric-value">'+tv(x.gate)+'</div></div><div class="ops-v2-metric"><div class="ops-v2-metric-label">CONFIG</div><div class="ops-v2-metric-value">'+esc(capacity(x))+'</div></div><div class="ops-v2-metric"><div class="ops-v2-metric-label">BOOKING</div><div class="ops-v2-metric-value">'+esc(booked(x))+'</div></div><div class="ops-v2-metric"><div class="ops-v2-metric-label">AVAILABLE</div><div class="ops-v2-metric-value">'+esc(available(x))+'</div></div></div>';
   card.querySelector('.fav')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fav?.click()});
   card.querySelector('.open')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(open)open.click();else row.click()});
 }
 function sync(){document.querySelectorAll('#app .flight-home-row').forEach(render)}
 sync();setInterval(sync,1000);document.addEventListener('DOMContentLoaded',sync);new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;
function patch(html){const s=String(html||'');if(s.includes('id="alyzia-flight-card-v2-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx),type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}};
