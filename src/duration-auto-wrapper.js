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
  const key=alyziaDurationCacheKey(x);
  const existing=Number(x&&x.duration);
  if(Number.isFinite(existing)&&existing>0){
    const value=Math.round(existing);
    ALYZIA_DURATION_CACHE.set(key,value);
    return value;
  }

  const std=String(x&&x.std||'').trim();
  const sta=String(x&&x.sta||'').trim();
  const depDate=String(x&&x.date||x&&x.flight_date||x&&x.flightDate||'').trim();
  const arrDate=String(x&&x.staArrivalDate||'').trim();
  if(/^\d{2}:\d{2}$/.test(std)&&/^\d{2}:\d{2}$/.test(sta)&&/^20\d{2}-\d{2}-\d{2}$/.test(depDate)&&/^20\d{2}-\d{2}-\d{2}$/.test(arrDate)){
    const depAirport=String(x&&x.dep||x&&x.origin||'CDG').trim().toUpperCase();
    const arrAirport=String(x&&x.dest||x&&x.destination||'').trim().toUpperCase();
    const depOff=Number((typeof TZ==='object'&&TZ&&TZ[depAirport]!=null)?TZ[depAirport]:2);
    const arrOff=Number((typeof TZ==='object'&&TZ&&TZ[arrAirport]!=null)?TZ[arrAirport]:2);

    const depMs=Date.parse(depDate+'T'+std+':00Z')-depOff*60*60*1000;
    const arrMs=Date.parse(arrDate+'T'+sta+':00Z')-arrOff*60*60*1000;
    const minutes=Math.round((arrMs-depMs)/60000);
    if(Number.isFinite(minutes)&&minutes>0&&minutes<24*60){
      ALYZIA_DURATION_CACHE.set(key,minutes);
      return minutes;
    }
  }

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
