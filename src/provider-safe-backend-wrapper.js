import app from "./etd-compat-wrapper.js";

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
function oagCarrier(v){const c=upper(v);return c==="ENT"?"E4":c}
function first(...xs){for(const x of xs){const v=clean(x);if(v)return v}return ""}
function hhmm(v){const s=clean(v);const m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""}
function localTime(v){
  if(!v)return "";
  if(typeof v==="string")return hhmm(v);
  return hhmm(first(v.local,v.localTime,v.dateTimeLocal,v.utc,v.dateTimeUtc));
}
function safeAircraft(v){const x=upper(v);return /^[A-Z0-9]{3}$/.test(x)?x:""}

async function ensureTables(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
}
async function bump(env,status){
  try{
    await ensureTables(env);
    const at=new Date().toISOString();
    for(const period of [at.slice(0,7),at.slice(0,10)]){
      await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('OAG',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run();
    }
  }catch(_){}
}
async function usage(env){
  try{
    await ensureTables(env);
    const now=parisNow(),month=now.date.slice(0,7);
    const {results=[]}=await env.OPS_DB.prepare(`SELECT period,calls FROM api_provider_usage WHERE provider='OAG' AND period IN (?,?)`).bind(month,now.date).all();
    return {day:Number(results.find(x=>x.period===now.date)?.calls||0),month:Number(results.find(x=>x.period===month)?.calls||0)};
  }catch{return {day:0,month:0}}
}
function daysRemaining(date){const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate()-d+1}
function dailyBudget(date,monthCalls,limit){return Math.min(100,Math.max(10,Math.floor(Math.max(0,limit-monthCalls)/Math.max(1,daysRemaining(date)))))}
function logChange(x,field,to,source,at){
  const next=clean(to),from=clean(x[field]);if(!next||next===from)return false;
  const a=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];a.unshift({at,source,field,from,to:next});x.flightInfoLog=a.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;
  if(field==="etd")x.edt=next;
  return true;
}
async function saveRow(env,row,x){
  await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run();
}

function parseOag(row){
  const sd=Array.isArray(row?.statusDetails)?row.statusDetails[0]:row?.statusDetails||{};
  const dep=sd?.departure||{},arr=sd?.arrival||{};
  const sta=localTime(row?.arrival?.time)||hhmm(first(row?.arrivalTimeLocal,row?.scheduledArrivalDateTime,row?.arrivalDateTime));
  const arrDate=first(row?.arrival?.date?.local,row?.arrivalDateLocal);
  return {
    sta,
    staArrivalDate:arrDate,
    aircraft:safeAircraft(first(sd?.aircraftType?.iata,row?.aircraftType?.iata,row?.equipment?.iata,row?.aircraft?.type?.iata)),
    etd:localTime(dep?.estimatedTime?.outGate)||localTime(dep?.estimatedTime?.offGround),
    atd:localTime(dep?.actualTime?.outGate)||localTime(dep?.actualTime?.offGround),
    eta:localTime(arr?.estimatedTime?.inGate)||localTime(arr?.estimatedTime?.onGround),
    ata:localTime(arr?.actualTime?.inGate)||localTime(arr?.actualTime?.onGround),
    gate:first(dep?.gate,row?.departure?.gate),
    arrivalGate:first(arr?.gate,row?.arrival?.gate),
    terminal:first(dep?.actualTerminal,dep?.terminal,row?.departure?.terminal),
    arrivalTerminal:first(arr?.actualTerminal,arr?.terminal,row?.arrival?.terminal),
    reg:first(sd?.aircraftRegistrationNumber,sd?.aircraft?.registration,row?.aircraftRegistrationNumber,row?.aircraft?.registration),
    status:first(sd?.state,row?.status,row?.flightStatus)
  };
}

