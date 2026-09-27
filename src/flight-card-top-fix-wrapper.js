import app from "./flight-card-v2-wrapper.js";

const FIX=String.raw`<style id="alyzia-card-top-v2-fix">
#app .flight-home-row{position:relative!important;padding-top:76px!important}
#app .flight-home-row .ops-top-v2{position:absolute!important;top:14px!important;left:18px!important;right:18px!important;width:auto!important;margin:0!important;z-index:5!important;grid-column:auto!important;grid-row:auto!important}
#app .flight-home-row .home-time,
#app .flight-home-row .home-flight,
#app .flight-home-row .home-flight-actions,
#app .flight-home-row .home-pin,
#app .flight-home-row .home-open{display:none!important}
@media(max-width:620px){
  #app .flight-home-row{padding-top:70px!important}
  #app .flight-home-row .ops-top-v2{top:12px!important;left:14px!important;right:14px!important}
}
</style>`;

function patch(html){
  let s=String(html||'');
  if(s.includes('id="alyzia-card-top-v2-fix"')) return s;
  const i=s.lastIndexOf('</body>');
  return i>=0?s.slice(0,i)+FIX+'\n'+s.slice(i):s+FIX;
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
    if(typeof app.scheduled==='function') return app.scheduled(controller,env,ctx);
  }
};
