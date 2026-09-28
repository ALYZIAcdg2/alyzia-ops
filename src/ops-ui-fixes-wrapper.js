import app from "./search-page-home-filter-tools-wrapper.js";

const UI=String.raw`<style id="alyzia-ops-ui-fixes-css">
#app .flight-home-row.v2-ready[style*="display: none"]{display:none!important}
#app .adb-usage-card{display:none!important}
#app .saria-bridge-pill{display:none!important}
#app .ops-search-page{padding:8px 0 100px;color:#10233f}
#app .ops-search-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:8px 0 14px}
#app .ops-search-head h1{margin:0;font-size:25px}#app .ops-search-head p{margin:5px 0 0;color:#708299;font-size:11px;font-weight:800}
#app .ops-search-datebar{display:grid;grid-template-columns:auto minmax(220px,360px) auto;gap:8px;align-items:center;margin:0 0 12px}
#app .ops-search-datebar button,#app .ops-search-datebar input{height:46px;border:1px solid #ccd9e7;border-radius:12px;background:#fff;color:#173553;font-weight:950;text-align:center}
#app .ops-search-datebar button{padding:0 18px;cursor:pointer}#app .ops-search-datebar input{padding:0 12px;color:#075fd3}
#app .ops-search-box{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #d7e1ec;border-radius:16px;padding:12px 14px;margin-bottom:13px}
#app .ops-search-box span{font-size:20px;color:#0874d1}#app .ops-search-box input{border:0;outline:0;background:transparent;width:100%;font:800 16px/1.2 inherit;color:#10233f}
#app .ops-company-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:5px 0 10px}#app .ops-company-head b{font-size:13px}#app .ops-company-back{border:1px solid #cfe0f1;background:#eef6ff;color:#076fd1;border-radius:10px;padding:8px 11px;font-size:10px;font-weight:950}
#app .ops-company-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
#app .ops-company-card{border:1px solid #dce6f0;background:#fff;border-radius:16px;padding:15px 12px;min-height:116px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;color:#10233f}
#app .ops-company-card:hover{border-color:#9ec3ea;background:#f7fbff}#app .ops-company-card .airline-logo{max-width:120px;max-height:44px;object-fit:contain}#app .ops-company-code{font-size:18px;font-weight:950}#app .ops-company-count{font-size:10px;color:#708299;font-weight:900}
#app .ops-search-flights{display:grid;gap:9px}#app .ops-search-flight{border:1px solid #dfe7f1;background:#fff;border-radius:15px;padding:12px 14px;display:grid;grid-template-columns:minmax(110px,.7fr) minmax(160px,1.2fr) minmax(110px,.65fr) auto;gap:10px;align-items:center;cursor:pointer;text-align:left;color:#10233f}
#app .ops-search-flight:hover{background:#f4f9ff;border-color:#bdd4eb}#app .ops-search-flight-no{font-size:19px;font-weight:950}#app .ops-search-route{font-size:14px;font-weight:900}#app .ops-search-meta{font-size:11px;color:#6e8098;font-weight:850}#app .ops-search-open{font-size:24px;color:#0874d1;font-weight:950}#app .ops-search-empty{border:1px dashed #cad7e4;border-radius:14px;padding:22px;text-align:center;color:#708299;font-weight:850}
@media(max-width:1000px){#app .ops-company-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:700px){#app .ops-search-head h1{font-size:21px}#app .ops-search-datebar{grid-template-columns:74px 1fr 74px}#app .ops-search-datebar button{padding:0 8px}#app .ops-company-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#app .ops-search-flight{grid-template-columns:1fr auto}#app .ops-search-route,#app .ops-search-meta{grid-column:1/2}#app .ops-search-open{grid-column:2/3;grid-row:1/4;align-self:center}}
</style><script id="alyzia-ops-ui-fixes-js">(()=>{'use strict';
if(window.__alyziaOpsUiFixes)return;window.__alyziaOpsUiFixes=true;
const norm=v=>String(v||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
function setView(v){try{currentView=v}catch(e){}}
function flights(){try{return Array.isArray(FLIGHTS)?FLIGHTS:[]}catch{return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]}}
function flightDate(x){return String(x?.activeDate||x?.date||x?.flight_date||'').slice(0,10)}
function moveEBeforeY(obj){if(!obj||typeof obj!=='object'||Array.isArray(obj)||!('E' in obj)||!('Y' in obj))return obj;const out={};for(const k of Object.keys(obj)){if(k==='Y'||k==='E')continue;out[k]=obj[k]}out.E=obj.E;out.Y=obj.Y;return out}
function normalizeClassOrder(){for(const x of flights()){if(x.config)x.config=moveEBeforeY(x.config);if(x.booked)x.booked=moveEBeforeY(x.booked);if(x.web)x.web=moveEBeforeY(x.web);if(x.meals)x.meals=moveEBeforeY(x.meals)}}
function sortedCabinText(raw){const s=String(raw||'').trim();const parts=[...s.matchAll(/\b([A-Z])\s*(\d+)\b/g)].map(m=>({k:m[1].toUpperCase(),v:m[2]}));if(parts.length<2)return s;const rank={F:0,J:1,C:2,S:3,W:4,E:5,Y:6,M:7};parts.sort((a,b)=>(rank[a.k]??50)-(rank[b.k]??50));return parts.map(x=>x.k+x.v).join(' ')}
function fixV2ClassOrder(){document.querySelectorAll('#app .v2-metric').forEach(m=>{const label=norm(m.querySelector('.v2-metric-label')?.textContent);if(label!=='CONFIG'&&label!=='BOOKING')return;const v=m.querySelector('.v2-metric-value');if(v)v.textContent=sortedCabinText(v.textContent)})}
function scheduleCardFixes(){[0,40,120].forEach(ms=>setTimeout(()=>{normalizeClassOrder();fixV2ClassOrder()},ms))}
function activeMobile(name){document.querySelectorAll('[data-mobile-nav]').forEach(b=>b.classList.toggle('active',b.dataset.mobileNav===name))}
function addDays(iso,n){const d=new Date(String(iso||'')+'T12:00:00');if(Number.isNaN(d.getTime()))return iso;d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
function todayIso(){try{return new Intl.DateTimeFormat('fr-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function dateLabel(iso){try{return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date(iso+'T12:00:00')).toUpperCase()}catch{return iso}}
function airlineCode(x){return String(x?.airline||String(x?.flight||'').match(/^[A-Z0-9]+?(?=\d)/)?.[0]||'').toUpperCase()}
function flightNo(x){return String(x?.flight||x?.flight_number||'').toUpperCase()}
function destination(x){return String(x?.dest||x?.destination||'').toUpperCase()}
function city(x){try{return String(CITY?.[destination(x)]||x?.destinationCity||x?.city||'').toUpperCase()}catch{return String(x?.destinationCity||x?.city||'').toUpperCase()}}
function companyLogo(code){try{if(typeof airlineLogo==='function')return airlineLogo(code,'large')}catch{}return '<span class="ops-company-code">'+esc(code)+'</span>'}

let SEARCH_STATE={date:'',company:'',query:''};
function ensureSearchDate(){if(SEARCH_STATE.date)return;try{SEARCH_STATE.date=String(selectedDate||HOME_DATE||'').slice(0,10)}catch{}if(!SEARCH_STATE.date)SEARCH_STATE.date=todayIso()}
function dayRows(){ensureSearchDate();return flights().map((f,i)=>({f,i})).filter(z=>flightDate(z.f)===SEARCH_STATE.date)}
function searchMatch(f){const q=norm(SEARCH_STATE.query);if(!q)return true;return norm([airlineCode(f),flightNo(f),destination(f),city(f),f?.airlineName,f?.destinationName].filter(Boolean).join(' ')).includes(q)}
function drawSearchPage(){
 setView('search');window.__alyziaFlightOriginView='search';activeMobile('search');normalizeClassOrder();ensureSearchDate();
 const app=document.getElementById('app');if(!app)return;const rows=dayRows().filter(z=>searchMatch(z.f));
 const groups=new Map();for(const z of rows){const a=airlineCode(z.f)||'—';if(!groups.has(a))groups.set(a,[]);groups.get(a).push(z)}
 const companies=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
 const selected=SEARCH_STATE.company?rows.filter(z=>airlineCode(z.f)===SEARCH_STATE.company):[];
 app.innerHTML='<section class="ops-search-page"><div class="ops-search-head"><div><h1>RECHERCHE VOL</h1><p>DATE · COMPAGNIE · NUMÉRO DE VOL · DESTINATION</p></div></div><div class="ops-search-datebar"><button id="opsSearchPrev">J-1</button><input id="opsSearchDate" type="date" value="'+esc(SEARCH_STATE.date)+'" aria-label="Date de recherche"><button id="opsSearchNext">J+1</button></div><label class="ops-search-box"><span>⌕</span><input id="opsSearchInput" value="'+esc(SEARCH_STATE.query)+'" placeholder="FILTRER : COMPAGNIE · VOL · DESTINATION…" autocomplete="off"></label>'+
 (SEARCH_STATE.company?'<div class="ops-company-head"><b>'+esc(SEARCH_STATE.company)+' · '+selected.length+' VOL'+(selected.length>1?'S':'')+' · '+esc(dateLabel(SEARCH_STATE.date))+'</b><button id="opsCompanyBack" class="ops-company-back">‹ COMPAGNIES</button></div><div class="ops-search-flights">'+(selected.length?selected.map(z=>'<button type="button" class="ops-search-flight" data-flight-index="'+z.i+'"><div class="ops-search-flight-no">'+esc(flightNo(z.f)||'—')+'</div><div class="ops-search-route">CDG → '+esc(destination(z.f)||'—')+(city(z.f)?' · '+esc(city(z.f)):'')+'</div><div class="ops-search-meta">STD '+esc(z.f.std||'—')+' · '+esc(z.f.aircraft||'A/C —')+'</div><div class="ops-search-open">›</div></button>').join(''):'<div class="ops-search-empty">AUCUN VOL POUR CETTE COMPAGNIE À CETTE DATE</div>')+'</div>':
 '<div class="ops-company-head"><b>'+companies.length+' COMPAGNIE'+(companies.length>1?'S':'')+' · '+rows.length+' VOL'+(rows.length>1?'S':'')+' · '+esc(dateLabel(SEARCH_STATE.date))+'</b></div><div class="ops-company-grid">'+(companies.length?companies.map(([a,list])=>'<button type="button" class="ops-company-card" data-company="'+esc(a)+'">'+companyLogo(a)+'<div class="ops-company-code">'+esc(a)+'</div><div class="ops-company-count">'+list.length+' VOL'+(list.length>1?'S':'')+'</div></button>').join(''):'<div class="ops-search-empty" style="grid-column:1/-1">AUCUN VOL À CETTE DATE</div>')+'</div>')+'</section>';
 app.querySelector('#opsSearchPrev')?.addEventListener('click',()=>{SEARCH_STATE.date=addDays(SEARCH_STATE.date,-1);SEARCH_STATE.company='';drawSearchPage()});
 app.querySelector('#opsSearchNext')?.addEventListener('click',()=>{SEARCH_STATE.date=addDays(SEARCH_STATE.date,1);SEARCH_STATE.company='';drawSearchPage()});
 app.querySelector('#opsSearchDate')?.addEventListener('change',e=>{SEARCH_STATE.date=e.target.value||SEARCH_STATE.date;SEARCH_STATE.company='';drawSearchPage()});
 app.querySelector('#opsSearchInput')?.addEventListener('input',e=>{SEARCH_STATE.query=e.target.value||'';drawSearchPage();const input=document.querySelector('#opsSearchInput');if(input){input.focus({preventScroll:true});const n=input.value.length;try{input.setSelectionRange(n,n)}catch{}}});
 app.querySelector('#opsCompanyBack')?.addEventListener('click',()=>{SEARCH_STATE.company='';drawSearchPage()});
 app.querySelectorAll('[data-company]').forEach(b=>b.addEventListener('click',()=>{SEARCH_STATE.company=String(b.dataset.company||'');drawSearchPage()}));
 app.querySelectorAll('[data-flight-index]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.flightIndex),f=flights()[i];if(!f)return;window.__alyziaFlightOriginView='search';try{if(typeof openSearchFlight==='function')openSearchFlight(i,flightDate(f));else{selected=i;selectedDate=flightDate(f)||selectedDate;HOME_DATE=flightDate(f)||HOME_DATE;render()}}catch(e){console.warn('SEARCH PAGE OPEN FLIGHT',e)}}));
}
window.renderFlightSearchPage=drawSearchPage;window.openFlightSearch=drawSearchPage;

function total(obj){return obj&&typeof obj==='object'?Object.values(obj).reduce((s,n)=>s+Number(n||0),0):Number(obj||0)}
function configRows(){try{return typeof SARIA_FALLBACK_CATALOG!=='undefined'&&Array.isArray(SARIA_FALLBACK_CATALOG)?SARIA_FALLBACK_CATALOG:[]}catch{return []}}
const TYPE_ALIASES={'TK|N32':{C:20,Y:162}};
function configForAircraft(x){
 const airline=airlineCode(x),ac=norm(x?.aircraft).replace(/\s+/g,''),special=TYPE_ALIASES[airline+'|'+ac];if(special)return {...special};
 const rows=configRows().filter(e=>norm(e.cie)===airline&&norm(e.ac).replace(/\s+/g,'')===ac).sort((a,b)=>Number(b.freq||0)-Number(a.freq||0));
 const e=rows[0];if(!e)return null;const cfg={};for(const pair of (e.classes||[])){const k=String(pair?.[0]||'').toUpperCase();if(!k)continue;cfg[k]=(cfg[k]||0)+Number(pair?.[1]||0)}return Object.keys(cfg).length?moveEBeforeY(cfg):null;
}
function alignOperationalObjects(x,cfg){const copy=(src={})=>{const o={};for(const k of Object.keys(cfg))o[k]=Number(src?.[k]||0);return o};x.booked=copy(x.booked);x.web=copy(x.web);x.meals=copy(x.meals);const cap=total(cfg),booked=total(x.booked);if(typeof x.available==='number')x.available=Math.max(0,cap-booked);else if(x.available&&typeof x.available==='object'){const a={};for(const k of Object.keys(cfg))a[k]=Math.max(0,Number(cfg[k]||0)-Number(x.booked[k]||0));x.available=a}}
function syncConfigToAircraft(x,{persist=false,note='TYPE A/C'}={}){
 if(!x||!x.aircraft)return false;const cfg=configForAircraft(x);if(!cfg)return false;const before=JSON.stringify(x.config||{}),after=JSON.stringify(cfg);if(before===after)return false;x.config={...cfg};alignOperationalObjects(x,cfg);normalizeClassOrder();x.aircraftConfigSyncedFrom=String(x.aircraft||'').toUpperCase();x.aircraftConfigSyncedAt=new Date().toISOString();if(persist){try{markManualFields(x,'config',note+' · CONFIG/CAPACITY synchronisée')}catch{}try{persistFlightAction('CONFIG/CAPACITY SYNCHRONISÉE AU TYPE A/C')}catch{}}return true
}
function syncAllVisibleAircraft(){for(const x of flights()){if(x.aircraftDetectedByApi&&x.aircraftConfigSyncedFrom!==String(x.aircraft||'').toUpperCase())syncConfigToAircraft(x)}}
function syncCurrentDetectedAircraft(){const x=typeof f==='function'?f():null;if(!x||!x.aircraftDetectedByApi)return false;return syncConfigToAircraft(x,{persist:true,note:'TYPE A/C API'})}

const baseHome=window.renderHome;if(typeof baseHome==='function')window.renderHome=function(...args){syncAllVisibleAircraft();normalizeClassOrder();setView('home');window.__alyziaFlightOriginView='home';const r=baseHome.apply(this,args);setTimeout(()=>{try{filterFlightHomeRows(document.querySelector('.home-flight-search input')?.value||'')}catch{}},0);scheduleCardFixes();return r};
const baseTools=window.renderTools;if(typeof baseTools==='function')window.renderTools=function(...args){setView('tools');window.__alyziaFlightOriginView='tools';const r=baseTools.apply(this,args);setTimeout(()=>document.querySelectorAll('#app .adb-usage-card').forEach(x=>x.remove()),0);return r};
const baseDetailRender=window.render;if(typeof baseDetailRender==='function')window.render=function(...args){try{syncCurrentDetectedAircraft()}catch{}return baseDetailRender.apply(this,args)};

window.onSariaAircraftChange=function(value){
 const x=typeof f==='function'?f():null;if(!x)return;x.aircraft=String(value||'').trim().toUpperCase();x.aircraftDetectedByApi=false;x.aircraftConfigSyncedFrom='';
 const changed=syncConfigToAircraft(x,{persist:true,note:'TYPE A/C MANUEL'});if(!changed){x.config={};x.booked={};x.web={};x.meals={};if(typeof x.available==='number')x.available=0;try{persistFlightAction('TYPE A/C MODIFIÉ · CONFIG INCONNUE')}catch{}}
 try{render()}catch{}
};

function routeBack(){const origin=window.__alyziaFlightOriginView||'home';if(origin==='admin'&&typeof window.renderAdminDashboard==='function'){setView('admin');window.renderAdminDashboard();return}if(origin==='search'){drawSearchPage();return}if(origin==='tools'&&typeof window.renderTools==='function'){window.renderTools();return}if(typeof window.renderHome==='function')window.renderHome()}
document.addEventListener('click',e=>{
 const b=e.target?.closest?.('button');const txt=norm(b?.textContent);
 if(b?.dataset?.mobileNav==='search'||txt==='RECHERCHE'){e.preventDefault();e.stopImmediatePropagation();SEARCH_STATE.company='';drawSearchPage();return}
 if(b?.dataset?.mobileNav==='home'||txt==='VOLS'||b?.classList?.contains('home-nav'))window.__alyziaFlightOriginView='home';
 if(e.target?.closest?.('#app .flight-home-row'))window.__alyziaFlightOriginView='home';
 if(e.target?.closest?.('#app .admin-native .adn-table tbody tr'))window.__alyziaFlightOriginView='admin';
 const back=e.target?.closest?.('#app button');if(back&&norm(back.textContent).includes('RETOUR LISTE')){e.preventDefault();e.stopImmediatePropagation();routeBack();return}
},true);
normalizeClassOrder();scheduleCardFixes();
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-ops-ui-fixes-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {
 async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},
 scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
