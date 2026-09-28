import app from "./admin-provider-quota-fix-wrapper.js";

const UI=String.raw`<style id="alyzia-search-page-fix-css">
#app .alyzia-search-page{padding:8px 0 100px;color:#10233f}.alyzia-search-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:8px 0 14px}.alyzia-search-title{font-size:25px;font-weight:950}.alyzia-search-sub{font-size:11px;color:#708299;font-weight:800;margin-top:2px}.alyzia-search-box{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #d7e1ec;border-radius:16px;padding:12px 14px;margin-bottom:12px}.alyzia-search-box span{font-size:20px;color:#0874d1}.alyzia-search-box input{border:0;outline:0;background:transparent;width:100%;font:800 16px/1.2 inherit;color:#10233f}.alyzia-search-count{font-size:11px;color:#6f8198;font-weight:900;margin:0 0 9px}.alyzia-search-results{display:grid;gap:8px}.alyzia-search-row{border:1px solid #dfe7f1;background:#fff;border-radius:15px;padding:12px 14px;display:grid;grid-template-columns:minmax(110px,.7fr) minmax(160px,1.2fr) minmax(90px,.6fr) auto;gap:10px;align-items:center;cursor:pointer;text-align:left;color:#10233f}.alyzia-search-row:hover{background:#f4f9ff;border-color:#bdd4eb}.alyzia-search-flight{font-size:19px;font-weight:950}.alyzia-search-route{font-size:14px;font-weight:900}.alyzia-search-meta{font-size:11px;color:#6e8098;font-weight:850}.alyzia-search-open{font-size:24px;color:#0874d1;font-weight:950}.alyzia-search-empty{border:1px dashed #cad7e4;border-radius:14px;padding:20px;text-align:center;color:#708299;font-weight:850}
@media(max-width:700px){#app .alyzia-search-page{padding:4px 0 100px}.alyzia-search-title{font-size:21px}.alyzia-search-row{grid-template-columns:1fr auto}.alyzia-search-route,.alyzia-search-meta{grid-column:1/2}.alyzia-search-open{grid-column:2/3;grid-row:1/4;align-self:center}}
</style><script id="alyzia-search-page-fix-js">(()=>{'use strict';
if(window.__alyziaSearchPageFix)return;window.__alyziaSearchPageFix=true;
let searchValue='';
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
function setView(v){try{currentView=v}catch{}}
function getFlights(){try{return Array.isArray(FLIGHTS)?FLIGHTS:[]}catch{return []}}
function flightDate(f){return String(f?.date||f?.flight_date||'')}
function flightNo(f){return String(f?.flight||f?.flight_number||f?.number||'').toUpperCase()}
function airline(f){return String(f?.airline||f?.airlineCode||f?.company||'').toUpperCase()}
function dest(f){return String(f?.dest||f?.destination||f?.arrival||'').toUpperCase()}
function city(f){return String(f?.destinationCity||f?.city||f?.destCity||'').toUpperCase()}
function std(f){return String(f?.std||f?.departureTime||'—')}
function searchable(f){return norm([flightNo(f),airline(f),dest(f),city(f),f?.airlineName,f?.destinationName].filter(Boolean).join(' '))}
function results(){const q=norm(searchValue);const rows=getFlights().map((f,i)=>({f,i}));if(!q)return rows.slice(0,120);return rows.filter(z=>searchable(z.f).includes(q)).slice(0,120)}
function draw(){
 const root=document.getElementById('app');if(!root)return;setView('search');document.querySelectorAll('[data-mobile-nav]').forEach(b=>b.classList.toggle('active',b.dataset.mobileNav==='search'));
 const rows=results();root.innerHTML='<section class="alyzia-search-page"><div class="alyzia-search-head"><div><div class="alyzia-search-title">RECHERCHE VOL</div><div class="alyzia-search-sub">COMPAGNIE · CODE · NUMÉRO DE VOL · DESTINATION</div></div></div><label class="alyzia-search-box"><span>⌕</span><input id="alyziaSearchPageInput" value="'+esc(searchValue)+'" placeholder="RECHERCHER UN VOL…" autocomplete="off"></label><div class="alyzia-search-count">'+rows.length+' RÉSULTAT'+(rows.length>1?'S':'')+'</div><div class="alyzia-search-results">'+(rows.length?rows.map(z=>'<button type="button" class="alyzia-search-row" data-search-index="'+z.i+'"><div class="alyzia-search-flight">'+esc(flightNo(z.f)||'—')+'</div><div class="alyzia-search-route">CDG → '+esc(dest(z.f)||'—')+(city(z.f)?' · '+esc(city(z.f)):'')+'</div><div class="alyzia-search-meta">'+esc(flightDate(z.f)||'—')+' · STD '+esc(std(z.f))+'</div><div class="alyzia-search-open">›</div></button>').join(''):'<div class="alyzia-search-empty">AUCUN VOL TROUVÉ</div>')+'</div></section>';
 const input=root.querySelector('#alyziaSearchPageInput');input?.focus();if(input){input.setSelectionRange(input.value.length,input.value.length);input.addEventListener('input',()=>{searchValue=input.value;draw()})}
 root.querySelectorAll('[data-search-index]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.searchIndex),f=getFlights()[i];if(!f)return;window.__alyziaFlightOriginView='search';window.__alyziaSearchPageValue=searchValue;try{if(typeof openSearchFlight==='function')openSearchFlight(i,flightDate(f));else{selected=i;selectedDate=flightDate(f)||selectedDate;HOME_DATE=flightDate(f)||HOME_DATE;render()}}catch(e){console.warn('SEARCH PAGE OPEN FLIGHT',e)}}));
}
window.renderFlightSearchPage=function(){searchValue=String(window.__alyziaSearchPageValue||searchValue||'');draw()};
function returnToSearch(e){if(window.__alyziaFlightOriginView!=='search')return false;e.preventDefault();e.stopImmediatePropagation();window.__alyziaFlightOriginView='';searchValue=String(window.__alyziaSearchPageValue||searchValue||'');draw();return true}
function isSearchButton(b){if(!b)return false;return b.dataset?.mobileNav==='search'||norm(b.textContent)==='RECHERCHE'}
function homeSearchInput(el){if(!el||el.tagName!=='INPUT')return false;let home=false;try{home=currentView==='home'}catch{}if(!home)return false;if(!document.querySelector('#app .flight-home-row'))return false;const type=String(el.type||'text').toLowerCase();return type==='text'||type==='search'}
function filterHome(input){const q=norm(input.value);document.querySelectorAll('#app .flight-home-row').forEach(row=>{row.style.display=!q||norm(row.textContent).includes(q)?'':'none'})}
function removeToolsAdb(){let tools=false;try{tools=currentView==='tools'}catch{}if(!tools)return;const root=document.getElementById('app');if(!root)return;const candidates=[...root.querySelectorAll('button,[role="button"],.tool-card,.tools-card,.tool-item,.card')];for(const el of candidates){const t=norm(el.textContent);if(t.includes('AERODATABOX')&&t.includes('LIVE')){const card=el.closest('.tool-card,.tools-card,.tool-item,.card')||el;card.remove();break}}
}
const baseTools=window.renderTools;if(typeof baseTools==='function')window.renderTools=function(...args){const r=baseTools.apply(this,args);setTimeout(removeToolsAdb,0);return r};
document.addEventListener('click',e=>{const b=e.target?.closest?.('button');if(isSearchButton(b)){e.preventDefault();e.stopImmediatePropagation();window.__alyziaFlightOriginView='';setView('search');draw();return}const back=e.target?.closest?.('#app .flight-back-btn');if(back&&returnToSearch(e))return},true);
document.addEventListener('input',e=>{if(homeSearchInput(e.target))filterHome(e.target)},true);
})();</script>`;

function patch(html){let s=String(html||'');s=s.replaceAll('onclick="openFlightSearch()"','onclick="renderFlightSearchPage()"');if(!s.includes('id="alyzia-search-page-fix-js"')){const i=s.lastIndexOf('</body>');s=i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}return s}

export default {
 async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx),type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},
 scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
