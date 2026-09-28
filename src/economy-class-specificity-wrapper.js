import app from "./ops-ui-fixes-wrapper.js";

const UI=String.raw`<script id="alyzia-economy-class-specificity">(()=>{'use strict';
if(window.__alyziaEconomyClassSpecificity)return;window.__alyziaEconomyClassSpecificity=true;
const norm=v=>String(v||'').toUpperCase().trim();
function flights(){try{return Array.isArray(FLIGHTS)?FLIGHTS:[]}catch{return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]}}
function airline(x){return norm(x?.airline||String(x?.flight||'').match(/^[A-Z0-9]+?(?=\d)/)?.[0]||'')}
function catalog(){try{return typeof SARIA_FALLBACK_CATALOG!=='undefined'&&Array.isArray(SARIA_FALLBACK_CATALOG)?SARIA_FALLBACK_CATALOG:[]}catch{return []}}
function seatmapEconomyClass(x){
 const a=airline(x),ac=norm(x?.aircraft).replace(/\s+/g,'');if(!a||!ac)return '';
 const rows=catalog().filter(e=>norm(e?.cie)===a&&norm(e?.ac).replace(/\s+/g,'')===ac).sort((p,q)=>Number(q?.freq||0)-Number(p?.freq||0));
 const classes=(rows[0]?.classes||[]).map(p=>norm(p?.[0]));
 const hasM=classes.includes('M'),hasY=classes.includes('Y');
 return hasM&&!hasY?'M':hasY&&!hasM?'Y':'';
}
function moveEconomy(obj,target){
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||!target)return false;
 const other=target==='M'?'Y':'M';if(!(other in obj))return false;
 const targetVal=Number(obj[target]||0),otherVal=Number(obj[other]||0);obj[target]=targetVal||otherVal;delete obj[other];return true;
}
function repairFlight(x){
 const target=seatmapEconomyClass(x);if(!target)return false;let changed=false;
 for(const k of ['config','booked','web','meals','available'])changed=moveEconomy(x?.[k],target)||changed;
 if(changed){x.economyClassSource='SEATMAP';x.economyClassUpdatedAt=new Date().toISOString()}
 return changed;
}
function repairAll(){let changed=false;for(const x of flights())changed=repairFlight(x)||changed;return changed}
function repairCurrent(){try{return typeof f==='function'?repairFlight(f()):false}catch{return false}}
function rowIndex(row){const src=String(row.getAttribute('onclick')||row.querySelector('.home-open')?.getAttribute('onclick')||'');const m=src.match(/openFlightFromHomeList\((\d+)\)/);return m?Number(m[1]):null}
function cabinText(obj){if(!obj||typeof obj!=='object')return String(obj||'—');const order=['F','J','C','S','W','E','Y','M'],keys=Object.keys(obj);return [...order.filter(k=>k in obj),...keys.filter(k=>!order.includes(k))].map(k=>k+Number(obj[k]||0)).join(' ')||'—'}
function fixHomeListDisplay(){
 const list=flights();document.querySelectorAll('#app .flight-home-row').forEach(row=>{
  const i=rowIndex(row),x=i!==null?list[i]:null;if(!x)return;repairFlight(x);
  row.querySelectorAll('.v2-metric').forEach(metric=>{
   const label=norm(metric.querySelector('.v2-metric-label')?.textContent),value=metric.querySelector('.v2-metric-value');if(!value)return;
   if(label==='CONFIG')value.textContent=cabinText(x.config||x.cabinConfig||x.capacity||x.cabin_configuration);
   if(label==='BOOKING')value.textContent=cabinText(x.booked||x.booking||x.load?.booked);
  });
 })
}
function scheduleListFix(){[0,40,120,260].forEach(ms=>setTimeout(fixHomeListDisplay,ms))}
const baseHome=window.renderHome;if(typeof baseHome==='function')window.renderHome=function(...args){repairAll();const r=baseHome.apply(this,args);scheduleListFix();return r};
const baseRender=window.render;if(typeof baseRender==='function')window.render=function(...args){repairCurrent();const r=baseRender.apply(this,args);setTimeout(()=>{if(repairCurrent())baseRender.apply(this,args)},30);return r};
const baseAircraftChange=window.onSariaAircraftChange;if(typeof baseAircraftChange==='function')window.onSariaAircraftChange=function(value){const r=baseAircraftChange.call(this,value);setTimeout(()=>{if(repairCurrent()){try{persistFlightAction('CLASSE ÉCO SYNCHRONISÉE AU SEATMAP')}catch{}try{baseRender?.()}catch{}}},0);return r};
repairAll();scheduleListFix();
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-economy-class-specificity"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}

export default {
 async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},
 scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
