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
    for(const [d,a] of [[x&&x.atd,x&&x.ata],[x&&x.std,x&&x.sta]]){
      const dm=hm(d),am=hm(a);
      if(dm==null||am==null)continue;
      let minutes=Math.round((am-arrOff*60)-(dm-depOff*60));
      minutes=((minutes%1440)+1440)%1440;
      if(minutes>0&&minutes<24*60){ALYZIA_DURATION_CACHE.set(key,minutes);return minutes}
    }
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
