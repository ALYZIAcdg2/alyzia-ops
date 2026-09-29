import app from "./admin-provider-observability-detail-wrapper.js";
import providerPolicyScheduler from "./provider-policy-scheduler.js";

const STARTUP_GUARD=String.raw`<style id="alyzia-startup-today-guard-css">
html.alyzia-flights-loading #app{visibility:hidden!important}
html.alyzia-flights-loading body::after{content:"Chargement des vols du jour…";position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;padding:12px 18px;border-radius:14px;background:#fff;color:#15233a;font:800 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 30px rgba(20,35,58,.14);border:1px solid rgba(20,35,58,.08);pointer-events:none}
</style><script id="alyzia-startup-today-guard-js">(()=>{const root=document.documentElement;if(root.classList.contains('alyzia-startup-guard-ready'))return;root.classList.add('alyzia-startup-guard-ready','alyzia-flights-loading');let done=false,seenFlights=false,settleTimer=null,observer=null;const reveal=()=>{if(done)return;done=true;clearTimeout(settleTimer);try{observer?.disconnect()}catch{}root.classList.remove('alyzia-flights-loading')};const settle=()=>{if(done||!seenFlights)return;clearTimeout(settleTimer);settleTimer=setTimeout(reveal,650)};const originalFetch=window.fetch;if(typeof originalFetch==='function'){window.fetch=async function(...args){const raw=typeof args[0]==='string'?args[0]:String(args[0]?.url||'');const isFlights=/\/api\/flights(?:[/?#]|$)/i.test(raw);try{const response=await originalFetch.apply(this,args);if(isFlights&&response?.ok){seenFlights=true;settle()}return response}catch(error){throw error}}}document.addEventListener('DOMContentLoaded',()=>{const appRoot=document.getElementById('app')||document.body;observer=new MutationObserver(()=>settle());observer.observe(appRoot,{childList:true,subtree:true});setTimeout(()=>{if(!done)reveal()},6500)},{once:true})})();</script>`;

const FIX=String.raw`<style id="alyzia-card-top-v2-fix">
#app .flight-home-row{position:relative!important;padding-top:76px!important}
#app .flight-home-row .ops-top-v2{position:absolute!important;top:14px!important;left:18px!important;right:18px!important;width:auto!important;margin:0!important;z-index:5!important;grid-column:auto!important;grid-row:auto!important}
#app .flight-home-row .home-time,
#app .flight-home-row .home-flight,
#app .flight-home-row .home-flight-actions,
#app .flight-home-row .home-pin,
#app .flight-home-row .home-open{display:none!important}
#app .flight-home-row .v2-metric-value{white-space:nowrap!important;overflow:visible!important;font-size:clamp(13px,1.65vw,19px)!important;letter-spacing:-.2px!important}
@media(max-width:900px){#app .flight-home-row .v2-metric-value{font-size:clamp(12px,2.2vw,17px)!important}}
@media(max-width:620px){#app .flight-home-row{padding-top:70px!important}#app .flight-home-row .ops-top-v2{top:12px!important;left:14px!important;right:14px!important}#app .flight-home-row .v2-metric-value{font-size:clamp(11px,3.2vw,15px)!important;letter-spacing:-.35px!important}#app .flight-home-row .v2-metric{padding-left:2px!important;padding-right:2px!important}}
</style>`;

