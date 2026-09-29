import {queuedFieldMap} from "./provider-queue-authority.js";
import {buildNeeds,mayWriteField,priorityScore,stopAll} from "./flight-enrichment-policy.js";

// Quark Aviation via RapidAPI (GET /flight_status?flight_number=). Plan Basic: 500 000 req/month, 1000 req/hour, 10 GB/month (overage billed).
// The API has no date parameter and returns scheduled times + delay minutes + gate (no actual times, no registration).
// Conservative caps below keep us far under every limit.
const PROVIDER="QUARK";
const MAX_PER_RUN=4;            // cron runs every 5 min -> <= 48 calls/hour (limit 1000)
const DAY_CAP=600;
const MONTH_CAP=20000;
const COOLDOWN_MIN=20;          // per flight
const MAX_NOT_FOUND=3;
const FIELDS=["etd","eta","gate"];

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const m=clean(std).match(/^(\d{2}):(\d{2})$/),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!m||fd==null||nd==null)return 99999;return (fd-nd)*1440+Number(m[1])*60+Number(m[2])-now.minutes}
const ageMs=v=>{const t=Date.parse(clean(v))||0;return t?Date.now()-t:Infinity};
// Quark returns UTC ("...Z"): convert to the local time of the airport (Paris for CDG, else the timezone given by the API).
function localParts(iso,tz){
  const t=Date.parse(clean(iso));if(!t)return null;
  try{
    const p=new Intl.DateTimeFormat("fr-CA",{timeZone:tz||"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(t)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));
    return {date:`${m.year}-${m.month}-${m.day}`,time:`${m.hour}:${m.minute}`,ms:t};
  }catch{return null}
}
const addMin=(iso,min)=>{const t=Date.parse(clean(iso));return t&&Number.isFinite(min)?new Date(t+min*60000).toISOString():""};

function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function fullFlight(x,row){const carrier=upper(x.airline||row.airline),n=flightNo(x.flight||row.flight_number,carrier);return carrier&&n?carrier+n:upper(x.flight||row.flight_number)}

async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function usage(env,now){
  await ensureUsage(env);
  const month=now.date.slice(0,7),{results=[]}=await env.OPS_DB.prepare(`SELECT period,calls FROM api_provider_usage WHERE provider=? AND period IN (?,?)`).bind(PROVIDER,month,now.date).all();
  return {day:Number(results.find(r=>r.period===now.date)?.calls||0),month:Number(results.find(r=>r.period===month)?.calls||0)};
}
async function bump(env,now,status){
  try{
    await ensureUsage(env);const at=new Date().toISOString();
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(PROVIDER,period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run();
  }catch(_){}
}

async function fetchFlight(env,flightIata){
  const host=clean(env.QUARK_RAPIDAPI_HOST)||"quark-aviation-global-flight-tracking-intelligence-api.p.rapidapi.com";
  const url=`https://${host}/flight_status?flight_number=${encodeURIComponent(flightIata)}`;
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","X-RapidAPI-Key":env.QUARK_RAPIDAPI_KEY,"X-RapidAPI-Host":host}});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok&&payload?.status==="ok"&&Boolean(payload?.data?.flight_data),status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}

// Returns null when the flight returned is not the one of flight_date leaving from the expected airport.
function parse(payload,date,origin){
  const f=payload?.data?.flight_data;if(!f)return null;
  const oTz=clean(f.origin?.timezone)||"Europe/Paris",dTz=clean(f.destination?.timezone)||"Europe/Paris";
  const dep=localParts(f.scheduled_departure,oTz);if(!dep||dep.date!==date)return null;
  if(origin&&upper(f.origin?.iata)&&upper(f.origin.iata)!==origin)return null;
  const dd=Number(f.delay_departure_minutes),da=Number(f.delay_arrival_minutes);
  const etd=Number.isFinite(dd)?localParts(addMin(f.scheduled_departure,dd),oTz)?.time||"":"";
  const eta=Number.isFinite(da)?localParts(addMin(f.scheduled_arrival,da),dTz)?.time||"":"";
  return {etd,eta,gate:clean(f.departure_gate)};
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;
  return true;
}

export async function runQuarkQueue(env){
  if(!env?.QUARK_RAPIDAPI_KEY||!env?.OPS_DB)return {ok:true,skipped:"QUARK_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:"QUARK_QUEUE_VIDE"};
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:"QUARK_QUOTA",day:u.day,month:u.month};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  const candidates=[];
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(!FIELDS.some(f=>allowed.has(f)&&needs[f]))continue;
    if(ageMs(x.quarkLastCheckedAt)<COOLDOWN_MIN*60000)continue;
    if(Number(x.quarkNotFoundAttempts||0)>=MAX_NOT_FOUND)continue;
    candidates.push({row,x,d,allowed,prio:priorityScore(x,d)});
  }
  candidates.sort((a,b)=>a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(MAX_PER_RUN,DAY_CAP-u.day,MONTH_CAP-u.month)),items=[];
  for(const z of candidates.slice(0,room)){
    const flight=fullFlight(z.x,z.row);if(!flight)continue;
    const r=await fetchFlight(env,flight),at=new Date().toISOString();
    await bump(env,now,r.status);
    z.x.quarkLastCheckedAt=at;z.x.quarkLastStatus=r.status;
    const changed=[];
    if(r.status===404)z.x.quarkNotFoundAttempts=Number(z.x.quarkNotFoundAttempts||0)+1;
    if(r.ok){
      const data=parse(r.payload,z.row.flight_date,upper(z.x.origin||"CDG"));
      if(data){for(const f of FIELDS)if(z.allowed.has(f)&&apply(z.x,f,data[f],at))changed.push(f)}
      else z.x.quarkNotFoundAttempts=Number(z.x.quarkNotFoundAttempts||0)+1;
    }
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
    items.push({flight,status:r.status,changed});
    // Rate/plan/auth problem, or wrong RapidAPI endpoint (gateway says "does not exist"): stop this run instead of burning calls.
    if([401,403,429].includes(r.status)||r.status>=500||(r.status===404&&/does not exist|not subscribed|invalid/i.test(clean(r.payload?.message||r.payload?.error))))break;
  }
  return {ok:true,processed:items.length,items};
}
