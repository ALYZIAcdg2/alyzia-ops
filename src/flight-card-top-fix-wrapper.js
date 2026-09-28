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
@media(max-width:900px){
  #app .flight-home-row .v2-metric-value{font-size:clamp(12px,2.2vw,17px)!important}
}
@media(max-width:620px){
  #app .flight-home-row{padding-top:70px!important}
  #app .flight-home-row .ops-top-v2{top:12px!important;left:14px!important;right:14px!important}
  #app .flight-home-row .v2-metric-value{font-size:clamp(11px,3.2vw,15px)!important;letter-spacing:-.35px!important}
  #app .flight-home-row .v2-metric{padding-left:2px!important;padding-right:2px!important}
}
</style>`;

const OPS_UI_FIX=String.raw`<script id="alyzia-envol-hf-class-fix">(()=>{
  if(window.__alyziaEnVolHfClassFix)return;window.__alyziaEnVolHfClassFix=true;
  const txt=v=>String(v??'').trim();
  const up=v=>txt(v).toUpperCase();
  const flights=()=>{try{if(typeof FLIGHTS!=='undefined'&&Array.isArray(FLIGHTS))return FLIGHTS}catch(e){}return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]};
  const rowIndex=row=>{const src=String(row.getAttribute('onclick')||row.querySelector('.home-open')?.getAttribute('onclick')||'');const m=src.match(/openFlightFromHomeList\((\d+)\)/);return m?Number(m[1]):null};
  const flightNo=v=>up(v).replace(/\s+/g,'');
  const getFlight=row=>{const list=flights(),i=rowIndex(row);if(i!==null&&list[i])return list[i];const shown=flightNo(row.querySelector('.home-flight')?.textContent||row.querySelector('.v2-flight')?.textContent||'');return list.find(x=>flightNo(x.flight||x.flight_number)===shown)||null};
  const hh=v=>{const m=txt(v).match(/(\d{2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
  const parisNowMinutes=()=>{const p=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return Number(o.hour)*60+Number(o.minute)};
  const elapsedFrom=atd=>{const t=hh(atd);if(t===null)return null;let d=parisNowMinutes()-t;if(d< -720)d+=1440;if(d>720)d-=1440;return d};
  const isHFScope=(el)=>{const scope=el?.closest?.('[data-airline],.flight-home-row,.flight-card,.flight-detail,.modal,.sheet,.cabin-config,.seatmap')||el?.parentElement;const airline=up(scope?.getAttribute?.('data-airline'));if(airline==='HF')return true;return /(^|\s)HF(?:\d|\s|$)/i.test(String(scope?.textContent||''));};
  const patchHFLeaf=(el)=>{if(!el||el.nodeType!==1||el.children.length)return;const raw=txt(el.textContent);if(!raw||!isHFScope(el))return;if(raw==='M'){el.textContent='Y';return;}if(/\dM\b/.test(raw)&&!/[a-z]/.test(raw)){el.textContent=raw.replace(/(\d+)M\b/g,'$1Y');}};
  const patchHF=root=>{if(!root)return;if(root.nodeType===1)patchHFLeaf(root);root.querySelectorAll?.('*').forEach(patchHFLeaf)};
  const patchEnVol=()=>{document.querySelectorAll('.flight-home-row').forEach(row=>{const x=getFlight(row);const badge=row.querySelector('.v2-status');if(!x||!badge)return;const atd=txt(x.atd||x.actualDeparture||x.actual_departure),ata=txt(x.ata||x.actualArrival||x.actual_arrival),elapsed=elapsedFrom(atd);const shouldEnVol=!!atd&&!ata&&elapsed!==null&&elapsed>=5&&elapsed<720;if(shouldEnVol){if(!badge.dataset.preEnVol)badge.dataset.preEnVol=txt(badge.textContent);if(txt(badge.textContent)!=='EN VOL')badge.textContent='EN VOL';badge.classList.add('envol')}else if(badge.dataset.preEnVol){const previous=badge.dataset.preEnVol;delete badge.dataset.preEnVol;badge.classList.remove('envol');if(txt(badge.textContent)==='EN VOL')badge.textContent=previous}})};
  const patch=root=>{patchHF(root);patchEnVol()};
  const start=()=>{const root=document.getElementById('app')||document.body;patch(root);new MutationObserver(ms=>{for(const m of ms){for(const n of m.addedNodes){if(n.nodeType===1)patchHF(n)}}patchEnVol()}).observe(root,{childList:true,subtree:true});setInterval(patchEnVol,30000)};
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
})();</script>`;

function patch(html){
  let s=String(html||'');
  if(!s.includes('id="alyzia-startup-today-guard-css"')){
    const headOpen=s.indexOf('<head>');
    s=headOpen>=0?s.slice(0,headOpen+6)+STARTUP_GUARD+s.slice(headOpen+6):STARTUP_GUARD+s;
  }
  if(!s.includes('id="alyzia-card-top-v2-fix"')){
    const i=s.lastIndexOf('</body>');
    s=i>=0?s.slice(0,i)+FIX+'\n'+s.slice(i):s+FIX;
  }
  if(!s.includes('id="alyzia-envol-hf-class-fix"')){
    const i=s.lastIndexOf('</body>');
    s=i>=0?s.slice(0,i)+OPS_UI_FIX+'\n'+s.slice(i):s+OPS_UI_FIX;
  }
  return s;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html')) return response;
    const html=await response.text();
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof providerPolicyScheduler.scheduled==='function') return providerPolicyScheduler.scheduled(controller,env,ctx);
    if(typeof app.scheduled==='function') return app.scheduled(controller,env,ctx);
  }
};