import app from "./index.js";

/*
 * V50.33 — Correctif source du format de durée.
 *
 * public/index.html formatait directement `n % 60`. Quand `duration` contient
 * un résidu flottant (ex. 114.98915), l'interface affiche 1:54.98915 au lieu
 * de la minute opérationnelle attendue 1:55.
 *
 * Le Worker corrige la fonction `durationText` dans le HTML servi avant que
 * le navigateur ne l'exécute. Le nombre total de minutes est arrondi d'abord,
 * puis seulement converti en H:MM. Cela ne dépend pas d'un script ajouté au DOM.
 */
const OLD_DURATION_TEXT =
  "function durationText(m){const n=Number(m);return Number.isFinite(n)&&n>0?pad(Math.floor(n/60))+':'+pad(n%60):'—'}";

const NEW_DURATION_TEXT =
  "function durationText(m){const n=Math.round(Number(m));return Number.isFinite(n)&&n>0?pad(Math.floor(n/60))+':'+pad(n%60):'—'}";

const DELETE_FLIGHT_UI = String.raw`
<style id="alyzia-delete-flight-ui-css">
.delete-flight-tool{border-color:#efb5b5!important;background:linear-gradient(145deg,#fff,#fff5f5)!important}
.delete-flight-tool .tool-icon,.delete-flight-tool b{color:#b42318!important}
.delete-flight-step{display:grid;gap:12px}
.delete-flight-help{padding:11px 13px;border:1px solid #dce8f4;border-radius:12px;background:#f7faff;color:#53657a;font-size:10px;font-weight:850;line-height:1.45}
.delete-flight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.delete-flight-choice{width:100%;min-height:92px;border:1px solid #dce8f4;border-radius:15px;background:#fff;padding:13px;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;color:#17324d}
.delete-flight-choice:hover{border-color:#76aeea;background:#f7fbff}
.delete-flight-choice .airline-logo,.delete-flight-choice .airline-logo-fallback{flex:0 0 auto}
.delete-flight-choice-copy{min-width:0;display:grid;gap:4px}
.delete-flight-choice-copy b{font-size:14px;font-weight:950}
.delete-flight-choice-copy span{font-size:9px;font-weight:850;color:#6b7c90}
.delete-flight-choice.danger{border-color:#efb5b5;background:#fff8f7}
.delete-flight-choice.danger b{color:#b42318}
.delete-flight-confirm{border:1px solid #efb5b5;border-radius:15px;background:#fff5f4;padding:16px;color:#7a271a;font-size:11px;font-weight:800;line-height:1.55}
.delete-flight-confirm strong{display:block;font-size:18px;margin-bottom:8px;color:#b42318}
.delete-flight-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:14px}
.delete-flight-actions button{min-height:40px;border-radius:11px;padding:0 15px;font-size:10px;font-weight:950;cursor:pointer}
.delete-flight-actions .cancel{border:1px solid #d6e3f1;background:#fff;color:#27445f}
.delete-flight-actions .danger{border:1px solid #b42318;background:#b42318;color:#fff}
@media(max-width:680px){.delete-flight-grid{grid-template-columns:1fr}.delete-flight-choice{min-height:78px}}
</style>
<script id="alyzia-delete-flight-ui">
(()=>{
  'use strict';
  const clean=value=>String(value||'').trim().toUpperCase();
  const sameFlight=(row,airline,flight,date)=>
    clean(row&&row.airline)===clean(airline) &&
    clean(row&&row.flight)===clean(flight) &&
    String(row&&row.date||'').trim()===String(date||'').trim();

  function deleteFlightRows(){
    const seen=new Set();
    return (Array.isArray(FLIGHTS)?FLIGHTS:[])
      .filter(row=>row&&clean(row.airline)&&clean(row.flight)&&String(row.date||'').trim())
      .filter(row=>{
        const key=[String(row.date||'').trim(),clean(row.airline),clean(row.flight)].join('|');
        if(seen.has(key))return false;
        seen.add(key);
        return true;
      });
  }

  function deleteFlightLogo(airline){
    try{return airlineLogo(airline,'large')}catch(_){return '<span class="airline-logo-fallback large">'+escapeHtml(airline)+'</span>'}
  }

  function deleteFlightDateLabel(date){
    try{return formatDateLong(date)}catch(_){return String(date||'').toUpperCase()}
  }

  function installDeleteFlightTool(){
    const title=document.getElementById('modalTitle');
    const body=document.getElementById('modalBody');
    if(!title||!body||clean(title.textContent)!=='OUTILS'||body.querySelector('[data-delete-flight-tool]'))return;
    const card='<button class="tool-card delete-flight-tool" data-delete-flight-tool onclick="openDeleteFlight()"><span class="tool-icon">−</span><b>SUPPRIMER VOL</b><span>COMPAGNIE · VOL · DATE</span></button>';
    const create=[...body.querySelectorAll('.tool-card')].find(button=>/CRÉER VOL|CRÉATION DE VOLS/.test(clean(button.textContent)));
    if(create)create.insertAdjacentHTML('afterend',card);
    else body.querySelector('.tools-grid')?.insertAdjacentHTML('beforeend',card);
  }

  const previousOpenTools=window.openTools;
  window.openTools=async function(...args){
    const result=typeof previousOpenTools==='function' ? await previousOpenTools.apply(this,args) : undefined;
    installDeleteFlightTool();
    setTimeout(installDeleteFlightTool,50);
    return result;
  };

  window.openDeleteFlight=function(){
    const rows=deleteFlightRows();
    const companies=[...new Set(rows.map(row=>clean(row.airline)))].sort();
    const cards=companies.map(airline=>{
      const list=rows.filter(row=>clean(row.airline)===airline);
      const flights=new Set(list.map(row=>clean(row.flight))).size;
      return '<button class="delete-flight-choice" onclick=\'openDeleteFlightNumbers('+JSON.stringify(airline)+')\'>'+deleteFlightLogo(airline)+'<span class="delete-flight-choice-copy"><b>'+escapeHtml(airline)+'</b><span>'+flights+' VOL'+(flights>1?'S':'')+' · '+list.length+' DATE'+(list.length>1?'S':'')+'</span></span></button>';
    }).join('');
    showModal('SUPPRIMER UN VOL','1/3 · CHOISIR LA COMPAGNIE','<div class="delete-flight-step"><div class="delete-flight-help">Sélectionnez d’abord la compagnie du vol à supprimer.</div><div class="delete-flight-grid">'+(cards||'<div class="import-status">AUCUN VOL À SUPPRIMER.</div>')+'</div></div>');
  };

  window.openDeleteFlightNumbers=function(airline){
    airline=clean(airline);
    const rows=deleteFlightRows().filter(row=>clean(row.airline)===airline);
    const numbers=[...new Set(rows.map(row=>clean(row.flight)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const cards=numbers.map(flight=>{
      const list=rows.filter(row=>clean(row.flight)===flight);
      const destinations=[...new Set(list.map(row=>clean(row.dest)).filter(Boolean))];
      const route=destinations.length?'CDG → '+destinations.join(' / '):'DESTINATION NON RENSEIGNÉE';
      return '<button class="delete-flight-choice" onclick=\'openDeleteFlightDates('+JSON.stringify(airline)+','+JSON.stringify(flight)+')\'><span class="delete-flight-choice-copy"><b>'+deleteFlightLogo(airline)+' '+escapeHtml(flight)+'</b><span>'+escapeHtml(route)+' · '+list.length+' DATE'+(list.length>1?'S':'')+'</span></span></button>';
    }).join('');
    showModal('SUPPRIMER UN VOL','2/3 · '+airline+' · CHOISIR LE VOL','<div class="delete-flight-step"><div class="delete-flight-help">Choisissez le numéro de vol.</div><div class="delete-flight-grid">'+(cards||'<div class="import-status">AUCUN VOL POUR CETTE COMPAGNIE.</div>')+'</div></div>');
  };

  window.openDeleteFlightDates=function(airline,flight){
    airline=clean(airline);flight=clean(flight);
    const rows=deleteFlightRows()
      .filter(row=>clean(row.airline)===airline&&clean(row.flight)===flight)
      .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const cards=rows.map(row=>{
      const date=String(row.date||'').trim();
      const details=[row.std?'STD '+row.std:'',row.dest?'CDG → '+clean(row.dest):''].filter(Boolean).join(' · ');
      return '<button class="delete-flight-choice danger" onclick=\'openDeleteFlightConfirmation('+JSON.stringify(airline)+','+JSON.stringify(flight)+','+JSON.stringify(date)+')\'><span class="delete-flight-choice-copy"><b>'+escapeHtml(deleteFlightDateLabel(date))+'</b><span>'+escapeHtml(details||date)+'</span></span></button>';
    }).join('');
    showModal('SUPPRIMER UN VOL','3/3 · '+flight+' · CHOISIR LA DATE','<div class="delete-flight-step"><div class="delete-flight-help">Choisissez la date exacte du vol à supprimer.</div><div class="delete-flight-grid">'+(cards||'<div class="import-status">AUCUNE DATE DISPONIBLE.</div>')+'</div></div>');
  };

  window.openDeleteFlightConfirmation=function(airline,flight,date){
    airline=clean(airline);flight=clean(flight);date=String(date||'').trim();
    const row=deleteFlightRows().find(item=>sameFlight(item,airline,flight,date));
    if(!row)return openDeleteFlight();
    const route=[clean(row.dep)||'CDG',clean(row.dest)].filter(Boolean).join(' → ');
    showModal('CONFIRMER LA SUPPRESSION',flight+' · '+deleteFlightDateLabel(date),'<div class="delete-flight-confirm"><strong>'+deleteFlightLogo(airline)+' '+escapeHtml(flight)+'</strong>'+escapeHtml(route)+' · '+escapeHtml(deleteFlightDateLabel(date))+'<br><br>La fiche vol, sa PRÉPA et ses données associées seront supprimées. Les e-mails restent dans Gmail et ne recréeront pas automatiquement ce vol.<br><br><b>ACTION IRRÉVERSIBLE.</b></div><div class="delete-flight-actions"><button class="cancel" onclick="modalBack()">ANNULER</button><button id="confirmDeleteFlightButton" class="danger" onclick=\'confirmDeleteFlight('+JSON.stringify(airline)+','+JSON.stringify(flight)+','+JSON.stringify(date)+')\'>SUPPRIMER DÉFINITIVEMENT</button></div>');
  };

  window.confirmDeleteFlight=async function(airline,flight,date){
    airline=clean(airline);flight=clean(flight);date=String(date||'').trim();
    const button=document.getElementById('confirmDeleteFlightButton');
    const body=document.getElementById('modalBody');
    if(button){button.disabled=true;button.textContent='SUPPRESSION…'}
    try{
      const response=await fetch(opsApiUrl('/api/prepa/flight'),{
        method:'DELETE',cache:'no-store',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({airline:airline,flightNumber:flight,flightDate:date,deleteDrive:false})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result||!result.ok)throw new Error(result&&result.error||('HTTP '+response.status));

      for(let i=FLIGHTS.length-1;i>=0;i--)if(sameFlight(FLIGHTS[i],airline,flight,date))FLIGHTS.splice(i,1);
      try{
        const prefix=airline+'|'+flight+'|'+date;
        if(typeof PREPA_STATE==='object'&&PREPA_STATE){
          Object.keys(PREPA_STATE).forEach(key=>{if(key===prefix||key.startsWith(prefix+'|'))delete PREPA_STATE[key]});
          if(typeof savePrepaState==='function')savePrepaState();
        }
        if(typeof loadEditingStore==='function'&&typeof saveEditingStore==='function'){
          const store=loadEditingStore()||{};
          Object.keys(store).forEach(key=>{if(key===prefix||key.startsWith(prefix+'|'))delete store[key]});
          saveEditingStore(store);
        }
      }catch(_){}

      await saveImportedFlightsPersistent(FLIGHTS);
      if(typeof fetchRecentPrepaImports==='function')await fetchRecentPrepaImports().catch(()=>{});
      selected=Math.max(0,Math.min(Number(selected)||0,FLIGHTS.length-1));
      closeAllModals();
      if(typeof renderHome==='function')renderHome();
      setTimeout(()=>showModal('VOL SUPPRIMÉ',flight+' · '+deleteFlightDateLabel(date),'<div class="import-status ok">✓ LE VOL A ÉTÉ SUPPRIMÉ DE LA LISTE, DE LA FICHE ET DE LA PRÉPA.</div>'),60);
    }catch(error){
      if(body)body.innerHTML='<div class="import-status err">SUPPRESSION IMPOSSIBLE : '+escapeHtml(String(error&&error.message||error))+'</div><div class="delete-flight-actions"><button class="cancel" onclick="modalBack()">RETOUR</button><button class="danger" onclick=\'openDeleteFlightConfirmation('+JSON.stringify(airline)+','+JSON.stringify(flight)+','+JSON.stringify(date)+')\'>RÉESSAYER</button></div>';
    }
  };
})();
</script>`;

export function patchDurationFormatter(html) {
  const source = String(html || "");
  return source.includes(OLD_DURATION_TEXT)
    ? source.replaceAll(OLD_DURATION_TEXT, NEW_DURATION_TEXT)
    : source;
}

export function injectDeleteFlightUi(html) {
  const source = String(html || "");
  if (!source || source.includes('id="alyzia-delete-flight-ui"')) return source;
  return source.includes("</body>")
    ? source.replace("</body>", `${DELETE_FLIGHT_UI}\n</body>`)
    : source + DELETE_FLIGHT_UI;
}

export function patchAppHtml(html) {
  return injectDeleteFlightUi(patchDurationFormatter(html));
}

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, env, ctx);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();

    if (!contentType.includes("text/html")) return response;

    const html = await response.text();
    const patched = patchAppHtml(html);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control", "no-store");

    return new Response(patched, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  },

  scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") {
      return app.scheduled(controller, env, ctx);
    }
  }
};