async function enrichOag(env,row,x,date){
  const storedCarrier=upper(x.airline||row.airline),carrier=oagCarrier(storedCarrier),number=flightNo(x.flight||row.flight_number,storedCarrier);
  if(!carrier||!number)return {ok:false,error:"IDENTITE_INCOMPLETE"};
  const p=new URLSearchParams({DepartureDateTime:date,CarrierCode:carrier,FlightNumber:number,FlightType:"scheduled",CodeType:"IATA",Content:"Status",version:"v2"});
  const origin=upper(x.origin||x.dep||"CDG"),dest=upper(x.destination||x.dest);
  if(origin)p.set("DepartureAirport",origin);if(dest)p.set("ArrivalAirport",dest);
  let r;
  try{r=await fetch(`https://api.oag.com/flight-instances/?${p}`,{headers:{"Subscription-Key":env.OAG_API_KEY,"Accept":"application/json"}})}
  catch(e){await bump(env,502);return {ok:false,status:502,error:String(e?.message||e)}}
  await bump(env,r.status);
  const payload=await r.json().catch(()=>null);
  const rows=Array.isArray(payload)?payload:(payload?.data||payload?.results||payload?.flightInstances||payload?.items||[]);
  const at=new Date().toISOString();
  x.oagLastCheckedAt=at;x.oagLastStatus=r.status;
  if(!r.ok||!Array.isArray(rows)||!rows.length){await saveRow(env,row,x);return {ok:false,status:r.status||404,carrier,number,error:r.ok?"VOL_OAG_INTROUVABLE":`OAG_${r.status}`}}

  x.oagAutoCheckedDate=date;
  const d=parseOag(rows[0]),changed=[];
  for(const [field,label] of [["sta","STA"],["etd","ETD"],["atd","ATD"],["eta","ETA"],["ata","ATA"],["gate","GATE"],["arrivalGate","ARRIVAL GATE"],["terminal","TERMINAL"],["arrivalTerminal","ARRIVAL TERMINAL"],["reg","IMMATRICULATION"],["status","STATUT"]]){
    if(field==="sta"&&clean(x.sta)&&!["OAG_SCHEDULE","OAG_STATUS"].includes(upper(x.staSource)))continue;
    if(logChange(x,field,d[field],"OAG_STATUS",at))changed.push(label);
  }
  if(clean(d.staArrivalDate))x.staArrivalDate=d.staArrivalDate;
  if(d.aircraft&&!clean(x.aircraft)&&logChange(x,"aircraft",d.aircraft,"OAG_STATUS",at))changed.push("TYPE A/C");
  await saveRow(env,row,x);
  return {ok:true,status:r.status,carrier,number,changed,data:d};
}

function needsOag(x,d){
  const last=Date.parse(clean(x.oagLastCheckedAt)||0)||0;
  const age=last?Date.now()-last:Infinity;
  if(!clean(x.sta))return age>=6*60*60*1000||!last;
  if(d>240||d<-1500)return false;
  const missingOps=!clean(x.etd)&&!clean(x.atd) || !clean(x.eta)&&!clean(x.ata) || !clean(x.reg) || !clean(x.gate) || !clean(x.terminal);
  const missingActual=d<0&&(!clean(x.atd)||!clean(x.ata));
  if(!missingOps&&!missingActual)return false;
  const minGap=d>=-180&&d<=900?45*60*1000:3*60*60*1000;
  return age>=minGap;
}
function priority(x,d){
  const carrier=upper(x.airline);
  if(["ENT","TU","A9"].includes(carrier)&&!clean(x.sta))return 0;
  if(!clean(x.sta))return 1;
  if(d<0&&(!clean(x.atd)||!clean(x.ata)))return 2;
  if(!clean(x.reg)||!clean(x.gate)||!clean(x.terminal))return 3;
  return 4;
}

async function runSafeOag(env){
  if(!env.OAG_API_KEY)return {ok:false,error:"OAG_API_KEY_NON_CONFIGURE"};
  const now=parisNow(),limit=Number(env.OAG_QUOTA_LIMIT||1000),u=await usage(env),budget=dailyBudget(now.date,u.month,limit);
  if(u.day>=budget||u.month>=limit)return {ok:true,skipped:"QUOTA_BUDGET",usage:{...u,budget,limit}};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  const candidates=[];
  for(const row of results){
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    const d=delta(x.std||row.std,now.minutes);
    if(d>720||d<-1500||!needsOag(x,d))continue;
    candidates.push({row,x,d,prio:priority(x,d)});
  }
  candidates.sort((a,b)=>a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(2,budget-u.day,limit-u.month)),picked=candidates.slice(0,room),items=[];
  for(let i=0;i<picked.length;i++){
    if(i)await sleep(6500);
    items.push({flight:picked[i].x.flight||picked[i].row.flight_number,result:await enrichOag(env,picked[i].row,picked[i].x,now.date)});
  }
  return {ok:true,date:now.date,usage:{...u,budget,limit},candidates:candidates.length,processed:items.length,items};
}

export default {
  async fetch(request,env,ctx){return app.fetch(request,env,ctx)},
  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function"){
      try{
        const masked=Object.create(env);
        Object.defineProperty(masked,"OAG_API_KEY",{value:"",enumerable:true});
        Object.defineProperty(masked,"AERODATABOX_API_KEY",{value:"",enumerable:true});
        app.scheduled(controller,masked,ctx);
      }catch(_){}
    }
    ctx.waitUntil(runSafeOag(env));
  }
};
