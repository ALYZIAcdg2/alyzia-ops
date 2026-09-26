import app from "./oag-quota-ui-wrapper.js";
import {quotaPlan} from "./oag-quota.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function hm(v){const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null}
function delta(std,now){const n=hm(std);return n==null?99999:n-now}
function flightNo(v,carrier=""){
  let s=upper(v),c=upper(carrier);
  if(c&&s.startsWith(c))s=s.slice(c.length);
  else s=s.replace(/^[A-Z]{2,3}/,"");
  const m=s.match(/(\d+[A-Z]?)$/);
  return m?m[1]:s;
}
function fullFlight(x,row){
  const carrier=upper(x.airline||row.airline),n=flightNo(x.flight||row.flight_number,carrier);
  return carrier&&n?carrier+n:upper(x.flight||row.flight_number);
}
function oagCarrier(v){const c=upper(v);return c==="ENT"?"E4":c}
function first(...xs){for(const x of xs){const v=clean(x);if(v)return v}return ""}
function hhmm(v){const s=clean(v);const m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""}
function localTime(v){if(!v)return "";if(typeof v==="string")return hhmm(v);return hhmm(first(v.local,v.localTime,v.dateTimeLocal,v.utc,v.dateTimeUtc))}
function safeAircraft(v){const x=upper(v);return /^[A-Z0-9]{3}$/.test(x)?x:""}
function ageMs(v){const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity}
function isFinalComplete(x){return /CANCEL/i.test(upper(x.status))||Boolean(clean(x.atd)&&clean(x.ata))}
function arrivalDelta(x,now){
  const h=hm(x.eta||x.sta);if(h==null)return null;
  const date=clean(x.staArrivalDate)||now.date;
  const base=Date.parse(`${now.date}T00:00:00Z`)+now.minutes*60000;
  const arr=Date.parse(`${date}T00:00:00Z`)+h*60000;
  return Math.round((arr-base)/60000);
}

async function ensureTables(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
}
async function bump(env,status){
  try{
    await ensureTables(env);
    const at=new Date().toISOString(),now=parisNow();
    for(const period of [now.date.slice(0,7),now.date]){
      await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('OAG',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run();
    }
  }catch(_){}
}
async function usage(env){
  try{
    await ensureTables(env);
    const now=parisNow(),month=now.date.slice(0,7);
    const {results=[]}=await env.OPS_DB.prepare(`SELECT period,calls,successes,errors,last_status,last_at FROM api_provider_usage WHERE provider='OAG' AND period IN (?,?)`).bind(month,now.date).all();
    const dayRow=results.find(x=>x.period===now.date)||{},monthRow=results.find(x=>x.period===month)||{};
    return {
      day:Number(dayRow.calls||0),month:Number(monthRow.calls||0),
      daySuccesses:Number(dayRow.successes||0),dayErrors:Number(dayRow.errors||0),
      monthSuccesses:Number(monthRow.successes||0),monthErrors:Number(monthRow.errors||0),
      lastStatus:Number(dayRow.last_status||monthRow.last_status||0),
      lastAt:clean(dayRow.last_at||monthRow.last_at)
    };
  }catch{return {day:0,month:0,daySuccesses:0,dayErrors:0,monthSuccesses:0,monthErrors:0,lastStatus:0,lastAt:""}}
}
function logChange(x,field,to,source,at){
  const next=clean(to),from=clean(x[field]);if(!next||next===from)return false;
  const a=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];a.unshift({at,source,field,from,to:next});x.flightInfoLog=a.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true;
}
async function saveRow(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}

