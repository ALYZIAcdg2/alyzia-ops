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

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function hhmm(value){
  const s=String(value||"");
  const direct=s.match(/^(\d{2}:\d{2})$/);
  if(direct)return direct[1];
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

function firstString(...values){
  for(const v of values){
    if(typeof v==="string" && v.trim())return v.trim();
  }
  return "";
}

function flattenStrings(value,prefix="",out=[]){
  if(value==null)return out;
  if(typeof value==="string"){
    out.push([prefix,value]);
    return out;
  }
  if(Array.isArray(value)){
    value.forEach((v,i)=>flattenStrings(v,`${prefix}[${i}]`,out));
    return out;
  }
  if(typeof value==="object"){
    for(const [k,v] of Object.entries(value)){
      flattenStrings(v,prefix?`${prefix}.${k}`:k,out);
    }
  }
  return out;
}

function findTimeByPath(row,kind){
  const wanted=kind==="departure"?/depart/i:/arriv/i;
  const strings=flattenStrings(row);
  const preferred=strings.find(([path,value])=>
    wanted.test(path) && /(date.?time|scheduled|local|utc)/i.test(path) && /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(value)
  );
  if(preferred)return preferred[1];
  const fallback=strings.find(([path,value])=>
    wanted.test(path) && /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(value)
  );
  return fallback?fallback[1]:"";
}

function localTime(value){
  if(typeof value==="string")return hhmm(value)||value;
  return firstString(value?.local,value?.Local,value?.time?.local,value?.dateTimeLocal,value?.dateTime?.local);
}

function pickScheduledTimes(row){
  const depDate=firstString(row?.departure?.date?.local,row?.departureDateLocal);
  const arrDate=firstString(row?.arrival?.date?.local,row?.arrivalDateLocal);
  const depLocal=firstString(row?.departure?.time?.local,row?.departureTimeLocal);
  const arrLocal=firstString(row?.arrival?.time?.local,row?.arrivalTimeLocal);

  const dep = depDate&&depLocal ? `${depDate}T${depLocal}` : firstString(
    row?.DepartureDateTime,row?.ScheduledDepartureDateTime,row?.ScheduledDeparture,
    row?.departureDateTime,row?.scheduledDepartureDateTime,row?.scheduledDeparture,
    row?.departure?.scheduledTime?.local,row?.departure?.scheduledTime?.utc,
    row?.departure?.scheduledTime,row?.departure?.scheduled,row?.departureTime,
    row?.departure?.dateTime,row?.departure?.dateTimeLocal,findTimeByPath(row,"departure")
  );

  const arr = arrDate&&arrLocal ? `${arrDate}T${arrLocal}` : firstString(
    row?.ArrivalDateTime,row?.ScheduledArrivalDateTime,row?.ScheduledArrival,
    row?.arrivalDateTime,row?.scheduledArrivalDateTime,row?.scheduledArrival,
    row?.arrival?.scheduledTime?.local,row?.arrival?.scheduledTime?.utc,
    row?.arrival?.scheduledTime,row?.arrival?.scheduled,row?.arrivalTime,
    row?.arrival?.dateTime,row?.arrival?.dateTimeLocal,findTimeByPath(row,"arrival")
  );

  return {
    dep,arr,
    std:depLocal||hhmm(dep),
    sta:arrLocal||hhmm(arr),
    departureDateLocal:depDate||String(dep||"").slice(0,10),
    arrivalDateLocal:arrDate||String(arr||"").slice(0,10)
  };
}

function pickOperational(row){
  return {
    etd:localTime(row?.departure?.estimatedTime||row?.departure?.time?.estimated||row?.estimatedDepartureTime||row?.EstimatedDepartureDateTime),
    eta:localTime(row?.arrival?.estimatedTime||row?.arrival?.time?.estimated||row?.estimatedArrivalTime||row?.EstimatedArrivalDateTime),
    atd:localTime(row?.departure?.actualTime||row?.departure?.time?.actual||row?.actualDepartureTime||row?.ActualDepartureDateTime),
    ata:localTime(row?.arrival?.actualTime||row?.arrival?.time?.actual||row?.actualArrivalTime||row?.ActualArrivalDateTime),
    gate:firstString(row?.departure?.gate,row?.departure?.gateNumber,row?.departureGate,row?.DepartureGate),
    reg:firstString(row?.aircraft?.registration,row?.aircraftRegistration,row?.registration,row?.tailNumber,row?.AircraftRegistration),
    status:firstString(row?.status,row?.flightStatus,row?.operationalStatus,row?.FlightStatus)
  };
}

async function lookupOagFlight(env,{carrier,flight,date,origin,destination,retry429=true}){
  const params=new URLSearchParams({
    DepartureDateTime:date,
    CarrierCode:carrier,
    FlightNumber:flight,
    FlightType:"scheduled",
    CodeType:"IATA",
    version:"v2"
  });
  if(origin)params.set("DepartureAirport",origin);
  if(destination)params.set("ArrivalAirport",destination);

  for(let attempt=0;attempt<(retry429?3:1);attempt++){
    let response;
    try{
      response=await fetch("https://api.oag.com/flight-instances/?"+params.toString(),{
        headers:{"Subscription-Key":env.OAG_API_KEY}
      });
    }catch(error){
      return {ok:false,status:502,error:"OAG NETWORK ERROR",details:String(error?.message||error)};
    }

    const text=await response.text();
    let payload=null;
    try{payload=JSON.parse(text)}catch{}

    if(response.status===429 && retry429 && attempt<2){
      const retryAfter=Number(response.headers.get("retry-after")||0);
      const waitMs=retryAfter>0 ? retryAfter*1000 : 8000*(attempt+1);
      await sleep(waitMs);
      continue;
    }

    if(!response.ok){
      return {ok:false,status:response.status,error:"OAG "+response.status,details:payload||text.slice(0,1500)};
    }

    const rows=collectRows(payload);
    const pick=rows[0]||null;
    if(!pick){
      return {ok:false,status:404,error:"VOL OAG INTROUVABLE",payloadShape:payload&&typeof payload==="object"?Object.keys(payload):[]};
    }

    const times=pickScheduledTimes(pick);
    const op=pickOperational(pick);
    return {
      ok:true,row:pick,matches:rows.length,
      flight:{
        scheduledDeparture:times.dep,
        scheduledArrival:times.arr,
        std:times.std,
        sta:times.sta,
        departureDateLocal:times.departureDateLocal,
        arrivalDateLocal:times.arrivalDateLocal,
        aircraft:firstString(pick?.aircraftType?.iata,pick?.AircraftType,pick?.equipment?.iata,pick?.aircraft?.type?.iata),
        ...op
      }
    };
  }
  return {ok:false,status:429,error:"OAG 429"};
}

function canWriteScheduledSta(x){
  const current=String(x?.sta||"").trim();
  const source=String(x?.staSource||"").trim().toUpperCase();
  if(!current)return true;
  return source==="OAG_SCHEDULE";
}

function addFlightInfoLog(x,field,from,to,source,at){
  const oldValue=String(from??"").trim();
  const newValue=String(to??"").trim();
  if(oldValue===newValue)return;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];
  log.unshift({at,source,field,from:oldValue,to:newValue});
  x.flightInfoLog=log.slice(0,120);
}

