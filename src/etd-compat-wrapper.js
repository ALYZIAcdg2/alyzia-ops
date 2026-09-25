import app from "./ops-enrichment-wrapper.js";

const COMPAT=String.raw`
<script id="alyzia-etd-compat-js">
(()=>{
  'use strict';
  function sync(){
    try{
      if(!Array.isArray(FLIGHTS))return;
      for(const x of FLIGHTS){
        if(!x||typeof x!=='object')continue;
        const live=String(x.etd||'').trim();
        const legacy=String(x.edt||'').trim();
        if(live && live!==legacy)x.edt=live;
      }
    }catch(_){}
  }
  sync();
  setInterval(sync,2000);
  document.addEventListener('click',sync,true);
  new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

function patch(html){
  let source=String(html||'');
  if(!source.includes('id="alyzia-etd-compat-js"')){
    const end=source.lastIndexOf('</body>');
    source=end>=0?source.slice(0,end)+COMPAT+'\n'+source.slice(end):source+COMPAT;
  }
  return source;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const contentType=String(response.headers.get('content-type')||'').toLowerCase();
    if(!contentType.includes('text/html'))return response;
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
