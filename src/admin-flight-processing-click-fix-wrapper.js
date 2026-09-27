import app from "./admin-flight-processing-fix-wrapper.js";

const OLD=String.raw`function openAdmin(){adminMode=true;render();load()}
function closeAdmin(){adminMode=false;render()}
document.addEventListener('click',e=>{const s=textOf(e.target);if(isAdminText(s)){setTimeout(openAdmin,80);return}if(/(^|\s)(VOLS?|PREPA|OUTILS?|ACCUEIL|HOME)(\s|$)/.test(s))closeAdmin()},true);
const obs=new MutationObserver(()=>{if(activeAdmin()&&!adminMode)openAdmin()});obs.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class','aria-selected','aria-current']});
setTimeout(()=>{if(activeAdmin())openAdmin()},700);`;

const PREVIOUS=String.raw`let openTimers=[];
function tabName(target){
  let fallback='';
  for(let el=target,i=0;el&&i<7;i++,el=el.parentElement){
    const s=norm(el.textContent);
    if(!s)continue;
    const direct=/^(ADMIN(?:ISTRATION)?|VOLS?|PREPA|OUTILS?|ACCUEIL|HOME)$/.exec(s);
    if(direct)return direct[1];
    if(!fallback&&el.matches&&el.matches('button,a,[role="button"],[role="tab"]'))fallback=s;
  }
  if(/(^|\s)ADMIN(?:ISTRATION)?(\s|$)/.test(fallback))return 'ADMIN';
  if(/(^|\s)VOLS?(\s|$)/.test(fallback))return 'VOLS';
  if(/(^|\s)PREPA(\s|$)/.test(fallback))return 'PREPA';
  if(/(^|\s)OUTILS?(\s|$)/.test(fallback))return 'OUTILS';
  if(/(^|\s)(ACCUEIL|HOME)(\s|$)/.test(fallback))return 'ACCUEIL';
  return '';
}
function openAdmin(){adminMode=true;render();if(!data&&!loading)load()}
function scheduleOpen(){openTimers.forEach(clearTimeout);openTimers=[20,90,180,360,700,1200].map(ms=>setTimeout(()=>{if(adminMode||activeAdmin())openAdmin()},ms))}
function closeAdmin(){adminMode=false;openTimers.forEach(clearTimeout);render()}
document.addEventListener('click',e=>{
  const tab=tabName(e.target);
  if(/^ADMIN/.test(tab)){adminMode=true;openAdmin();scheduleOpen();return}
  if(/^(VOLS?|PREPA|OUTILS?|ACCUEIL|HOME)$/.test(tab))closeAdmin();
},true);
const obs=new MutationObserver(()=>{
  if(activeAdmin()){adminMode=true;openAdmin()}
});
obs.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-selected','aria-current']});
setTimeout(()=>{if(activeAdmin()){adminMode=true;openAdmin()}},350);`;

const NEW=String.raw`let openTimers=[],mountWatch=null;
function tabName(target){
  let fallback='';
  for(let el=target,i=0;el&&i<7;i++,el=el.parentElement){
    const s=norm(el.textContent);
    if(!s)continue;
    const direct=/^(ADMIN(?:ISTRATION)?|VOLS?|PREPA|OUTILS?|ACCUEIL|HOME)$/.exec(s);
    if(direct)return direct[1];
    if(!fallback&&el.matches&&el.matches('button,a,[role="button"],[role="tab"]'))fallback=s;
  }
  if(/(^|\s)ADMIN(?:ISTRATION)?(\s|$)/.test(fallback))return 'ADMIN';
  if(/(^|\s)VOLS?(\s|$)/.test(fallback))return 'VOLS';
  if(/(^|\s)PREPA(\s|$)/.test(fallback))return 'PREPA';
  if(/(^|\s)OUTILS?(\s|$)/.test(fallback))return 'OUTILS';
  if(/(^|\s)(ACCUEIL|HOME)(\s|$)/.test(fallback))return 'ACCUEIL';
  return '';
}
function openAdmin(){
  adminMode=true;
  render();
  if(!data&&!loading)load();
}
function keepMounted(){
  clearInterval(mountWatch);
  let ticks=0;
  mountWatch=setInterval(()=>{
    if(!adminMode){clearInterval(mountWatch);mountWatch=null;return}
    const box=document.getElementById('alyzia-admin-processing-fix');
    if(!box||!box.isConnected||!box.classList.contains('show'))render();
    if(++ticks>=30){clearInterval(mountWatch);mountWatch=null}
  },120);
}
function scheduleOpen(){
  openTimers.forEach(clearTimeout);
  openTimers=[0,40,100,180,320,520,800,1200,1800,2600,3600].map(ms=>setTimeout(()=>{
    if(adminMode||activeAdmin())openAdmin();
  },ms));
  keepMounted();
}
function closeAdmin(){
  adminMode=false;
  openTimers.forEach(clearTimeout);
  openTimers=[];
  if(mountWatch){clearInterval(mountWatch);mountWatch=null}
  render();
}
function activateFrom(target){
  const tab=tabName(target);
  if(/^ADMIN/.test(tab)){
    adminMode=true;
    openAdmin();
    scheduleOpen();
    return true;
  }
  if(/^(VOLS?|PREPA|OUTILS?|ACCUEIL|HOME)$/.test(tab))closeAdmin();
  return false;
}
document.addEventListener('pointerup',e=>{activateFrom(e.target)},true);
document.addEventListener('click',e=>{activateFrom(e.target)},true);
const obs=new MutationObserver(()=>{
  if(activeAdmin()){
    adminMode=true;
    openAdmin();
    if(!mountWatch)scheduleOpen();
  }
});
obs.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-selected','aria-current']});
setTimeout(()=>{if(activeAdmin()){adminMode=true;openAdmin();scheduleOpen()}},250);`;

function patch(html){
  let s=String(html||'');
  if(s.includes('function keepMounted(){'))return s;
  if(s.includes(PREVIOUS))s=s.replace(PREVIOUS,NEW);
  else if(s.includes(OLD))s=s.replace(OLD,NEW);
  return s;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text();
    const headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
