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
