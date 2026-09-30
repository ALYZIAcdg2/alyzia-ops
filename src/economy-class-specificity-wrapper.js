import app from "./ops-ui-fixes-wrapper.js";

const UI=String.raw`<style id="alyzia-home-list-ux-css">
#app .alyzia-home-clear{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:50%;background:#eef4fa;color:#526b88;font-size:22px;font-weight:700;display:grid;place-items:center;cursor:pointer;z-index:3}
#app .home-flight-search{position:relative}
#app .home-flight-search input{padding-right:54px!important}
#alyzia-home-to-top{position:fixed;right:18px;bottom:86px;width:48px;height:48px;border:1px solid #c9d9ea;border-radius:50%;background:#fff;color:#0b70d1;font-size:26px;font-weight:950;box-shadow:0 7px 22px rgba(24,58,93,.18);z-index:9000;display:none;place-items:center;cursor:pointer}
#alyzia-home-to-top.show{display:grid}
@media(min-width:760px){#alyzia-home-to-top{bottom:24px;right:24px}}
</style><script id="alyzia-economy-class-specificity">(()=>{'use strict';
if(window.__alyziaEconomyClassSpecificity)return;window.__alyziaEconomyClassSpecificity=true;
const norm=v=>String(v||'').toUpperCase().trim();
function flights(){try{return Array.isArray(FLIGHTS)?FLIGHTS:[]}catch{return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]}}
function airline(x){return norm(x?.airline||String(x?.flight||'').match(/^[A-Z0-9]+?(?=\d)/)?.[0]||'')}
function catalog(){try{return typeof SARIA_FALLBACK_CATALOG!=='undefined'&&Array.isArray(SARIA_FALLBACK_CATALOG)?SARIA_FALLBACK_CATALOG:[]}catch{return []}}
function configObject(x){return x?.config||x?.cabinConfig||x?.capacity||x?.cabin_configuration||null}
function targetFromConfig(x){const cfg=configObject(x);if(!cfg||typeof cfg!=='object'||Array.isArray(cfg))return '';const y=Number(cfg.Y||0),m=Number(cfg.M||0);if(m>0&&y<=0)return'M';if(y>0&&m<=0)return'Y';return''}
function targetFromCatalog(x){const a=airline(x),ac=norm(x?.aircraft).replace(/\s+/g,'');if(!a||!ac)return'';const rows=catalog().filter(e=>norm(e?.cie)===a&&norm(e?.ac).replace(/\s+/g,'')===ac).sort((p,q)=>Number(q?.freq||0)-Number(p?.freq||0));const classes=(rows[0]?.classes||[]).map(p=>norm(p?.[0]));const hasM=classes.includes('M'),hasY=classes.includes('Y');return hasM&&!hasY?'M':hasY&&!hasM?'Y':''}
function seatmapEconomyClass(x){return targetFromConfig(x)||targetFromCatalog(x)}
function moveEconomy(obj,target){if(!obj||typeof obj!=='object'||Array.isArray(obj)||!target)return false;const other=target==='M'?'Y':'M';if(!(other in obj))return false;const targetVal=Number(obj[target]||0),otherVal=Number(obj[other]||0);if(targetVal<=0&&otherVal>0)obj[target]=otherVal;delete obj[other];return true}
function repairFlight(x){const target=seatmapEconomyClass(x);if(!target)return false;let changed=false;for(const k of ['config','booked','web','meals','available'])changed=moveEconomy(x?.[k],target)||changed;if(changed){x.economyClassSource='SEATMAP';x.economyClassUpdatedAt=new Date().toISOString()}return changed}
function repairAll(){let changed=false;for(const x of flights())changed=repairFlight(x)||changed;return changed}
function repairCurrent(){try{return typeof f==='function'?repairFlight(f()):false}catch{return false}}
function rowIndex(row){const src=String(row.getAttribute('onclick')||row.querySelector('.home-open')?.getAttribute('onclick')||'');const m=src.match(/openFlightFromHomeList\((\d+)\)/);return m?Number(m[1]):null}
function cabinText(obj,target=''){if(!obj||typeof obj!=='object')return String(obj||'—');const copy={...obj};if(target){const other=target==='M'?'Y':'M';delete copy[other]}const order=['F','J','C','S','W','E','Y','M'],keys=Object.keys(copy);return [...order.filter(k=>k in copy),...keys.filter(k=>!order.includes(k))].map(k=>k+Number(copy[k]||0)).join(' ')||'—'}
function fixHomeListDisplay(){const list=flights();document.querySelectorAll('#app .flight-home-row').forEach(row=>{const i=rowIndex(row),x=i!==null?list[i]:null;if(!x)return;const target=seatmapEconomyClass(x);repairFlight(x);row.querySelectorAll('.v2-metric').forEach(metric=>{const label=norm(metric.querySelector('.v2-metric-label')?.textContent),value=metric.querySelector('.v2-metric-value');if(!value)return;if(label==='CONFIG'){const t=cabinText(configObject(x),target);if(value.textContent!==t)value.textContent=t}if(label==='BOOKING'){const t=typeof window.__alyziaCanonBooking==='function'?window.__alyziaCanonBooking(x):cabinText(x.booked||x.booking||x.load?.booked,target);if(value.textContent!==t)value.textContent=t}})})}
function currentHomeSearch(){return String(document.querySelector('#app .home-flight-search input')?.value||'')}
function currentTerminal(){const buttons=[...document.querySelectorAll('#app button')];const active=buttons.find(b=>/^(T1|T2|T3|ALL)$/.test(norm(b.textContent))&&(b.classList.contains('active')||b.getAttribute('aria-pressed')==='true'||/selected|active|is-active/.test(String(b.className))));return active?norm(active.textContent):''}
function captureHomePosition(){window.__alyziaHomeReturnState={pending:true,y:Math.max(0,window.scrollY||document.documentElement.scrollTop||0),search:currentHomeSearch(),terminal:currentTerminal()}}
function restoreHomePosition(){const s=window.__alyziaHomeReturnState;if(!s?.pending)return;s.pending=false;const apply=()=>{const input=document.querySelector('#app .home-flight-search input');if(input&&input.value!==s.search){input.value=s.search||'';input.dispatchEvent(new Event('input',{bubbles:true}));try{if(typeof filterFlightHomeRows==='function')filterFlightHomeRows(input.value)}catch{}}if(s.terminal){const b=[...document.querySelectorAll('#app button')].find(x=>norm(x.textContent)===s.terminal);if(b&&!b.classList.contains('active')&&b.getAttribute('aria-pressed')!=='true')b.click()}window.scrollTo(0,Number(s.y||0))};[30,120,320].forEach(ms=>setTimeout(apply,ms))}
function resetHomeFilters(){const input=document.querySelector('#app .home-flight-search input');if(input){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));try{if(typeof filterFlightHomeRows==='function')filterFlightHomeRows('')}catch{}}const all=[...document.querySelectorAll('#app button')].find(b=>norm(b.textContent)==='ALL');if(all)all.click();const fav=[...document.querySelectorAll('#app button')].find(b=>(norm(b.textContent)==='★'||norm(b.textContent)==='☆')&&(b.classList.contains('active')||b.getAttribute('aria-pressed')==='true'));if(fav)fav.click()}
function ensureHomeControls(){const box=document.querySelector('#app .home-flight-search');if(box&&!box.querySelector('.alyzia-home-clear')){const b=document.createElement('button');b.type='button';b.className='alyzia-home-clear';b.setAttribute('aria-label','Effacer la recherche et réinitialiser les filtres');b.textContent='×';b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();resetHomeFilters()});box.appendChild(b)}let top=document.getElementById('alyzia-home-to-top');if(!top){top=document.createElement('button');top.id='alyzia-home-to-top';top.type='button';top.setAttribute('aria-label','Remonter en haut de la liste');top.textContent='↑';top.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));document.body.appendChild(top)}updateTopButton()}
function isHomeView(){try{return currentView==='home'}catch{return Boolean(document.querySelector('#app .flight-home-row'))}}
function updateTopButton(){const b=document.getElementById('alyzia-home-to-top');if(!b)return;b.classList.toggle('show',isHomeView()&&(window.scrollY||0)>500)}
function scheduleListFix(){[0,40,120,260,600].forEach(ms=>setTimeout(()=>{fixHomeListDisplay();ensureHomeControls()},ms))}
const baseHome=window.renderHome;if(typeof baseHome==='function')window.renderHome=function(...args){repairAll();const r=baseHome.apply(this,args);scheduleListFix();restoreHomePosition();return r};
const baseRender=window.render;if(typeof baseRender==='function')window.render=function(...args){repairCurrent();return baseRender.apply(this,args)};
document.addEventListener('click',e=>{const row=e.target?.closest?.('#app .flight-home-row');if(!row)return;const button=e.target?.closest?.('button');if(button&&!button.classList.contains('open')&&!button.classList.contains('v2-btn'))return;if(button?.classList.contains('fav'))return;captureHomePosition()},true);
window.addEventListener('scroll',updateTopButton,{passive:true});
repairAll();scheduleListFix();
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-economy-class-specificity"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}

export default {
 async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},
 scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