function parseOag(row){
  const sd=Array.isArray(row?.statusDetails)?row.statusDetails[0]:row?.statusDetails||{};
  const dep=sd?.departure||{},arr=sd?.arrival||{};
  return {
    sta:localTime(row?.arrival?.time)||hhmm(first(row?.arrivalTimeLocal,row?.scheduledArrivalDateTime,row?.arrivalDateTime)),
    staArrivalDate:first(row?.arrival?.date?.local,row?.arrivalDateLocal),
    aircraft:safeAircraft(first(sd?.aircraftType?.iata,row?.aircraftType?.iata,row?.equipment?.iata,row?.aircraft?.type?.iata)),
    etd:localTime(dep?.estimatedTime?.outGate)||localTime(dep?.estimatedTime?.offGround),
    atd:localTime(dep?.actualTime?.outGate)||localTime(dep?.actualTime?.offGround),
    eta:localTime(arr?.estimatedTime?.inGate)||localTime(arr?.estimatedTime?.onGround),
    ata:localTime(arr?.actualTime?.inGate)||localTime(arr?.actualTime?.onGround),
    gate:first(dep?.gate,row?.departure?.gate),arrivalGate:first(arr?.gate,row?.arrival?.gate),
    terminal:first(dep?.actualTerminal,dep?.terminal,row?.departure?.terminal),arrivalTerminal:first(arr?.actualTerminal,arr?.terminal,row?.arrival?.terminal),
    reg:first(sd?.aircraftRegistrationNumber,sd?.aircraft?.registration,row?.aircraftRegistrationNumber,row?.aircraft?.registration),
    status:first(sd?.state,row?.status,row?.flightStatus)
  };
}
async function enrichOag(env,row,x,date){
  const storedCarrier=upper(x.airline||row.airline),carrier=oagCarrier(storedCarrier),number=flightNo(x.flight||row.flight_number,storedCarrier);
  if(!carrier||!number)return {ok:false,error:"IDENTITE_INCOMPLETE"};
  const p=new URLSearchParams({DepartureDateTime:date,CarrierCode:carrier,FlightNumber:number,FlightType:"scheduled",CodeType:"IATA",Content:"Status",version:"v2"});
  const origin=upper(x.origin||x.dep||"CDG"),dest=upper(x.destination||x.dest);if(origin)p.set("DepartureAirport",origin);if(dest)p.set("ArrivalAirport",dest);
  let r;try{r=await fetch(`https://api.oag.com/flight-instances/?${p}`,{headers:{"Subscription-Key":env.OAG_API_KEY,"Accept":"application/json"}})}catch(e){await bump(env,502);return {ok:false,status:502,error:String(e?.message||e)}}
  await bump(env,r.status);
  let payload=await r.json().catch(()=>null),rows=Array.isArray(payload)?payload:(payload?.data||payload?.results||payload?.flightInstances||payload?.items||[]);
  if(r.ok&&(!Array.isArray(rows)||!rows.length)&&(origin||dest)){
    p.delete("DepartureAirport");p.delete("ArrivalAirport");
    try{r=await fetch(`https://api.oag.com/flight-instances/?${p}`,{headers:{"Subscription-Key":env.OAG_API_KEY,"Accept":"application/json"}})}catch(e){await bump(env,502);return {ok:false,status:502,error:String(e?.message||e)}}
    await bump(env,r.status);
    payload=await r.json().catch(()=>null);rows=Array.isArray(payload)?payload:(payload?.data||payload?.results||payload?.flightInstances||payload?.items||[]);
  }
  const at=new Date().toISOString();
  x.oagLastCheckedAt=at;x.oagLastStatus=r.status;x.oagCoverageCheckedDate=date;
  if(!r.ok||!Array.isArray(rows)||!rows.length){await saveRow(env,row,x);return {ok:false,status:r.status||404,carrier,number,error:r.ok?"VOL_OAG_INTROUVABLE":`OAG_${r.status}`}}
  x.oagAutoCheckedDate=date;
  const d=parseOag(rows[0]),changed=[];
  for(const [field,label] of [["sta","STA"],["etd","ETD"],["atd","ATD"],["eta","ETA"],["ata","ATA"],["gate","GATE"],["arrivalGate","ARRIVAL GATE"],["terminal","TERMINAL"],["arrivalTerminal","ARRIVAL TERMINAL"],["reg","IMMATRICULATION"],["status","STATUT"]]){
    if(field==="sta"&&clean(x.sta)&&!["OAG_SCHEDULE","OAG_STATUS","AERODATABOX"].includes(upper(x.staSource)))continue;
    if(logChange(x,field,d[field],"OAG_STATUS",at))changed.push(label);
  }
  if(clean(d.staArrivalDate))x.staArrivalDate=d.staArrivalDate;
  if(d.aircraft&&!clean(x.aircraft)&&logChange(x,"aircraft",d.aircraft,"OAG_STATUS",at))changed.push("TYPE A/C");
  if(isFinalComplete(x))x.oagCompleteAt=at;
  await saveRow(env,row,x);return {ok:true,status:r.status,carrier,number,changed,data:d};
}

