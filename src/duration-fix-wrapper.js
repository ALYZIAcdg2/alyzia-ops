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
.flight-management-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 14px;padding:5px;border:1px solid #dce8f4;border-radius:14px;background:#f4f8fc}
.flight-management-tabs button{min-height:42px;border:0;border-radius:10px;background:transparent;color:#62758a;font-size:11px;font-weight:950;cursor:pointer}
.flight-management-tabs button.active{background:#fff;color:#075fd3;box-shadow:0 3px 12px rgba(28,74,121,.12)}
.gmail-tool-card .tool-icon{color:#b42318!important}
.prepa-company-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.prepa-company-card{min-height:128px;border:1px solid #dce8f4;border-radius:18px;background:#fff;padding:18px;display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;text-align:left;color:#17324d;cursor:pointer;box-shadow:0 8px 24px rgba(32,75,120,.06)}
.prepa-company-card:hover{border-color:#76aeea;transform:translateY(-1px)}
.prepa-company-logo{display:flex;align-items:center;justify-content:center}.prepa-company-logo .airline-logo,.prepa-company-logo .airline-logo-fallback{width:58px;height:58px}
.prepa-company-copy{display:grid;gap:5px}.prepa-company-copy b{font-size:22px;font-weight:950}.prepa-company-copy span{font-size:10px;font-weight:850;color:#70839a}
.prepa-company-status{display:grid;gap:3px;text-align:right}.prepa-company-status strong{font-size:22px;color:#087749}.prepa-company-status span{font-size:8px;font-weight:950;color:#70839a}.prepa-company-status em{font-size:9px;font-style:normal;font-weight:950;color:#b42318}
.prepa-company-arrow{font-size:30px;color:#075fd3}.prepa-company-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.prepa-company-toolbar>button{min-height:42px;border:1px solid #d6e3f1;border-radius:11px;background:#fff;color:#27445f;font-size:10px;font-weight:950;padding:0 15px;cursor:pointer}.prepa-company-toolbar>div{display:flex;align-items:center;gap:9px}.prepa-company-toolbar b{font-size:18px}.prepa-company-toolbar span{font-size:9px;font-weight:850;color:#70839a}
.prepa-visibility-section{border-color:#a9cbed!important;background:#f6faff!important}.prepa-visibility-toggle{min-height:54px!important;border-color:#8ab9ec!important;background:#fff!important}.prepa-visibility-toggle span{font-size:10px!important;color:#075fc8!important}
.flight-head{min-height:0!important;grid-template-columns:minmax(285px,1.55fr) repeat(5,minmax(100px,1fr))!important;padding:10px!important;gap:0!important;background:linear-gradient(135deg,#fff 0%,#f7faff 100%)!important}
.flight-head .headcell{border:0!important;background:transparent!important;box-shadow:none!important;min-height:190px!important;padding:12px 10px!important}
.flight-head .headcell:first-child{padding-left:16px!important}
.home-sub{font-size:10px!important}.home-config-booking small{font-size:8px!important}.home-config-booking b{font-size:10px!important}.home-load b{font-size:12px!important}.home-avail{font-weight:950!important}
@media(max-width:1100px){.flight-head{grid-template-columns:minmax(245px,1.45fr) repeat(3,minmax(92px,1fr))!important}.flight-head>.headcell:first-child{grid-row:span 2!important}.flight-head>.headcell:nth-child(n+5){min-height:96px!important}}
@media(max-width:680px){
 .delete-flight-grid,.prepa-company-grid{grid-template-columns:1fr}.delete-flight-choice{min-height:78px}.prepa-company-card{min-height:104px;padding:14px;grid-template-columns:auto 1fr auto}.prepa-company-status{grid-column:2}.prepa-company-arrow{grid-column:3;grid-row:1/3}
 .flight-head{grid-template-columns:1fr 1fr!important;padding:7px!important}.flight-head>.headcell:first-child{grid-column:1/-1!important;grid-row:auto!important;min-height:0!important;padding:12px 12px 10px!important}.flight-head .headcell{min-height:102px!important;padding:10px 8px!important}.flight-head>.headcell:nth-child(6){grid-column:1/-1!important;min-height:92px!important}.flight-head .saria-bridge-pill{display:none!important}.flight-head .saria-ac-wrap{gap:4px!important}.flight-head .live-strip{margin-top:4px!important}.flight-head .detail-prepa-actions{margin-top:7px!important}.flight-management-tabs{position:sticky;top:0;z-index:2}
 .flight-home-row>:nth-child(4){font-size:12px!important;font-weight:900!important;color:#20354c!important}.home-sub{font-size:11px!important;font-weight:850!important}.home-config-booking small{font-size:9px!important}.home-config-booking b{font-size:12px!important}.home-load b{font-size:13px!important}.home-avail{display:flex!important;align-items:center!important;gap:8px!important;font-size:13px!important}.home-avail:before{content:'AVAILABLE';font-size:9px;font-weight:950;color:#718398}
}
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

  function flightManagementTabs(active){
    return '<div class="flight-management-tabs"><button class="'+(active==='add'?'active':'')+'" onclick="openFlightManagement(\'add\')">＋ AJOUTER UN VOL</button><button class="'+(active==='delete'?'active':'')+'" onclick="openFlightManagement(\'delete\')">− SUPPRIMER UN VOL</button></div>';
  }

  function installFlightTools(){
    const title=document.getElementById('modalTitle');
    const body=document.getElementById('modalBody');
    if(!title||!body||clean(title.textContent)!=='OUTILS')return;

    const create=[...body.querySelectorAll('.tool-card')].find(button=>/CRÉER VOL|CRÉATION DE VOLS/.test(clean(button.textContent)));
    if(create&&!create.dataset.flightManagementTool){
      create.dataset.flightManagementTool='1';
      create.classList.add('delete-flight-tool');
      create.setAttribute('onclick',"openFlightManagement('add')");
      create.innerHTML='<span class="tool-icon">±</span><b>AJOUTER / SUPPRIMER UN VOL</b><span>GESTION GUIDÉE · COMPAGNIE · VOL · DATE</span>';
    }
    body.querySelectorAll('[data-delete-flight-tool]').forEach(card=>card.remove());

    const gmail=body.querySelector('.import139-card');
    if(gmail&&!body.querySelector('[data-gmail-tool-card]')){
      const stats=[...gmail.querySelectorAll('.import139-stat')].map(node=>clean(node.textContent)).filter(Boolean).slice(0,2).join(' · ');
      const card=document.createElement('button');
      card.className='tool-card gmail-tool-card';
      card.dataset.gmailToolCard='1';
      card.setAttribute('onclick','openImportsDashboard()');
      card.innerHTML='<span class="tool-icon">✉</span><b>IMPORT GMAIL</b><span>'+(stats||'AUTO PILOT · IMPORTS ET HISTORIQUE')+'</span>';
      gmail.replaceWith(card);
    }
  }

  const previousOpenTools=window.openTools;
  window.openTools=async function(...args){
    const result=typeof previousOpenTools==='function' ? await previousOpenTools.apply(this,args) : undefined;
    installFlightTools();
    setTimeout(installFlightTools,50);
    return result;
  };

  const previousOpenCreateFlight=window.openCreateFlight;
  window.openFlightManagement=function(mode){
    if(mode==='delete')return openDeleteFlight();
    if(typeof previousOpenCreateFlight!=='function')return;
    previousOpenCreateFlight();
    const title=document.getElementById('modalTitle');
    const sub=document.getElementById('modalSub');
    const body=document.getElementById('modalBody');
    if(title)title.textContent='GESTION DES VOLS';
    if(sub)sub.textContent='AJOUTER UN VOL';
    if(body&&!body.querySelector('.flight-management-tabs'))body.insertAdjacentHTML('afterbegin',flightManagementTabs('add'));
  };

  function ensurePrepaCompanyOptions(){
    if(typeof COMPANY_CONFIG!=='object'||!COMPANY_CONFIG)return;
    Object.keys(COMPANY_CONFIG).forEach(airline=>{
      const cfg=COMPANY_CONFIG[airline];
      if(!cfg)return;
      cfg.modules=cfg.modules&&typeof cfg.modules==='object'?cfg.modules:{};
      if(cfg.modules.prepa===undefined)cfg.modules.prepa=true;
    });
  }
  function companyVisibleInPrepa(airline){
    ensurePrepaCompanyOptions();
    return !(typeof COMPANY_CONFIG==='object'&&COMPANY_CONFIG&&COMPANY_CONFIG[airline]&&COMPANY_CONFIG[airline].modules&&COMPANY_CONFIG[airline].modules.prepa===false);
  }
  ensurePrepaCompanyOptions();

  const previousOpenAirlineConfig=window.openAirlineConfig;
  if(typeof previousOpenAirlineConfig==='function'){
    window.openAirlineConfig=function(airline){
      ensurePrepaCompanyOptions();
      const result=previousOpenAirlineConfig.apply(this,arguments);
      const input=document.querySelector('[data-company-module="prepa"]');
      const label=input&&input.closest('.airline-module-toggle');
      const modulesSection=label&&label.closest('.airline-config-section');
      if(label&&modulesSection){
        const text=label.querySelector('span');
        if(text)text.textContent='AFFICHER LA COMPAGNIE DANS L’ONGLET PRÉPA VOLS';
        label.classList.add('prepa-visibility-toggle');
        const section=document.createElement('div');
        section.className='airline-config-section prepa-visibility-section';
        section.innerHTML='<div class="airline-config-section-title"><div><b>VISIBILITÉ DANS PRÉPA VOLS</b><small>ACTIVER OU MASQUER CETTE COMPAGNIE DANS LES CARTES PRÉPA.</small></div></div><div class="airline-module-grid"></div>';
        section.querySelector('.airline-module-grid').appendChild(label);
        modulesSection.after(section);
      }
      return result;
    };
  }

  let prepaCompanyFilter='';
  function prepaRowAirline(row){
    const flight=clean(row&&row.querySelector('.home-flight')&&row.querySelector('.home-flight').textContent);
    const match=flight.match(/^([A-Z]{2,3})\d/);
    return match?match[1]:'';
  }
  function decoratePrepaCompanyCards(){
    const page=document.querySelector('#app .prepa-page');
    const list=page&&page.querySelector('.prepa-list');
    if(!page||!list)return;
    const rows=[...list.querySelectorAll('.prepa-row')].filter(row=>{
      const airline=prepaRowAirline(row);
      if(companyVisibleInPrepa(airline))return true;
      row.remove();
      return false;
    });
    const groups=new Map();
    rows.forEach(row=>{
      const airline=prepaRowAirline(row);
      if(!airline)return;
      if(!groups.has(airline))groups.set(airline,[]);
      groups.get(airline).push(row);
    });
    const countBadge=page.querySelector('.flight-count-badge');
    if(countBadge){
      const ok=rows.filter(row=>row.querySelector('.prepa-validate.done')).length;
      countBadge.textContent=ok+'/'+rows.length+' OK';
    }
    if(prepaCompanyFilter&&groups.has(prepaCompanyFilter)){
      rows.forEach(row=>{if(prepaRowAirline(row)!==prepaCompanyFilter)row.remove()});
      const selected=groups.get(prepaCompanyFilter);
      const toolbar=document.createElement('div');
      toolbar.className='prepa-company-toolbar';
      toolbar.innerHTML='<button onclick="openPrepaOverview()">‹ COMPAGNIES</button><div>'+airlineLogo(prepaCompanyFilter)+'<b>'+escapeHtml(prepaCompanyFilter)+'</b><span>'+selected.length+' VOL'+(selected.length>1?'S':'')+'</span></div>';
      list.before(toolbar);
      return;
    }
    prepaCompanyFilter='';
    const grid=document.createElement('div');
    grid.className='prepa-company-grid';
    grid.innerHTML=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([airline,companyRows])=>{
      const ok=companyRows.filter(row=>row.querySelector('.prepa-validate.done')).length;
      const urgent=companyRows.filter(row=>row.querySelector('.prepa-urgent')).length;
      return '<button class="prepa-company-card" onclick="openPrepaCompany(\''+airline+'\')"><div class="prepa-company-logo">'+airlineLogo(airline,'large')+'</div><div class="prepa-company-copy"><b>'+escapeHtml(airline)+'</b><span>'+companyRows.length+' VOL'+(companyRows.length>1?'S':'')+' À PRÉPARER</span></div><div class="prepa-company-status"><strong>'+ok+'/'+companyRows.length+'</strong><span>PRÉPA OK</span>'+(urgent?'<em>🔔 '+urgent+' URGENT'+(urgent>1?'S':'')+'</em>':'')+'</div><div class="prepa-company-arrow">›</div></button>';
    }).join('');
    list.replaceWith(grid);
  }
  const previousRenderPrepa=window.renderPrepa;
  if(typeof previousRenderPrepa==='function'){
    window.renderPrepa=function(...args){
      const result=previousRenderPrepa.apply(this,args);
      decoratePrepaCompanyCards();
      return result;
    };
  }
  window.openPrepaOverview=function(){prepaCompanyFilter='';return window.renderPrepa()};
  window.openPrepaCompany=function(airline){prepaCompanyFilter=clean(airline);return window.renderPrepa()};
  document.querySelectorAll('.nav button,.mobile-bottom-nav button').forEach(button=>{
    if(clean(button.textContent)==='PRÉPA')button.setAttribute('onclick','openPrepaOverview()');
  });

  function decorateHomeFlightList(){
    document.querySelectorAll('#app .flight-home-row').forEach(row=>{
      const flight=clean(row.querySelector('.home-flight')&&row.querySelector('.home-flight').textContent);
      if(!flight.startsWith('SQ')||row.querySelector('.home-status-dot'))return;
      const data=(Array.isArray(FLIGHTS)?FLIGHTS:[]).find(item=>clean(item&&item.flight)===flight&&(!item.date||String(item.date)===String(HOME_DATE)));
      let level='orange';
      try{level=flightListStatusDot(data)||'orange'}catch(_){}
      const dot=document.createElement('span');
      dot.className='home-status-dot '+level;
      dot.title=level==='green'?'Vol injecté et fiche complète':'Informations du vol à compléter';
      row.querySelector('.home-flight-top')?.insertBefore(dot,row.querySelector('.home-flight'));
    });
  }
  const previousRenderHome=window.renderHome;
  if(typeof previousRenderHome==='function'){
    window.renderHome=function(...args){
      const result=previousRenderHome.apply(this,args);
      decorateHomeFlightList();
      return result;
    };
  }
  decorateHomeFlightList();

  function decorateFlightHeader(){
    document.querySelectorAll('#app .flight-head .live-badge').forEach(element=>{
      if(clean(element.textContent).includes('AERODATABOX'))element.remove();
    });
    document.querySelectorAll('#app .flight-head .live-meta').forEach(element=>element.remove());
  }
  const previousRenderFlight=window.render;
  if(typeof previousRenderFlight==='function'){
    window.render=function(...args){
      const result=previousRenderFlight.apply(this,args);
      decorateFlightHeader();
      return result;
    };
  }

  window.openDeleteFlight=function(replace,feedback){
    const rows=deleteFlightRows();
    const companies=[...new Set(rows.map(row=>clean(row.airline)))].sort();
    const cards=companies.map(airline=>{
      const list=rows.filter(row=>clean(row.airline)===airline);
      const flights=new Set(list.map(row=>clean(row.flight))).size;
      return '<button class="delete-flight-choice" onclick=\'openDeleteFlightNumbers('+JSON.stringify(airline)+')\'>'+deleteFlightLogo(airline)+'<span class="delete-flight-choice-copy"><b>'+escapeHtml(airline)+'</b><span>'+flights+' VOL'+(flights>1?'S':'')+' · '+list.length+' DATE'+(list.length>1?'S':'')+'</span></span></button>';
    }).join('');
    const html=flightManagementTabs('delete')+(feedback?'<div class="import-status ok">✓ '+escapeHtml(feedback)+'</div>':'')+'<div class="delete-flight-step"><div class="delete-flight-help">Sélectionnez d’abord la compagnie du vol à supprimer.</div><div class="delete-flight-grid">'+(cards||'<div class="import-status">AUCUN VOL À SUPPRIMER.</div>')+'</div></div>';
    if(replace&&typeof replaceModal==='function')replaceModal('GESTION DES VOLS','SUPPRIMER · 1/3 · CHOISIR LA COMPAGNIE',html);
    else showModal('GESTION DES VOLS','SUPPRIMER · 1/3 · CHOISIR LA COMPAGNIE',html);
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
    showModal('GESTION DES VOLS','SUPPRIMER · 2/3 · '+airline+' · CHOISIR LE VOL',flightManagementTabs('delete')+'<div class="delete-flight-step"><div class="delete-flight-help">Choisissez le numéro de vol.</div><div class="delete-flight-grid">'+(cards||'<div class="import-status">AUCUN VOL POUR CETTE COMPAGNIE.</div>')+'</div></div>');
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
    showModal('GESTION DES VOLS','SUPPRIMER · 3/3 · '+flight+' · CHOISIR LA DATE',flightManagementTabs('delete')+'<div class="delete-flight-step"><div class="delete-flight-help">Choisissez la date exacte du vol à supprimer.</div><div class="delete-flight-grid">'+(cards||'<div class="import-status">AUCUNE DATE DISPONIBLE.</div>')+'</div></div>');
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
      if(typeof renderHome==='function')renderHome();
      if(typeof modalStack!=='undefined'&&Array.isArray(modalStack)){
        const toolsSnapshot=modalStack.find(snapshot=>clean(snapshot&&snapshot.title)==='OUTILS');
        modalStack.length=0;
        if(toolsSnapshot)modalStack.push(toolsSnapshot);
      }
      openDeleteFlight(true,flight+' · '+deleteFlightDateLabel(date)+' A ÉTÉ SUPPRIMÉ. VOUS RESTEZ DANS LA LISTE DE SUPPRESSION.');
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
  const bodyEnd = source.lastIndexOf("</body>");
  return bodyEnd >= 0
    ? source.slice(0, bodyEnd) + DELETE_FLIGHT_UI + "\n" + source.slice(bodyEnd)
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
