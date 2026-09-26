import app from "./duration-auto-wrapper.js";

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
const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();

function hhmm(value){
  const s=clean(value);
  const direct=s.match(/^(\d{2}:\d{2})$/);
  if(direct)return direct[1];
  const m=s.match(/(?:T|\s)(\d{2}:\d{2})/);
  return m?m[1]:"";
}

function localDateTimeValue(value){
  if(!value)return "";
  if(typeof value==="string")return value;
  return clean(value.local||value.localTime||value.dateTimeLocal||value.utc||value.dateTimeUtc);
}

function addFlightInfoLog(x,field,from,to,source,at){
  const oldValue=clean(from);
  const newValue=clean(to);
  if(oldValue===newValue)return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];
  log.unshift({at,source,field,from:oldValue,to:newValue});
  x.flightInfoLog=log.slice(0,160);
  return true;
}

function setLoggedField(x,field,value,source,at){
  const next=clean(value);
  if(!next)return false;
  const before=clean(x[field]);
  if(before===next)return false;
  addFlightInfoLog(x,field,before,next,source,at);
  x[field]=next;
  x[field+"Source"]=source;
  x[field+"UpdatedAt"]=at;
  return true;
}

function parisParts(now=new Date()){
  const parts=new Intl.DateTimeFormat("fr-CA",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(now);
  const map=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {
    date:`${map.year}-${map.month}-${map.day}`,
    minutes:Number(map.hour)*60+Number(map.minute)
  };
}

function dateShift(yyyyMmDd,days){
  const d=new Date(`${yyyyMmDd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}

function minutesBetweenDates(baseDate,baseMinutes,otherDate,otherHm){
  const m=String(otherHm||"").match(/^(\d{2}):(\d{2})$/);
  if(!m)return null;
  const base=Date.parse(`${baseDate}T00:00:00Z`)+baseMinutes*60000;
  const other=Date.parse(`${otherDate}T00:00:00Z`)+(Number(m[1])*60+Number(m[2]))*60000;
  return Math.round((other-base)/60000);
}

function activeWindowScore(x,nowDate,nowMinutes){
  const date=clean(x.date||x.flight_date);
  const std=clean(x.std);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(std))return null;

  const depDelta=minutesBetweenDates(nowDate,nowMinutes,date,std);
  if(depDelta==null)return null;

  let endDelta=null;
  const sta=clean(x.sta);
  const staDate=clean(x.staArrivalDate);
  if(/^\d{2}:\d{2}$/.test(sta)&&/^20\d{2}-\d{2}-\d{2}$/.test(staDate)){
    endDelta=minutesBetweenDates(nowDate,nowMinutes,staDate,sta);
  }else{
    const duration=Number(x.duration);
    endDelta=depDelta+(Number.isFinite(duration)&&duration>0?duration:16*60);
  }

  // 3 h avant STD jusqu'à 2 h après STA estimée.
  if(depDelta>180 || endDelta<-120)return null;

  const last=Date.parse(clean(x.oagLastCheckedAt)||0);
  const ageMinutes=Number.isFinite(last)&&last>0 ? Math.floor((Date.now()-last)/60000) : 99999;
  const targetInterval=depDelta<=60 && endDelta>=-60 ? 15 : 30;
  if(ageMinutes<targetInterval)return null;

  // Plus le score est petit, plus le vol est prioritaire.
  return Math.abs(depDelta)+Math.max(0,targetInterval-ageMinutes)*1000;
}

async function callInnerOag(env,ctx,{carrier,flight,date,origin,destination,apply=true,debug=false}){
  const params=new URLSearchParams({carrier,flight,date});
  if(origin)params.set("origin",origin);
  if(destination)params.set("destination",destination);
  if(apply)params.set("apply","1");
  if(debug)params.set("debug","1");
  const req=new Request(`https://internal.alyzia/api/oag/flight-info?${params.toString()}`,{method:"GET"});
  const response=await app.fetch(req,env,ctx);
  const text=await response.text();
  let payload=null;
  try{payload=JSON.parse(text)}catch{}
  return {ok:response.ok,status:response.status,payload,text};
}

function chooseAdbFlight(rows,{origin,destination}){
  if(!Array.isArray(rows)||!rows.length)return null;
  const o=upper(origin),d=upper(destination);
  return rows.find(row=>{
    const dep=upper(row?.departure?.airport?.iata);
    const arr=upper(row?.arrival?.airport?.iata);
    return (!o||dep===o)&&(!d||arr===d);
  })||rows[0];
}

function adbOperational(row){
  if(!row)return null;
  const status=clean(row.status);
  const statusUpper=status.toUpperCase();
  const depRevised=localDateTimeValue(row?.departure?.revisedTime);
  const arrRevised=localDateTimeValue(row?.arrival?.revisedTime);
  const depRunway=localDateTimeValue(row?.departure?.runwayTime);
  const arrRunway=localDateTimeValue(row?.arrival?.runwayTime);
  const departed=/DEPART|EN.?ROUTE|LANDED|ARRIVED|COMPLETED/i.test(statusUpper);
  const arrived=/LANDED|ARRIVED|COMPLETED/i.test(statusUpper);
  return {
    status,
    reg:clean(row?.aircraft?.reg),
    aircraftModel:clean(row?.aircraft?.model),
    modeS:clean(row?.aircraft?.modeS),
    gate:clean(row?.departure?.gate),
    arrivalGate:clean(row?.arrival?.gate),
    terminal:clean(row?.departure?.terminal),
    runway:clean(row?.departure?.runway),
    arrivalRunway:clean(row?.arrival?.runway),
    etd:!departed?hhmm(depRevised):"",
    atd:departed?hhmm(depRunway||depRevised):"",
    eta:!arrived?hhmm(arrRevised):"",
    ata:arrived?hhmm(arrRunway||arrRevised):"",
    lastUpdatedUtc:clean(row.lastUpdatedUtc)
  };
}

async function lookupAeroDataBox(env,{carrier,flight,date,origin,destination}){
  const key=clean(env.AERODATABOX_API_KEY);
  if(!key)return {ok:false,status:503,error:"AERODATABOX_API_KEY NON CONFIGURE"};
  const base=clean(env.AERODATABOX_BASE_URL)||"https://api.aerodatabox.com";
  const number=upper(`${carrier}${String(flight||"").replace(/^[A-Z]{2}/i,"")}`);
  const url=`${base.replace(/\/$/,"")}/flights/number/${encodeURIComponent(number)}/${encodeURIComponent(date)}`;
  let response;
  try{
    response=await fetch(url,{headers:{"X-Api-Key":key,"Accept":"application/json"}});
  }catch(error){
    return {ok:false,status:502,error:"AERODATABOX NETWORK ERROR",details:String(error?.message||error)};
  }
  const text=await response.text();
  let payload=null;
  try{payload=JSON.parse(text)}catch{}
  if(!response.ok)return {ok:false,status:response.status,error:`AERODATABOX ${response.status}`,details:payload||text.slice(0,1200)};
  const row=chooseAdbFlight(payload,{origin,destination});
  if(!row)return {ok:false,status:404,error:"VOL AERODATABOX INTROUVABLE"};
  return {ok:true,status:200,row,flight:adbOperational(row)};
}

async function applyAeroDataBoxToStoredFlight(env,row,adbFlight){
  let x={};
  try{x=JSON.parse(row.data_json||"{}")}catch{}
  const at=new Date().toISOString();
  const changedFields=[];
  const mappings=[["reg","IMMATRICULATION"]];
  for(const [field,label] of mappings){
    const value=clean(adbFlight?.[field]);
    if(value&&setLoggedField(x,field,value,"AERODATABOX",at))changedFields.push(label);
  }
  if(clean(adbFlight?.modeS)&&setLoggedField(x,"modeS",adbFlight.modeS,"AERODATABOX",at))changedFields.push("MODE-S");
  if(clean(adbFlight?.runway)&&setLoggedField(x,"runway",adbFlight.runway,"AERODATABOX",at))changedFields.push("RUNWAY");
  if(clean(adbFlight?.arrivalRunway)&&setLoggedField(x,"arrivalRunway",adbFlight.arrivalRunway,"AERODATABOX",at))changedFields.push("ARRIVAL RUNWAY");
  x.aeroDataBoxLastCheckedAt=at;
  x.aeroDataBoxLastUpdatedUtc=clean(adbFlight?.lastUpdatedUtc);
  await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`)
    .bind(JSON.stringify(x),row.identity).run();
  return {applied:changedFields.length>0,changedFields};
}

async function findStoredFlight(env,{carrier,flight,date}){
  const full=upper(`${carrier}${String(flight||"").replace(/^[A-Z]{2}/i,"")}`);
  const short=upper(String(flight||"").replace(/^[A-Z]{2}/i,""));
  return env.OPS_DB.prepare(`
    SELECT identity,data_json FROM flights
    WHERE flight_date=? AND UPPER(airline)=?
      AND (UPPER(flight_number)=? OR UPPER(flight_number)=?)
    LIMIT 1
  `).bind(date,upper(carrier),full,short).first();
}

async function handleAeroDataBox(request,env,url){
  if(request.method!=="GET")return json({ok:false,error:"METHOD NOT ALLOWED"},405);
  const carrier=upper(url.searchParams.get("carrier"));
  const flight=upper(url.searchParams.get("flight")).replace(/^[A-Z]{2}/,"");
  const date=clean(url.searchParams.get("date"));
  const origin=upper(url.searchParams.get("origin"));
  const destination=upper(url.searchParams.get("destination"));
  const apply=clean(url.searchParams.get("apply"))==="1";
  if(!carrier||!flight||!/^20\d{2}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"carrier, flight et date requis"},400);
  const lookup=await lookupAeroDataBox(env,{carrier,flight,date,origin,destination});
  if(!lookup.ok)return json(lookup,lookup.status||500);
  let applied=false,changedFields=[],identity="";
  if(apply){
    const row=await findStoredFlight(env,{carrier,flight,date});
    if(row){
      identity=clean(row.identity);
      const result=await applyAeroDataBoxToStoredFlight(env,row,lookup.flight);
      applied=result.applied;changedFields=result.changedFields;
    }
  }
  return json({ok:true,source:"AERODATABOX",flight:lookup.flight,applied,changedFields,identity});
}

async function enrichOne(env,ctx,row,{useAeroDataBox=true}={}){
  let x={};
  try{x=JSON.parse(row.data_json||"{}")}catch{}
  const carrier=upper(x.airline);
  const flight=upper(x.flight).replace(/^[A-Z]{2}/,"");
  const date=clean(x.date||row.flight_date);
  const origin=upper(x.origin||x.dep||"CDG");
  const destination=upper(x.destination||x.dest);
  if(!carrier||!flight||!date||!destination)return {identity:row.identity,ok:false,error:"IDENTITE INCOMPLETE"};

  const oag=await callInnerOag(env,ctx,{carrier,flight,date,origin,destination,apply:true});
  if(!oag.ok)return {identity:row.identity,ok:false,source:"OAG",status:oag.status,error:oag.payload?.error||oag.text.slice(0,200)};

  let adb=null;
  if(useAeroDataBox&&env.AERODATABOX_API_KEY){
    const refreshed=await env.OPS_DB.prepare(`SELECT identity,data_json FROM flights WHERE identity=?`).bind(row.identity).first();
    let current={};
    try{current=JSON.parse(refreshed?.data_json||"{}")}catch{}
    const needsReg=!clean(current.reg);
    const needsModeS=!clean(current.modeS);
    if(needsReg||needsModeS){
      const lookup=await lookupAeroDataBox(env,{carrier,flight,date,origin,destination});
      if(lookup.ok){
        const result=await applyAeroDataBoxToStoredFlight(env,refreshed,lookup.flight);
        adb={ok:true,applied:result.applied,changedFields:result.changedFields};
      }else adb={ok:false,status:lookup.status,error:lookup.error};
    }
  }
  return {identity:row.identity,ok:true,oag:oag.payload,adb};
}

async function scheduledOperationalEnrichment(env,ctx){
  if(!env.OAG_API_KEY)return {ok:false,error:"OAG_API_KEY NON CONFIGURE"};
  const now=parisParts();
  const dates=[dateShift(now.date,-1),now.date,dateShift(now.date,1)];
  const {results=[]}=await env.OPS_DB.prepare(`
    SELECT identity,flight_date,data_json FROM flights
    WHERE flight_date IN (?,?,?)
    ORDER BY flight_date,std,flight_number
  `).bind(...dates).all();

  const candidates=[];
  for(const row of results){
    let x={};
    try{x=JSON.parse(row.data_json||"{}")}catch{}
    const score=activeWindowScore({...x,flight_date:row.flight_date},now.date,now.minutes);
    if(score==null)continue;
    candidates.push({row,score});
  }
  candidates.sort((a,b)=>a.score-b.score);

  // 3 appels OAG par passage de 5 min = plafond théorique 864 appels/jour.
  // Les intervalles 15/30 min et la fenêtre active réduisent encore la consommation.
  const picked=candidates.slice(0,3);
  const items=[];
  for(let i=0;i<picked.length;i++){
    if(i)await sleep(1100);
    items.push(await enrichOne(env,ctx,picked[i].row,{useAeroDataBox:true}));
  }
  return {ok:true,date:now.date,candidates:candidates.length,processed:items.length,items};
}

async function handleOperationalBatch(request,env,url,ctx){
  if(!["GET","POST"].includes(request.method))return json({ok:false,error:"METHOD NOT ALLOWED"},405);
  const result=await scheduledOperationalEnrichment(env,ctx);
  return json(result,result.ok?200:503);
}

const INFO_UI=String.raw`
<style id="alyzia-flight-info-log-css">
.flight-info-log-card{margin-top:14px;border:1px solid #dce7f2;border-radius:14px;background:#fbfdff;overflow:hidden}
.flight-info-log-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #e5edf5}
.flight-info-log-head b{font-size:12px;font-weight:950;color:#18314d}.flight-info-log-head span{font-size:9px;font-weight:900;color:#718398}
.flight-info-log-list{display:grid}.flight-info-log-row{display:grid;grid-template-columns:62px 92px 110px 1fr;gap:9px;align-items:center;padding:9px 14px;border-bottom:1px solid #edf2f7;font-size:10px}.flight-info-log-row:last-child{border-bottom:0}
.flight-info-log-row time{font-weight:950;color:#314c68}.flight-info-log-source{font-size:8px;font-weight:950;color:#075fd3;border:1px solid #cfe1f5;background:#f1f7ff;border-radius:999px;padding:4px 7px;text-align:center;white-space:nowrap}.flight-info-log-field{font-weight:950;color:#50667c}.flight-info-log-change{font-weight:850;color:#152b43;word-break:break-word}.flight-info-log-change em{font-style:normal;color:#8393a5}.flight-info-log-empty{padding:14px;color:#8090a2;font-size:10px;font-weight:850}
@media(max-width:680px){.flight-info-log-row{grid-template-columns:52px 78px 1fr;gap:7px}.flight-info-log-field{grid-column:3}.flight-info-log-change{grid-column:1/4;padding-left:0}}
</style>
<script id="alyzia-flight-info-log-js">
(()=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={std:'STD',etd:'ETD',sta:'STA',eta:'ETA',atd:'ATD',ata:'ATA',aircraft:'TYPE A/C',reg:'IMMATRICULATION',gate:'GATE',status:'STATUT',terminal:'TERMINAL',modeS:'MODE-S',runway:'RUNWAY',arrivalRunway:'ARRIVAL RUNWAY'};
  function currentFlight(){
    try{return Array.isArray(FLIGHTS)&&FLIGHTS.length?FLIGHTS[Math.max(0,Math.min(Number(selected)||0,FLIGHTS.length-1))]:null}catch(_){return null}
  }
  function formatTime(at){
    try{return new Date(at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}catch(_){return ''}
  }
  function render(){
    const grid=document.querySelector('.flight-info-grid');
    if(!grid)return;
    const x=currentFlight();
    if(!x)return;
    const old=document.getElementById('alyzia-flight-info-log-card');
    if(old)old.remove();
    const entries=Array.isArray(x.flightInfoLog)?x.flightInfoLog.slice(0,30):[];
    const card=document.createElement('div');
    card.id='alyzia-flight-info-log-card';
    card.className='flight-info-log-card';
    const rows=entries.length?entries.map(e=>{
      const from=String(e.from||'').trim()||'—',to=String(e.to||'').trim()||'—';
      return '<div class="flight-info-log-row"><time>'+esc(formatTime(e.at))+'</time><span class="flight-info-log-source">'+esc(e.source||'AUTO')+'</span><span class="flight-info-log-field">'+esc(labels[e.field]||String(e.field||'').toUpperCase())+'</span><span class="flight-info-log-change"><em>'+esc(from)+'</em> → '+esc(to)+'</span></div>';
    }).join(''):'<div class="flight-info-log-empty">AUCUNE MODIFICATION AUTOMATIQUE ENREGISTRÉE</div>';
    card.innerHTML='<div class="flight-info-log-head"><b>JOURNAL INFOS VOL</b><span>30 DERNIERS CHANGEMENTS</span></div><div class="flight-info-log-list">'+rows+'</div>';
    grid.insertAdjacentElement('afterend',card);
  }
  let timer=0;
  const queue=()=>{clearTimeout(timer);timer=setTimeout(render,40)};
  new MutationObserver(queue).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',queue,true);
  setTimeout(render,200);
})();
</script>`;

function patchHtml(html){
  let source=String(html||"");
  if(!source.includes('id="alyzia-flight-info-log-css"')){
    const end=source.lastIndexOf("</body>");
    source=end>=0?source.slice(0,end)+INFO_UI+"\n"+source.slice(end):source+INFO_UI;
  }
  return source;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/enrichment/aerodatabox")return handleAeroDataBox(request,env,url);
    if(url.pathname==="/api/enrichment/run")return handleOperationalBatch(request,env,url,ctx);
    if(url.pathname==="/api/enrichment/status")return json({
      ok:true,
      oagConfigured:Boolean(env.OAG_API_KEY),
      aeroDataBoxConfigured:Boolean(env.AERODATABOX_API_KEY),
      cron:"*/5 * * * *",
      oagBudgetPerTick:3
    });

    const response=await app.fetch(request,env,ctx);
    const contentType=String(response.headers.get("content-type")||"").toLowerCase();
    if(!contentType.includes("text/html"))return response;
    const html=await response.text();
    const headers=new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control","no-store");
    return new Response(patchHtml(html),{status:response.status,statusText:response.statusText,headers});
  },

  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function"){
      try{app.scheduled(controller,env,ctx)}catch(_){}
    }
    ctx.waitUntil(scheduledOperationalEnrichment(env,ctx));
  }
};
