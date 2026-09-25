import app from "./oag-sta-wrapper.js";

const OLD_HOME_TIME = "<div class=\"home-time\">${x.std}${x.edt?`<span class=\"etd-small\">ETD ${x.edt}</span>`:''}</div>";
const NEW_HOME_TIME = "<div class=\"home-time home-time-ops\"><span class=\"home-std-main\">${x.std}</span>${x.edt?`<span class=\"etd-small\">ETD ${x.edt}</span>`:''}<span class=\"home-sta-small\">STA ${schedule(x).sta||x.sta||'—'}</span>${x.edt&&schedule(x).eta?`<span class=\"eta-small\">ETA ${schedule(x).eta}</span>`:''}</div>";

const TIMES_STYLE = String.raw`
<style id="alyzia-home-times-css">
#app .flight-home-row .home-time.home-time-ops{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:1px!important;line-height:1.08!important}
#app .flight-home-row .home-time.home-time-ops .home-std-main{font-size:20px!important;font-weight:950!important;color:#101b2e!important;line-height:1.05!important}
#app .flight-home-row .home-time.home-time-ops .etd-small{display:block!important;font-size:13px!important;font-weight:950!important;color:#ef1f2e!important;margin-top:3px!important;line-height:1.1!important;white-space:nowrap!important}
#app .flight-home-row .home-time.home-time-ops .home-sta-small{display:block!important;font-size:12px!important;font-weight:900!important;color:#51657c!important;margin-top:4px!important;line-height:1.1!important;white-space:nowrap!important}
#app .flight-home-row .home-time.home-time-ops .eta-small{display:block!important;font-size:13px!important;font-weight:950!important;color:#ef1f2e!important;margin-top:1px!important;line-height:1.1!important;white-space:nowrap!important}
@media(max-width:680px){
  #app .flight-home-row .home-time.home-time-ops .home-std-main{font-size:18px!important}
  #app .flight-home-row .home-time.home-time-ops .etd-small{font-size:12px!important}
  #app .flight-home-row .home-time.home-time-ops .home-sta-small{font-size:11px!important}
  #app .flight-home-row .home-time.home-time-ops .eta-small{font-size:12px!important}
}
</style>`;

function patchFlightListTimes(html){
  let source=String(html||"");
  if(source.includes(OLD_HOME_TIME))source=source.replaceAll(OLD_HOME_TIME,NEW_HOME_TIME);
  if(!source.includes('id="alyzia-home-times-css"')){
    const bodyEnd=source.lastIndexOf("</body>");
    source=bodyEnd>=0
      ? source.slice(0,bodyEnd)+TIMES_STYLE+"\n"+source.slice(bodyEnd)
      : source+TIMES_STYLE;
  }
  return source;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const contentType=String(response.headers.get("content-type")||"").toLowerCase();
    if(!contentType.includes("text/html"))return response;

    const html=await response.text();
    const patched=patchFlightListTimes(html);
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
