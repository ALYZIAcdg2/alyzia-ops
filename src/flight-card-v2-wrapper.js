import app from "./operational-state-wrapper.js";

const PATCH=String.raw`<style id="alyzia-route-meta-mobile">
@media(max-width:700px){
  .flight-home-row{
    grid-template-columns:64px minmax(0,1fr) auto auto 38px!important;
    grid-template-areas:
      "time flight flight flight actions"
      "route route aircraft gate actions"
      "config config config config actions"
      "avail avail avail avail actions"!important;
  }
  .home-route{font-size:13px!important;white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important}
  .home-aircraft,.home-gate{
    align-self:center!important;
    display:inline-flex!important;
    align-items:center!important;
    gap:3px!important;
    white-space:nowrap!important;
    font-size:10px!important;
    line-height:1!important;
    padding:0!important;
    margin:0!important;
  }
  .home-aircraft small,.home-gate small{font-size:8px!important;line-height:1!important;margin:0!important}
  .home-aircraft b,.home-gate b{font-size:10px!important;line-height:1!important;margin:0!important}
}
</style>
<script id="alyzia-header-cleanup-safe">
(()=>{
  const clean=()=>{
    document.querySelectorAll('body *').forEach(el=>{
      const text=(el.textContent||'').trim();
      if(el.children.length===0 && /^V\\d+(?:\\.\\d+)+$/i.test(text)){
        el.style.setProperty('display','none','important');
      }
    });
    document.querySelectorAll('button,[role="button"]')?.forEach(el=>{
      const text=(el.textContent||'').toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ]/g,'');
      if(text==='IMPRIMER') el.style.setProperty('display','none','important');
    });
  };
  clean();
  document.addEventListener('DOMContentLoaded',clean,{once:true});
  new MutationObserver(clean).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

function patch(html){
  let s=String(html||'');
  s=s.replace(/<script id="alyzia-hide-version-badge">[\\s\\S]*?<\\/script>/,'');
  if(s.includes('id="alyzia-route-meta-mobile"')) return s;
  const i=s.lastIndexOf('</body>');
  return i>=0?s.slice(0,i)+PATCH+'\n'+s.slice(i):s+PATCH;
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
