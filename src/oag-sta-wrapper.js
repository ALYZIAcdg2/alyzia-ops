import app from "./flight-list-font-wrapper.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=UTF-8",
      "Access-Control-Allow-Origin":"*",
      "Cache-Control":"no-store"
    }
  });
}

function hhmm(value){
  const s=String(value||"");
  const m=s.match(/(?:T|\s)(\d{2}:\d{2})/);
  return m?m[1]:"";
}

function collectRows(payload){
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.data))return payload.data;
  if(Array.isArray(payload?.results))return payload.results;
  if(Array.isArray(payload?.flightInstances))return payload.flightInstances;
  if(Array.isArray(payload?.items))return payload.items;
  return [];
}

function pickScheduledTimes(row){
  const dep = row?.DepartureDateTime || row?.ScheduledDepartureDateTime || row?.ScheduledDeparture ||
    row?.departure?.scheduledTime?.local || row?.departure?.scheduledTime ||
    row?.departure?.scheduled || row?.departureTime || "";
  const arr = row?.ArrivalDateTime || row?.ScheduledArrivalDateTime || row?.ScheduledArrival ||
    row?.arrival?.scheduledTime?.local || row?.arrival?.scheduledTime ||
    row?.arrival?.scheduled || row?.arrivalTime || "";
  return {dep,arr,std:hhmm(dep),sta:hhmm(arr)};
}

async function handleOag(request,env,url){
  if(url.pathname!=="/api/oag/flight-info")return null;
  if(request.method!=="GET")return json({ok:false,error:"METHOD NOT ALLOWED"},405);
  if(!env.OAG_API_KEY)return json({ok:false,error:"OAG_API_KEY NON CONFIGURE"},503);

  const carrier=String(url.searchParams.get("carrier")||"").trim().toUpperCase();
  const flight=String(url.searchParams.get("flight")||"").trim().toUpperCase().replace(/^[A-Z]{2}/,"");
  const date=String(url.searchParams.get("date")||"").trim();
  const origin=String(url.searchParams.get("origin")||"").trim().toUpperCase();
  const destination=String(url.searchParams.get("destination")||"").trim().toUpperCase();
  const apply=String(url.searchParams.get("apply")||"")==="1";

  if(!carrier||!flight||!/^20\d{2}-\d{2}-\d{2}$/.test(date)){
    return json({ok:false,error:"carrier, flight et date (YYYY-MM-DD) requis"},400);
  }

  const params=new URLSearchParams({
    DepartureDateTime:date,
    CarrierCode:carrier,
    FlightNumber:flight,
    CodeType:"IATA",
    version:"v2"
  });
  if(origin)params.set("DepartureAirport",origin);
  if(destination)params.set("ArrivalAirport",destination);

  let response;
  try{
    response=await fetch("https://api.oag.com/flight-instances/?"+params.toString(),{
      headers:{"Subscription-Key":env.OAG_API_KEY}
    });
  }catch(error){
    return json({ok:false,error:"OAG NETWORK ERROR",details:String(error?.message||error)},502);
  }

  const text=await response.text();
  let payload=null;
  try{payload=JSON.parse(text)}catch{}

  if(!response.ok){
    return json({ok:false,error:"OAG "+response.status,details:payload||text.slice(0,1500)},response.status);
  }

  const rows=collectRows(payload);
  const pick=rows[0]||null;
  if(!pick){
    return json({ok:false,error:"VOL OAG INTROUVABLE",query:{carrier,flight,date,origin,destination},payloadShape:payload&&typeof payload==="object"?Object.keys(payload):[]},404);
  }

  const times=pickScheduledTimes(pick);
  let applied=false;
  let identity="";

  if(apply && times.sta){
    const full=(carrier+flight).toUpperCase();
    const row=await env.OPS_DB.prepare(`
      SELECT identity,data_json
      FROM flights
      WHERE flight_date=? AND UPPER(airline)=?
        AND (UPPER(flight_number)=? OR UPPER(flight_number)=?)
      LIMIT 1
    `).bind(date,carrier,full,flight.toUpperCase()).first();

    if(row){
      let x={};
      try{x=JSON.parse(row.data_json||"{}")}catch{}
      x.sta=times.sta;
      x.staSource="OAG";
      x.staUpdatedAt=new Date().toISOString();
      await env.OPS_DB.prepare(`
        UPDATE flights SET data_json=?, updated_at=CURRENT_TIMESTAMP WHERE identity=?
      `).bind(JSON.stringify(x),row.identity).run();
      applied=true;
      identity=String(row.identity||"");
    }
  }

  return json({
    ok:true,
    source:"OAG",
    query:{carrier,flight,date,origin,destination},
    flight:{
      scheduledDeparture:times.dep,
      scheduledArrival:times.arr,
      std:times.std,
      sta:times.sta
    },
    matches:rows.length,
    applied,
    identity
  });
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/oag/")){
      const response=await handleOag(request,env,url);
      if(response)return response;
    }
    return app.fetch(request,env,ctx);
  },

  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx);
  }
};
