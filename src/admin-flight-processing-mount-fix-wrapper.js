import app from "./admin-flight-processing-wrapper.js";

const OLD_MOUNT=String.raw`function mount(){if(document.getElementById('alyzia-processing-dashboard'))return;const host=adminAnchor();if(!host)return;const box=document.createElement('section');box.id='alyzia-processing-dashboard';host.prepend(box);box.innerHTML='<b>Chargement du traitement des vols…</b>';load()}
document.addEventListener('click',e=>{if(clickedAdmin(e.target))setTimeout(mount,120)},true);const obs=new MutationObserver(()=>{if(activeAdmin())mount()});obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-selected']});setTimeout(()=>{if(activeAdmin())mount()},500);`;

const NEW_MOUNT=String.raw`let adminWanted=false,mountTimers=[];
function mainTab(target){let el=target;for(let i=0;el&&i<6;i++,el=el.parentElement){const t=norm(el.textContent);if(/^(ACCUEIL|VOLS?|PREPA|OUTILS|ADMIN(?:ISTRATION)?)$/.test(t))return t}return ''}
function removeDashboard(){const box=document.getElementById('alyzia-processing-dashboard');if(box)box.remove()}
function mount(){
  if(!(adminWanted||activeAdmin()))return;
  const host=document.querySelector('#app');if(!host)return;
  let box=document.getElementById('alyzia-processing-dashboard');
  if(box&&box.parentElement!==host){box.remove();box=null}
  if(!box){box=document.createElement('section');box.id='alyzia-processing-dashboard';host.prepend(box);box.innerHTML='<b>Chargement du traitement des vols…</b>';load()}
}
function scheduleMount(){mountTimers.forEach(clearTimeout);mountTimers=[40,140,300,650,1100,1800].map(ms=>setTimeout(()=>{if(adminWanted||activeAdmin())mount()},ms))}
document.addEventListener('click',e=>{
  if(clickedAdmin(e.target)){adminWanted=true;scheduleMount();return}
  const tab=mainTab(e.target);if(tab&& !/^ADMIN/.test(tab)){adminWanted=false;mountTimers.forEach(clearTimeout);removeDashboard()}
},true);
const obs=new MutationObserver(()=>{
  if(activeAdmin()){adminWanted=true;mount()}
  else if(adminWanted)scheduleMount()
});
obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-selected']});
setTimeout(()=>{if(activeAdmin()){adminWanted=true;mount()}},350);`;

function patch(html){
  let s=String(html||'');
  if(s.includes('let adminWanted=false,mountTimers=[];'))return s;
  if(s.includes(OLD_MOUNT))s=s.replace(OLD_MOUNT,NEW_MOUNT);
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
