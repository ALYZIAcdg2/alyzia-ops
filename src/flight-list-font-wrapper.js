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
#app .flight-home-row .home-config-booking small{font-size:12px!important;font-weight:900!important}
#app .flight-home-row .home-config-booking b{font-size:15px!important;font-weight:950!important}
#app .flight-home-row .home-load b{font-size:16px!important;font-weight:950!important}
#app .home-avail{font-size:16px!important;font-weight:950!important;display:inline-flex!important;align-items:baseline!important;gap:0!important}
#app .home-avail:before{content:'AVAILABLE'!important;display:inline-block!important;font-size:16px!important;font-weight:950!important;color:#718398!important;flex:0 0 auto!important;padding-right:12px!important;margin:0!important}
#app .home-avail-value{font-size:16px!important;font-weight:950!important;flex:0 0 auto!important;margin:0!important}
@media(max-width:680px){
  #app .flight-home-row .home-flight{font-size:18px!important}
  #app .flight-home-row .home-sub,
  #app .flight-home-row .home-dest,
  #app .flight-home-row .home-destination{font-size:15px!important}
  #app .flight-home-row>:nth-child(4){font-size:15px!important}
  #app .flight-home-row .home-config-booking small{font-size:11px!important}
  #app .flight-home-row .home-config-booking b{font-size:15px!important}
  #app .flight-home-row .home-load b{font-size:16px!important}
  #app .home-avail,
  #app .home-avail:before,
  #app .home-avail-value{font-size:16px!important}
}
</style>`;

const OLD_AVAILABLE_ROW = '<div class="home-mini home-avail ${avail<0?\'neg\':\'\'}">${avail}${nok?` · ${nok} INOP`:\'\'}</div>';
const NEW_AVAILABLE_ROW = '<div class="home-mini home-avail ${avail<0?\'neg\':\'\'}"><span class="home-avail-value">${avail}${nok?` · ${nok} INOP`:\'\'}</span></div>';

function patchAvailableRow(html){
  const source=String(html||"");
  return source.includes(OLD_AVAILABLE_ROW)
    ? source.replaceAll(OLD_AVAILABLE_ROW,NEW_AVAILABLE_ROW)
    : source;
}

export function injectFlightListFontStyle(html){
  let source=patchAvailableRow(html);
  if(!source)return source;
  if(source.includes('id="alyzia-flight-list-font-css"'))return source;

  // Inject last in the document so these list styles win over the mobile
  // overrides inserted by duration-fix-wrapper.js.
  const bodyEnd=source.lastIndexOf("</body>");
  return bodyEnd>=0
    ? source.slice(0,bodyEnd)+FLIGHT_LIST_FONT_STYLE+"\n"+source.slice(bodyEnd)
    : source+FLIGHT_LIST_FONT_STYLE;
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
