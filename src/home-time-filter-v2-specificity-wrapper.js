import app from "./detail-sync-stability-wrapper.js";

const FIX=String.raw`<style id="alyzia-time-filter-v2-specificity">
#app .flight-home-row.v2-ready.alyzia-final-time-hidden{display:none!important}
</style>`;

function patch(html){
  let s=String(html||'');
  if(s.includes('id="alyzia-time-filter-v2-specificity"'))return s;
  const i=s.lastIndexOf('</body>');
  return i>=0?s.slice(0,i)+FIX+'\n'+s.slice(i):s+FIX;
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
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
