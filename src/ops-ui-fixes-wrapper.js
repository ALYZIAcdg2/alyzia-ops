import app from "./search-page-home-filter-tools-wrapper.js";

const UI=String.raw`<style id="alyzia-ops-ui-fixes-css">
#app .flight-home-row.v2-ready[style*="display: none"]{display:none!important}
#app .adb-usage-card{display:none!important}
#app .ops-search-page{padding:8px 0 100px;color:#10233f}
#app .ops-search-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:8px 0 14px}
#app .ops-search-head h1{margin:0;font-size:25px}#app .ops-search-head p{margin:5px 0 0;color:#708299;font-size:11px;font-weight:800}
#app .ops-search-card{background:#fff;border:1px solid #dfe7f1;border-radius:16px;padding:14px}
#app .ops-search-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
#app .ops-search-grid label{font-size:10px;font-weight:900;color:#62758d}#app .ops-search-grid input,#app .ops-search-grid select{width:100%;height:42px;margin-top:5px;border:1px solid #cfdae7;border-radius:10px;padding:0 10px;background:#fff;color:#10233f;font-weight:850}
#app .ops-search-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}#app .ops-search-actions button{border:1px solid #cfe0f1;background:#eef6ff;color:#076fd1;border-radius:10px;padding:9px 12px;font-weight:950}#app .ops-search-actions .primary{background:#0874d1;color:#fff;border-color:#0874d1}
#app .ops-search-page .search-results{margin-top:12px}
@media(max-width:700px){#app .ops-search-grid{grid-template-columns:1fr 1fr}#app .ops-search-head h1{font-size:21px}}
</style><script id="alyzia-ops-ui-fixes-js">(()=>{'use strict';
if(window.__alyziaOpsUiFixes)return;window.__alyziaOpsUiFixes=true;
const norm=v=>String(v||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
function setView(v){try{currentView=v}catch(e){}}
function flights(){try{return Array.isArray(FLIGHTS)?FLIGHTS:[]}catch{return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]}}
function moveEBeforeY(obj){if(!obj||typeof obj!=='object'||Array.isArray(obj)||!('E' in obj)||!('Y' in obj))return obj;const out={};for(const k of Object.keys(obj)){if(k==='Y'||k==='E')continue;out[k]=obj[k]}out.E=obj.E;out.Y=obj.Y;return out}
function normalizeClassOrder(){for(const x of flights()){if(x.config)x.config=moveEBeforeY(x.config);if(x.booked)x.booked=moveEBeforeY(x.booked);if(x.web)x.web=moveEBeforeY(x.web);if(x.meals)x.meals=moveEBeforeY(x.meals)}}
function activeMobile(name){document.querySelectorAll('[data-mobile-nav]').forEach(b=>b.classList.toggle('active',b.dataset.mobileNav===name))}
function renderSearchPage(){
 setView('search');window.__alyziaFlightOriginView='search';activeMobile('search');normalizeClassOrder();
 const app=document.getElementById('app');if(!app)return;const list=flights(),airlines=[...new Set(list.map(x=>String(x.airline||'').toUpperCase()).filter(Boolean))].sort(),dests=[...new Set(list.map(x=>String(x.dest||x.destination||'').toUpperCase()).filter(Boolean))].sort();
 let date='';try{date=selectedDate||HOME_DATE||''}catch{}
 app.innerHTML='<section class="ops-search-page"><div class="ops-search-head"><div><h1>RECHERCHE VOL</h1><p>COMPAGNIE · NUMÉRO DE VOL · DATE · DESTINATION</p></div></div><div class="ops-search-card"><div class="ops-search-grid"><label>COMPAGNIE<select id="sfAirline"><option value="">TOUTES</option>'+airlines.map(a=>'<option>'+a+'</option>').join('')+'</select></label><label>NUMÉRO DE VOL<input id="sfFlight" placeholder="EX. TK1822"></label><label>DATE<input id="sfDate" type="date" value="'+date+'"></label><label>DESTINATION<select id="sfDest"><option value="">TOUTES</option>'+dests.map(a=>'<option>'+a+'</option>').join('')+'</select></label></div><div class="ops-search-actions"><button id="opsSearchReset">RÉINITIALISER</button><button class="primary" id="opsSearchRun">RECHERCHER</button></div><div id="flightSearchResults" class="search-results"></div><div id="flightSearchHint" class="search-hint">RENSEIGNE AU MOINS UN CRITÈRE PUIS APPUIE SUR RECHERCHER.</div></div></section>';
 app.querySelector('#opsSearchRun')?.addEventListener('click',()=>{window.__alyziaFlightOriginView='search';try{runFlightSearch()}catch(e){}});
 app.querySelector('#opsSearchReset')?.addEventListener('click',()=>{['sfAirline','sfFlight','sfDest'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});const d=document.getElementById('sfDate');if(d)d.value='';try{runFlightSearch()}catch(e){}});
}
window.renderFlightSearchPage=renderSearchPage;window.openFlightSearch=renderSearchPage;

const baseHome=window.renderHome; if(typeof baseHome==='function')window.renderHome=function(...args){normalizeClassOrder();setView('home');window.__alyziaFlightOriginView='home';const r=baseHome.apply(this,args);setTimeout(()=>{try{filterFlightHomeRows(document.querySelector('.home-flight-search input')?.value||'')}catch{}},0);return r};
const baseTools=window.renderTools;if(typeof baseTools==='function')window.renderTools=function(...args){setView('tools');window.__alyziaFlightOriginView='tools';const r=baseTools.apply(this,args);setTimeout(()=>document.querySelectorAll('#app .adb-usage-card').forEach(x=>x.remove()),0);return r};

window.onSariaAircraftChange=async function(value){
 const x=typeof f==='function'?f():null;if(!x)return;x.aircraft=typeof sariaNorm==='function'?sariaNorm(value):String(value||'').trim().toUpperCase();x.sariaConfigKey='';x.sariaCabinConfig='';
 try{if(typeof loadSariaCatalog==='function')await loadSariaCatalog();const configs=typeof sariaConfigsFor==='function'?sariaConfigsFor(x.airline,x.aircraft):[];if(configs.length){const e=configs[0],cfg=typeof sariaClassObject==='function'?sariaClassObject(e):{};x.sariaConfigKey=typeof sariaConfigKey==='function'?sariaConfigKey(e):'';x.sariaCabinConfig=e.config||'';x.config={...cfg};const keep=(src={})=>{const o={};Object.keys(cfg).forEach(k=>o[k]=Number(src[k]||0));return o};x.booked=keep(x.booked);x.web=keep(x.web);x.meals=keep(x.meals);try{markManualFields(x,'config','Type A/C modifié · configuration SARIA adaptée')}catch{}try{persistFlightAction('TYPE A/C + CONFIG SARIA')}catch{}try{render()}catch{}if(configs.length>1)setTimeout(()=>{try{openSariaCabinChooser()}catch{}},30);return}x.config={};x.booked={};x.web={};x.meals={};try{render()}catch{}setTimeout(()=>{try{openSariaCabinChooser()}catch{}},30)}catch(e){try{render()}catch{}}
};

function routeBack(){const origin=window.__alyziaFlightOriginView||'home';if(origin==='admin'&&typeof window.renderAdminDashboard==='function'){setView('admin');window.renderAdminDashboard();return}if(origin==='search'){renderSearchPage();return}if(origin==='tools'&&typeof window.renderTools==='function'){window.renderTools();return}if(typeof window.renderHome==='function')window.renderHome()}
document.addEventListener('click',e=>{
 const b=e.target?.closest?.('button');const txt=norm(b?.textContent);
 if(b?.dataset?.mobileNav==='search'||txt==='RECHERCHE'){e.preventDefault();e.stopImmediatePropagation();renderSearchPage();return}
 if(b?.dataset?.mobileNav==='home'||txt==='VOLS'||b?.classList?.contains('home-nav'))window.__alyziaFlightOriginView='home';
 if(e.target?.closest?.('#app .flight-home-row'))window.__alyziaFlightOriginView='home';
 if(e.target?.closest?.('#app .admin-native .adn-table tbody tr'))window.__alyziaFlightOriginView='admin';
 if(e.target?.closest?.('#app .ops-search-page #flightSearchResults,#app .alyzia-search-page .alyzia-search-results'))window.__alyziaFlightOriginView='search';
 const back=e.target?.closest?.('#app button');if(back&&norm(back.textContent).includes('RETOUR LISTE')){e.preventDefault();e.stopImmediatePropagation();routeBack();return}
},true);
normalizeClassOrder();
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-ops-ui-fixes-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {
 async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},
 scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
