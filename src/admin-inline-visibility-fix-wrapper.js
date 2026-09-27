import app from "./admin-flight-processing-click-fix-wrapper.js";

const FIX=String.raw`<style id="alyzia-admin-inline-visibility-fix-css">
#alyzia-admin-processing-fix.alyzia-force-hidden{display:none!important}
</style><script id="alyzia-admin-inline-visibility-fix-js">(()=>{'use strict';
const norm=v=>String(v||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
function navName(el){const s=norm(el?.textContent);if(!s)return '';if(/(^|\s)ADMIN(?:ISTRATION)?(\s|$)/.test(s))return 'ADMIN';if(/(^|\s)VOLS?(\s|$)/.test(s))return 'VOLS';if(/(^|\s)PREPA(\s|$)/.test(s))return 'PREPA';if(/(^|\s)OUTILS?(\s|$)/.test(s))return 'OUTILS';if(/(^|\s)(ACCUEIL|HOME)(\s|$)/.test(s))return 'ACCUEIL';return ''}
function activeTab(){
  const active=[...document.querySelectorAll('#app .active,#app [aria-selected="true"],#app [aria-current="page"],body .active,body [aria-selected="true"],body [aria-current="page"]')];
  for(const el of active){const n=navName(el);if(n)return n}
  return '';
}
function sync(){
  const box=document.getElementById('alyzia-admin-processing-fix');
  if(!box)return;
  const tab=activeTab();
  const show=tab==='ADMIN';
  box.classList.toggle('alyzia-force-hidden',!show);
  if(!show)box.classList.remove('show');
}
document.addEventListener('click',()=>setTimeout(sync,0),true);
document.addEventListener('pointerup',()=>setTimeout(sync,0),true);
const obs=new MutationObserver(sync);obs.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-selected','aria-current']});
setInterval(sync,350);setTimeout(sync,100);
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-admin-inline-visibility-fix-css"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+FIX+'\n'+s.slice(i):s+FIX}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
