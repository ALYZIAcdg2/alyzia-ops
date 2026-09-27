import app from "./operational-state-wrapper.js";

const PATCH=String.raw`<script id="alyzia-header-cleanup-safe">
(()=>{
  const mergeEconomyConfig=(text)=>{
    const raw=String(text||'').trim();
    if(!raw || !/\bM\s*\d+/i.test(raw)) return raw;
    const tokens=[];
    const re=/\b([A-Z])\s*(\d+)\b/g;
    let m;
    while((m=re.exec(raw))) tokens.push([m[1].toUpperCase(),Number(m[2]||0)]);
    if(!tokens.length) return raw;
    const map=new Map();
    const order=[];
    for(const [k,v] of tokens){
      if(!order.includes(k)) order.push(k);
      map.set(k,(map.get(k)||0)+v);
    }
    if(!map.has('M')) return raw;
    map.set('Y',(map.get('Y')||0)+(map.get('M')||0));
    map.delete('M');
    const out=[];
    for(const k of order){
      if(k==='M') continue;
      if(k==='Y'){
        if(!out.some(x=>x[0]==='Y')) out.push(['Y',map.get('Y')||0]);
      }else if(map.has(k)) out.push([k,map.get(k)]);
    }
    if(!out.some(x=>x[0]==='Y')) out.push(['Y',map.get('Y')||0]);
    return out.map(([k,v])=>k+v).join(' · ');
  };

  const hhmm=(value)=>{
    const raw=String(value||'').trim();
    if(!raw) return '';
    let m=raw.match(/T(\d{2}):(\d{2})/);
    if(m) return m[1]+':'+m[2];
    m=raw.match(/\b(\d{1,2}):(\d{2})\b/);
    if(!m) return '';
    return String(m[1]).padStart(2,'0')+':'+m[2];
  };

  const delayMinutes=(std,etd)=>{
    const mins=(v)=>{
      const m=/^(\d{2}):(\d{2})$/.exec(v||'');
      return m ? Number(m[1])*60+Number(m[2]) : null;
    };
    const a=mins(std), b=mins(etd);
    if(a===null || b===null) return 0;
    let d=b-a;
    if(d < -720) d+=1440;
    if(d > 720) d-=1440;
    return d;
  };

  const flightForRow=(row)=>{
    const source=String(row.getAttribute('onclick')||row.querySelector('.home-open')?.getAttribute('onclick')||'');
    const match=source.match(/openFlightFromHomeList\((\d+)\)/);
    if(!match) return null;
    const index=Number(match[1]);
    try{
      if(typeof FLIGHTS!=='undefined' && Array.isArray(FLIGHTS)) return FLIGHTS[index]||null;
    }catch(e){}
    try{
      if(Array.isArray(window.FLIGHTS)) return window.FLIGHTS[index]||null;
    }catch(e){}
    return null;
  };

  const patchDepartureTime=(row)=>{
    const flight=flightForRow(row);
    const cell=row.querySelector('.home-time');
    if(!flight || !cell) return;
    const std=hhmm(flight.std);
    if(!std) return;
    const atd=hhmm(flight.atd);
    const etd=hhmm(flight.etd||flight.edt);
    let extra='';
    if(atd){
      extra='<span class="etd-small">ATD '+atd+'</span>';
    }else if(etd && delayMinutes(std,etd)>=5){
      extra='<span class="etd-small">ETD '+etd+'</span>';
    }
    const wanted=std+extra;
    if(cell.innerHTML!==wanted) cell.innerHTML=wanted;
  };

  const clean=()=>{
    document.querySelectorAll('body *').forEach(el=>{
      const text=(el.textContent||'').trim();
      if(el.children.length===0 && /^V\d+(?:\.\d+)+$/i.test(text)){
        el.style.setProperty('display','none','important');
      }
    });
    document.querySelectorAll('button,[role="button"]')?.forEach(el=>{
      const text=(el.textContent||'').toUpperCase().replace(/[^A-ZÀ-ÖØ-Þ]/g,'');
      if(text==='IMPRIMER') el.style.setProperty('display','none','important');
    });
    const homeIcon=document.querySelector('.mobile-bottom-nav [data-mobile-nav="home"] span');
    if(homeIcon && homeIcon.textContent!=='✈️') homeIcon.textContent='✈️';

    document.querySelectorAll('.flight-home-row').forEach(row=>{
      patchDepartureTime(row);
      const flight=String(row.querySelector('.home-flight')?.textContent||'').trim().toUpperCase();
      if(!/^HF\s*\d+/.test(flight)) return;
      row.querySelectorAll('.home-config-booking > div b').forEach(value=>{
        const merged=mergeEconomyConfig(value.textContent);
        if(merged && merged!==value.textContent.trim()) value.textContent=merged;
      });
    });
  };
  clean();
  document.addEventListener('DOMContentLoaded',clean,{once:true});
  new MutationObserver(clean).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>
<script id="alyzia-open-flight-top-safe">
(()=>{
  const install=()=>{
    if(typeof window.openFlightFromHomeList!=='function' || window.openFlightFromHomeList.__alyziaTopWrapped) return;
    const original=window.openFlightFromHomeList;
    const wrapped=function(index){
      const out=original.apply(this,arguments);
      requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,0)));
      setTimeout(()=>window.scrollTo(0,0),80);
      return out;
    };
    wrapped.__alyziaTopWrapped=true;
    window.openFlightFromHomeList=wrapped;
  };
  install();
  document.addEventListener('DOMContentLoaded',install,{once:true});
  setTimeout(install,0);
})();
</script>`;

function patch(html){
  let s=String(html||'');
  s=s.replace(/<script id="alyzia-hide-version-badge">[\s\S]*?<\/script>/,'');
  if(s.includes('id="alyzia-header-cleanup-safe"')) return s;
  const i=s.lastIndexOf('</body>');
  return i>=0?s.slice(0,i)+PATCH+'\n'+s.slice(i):s+PATCH;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html')) return response;
    const html=await response.text();
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof app.scheduled==='function') return app.scheduled(controller,env,ctx);
  }
};
