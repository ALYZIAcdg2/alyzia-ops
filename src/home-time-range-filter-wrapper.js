import app from "./economy-class-specificity-wrapper.js";

const UI=String.raw`<style id="alyzia-home-time-filter-css">
#app .alyzia-time-hidden{display:none!important}
#app .alyzia-time-filter-btn{height:48px;min-width:54px;padding:0 14px;border:2px solid #d8e3ee;border-radius:999px;background:#fff;color:#28425f;font:900 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}
#app .alyzia-time-filter-btn.active{border-color:#0b70d1;background:#eef6ff;color:#0868c2}
#app .alyzia-time-filter-wrap{position:relative;display:inline-flex;align-items:center}
#app .alyzia-time-filter-menu{position:absolute;right:0;top:56px;z-index:80;display:none;grid-template-columns:1fr;gap:6px;padding:8px;background:#fff;border:1px solid #d9e4ef;border-radius:14px;box-shadow:0 10px 28px rgba(22,48,86,.15);min-width:150px}
#app .alyzia-time-filter-menu.open{display:grid}
#app .alyzia-time-choice{height:38px;border:1px solid #d8e3ee;border-radius:10px;background:#fff;color:#28425f;font:900 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
#app .alyzia-time-choice.active{background:#0b70d1;color:#fff;border-color:#0b70d1}
@media(max-width:620px){#app .alyzia-time-filter-btn{height:44px;min-width:50px;padding:0 11px;font-size:12px}#app .alyzia-time-filter-menu{top:50px;right:0}}
</style><script id="alyzia-home-time-filter-js">(()=>{'use strict';
if(window.__alyziaHomeTimeFilterV2)return;window.__alyziaHomeTimeFilterV2=true;
const norm=v=>String(v||'').toUpperCase().trim();
const ranges={A:{label:'00–08',start:0,end:480},B:{label:'08–16',start:480,end:960},C:{label:'16–24',start:960,end:1440}};
let activeRange='';
function flights(){try{return Array.isArray(FLIGHTS)?FLIGHTS:[]}catch{return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]}}
function rowIndex(row){const src=String(row.getAttribute('onclick')||row.querySelector('.home-open')?.getAttribute('onclick')||row.querySelector('[onclick]')?.getAttribute('onclick')||'');const m=src.match(/openFlightFromHomeList\((\d+)\)/);return m?Number(m[1]):null}
function hhmm(v){const m=String(v||'').match(/(\d{1,2}):(\d{2})/);if(!m)return null;const h=Number(m[1]),mn=Number(m[2]);return h>=0&&h<24&&mn>=0&&mn<60?h*60+mn:null}
function stdForRow(row,list){const txt=String(row?.textContent||'').replace(/\s+/g,' ');const shown=txt.match(/\bSTD\s*(\d{1,2}:\d{2})\b/i);if(shown){const t=hhmm(shown[1]);if(t!==null)return t}const i=rowIndex(row),x=i!==null?list[i]:null;if(!x)return null;let v=x?.std;try{if(!v&&typeof schedule==='function')v=schedule(x)?.std}catch{}return hhmm(v)}
function applyTimeFilter(){
 const r=ranges[activeRange]||null,list=flights();
 document.querySelectorAll('#app .flight-home-row').forEach(row=>{
  if(!r){row.classList.remove('alyzia-time-hidden');return}
  const t=stdForRow(row,list);row.classList.toggle('alyzia-time-hidden',t===null||t<r.start||t>=r.end)
 });
 const btn=document.querySelector('#app .alyzia-time-filter-btn');if(btn){btn.classList.toggle('active',!!activeRange);btn.textContent=activeRange?'◷ '+ranges[activeRange].label:'◷ 8H'}
 document.querySelectorAll('#app .alyzia-time-choice').forEach(b=>b.classList.toggle('active',b.dataset.range===activeRange));
}
function closeMenu(){document.querySelector('#app .alyzia-time-filter-menu')?.classList.remove('open')}
function resetTimeFilter(){activeRange='';applyTimeFilter();closeMenu()}
window.__alyziaResetHomeTimeFilter=resetTimeFilter;
window.__alyziaGetHomeTimeFilter=()=>activeRange;
window.__alyziaSetHomeTimeFilter=v=>{activeRange=ranges[v]?v:'';applyTimeFilter()};
function favoriteFilterButton(){return [...document.querySelectorAll('#app button')].find(b=>!b.closest('.flight-home-row')&&(norm(b.textContent)==='★'||norm(b.textContent)==='☆'))||null}
function ensureControl(){
 if(!document.querySelector('#app .flight-home-row'))return;
 let wrap=document.querySelector('#app .alyzia-time-filter-wrap');if(wrap){applyTimeFilter();return}
 const fav=favoriteFilterButton();if(!fav)return;
 wrap=document.createElement('span');wrap.className='alyzia-time-filter-wrap';
 const btn=document.createElement('button');btn.type='button';btn.className='alyzia-time-filter-btn';btn.textContent='◷ 8H';btn.setAttribute('aria-label','Filtrer par tranche horaire de 8 heures');
 const menu=document.createElement('span');menu.className='alyzia-time-filter-menu';
 Object.entries(ranges).forEach(([key,r])=>{const c=document.createElement('button');c.type='button';c.className='alyzia-time-choice';c.dataset.range=key;c.textContent=r.label;c.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();activeRange=activeRange===key?'':key;applyTimeFilter();closeMenu()});menu.appendChild(c)});
 btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();menu.classList.toggle('open')});wrap.append(btn,menu);fav.insertAdjacentElement('afterend',wrap);applyTimeFilter()
}
function scheduleApply(){[0,40,120,260,600].forEach(ms=>setTimeout(()=>{ensureControl();applyTimeFilter()},ms))}
const baseHome=window.renderHome;if(typeof baseHome==='function')window.renderHome=function(...args){const r=baseHome.apply(this,args);try{ensureControl();applyTimeFilter()}catch{}scheduleApply();return r};
document.addEventListener('click',e=>{if(!e.target?.closest?.('.alyzia-time-filter-wrap'))closeMenu()},true);
document.addEventListener('click',e=>{if(e.target?.closest?.('.alyzia-home-clear'))setTimeout(resetTimeFilter,0)},true);
document.addEventListener('input',e=>{if(e.target?.matches?.('#app .home-flight-search input'))setTimeout(applyTimeFilter,0)},true);
document.addEventListener('click',e=>{const b=e.target?.closest?.('#app button');if(!b)return;const t=norm(b.textContent);if(/^(T1|T2|T3|ALL|★|☆)$/.test(t))setTimeout(applyTimeFilter,0)},true);
document.addEventListener('click',e=>{const row=e.target?.closest?.('#app .flight-home-row');if(!row)return;const b=e.target?.closest?.('button');if(b?.classList?.contains('fav'))return;const s=window.__alyziaHomeReturnState;if(s?.pending)s.timeRange=activeRange},true);
const restoreTimer=()=>{const s=window.__alyziaHomeReturnState;if(s?.timeRange){activeRange=s.timeRange;[40,140,320].forEach(ms=>setTimeout(applyTimeFilter,ms))}};
document.addEventListener('DOMContentLoaded',restoreTimer,{once:true});
scheduleApply();
})();</script>`;
function patch(html){let s=String(html||'');if(s.includes('id="alyzia-home-time-filter-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}};
