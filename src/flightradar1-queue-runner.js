import {queuedFieldMap} from "./provider-queue-authority.js";
import {buildNeeds,mayWriteField,priorityScore,stopAll} from "./flight-enrichment-policy.js";
import {noteAndSwitch} from "./aircraft-change.js";
import {flighteraKey} from "./flightera-queue-runner.js";

// "Flightradar1" (apidojo) via RapidAPI : GET /flights/search?query=<vol>. Plan : 500 requêtes/mois.
// Pour un vol EN L'AIR, la recherche renvoie une entrée type "live" avec l'immatriculation (reg) et le type d'appareil réel (ac_type).
// Un vol au sol ou terminé n'a qu'une entrée "schedule" : pas de données, on n'insiste pas.
const PROVIDER="FLIGHTRADAR1";
const HOST="flight-radar1.p.rapidapi.com";
const MAX_PER_RUN=1;
const DAY_CAP=15;
const MONTH_CAP=430;            // plan 500/mois, marge pour les essais
const COOLDOWN_MIN=60;          // par vol
const MAX_ATTEMPTS_PER_FLIGHT=4;
const MAX_NOT_LIVE=3;
const FIELDS=["reg"];

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const m=clean(std).match(/^(\d{2}):(\d{2})$/),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!m||fd==null||nd==null)return 99999;return (fd-nd)*1440+Number(m[1])*60+Number(m[2])-now.minutes}
const ageMs=v=>{const t=Date.parse(clean(v))||0;return t?Date.now()-t:Infinity};
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function fullFlight(x,row){const carrier=upper(x.airline||row.airline),n=flightNo(x.flight||row.flight_number,carrier);return carrier&&n?(carrier==="ENT"?"E4":carrier)+n:upper(x.flight||row.flight_number)}
export function frKey(env){return clean(env?.FLIGHTRADAR1_RAPIDAPI_KEY)||flighteraKey(env)}

async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function usage(env,now){
  await ensureUsage(env);
  const month=now.date.slice(0,7),{results=[]}=await env.OPS_DB.prepare(`SELECT period,calls FROM api_provider_usage WHERE provider=? AND period IN (?,?)`).bind(PROVIDER,month,now.date).all();
  return {day:Number(results.find(r=>r.period===now.date)?.calls||0),month:Number(results.find(r=>r.period===month)?.calls||0)};
}
async function bump(env,now,status){
  try{
    await ensureUsage(env);const at=new Date().toISOString(),ok=status>=200&&status<300?1:0;
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(PROVIDER,period,ok,ok?0:1,status,at).run();
  }catch(_){}
}

async function fetchSearch(env,flight){
  try{
    const r=await fetch(`https://${HOST}/flights/search?query=${encodeURIComponent(flight)}&limit=10`,{headers:{Accept:"application/json","x-rapidapi-key":frKey(env),"x-rapidapi-host":HOST},signal:AbortSignal.timeout(8000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok,status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}

// Entrée "live" du bon vol au départ de l'aéroport attendu ; null si le vol n'est pas en l'air.
export function parseLive(payload,flight,origin="CDG"){
  const list=Array.isArray(payload?.results)?payload.results:[];
  const hit=list.find(r=>r?.type==="live"&&upper(r?.detail?.flight)===flight&&(!origin||!upper(r?.detail?.schd_from)||upper(r.detail.schd_from)===origin));
  if(!hit)return null;
  return {reg:upper(hit.detail?.reg),acType:upper(hit.detail?.ac_type)};
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;
  return true;
}

export async function runFlightradar1Queue(env){
  if(!frKey(env)||!env?.OPS_DB)return {ok:true,skipped:"FLIGHTRADAR1_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:"FLIGHTRADAR1_QUEUE_VIDE"};
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:"FLIGHTRADAR1_QUOTA",day:u.day,month:u.month};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  const candidates=[];
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(!FIELDS.some(f=>allowed.has(f)&&needs[f]))continue;
    if(d>30)continue;                                   // au sol avant le départ : pas de fiche « live »
    if(ageMs(x.flightradar1LastCheckedAt)<COOLDOWN_MIN*60000)continue;
    if(Number(x.flightradar1NotLiveAttempts||0)>=MAX_NOT_LIVE)continue;
    if(Number(x.flightradar1Attempts||0)>=MAX_ATTEMPTS_PER_FLIGHT)continue;
    candidates.push({row,x,d,allowed,prio:priorityScore(x,d)});
  }
  // Vols partis le plus récemment d'abord (probablement encore en l'air).
  candidates.sort((a,b)=>Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(MAX_PER_RUN,DAY_CAP-u.day,MONTH_CAP-u.month)),items=[];
  for(const z of candidates.slice(0,room)){
    const flight=fullFlight(z.x,z.row);if(!flight)continue;
    const r=await fetchSearch(env,flight),at=new Date().toISOString();
    await bump(env,now,r.status);
    z.x.flightradar1Attempts=Number(z.x.flightradar1Attempts||0)+1;
    z.x.flightradar1LastCheckedAt=at;z.x.flightradar1LastStatus=r.status;
    const changed=[];
    if(r.ok){
      const live=parseLive(r.payload,flight,upper(z.x.origin||"CDG"));
      if(live){
        if(z.allowed.has("reg")&&apply(z.x,"reg",live.reg,at))changed.push("reg");
        if(live.acType&&await noteAndSwitch(env,z.x,live.acType,PROVIDER,at))changed.push("aircraft");
      }else z.x.flightradar1NotLiveAttempts=Number(z.x.flightradar1NotLiveAttempts||0)+1;
    }
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
    items.push({flight,status:r.status,changed});
    if([401,403,429].includes(r.status)||r.status>=500)break;
  }
  return {ok:true,processed:items.length,items};
}
