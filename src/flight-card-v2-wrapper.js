import app from "./operational-state-wrapper.js";

const UI=String.raw`
<style id="alyzia-flight-card-v2-style">
#app .flight-home-row.ops-card-v2-ready{display:block!important;position:relative!important;padding:0!important;overflow:hidden!important;border-radius:24px!important;background:#fff!important;box-shadow:0 7px 24px rgba(22,48,86,.08)!important;border:1px solid #e3eaf2!important;min-height:0!important}
#app .flight-home-row.ops-card-v2-ready>*:not(.ops-card-v2){display:none!important}
#app .flight-home-row.ops-card-v2-ready .ops-card-v2{display:block!important;position:relative!important;width:auto!important;height:auto!important;margin:0!important;padding:17px 18px 15px!important;color:#0b1d3a;font-family:inherit;cursor:pointer}
.ops-v2-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start}.ops-v2-brandline{display:flex;align-items:center;gap:11px;flex-wrap:wrap}.ops-v2-logo{width:105px;height:36px;object-fit:contain;object-position:left center}.ops-v2-logo-text{font-size:21px;font-weight:900;color:#217db3}.ops-v2-flight{font-size:28px;font-weight:950;color:#102b63;white-space:nowrap}
.ops-v2-status{font-size:11px;font-weight:950;padding:7px 11px;border-radius:999px;white-space:nowrap;background:#eaf0f6;color:#596d86}.ops-v2-status.programme{background:#eaf0f6;color:#596d86}.ops-v2-status.retarde{background:#fee8ec;color:#d91f34}.ops-v2-status.embarquement{background:#fff0c8;color:#8b6200}.ops-v2-status.decolle{background:#e1f0ff;color:#0870c9}.ops-v2-status.arrive{background:#e1f6eb;color:#087443}.ops-v2-status.annule{background:#f1f1f3;color:#666d77}.ops-v2-status.aconfirmer{background:#fff3df;color:#b15d00}
.ops-v2-actions{display:flex;gap:8px}.ops-v2-action{width:42px;height:42px;border:1px solid #dfe7f0;border-radius:14px;background:#fff;color:#7185a0;font-size:24px;display:grid;place-items:center;padding:0}.ops-v2-action.open{background:#edf6ff;color:#0874d1;border-color:#edf6ff;font-size:31px;font-weight:800}
.ops-v2-route-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:11px}.ops-v2-route{font-size:23px;font-weight:950}.ops-v2-inline-meta{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:900;color:#607590}.ops-v2-inline-pill{background:#f3f6fa;border-radius:999px;padding:5px 9px;line-height:1.15}.ops-v2-subroute{font-size:14px;font-weight:850;color:#74859d;margin-top:2px}
.ops-v2-times{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.ops-v2-timebox{border-radius:18px;padding:12px 14px 13px;background:#f4f8fd}.ops-v2-timebox.arr{background:#f0faf9}.ops-v2-time-title{font-size:11px;font-weight:950;color:#7486a0;margin-bottom:8px}.ops-v2-time-grid{display:grid;grid-template-columns:1fr 1fr}.ops-v2-time-cell+.ops-v2-time-cell{border-left:1px solid #dce5ee;padding-left:12px}.ops-v2-time-label{font-size:10px;font-weight:900;color:#7b8ca5}.ops-v2-time-value{font-size:24px;line-height:1.05;font-weight:950;margin-top:2px}.ops-v2-time-value.estimate-dep{color:#df2438}.ops-v2-time-value.actual{color:#14804a}.ops-v2-time-value.estimate-arr{color:#078d96}
.ops-v2-metrics{display:grid;grid-template-columns:1.4fr 1.4fr .8fr;gap:8px;margin-top:13px;padding-top:12px;border-top:1px solid #edf1f5}.ops-v2-metric{text-align:center;padding:0 5px;min-width:0}.ops-v2-metric+.ops-v2-metric{border-left:1px solid #e5eaf0}.ops-v2-metric-label{font-size:9px;font-weight:900;color:#7c8ca2}.ops-v2-metric-value{font-size:16px;font-weight:950;margin-top:3px;white-space:normal;overflow:visible;line-height:1.2}
#app .ops-v2-hidden-exact{display:none!important}
#app .ops-v2-date-strong{font-size:17px!important;font-weight:950!important}
#app .ops-v2-daynav-strong{font-size:15px!important;font-weight:900!important}
#app .ops-v2-terminal-strong{font-size:15px!important;font-weight:950!important;min-height:42px!important;padding-left:16px!important;padding-right:16px!important}
#app .ops-v2-filter-row{display:flex!important;align-items:center!important;gap:9px!important;flex-wrap:wrap!important}
#app .ops-v2-count-inline{font-size:14px!important;font-weight:950!important;min-height:40px!important;padding:0 12px!important;border-radius:999px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}
.ops-v2-nav-plane{font-size:23px;line-height:1;display:block;margin-bottom:2px}
@media(max-width:620px){#app .flight-home-row.ops-card-v2-ready{border-radius:21px!important}#app .flight-home-row.ops-card-v2-ready .ops-card-v2{padding:14px 14px 12px!important}.ops-v2-logo{width:90px;height:31px}.ops-v2-flight{font-size:24px}.ops-v2-status{font-size:10px;padding:6px 9px}.ops-v2-action{width:38px;height:38px}.ops-v2-route{font-size:20px}.ops-v2-inline-meta{font-size:11px}.ops-v2-inline-pill{padding:4px 7px}.ops-v2-times{gap:8px;margin-top:11px}.ops-v2-timebox{padding:10px;border-radius:15px}.ops-v2-time-value{font-size:20px}.ops-v2-time-cell+.ops-v2-time-cell{padding-left:8px}.ops-v2-metrics{margin-top:11px;padding-top:10px;gap:4px}.ops-v2-metric{padding:0 2px}.ops-v2-metric-label{font-size:8px}.ops-v2-metric-value{font-size:14px}#app .ops-v2-date-strong{font-size:16px!important}#app .ops-v2-daynav-strong{font-size:14px!important}#app .ops-v2-terminal-strong{font-size:14px!important;min-height:40px!important;padding-left:14px!important;padding-right:14px!important}}
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
 const departed=s=>/(DÉCOLLÉ|DEPARTED|AIRBORNE|EN\s*ROUTE|ARRIVÉ|ARRIVED|LANDED|COMPLETED)/i.test(t(s));
 const arrived=s=>/(ARRIVÉ|ARRIVED|LANDED|COMPLETED)/i.test(t(s));
 const cancelled=s=>/(ANNUL|CANCEL)/i.test(t(s)),boarding=s=>/(BOARD|EMBARQU|FINAL\s*CALL|GATE\s*CLOSED)/i.test(t(s)),delayed=s=>/(DELAY|RETARD|LATE)/i.test(t(s));
 function minutes(v){const h=hh(v);if(!h)return null;const [a,b]=h.split(':').map(Number);return a*60+b}
 function nowParisMinutes(){const p=new Intl.DateTimeFormat('fr-CA',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),m=Object.fromEntries(p.map(z=>[z.type,z.value]));return Number(m.hour)*60+Number(m.minute)}
 function oldSnapshot(row){
   const text=[...row.children].filter(el=>!el.classList?.contains('ops-card-v2')).map(el=>el.textContent||'').join('\n');
   const val=label=>{const m=text.match(new RegExp('(?:^|\\n|\\s)'+label+'\\s*(\\d{2}:\\d{2})','i'));return m?m[1]:''};
   let std='';const tm=row.querySelector('.home-time');if(tm){const m=t(tm.textContent).match(/(\d{2}:\d{2})/);if(m)std=m[1]}
   if(!std){const m=text.match(/(?:^|\n)\s*(\d{2}:\d{2})/);if(m)std=m[1]}
   return {text,std,etd:val('ETD'),atd:val('ATD'),sta:val('STA'),eta:val('ETA'),ata:val('ATA'),gate:(text.match(/GATE\s*([A-Z0-9-]+)/i)||[])[1]||''};
 }
 function findFlight(row,snap){const list=flights();if(!list.length)return null;let f=flightNo(row.querySelector('.home-flight')?.textContent||'');if(!f){const m=up(snap.text).match(/\b[A-Z0-9]{2,3}\s*\d{2,4}[A-Z]?\b/);f=m?m[0].replace(/\s+/g,''):''}return list.find(x=>flightNo(x?.flight||x?.flight_number)===f)||null}
 function normalizeStatus(x,std,etd){const raw=t(x.providerStatusRaw||x.rawStatus||x.flightStatusRaw||x.opsStatus||x.status);if(cancelled(raw))return 'ANNULÉ';if(hh(x.ata)||arrived(raw))return 'ARRIVÉ';if(hh(x.atd)&&departed(raw))return 'DÉCOLLÉ';if(departed(raw))return 'DÉCOLLÉ';if(boarding(raw))return 'EMBARQUEMENT';if(delayed(raw))return 'RETARDÉ';const s=minutes(std),e=minutes(etd);if(s!=null&&e!=null&&e-s>=5)return 'RETARDÉ';if(s!=null&&nowParisMinutes()>s+15)return 'À CONFIRMER';return 'PROGRAMMÉ'}
 function scrollFlightTop(){const run=()=>{try{window.scrollTo(0,0);document.documentElement.scrollTop=0;document.body.scrollTop=0;document.querySelectorAll('#app,.app,.page,.content,.main,main').forEach(el=>{if(el.scrollTop>0)el.scrollTop=0})}catch(_){}};run();setTimeout(run,60);setTimeout(run,220)}
 function render(row){
   const snap=oldSnapshot(row),x=findFlight(row,snap);if(!x)return;
   const flight=flightNo(x.flight||x.flight_number),airline=up(x.airline||flight.replace(/\d.*$/,'')),origin=up(x.origin||'CDG')||'CDG',dest=up(x.destination||x.dest)||'—',city=up(x.destinationCity||x.destination_city||x.city||x.destinationName||dest);
   const std=hh(x.std)||snap.std,sta=hh(x.sta)||snap.sta,rawAtd=hh(x.atd)||snap.atd,rawAta=hh(x.ata)||snap.ata,baseEtd=hh(x.etd||x.edt)||snap.etd,baseEta=hh(x.eta)||snap.eta;
   const status=normalizeStatus(x,std,baseEtd||rawAtd),depActual=departed(status)?rawAtd:'',arrActual=arrived(status)?rawAta:'',etd=baseEtd||(!depActual?rawAtd:''),eta=baseEta||(!arrActual?rawAta:'');
   const depLabel=depActual?'ATD':'ETD',depSecond=depActual||etd,arrLabel=arrActual?'ATA':'ETA',arrSecond=arrActual||eta,gate=t(x.gate)||snap.gate||'—';
   const imgs=[...row.querySelectorAll('img')].filter(i=>!i.closest('.ops-card-v2')),logo=imgs.map(i=>i.src).find(Boolean)||'';
   const fav=[...row.querySelectorAll('button,[role="button"]')].find(el=>!el.closest('.ops-card-v2')&&/home-pin|star|fav|favorite|favori/i.test((el.className||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.title||'')));
   const open=[...row.querySelectorAll('button,[role="button"]')].find(el=>!el.closest('.ops-card-v2')&&/open|detail|chevron|arrow|ouvrir/i.test((el.className||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.title||'')));
   const sig=[flight,status,std,depSecond,sta,arrSecond,x.aircraft,gate,capacity(x),booked(x),available(x),logo].join('|');if(row.dataset.opsV2Sig===sig)return;row.dataset.opsV2Sig=sig;
   let card=row.querySelector('.ops-card-v2');if(!card){card=document.createElement('div');card.className='ops-card-v2';row.appendChild(card)}
   [...row.children].forEach(el=>{if(el!==card)el.style.setProperty('display','none','important')});row.classList.add('ops-card-v2-ready');
   const tv=v=>esc(v||'—');
   card.innerHTML='<div class="ops-v2-top"><div><div class="ops-v2-brandline">'+(logo?'<img class="ops-v2-logo" src="'+esc(logo)+'" alt="">':'<span class="ops-v2-logo-text">'+esc(airline)+'</span>')+'<span class="ops-v2-flight">'+esc(flight)+'</span><span class="ops-v2-status '+statusClass(status)+'">'+esc(status)+'</span></div><div class="ops-v2-route-line"><span class="ops-v2-route">'+esc(origin)+' → '+esc(dest)+'</span><span class="ops-v2-inline-meta"><span class="ops-v2-inline-pill">A/C '+tv(x.aircraft)+'</span><span class="ops-v2-inline-pill">GATE '+tv(gate)+'</span></span></div><div class="ops-v2-subroute">'+esc(airline)+' · '+esc(city)+'</div></div><div class="ops-v2-actions"><button class="ops-v2-action fav" type="button">☆</button><button class="ops-v2-action open" type="button">›</button></div></div><div class="ops-v2-times"><div class="ops-v2-timebox"><div class="ops-v2-time-title">✈ DÉPART</div><div class="ops-v2-time-grid"><div class="ops-v2-time-cell"><div class="ops-v2-time-label">STD</div><div class="ops-v2-time-value">'+tv(std)+'</div></div><div class="ops-v2-time-cell"><div class="ops-v2-time-label">'+depLabel+'</div><div class="ops-v2-time-value '+(depActual?'actual':'estimate-dep')+'">'+tv(depSecond)+'</div></div></div></div><div class="ops-v2-timebox arr"><div class="ops-v2-time-title">✈ ARRIVÉE</div><div class="ops-v2-time-grid"><div class="ops-v2-time-cell"><div class="ops-v2-time-label">STA</div><div class="ops-v2-time-value">'+tv(sta)+'</div></div><div class="ops-v2-time-cell"><div class="ops-v2-time-label">'+arrLabel+'</div><div class="ops-v2-time-value '+(arrActual?'actual':'estimate-arr')+'">'+tv(arrSecond)+'</div></div></div></div></div><div class="ops-v2-metrics"><div class="ops-v2-metric"><div class="ops-v2-metric-label">CONFIG</div><div class="ops-v2-metric-value">'+esc(capacity(x))+'</div></div><div class="ops-v2-metric"><div class="ops-v2-metric-label">BOOKING</div><div class="ops-v2-metric-value">'+esc(booked(x))+'</div></div><div class="ops-v2-metric"><div class="ops-v2-metric-label">AVAILABLE</div><div class="ops-v2-metric-value">'+esc(available(x))+'</div></div></div>';
   card.querySelector('.fav')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fav?.click()});
   card.querySelector('.open')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(open)open.click();else row.click();scrollFlightTop()});
 }
 function exactTextElements(){return [...document.querySelectorAll('#app *')].filter(el=>el.children.length===0&&t(el.textContent))}
 function tuneHeader(){
   for(const el of exactTextElements()){
     const s=t(el.textContent),u=up(s);
     if(/^V\d+(?:\.\d+)+$/i.test(s)){el.classList.add('ops-v2-hidden-exact');continue}
     if(u==='VOLS AU DÉPART CDG'||u==='SELECTIONNEZ UN VOL POUR OUVRIR LA FICHE OPERATIONNELLE'||u==='SÉLECTIONNEZ UN VOL POUR OUVRIR LA FICHE OPÉRATIONNELLE'){el.classList.add('ops-v2-hidden-exact');continue}
     if(/^IMPRIMER$/i.test(s)){const b=el.closest('button,[role="button"]')||el;b.classList.add('ops-v2-hidden-exact');continue}
     if(/^J[+-]?1$/i.test(s)||s==='J-1'||s==='J+1')el.classList.add('ops-v2-daynav-strong');
     if(/^(LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE)\s+\d{1,2}\s+[A-ZÉÈÊÀÙÎÔÛÇ]+\s+20\d{2}$/i.test(u))el.classList.add('ops-v2-date-strong');
     if(/^(T1|T2|T3|ALL)$/i.test(s)){const b=el.closest('button,[role="button"]')||el;b.classList.add('ops-v2-terminal-strong');const p=b.parentElement;if(p)p.classList.add('ops-v2-filter-row')}
   }
   const count=[...document.querySelectorAll('#app *')].find(el=>el.children.length===0&&/^\d+\s+VOLS?$/i.test(t(el.textContent)));
   const allLeaf=[...document.querySelectorAll('#app *')].find(el=>el.children.length===0&&/^ALL$/i.test(t(el.textContent)));
   if(count&&allLeaf){const all=allLeaf.closest('button,[role="button"]')||allLeaf,p=all.parentElement;if(p){p.classList.add('ops-v2-filter-row');const countBox=count.closest('button,[role="button"],div')||count;countBox.classList.add('ops-v2-count-inline');if(countBox.parentElement!==p)p.appendChild(countBox)}}
   const navs=[...document.querySelectorAll('#app nav button,#app .bottom-nav button,#app [role="navigation"] button')];
   const vols=navs.find(b=>/\bVOLS\b/i.test(t(b.textContent)));if(vols&&!vols.querySelector('.ops-v2-nav-plane')){const icon=vols.querySelector('svg,.icon,[class*="icon"],span:not(:last-child)');if(icon)icon.style.display='none';const plane=document.createElement('span');plane.className='ops-v2-nav-plane';plane.textContent='✈️';vols.prepend(plane)}
 }
 function sync(){document.querySelectorAll('#app .flight-home-row').forEach(render);tuneHeader()}
 sync();setInterval(sync,1000);document.addEventListener('DOMContentLoaded',sync);new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;
function patch(html){const s=String(html||'');if(s.includes('id="alyzia-flight-card-v2-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx),type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}};
