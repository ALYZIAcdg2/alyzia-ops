import app from "./home-time-filter-v2-specificity-wrapper.js";

const UI=String.raw`<style id="alyzia-home-combined-count-css">
#app .alyzia-native-flight-count{display:none!important}
</style><script id="alyzia-home-filter-count-sync">(()=>{'use strict';
if(window.__alyziaHomeFilterCountSyncV3)return;window.__alyziaHomeFilterCountSyncV3=true;
const RANGES={'00–06':[0,360],'06–12':[360,720],'12–18':[720,1080],'18–24':[1080,1440]};
const norm=v=>String(v||'').toUpperCase().trim();
const minutes=v=>{const m=String(v||'').match(/(\d{1,2}):(\d{2})/);if(!m)return null;const h=Number(m[1]),mn=Number(m[2]);return h>=0&&h<24&&mn>=0&&mn<60?h*60+mn:null};
function activeTimeRange(){const txt=String(document.querySelector('#app .alyzia-time-filter-btn')?.textContent||'');for(const [label,range] of Object.entries(RANGES))if(txt.includes(label))return range;return null}
function stdFromRow(row){const txt=String(row.textContent||'').replace(/\s+/g,' '),m=txt.match(/\bSTD\s*(\d{1,2}:\d{2})\b/i);return m?minutes(m[1]):null}
function passesTime(row){const r=activeTimeRange();if(!r)return true;const t=stdFromRow(row);return t!==null&&t>=r[0]&&t<r[1]}
function applyTimeRangeAgain(){document.querySelectorAll('#app .flight-home-row').forEach(row=>row.classList.toggle('alyzia-final-time-hidden',!passesTime(row)))}
function nativeBadge(){const els=[...document.querySelectorAll('#app *')].filter(el=>!el.classList.contains('alyzia-combined-flight-count')&&el.children.length===0&&/^\s*\d+\s+VOLS?\s*$/i.test(String(el.textContent||'')));return els.find(el=>/badge|count|pill|chip/i.test(String(el.className||'')))||els[0]||null}
function ensureCombinedBadge(){let own=document.querySelector('#app .alyzia-combined-flight-count');const native=nativeBadge();if(!native)return own;if(!own){own=native.cloneNode(false);own.classList.add('alyzia-combined-flight-count');own.removeAttribute('id');native.insertAdjacentElement('afterend',own)}native.classList.add('alyzia-native-flight-count');return own}
function nativeVisibleIgnoringTime(row){const had=row.classList.contains('alyzia-final-time-hidden');if(had)row.classList.remove('alyzia-final-time-hidden');let visible=true;for(let el=row;el&&el!==document.body;el=el.parentElement){const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'){visible=false;break}if(el.id==='app')break}if(had)row.classList.add('alyzia-final-time-hidden');return visible}
function intersectionCount(){return [...document.querySelectorAll('#app .flight-home-row')].filter(row=>nativeVisibleIgnoringTime(row)&&passesTime(row)).length}
function updateCount(){const b=ensureCombinedBadge();if(!b)return;const n=intersectionCount();b.textContent=n+' VOL'+(n>1?'S':'')}
function reconcile(){applyTimeRangeAgain();updateCount()}
let timer=0;
function schedule(){clearTimeout(timer);reconcile();timer=setTimeout(reconcile,90);setTimeout(reconcile,260);setTimeout(reconcile,700)}
document.addEventListener('click',e=>{const b=e.target?.closest?.('#app button');if(!b)return;const t=norm(b.textContent);if(/^(T1|T2|T3|ALL|★|☆)$/.test(t)||b.classList.contains('alyzia-time-choice')||b.classList.contains('alyzia-home-clear'))schedule()},true);
document.addEventListener('input',e=>{if(e.target?.matches?.('#app .home-flight-search input'))schedule()},true);
const baseHome=window.renderHome;if(typeof baseHome==='function')window.renderHome=function(...args){const r=baseHome.apply(this,args);schedule();return r};
window.addEventListener('resize',schedule,{passive:true});window.addEventListener('orientationchange',schedule,{passive:true});
schedule();
})();</script>`;
function patch(html){let s=String(html||'');if(s.includes('id="alyzia-home-filter-count-sync"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}};
