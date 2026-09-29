import app from "./today-sta-backfill-wrapper.js";
import {quotaPlan} from "./oag-quota.js";
import {queuedFieldMap} from "./provider-queue-authority.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const s=clean(v),m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};
const first=(...xs)=>{for(const x of xs){const v=clean(x);if(v)return v}return ""};

function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const h=hhmm(std),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!h||fd==null||nd==null)return 99999;const [a,b]=h.split(":").map(Number);return (fd-nd)*1440+a*60+b-now.minutes}
function isFinal(x){return /CANCEL|ANNUL/i.test(upper(x.status||x.opsStatus||x.flight_status))||Boolean(clean(x.atd)&&clean(x.ata))}
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function oagCarrier(v){const c=upper(v);return c==="ENT"?"E4":c}
function localTime(v){if(!v)return "";if(typeof v==="string")return hhmm(v);return hhmm(first(v.local,v.localTime,v.dateTimeLocal,v.utc,v.dateTimeUtc))}
function safeAircraft(v){const s=upper(v);return /^[A-Z0-9]{3}$/.test(s)?s:""}

async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function usage(env){try{await ensureUsage(env);const now=parisNow(),month=now.date.slice(0,7),{results=[]}=await env.OPS_DB.prepare(`SELECT period,calls,last_at FROM api_provider_usage WHERE provider='OAG' AND period IN (?,?)`).bind(month,now.date).all();const d=results.find(x=>x.period===now.date)||{},m=results.find(x=>x.period===month)||{};return {day:Number(d.calls||0),month:Number(m.calls||0),lastAt:clean(d.last_at||m.last_at)}}catch{return {day:0,month:0,lastAt:""}}}
async function bump(env,status){try{await ensureUsage(env);const now=parisNow(),at=new Date().toISOString();for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('OAG',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run()}catch{}}

function parseOag(row){const sd=Array.isArray(row?.statusDetails)?row.statusDetails[0]:row?.statusDetails||{},dep=sd?.departure||{},arr=sd?.arrival||{};return {aircraft:safeAircraft(first(sd?.aircraftType?.iata,row?.aircraftType?.iata,row?.equipment?.iata,row?.aircraft?.type?.iata)),etd:localTime(dep?.estimatedTime?.outGate)||localTime(dep?.estimatedTime?.offGround),atd:localTime(dep?.actualTime?.outGate)||localTime(dep?.actualTime?.offGround),eta:localTime(arr?.estimatedTime?.inGate)||localTime(arr?.estimatedTime?.onGround),ata:localTime(arr?.actualTime?.inGate)||localTime(arr?.actualTime?.onGround),gate:first(dep?.gate,row?.departure?.gate),terminal:first(dep?.actualTerminal,dep?.terminal,row?.departure?.terminal),reg:first(sd?.aircraftRegistrationNumber,sd?.aircraft?.registration,row?.aircraftRegistrationNumber,row?.aircraft?.registration),status:first(sd?.state,row?.status,row?.flightStatus)}}
function apply(x,field,value,source,at){const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source,field,from,to:next});x.flightInfoLog=log.slice(0,160);x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}

async function fetchOag(env,row,x,date){const stored=upper(x.airline||row.airline),carrier=oagCarrier(stored),number=flightNo(x.flight||row.flight_number,stored);if(!carrier||!number)return {ok:false,status:0};const p=new URLSearchParams({DepartureDateTime:date,CarrierCode:carrier,FlightNumber:number,FlightType:"scheduled",CodeType:"IATA",Content:"Status",version:"v2"}),origin=upper(x.origin||x.dep||"CDG"),dest=upper(x.destination||x.dest);if(origin)p.set("DepartureAirport",origin);if(dest)p.set("ArrivalAirport",dest);let r;try{r=await fetch(`https://api.oag.com/flight-instances/?${p}`,{headers:{"Subscription-Key":env.OAG_API_KEY,Accept:"application/json"}})}catch{return {ok:false,status:502}}await bump(env,r.status);let payload=await r.json().catch(()=>null),rows=Array.isArray(payload)?payload:(payload?.data||payload?.results||payload?.flightInstances||payload?.items||[]);if(r.ok&&(!Array.isArray(rows)||!rows.length)&&(origin||dest)){p.delete("DepartureAirport");p.delete("ArrivalAirport");try{r=await fetch(`https://api.oag.com/flight-instances/?${p}`,{headers:{"Subscription-Key":env.OAG_API_KEY,Accept:"application/json"}})}catch{return {ok:false,status:502}}await bump(env,r.status);payload=await r.json().catch(()=>null);rows=Array.isArray(payload)?payload:(payload?.data||payload?.results||payload?.flightInstances||payload?.items||[])}return {ok:r.ok&&Array.isArray(rows)&&rows.length>0,status:r.status,data:Array.isArray(rows)&&rows.length?parseOag(rows[0]):null}}

