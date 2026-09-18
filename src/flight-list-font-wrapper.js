import app from "./duration-fix-wrapper.js";

/*
 * Flight list readability override.
 * Keeps the existing compact layout while making operational values easier
 * to read on desktop, tablet and mobile.
 */
const FLIGHT_LIST_FONT_STYLE = String.raw`
<style id="alyzia-flight-list-font-css">
#app .flight-home-row .home-flight{font-size:17px!important;font-weight:950!important}
#app .flight-home-row .home-sub,
#app .flight-home-row .home-dest,
#app .flight-home-row .home-destination{font-size:14px!important;font-weight:900!important}
#app .flight-home-row>:nth-child(4){font-size:15px!important;font-weight:950!important;color:#20354c!important}
#app .flight-home-row .home-config-booking>div:nth-child(-n+2){display:grid!important;grid-template-columns:95px minmax(0,1fr)!important;column-gap:12px!important;align-items:baseline!important}
#app .flight-home-row .home-config-booking small{font-size:12px!important;font-weight:900!important;margin:0!important}
#app .flight-home-row .home-config-booking b{font-size:15px!important;font-weight:950!important;margin-left:0!important}
#app .flight-home-row .home-load b{font-size:16px!important;font-weight:950!important}
#app .home-avail{font-size:16px!important;font-weight:950!important;display:inline-flex!important;align-items:baseline!important;gap:0!important}
#app .home-avail:before{content:'AVAILABLE'!important;display:inline-block!important;font-size:16px!important;font-weight:950!important;color:#718398!important;flex:0 0 auto!important;padding-right:12px!important;margin:0!important}
#app .home-avail-value{font-size:16px!important;font-weight:950!important;flex:0 0 auto!important;margin:0!important}
#app .home-favorites-filter{min-width:56px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}
#app .home-favorites-filter.active{background:#fff8d8!important;border-color:#e8b82d!important;box-shadow:0 0 0 3px rgba(232,184,45,.16)!important}
#app .home-note-alert{height:34px;min-width:48px;padding:0 5px 0 7px;display:inline-flex;align-items:center;justify-content:center;gap:2px;border:1px solid #e3bd63;border-radius:10px;background:#fff8df;color:#c69000;line-height:1;box-sizing:border-box}
#app .home-note-bell{display:inline-block;font-size:18px;transform-origin:50% 12%;animation:homeNoteBellRing 1.45s ease-in-out infinite}
#app .home-note-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#d9213f;color:#fff;border:2px solid #fff;font-size:10px;font-weight:1000;line-height:1;box-sizing:border-box;box-shadow:0 1px 3px rgba(150,0,20,.28);animation:homeNoteBadgePulse 1.45s ease-in-out infinite}
@keyframes homeNoteBellRing{0%,72%,100%{transform:rotate(0deg)}78%{transform:rotate(14deg)}84%{transform:rotate(-13deg)}90%{transform:rotate(9deg)}96%{transform:rotate(-6deg)}}
@keyframes homeNoteBadgePulse{0%,60%,100%{transform:scale(1)}75%{transform:scale(1.16)}}
@media(max-width:680px){
  #app .flight-home-row .home-flight{font-size:18px!important}
  #app .flight-home-row .home-sub,
  #app .flight-home-row .home-dest,
  #app .flight-home-row .home-destination{font-size:15px!important}
  #app .flight-home-row>:nth-child(4){font-size:15px!important}
  #app .flight-home-row .home-config-booking>div:nth-child(-n+2){grid-template-columns:95px minmax(0,1fr)!important;column-gap:12px!important}
  #app .flight-home-row .home-config-booking small{font-size:11px!important}
  #app .flight-home-row .home-config-booking b{font-size:15px!important;margin-left:0!important}
  #app .flight-home-row .home-load b{font-size:16px!important}
  #app .home-avail,
  #app .home-avail:before,
  #app .home-avail-value{font-size:16px!important}
  #app .home-favorites-filter{min-width:56px!important}
  #app .home-note-alert{height:31px;min-width:44px;padding:0 4px 0 6px}
  #app .home-note-bell{font-size:16px}
  #app .home-note-count{min-width:18px;height:18px;font-size:9px;padding:0 4px}
}
</style>`;

