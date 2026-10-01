import app from "./flight-list-times-wrapper.js";

const HELPER = String.raw`
<script id="alyzia-duration-auto-helper">
const ALYZIA_DURATION_CACHE=window.__alyziaDurationCache||(window.__alyziaDurationCache=new Map());
function alyziaDurationCacheKey(x){
  return [
    String(x&&x.date||x&&x.flight_date||x&&x.flightDate||''),
    String(x&&x.airline||''),
    String(x&&x.flight||x&&x.flight_number||''),
    String(x&&x.dep||x&&x.origin||'CDG'),
    String(x&&x.dest||x&&x.destination||'')
  ].join('|').toUpperCase();
}
// Durée théorique = STD -> STA (sans tenir compte de l'ATD/ATA). Sert à estimer l'ETA d'un vol parti : ETA = ATD + durée théorique.
function alyziaTheoreticalDurationMinutes(x){return alyziaAutoDurationMinutes(Object.assign({},x,{atd:'',ata:'',eta:''}))}
function alyziaEstimatedEta(x){
  try{
    const m=String(x&&x.atd||'').trim().match(/^(\d{1,2}):(\d{2})/);if(!m)return '';
    const dur=alyziaTheoreticalDurationMinutes(x);if(!Number.isFinite(dur)||dur<=0)return '';
    const depAirport=String(x&&x.dep||x&&x.origin||'CDG').trim().toUpperCase(),arrAirport=String(x&&x.dest||x&&x.destination||'').trim().toUpperCase();
    const depOff=Number(TZ[depAirport]),arrOff=Number(TZ[arrAirport]);if(!Number.isFinite(depOff)||!Number.isFinite(arrOff))return '';
    let t=(Number(m[1])*60+Number(m[2]))-depOff*60+dur+arrOff*60;t=((Math.round(t)%1440)+1440)%1440;
    return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');
  }catch(e){return ''}
}
function alyziaAutoDurationMinutes(x){
  // Durée de vol CALCULÉE d'après les horaires : (STA - fuseau arrivée) - (STD - fuseau départ), modulo 24 h.
  // Priorité à la durée réelle (ATD -> ATA) quand les deux sont connus, sinon STD -> STA. La durée enregistrée ne sert que de secours.
  const key=alyziaDurationCacheKey(x);
  const hm=v=>{const m=String(v==null?'':v).trim().match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
  const depAirport=String(x&&x.dep||x&&x.origin||'CDG').trim().toUpperCase();
  const arrAirport=String(x&&x.dest||x&&x.destination||'').trim().toUpperCase();
  let depOff=NaN,arrOff=NaN;
  try{depOff=Number(TZ[depAirport]);arrOff=Number(TZ[arrAirport])}catch(e){}
  if(Number.isFinite(depOff)&&Number.isFinite(arrOff)){
    const span=(d,a)=>{const dm=hm(d),am=hm(a);if(dm==null||am==null)return null;let m=Math.round((am-arrOff*60)-(dm-depOff*60));m=((m%1440)+1440)%1440;return m>0&&m<24*60?m:null};
    const theo=span(x&&x.std,x&&x.sta);
    // Meilleure durée disponible : réelle (ATD->ATA), sinon estimée (ATD->ETA), sinon théorique (STD->STA).
    // Les écarts aberrants (> 2 h avec la durée théorique) sont ignorés : donnée fournisseur douteuse.
    for(const [d,a,checked] of [[x&&x.atd,x&&x.ata,false],[x&&x.atd,x&&x.eta,true]]){
      const m=span(d,a);
      if(m==null)continue;
      if(checked&&theo!=null&&Math.abs(m-theo)>120)continue;
      ALYZIA_DURATION_CACHE.set(key,m);return m;
    }
    if(theo!=null){ALYZIA_DURATION_CACHE.set(key,theo);return theo}
  }
  const existing=Number(x&&x.duration);
  if(Number.isFinite(existing)&&existing>0){const value=Math.round(existing);ALYZIA_DURATION_CACHE.set(key,value);return value}
  return ALYZIA_DURATION_CACHE.has(key)?ALYZIA_DURATION_CACHE.get(key):existing;
}
</script>`;

function patchDuration(html){
  let source=String(html||'');
  if(!source)return source;

  if(!source.includes('id="alyzia-duration-auto-helper"')){
    const bodyEnd=source.lastIndexOf('</body>');
    source=bodyEnd>=0
      ? source.slice(0,bodyEnd)+HELPER+'\n'+source.slice(bodyEnd)
      : source+HELPER;
  }

  source=source.replaceAll('durationText(x.duration)','durationText(alyziaAutoDurationMinutes(x))');
  return source;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const contentType=String(response.headers.get('content-type')||'').toLowerCase();
    if(!contentType.includes('text/html'))return response;

    const html=await response.text();
    const patched=patchDuration(html);
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');

    return new Response(patched,{
      status:response.status,
      statusText:response.statusText,
      headers
    });
  },

  scheduled(controller,env,ctx){
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
