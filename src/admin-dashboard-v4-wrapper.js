import app from "./admin-dashboard-v3-wrapper.js";

const UI=String.raw`<style id="alyzia-admin-dashboard-v4-css">
#app .admin-native .adn-log-section-hidden{display:none!important}
#app .admin-native .adn-v4-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#app .admin-native .adn-v4-btn{border:1px solid #cfe0f1;background:#eef6ff;color:#076fd1;border-radius:10px;padding:8px 11px;font-size:10px;font-weight:950;white-space:nowrap;cursor:pointer}
#app .admin-native .adn-v4-btn.reset{background:#fff;color:#52677d}
#app .admin-native .adn-cards .adn-mini span{cursor:pointer;border-radius:999px;padding:4px 7px}
#app .admin-native .adn-cards .adn-mini span.v4-active{background:#eef6ff;box-shadow:0 0 0 1px #bcd5ef inset}
</style><script id="alyzia-admin-dashboard-v4-js">(()=>{'use strict';
if(window.__alyziaAdminV4)return;window.__alyziaAdminV4=true;
const norm=v=>String(v||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
function setView(view){try{currentView=view}catch(e){}}
function statusKey(text){const t=norm(text);if(t.startsWith('OK '))return 'OK';if(t.startsWith('PARTIEL '))return 'PARTIEL';if(t.startsWith('A CONTROLER '))return 'A CONTROLER';if(t.startsWith('NON TRAITE '))return 'NON TRAITE';return ''}
function tableMini(root){return [...root.querySelectorAll('.adn-section')].find(s=>s.querySelector('.adn-table'))?.querySelector('.adn-mini')||null}
function activeStatus(root){return tableMini(root)?.querySelector('.adn-status-active')?.dataset?.adminStatus||'ALL'}
function syncTopKpis(root){const active=activeStatus(root);root.querySelectorAll('.adn-cards .adn-mini span').forEach(s=>s.classList.toggle('v4-active',statusKey(s.textContent)===active))}
function triggerStatus(root,key){const mini=tableMini(root);if(!mini)return;const target=[...mini.querySelectorAll('span')].find(s=>String(s.dataset.adminStatus||'')===key);target?.click();setTimeout(()=>syncTopKpis(root),0)}
function resetFilters(root){
 const input=root.querySelector('#adminFlightSearch');if(input&&input.value){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))}
 const active=tableMini(root)?.querySelector('.adn-status-active');if(active)active.click();
 const all=root.querySelector('[data-terminal="ALL"]');if(all&&!all.classList.contains('active'))all.click();
 setTimeout(()=>{const r=document.querySelector('#app .admin-native');if(r)syncTopKpis(r)},0);
}
function patchAdmin(){
 const app=document.getElementById('app'),root=app?.querySelector('.admin-native');if(!root)return;
 setView('admin');
 const logSection=[...root.querySelectorAll('.adn-section')].find(s=>norm(s.querySelector('h3')?.textContent).startsWith('LOG TRAITEMENT'));
 let logBtn=logSection?.querySelector('.adn-log-btn')||null;
 if(logSection)logSection.classList.add('adn-log-section-hidden');
 const head=root.querySelector('.adn-head');
 if(head&&!head.querySelector('.adn-v4-actions')){
   const actions=document.createElement('div');actions.className='adn-v4-actions';
   if(logBtn){logBtn.textContent='LOGS';logBtn.classList.add('adn-v4-btn');actions.appendChild(logBtn)}
   const reset=document.createElement('button');reset.type='button';reset.className='adn-v4-btn reset';reset.textContent='RESET FILTRES';reset.addEventListener('click',()=>resetFilters(root));actions.appendChild(reset);
   const refresh=head.querySelector('#adminRefreshBtn');if(refresh)actions.appendChild(refresh);head.appendChild(actions);
 }
 root.querySelectorAll('.adn-cards .adn-mini span').forEach(s=>{if(s.dataset.v4Bound)return;s.dataset.v4Bound='1';s.addEventListener('click',()=>{const k=statusKey(s.textContent);if(k)triggerStatus(root,k)})});
 syncTopKpis(root);
}
const baseRender=window.renderAdminDashboard;
if(typeof baseRender==='function')window.renderAdminDashboard=async function(...args){
 setView('admin');window.__alyziaFlightOriginView='admin';
 const app=document.getElementById('app');if(app)app.innerHTML='<section class="admin-native"><div class="adn-section"><b>CHARGEMENT DU TABLEAU DE BORD ADMIN…</b></div></section>';
 const r=await baseRender.apply(this,args);setView('admin');patchAdmin();return r;
};
function isAdminButton(button){return !!button&&(button.dataset?.mobileNav==='admin'||norm(button.textContent)==='ADMIN')}
function returnToAdmin(e){
 if(window.__alyziaFlightOriginView!=='admin')return false;
 e?.preventDefault?.();e?.stopImmediatePropagation?.();window.__alyziaFlightOriginView='';setView('admin');window.renderAdminDashboard?.();return true;
}
document.addEventListener('click',e=>{
 const b=e.target?.closest?.('button');
 if(isAdminButton(b)){
   e.preventDefault();e.stopImmediatePropagation();setView('admin');window.__alyziaFlightOriginView='admin';
   const app=document.getElementById('app');if(app)app.innerHTML='<section class="admin-native"><div class="adn-section"><b>CHARGEMENT DU TABLEAU DE BORD ADMIN…</b></div></section>';
   window.renderAdminDashboard?.();return;
 }
 const back=e.target?.closest?.('#app .flight-back-btn');if(back&&returnToAdmin(e))return;
 const row=e.target?.closest?.('#app .admin-native .adn-table tbody tr');if(row)window.__alyziaFlightOriginView='admin';
 const ctl=e.target?.closest?.('#adminPrev,#adminNext,#adminDateBtn,[data-terminal],#adminRefreshBtn,.adn-status-active,.adn-mini span');if(ctl)setTimeout(()=>{setView('admin');patchAdmin()},0);
},true);
document.addEventListener('change',e=>{if(e.target?.id==='adminDateInput')setTimeout(()=>{setView('admin');patchAdmin()},0)},true);
setTimeout(patchAdmin,0);
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-admin-dashboard-v4-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}

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
