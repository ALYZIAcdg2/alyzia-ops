import app from "./operational-state-wrapper.js";

const PATCH=String.raw`<script id="alyzia-hide-version-badge">
(()=>{
  const hideVersion=()=>{
    document.querySelectorAll('body *').forEach(el=>{
      if(el.children.length===0 && /^V\d+(?:\.\d+)+$/i.test((el.textContent||'').trim())){
        el.style.setProperty('display','none','important');
      }
    });
  };
  hideVersion();
  document.addEventListener('DOMContentLoaded',hideVersion,{once:true});
  new MutationObserver(hideVersion).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

function patch(html){
  const s=String(html||'');
  if(s.includes('id="alyzia-hide-version-badge"')) return s;
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
