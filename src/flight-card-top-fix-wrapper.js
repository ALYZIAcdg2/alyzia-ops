import app from "./home-filter-ui-stability-wrapper.js";
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