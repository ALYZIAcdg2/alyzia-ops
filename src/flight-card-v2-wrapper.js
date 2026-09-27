import app from "./operational-state-wrapper.js";

const PATCH=String.raw`<script id="alyzia-header-cleanup-safe">
(()=>{
  const clean=()=>{
    document.querySelectorAll('body *').forEach(el=>{
      const text=(el.textContent||'').trim();
      if(el.children.length===0 && /^V\d+(?:\.\d+)+$/i.test(text)){
        el.style.setProperty('display','none','important');
      }
    });
    document.querySelectorAll('button,[role="button"]')?.forEach(el=>{
      const text=(el.textContent||'').toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ]/g,'');
      if(text==='IMPRIMER') el.style.setProperty('display','none','important');
    });
    const homeIcon=document.querySelector('.mobile-bottom-nav [data-mobile-nav="home"] span');
    if(homeIcon && homeIcon.textContent!=='✈️') homeIcon.textContent='✈️';
  };
  clean();
  document.addEventListener('DOMContentLoaded',clean,{once:true});
  new MutationObserver(clean).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

function patch(html){
  let s=String(html||'');
  s=s.replace(/<script id="alyzia-hide-version-badge">[\s\S]*?<\/script>/,'');
  if(s.includes('id="alyzia-header-cleanup-safe"')) return s;
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
