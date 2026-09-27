import app from "./admin-flight-processing-wrapper.js";

const FIX=String.raw`<script id="alyzia-admin-first-tap-fix">(()=>{'use strict';
if(window.__alyziaAdminFirstTapFix)return;window.__alyziaAdminFirstTapFix=true;
const norm=s=>String(s||'').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const isAdminTarget=target=>{let el=target;for(let i=0;el&&i<7;i++,el=el.parentElement){const t=norm(el.textContent);if(t==='ADMIN'||t==='ADMINISTRATION'||t.includes('ADMIN'))return true}return false};
const pulse=()=>{const root=document.querySelector('#app')||document.body;if(!root)return;root.classList.toggle('alyzia-admin-mount-pulse');requestAnimationFrame(()=>root.classList.toggle('alyzia-admin-mount-pulse'))};
const kick=()=>{[0,60,140,280,520,900].forEach(ms=>setTimeout(pulse,ms))};
document.addEventListener('pointerup',e=>{if(isAdminTarget(e.target))kick()},true);
document.addEventListener('click',e=>{if(isAdminTarget(e.target))kick()},true);
})();</script>`;

function patch(html){
  let s=String(html||'');
  if(s.includes('id="alyzia-admin-first-tap-fix"'))return s;
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
