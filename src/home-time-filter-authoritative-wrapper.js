import app from "./home-filter-ui-stability-wrapper.js";

const UI=String.raw`<style id="alyzia-home-time-authoritative-css">
#app .flight-home-row.v2-ready.alyzia-final-time-hidden{display:none!important}
</style><script id="alyzia-home-time-authoritative-js">(()=>{'use strict';
if(window.__alyziaHomeTimeAuthoritative)return;window.__alyziaHomeTimeAuthoritative=true;
const RANGES={'00–06':[0,360],'06–12':[360,720],'12–18':[720,1080],'18–24':[1080,1440]};
const norm=v=>String(v||'').toUpperCase().trim();
const mins=v=>{const m=String(v||'').match(/(\d{1,2}):(\d{2})/);if(!m)return null;const h=Number(m[1]),n=Number(m[2]);return h>=0&&h<24&&n>=0&&n<60?h*60+n:null};
function list(){try{return Array.isArray(FLIGHTS)?FLIGHTS:[]}catch{return Array.isArray(window.FLIGHTS)?window.FLIGHTS:[]}}
function flightNo(x){return norm(x?.flight||x?.flight_number||x?.flightNumber||'').replace(/\s+/g,'')}
function currentRange(){const txt=String(document.querySelector('#app .alyzia-time-filter-btn')?.textContent||'');for(const [label,r] of Object.entries(RANGES))if(txt.includes(label))return r;return null}
function rowFlight(row){
 const rows=list();
 const src=String(row.getAttribute('onclick')||row.querySelector('[onclick]')?.getAttribute('onclick')||'');
 const mi=src.match(/(?:openFlightFromHomeList|openFlight)\((\d+)/);if(mi&&rows[Number(mi[1])])return rows[Number(mi[1])];
 const txt=norm(row.textContent).replace(/\s+/g,' ');
 let best=null,bestLen=0;
 for(const x of rows){const no=flightNo(x);if(!no||no.length<3||no.length<=bestLen)continue;const compact=txt.replace(/\s+/g,'');if(compact.includes(no)){best=x;bestLen=no.length}}
 return best;
}
function stdFor(row){
 const x=rowFlight(row);
 if(x){const candidates=[x.std,x.schedule?.std,x.timings?.std,x.scheduledDeparture,x.departure?.scheduled];for(const v of candidates){const t=mins(v);if(t!==null)return t}try{if(typeof schedule==='function'){const t=mins(schedule(x)?.std);if(t!==null)return t}}catch{}}
 const txt=String(row.textContent||'').replace(/\s+/g,' ');let m=txt.match(/\bSTD\s*(\d{1,2}:\d{2})\b/i);if(m)return mins(m[1]);
 m=txt.match(/\bDÉPART\b[\s\S]{0,80}?\b(\d{1,2}:\d{2})\b/i);return m?mins(m[1]):null;
}
function nativeVisible(row){
 const had=row.classList.contains('alyzia-final-time-hidden');if(had)row.classList.remove('alyzia-final-time-hidden');
 let visible=true;for(let el=row;el&&el!==document.body;el=el.parentElement){const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'){visible=false;break}if(el.id==='app')break}
 if(had)row.classList.add('alyzia-final-time-hidden');return visible;
}
function ownBadge(){return document.querySelector('#app .alyzia-combined-flight-count')}
function reconcile(){
 const range=currentRange(),rows=[...document.querySelectorAll('#app .flight-home-row')];let count=0;
 for(const row of rows){const terminalPass=nativeVisible(row);const t=stdFor(row);const timePass=!range||(t!==null&&t>=range[0]&&t<range[1]);row.classList.toggle('alyzia-final-time-hidden',!timePass);if(terminalPass&&timePass)count++}
 const b=ownBadge();if(b)b.textContent=count+' VOL'+(count>1?'S':'');
}
let timer=0;
function scheduleFix(){clearTimeout(timer);[0,30,100,250,650,1200].forEach(ms=>setTimeout(reconcile,ms));timer=setTimeout(reconcile,1600)}
document.addEventListener('click',e=>{const b=e.target?.closest?.('#app button');if(!b)return;const t=norm(b.textContent);if(b.classList.contains('alyzia-time-choice')||/^(T1|T2|T3|ALL|★|☆)$/.test(t)||b.classList.contains('alyzia-home-clear'))scheduleFix()},true);
document.addEventListener('input',e=>{if(e.target?.matches?.('#app .home-flight-search input'))scheduleFix()},true);
const base=window.renderHome;if(typeof base==='function')window.renderHome=function(...args){const r=base.apply(this,args);scheduleFix();return r};
window.addEventListener('resize',scheduleFix,{passive:true});window.addEventListener('orientationchange',scheduleFix,{passive:true});
scheduleFix();
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-home-time-authoritative-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI}
export default {async fetch(request,env,ctx){const response=await app.fetch(request,env,ctx);const type=String(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('text/html'))return response;const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');return new Response(patch(html),{status:response.status,statusText:response.statusText,headers})},scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}};
