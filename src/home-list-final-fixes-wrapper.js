import app from "./home-time-range-filter-wrapper.js";

const UI=String.raw`<style id="alyzia-home-list-final-fixes-css">
#app .alyzia-home-clear{position:relative!important;right:auto!important;top:auto!important;transform:none!important;flex:0 0 40px;width:40px;height:40px;margin-left:-48px;margin-right:8px;border:0;border-radius:50%;background:#eef4fa;color:#526b88;font-size:22px;font-weight:800;display:inline-grid;place-items:center;cursor:pointer;z-index:6;vertical-align:middle}
#app .home-flight-search input{padding-right:54px!important}
#app .alyzia-time-filter-wrap{position:relative;display:inline-flex!important;align-items:center;margin-left:8px;vertical-align:middle}
#app .alyzia-time-filter-btn{height:46px;min-width:62px;padding:0 13px;border:2px solid #d8e3ee;border-radius:999px;background:#fff;color:#28425f;font:900 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
#app .alyzia-time-filter-btn.active{border-color:#0b70d1;background:#eef6ff;color:#0868c2}
#app .alyzia-time-filter-menu{position:absolute;left:0;top:52px;z-index:200;display:none;gap:6px;padding:8px;background:#fff;border:1px solid #d9e4ef;border-radius:14px;box-shadow:0 10px 28px rgba(22,48,86,.15);min-width:154px}
#app .alyzia-time-filter-menu.open{display:grid!important}
#app .alyzia-time-choice{height:38px;border:1px solid #d8e3ee;border-radius:10px;background:#fff;color:#28425f;font:900 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
#app .alyzia-time-choice.active{background:#0b70d1;color:#fff;border-color:#0b70d1}
@media(max-width:620px){#app .alyzia-home-clear{width:38px;height:38px;flex-basis:38px;margin-left:-46px;margin-right:6px}#app .alyzia-time-filter-wrap{margin-left:6px}#app .alyzia-time-filter-btn{height:44px;min-width:58px}}
</style><script id="alyzia-home-list-final-fixes-js">(()=>{'use strict';
if(window.__alyziaHomeListFinalFixes)return;window.__alyziaHomeListFinalFixes=true;
const norm=v=>String(v||'').toUpperCase().trim();
function flights(){try{return Array.isArray(FLIGHTS)?FLIGHTS:[]}catch{return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]}}
function airline(x){return norm(x?.airline||String(x?.flight||'').match(/^[A-Z0-9]+?(?=\d)/)?.[0]||'')}
function catalog(){try{return typeof SARIA_FALLBACK_CATALOG!=='undefined'&&Array.isArray(SARIA_FALLBACK_CATALOG)?SARIA_FALLBACK_CATALOG:[]}catch{return []}}
function cfg(x){return x?.config||x?.cabinConfig||x?.capacity||x?.cabin_configuration||null}
function pairTarget(x,a,b){
 const c=cfg(x);if(c&&typeof c==='object'&&!Array.isArray(c)){const av=Number(c[a]||0),bv=Number(c[b]||0);if(av>0&&bv<=0)return a;if(bv>0&&av<=0)return b}
 const al=airline(x),ac=norm(x?.aircraft).replace(/\s+/g,'');if(!al||!ac)return '';
 const rows=catalog().filter(e=>norm(e?.cie)===al&&norm(e?.ac).replace(/\s+/g,'')===ac).sort((p,q)=>Number(q?.freq||0)-Number(p?.freq||0));
 const classes=(rows[0]?.classes||[]).map(p=>norm(p?.[0]));const ah=classes.includes(a),bh=classes.includes(b);return ah&&!bh?a:bh&&!ah?b:''
}
function movePair(obj,target,a,b){if(!obj||typeof obj!=='object'||Array.isArray(obj)||!target)return false;const other=target===a?b:a;if(!(other in obj))return false;const tv=Number(obj[target]||0),ov=Number(obj[other]||0);if(tv<=0&&ov>0)obj[target]=ov;delete obj[other];return true}
function repairJC(x){const target=pairTarget(x,'J','C');if(!target)return false;let changed=false;for(const k of ['config','booked','web','meals','available'])changed=movePair(x?.[k],target,'J','C')||changed;return changed}
function rowIndex(row){const src=String(row.getAttribute('onclick')||row.querySelector('.home-open')?.getAttribute('onclick')||'');const m=src.match(/openFlightFromHomeList\((\d+)\)/);return m?Number(m[1]):null}
function cabinText(obj,x){if(!obj||typeof obj!=='object')return String(obj||'—');const copy={...obj},jc=pairTarget(x,'J','C');if(jc)delete copy[jc==='J'?'C':'J'];const ym=(()=>{const c=cfg(x);if(c&&typeof c==='object'){const y=Number(c.Y||0),m=Number(c.M||0);if(m>0&&y<=0)return'M';if(y>0&&m<=0)return'Y'}return ''})();if(ym)delete copy[ym==='Y'?'M':'Y'];const order=['F','J','C','S','W','E','Y','M'],keys=Object.keys(copy);return [...order.filter(k=>k in copy),...keys.filter(k=>!order.includes(k))].map(k=>k+Number(copy[k]||0)).join(' ')||'—'}
function fixRows(){const list=flights();document.querySelectorAll('#app .flight-home-row').forEach(row=>{const i=rowIndex(row),x=i!==null?list[i]:null;if(!x)return;repairJC(x);row.querySelectorAll('.v2-metric').forEach(m=>{const label=norm(m.querySelector('.v2-metric-label')?.textContent),v=m.querySelector('.v2-metric-value');if(!v)return;if(label==='CONFIG')v.textContent=cabinText(cfg(x),x);if(label==='BOOKING')v.textContent=cabinText(x.booked||x.booking||x.load?.booked,x)})})}
function clearHome(){const input=document.querySelector('#app .home-flight-search input');if(input){input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));try{if(typeof filterFlightHomeRows==='function')filterFlightHomeRows('')}catch{}}try{window.__alyziaResetHomeTimeFilter?.()}catch{}const all=[...document.querySelectorAll('#app button')].find(b=>norm(b.textContent)==='ALL');if(all)all.click();const fav=[...document.querySelectorAll('#app button')].find(b=>/FAVOR|★|☆/.test(norm((b.getAttribute('aria-label')||'')+' '+(b.title||'')+' '+b.textContent))&&(b.classList.contains('active')||b.getAttribute('aria-pressed')==='true'));if(fav)fav.click()}
function ensureClear(){const input=document.querySelector('#app .home-flight-search input');if(!input)return;document.querySelectorAll('#app .alyzia-home-clear').forEach(b=>b.remove());const b=document.createElement('button');b.type='button';b.className='alyzia-home-clear';b.textContent='×';b.setAttribute('aria-label','Effacer recherche et filtres');b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();clearHome()});input.insertAdjacentElement('afterend',b)}
function controlsHost(){const all=[...document.querySelectorAll('#app button')].find(b=>norm(b.textContent)==='ALL'&&!b.closest('.flight-home-row'));return all?.parentElement||null}
function ensureTime(){
 let wrap=document.querySelector('#app .alyzia-time-filter-wrap');if(wrap)return;
 const host=controlsHost();if(!host||typeof window.__alyziaSetHomeTimeFilter!=='function')return;
 wrap=document.createElement('span');wrap.className='alyzia-time-filter-wrap';const btn=document.createElement('button');btn.type='button';btn.className='alyzia-time-filter-btn';btn.textContent='◷ 8H';
 const menu=document.createElement('span');menu.className='alyzia-time-filter-menu';[['A','00–08'],['B','08–16'],['C','16–24']].forEach(([k,label])=>{const c=document.createElement('button');c.type='button';c.className='alyzia-time-choice';c.dataset.range=k;c.textContent=label;c.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const cur=window.__alyziaGetHomeTimeFilter?.()||'';window.__alyziaSetHomeTimeFilter(cur===k?'':k);menu.classList.remove('open');syncTimeUi()});menu.appendChild(c)});btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();menu.classList.toggle('open')});wrap.append(btn,menu);host.appendChild(wrap);syncTimeUi()
}
function syncTimeUi(){const cur=window.__alyziaGetHomeTimeFilter?.()||'',labels={A:'00–08',B:'08–16',C:'16–24'},btn=document.querySelector('#app .alyzia-time-filter-btn');if(btn){btn.classList.toggle('active',!!cur);btn.textContent=cur?'◷ '+labels[cur]:'◷ 8H'}document.querySelectorAll('#app .alyzia-time-choice').forEach(b=>b.classList.toggle('active',b.dataset.range===cur))}
function ensure(){fixRows();ensureClear();ensureTime();syncTimeUi()}
function schedule(){[0,40,120,260,600].forEach(ms=>setTimeout(ensure,ms))}
const baseHome=window.renderHome;if(typeof baseHome==='function')window.renderHome=function(...args){for(const x of flights())repairJC(x);const r=baseHome.apply(this,args);schedule();return r};
document.addEventListener('click',e=>{if(!e.target?.closest?.('.alyzia-time-filter-wrap'))document.querySelector('#app .alyzia-time-filter-menu')?.classList.remove('open')},true);
window.addEventListener('resize',schedule,{passive:true});
schedule();
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-home-list-final-fixes-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}};
