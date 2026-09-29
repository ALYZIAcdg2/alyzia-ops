import app from "./flight-card-top-fix-wrapper.js";
import providerPolicyScheduler from "./provider-policy-scheduler.js";

const UI=String.raw`<script id="alyzia-flight-status-authoritative-js">(()=>{
  'use strict';
  if(window.__alyziaFlightStatusAuthoritative)return;
  window.__alyziaFlightStatusAuthoritative=true;

  const txt=v=>String(v??'').trim();
  const up=v=>txt(v).toUpperCase();
  const hh=v=>{const m=txt(v).match(/(\d{2}):(\d{2})/);return m?{h:Number(m[1]),m:Number(m[2])}:null};
  const dayNumber=d=>{const m=txt(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null};
  const serviceDate=()=>{
    try{if(typeof HOME_DATE!=='undefined'&&/^\d{4}-\d{2}-\d{2}$/.test(String(HOME_DATE)))return String(HOME_DATE)}catch{}
    try{if(typeof f==='function'){const d=String(f()?.activeDate||'');if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d}}catch{}
    return '';
  };
  const tzOf=code=>{
    const k=up(code);
    try{if(typeof TZ!=='undefined'&&TZ&&Number.isFinite(Number(TZ[k])))return Number(TZ[k])}catch{}
    try{if(window.TZ&&Number.isFinite(Number(window.TZ[k])))return Number(window.TZ[k])}catch{}
    return k==='CDG'?2:null;
  };
  const route=card=>{const m=txt(card.querySelector('.v2-route')?.textContent).match(/([A-Z]{3})\s*→\s*([A-Z]{3})/i);return m?{origin:up(m[1]),dest:up(m[2])}:null};
  const timeByLabel=(card,label)=>{
    const wanted=up(label);
    for(const cell of card.querySelectorAll('.v2-time-cell')){
      if(up(cell.querySelector('.v2-time-label')?.textContent)===wanted)return txt(cell.querySelector('.v2-time-value')?.textContent);
    }
    return '';
  };
  const absoluteUtcMinute=(date,localTime,offset)=>{
    const d=dayNumber(date),t=hh(localTime);
    if(d==null||!t||offset==null)return null;
    return d*1440+t.h*60+t.m-offset*60;
  };
  const arrivalUtcMinute=(date,depTime,arrTime,origin,dest)=>{
    const depOff=tzOf(origin),arrOff=tzOf(dest);
    let dep=absoluteUtcMinute(date,depTime,depOff),arr=absoluteUtcMinute(date,arrTime,arrOff);
    if(dep==null||arr==null)return null;
    while(arr<dep)arr+=1440;
    return arr;
  };
  const nowUtcMinute=()=>Date.now()/60000;
  const setBadge=(badge,label)=>{
    const cls=label.startsWith('ARRIVÉ')?'arrive':'envol';
    if(txt(badge.textContent)!==label||!badge.classList.contains(cls)){
      badge.textContent=label;
      badge.className='v2-status '+cls;
    }
  };
  const fmtRemain=min=>{
    const n=Math.max(0,Math.ceil(min));
    return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  };

  function fixCard(card){
    const badge=card.querySelector('.v2-status');if(!badge)return;
    const r=route(card);if(!r)return;
    const date=serviceDate();if(!date)return;
    const std=timeByLabel(card,'STD');
    const atd=timeByLabel(card,'ATD');
    const sta=timeByLabel(card,'STA');
    const ata=timeByLabel(card,'ATA');
    const eta=timeByLabel(card,'ETA');
    if(!atd)return;
    if(ata){setBadge(badge,'ARRIVÉ');return}
    const arrival=arrivalUtcMinute(date,atd||std,eta||sta,r.origin,r.dest);
    if(arrival==null){setBadge(badge,'EN VOL');return}
    const left=arrival-nowUtcMinute();
    if(left<=-15){setBadge(badge,'ARRIVÉ');return}
    setBadge(badge,'EN VOL · RESTE '+fmtRemain(left));
  }
  const run=()=>document.querySelectorAll('#app .v2-card').forEach(fixCard);
  let queued=false;
  const queue=()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;run()},60)};
  const start=()=>{run();new MutationObserver(queue).observe(document.getElementById('app')||document.documentElement,{childList:true,subtree:true,characterData:true});setInterval(run,1000)};
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
})();</script>`;

function patch(html){
  const s=String(html||'');
  if(s.includes('id="alyzia-flight-status-authoritative-js"'))return s;
  const i=s.lastIndexOf('</body>');
  return i>=0?s.slice(0,i)+UI+'\n'+s.slice(i):s+UI;
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
