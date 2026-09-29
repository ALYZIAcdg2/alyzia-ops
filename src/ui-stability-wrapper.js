import app from "./flight-status-authoritative-wrapper.js";
import providerPolicyScheduler from "./provider-policy-scheduler.js";

const UI_STABILITY=String.raw`<style id="alyzia-ui-stability-css">
html.alyzia-ui-stability-loading #app{visibility:hidden!important}
</style><script id="alyzia-ui-stability-head-js">(()=>{
  'use strict';
  const root=document.documentElement;
  if(root.classList.contains('alyzia-ui-stability-ready'))return;
  root.classList.add('alyzia-ui-stability-ready','alyzia-ui-stability-loading');
  let revealed=false,fullListSeen=false,timer=null;
  const reveal=()=>{if(revealed)return;revealed=true;clearTimeout(timer);requestAnimationFrame(()=>requestAnimationFrame(()=>root.classList.remove('alyzia-ui-stability-loading')))};
  const isFullFlightsRequest=raw=>{
    try{const u=new URL(String(raw||''),location.origin);return u.pathname==='/api/flights'&&!u.searchParams.has('identity')}catch{return false}
  };
  const baseFetch=window.fetch;
  if(typeof baseFetch==='function')window.fetch=async function(...args){
    const raw=typeof args[0]==='string'?args[0]:String(args[0]?.url||'');
    const full=isFullFlightsRequest(raw);
    const response=await baseFetch.apply(this,args);
    if(full&&response?.ok&&!fullListSeen){fullListSeen=true;clearTimeout(timer);timer=setTimeout(reveal,180)}
    return response;
  };
  timer=setTimeout(reveal,8000);
})();</script>`;

const NAV_STABILITY=String.raw`<script id="alyzia-ui-stability-nav-js">(()=>{
  'use strict';
  if(window.__alyziaUiStabilityInstalled)return;window.__alyziaUiStabilityInstalled=true;
  let homeLockUntil=0,lastHomeScroll=0;
  const lockHome=()=>{homeLockUntil=Date.now()+4500;window.__alyziaHomeNavigationLockUntil=homeLockUntil};
  const homeLocked=()=>Date.now()<homeLockUntil;
  const detailVisible=()=>Boolean(document.querySelector('#app .flight-head'));
  const isHomeReturnControl=el=>{
    const b=el?.closest?.('.flight-back-btn,[data-mobile-nav="home"],[data-mobile-nav="flights"]');
    if(b)return true;
    const btn=el?.closest?.('button');
    return Boolean(detailVisible()&&btn&&/^\s*(?:✈️\s*)?VOLS?\s*$/i.test(String(btn.textContent||'')));
  };
  const isFlightOpenControl=el=>Boolean(el?.closest?.('#app .flight-home-row,#app [data-flight-index],#app .ops-search-flight'));

  document.addEventListener('click',e=>{
    if(isFlightOpenControl(e.target)&&!detailVisible())lastHomeScroll=window.scrollY||0;
    if(isHomeReturnControl(e.target))lockHome();
  },true);

  const restoreDetailScroll=(y)=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(detailVisible()&&!homeLocked()&&Math.abs((window.scrollY||0)-y)>2)window.scrollTo({top:y,left:0,behavior:'auto'});
  }));
  const restoreHomeScroll=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(!detailVisible()&&homeLocked())window.scrollTo({top:lastHomeScroll,left:0,behavior:'auto'});
  }));

  function install(){
    let count=0;
    try{
      if(typeof render==='function'&&!render.__alyziaUiStable){
        const original=render;
        const wrapped=function(...args){
          if(homeLocked()&&!detailVisible())return;
          const wasDetail=detailVisible(),y=window.scrollY||0;
          const out=original.apply(this,args);
          if(wasDetail&&!homeLocked())restoreDetailScroll(y);
          else if(homeLocked())restoreHomeScroll();
          return out;
        };
        wrapped.__alyziaUiStable=true;render=wrapped;count++;
      }
    }catch{}
    try{
      if(typeof renderHome==='function'&&!renderHome.__alyziaUiStable){
        const original=renderHome;
        const wrapped=function(...args){const out=original.apply(this,args);if(homeLocked())restoreHomeScroll();return out};
        wrapped.__alyziaUiStable=true;renderHome=wrapped;count++;
      }
    }catch{}
    try{
      if(typeof syncSelectedFlightFast==='function'&&!syncSelectedFlightFast.__alyziaUiStable){
        const original=syncSelectedFlightFast;
        const wrapped=async function(...args){
          if(homeLocked()||!detailVisible())return;
          const y=window.scrollY||0;
          const out=await original.apply(this,args);
          if(!homeLocked()&&detailVisible())restoreDetailScroll(y);
          return out;
        };
        wrapped.__alyziaUiStable=true;syncSelectedFlightFast=wrapped;count++;
      }
    }catch{}
    try{
      if(typeof scheduleSelectedFlightSync==='function'&&!scheduleSelectedFlightSync.__alyziaUiStable){
        const original=scheduleSelectedFlightSync;
        const wrapped=function(...args){if(homeLocked()||!detailVisible())return;return original.apply(this,args)};
        wrapped.__alyziaUiStable=true;scheduleSelectedFlightSync=wrapped;count++;
      }
    }catch{}
    return count;
  }
  let tries=0;const retry=()=>{tries++;install();if(tries<24)setTimeout(retry,250)};retry();
})();</script>`;

function patch(html){
  let s=String(html||'');
  if(!s.includes('id="alyzia-ui-stability-head-js"')){
    const h=s.indexOf('<head>');
    s=h>=0?s.slice(0,h+6)+UI_STABILITY+s.slice(h+6):UI_STABILITY+s;
  }
  if(!s.includes('id="alyzia-ui-stability-nav-js"')){
    const i=s.lastIndexOf('</body>');
    s=i>=0?s.slice(0,i)+NAV_STABILITY+'\n'+s.slice(i):s+NAV_STABILITY;
  }
  return s;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text();
    const headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof providerPolicyScheduler.scheduled==='function')return providerPolicyScheduler.scheduled(controller,env,ctx);
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