const FAVORITES_FILTER_SCRIPT = String.raw`
<script id="alyzia-home-favorites-filter-script">
(()=>{
  'use strict';
  let favoritesOnly=false;
  let scheduled=false;

  function findTerminalFilterBar(){
    const allButtons=[...document.querySelectorAll('#app button')];
    const all=allButtons.find(button=>{
      if(String(button.textContent||'').trim().toUpperCase()!=='ALL')return false;
      const parent=button.parentElement;
      if(!parent)return false;
      const labels=[...parent.querySelectorAll('button')].map(b=>String(b.textContent||'').trim().toUpperCase());
      return labels.includes('T1')&&labels.includes('T2')&&labels.includes('T3');
    });
    return all?{all,parent:all.parentElement}:null;
  }

  function ensureFavoritesButton(){
    const found=findTerminalFilterBar();
    if(!found)return null;
    const {all,parent}=found;
    let button=parent.querySelector('.home-favorites-filter');
    if(!button){
      button=all.cloneNode(false);
      button.classList.remove('active');
      button.classList.add('home-favorites-filter');
      button.removeAttribute('onclick');
      button.type='button';
      button.textContent='⭐️';
      button.title='AFFICHER UNIQUEMENT LES VOLS FAVORIS';
      button.setAttribute('aria-label','Afficher uniquement les vols favoris');
      button.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        favoritesOnly=!favoritesOnly;
        applyFavoritesFilter();
      });
      all.insertAdjacentElement('afterend',button);
    }
    button.classList.toggle('active',favoritesOnly);
    button.setAttribute('aria-pressed',favoritesOnly?'true':'false');
    return button;
  }

  function applyFavoritesFilter(){
    ensureFavoritesButton();
    document.querySelectorAll('#app .flight-home-row').forEach(row=>{
      const isFavorite=Boolean(row.querySelector('.home-pin.active'));
      row.style.display=favoritesOnly&&!isFavorite?'none':'';
    });
  }

  function scheduleApply(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      applyFavoritesFilter();
    });
  }

  document.addEventListener('click',event=>{
    if(event.target.closest('.home-pin'))setTimeout(scheduleApply,0);
  },true);

  const start=()=>{
    applyFavoritesFilter();
    const app=document.getElementById('app');
    if(!app)return;
    const observer=new MutationObserver(scheduleApply);
    observer.observe(app,{childList:true,subtree:true});
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
</script>`;

const OLD_AVAILABLE_ROW = '<div class="home-mini home-avail ${avail<0?\'neg\':\'\'}">${avail}${nok?` · ${nok} INOP`:\'\'}</div>';
const NEW_AVAILABLE_ROW = '<div class="home-mini home-avail ${avail<0?\'neg\':\'\'}"><span class="home-avail-value">${avail}${nok?` · ${nok} INOP`:\'\'}</span></div>';

const NOTES_HELPER = [
  'function homeFlightNoteCount(x){',
  '  if(!Array.isArray(x?.flightNotes)) return 0;',
  '  return x.flightNotes.filter(n=>String(n?.text||\'\').trim()).length;',
  '}',
  ''
].join('\n');

const HOME_ACTIONS_START = '<div class="home-row-actions">\n          <button class="home-pin ';
const HOME_ACTIONS_WITH_BELL = '<div class="home-row-actions">\n          ${homeFlightNoteCount(x)>0?\'<span class="home-note-alert" title="\'+homeFlightNoteCount(x)+\' NOTE(S)" aria-label="\'+homeFlightNoteCount(x)+\' notes présentes"><span class="home-note-bell">🔔</span><span class="home-note-count">\'+homeFlightNoteCount(x)+\'</span></span>\':\'\'}\n          <button class="home-pin ';

function patchAvailableRow(html){
  const source=String(html||"");
  return source.includes(OLD_AVAILABLE_ROW)
    ? source.replaceAll(OLD_AVAILABLE_ROW,NEW_AVAILABLE_ROW)
    : source;
}

function patchNotesBell(html){
  let source=String(html||"");
  if(!source)return source;
  if(!source.includes('function homeFlightNoteCount(x)')&&source.includes('function renderHome(){')){
    source=source.replace('function renderHome(){',NOTES_HELPER+'function renderHome(){');
  }
  if(!source.includes('home-note-bell')&&source.includes(HOME_ACTIONS_START)){
    source=source.replaceAll(HOME_ACTIONS_START,HOME_ACTIONS_WITH_BELL);
  }
  return source;
}

export function injectFlightListFontStyle(html){
  let source=patchAvailableRow(html);
  source=patchNotesBell(source);
  if(!source)return source;

  // Inject last in the document so these list styles win over the mobile
  // overrides inserted by duration-fix-wrapper.js.
  const bodyEnd=source.lastIndexOf("</body>");
  const additions=[];
  if(!source.includes('id="alyzia-flight-list-font-css"'))additions.push(FLIGHT_LIST_FONT_STYLE);
  if(!source.includes('id="alyzia-home-favorites-filter-script"'))additions.push(FAVORITES_FILTER_SCRIPT);
  if(!additions.length)return source;
  const block=additions.join("\n")+"\n";
  return bodyEnd>=0
    ? source.slice(0,bodyEnd)+block+source.slice(bodyEnd)
    : source+block;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const contentType=String(response.headers.get("content-type")||"").toLowerCase();
    if(!contentType.includes("text/html"))return response;

    const html=await response.text();
    const patched=injectFlightListFontStyle(html);
    const headers=new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control","no-store");

    return new Response(patched,{
      status:response.status,
      statusText:response.statusText,
      headers
    });
  },

  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx);
  }
};
