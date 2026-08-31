/* V50.19 BUILD121 — Lot 4 safe : affichage uniquement si .flight-head existe */
(function(){
  'use strict';
  const LOT4_BUILD='2026-08-31-121';
  let lot4LastIdentity='';
  let lot4LastCards={};

  function lot4Esc(v){return String(v??'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
  function lot4Num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
  function lot4CurrentFlight(){try{return typeof f==='function'?f():null}catch(e){return null}}
  function lot4IsDetailPage(){
    const app=document.getElementById('app');
    if(!app)return false;
    if(!app.querySelector('.flight-head'))return false;
    try{
      if(typeof currentView!=='undefined' && currentView!=='detail')return false;
    }catch(e){}
    return true;
  }
  function lot4Identity(x){
    if(!x)return '';
    let date='';
    try{date=String(x.date||x.activeDate||HOME_DATE||selectedDate||'').trim()}catch(e){date=String(x.date||x.activeDate||'').trim()}
    const airline=String(x.airline||'').trim().toUpperCase();
    const flight=String(x.flight||'').trim().toUpperCase();
    return date&&airline&&flight?date+'|'+airline+'|'+flight:'';
  }
  function lot4SourceKind(src){
    const list=String(src?.listName||src?.list_name||'').toUpperCase();
    const label=String(src?.label||'').toUpperCase();
    if(list.includes('SUMMARY')||label.includes('SUMMARY'))return 'summary';
    return 'listof';
  }
  function lot4SourceKindLabel(kind){return kind==='summary'?'SUMMARY · RÉSUMÉ CONNEXION':'LIST OF · LISTE NOMINATIVE'}
  function lot4Classes(c){
    const obj=c&&typeof c==='object'?c:{};
    return ['F','J','C','W','S','Y'].filter(function(k){return Object.prototype.hasOwnProperty.call(obj,k)})
      .map(function(k){return '<span class="imported-class-pill">'+k+' '+lot4Num(obj[k])+'</span>'}).join('');
  }
  function lot4NormalizeCards(rawCards){
    const cards=rawCards&&typeof rawCards==='object'?rawCards:{};
    const out={};
    Object.keys(cards).forEach(function(k){
      const card=cards[k]||{};
      const sources=Array.isArray(card.sources)&&card.sources.length?card.sources:[card];
      out[k]=Object.assign({},card,{
        cardKey:card.cardKey||k,
        passengerCount:lot4Num(card.passengerCount),
        sources:sources.map(function(s){return Object.assign({},s,{cardKey:s.cardKey||card.cardKey||k})})
      });
    });
    return out;
  }
  async function lot4FetchFlight(identity){
    const res=await fetch('/api/flights?identity='+encodeURIComponent(identity),{cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status);
    return await res.json();
  }
  function lot4RenderPanel(cards){
    const keys=Object.keys(cards||{}).filter(function(k){return cards[k]});
    if(!keys.length)return '';
    const totalSources=keys.reduce(function(s,k){return s+(cards[k].sources||[]).length},0);
    return '<section id="lot4ImportedCards" class="imported-flight-cards">'+
      '<div class="imported-flight-cards-head">'+
        '<div class="imported-flight-cards-title"><b>CARTES IMPORTÉES</b><span>SUMMARY = résumé connexion · LIST OF = liste nominative</span></div>'+
        '<span class="imported-flight-chip">'+keys.length+' CARTE'+(keys.length>1?'S':'')+' · '+totalSources+' SOURCE'+(totalSources>1?'S':'')+'</span>'+
      '</div>'+
      '<div class="imported-flight-cards-grid">'+keys.map(function(k){return lot4RenderCard(cards[k])}).join('')+'</div>'+
    '</section>';
  }
  function lot4RenderCard(card){
    const sources=Array.isArray(card.sources)?card.sources:[card];
    const mainKind=sources.some(function(s){return lot4SourceKind(s)==='summary'})?'summary':'listof';
    return '<button class="imported-flight-card imported-'+mainKind+'" onclick="openLot4ImportCard(\''+lot4Esc(card.cardKey)+'\')">'+
      '<div class="imported-flight-card-main"><div><h4>'+lot4Esc(card.label||card.cardKey)+'</h4><div class="imported-class-pills">'+lot4Classes(card.classCounts)+'</div></div><div class="imported-count">'+lot4Num(card.passengerCount)+'</div></div>'+
      '<div class="imported-flight-card-meta">'+sources.slice(0,3).map(function(src){
        const kind=lot4SourceKind(src);
        return '<div class="imported-source-row"><b>'+lot4Esc(src.listName||src.list_name||'—')+'<em class="imported-source-type '+kind+'">'+lot4SourceKindLabel(kind)+'</em></b><span>'+lot4Num(src.passengerCount)+' PAX · '+lot4Esc(src.mappingScope||'')+'</span></div>';
      }).join('')+'</div>'+
    '</button>';
  }
  function lot4RemovePanel(){
    const old=document.getElementById('lot4ImportedCards');
    if(old)old.remove();
  }
  function lot4InsertPanel(cards){
    const app=document.getElementById('app');
    if(!app)return;
    lot4RemovePanel();

    const head=app.querySelector('.flight-head');
    if(!head)return; // sécurité : jamais sur accueil / vols / prépa

    const panel=lot4RenderPanel(cards);
    if(!panel)return;
    head.insertAdjacentHTML('afterend',panel);
  }
  async function lot4DecorateFlightImportCards(){
    if(!lot4IsDetailPage()){
      lot4RemovePanel();
      return;
    }

    const x=lot4CurrentFlight();
    const identity=lot4Identity(x);
    if(!identity){
      lot4RemovePanel();
      return;
    }

    try{
      let cards=lot4NormalizeCards(x?.imports?.cards);
      if(!Object.keys(cards).length || lot4LastIdentity!==identity){
        const data=await lot4FetchFlight(identity);
        if(data?.ok && data?.flight){
          cards=lot4NormalizeCards(data.flight?.imports?.cards);
          try{Object.assign(x,data.flight)}catch(e){}
        }
      }
      lot4LastIdentity=identity;
      lot4LastCards=cards;
      lot4InsertPanel(cards);
    }catch(e){
      console.warn('LOT4 IMPORT CARDS',e);
    }
  }

  window.openLot4ImportCard=function(cardKey){
    const card=lot4LastCards[String(cardKey||'')]||null;
    if(!card)return;
    const sources=Array.isArray(card.sources)?card.sources:[card];
    const body='<div class="imported-modal-kpis">'+
      '<div class="imported-modal-kpi"><b>'+lot4Num(card.passengerCount)+'</b><span>TOTAL CARTE</span></div>'+
      '<div class="imported-modal-kpi"><b>'+sources.length+'</b><span>SOURCE'+(sources.length>1?'S':'')+'</span></div>'+
      '<div class="imported-modal-kpi"><b>'+lot4Esc(card.mappingScope||sources[0]?.mappingScope||'—')+'</b><span>MAPPING</span></div>'+
    '</div><div class="imported-modal-list">'+sources.map(function(src){
      const kind=lot4SourceKind(src);
      return '<div class="imported-modal-source"><h4>'+lot4Esc(src.listName||'—')+'</h4>'+
      '<div><span class="imported-source-type '+kind+'">'+lot4SourceKindLabel(kind)+'</span></div>'+
      '<div class="imported-class-pills">'+lot4Classes(src.classCounts)+'</div>'+
      '<div class="imported-modal-kpis">'+
        '<div class="imported-modal-kpi"><b>'+lot4Num(src.passengerCount)+'</b><span>PASSAGERS</span></div>'+
        '<div class="imported-modal-kpi"><b>'+lot4Esc(src.documentType||src.cardKey||'—')+'</b><span>CARTE</span></div>'+
        '<div class="imported-modal-kpi"><b>'+lot4Esc(src.status||'—')+'</b><span>STATUT</span></div>'+
      '</div>'+
      '<div class="imported-source-row" style="margin-top:8px"><b>VERSION</b><span>'+lot4Esc(src?.source?.versionId||'—')+'</span></div></div>';
    }).join('')+'</div>';
    showModal('IMPORT · '+lot4Esc(card.label||card.cardKey),'SUMMARY = résumé connexion · LIST OF = liste nominative',body);
  };

  window.refreshLot4ImportCards=function(){lot4LastIdentity='';lot4DecorateFlightImportCards()};

  function lot4Start(){
    try{
      if(typeof render==='function' && !render.__lot4Wrapped){
        const originalRender=render;
        render=function(){
          const r=originalRender.apply(this,arguments);
          setTimeout(lot4DecorateFlightImportCards,120);
          return r;
        };
        render.__lot4Wrapped=true;
      }
      if(typeof renderHome==='function' && !renderHome.__lot4Wrapped){
        const originalHome=renderHome;
        renderHome=function(){
          const r=originalHome.apply(this,arguments);
          setTimeout(lot4RemovePanel,0);
          return r;
        };
        renderHome.__lot4Wrapped=true;
      }
      setTimeout(lot4DecorateFlightImportCards,300);
    }catch(e){console.warn('LOT4 START',e)}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',lot4Start);
  else lot4Start();

  console.log('ALYZIA OPS V50.19 BUILD '+LOT4_BUILD+' — LOT4 SAFE DETAIL ONLY LOADED');
})();
