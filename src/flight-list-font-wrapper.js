import app from "./duration-fix-wrapper.js";

/*
 * Flight list readability override.
 * Keeps the existing compact layout while making operational values easier
 * to read on desktop, tablet and mobile.
 */
const FLIGHT_LIST_FONT_STYLE = String.raw`
<style id="alyzia-flight-list-font-css">
#app .flight-home-row .home-flight{font-size:17px!important;font-weight:950!important}
#app .flight-home-row .home-sub,
#app .flight-home-row .home-dest,
#app .flight-home-row .home-destination{font-size:14px!important;font-weight:900!important}
#app .flight-home-row>:nth-child(4){font-size:15px!important;font-weight:950!important;color:#20354c!important}
#app .flight-home-row .home-config-booking small{font-size:12px!important;font-weight:900!important}
#app .flight-home-row .home-config-booking b{font-size:15px!important;font-weight:950!important}
#app .flight-home-row .home-load b{font-size:16px!important;font-weight:950!important}
#app .home-avail{font-size:16px!important;font-weight:950!important;display:inline-flex!important;align-items:baseline!important;gap:12px!important}
#app .home-avail:before{content:none!important;display:none!important}
#app .home-avail-label{font-size:16px!important;font-weight:950!important;color:#718398!important;flex:0 0 auto!important}
#app .home-avail-value{font-size:16px!important;font-weight:950!important;flex:0 0 auto!important}
@media(max-width:680px){
  #app .flight-home-row .home-flight{font-size:18px!important}
  #app .flight-home-row .home-sub,
  #app .flight-home-row .home-dest,
  #app .flight-home-row .home-destination{font-size:15px!important}
  #app .flight-home-row>:nth-child(4){font-size:15px!important}
  #app .flight-home-row .home-config-booking small{font-size:11px!important}
  #app .flight-home-row .home-config-booking b{font-size:15px!important}
  #app .flight-home-row .home-load b{font-size:16px!important}
  #app .home-avail,
  #app .home-avail-label,
  #app .home-avail-value{font-size:16px!important}
}
</style>`;

const FLIGHT_LIST_AVAIL_SCRIPT = String.raw`
<script id="alyzia-flight-list-avail-script">
(()=>{
  const splitAvailable=()=>{
    document.querySelectorAll('#app .home-avail').forEach(element=>{
      if(element.querySelector('.home-avail-label')&&element.querySelector('.home-avail-value'))return;
      const raw=String(element.textContent||'').trim();
      if(!raw)return;
      const value=raw.replace(/^(?:AVAILABLE\s*)+/i,'').trim();
      if(!value)return;
      const label=document.createElement('span');
      label.className='home-avail-label';
      label.textContent='AVAILABLE';
      const number=document.createElement('span');
      number.className='home-avail-value';
      number.textContent=value;
      element.replaceChildren(label,number);
    });
  };

  const start=()=>{
    splitAvailable();
    const observer=new MutationObserver(splitAvailable);
    observer.observe(document.body,{childList:true,subtree:true});
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
</script>`;

export function injectFlightListFontStyle(html){
  let source=String(html||"");
  if(!source)return source;

  if(!source.includes('id="alyzia-flight-list-font-css"')){
    const headEnd=source.lastIndexOf("</head>");
    source=headEnd>=0
      ? source.slice(0,headEnd)+FLIGHT_LIST_FONT_STYLE+"\n"+source.slice(headEnd)
      : FLIGHT_LIST_FONT_STYLE+source;
  }

  if(!source.includes('id="alyzia-flight-list-avail-script"')){
    const bodyEnd=source.lastIndexOf("</body>");
    source=bodyEnd>=0
      ? source.slice(0,bodyEnd)+FLIGHT_LIST_AVAIL_SCRIPT+"\n"+source.slice(bodyEnd)
      : source+FLIGHT_LIST_AVAIL_SCRIPT;
  }

  return source;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const contentType=String(response.headers.get("content-type")||"").toLowerCase();
    if(!contentType.includes("text/html"))return response;

    const html=await response.text();
    const patched=injectFlightListFontStyle(html);
    const headers=new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control","no-store");

    return new Response(patched,{
      status:response.status,
      statusText:response.statusText,
      headers
    });
  },

  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx);
  }
};
