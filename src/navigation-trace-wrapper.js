import app from "./admin-dashboard-v4-wrapper.js";

const TRACE=String.raw`<script id="alyzia-navigation-trace-js">(()=>{'use strict';
if(window.__alyziaNavTraceInstalled)return;window.__alyziaNavTraceInstalled=true;
const traces=[];window.__alyziaNavTrace=traces;
const safe=(fn,fallback='?')=>{try{return fn()}catch{return fallback}};
const snapshot=(name)=>({
  ts:new Date().toISOString(),
  fn:name,
  view:safe(()=>String(currentView||'')),
  selected:safe(()=>selected),
  selectedDate:safe(()=>String(selectedDate||'')),
  homeDate:safe(()=>String(HOME_DATE||'')),
  flight:safe(()=>String((typeof f==='function'&&f())?.flight||'')),
  stack:String(new Error('[ALYZIA NAV TRACE] '+name).stack||'').split('\n').slice(2,12).join('\n')
});
function record(name){
  const x=snapshot(name);traces.push(x);if(traces.length>80)traces.shift();
  const suspicious=name==='renderHome'&&x.view&&x.view!=='home';
  const method=suspicious?'error':'warn';
  console[method]('[ALYZIA NAV TRACE]',name,{view:x.view,selected:x.selected,flight:x.flight,selectedDate:x.selectedDate,homeDate:x.homeDate});
  console[method](x.stack);
}
function install(){
  let installed=0;
  try{
    if(typeof renderHome==='function'&&!renderHome.__alyziaTraceWrapped){const original=renderHome;const wrapped=function(...args){record('renderHome');return original.apply(this,args)};wrapped.__alyziaTraceWrapped=true;renderHome=wrapped;installed++}
  }catch(e){console.warn('[ALYZIA NAV TRACE] renderHome non enveloppé',e)}
  try{
    if(typeof render==='function'&&!render.__alyziaTraceWrapped){const original=render;const wrapped=function(...args){record('render');return original.apply(this,args)};wrapped.__alyziaTraceWrapped=true;render=wrapped;installed++}
  }catch(e){console.warn('[ALYZIA NAV TRACE] render non enveloppé',e)}
  return installed;
}
window.dumpAlyziaNavTrace=()=>{console.table(traces.map(x=>({heure:x.ts.slice(11,19),fonction:x.fn,vue:x.view,selected:x.selected,vol:x.flight,date:x.selectedDate})));console.log('[ALYZIA NAV TRACE FULL]',JSON.stringify(traces,null,2));return traces};
window.clearAlyziaNavTrace=()=>{traces.splice(0,traces.length);console.log('[ALYZIA NAV TRACE] vidé')};
let tries=0;const retry=()=>{tries++;const n=install();if(n<2&&tries<12)setTimeout(retry,250)};retry();
console.info('[ALYZIA NAV TRACE] diagnostic navigation actif · dumpAlyziaNavTrace() pour afficher les traces');
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-navigation-trace-js"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+TRACE+'\n'+s.slice(i):s+TRACE}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
