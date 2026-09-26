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
        const std=text(x.std)||'—',atd=text(x.atd),etd=text(x.etd||x.edt),sta=text(x.sta),eta=text(x.eta),ata=text(x.ata);
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

function patch(html){
  let source=String(html||'');
  if(!source.includes('id="alyzia-etd-compat-js"')){
    const end=source.lastIndexOf('</body>');
    source=end>=0?source.slice(0,end)+COMPAT+'\n'+source.slice(end):source+COMPAT;
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
