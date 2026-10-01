import app from "./home-time-filter-v2-specificity-wrapper.js";

const UI=String.raw`<style id="alyzia-home-combined-count-css">
#app .alyzia-native-flight-count,#app #homeVisibleFlightCount:not(.alyzia-combined-flight-count){display:none!important}
</style><script id="alyzia-home-filter-count-sync">(()=>{'use strict';
if(window.__alyziaHomeFilterCountSyncV4)return;window.__alyziaHomeFilterCountSyncV4=true;
const norm=v=>String(v||'').toUpperCase().trim();
function nativeBadge(){const els=[...document.querySelectorAll('#app *')].filter(el=>!el.classList.contains('alyzia-combined-flight-count')&&el.children.length===0&&/^\s*\d+\s+VOLS?\s*$/i.test(String(el.textContent||'')));return els.find(el=>/badge|count|pill|chip/i.test(String(el.className||'')))||els[0]||null}
function ensureCombinedBadge(){let own=document.querySelector('#app .alyzia-combined-flight-count');const native=nativeBadge();if(!native)return own;if(!own){own=native.cloneNode(false);own.classList.add('alyzia-combined-flight-count');own.removeAttribute('id');native.insertAdjacentElement('afterend',own)}native.classList.add('alyzia-native-flight-count');return own}
function visibleRows(){return [...document.querySelectorAll('#app .flight-home-row')].filter(row=>{if(row.hidden||row.getAttribute('aria-hidden')==='true')return false;for(let el=row;el&&el!==document.body;el=el.parentElement){const cs=getComputedStyle(el);if(cs.display==='none')return false;if(el.id==='app')break}return true})}
function updateCount(){const b=ensureCombinedBadge();if(!b)return;const n=visibleRows().length;const t=n+' VOL'+(n>1?'S':'');if(b.textContent!==t)b.textContent=t}
let timer=0;
function schedule(){clearTimeout(timer);[0,40,120,300,700,1500,2500].forEach(ms=>setTimeout(updateCount,ms));timer=setTimeout(updateCount,1200)}
document.addEventListener('click',e=>{const b=e.target?.closest?.('#app button');if(!b)return;const t=norm(b.textContent);if(/^(T1|T2|T3|ALL|★|☆)$/.test(t)||b.classList.contains('alyzia-time-choice')||b.classList.contains('alyzia-home-clear'))schedule()},true);
document.addEventListener('input',e=>{if(e.target?.matches?.('#app .home-flight-search input'))schedule()},true);
const baseHome=window.renderHome;if(typeof baseHome==='function')window.renderHome=function(...args){const r=baseHome.apply(this,args);try{updateCount()}catch{}schedule();return r};
window.addEventListener('resize',schedule,{passive:true});window.addEventListener('orientationchange',schedule,{passive:true});
schedule();
})();</script>`;
function patch(html){let s=String(html||'');if(s.includes('id="alyzia-home-filter-count-sync"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}};