function oagGapMinutes(x,d,now){
  if(isFinalComplete(x))return null;
  const arr=arrivalDelta(x,now);
  let gap=null;
  if(d>180)return !clean(x.sta)?360:null;
  if(d>60)gap=60;
  else if(d>=-30)gap=15;
  else if(arr!=null&&arr>120)gap=60;
  else if(arr!=null&&arr>=-60)gap=15;
  else if(arr!=null&&arr>=-180)gap=30;
  else if(d>=-600)gap=60;
  else if(d>=-1500&&!clean(x.ata))gap=120;
  if(gap==null)return null;
  const status=Number(x.oagLastStatus||0);
  if(status===404)gap=Math.max(gap,d>60?360:120);
  if(status===429||status>=500)gap=Math.max(gap,120);
  return gap;
}
function needsOag(x,d,now){
  if(isFinalComplete(x))return false;
  const gap=oagGapMinutes(x,d,now);if(gap==null)return false;
  const missingSta=!clean(x.sta),missingEstimate=!clean(x.etd)&&!clean(x.atd)||!clean(x.eta)&&!clean(x.ata);
  const missingActual=d<=60&&(!clean(x.atd)||d<0&&!clean(x.ata));
  const useful=missingSta||missingEstimate||missingActual;
  if(!useful)return false;
  return ageMs(x.oagLastCheckedAt)>=gap*60000;
}
function priority(x,d,now){
  const arr=arrivalDelta(x,now),carrier=upper(x.airline);
  if(arr!=null&&arr>=-30&&arr<=120&&!clean(x.ata))return 0;
  if(d<0&&!clean(x.atd))return 1;
  if(d<=60&&d>=-30&&(!clean(x.etd)||!clean(x.gate)||!clean(x.terminal)))return 2;
  if(["ENT","TU","A9"].includes(carrier)&&!clean(x.sta))return 3;
  if(!clean(x.sta))return 4;
  if(!clean(x.reg))return 5;
  return 6;
}

async function adbFetch(env,path){
  if(!env.AERODATABOX||typeof env.AERODATABOX.fetch!=="function")return {ok:false,status:503,error:"AERODATABOX_SERVICE_NON_CONFIGURE"};
  try{const r=await env.AERODATABOX.fetch(new Request(`https://aerodatabox.internal${path}`,{headers:{Accept:"application/json"}}));const text=await r.text();let payload=null;try{payload=JSON.parse(text)}catch{}return {ok:r.ok,status:r.status,payload}}
  catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}
async function adbRegistrationFallback(env,row,x,date,d){
  if(clean(x.reg)||d>60||d<-180||clean(x.aeroDataBoxRegCheckedDate)===date)return {ok:true,skipped:"REG_DEJA_TRAITEE"};
  if(ageMs(x.oagLastCheckedAt)>90*60000)return {ok:true,skipped:"OAG_DOIT_PASSER_DABORD"};
  const usage=await adbFetch(env,"/usage"),remaining=Number(usage.payload?.daily?.remaining||0);if(!usage.ok||remaining<2)return {ok:true,skipped:"ADB_QUOTA",remaining};
  const flight=fullFlight(x,row);if(!flight)return {ok:false,error:"VOL_MANQUANT"};
  const q=await adbFetch(env,`/flight?flight=${encodeURIComponent(flight)}&date=${encodeURIComponent(date)}`),at=new Date().toISOString();
  x.aeroDataBoxRegCheckedDate=date;x.aeroDataBoxRegCheckedAt=at;
  if(!q.ok||!q.payload?.ok){await saveRow(env,row,x);return {ok:false,status:q.status,error:q.payload?.error||q.error||"AERODATABOX_ERROR"}}
  const rows=Array.isArray(q.payload?.flights)?q.payload.flights:[],selected=rows.find(r=>upper(r?.flight)===upper(flight))||rows[0];
  if(!selected){await saveRow(env,row,x);return {ok:false,status:404,error:"VOL_AERODATABOX_INTROUVABLE"}}
  const changed=[];
  if(logChange(x,"reg",selected?.aircraft?.registration,"AERODATABOX_REG",at))changed.push("IMMATRICULATION");
  if(logChange(x,"modeS",selected?.aircraft?.modeS,"AERODATABOX_REG",at))changed.push("MODE-S");
  await saveRow(env,row,x);return {ok:true,flight,changed,remainingBefore:remaining};
}

