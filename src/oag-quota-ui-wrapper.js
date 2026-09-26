import app from "./etd-compat-wrapper.js";

const UI=String.raw`
<style id="alyzia-oag-quota-css">
.oag-quota-card{border:1px solid #cfe0f1;border-radius:14px;padding:14px;background:#f8fbff;margin-bottom:12px}
.oag-quota-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}
.oag-quota-head b{font-size:14px;color:#12304f}.oag-quota-head span{font-size:9px;font-weight:950;color:#087b91}
.oag-quota-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.oag-quota-meter{border:1px solid #dce8f3;border-radius:11px;padding:10px;background:#fff}
.oag-quota-meter small{display:block;font-size:8px;font-weight:900;color:#718398}.oag-quota-meter strong{display:block;font-size:19px;color:#122b45;margin:3px 0 7px}
.oag-quota-bar{height:7px;border-radius:99px;background:#e7eef5;overflow:hidden}.oag-quota-bar span{display:block;height:100%;background:#0788a2;border-radius:99px}
.oag-quota-meta{margin-top:10px;font-size:9px;line-height:1.6;font-weight:850;color:#60758b}
@media(max-width:520px){.oag-quota-grid{grid-template-columns:1fr}}
</style>
<script id="alyzia-oag-quota-js">
(()=>{
  'use strict';
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const pct=(used,total)=>total?Math.min(100,Math.round(used/total*100)):0;
  function quotaMarkup(data){
    const u=data?.usage||{},p=data?.plan||{};
    return '<div class="oag-quota-head"><b>OAG · HORAIRES</b><span>AUTOMATIQUE · TOUTES LES 5 MIN</span></div>'+
      '<div class="oag-quota-grid">'+
        '<div class="oag-quota-meter"><small>AUJOURD’HUI</small><strong>'+n(u.day)+' / '+n(p.dailyTarget)+'</strong><div class="oag-quota-bar"><span style="width:'+pct(n(u.day),n(p.dailyTarget))+'%"></span></div></div>'+
        '<div class="oag-quota-meter"><small>CE MOIS</small><strong>'+n(u.month)+' / '+n(p.limit)+'</strong><div class="oag-quota-bar"><span style="width:'+pct(n(u.month),n(p.limit))+'%"></span></div></div>'+
      '</div>'+
      '<div class="oag-quota-meta">DISPONIBLE SÉCURISÉ : '+n(p.safeMonthRemaining)+' · RÉSERVE FIN DE MOIS : '+n(p.reserve)+' · PLAFOND LIBÉRÉ : '+n(p.normalCap)+' · '+n(p.daysLeft)+' JOUR(S) RESTANT(S)</div>';
  }
  async function loadOagQuota(){
    const box=document.getElementById('oagQuotaAdmin');if(!box)return;
    box.innerHTML='<div class="oag-quota-meta">CHARGEMENT DU COMPTEUR OAG…</div>';
    try{
      const response=await fetch('/api/oag/usage',{cache:'no-store'}),data=await response.json();
      if(!response.ok||!data?.ok)throw new Error(data?.error||'COMPTEUR INDISPONIBLE');
      box.innerHTML=quotaMarkup(data);
    }catch(error){box.innerHTML='<div class="oag-quota-meta">OAG · '+String(error?.message||error).toUpperCase()+'</div>'}
  }
  window.loadOagQuota=loadOagQuota;
  window.openOagAdmin=function(){
    if(typeof showModal!=='function')return;
    showModal('ADMIN','QUOTAS API','<div id="oagQuotaAdmin" class="oag-quota-card"></div><div class="adb-usage-card"><div id="adbUsageBox"><button class="live-refresh" onclick="loadAeroUsage()">CHARGER COMPTEUR AERODATABOX</button></div></div>');
    setTimeout(()=>{loadOagQuota();if(typeof loadAeroUsage==='function')loadAeroUsage()},20);
  };
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('button');
    if(!button||String(button.textContent||'').trim().toUpperCase()!=='ADMIN')return;
    event.preventDefault();event.stopImmediatePropagation();window.openOagAdmin();
  },true);
})();
</script>`;

function patch(html){
  let source=String(html||"");
  if(!source.includes('id="alyzia-oag-quota-js"')){
    const end=source.lastIndexOf("</body>");
    source=end>=0?source.slice(0,end)+UI+"\n"+source.slice(end):source+UI;
  }
  return source;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const contentType=String(response.headers.get("content-type")||"").toLowerCase();
    if(!contentType.includes("text/html"))return response;
    const html=await response.text(),headers=new Headers(response.headers);
    headers.delete("content-length");headers.set("cache-control","no-store");
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx)}
};