function setLoggedField(x,field,value,source,at,{allowEmpty=false}={}){
  const next=String(value??"").trim();
  if(!allowEmpty && !next)return false;
  const before=String(x[field]??"").trim();
  if(before===next)return false;
  addFlightInfoLog(x,field,before,next,source,at);
  x[field]=next;
  x[field+"Source"]=source;
  x[field+"UpdatedAt"]=at;
  return true;
}

async function applyOagDataToStoredFlight(env,row,oagFlight){
  let x={};
  try{x=JSON.parse(row.data_json||"{}")}catch{}
  const at=new Date().toISOString();
  let changed=false;
  const changedFields=[];

  const sta=String(oagFlight?.sta||"").trim();
  if(sta && canWriteScheduledSta(x)){
    if(setLoggedField(x,"sta",sta,"OAG_SCHEDULE",at)){
      changed=true;changedFields.push("STA");
    }
    x.staArrivalDate=String(oagFlight?.arrivalDateLocal||"").trim();
  }

  const aircraft=String(oagFlight?.aircraft||"").trim().toUpperCase();
  if(aircraft && setLoggedField(x,"aircraft",aircraft,"OAG_SCHEDULE",at)){
    changed=true;changedFields.push("TYPE A/C");
  }

  const mappings=[
    ["etd","ETD"],["eta","ETA"],["atd","ATD"],["ata","ATA"],
    ["gate","GATE"],["reg","IMMATRICULATION"],["status","STATUT"]
  ];
  for(const [field,label] of mappings){
    const value=String(oagFlight?.[field]||"").trim();
    if(value && setLoggedField(x,field,value,"OAG",at)){
      changed=true;changedFields.push(label);
    }
  }

  x.oagLastCheckedAt=at;
  if(!changed){
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?, updated_at=CURRENT_TIMESTAMP WHERE identity=?`)
      .bind(JSON.stringify(x),row.identity).run();
    return {applied:false,identity:String(row.identity||""),reason:"NO_CHANGE",changedFields:[]};
  }

  await env.OPS_DB.prepare(`
    UPDATE flights SET data_json=?, updated_at=CURRENT_TIMESTAMP WHERE identity=?
  `).bind(JSON.stringify(x),row.identity).run();

  return {applied:true,identity:String(row.identity||""),changedFields};
}

async function handleSingleFlight(request,env,url){
  if(request.method!=="GET")return json({ok:false,error:"METHOD NOT ALLOWED"},405);
  if(!env.OAG_API_KEY)return json({ok:false,error:"OAG_API_KEY NON CONFIGURE"},503);

  const carrier=String(url.searchParams.get("carrier")||"").trim().toUpperCase();
  const flight=String(url.searchParams.get("flight")||"").trim().toUpperCase().replace(/^[A-Z]{2}/,"");
  const date=String(url.searchParams.get("date")||"").trim();
  const origin=String(url.searchParams.get("origin")||"").trim().toUpperCase();
  const destination=String(url.searchParams.get("destination")||"").trim().toUpperCase();
  const apply=String(url.searchParams.get("apply")||"")==="1";
  const debug=String(url.searchParams.get("debug")||"")==="1";

  if(!carrier||!flight||!/^20\d{2}-\d{2}-\d{2}$/.test(date)){
    return json({ok:false,error:"carrier, flight et date (YYYY-MM-DD) requis"},400);
  }

  const lookup=await lookupOagFlight(env,{carrier,flight,date,origin,destination});
  if(!lookup.ok)return json({ok:false,error:lookup.error,details:lookup.details,payloadShape:lookup.payloadShape},lookup.status||500);

  let applied=false;
  let identity="";
  let applyReason="";
  let changedFields=[];
  if(apply){
    const full=(carrier+flight).toUpperCase();
    const row=await env.OPS_DB.prepare(`
      SELECT identity,data_json
      FROM flights
      WHERE flight_date=? AND UPPER(airline)=?
        AND (UPPER(flight_number)=? OR UPPER(flight_number)=?)
      LIMIT 1
    `).bind(date,carrier,full,flight.toUpperCase()).first();
    if(row){
      const result=await applyOagDataToStoredFlight(env,row,lookup.flight);
      applied=result.applied;
      identity=result.identity;
      applyReason=result.reason||"";
      changedFields=result.changedFields||[];
    }
  }

  const result={
    ok:true,source:"OAG",query:{carrier,flight,date,origin,destination},
    flight:lookup.flight,matches:lookup.matches,applied,identity,applyReason,changedFields
  };

  if(debug || (!lookup.flight.std && !lookup.flight.sta)){
    result.debug={topLevelKeys:Object.keys(lookup.row||{}),stringPaths:flattenStrings(lookup.row).slice(0,160)};
  }
  return json(result);
}

async function handleBatchSta(request,env,url){
  if(!["GET","POST"].includes(request.method))return json({ok:false,error:"METHOD NOT ALLOWED"},405);
  if(!env.OAG_API_KEY)return json({ok:false,error:"OAG_API_KEY NON CONFIGURE"},503);

  const date=String(url.searchParams.get("date")||new Date().toISOString().slice(0,10)).trim();
  const requestedLimit=Number(url.searchParams.get("limit")||100);
  const limit=Math.max(1,Math.min(Number.isFinite(requestedLimit)?requestedLimit:100,100));
  const paceMs=Math.max(1000,Math.min(Number(url.searchParams.get("paceMs")||3000),10000));
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"date (YYYY-MM-DD) invalide"},400);

  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT identity,data_json
    FROM flights
    WHERE flight_date=?
    ORDER BY std,flight_number
    LIMIT ?
  `).bind(date,limit).all();

  const summary={date,found:results.length,lookups:0,updated:0,unchanged:0,skipped:0,notFound:0,errors:0,items:[]};

  for(const row of results){
    let x={};
    try{x=JSON.parse(row.data_json||"{}")}catch{}

    const carrier=String(x.airline||"").trim().toUpperCase();
    const flight=String(x.flight||"").trim().toUpperCase().replace(/^[A-Z]{2}/,"");
    const origin=String(x.origin||"CDG").trim().toUpperCase();
    const destination=String(x.destination||x.dest||"").trim().toUpperCase();

    if(!carrier||!flight||!destination){
      summary.skipped++;
      summary.items.push({identity:row.identity,ok:false,status:"SKIPPED",reason:"IDENTITE OU DESTINATION MANQUANTE"});
      continue;
    }

    if(summary.lookups>0)await sleep(paceMs);
    summary.lookups++;
    const lookup=await lookupOagFlight(env,{carrier,flight,date,origin,destination,retry429:true});
    if(!lookup.ok){
      if(lookup.status===404)summary.notFound++; else summary.errors++;
      summary.items.push({identity:row.identity,ok:false,status:lookup.error});
      continue;
    }

    const applied=await applyOagDataToStoredFlight(env,row,lookup.flight);
    if(applied.applied)summary.updated++; else summary.unchanged++;
    summary.items.push({
      identity:row.identity,ok:true,sta:lookup.flight.sta,
      arrivalDateLocal:lookup.flight.arrivalDateLocal,
      aircraft:lookup.flight.aircraft,
      gate:lookup.flight.gate||"",reg:lookup.flight.reg||"",
      etd:lookup.flight.etd||"",eta:lookup.flight.eta||"",atd:lookup.flight.atd||"",ata:lookup.flight.ata||"",
      status:lookup.flight.status||"",applied:applied.applied,changedFields:applied.changedFields||[]
    });
  }

  return json({ok:true,source:"OAG",summary});
}

async function handleOag(request,env,url){
  if(url.pathname==="/api/oag/flight-info")return handleSingleFlight(request,env,url);
  if(url.pathname==="/api/oag/enrich-sta" || url.pathname==="/api/oag/enrich-operational")return handleBatchSta(request,env,url);
  return null;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith("/api/oag/")){
      const response=await handleOag(request,env,url);
      if(response)return response;
      return json({ok:false,error:"ROUTE OAG INCONNUE"},404);
    }
    return app.fetch(request,env,ctx);
  },

  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function")return app.scheduled(controller,env,ctx);
  }
};
