import app from "./home-filter-count-sync-wrapper.js";

const FIX=String.raw`<style id="alyzia-home-filter-ui-stability">
#app .alyzia-time-filter-btn:not(.active){font-size:0!important;min-width:96px!important}
#app .alyzia-time-filter-btn:not(.active)::after{content:"◷ HORAIRES";font:900 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#28425f;white-space:nowrap}
@media(max-width:620px){#app .alyzia-time-filter-btn:not(.active){min-width:88px!important}#app .alyzia-time-filter-btn:not(.active)::after{font-size:11px}}
</style>`;

function patch(html){
  let s=String(html||'');
  if(s.includes('id="alyzia-home-filter-ui-stability"'))return s;
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
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
