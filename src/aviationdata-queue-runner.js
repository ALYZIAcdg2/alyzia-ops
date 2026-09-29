import {queuedFieldMap} from "./provider-queue-authority.js";
import {buildNeeds,mayWriteField,priorityScore,stopAll} from "./flight-enrichment-policy.js";

// "Aviation Data - Flight Status" via RapidAPI (GET /api/flights/status?date=&flight=). Plan: 500 requests/month.
// Only used as a last resort for ACTUAL times (ATD/ATA) of flights the other providers could not resolve.
const PROVIDER="AVIATIONDATA";
const MAX_PER_RUN=1;            // cron runs every 5 min
const DAY_CAP=12;
const MONTH_CAP=400;
const COOLDOWN_MIN=60;          // per flight
const MAX_NOT_FOUND=3;
const MAX_ATTEMPTS_PER_FLIGHT=3;   // per flight: stop insisting when the API has no actual time for it
const FIELDS=["atd","ata"];

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const m=clean(std).match(/^(\d{2}):(\d{2})$/),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!m||fd==null||nd==null)return 99999;return (fd-nd)*1440+Number(m[1])*60+Number(m[2])-now.minutes}
const ageMs=v=>{const t=Date.parse(clean(v))||0;return t?Date.now()-t:Infinity};
// Times are UTC ("...Z"). CDG side -> Europe/Paris. Arrival side: no timezone in the payload, so the local offset is
// derived from the flight itself (local STA already stored minus scheduled arrival in UTC).
function parisParts(iso){
  const t=Date.parse(clean(iso));if(!t)return null;
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(t)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,time:`${m.hour}:${m.minute}`};
}
const utcMin=iso=>{const t=Date.parse(clean(iso));if(!t)return null;const d=new Date(t);return d.getUTCHours()*60+d.getUTCMinutes()};
const hm=v=>{const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null};
function offsetFor(staLocal,schedArrIso){
  const a=hm(staLocal),b=utcMin(schedArrIso);if(a==null||b==null)return null;
  let off=((a-b)%1440+1440)%1440;if(off>840)off-=1440;      // -12h .. +14h
  return Math.round(off/15)*15;
}
function shifted(iso,offsetMin){
  const t=Date.parse(clean(iso));if(!t||offsetMin==null)return "";
  const d=new Date(t+offsetMin*60000);return String(d.getUTCHours()).padStart(2,"0")+":"+String(d.getUTCMinutes()).padStart(2,"0");
}

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

async function fetchFlight(env,flight,date){
  const host=clean(env.AVIATIONDATA_RAPIDAPI_HOST)||"aviation-data-flight-status-live-tracking-airports.p.rapidapi.com";
  const url=`https://${host}/api/flights/status?date=${encodeURIComponent(date)}&flight=${encodeURIComponent(flight)}`;
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","X-RapidAPI-Key":env.AVIATIONDATA_RAPIDAPI_KEY,"X-RapidAPI-Host":host},signal:AbortSignal.timeout(8000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok&&payload?.status===true&&Boolean(payload?.data),status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}

// null when the returned flight is not the one of flight_date leaving from the expected airport.
function parse(payload,x,date,origin){
  const f=payload?.data;if(!f)return null;
  const dep=parisParts(f.origin?.scheduled);if(!dep||dep.date!==date)return null;
  if(origin&&upper(f.origin?.iata)&&upper(f.origin.iata)!==origin)return null;
  const off=offsetFor(x.sta,f.destination?.scheduled);
  return {
    atd:f.origin?.actual?(parisParts(f.origin.actual)?.time||""):"",
    ata:f.destination?.actual?shifted(f.destination.actual,off):""
  };
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;
  return true;
}

export async function runAviationDataQueue(env){
  if(!env?.AVIATIONDATA_RAPIDAPI_KEY||!env?.OPS_DB)return {ok:true,skipped:"AVIATIONDATA_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:"AVIATIONDATA_QUEUE_VIDE"};
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:"AVIATIONDATA_QUOTA",day:u.day,month:u.month};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  const candidates=[];
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(!FIELDS.some(f=>allowed.has(f)&&needs[f]))continue;
    if(ageMs(x.aviationDataLastCheckedAt)<COOLDOWN_MIN*60000)continue;
    if(Number(x.aviationDataNotFoundAttempts||0)>=MAX_NOT_FOUND)continue;
    if(Number(x.aviationDataAttempts||0)>=MAX_ATTEMPTS_PER_FLIGHT)continue;
    candidates.push({row,x,d,allowed,prio:priorityScore(x,d)});
  }
  candidates.sort((a,b)=>a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(MAX_PER_RUN,DAY_CAP-u.day,MONTH_CAP-u.month)),items=[];
  for(const z of candidates.slice(0,room)){
    const flight=fullFlight(z.x,z.row);if(!flight)continue;
    const r=await fetchFlight(env,flight,z.row.flight_date),at=new Date().toISOString();
    await bump(env,now,r.status);
    z.x.aviationDataAttempts=Number(z.x.aviationDataAttempts||0)+1;
    z.x.aviationDataLastCheckedAt=at;z.x.aviationDataLastStatus=r.status;
    const changed=[];
    if(r.status===404)z.x.aviationDataNotFoundAttempts=Number(z.x.aviationDataNotFoundAttempts||0)+1;
    if(r.ok){
      const data=parse(r.payload,z.x,z.row.flight_date,upper(z.x.origin||"CDG"));
      if(data){for(const f of FIELDS)if(z.allowed.has(f)&&apply(z.x,f,data[f],at))changed.push(f)}
      else z.x.aviationDataNotFoundAttempts=Number(z.x.aviationDataNotFoundAttempts||0)+1;
    }
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
    items.push({flight,status:r.status,changed});
    // Rate/plan/auth problem, or wrong RapidAPI endpoint (gateway says "does not exist"): stop this run instead of burning calls.
    if([401,403,429].includes(r.status)||r.status>=500||(r.status===404&&/does not exist|not subscribed|invalid/i.test(clean(r.payload?.message||r.payload?.error))))break;
  }
  return {ok:true,processed:items.length,items};
}
