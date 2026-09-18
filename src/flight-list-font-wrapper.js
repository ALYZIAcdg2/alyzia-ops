import app from "./duration-fix-wrapper.js";

/*
 * Flight list readability override.
 * Keeps the existing compact layout while making operational values easier
 * to read on desktop, tablet and mobile.
 */
const FLIGHT_LIST_FONT_STYLE = String.raw`
<style id="alyzia-flight-list-font-css">
#app .flight-home-row .home-flight{font-size:16px!important;font-weight:950!important}
#app .flight-home-row .home-sub,
#app .flight-home-row .home-dest,
#app .flight-home-row .home-destination{font-size:13px!important;font-weight:900!important}
#app .flight-home-row>:nth-child(4){font-size:14px!important;font-weight:950!important;color:#20354c!important}
#app .flight-home-row .home-config-booking small{font-size:11px!important;font-weight:900!important}
#app .flight-home-row .home-config-booking b{font-size:14px!important;font-weight:950!important}
#app .flight-home-row .home-load b{font-size:15px!important;font-weight:950!important}
#app .flight-home-row .home-avail{font-size:15px!important;font-weight:950!important}
#app .flight-home-row .home-avail:before{content:'AVAILABLE';font-size:10px!important;font-weight:950!important;color:#718398;margin-right:6px}
@media(max-width:680px){
  #app .flight-home-row .home-flight{font-size:17px!important}
  #app .flight-home-row .home-sub,
  #app .flight-home-row .home-dest,
  #app .flight-home-row .home-destination{font-size:14px!important}
  #app .flight-home-row>:nth-child(4){font-size:14px!important}
  #app .flight-home-row .home-config-booking small{font-size:10px!important}
  #app .flight-home-row .home-config-booking b{font-size:14px!important}
  #app .flight-home-row .home-load b{font-size:15px!important}
  #app .flight-home-row .home-avail{font-size:15px!important}
}
</style>`;

export function injectFlightListFontStyle(html){
  const source=String(html||"");
  if(!source||source.includes('id="alyzia-flight-list-font-css"'))return source;
  const headEnd=source.lastIndexOf("</head>");
  return headEnd>=0
    ? source.slice(0,headEnd)+FLIGHT_LIST_FONT_STYLE+"\n"+source.slice(headEnd)
    : FLIGHT_LIST_FONT_STYLE+source;
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
