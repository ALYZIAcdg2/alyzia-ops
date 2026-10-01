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
.flight-head .time-secondary{display:none!important}
.flight-head .ops-oag-time{display:flex;align-items:baseline;justify-content:center;flex-wrap:wrap;gap:3px 8px;margin-top:6px;font-size:22px;line-height:1.1;font-weight:950}
.flight-head .ops-t-empty{visibility:hidden}
.flight-head .fh-stat .wx-line{margin-top:auto!important}
.flight-head .ops-t-lab{font-size:15px;font-weight:900;color:#52657a}
.flight-head .ops-t-delta{font-size:14px;font-weight:950}
.flight-head .ops-warn{color:#e07b00!important}.flight-head .ops-late{color:#df2438!important}.flight-head .ops-ok{color:#14804a!important}.flight-head .ops-neutral{color:#078d96!important}
.flight-head .wx-line{font-size:18px!important;font-weight:850!important;min-height:0!important;display:flex;align-items:center;justify-content:center;gap:6px}
.flight-head .wx-line .wx-i{gap:7px}.flight-head .wx-line .wx-svg{width:28px!important;height:28px!important}.flight-head .wx-line b{font-size:22px}.flight-head .wx-line small{font-size:14px!important;display:inline!important}
.flight-head .route-dur{margin-left:12px;font-size:15px;font-weight:900;color:#52657a;background:#eef3f9;border-radius:999px;padding:4px 11px;white-space:nowrap;vertical-align:middle;letter-spacing:0}
@media(max-width:700px){.flight-head .ops-oag-time{font-size:19px}.flight-head .ops-t-lab{font-size:13px}.flight-head .ops-t-delta{font-size:12px}.flight-head .wx-line .wx-svg{width:24px!important;height:24px!important}.flight-head .wx-line b{font-size:19px}.flight-head .wx-line small{display:none!important}}
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
  const minOf=v=>{const m=value(v).match(/(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
  const delta=(a,b)=>{const p=minOf(a),q=minOf(b);if(p==null||q==null)return null;let d=q-p;if(d<-720)d+=1440;if(d>720)d-=1440;return d};
  const TOL=5; // minutes : un écart < 5 min est « dans les temps »
  const deltaText=d=>d==null||d===0?'':(d>0?'+':'\u2212')+Math.abs(d)+' MIN';
  // Fiche : UNE seule ligne par heure réelle/estimée (ATD sinon ETD ; ATA sinon ETA), avec l'écart et la couleur de la logique des cartes.
  function renderTimes(){
    try{
      if(!Array.isArray(FLIGHTS))return;
      const x=FLIGHTS[Number(selected)];
      if(!x)return;
      const atd=time(x,'atd'),ata=time(x,'ata'),etd=time(x,'etd')||(fromAdb(x,'etd')?'':value(x.edt)),eta0=time(x,'eta')||(atd&&!ata&&typeof alyziaEstimatedEta==='function'?alyziaEstimatedEta(x):'');
      const flown=Boolean(atd||ata);
      for(const section of document.querySelectorAll('.flight-head .fh-stat')){
        const heading=value(section.querySelector('.head-label')?.textContent).toUpperCase();
        const label=heading.startsWith('STD')?'STD':heading.startsWith('STA')?'STA':'';
        if(!label)continue;
        const big=section.querySelector('.time-big');
        const bigTime=value(big?.textContent).match(/\d{1,2}:\d{2}/);
        const sched=label==='STD'?(value(x.std)||(bigTime?bigTime[0]:'')):(value(x.sta)||(bigTime?bigTime[0]:''));
        const legacy=value(section.querySelector('.time-secondary')?.textContent).match(/\d{1,2}:\d{2}/);
        const eta=eta0||(label==='STA'&&legacy?legacy[0]:'');
        const sig=[sched,atd,etd,eta,ata,flown].join('|');
        if(section.dataset.oagTimes===sig)continue;
        section.dataset.oagTimes=sig;
        section.querySelectorAll('.ops-oag-time').forEach(el=>el.remove());
        let name='',v='',cls='';
        if(label==='STD'){
          if(atd){name='ATD';v=atd}else if(etd){name='ETD';v=etd}
        }else{
          if(ata){name='ATA';v=ata}else if(eta){name='ETA';v=eta}
        }
        if(!v&&big){ // pas d'heure estimée/réelle : ligne vide de même hauteur, pour que l'horloge locale et la météo restent alignées entre les cartes STD et STA
          const ph=document.createElement('span');ph.className='ops-oag-time ops-t-empty';ph.setAttribute('aria-hidden','true');ph.textContent='00:00';big.insertAdjacentElement('afterend',ph);continue}
        if(!v||!big)continue;
        const d=delta(sched,v);
        if(label==='STD')cls=d!=null&&d>=TOL?'ops-warn':(name==='ATD'?'ops-ok':'ops-neutral');
        else cls=d!=null&&d>=TOL?(flown?'ops-late':'ops-warn'):(flown?'ops-ok':'ops-neutral');
        const line=document.createElement('span');line.className='ops-oag-time';
        const lab=document.createElement('b');lab.className='ops-t-lab';lab.textContent=name;
        const val=document.createElement('span');val.className=cls;val.textContent=v;
        line.append(lab,val);
        const dt=deltaText(d);
        if(dt){const sm=document.createElement('small');sm.className='ops-t-delta '+cls;sm.textContent=dt;line.appendChild(sm)}
        big.insertAdjacentElement('afterend',line);
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
