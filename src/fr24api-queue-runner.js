import {queuedFieldMap} from "./provider-queue-authority.js";
import {paceRoom} from "./budget-pace.js";
import {buildNeeds,mayWriteField,stopAll} from "./flight-enrichment-policy.js";
import {noteAndSwitch} from "./aircraft-change.js";
import {providerPause,recordProviderResult} from "./provider-errors.js";
import {AIRPORT_TZ} from "./airport-tz.js";

// API officielle Flightradar24 (plan Explorer) : GET https://fr24api.flightradar24.com/api/live/flight-positions/full?flights=...&airports=outbound:CDG&limit=20
// Un appel groupé (15 numéros de vol max) renvoie les vols en l'air demandés partis de CDG : ETA (UTC), immatriculation, type ICAO. Pas d'ETD ni de porte.
// Le WAF de FR24 refuse les User-Agent de bibliothèques (Python-urllib) : on envoie un UA de type curl.
const PROVIDER="FR24API";
const HOST="fr24api.flightradar24.com";
const DAY_CAP=16;                // appels groupés par jour (chaque appel coûte des crédits proportionnels au nombre de vols renvoyés)
const MONTH_CAP=400;
const MIN_GAP_MIN=40;            // écart minimal entre deux appels
const LIMIT=20;                  // plan Explorer : 20 résultats max par réponse, 10 requêtes/min, 60 000 crédits/mois
const MAX_FLIGHTS=15;            // paramètre flights= : 15 numéros de vol max par appel
const FIELDS=["eta","reg"];

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
export function fr24apiKey(env){return clean(env?.FR24API_TOKEN)||clean(env?.FR24API_KEY)}
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const m=clean(std).match(/^(\d{2}):(\d{2})$/),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!m||fd==null||nd==null)return 99999;return (fd-nd)*1440+Number(m[1])*60+Number(m[2])-now.minutes}

let airportZones=null;
async function zoneOf(env,iata){
  const k=upper(iata);if(!k)return "";
  if(AIRPORT_TZ[k])return AIRPORT_TZ[k];
  if(!airportZones){
    try{const r=await env?.ASSETS?.fetch(new Request("https://assets.local/airports.json"));airportZones=r&&r.ok?await r.json():{}}catch{airportZones={}}
  }
  return clean(airportZones[k]?.[1]);
}
// "2026-10-01T16:40:00Z" -> "HH:MM" heure locale de l'aéroport d'arrivée (comme STA stockée dans l'app)
export function localHm(iso,zone){
  const t=Date.parse(clean(iso));if(!t||!zone)return "";
  try{const p=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));return `${p.hour}:${p.minute}`}catch{return ""}
}
function fullFlightKey(x,row){const carrier=upper(x.airline||row.airline),raw=upper(x.flight||row.flight_number);let s=raw;if(carrier&&s.startsWith(carrier))s=s.slice(carrier.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/),n=m?m[1]:s;return carrier&&n?(carrier==="ENT"?"E4":carrier)+n:raw}
// Réponse -> Map "TK1824" -> {eta,reg,type,dest}
export function parseLive(payload){
  const out=new Map(),list=Array.isArray(payload?.data)?payload.data:[];
  for(const it of list){
    const flight=upper(it?.flight);if(!flight||upper(it?.orig_iata)&&upper(it.orig_iata)!=="CDG")continue;
    out.set(flight,{eta:clean(it.eta),reg:upper(it.reg),type:upper(it.type),dest:upper(it.dest_iata)});
  }
  return out;
}

async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function usage(env,now){
  await ensureUsage(env);
  const month=now.date.slice(0,7),{results=[]}=await env.OPS_DB.prepare(`SELECT period,calls,last_at FROM api_provider_usage WHERE provider=? AND period IN (?,?)`).bind(PROVIDER,month,now.date).all();
  const d=results.find(r=>r.period===now.date);
  return {day:Number(d?.calls||0),month:Number(results.find(r=>r.period===month)?.calls||0),lastAt:Date.parse(d?.last_at||"")||0};
}
async function bump(env,now,status){
  try{
    await ensureUsage(env);const at=new Date().toISOString(),ok=status>=200&&status<300?1:0;
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(PROVIDER,period,ok,ok?0:1,status,at).run();
  }catch(_){}
}
async function fetchLive(env,flights){
  const url=`https://${HOST}/api/live/flight-positions/full?flights=${encodeURIComponent(flights.join(","))}&airports=${encodeURIComponent("outbound:CDG")}&limit=${LIMIT}`;
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","Accept-Version":"v1",Authorization:"Bearer "+fr24apiKey(env),"User-Agent":"curl/8.5.0"},signal:AbortSignal.timeout(25000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok,status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;
  return true;
}

export async function runFr24ApiQueue(env){
  if(!fr24apiKey(env)||!env?.OPS_DB)return {ok:true,skipped:"FR24API_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const pause=await providerPause(env,PROVIDER,fr24apiKey(env));
  if(pause.paused&&!globalThis.__ALYZIA_MANUAL_PUSH)return {ok:true,skipped:"FR24API_PAUSE_"+pause.status,until:pause.until,message:pause.message};
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:"FR24API_QUEUE_VIDE"};
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:"FR24API_QUOTA",day:u.day,month:u.month};
  if(!globalThis.__ALYZIA_MANUAL_PUSH&&Date.now()-u.lastAt<MIN_GAP_MIN*60000)return {ok:true,skipped:"FR24API_INTERVALLE"};
  if(!globalThis.__ALYZIA_MANUAL_PUSH&&paceRoom(u.day,DAY_CAP,now.minutes)<1)return {ok:true,skipped:"FR24API_PACE"};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?)`).bind(yesterday,now.date).all();
  const wanted=[];
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(d>0||d<-720)continue;   // seulement les vols déjà partis (en l'air)
    if(!FIELDS.some(f=>allowed.has(f)&&needs[f]))continue;
    wanted.push({row,x,d,allowed,key:fullFlightKey(x,row)});
  }
  if(!wanted.length)return {ok:true,skipped:"FR24API_RIEN_A_FAIRE"};
  wanted.sort((a,b)=>b.d-a.d);   // les vols partis le plus récemment d'abord
  const keys=[...new Set(wanted.map(z=>z.key).filter(Boolean))].slice(0,MAX_FLIGHTS);
  const r=await fetchLive(env,keys),at=new Date().toISOString();
  await bump(env,now,r.status);
  await recordProviderResult(env,PROVIDER,r.status,r.payload,fr24apiKey(env));
  if(!r.ok)return {ok:false,status:r.status,error:r.error||"HTTP "+r.status};
  const live=parseLive(r.payload),items=[];
  for(const z of wanted){
    const it=live.get(z.key);if(!it)continue;
    const changed=[];
    if(z.allowed.has("eta")&&it.eta){const dest=it.dest||upper(z.x.destination||z.x.dest),zone=await zoneOf(env,dest),hm=localHm(it.eta,zone);if(hm&&apply(z.x,"eta",hm,at))changed.push("eta")}
    if(z.allowed.has("reg")&&!clean(z.x.reg)&&it.reg&&apply(z.x,"reg",it.reg,at))changed.push("reg");
    if(it.type&&await noteAndSwitch(env,z.x,it.type,PROVIDER,at))changed.push("aircraft");
    z.x.fr24apiLastCheckedAt=at;
    if(changed.length){
      await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
      items.push({flight:z.key,changed});
    }
  }
  return {ok:true,seen:live.size,wanted:wanted.length,processed:items.length,items};
}
