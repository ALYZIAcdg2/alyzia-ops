import app from "./admin-provider-quota-fix-wrapper.js";

const UI=String.raw`<script id="alyzia-search-page-bridge-js">(()=>{'use strict';
if(window.__alyziaSearchBridge)return;window.__alyziaSearchBridge=true;
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();

function homeSearchInput(el){
  if(!el||el.tagName!=='INPUT')return false;
  let home=false;try{home=currentView==='home'}catch{}
  if(!home)return false;
  if(!document.querySelector('#app .flight-home-row'))return false;
  const type=String(el.type||'text').toLowerCase();
  return type==='text'||type==='search';
}
function filterHome(input){
  const q=norm(input.value);
  document.querySelectorAll('#app .flight-home-row').forEach(row=>{
    row.style.display=!q||norm(row.textContent).includes(q)?'':'none';
  });
}
function removeToolsAdb(){
  let tools=false;try{tools=currentView==='tools'}catch{}
  if(!tools)return;
  const root=document.getElementById('app');if(!root)return;
  const candidates=[...root.querySelectorAll('button,[role="button"],.tool-card,.tools-card,.tool-item,.card')];
  for(const el of candidates){
    const t=norm(el.textContent);
    if(t.includes('AERODATABOX')&&t.includes('LIVE')){
      const card=el.closest('.tool-card,.tools-card,.tool-item,.card')||el;
      card.remove();
      break;
    }
  }
}
const baseTools=window.renderTools;
if(typeof baseTools==='function')window.renderTools=function(...args){
  const r=baseTools.apply(this,args);
  setTimeout(removeToolsAdb,0);
  return r;
};
document.addEventListener('input',e=>{
  if(homeSearchInput(e.target))filterHome(e.target);
},true);
})();</script>`;

function patch(html){
  let s=String(html||'');
  s=s.replaceAll('onclick="openFlightSearch()"','onclick="renderFlightSearchPage()"');
  if(!s.includes('id="alyzia-search-page-bridge-js"')){
    const i=s.lastIndexOf('</body>');
    s=i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI;
  }
  return s;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text(),headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
