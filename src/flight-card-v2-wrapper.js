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

  const scheduleFor=(flight)=>{
    try{
      if(typeof schedule==='function') return schedule(flight)||{};
    }catch(e){}
    try{
      if(typeof window.schedule==='function') return window.schedule(flight)||{};
    }catch(e){}
    return {};
  };

  const patchOperationalTimes=(row)=>{
    const flight=flightForRow(row);
    const cell=row.querySelector('.home-time');
    if(!flight || !cell) return;

    const sched=scheduleFor(flight);
    const std=hhmm(flight.std);
    if(!std) return;

    const atd=hhmm(flight.atd);
    const etd=hhmm(flight.etd||flight.edt);
    const sta=hhmm(sched.sta||flight.sta);
    const ata=hhmm(flight.ata||sched.ata);
    const eta=hhmm(sched.eta||flight.eta);

    let departure='';
    if(atd){
      departure='<span class="etd-small">ATD '+atd+'</span>';
    }else if(etd && delayMinutes(std,etd)>=5){
      departure='<span class="etd-small">ETD '+etd+'</span>';
    }

    let arrival='';
    if(sta){
      arrival='<span class="home-sta-small">STA '+sta+'</span>';
      if(ata){
        arrival+='<span class="eta-small">ATA '+ata+'</span>';
      }else if(eta){
        arrival+='<span class="eta-small">ETA '+eta+'</span>';
      }
    }

    const wanted='<span class="home-std-main">'+std+'</span>'+departure+arrival;
    if(!cell.classList.contains('home-time-ops')) cell.classList.add('home-time-ops');
    if(cell.innerHTML!==wanted) cell.innerHTML=wanted;
  };

  const normalizeFlightStatus=(flight)=>{
    const raw=String(flight?.opsStatus||flight?.status||flight?.flight_status||'').trim().toUpperCase();
    if(!raw) return '';
    if(raw.includes('CANCEL') || raw.includes('ANNUL')) return 'ANNULÉ';
    if(raw.includes('ARRIV')) return 'ARRIVÉ';
    if(raw.includes('DEPART') || raw.includes('DÉCOLL') || raw.includes('DECOLL')) return 'DÉCOLLÉ';
    if(raw.includes('BOARD') || raw.includes('EMBAR')) return 'EMBARQUEMENT';
    if(raw.includes('DELAY') || raw.includes('RETARD')) return 'RETARDÉ';
    if(raw.includes('CONFIRM')) return 'À CONFIRMER';
    if(raw.includes('SCHED') || raw.includes('PROGRAM')) return 'PROGRAMMÉ';
    return '';
  };

  const patchFlightStatus=(row)=>{
    const flight=flightForRow(row);
    const actions=row.querySelector('.home-flight-actions');
    if(!flight || !actions) return;

    const status=normalizeFlightStatus(flight);
    let badge=actions.querySelector('.home-ops-status');
    if(!status){
      if(badge) badge.remove();
      return;
    }

    if(!badge){
      badge=document.createElement('span');
      badge.className='home-ops-status';
      badge.style.setProperty('display','inline-flex','important');
      badge.style.setProperty('align-items','center','important');
      badge.style.setProperty('padding','2px 6px','important');
      badge.style.setProperty('border-radius','999px','important');
      badge.style.setProperty('font-size','9px','important');
      badge.style.setProperty('font-weight','900','important');
      badge.style.setProperty('line-height','1.1','important');
      badge.style.setProperty('background','#eaf3ff','important');
      badge.style.setProperty('color','#0b66c3','important');
      badge.style.setProperty('margin-right','5px','important');
      actions.insertBefore(badge,actions.firstChild);
    }

    if(badge.textContent!==status) badge.textContent=status;
  };

  const patchAcGateScale=(row)=>{
    row.querySelectorAll('*').forEach(el=>{
      if(el.children.length) return;
      const text=String(el.textContent||'').trim().toUpperCase();
      if(!/^(A\/C|GATE)(?:\s|:|$)/.test(text)) return;
      el.style.setProperty('font-size','10px','important');
      el.style.setProperty('line-height','1.15','important');
      el.style.setProperty('font-weight','800','important');
    });
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
      patchOperationalTimes(row);
      patchFlightStatus(row);
      patchAcGateScale(row);
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