const OPS_CARD_FIX=String.raw`<script id="alyzia-active-card-ops-fix">(()=>{
  if(window.__alyziaActiveCardOpsFix)return;window.__alyziaActiveCardOpsFix=true;
  const txt=v=>String(v??'').trim(),up=v=>txt(v).toUpperCase(),flightNo=v=>up(v).replace(/\s+/g,'');
  const mins=v=>{const m=txt(v).match(/(\d{2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
  const day=d=>{const m=txt(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(+m[1],+m[2]-1,+m[3])/86400000):null};
  const delta=(a,b)=>{const x=mins(a),y=mins(b);if(x==null||y==null)return null;let d=y-x;if(d<-720)d+=1440;if(d>720)d-=1440;return d};
  const parisNow=()=>{const p=new Intl.DateTimeFormat('fr-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),o=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:o.year+'-'+o.month+'-'+o.day,minutes:+o.hour*60 + +o.minute}};
  const parseDuration=v=>{if(typeof v==='number'&&Number.isFinite(v)&&v>0)return Math.round(v);const s=txt(v);let m=s.match(/^(\d{1,2}):(\d{2})$/);if(m)return +m[1]*60 + +m[2];m=s.match(/^(\d{1,2})\s*[Hh]\s*(\d{1,2})?$/);if(m)return +m[1]*60 + +(m[2]||0);const n=Number(s);return Number.isFinite(n)&&n>0?Math.round(n):null};
  const duration=x=>{for(const v of [x.duration,x.durationMinutes,x.flightDuration,x.flight_duration,x.scheduledDuration,x.scheduled_duration]){const n=parseDuration(v);if(n!=null)return n}return null};
  const flights=()=>{try{if(typeof FLIGHTS!=='undefined'&&Array.isArray(FLIGHTS))return FLIGHTS}catch{}return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]};
  const findFlight=row=>{const f=flightNo(row.querySelector('.v2-flight')?.textContent||row.querySelector('.home-flight')?.textContent||'');if(!f)return null;return flights().find(x=>flightNo(x.flight||x.flight_number)===f)||null};
  const parts=v=>{const order=[],values={};if(v&&typeof v==='object'){for(const [k0,n0] of Object.entries(v)){const k=up(k0),n=Number(n0);if(k&&Number.isFinite(n)){if(!order.includes(k))order.push(k);values[k]=n}}return {order,values}}txt(v).replace(/\b([A-Z])\s*(\d+)\b/g,(_,k0,n0)=>{const k=up(k0);if(!order.includes(k))order.push(k);values[k]=Number(n0)});return {order,values}};
  const rawBooking=x=>x.booked||x.booking||x.load?.booked||{};
  const estimatedArrival=x=>{const fd=day(x.flight_date||x.flightDate||x.service_date_internal||x.serviceDate||x.date),std=mins(x.std),dur=duration(x);if(fd==null||std==null||dur==null)return null;const shift=delta(x.sta,x.eta);return fd*1440+std+dur+(shift||0)};
  const nowAbs=()=>{const n=parisNow(),d=day(n.date);return d==null?null:d*1440+n.minutes};
  const setBadge=(badge,label,cls)=>{if(txt(badge.textContent)!==label||!badge.classList.contains(cls)){badge.textContent=label;badge.className='v2-status '+cls}};
  const run=()=>{for(const row of document.querySelectorAll('.flight-home-row')){const x=findFlight(row),card=row.querySelector('.v2-card');if(!x||!card)continue;
    const metrics=[...card.querySelectorAll('.v2-metric')],metric=name=>metrics.find(m=>up(m.querySelector('.v2-metric-label')?.textContent)===name),cfgM=metric('CONFIG'),bookM=metric('BOOKING'),availM=metric('AVAILABLE');
    const cfg=parts(cfgM?.querySelector('.v2-metric-value')?.textContent||x.config||x.cabinConfig||x.capacity||x.cabin_configuration),b=parts(rawBooking(x)),airline=up(x.airline||flightNo(x.flight||'').replace(/\d.*$/,''));if(airline==='HF'&&b.values.M!=null&&b.values.Y==null)b.values.Y=b.values.M;
    if(cfg.order.length&&bookM){const text=cfg.order.map(k=>k+Number(b.values[k]||0)).join(' '),el=bookM.querySelector('.v2-metric-value');if(el&&el.textContent!==text)el.textContent=text}
    if(cfg.order.length&&availM){const cap=cfg.order.reduce((s,k)=>s+Number(cfg.values[k]||0),0),booked=cfg.order.reduce((s,k)=>s+Number(b.values[k]||0),0),el=availM.querySelector('.v2-metric-value');if(el&&(!txt(el.textContent)||txt(el.textContent)==='—'||txt(el.textContent)==='-')&&booked===0&&cap>0)el.textContent=String(cap)}
    const badge=card.querySelector('.v2-status');if(!badge)continue;const raw=up(x.opsStatus||x.status||x.flight_status||x.providerStatusRaw),atd=txt(x.atd||x.actualDeparture||x.actual_departure),ata=txt(x.ata||x.actualArrival||x.actual_arrival);if(/CANCEL|ANNUL/.test(raw))continue;if(ata||/ARRIV|LANDED|COMPLETED/.test(raw)){setBadge(badge,'ARRIVÉ','arrive');continue}if(atd){const est=estimatedArrival(x),now=nowAbs();if(est!=null&&now!=null&&now>=est+15){setBadge(badge,'ARRIVÉ','arrive');continue}if(est!=null&&now!=null&&est>now){const left=est-now,h=Math.floor(left/60),m=left%60;setBadge(badge,'EN VOL · RESTE '+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'),'envol')}else setBadge(badge,'EN VOL','envol')}}};
  const start=()=>{setTimeout(run,700);setInterval(run,10000)};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
})();</script>`;

function patch(html){
  let s=String(html||'');
  if(!s.includes('id="alyzia-startup-today-guard-css"')){const h=s.indexOf('<head>');s=h>=0?s.slice(0,h+6)+STARTUP_GUARD+s.slice(h+6):STARTUP_GUARD+s}
  if(!s.includes('id="alyzia-card-top-v2-fix"')){const i=s.lastIndexOf('</body>');s=i>=0?s.slice(0,i)+FIX+'\n'+s.slice(i):s+FIX}
  if(!s.includes('id="alyzia-active-card-ops-fix"')){const i=s.lastIndexOf('</body>');s=i>=0?s.slice(0,i)+OPS_CARD_FIX+'\n'+s.slice(i):s+OPS_CARD_FIX}
  return s;
}

export default {
  async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},
  scheduled(controller,env,ctx){if(typeof providerPolicyScheduler.scheduled==='function')return providerPolicyScheduler.scheduled(controller,env,ctx);if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};