async function recoverOne(env,z,allowed){const at=new Date().toISOString(),r=await fetchOag(env,z.row,z.x,z.row.flight_date);z.x.oagH2LastCheckedAt=at;z.x.oagH2LastStatus=r.status;if(!r.ok||!r.data){if(r.status===404||r.status===200)z.x.oagH2NotFoundAttempts=Number(z.x.oagH2NotFoundAttempts||0)+1;await save(env,z.row,z.x);return {ok:false,flight:z.x.flight||z.row.flight_number,date:z.row.flight_date,status:r.status}}const d=r.data,changed=[];for(const f of ["etd","atd","eta","ata","gate"])if(allowed.has(f)&&apply(z.x,f,d[f],"OAG_H2_RECOVERY",at))changed.push(f);z.x.oagH2NotFoundAttempts=0;await save(env,z.row,z.x);return {ok:true,flight:z.x.flight||z.row.flight_number,date:z.row.flight_date,changed}}
async function recentAuthority(env,provider,now,yesterday){const maps=await Promise.all([queuedFieldMap(env,provider,now.date),queuedFieldMap(env,provider,yesterday)]),out=new Map();for(const map of maps)for(const [id,fields] of map){if(!out.has(id))out.set(id,new Set());for(const f of fields)out.get(id).add(f)}return out}

async function recoverH2(env){
  if(!env.OAG_API_KEY)return {ok:true,skipped:"OAG_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000),authority=await recentAuthority(env,"OAG_STATUS",now,yesterday);
  if(!authority.size)return {ok:true,skipped:"OAG_QUEUE_VIDE"};
  const u=await usage(env),limit=Number(env.OAG_QUOTA_LIMIT||1000),plan=quotaPlan({date:now.date,minutes:now.minutes,dayCalls:u.day,monthCalls:u.month,limit});
  if(!plan.dailyTarget||u.month>=plan.monthCap||u.day>=plan.hardDayMax)return {ok:true,skipped:"OAG_QUOTA"};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all(),candidates=[];
  for(const row of results){
    if(!authority.has(row.identity))continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    const d=delta(row.flight_date,x.std||row.std,now);if(d>120||d<-1800||isFinal(x))continue;
    const allowed=authority.get(row.identity)||new Set();
    const departedGap=allowed.has("atd")&&missing(x.atd),arrivalGap=allowed.has("ata")&&missing(x.ata),nearGap=d>0&&((allowed.has("etd")&&missing(x.etd))||(allowed.has("gate")&&missing(x.gate)));
    if(!departedGap&&!arrivalGap&&!nearGap&&!(allowed.has("eta")&&missing(x.eta)))continue;
    const cadence=(arrivalGap||departedGap)?15:60;if(ageMs(x.oagH2LastCheckedAt)<cadence*60000)continue;
    if(Number(x.oagLastStatus)===404&&Number(x.oagH2NotFoundAttempts||0)>=2)continue;
    const prio=departedGap?0:arrivalGap?1:2;candidates.push({row,x,d,prio,allowed});
  }
  candidates.sort((a,b)=>a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  if(!candidates.length)return {ok:true,skipped:"AUCUN_GAP_H2_QUEUE"};
  const room=Math.max(0,Math.min(2,plan.hardDayMax-u.day,plan.monthCap-u.month));
  if(!room)return {ok:true,skipped:"OAG_QUOTA_ROOM"};
  const items=[];for(const z of candidates.slice(0,room)){items.push(await recoverOne(env,z,z.allowed))}
  return {ok:true,processed:items.length,items};
}

export default {async fetch(request,env,ctx){return app.fetch(request,env,ctx)},scheduled(controller,env,ctx){ctx.waitUntil((async()=>{try{await recoverH2(env)}catch(_){}if(typeof app.scheduled==="function")await app.scheduled(controller,env,ctx)})())}};
