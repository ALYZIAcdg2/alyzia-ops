import app from "./ops-enrichment-wrapper.js";

const COMPAT=String.raw`
<style id="alyzia-home-times-style">
.flight-home-row .home-time .etd-small{font-size:13px!important;line-height:1.2;margin-top:3px}
.flight-home-row .home-time .ops-atd-time{display:block;font-size:13px;line-height:1.2;margin-top:3px;font-weight:950;color:#078447}
.flight-home-row .home-time .ops-arrival-time{display:block;font-size:12px;line-height:1.2;margin-top:2px;font-weight:900;color:#52657a}
.flight-home-row .home-time .ops-eta-time{color:#087b91}
</style>
<script id="alyzia-etd-compat-js">
(()=>{
  'use strict';
  const text=v=>String(v??'').trim();
  const operational=(x,field)=>/AERODATABOX/i.test(text(x?.[field+'Source']))?'':text(x?.[field]);
  function syncAliases(){
    try{
      if(!Array.isArray(FLIGHTS))return;
      for(const x of FLIGHTS){
        if(!x||typeof x!=='object')continue;
        const live=text(x.etd),legacy=text(x.edt);
        if(live&&live!==legacy)x.edt=live;
      }
    }catch(_){}
  }
  function syncHomeTimes(){
    try{
      if(!Array.isArray(FLIGHTS))return;
      const date=typeof HOME_DATE!=='undefined'?text(HOME_DATE):'';
      document.querySelectorAll('.flight-home-row').forEach(row=>{
        const flight=text(row.querySelector('.home-flight')?.textContent).toUpperCase();
        if(!flight)return;
        const x=FLIGHTS.find(v=>text(v?.flight).toUpperCase()===flight&&(!date||!text(v?.date)||text(v?.date)===date));
        if(!x)return;
        const std=text(x.std)||'—',atd=operational(x,'atd'),etd=operational(x,'etd')||(!/AERODATABOX/i.test(text(x.edtSource||x.etdSource))?text(x.edt):''),sta=operational(x,'sta'),eta=operational(x,'eta'),ata=operational(x,'ata');
        const sig=[std,atd,etd,sta,eta,ata].join('|');
        const cell=row.querySelector('.home-time');
        if(!cell||cell.dataset.opsTimes===sig)return;
        cell.dataset.opsTimes=sig;
        cell.replaceChildren();
        const add=(label,value,className)=>{
          if(!value)return;
          const span=document.createElement('span');
          if(className)span.className=className;
          span.textContent=label?label+' '+value:value;
          cell.appendChild(span);
        };
        add('',std,'ops-std-time');
        if(atd)add('ATD',atd,'ops-atd-time');else add('ETD',etd,'etd-small');
        add('STA',sta,'ops-arrival-time');
        if(ata)add('ATA',ata,'ops-arrival-time ops-eta-time');else add('ETA',eta,'ops-arrival-time ops-eta-time');
      });
    }catch(_){}
  }
  function sync(){syncAliases();syncHomeTimes()}
  sync();
  setInterval(sync,2000);
  document.addEventListener('click',sync,true);
  new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

const OAG_TIMES=String.raw`
<style id="alyzia-oag-times-style">
.flight-head .ops-oag-time{display:block;margin-top:3px;font-size:13px;font-weight:900;color:#087b91}
.flight-head .ops-oag-actual{color:#078447}
.live-strip .live-refresh{display:none}
</style>
<script id="alyzia-oag-times-js">
(()=>{
  'use strict';
  const value=v=>String(v??'').trim();
  const fromAdb=(x,key)=>/AERODATABOX/i.test(value(x?.[key+'Source']));
  const time=(x,key)=>fromAdb(x,key)?'':value(x?.[key]);
  if(typeof window.adbState==='function'){
    const original=window.adbState;
    window.adbState=function(...args){
      const state=original.apply(this,args);
      if(!state?.data)return state;
      const data=state.data;
      return {...state,data:{...data,
        departure:{...data.departure,etd:null,atd:null},
        arrival:{...data.arrival,eta:null,ata:null,scheduledTime:null,scheduledTimeLocal:null,scheduled:null}
      }};
    };
  }
  window.adbLiveStrip=function(x){
    const checked=value(x?.oagLastCheckedAt);
    const label=checked?'OAG · MIS À JOUR':'OAG · EN ATTENTE';
    return '<div class="live-strip"><span class="live-badge schedule">'+label+'</span></div>';
  };
  function renderTimes(){
    try{
      if(!Array.isArray(FLIGHTS))return;
      const x=FLIGHTS[Number(selected)];
      if(!x)return;
      const sections=[...document.querySelectorAll('.flight-head .fh-stat')];
      for(const section of sections){
        const heading=value(section.querySelector('.head-label')?.textContent).toUpperCase();
        const label=heading.startsWith('STD')?'STD':heading.startsWith('STA')?'STA':'';
        if(!label)continue;
        const sig=[time(x,'etd'),time(x,'atd'),time(x,'eta'),time(x,'ata')].join('|');
        if(section.dataset.oagTimes===sig)continue;
        section.dataset.oagTimes=sig;
        section.querySelectorAll('.ops-oag-time').forEach(el=>el.remove());
        const legacy=section.querySelector('.time-secondary');
        if(legacy)legacy.style.display='none';
        const values=label==='STD'?
          [['ETD',time(x,'etd')],['ATD',time(x,'atd')]]:
          [['ETA',time(x,'eta')],['ATA',time(x,'ata')]];
        const anchor=section.querySelector('.time-big');
        let after=anchor;
        for(const [name,v] of values){
          if(!v||!after)continue;
          const span=document.createElement('span');
          span.className='ops-oag-time'+(/^(ATD|ATA)$/.test(name)?' ops-oag-actual':'');
          span.textContent=name+' '+v;
          after.insertAdjacentElement('afterend',span);
          after=span;
        }
      }
    }catch(_){}
  }
  renderTimes();
  setInterval(renderTimes,2000);
  new MutationObserver(renderTimes).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

function patch(html){
  let source=String(html||'');
  if(!source.includes('id="alyzia-etd-compat-js"')){
    const end=source.lastIndexOf('</body>');
    source=end>=0?source.slice(0,end)+COMPAT+'\n'+source.slice(end):source+COMPAT;
  }
  if(!source.includes('id="alyzia-oag-times-js"')){
    const end=source.lastIndexOf('</body>');
    source=end>=0?source.slice(0,end)+OAG_TIMES+'\n'+source.slice(end):source+OAG_TIMES;
  }
  return source;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const contentType=String(response.headers.get('content-type')||'').toLowerCase();
    if(!contentType.includes('text/html'))return response;
    const html=await response.text();
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
