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
.delete-flight-help-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.delete-flight-toggle-select{min-height:38px;border:1px solid #d6e3f1;border-radius:10px;background:#fff;color:#075fd3;font-size:9px;font-weight:950;padding:0 12px;cursor:pointer;white-space:nowrap}
.delete-flight-toggle-select.active{border-color:#efb5b5;background:#fff5f5;color:#b42318}
.delete-flight-select-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 10px;border:1px solid #d9e5f1;border-radius:12px;background:#f7faff}
.delete-flight-select-bar .mini{min-height:34px;border:1px solid #d6e3f1;border-radius:9px;background:#fff;color:#27445f;font-size:9px;font-weight:950;padding:0 10px;cursor:pointer}
.delete-flight-select-bar .mini.danger{color:#b42318;border-color:#efb5b5;background:#fff5f5}
.delete-flight-select-bar .mini:disabled{opacity:.45;cursor:default}
.delete-flight-select-count{font-size:10px;font-weight:950;color:#3a5674;margin-right:auto}
.delete-flight-check{display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.delete-flight-check input{width:18px;height:18px;cursor:pointer}
.delete-flight-choice.selected{border-color:#075fd3!important;background:#f0f7ff!important}
.gmail-tool-card .tool-icon{color:#b42318!important}
.prepa-company-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.prepa-company-card{min-height:128px;border:1px solid #dce8f4;border-radius:18px;background:#fff;padding:18px;display:grid;grid-template-columns:auto 1fr auto auto;gap:14px;align-items:center;text-align:left;color:#17324d;cursor:pointer;box-shadow:0 8px 24px rgba(32,75,120,.06)}
.prepa-company-card:hover{border-color:#76aeea;transform:translateY(-1px)}
.prepa-company-logo{display:flex;align-items:center;justify-content:center}.prepa-company-logo .airline-logo,.prepa-company-logo .airline-logo-fallback{width:58px;height:58px}
.prepa-company-copy{display:grid;gap:5px}.prepa-company-copy b{font-size:22px;font-weight:950}.prepa-company-copy span{font-size:10px;font-weight:850;color:#70839a}
.prepa-company-status{display:grid;gap:3px;text-align:right}.prepa-company-status strong{font-size:22px;color:#087749}.prepa-company-status span{font-size:8px;font-weight:950;color:#70839a}.prepa-company-status em{font-size:9px;font-style:normal;font-weight:950;color:#b42318}
.prepa-company-arrow{font-size:30px;color:#075fd3}.prepa-company-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.prepa-company-toolbar>button{min-height:42px;border:1px solid #d6e3f1;border-radius:11px;background:#fff;color:#27445f;font-size:10px;font-weight:950;padding:0 15px;cursor:pointer}.prepa-company-toolbar>div{display:flex;align-items:center;gap:9px}.prepa-company-toolbar b{font-size:18px}.prepa-company-toolbar span{font-size:9px;font-weight:850;color:#70839a}
.prepa-visibility-section{border-color:#a9cbed!important;background:#f6faff!important}.prepa-visibility-toggle{min-height:54px!important;border-color:#8ab9ec!important;background:#fff!important}.prepa-visibility-toggle span{font-size:10px!important;color:#075fc8!important}
/* En-tête fiche vol V2 — bandeau compact (identité + 6 champs sur une ligne, statut + actions sur une seconde). */
.flight-head{min-height:0!important;grid-template-columns:none!important;padding:14px 16px!important;gap:10px!important;background:linear-gradient(135deg,#fff 0%,#f7faff 100%)!important;display:flex!important;flex-direction:column!important}
.flight-head .fh-row1{display:flex!important;flex-wrap:wrap!important;align-items:stretch!important;gap:10px!important}
.flight-head .fh-id{flex:1 1 230px!important;min-width:210px!important;display:flex!important;flex-direction:column!important;justify-content:center!important;gap:4px!important;padding:4px 16px 4px 0!important;border-right:1px solid #e4edf7!important;min-height:0!important}
.flight-head .fh-id-meta{font-size:11px!important;font-weight:950!important;color:#0f2741!important;letter-spacing:.02em!important}
.flight-head .fh-id .flight-id-with-logo{margin:0!important;gap:10px!important;position:relative!important}
.flight-head .fh-id .airline-logo.large{width:58px!important;height:58px!important;flex:0 0 58px!important;object-fit:contain!important}
.flight-head .fh-id .flight-number{font-size:26px!important;letter-spacing:0!important;max-width:none!important;overflow:visible!important}
.flight-head .fh-id .route{font-size:15px!important;margin:0!important;width:auto!important;white-space:nowrap!important}
.flight-head .fh-note-bell{border:0!important;background:transparent!important;cursor:pointer!important;display:inline-flex!important;align-items:flex-start!important;gap:2px!important;padding:0!important;margin-left:2px!important}
.flight-head .fh-note-bell .home-note-bell{font-size:17px!important}
.flight-head .fh-stat{flex:1 1 130px!important;min-width:112px!important;border:1px solid #e4edf7!important;border-radius:12px!important;background:#fff!important;min-height:0!important;padding:9px 12px!important;display:flex!important;flex-direction:column!important;justify-content:flex-start!important;gap:3px!important}
.flight-head .fh-stat-double{flex:1 1 210px!important;min-width:180px!important}
.flight-head .fh-row2{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:8px!important;padding-top:10px!important;border-top:1px solid #e7edf3!important}
.flight-head .fh-row2-spacer{flex:1 1 24px!important}
.flight-head .fh-row2 .enrichment-chip{width:auto!important;flex:0 0 auto!important;margin-top:0!important;padding:5px 10px!important}
.flight-head .fh-row2 .live-strip{width:auto!important;flex:0 0 auto!important;margin-top:0!important}
.flight-head .fh-row2 .detail-prepa-actions{flex:0 0 auto!important;width:auto!important}
.flight-head .time-big{min-height:0!important;font-size:22px!important}
.home-sub{font-size:10px!important}.home-config-booking small{font-size:8px!important}.home-config-booking b{font-size:10px!important}.home-load b{font-size:12px!important}.home-avail{font-weight:950!important}
@media(max-width:1100px){.flight-head .fh-stat{flex-basis:118px!important}}
@media(max-width:680px){
 .delete-flight-grid,.prepa-company-grid{grid-template-columns:1fr}.delete-flight-choice{min-height:78px}.prepa-company-card{min-height:104px;padding:14px;grid-template-columns:auto 1fr auto}.prepa-company-status{grid-column:2}.prepa-company-arrow{grid-column:3;grid-row:1/3}
 .flight-head{padding:10px!important}.flight-head .fh-id{flex-basis:100%!important;border-right:0!important;border-bottom:1px solid #e4edf7!important;padding:2px 0 10px!important}.flight-head .fh-stat{flex-basis:calc(50% - 6px)!important}.flight-head .saria-bridge-pill{display:none!important}.flight-head .saria-ac-wrap{gap:4px!important}.flight-management-tabs{position:sticky;top:0;z-index:2}
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

  let dfNumSelectMode=false,dfDateSelectMode=false;
  const dfNumSelected=new Set(),dfDateSelected=new Set();

  async function deleteFlightRowsBulk(rows){
    let done=0;const failed=[];
    for(const row of rows){
      try{
        const response=await fetch(opsApiUrl('/api/prepa/flight'),{
          method:'DELETE',cache:'no-store',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({airline:row.airline,flightNumber:row.flight,flightDate:row.date,deleteDrive:false})
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok||!result||!result.ok)throw new Error(result&&result.error||('HTTP '+response.status));
        for(let i=FLIGHTS.length-1;i>=0;i--)if(sameFlight(FLIGHTS[i],row.airline,row.flight,row.date))FLIGHTS.splice(i,1);
        try{
          const prefix=clean(row.airline)+'|'+clean(row.flight)+'|'+String(row.date||'').trim();
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
        done++;
      }catch(error){
        failed.push(clean(row.flight)+' · '+deleteFlightDateLabel(row.date));
      }
    }
    await saveImportedFlightsPersistent(FLIGHTS).catch(()=>{});
    if(typeof fetchRecentPrepaImports==='function')await fetchRecentPrepaImports().catch(()=>{});
    selected=Math.max(0,Math.min(Number(selected)||0,FLIGHTS.length-1));
    if(typeof renderHome==='function')renderHome();
    return {done,failed};
  }

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

  window.openDeleteFlightNumbers=function(airline,feedback){
    airline=clean(airline);
    const rows=deleteFlightRows().filter(row=>clean(row.airline)===airline);
    const numbers=[...new Set(rows.map(row=>clean(row.flight)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    for(const k of [...dfNumSelected])if(!numbers.includes(k))dfNumSelected.delete(k);
    const sel=dfNumSelectMode;
    const cards=numbers.map(flight=>{
      const list=rows.filter(row=>clean(row.flight)===flight);
      const destinations=[...new Set(list.map(row=>clean(row.dest)).filter(Boolean))];
      const route=destinations.length?'CDG → '+destinations.join(' / '):'DESTINATION NON RENSEIGNÉE';
      const checked=dfNumSelected.has(flight);
      const checkbox=sel?'<span class="delete-flight-check"><input type="checkbox" '+(checked?'checked':'')+' onclick="event.stopPropagation();toggleDeleteFlightNumberSelect('+JSON.stringify(airline)+','+JSON.stringify(flight)+')"></span>':'';
      const onclick=sel?'toggleDeleteFlightNumberSelect('+JSON.stringify(airline)+','+JSON.stringify(flight)+')':'openDeleteFlightDates('+JSON.stringify(airline)+','+JSON.stringify(flight)+')';
      return '<button class="delete-flight-choice'+(sel&&checked?' selected':'')+'" onclick=\''+onclick+'\'>'+checkbox+'<span class="delete-flight-choice-copy"><b>'+deleteFlightLogo(airline)+' '+escapeHtml(flight)+'</b><span>'+escapeHtml(route)+' · '+list.length+' DATE'+(list.length>1?'S':'')+'</span></span></button>';
    }).join('');
    const nSel=dfNumSelected.size;
    const selectBar=sel?'<div class="delete-flight-select-bar"><button class="mini" onclick=\'selectAllDeleteFlightNumbers('+JSON.stringify(airline)+')\'>TOUT SÉLECTIONNER</button><button class="mini" onclick=\'clearDeleteFlightNumberSelection('+JSON.stringify(airline)+')\'>AUCUN</button><span class="delete-flight-select-count">'+nSel+' VOL'+(nSel>1?'S':'')+' SÉLECTIONNÉ'+(nSel>1?'S':'')+'</span><button class="mini danger" '+(nSel?'':'disabled')+' onclick=\'confirmDeleteFlightNumbersBulk('+JSON.stringify(airline)+')\'>🗑 SUPPRIMER LA SÉLECTION</button></div>':'';
    const toggleBtn='<button class="delete-flight-toggle-select'+(sel?' active':'')+'" onclick=\'toggleDeleteFlightNumberSelectMode('+JSON.stringify(airline)+')\'>'+(sel?'✕ ANNULER SÉLECTION':'☑ SÉLECTIONNER PLUSIEURS VOLS')+'</button>';
    const html=flightManagementTabs('delete')+(feedback?'<div class="import-status ok">✓ '+escapeHtml(feedback)+'</div>':'')+'<div class="delete-flight-step"><div class="delete-flight-help-row"><div class="delete-flight-help">Choisissez le numéro de vol, ou sélectionnez-en plusieurs pour les supprimer d’un coup.</div>'+toggleBtn+'</div>'+selectBar+'<div class="delete-flight-grid">'+(cards||'<div class="import-status">AUCUN VOL POUR CETTE COMPAGNIE.</div>')+'</div></div>';
    showModal('GESTION DES VOLS','SUPPRIMER · 2/3 · '+airline+' · CHOISIR LE VOL',html);
  };
  window.toggleDeleteFlightNumberSelectMode=function(airline){
    dfNumSelectMode=!dfNumSelectMode;
    if(!dfNumSelectMode)dfNumSelected.clear();
    openDeleteFlightNumbers(airline);
  };
  window.toggleDeleteFlightNumberSelect=function(airline,flight){
    flight=clean(flight);
    if(dfNumSelected.has(flight))dfNumSelected.delete(flight);else dfNumSelected.add(flight);
    openDeleteFlightNumbers(airline);
  };
  window.selectAllDeleteFlightNumbers=function(airline){
    airline=clean(airline);
    deleteFlightRows().filter(row=>clean(row.airline)===airline).forEach(row=>dfNumSelected.add(clean(row.flight)));
    openDeleteFlightNumbers(airline);
  };
  window.clearDeleteFlightNumberSelection=function(airline){
    dfNumSelected.clear();
    openDeleteFlightNumbers(airline);
  };
  window.confirmDeleteFlightNumbersBulk=function(airline){
    airline=clean(airline);
    const flights=[...dfNumSelected];
    if(!flights.length)return;
    const rows=deleteFlightRows().filter(row=>clean(row.airline)===airline&&flights.includes(clean(row.flight)));
    const list=flights.map(flight=>{
      const n=rows.filter(row=>clean(row.flight)===flight).length;
      return escapeHtml(flight)+' ('+n+' date'+(n>1?'s':'')+')';
    }).join('<br>');
    showModal('CONFIRMER LA SUPPRESSION',flights.length+' VOL'+(flights.length>1?'S':''),
      '<div class="delete-flight-confirm"><strong>'+flights.length+' numéro'+(flights.length>1?'s':'')+' de vol · '+rows.length+' date'+(rows.length>1?'s':'')+' au total</strong>'+list+'<br><br>La fiche vol, sa PRÉPA et ses données associées seront supprimées pour chaque date. Les e-mails restent dans Gmail et ne recréeront pas automatiquement ces vols.<br><br><b>ACTION IRRÉVERSIBLE.</b></div><div class="delete-flight-actions"><button class="cancel" onclick=\'openDeleteFlightNumbers('+JSON.stringify(airline)+')\'>ANNULER</button><button class="danger" onclick=\'runDeleteFlightNumbersBulk('+JSON.stringify(airline)+')\'>SUPPRIMER DÉFINITIVEMENT</button></div>');
  };
  window.runDeleteFlightNumbersBulk=async function(airline){
    airline=clean(airline);
    const flights=[...dfNumSelected];
    const rows=deleteFlightRows().filter(row=>clean(row.airline)===airline&&flights.includes(clean(row.flight)));
    const body=document.getElementById('modalBody');
    if(body)body.innerHTML='<div class="import-status">SUPPRESSION DE '+rows.length+' VOL(S) EN COURS…</div>';
    const {done,failed}=await deleteFlightRowsBulk(rows);
    dfNumSelected.clear();dfNumSelectMode=false;
    if(typeof modalStack!=='undefined'&&Array.isArray(modalStack)){
      const toolsSnapshot=modalStack.find(snapshot=>clean(snapshot&&snapshot.title)==='OUTILS');
      modalStack.length=0;
      if(toolsSnapshot)modalStack.push(toolsSnapshot);
    }
    const feedback=done+' DATE'+(done>1?'S':'')+' SUPPRIMÉE'+(done>1?'S':'')+' POUR '+flights.length+' VOL'+(flights.length>1?'S':'')+(failed.length?' · '+failed.length+' ÉCHEC'+(failed.length>1?'S':'')+' ('+failed.join(', ')+')':'');
    openDeleteFlightNumbers(airline,feedback);
  };

  window.openDeleteFlightDates=function(airline,flight,feedback){
    airline=clean(airline);flight=clean(flight);
    const rows=deleteFlightRows()
      .filter(row=>clean(row.airline)===airline&&clean(row.flight)===flight)
      .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const validDates=new Set(rows.map(row=>String(row.date||'').trim()));
    for(const k of [...dfDateSelected])if(!validDates.has(k))dfDateSelected.delete(k);
    const sel=dfDateSelectMode;
    const cards=rows.map(row=>{
      const date=String(row.date||'').trim();
      const details=[row.std?'STD '+row.std:'',row.dest?'CDG → '+clean(row.dest):''].filter(Boolean).join(' · ');
      const checked=dfDateSelected.has(date);
      const checkbox=sel?'<span class="delete-flight-check"><input type="checkbox" '+(checked?'checked':'')+' onclick="event.stopPropagation();toggleDeleteFlightDateSelect('+JSON.stringify(airline)+','+JSON.stringify(flight)+','+JSON.stringify(date)+')"></span>':'';
      const onclick=sel?'toggleDeleteFlightDateSelect('+JSON.stringify(airline)+','+JSON.stringify(flight)+','+JSON.stringify(date)+')':'openDeleteFlightConfirmation('+JSON.stringify(airline)+','+JSON.stringify(flight)+','+JSON.stringify(date)+')';
      return '<button class="delete-flight-choice danger'+(sel&&checked?' selected':'')+'" onclick=\''+onclick+'\'>'+checkbox+'<span class="delete-flight-choice-copy"><b>'+escapeHtml(deleteFlightDateLabel(date))+'</b><span>'+escapeHtml(details||date)+'</span></span></button>';
    }).join('');
    const nSel=dfDateSelected.size;
    const selectBar=sel?'<div class="delete-flight-select-bar"><button class="mini" onclick=\'selectAllDeleteFlightDates('+JSON.stringify(airline)+','+JSON.stringify(flight)+')\'>TOUT SÉLECTIONNER</button><button class="mini" onclick=\'clearDeleteFlightDateSelection('+JSON.stringify(airline)+','+JSON.stringify(flight)+')\'>AUCUN</button><span class="delete-flight-select-count">'+nSel+' DATE'+(nSel>1?'S':'')+' SÉLECTIONNÉE'+(nSel>1?'S':'')+'</span><button class="mini danger" '+(nSel?'':'disabled')+' onclick=\'confirmDeleteFlightDatesBulk('+JSON.stringify(airline)+','+JSON.stringify(flight)+')\'>🗑 SUPPRIMER LA SÉLECTION</button></div>':'';
    const toggleBtn='<button class="delete-flight-toggle-select'+(sel?' active':'')+'" onclick=\'toggleDeleteFlightDateSelectMode('+JSON.stringify(airline)+','+JSON.stringify(flight)+')\'>'+(sel?'✕ ANNULER SÉLECTION':'☑ SÉLECTIONNER PLUSIEURS DATES')+'</button>';
    const html=flightManagementTabs('delete')+(feedback?'<div class="import-status ok">✓ '+escapeHtml(feedback)+'</div>':'')+'<div class="delete-flight-step"><div class="delete-flight-help-row"><div class="delete-flight-help">Choisissez la date exacte du vol à supprimer, ou sélectionnez-en plusieurs.</div>'+toggleBtn+'</div>'+selectBar+'<div class="delete-flight-grid">'+(cards||'<div class="import-status">AUCUNE DATE DISPONIBLE.</div>')+'</div></div>';
    showModal('GESTION DES VOLS','SUPPRIMER · 3/3 · '+flight+' · CHOISIR LA DATE',html);
  };
  window.toggleDeleteFlightDateSelectMode=function(airline,flight){
    dfDateSelectMode=!dfDateSelectMode;
    if(!dfDateSelectMode)dfDateSelected.clear();
    openDeleteFlightDates(airline,flight);
  };
  window.toggleDeleteFlightDateSelect=function(airline,flight,date){
    date=String(date||'').trim();
    if(dfDateSelected.has(date))dfDateSelected.delete(date);else dfDateSelected.add(date);
    openDeleteFlightDates(airline,flight);
  };
  window.selectAllDeleteFlightDates=function(airline,flight){
    deleteFlightRows().filter(row=>clean(row.airline)===clean(airline)&&clean(row.flight)===clean(flight)).forEach(row=>dfDateSelected.add(String(row.date||'').trim()));
    openDeleteFlightDates(airline,flight);
  };
  window.clearDeleteFlightDateSelection=function(airline,flight){
    dfDateSelected.clear();
    openDeleteFlightDates(airline,flight);
  };
  window.confirmDeleteFlightDatesBulk=function(airline,flight){
    airline=clean(airline);flight=clean(flight);
    const dates=[...dfDateSelected];
    if(!dates.length)return;
    const list=dates.map(date=>escapeHtml(deleteFlightDateLabel(date))).join('<br>');
    showModal('CONFIRMER LA SUPPRESSION',flight+' · '+dates.length+' DATE'+(dates.length>1?'S':''),
      '<div class="delete-flight-confirm"><strong>'+deleteFlightLogo(airline)+' '+escapeHtml(flight)+' · '+dates.length+' date'+(dates.length>1?'s':'')+'</strong>'+list+'<br><br>La fiche vol, sa PRÉPA et ses données associées seront supprimées pour chaque date. Les e-mails restent dans Gmail et ne recréeront pas automatiquement ces vols.<br><br><b>ACTION IRRÉVERSIBLE.</b></div><div class="delete-flight-actions"><button class="cancel" onclick=\'openDeleteFlightDates('+JSON.stringify(airline)+','+JSON.stringify(flight)+')\'>ANNULER</button><button class="danger" onclick=\'runDeleteFlightDatesBulk('+JSON.stringify(airline)+','+JSON.stringify(flight)+')\'>SUPPRIMER DÉFINITIVEMENT</button></div>');
  };
  window.runDeleteFlightDatesBulk=async function(airline,flight){
    airline=clean(airline);flight=clean(flight);
    const dates=[...dfDateSelected];
    const rows=deleteFlightRows().filter(row=>clean(row.airline)===airline&&clean(row.flight)===flight&&dates.includes(String(row.date||'').trim()));
    const body=document.getElementById('modalBody');
    if(body)body.innerHTML='<div class="import-status">SUPPRESSION DE '+rows.length+' DATE(S) EN COURS…</div>';
    const {done,failed}=await deleteFlightRowsBulk(rows);
    dfDateSelected.clear();dfDateSelectMode=false;
    if(typeof modalStack!=='undefined'&&Array.isArray(modalStack)){
      const toolsSnapshot=modalStack.find(snapshot=>clean(snapshot&&snapshot.title)==='OUTILS');
      modalStack.length=0;
      if(toolsSnapshot)modalStack.push(toolsSnapshot);
    }
    const feedback=done+' DATE'+(done>1?'S':'')+' SUPPRIMÉE'+(done>1?'S':'')+(failed.length?' · '+failed.length+' ÉCHEC'+(failed.length>1?'S':'')+' ('+failed.join(', ')+')':'');
    if(deleteFlightRows().some(row=>clean(row.airline)===airline&&clean(row.flight)===flight))openDeleteFlightDates(airline,flight,feedback);
    else openDeleteFlightNumbers(airline,feedback);
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
