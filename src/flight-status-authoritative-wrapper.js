import app from "./flight-card-top-fix-wrapper.js";
import providerPolicyScheduler from "./provider-policy-scheduler.js";

const UI=String.raw`<style id="alyzia-flight-status-authoritative-css">
#app .v2-status{font-size:14px!important;padding:8px 13px!important}
#app .v2-status.ops-time-alert,
.flight-detail-status-wrap .v2-status.ops-time-alert{background:#fee8ec!important;color:#d91f34!important}
.flight-head .duration{font-size:21px!important;font-weight:950!important}
.flight-detail-status-wrap{display:flex;align-items:center;margin-top:6px;min-height:32px}
.flight-detail-terminal.term-t1{background:#0a4aa8;border-color:#0a4aa8;color:#fff}.flight-detail-terminal.term-t2{background:#0d7a27;border-color:#0d7a27;color:#fff}.flight-detail-terminal.term-t3{background:#a80c66;border-color:#a80c66;color:#fff}
.flight-detail-terminal{display:inline-flex;align-items:center;margin-right:8px;padding:8px 13px;border-radius:999px;background:#eef3f8;border:1px solid #dbe5ef;color:#28425f;font:900 14px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap}
.flight-detail-status-wrap .v2-status{font-size:14px!important;padding:8px 13px!important}
@media(max-width:620px){
  #app .v2-status{font-size:12px!important;padding:7px 11px!important}
  .flight-head .duration{font-size:17px!important}
  .flight-detail-status-wrap .v2-status{font-size:12px!important;padding:7px 11px!important}
  .flight-detail-terminal{font-size:12px;padding:7px 11px}
}
</style><script id="alyzia-flight-status-authoritative-js">(()=>{
  'use strict';
  if(window.__alyziaFlightStatusAuthoritative)return;
  window.__alyziaFlightStatusAuthoritative=true;

  const txt=v=>String(v??'').trim();
  const up=v=>txt(v).toUpperCase();
  const hh=v=>{const m=txt(v).match(/(\d{2}):(\d{2})/);return m?{h:Number(m[1]),m:Number(m[2])}:null};
  const minuteOfDay=v=>{const t=hh(v);return t?t.h*60+t.m:null};
  const minuteDelta=(scheduled,actual)=>{const a=minuteOfDay(scheduled),b=minuteOfDay(actual);if(a==null||b==null)return null;let d=b-a;if(d<-720)d+=1440;if(d>720)d-=1440;return d};
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
  const cardHasRedOperationalTime=card=>{
    for(const cell of card.querySelectorAll('.v2-time-cell')){
      const label=up(cell.querySelector('.v2-time-label')?.textContent);
      if(!['ETD','ATD','ETA','ATA'].includes(label))continue;
      const value=cell.querySelector('.v2-time-value');
      if(value?.classList.contains('late')||value?.classList.contains('red'))return true;
    }
    return false;
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
  const fmtRemain=min=>{
    const n=Math.max(0,Math.ceil(min));
    return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  };
  const statusClass=label=>{
    const s=up(label);
    if(s.startsWith('ARRIVÉ'))return 'arrive';
    if(s.startsWith('EN VOL'))return 'envol';
    if(s.includes('ANNUL'))return 'annule';
    if(s.includes('RETARD'))return 'retarde';
    if(s.includes('EMBAR'))return 'embarquement';
    if(s.includes('DÉCOLL')||s.includes('DECOLL'))return 'decolle';
    if(s.includes('CONFIRM'))return 'aconfirmer';
    if(s.includes('PRÉVU')||s.includes('PREVU'))return 'prevu';
    if(s.includes('HEURE'))return 'alheure';
    return 'programme';
  };
  const setBadge=(badge,label,timeAlert=false)=>{
    const cls=statusClass(label),wanted='v2-status '+cls+(timeAlert?' ops-time-alert':'');
    if(txt(badge.textContent)!==label||badge.className!==wanted){
      badge.textContent=label;
      badge.className=wanted;
    }
  };
  const getCurrentFlight=()=>{
    try{if(typeof FLIGHTS!=='undefined'&&Array.isArray(FLIGHTS)&&typeof selected!=='undefined'&&FLIGHTS[selected])return FLIGHTS[selected]}catch{}
    try{if(Array.isArray(window.FLIGHTS)&&Number.isInteger(window.selected)&&window.FLIGHTS[window.selected])return window.FLIGHTS[window.selected]}catch{}
    return null;
  };
  const OPS_TOL=5;
  const flightHasRedOperationalTime=x=>{
    if(!x)return false;
    const sta=txt(x.sta),atd=txt(x.atd||x.actualDeparture||x.actual_departure),ata=txt(x.ata||x.actualArrival||x.actual_arrival),eta=txt(x.eta||x.estimatedArrival||x.estimated_arrival);
    if(!atd&&!ata)return false;
    const arr=ata||eta,arrDelay=arr?minuteDelta(sta,arr):null;
    return arrDelay!=null&&arrDelay>=OPS_TOL;
  };
  const statusFromFlight=x=>{
    if(!x)return '';
    const raw=up(x.opsStatus||x.status||x.flight_status||x.providerStatusRaw);
    if(/CANCEL|ANNUL/.test(raw))return 'ANNULÉ';
    const atd=txt(x.atd||x.actualDeparture||x.actual_departure),ata=txt(x.ata||x.actualArrival||x.actual_arrival);
    if(ata||/ARRIV|LANDED|COMPLETED/.test(raw))return 'ARRIVÉ';
    if(atd){
      const date=txt(x.flight_date||x.flightDate||x.service_date_internal||x.serviceDate||x.date)||serviceDate();
      const origin=up(x.origin||x.dep||'CDG'),dest=up(x.destination||x.dest||'');
      const eta=txt(x.eta||x.estimatedArrival||x.estimated_arrival||x.sta),dep=atd||txt(x.std);
      const arrival=arrivalUtcMinute(date,dep,eta,origin,dest);
      if(arrival!=null){const left=arrival-nowUtcMinute();if(left<=-15)return 'ARRIVÉ';return 'EN VOL · RESTE '+fmtRemain(left)}
      return 'EN VOL';
    }
    if(/BOARD|EMBAR/.test(raw))return 'EMBARQUEMENT';
    if(/DELAY|RETARD/.test(raw))return 'RETARDÉ';
    if(/DEPART|DÉCOLL|DECOLL|AIRBORNE|IN FLIGHT|EN ROUTE/.test(raw))return 'DÉCOLLÉ';
    const etd=txt(x.etd||x.edt||x.estimatedDeparture||x.estimated_departure),etdDelay=etd?minuteDelta(txt(x.std),etd):null;
    if(etdDelay!=null&&etdDelay>=OPS_TOL)return 'PRÉVU';
    if(/CONFIRM/.test(raw))return 'À CONFIRMER';
    return "À L'HEURE";
  };

  function fixCard(card){
    const badge=card.querySelector('.v2-status');if(!badge)return;
    const timeAlert=cardHasRedOperationalTime(card);
    const r=route(card);if(!r){badge.classList.toggle('ops-time-alert',timeAlert);return}
    const date=serviceDate();if(!date){badge.classList.toggle('ops-time-alert',timeAlert);return}
    const std=timeByLabel(card,'STD');
    const atd=timeByLabel(card,'ATD');
    const sta=timeByLabel(card,'STA');
    const ata=timeByLabel(card,'ATA');
    const eta=timeByLabel(card,'ETA');
    if(!atd){badge.classList.toggle('ops-time-alert',timeAlert);return}
    if(ata){setBadge(badge,'ARRIVÉ',timeAlert);return}
    const arrival=arrivalUtcMinute(date,atd||std,eta||sta,r.origin,r.dest);
    if(arrival==null){setBadge(badge,'EN VOL',timeAlert);return}
    const left=arrival-nowUtcMinute();
    if(left<=-15){setBadge(badge,'ARRIVÉ',timeAlert);return}
    setBadge(badge,'EN VOL · RESTE '+fmtRemain(left),timeAlert);
  }
  function fixDetail(){
    const head=document.querySelector('#app .flight-head');if(!head)return;
    const id=head.querySelector('.fh-id')||head.querySelector('.flight-id-with-logo')?.parentElement;if(!id)return;
    let wrap=id.querySelector('.flight-detail-status-wrap');
    if(!wrap){wrap=document.createElement('div');wrap.className='flight-detail-status-wrap';wrap.innerHTML='<span class="v2-status programme">PROGRAMMÉ</span>';id.appendChild(wrap)}
    const badge=wrap.querySelector('.v2-status'),x=getCurrentFlight();
    {const term=(x&&typeof window.__alyziaTerminalOf==='function')?window.__alyziaTerminalOf(x):'';let chip=wrap.querySelector('.flight-detail-terminal');if(term){if(!chip){chip=document.createElement('span');chip.className='flight-detail-terminal';wrap.insertBefore(chip,badge)}const t='TERM '+term,cls='flight-detail-terminal term-'+term.toLowerCase();if(chip.textContent!==t)chip.textContent=t;if(chip.className!==cls)chip.className=cls}else chip?.remove()}
    const label=statusFromFlight(x);
    if(label)setBadge(badge,label,flightHasRedOperationalTime(x));
  }
  const run=()=>{document.querySelectorAll('#app .v2-card').forEach(fixCard);fixDetail()};
  const start=()=>{
    run();
    const root=document.getElementById('app')||document.documentElement;
    new MutationObserver(()=>run()).observe(root,{childList:true,subtree:true});
    setInterval(run,30000);
  };
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