async function runSafeOag(env){
  if(!env.OAG_API_KEY)return {ok:false,error:"OAG_API_KEY_NON_CONFIGURE"};
  const now=parisNow(),limit=Number(env.OAG_QUOTA_LIMIT||1000),u=await usage(env);
  const plan=quotaPlan({date:now.date,minutes:now.minutes,dayCalls:u.day,monthCalls:u.month,limit});
  if(!plan.dailyTarget||u.month>=plan.monthCap||u.day>=plan.hardDayMax)return {ok:true,skipped:"QUOTA_BUDGET",usage:{...u,...plan}};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  const rows=[];
  for(const row of results){
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    const d=delta(x.std||row.std,now.minutes);if(d>720||d<-1500||isFinalComplete(x))continue;
    const covered=clean(x.oagCoverageCheckedDate)===now.date||clean(x.oagAutoCheckedDate)===now.date||Boolean(clean(x.oagLastCheckedAt));
    const coverageRank=!clean(x.sta)?0:covered?2:1;
    rows.push({row,x,d,prio:priority(x,d,now),coverageRank});
  }
  const candidates=rows.filter(z=>needsOag(z.x,z.d,now)).sort((a,b)=>a.coverageRank-b.coverageRank||a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  const criticalOnly=u.day>=plan.normalCap;
  const eligible=criticalOnly?candidates.filter(z=>z.prio<=2):candidates;
  const allowedCap=criticalOnly?plan.hardDayMax:plan.normalCap;
  const room=Math.max(0,Math.min(2,allowedCap-u.day,plan.monthCap-u.month)),picked=eligible.slice(0,room),items=[];
  for(let i=0;i<picked.length;i++){if(i)await sleep(6500);items.push({flight:picked[i].x.flight||picked[i].row.flight_number,result:await enrichOag(env,picked[i].row,picked[i].x,now.date)})}

  let adb=null;
  const refreshed=[];
  for(const z of rows){
    const r=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE identity=?`).bind(z.row.identity).first();
    let x={};try{x=JSON.parse(r?.data_json||"{}")}catch{};if(!clean(x.reg)&&z.d<=60&&z.d>=-180)refreshed.push({row:r||z.row,x,d:z.d});
  }
  refreshed.sort((a,b)=>Math.abs(a.d)-Math.abs(b.d));
  if(refreshed.length)adb=await adbRegistrationFallback(env,refreshed[0].row,refreshed[0].x,now.date,refreshed[0].d);
  return {ok:true,date:now.date,usage:{...u,...plan},criticalOnly,candidates:candidates.length,eligible:eligible.length,processed:items.length,items,aerodataboxRegistration:adb};
}

async function quotaStatus(env){
  const now=parisNow(),u=await usage(env),limit=Number(env.OAG_QUOTA_LIMIT||1000);
  const plan=quotaPlan({date:now.date,minutes:now.minutes,dayCalls:u.day,monthCalls:u.month,limit});
  return {ok:true,provider:"OAG",date:now.date,period:now.date.slice(0,7),usage:u,plan,cron:"*/5 * * * *",maxFlightsPerRun:2};
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/oag/usage")return new Response(JSON.stringify(await quotaStatus(env)),{headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function"){
      try{const masked=Object.create(env);Object.defineProperty(masked,"OAG_API_KEY",{value:"",enumerable:true});Object.defineProperty(masked,"AERODATABOX_API_KEY",{value:"",enumerable:true});app.scheduled(controller,masked,ctx)}catch(_){}
    }
    ctx.waitUntil(runSafeOag(env));
  }
};
