import app from "./ui-stability-wrapper.js";
import providerPolicyScheduler from "./provider-policy-scheduler.js";

const FIRST_PAINT=String.raw`<style id="alyzia-first-paint-guard-css">html:not(.alyzia-ui-stability-ready) #app{visibility:hidden!important}</style>`;

function patch(html){
  const s=String(html||'');
  if(s.includes('id="alyzia-first-paint-guard-css"'))return s;
  const h=s.indexOf('<head>');
  return h>=0?s.slice(0,h+6)+FIRST_PAINT+s.slice(h+6):FIRST_PAINT+s;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text();
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof providerPolicyScheduler.scheduled==='function')return providerPolicyScheduler.scheduled(controller,env,ctx);
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
