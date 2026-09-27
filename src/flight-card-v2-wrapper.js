import app from "./operational-state-wrapper.js";

const PATCH=String.raw`<style id="alyzia-card-top-v2-style">
#app .flight-home-row .ops-top-v2{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;margin:0 0 10px;padding:2px 0 4px}
#app .flight-home-row .ops-top-v2-main{display:flex;align-items:center;gap:10px;min-width:0;flex:1;flex-wrap:wrap}
#app .flight-home-row .ops-top-v2-logo{width:92px;height:34px;object-fit:contain;object-position:left center;flex:0 0 auto}
#app .flight-home-row .ops-top-v2-logo-text{font-size:20px;font-weight:950;color:#1577b8;line-height:1}
#app .flight-home-row .ops-top-v2-flight{font-size:27px;font-weight:950;color:#0b2a60;line-height:1;white-space:nowrap}
#app .flight-home-row .ops-top-v2-status{display:inline-flex;align-items:center;padding:7px 11px;border-radius:999px;font-size:11px;font-weight:950;line-height:1;white-space:nowrap;background:#eaf0f6;color:#596d86}
#app .flight-home-row .ops-top-v2-status.retarde{background:#fee8ec;color:#d91f34}
#app .flight-home-row .ops-top-v2-status.embarquement{background:#fff0c8;color:#8b6200}
#app .flight-home-row .ops-top-v2-status.decolle{background:#e1f0ff;color:#0870c9}
#app .flight-home-row .ops-top-v2-status.arrive{background:#e1f6eb;color:#087443}
#app .flight-home-row .ops-top-v2-status.annule{background:#f1f1f3;color:#666d77}
#app .flight-home-row .ops-top-v2-status.aconfirmer{background:#fff3df;color:#b15d00}
#app .flight-home-row .ops-top-v2-actions{display:flex;gap:8px;flex:0 0 auto}
#app .flight-home-row .ops-top-v2-btn{width:42px;height:42px;border:1px solid #dfe7f0;border-radius:14px;background:#fff;color:#7185a0;font-size:24px;display:grid;place-items:center;padding:0}
#app .flight-home-row .ops-top-v2-btn.open{background:#edf6ff;color:#0874d1;border-color:#edf6ff;font-size:31px;font-weight:900}
@media(max-width:620px){#app .flight-home-row .ops-top-v2{margin-bottom:8px}#app .flight-home-row .ops-top-v2-main{gap:8px}#app .flight-home-row .ops-top-v2-logo{width:78px;height:29px}#app .flight-home-row .ops-top-v2-flight{font-size:23px}#app .flight-home-row .ops-top-v2-status{font-size:10px;padding:6px 9px}#app .flight-home-row .ops-top-v2-btn{width:38px;height:38px;border-radius:12px}}
</style>
<script id="alyzia-header-cleanup-safe">
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

  const statusClass=(status)=>String(status||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]+/g,'');

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

  const patchTopV2=(row)=>{
    const flight=flightForRow(row);
    if(!flight) return;

    const oldFlight=row.querySelector('.home-flight');
    const flightNo=String(oldFlight?.textContent||flight.flight||flight.flight_number||'').trim().toUpperCase();
    if(!flightNo) return;
    const airline=String(flight.airline||flightNo.replace(/\d.*$/,'')).trim().toUpperCase();
    const status=normalizeFlightStatus(flight)||'PROGRAMMÉ';
    const logo=[...row.querySelectorAll('img')].find(img=>!img.closest('.ops-top-v2'));
    const fav=[...row.querySelectorAll('button,[role="button"]')].find(el=>!el.closest('.ops-top-v2') && /home-pin|star|fav|favorite|favori/i.test(String(el.className||'')+' '+String(el.title||'')+' '+String(el.getAttribute('aria-label')||'')));
    const open=[...row.querySelectorAll('button,[role="button"]')].find(el=>!el.closest('.ops-top-v2') && /home-open|open|detail|ouvrir|chevron|arrow/i.test(String(el.className||'')+' '+String(el.title||'')+' '+String(el.getAttribute('aria-label')||'')));

    let head=row.querySelector('.ops-top-v2');
    if(!head){
      head=document.createElement('div');
      head.className='ops-top-v2';
      row.insertBefore(head,row.firstChild);
    }

    const logoHtml=logo?.src?'<img class="ops-top-v2-logo" src="'+logo.src+'" alt="">':'<span class="ops-top-v2-logo-text">'+airline+'</span>';
    const star=String(fav?.textContent||'').includes('★')?'★':'☆';
    const wanted=logoHtml+'|'+flightNo+'|'+status+'|'+star;
    if(head.dataset.sig!==wanted){
      head.dataset.sig=wanted;
      head.innerHTML='<div class="ops-top-v2-main">'+logoHtml+'<span class="ops-top-v2-flight">'+flightNo+'</span><span class="ops-top-v2-status '+statusClass(status)+'">'+status+'</span></div><div class="ops-top-v2-actions"><button type="button" class="ops-top-v2-btn fav">'+star+'</button><button type="button" class="ops-top-v2-btn open">›</button></div>';
      head.querySelector('.ops-top-v2-btn.fav')?.addEventListener('click',e=>{e.stopPropagation();fav?.click();});
      head.querySelector('.ops-top-v2-btn.open')?.addEventListener('click',e=>{e.stopPropagation();if(open) open.click();else row.click();});
    }

    const oldCell=oldFlight?.closest('.home-flight-cell');
    if(oldCell) oldCell.style.setProperty('display','none','important');
    else{
      if(oldFlight) oldFlight.style.setProperty('display','none','important');
      const actions=row.querySelector('.home-flight-actions');
      if(actions) actions.style.setProperty('display','none','important');
    }
    if(fav) fav.style.setProperty('display','none','important');
    if(open) open.style.setProperty('display','none','important');
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

  const patchClassVisibility=(row)=>{
    row.querySelectorAll('.home-config-booking > div, .home-config-booking > div b').forEach(el=>{
      el.style.setProperty('max-width','none','important');
      el.style.setProperty('overflow','visible','important');
      el.style.setProperty('text-overflow','clip','important');
      el.style.setProperty('white-space','normal','important');
      el.style.setProperty('word-break','keep-all','important');
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
      patchTopV2(row);
      patchAcGateScale(row);
      patchClassVisibility(row);
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
