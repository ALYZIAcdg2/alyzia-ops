import {queuedFieldMap} from "./provider-queue-authority.js";
import {buildNeeds,mayWriteField,priorityScore,stopAll} from "./flight-enrichment-policy.js";
import {noteAndSwitch} from "./aircraft-change.js";

// "Flightera Flight Data" via RapidAPI (GET /flight/info?flnr=&date=). Plan: 200 requests/month.
// Une seule réponse donne ATD / ATA réels, ETD / ETA estimés, porte et immatriculation (heures locales avec décalage).
// Rôle : rattraper les vols dont l'heure de départ est passée et qui n'ont toujours pas d'ATD/ATA chez les autres fournisseurs.
const PROVIDER="FLIGHTERA";
const HOST="flightera-flight-data.p.rapidapi.com";
const MAX_PER_RUN=1;             // cron toutes les 5 min
const DAY_CAP=10;
const MONTH_CAP=170;             // plan 200/mois, marge pour les essais manuels
const COOLDOWN_MIN=90;           // par vol
const MAX_ATTEMPTS_PER_FLIGHT=3;
const MAX_NOT_FOUND=2;
const FIELDS=["atd","ata","etd","eta","gate","reg"];

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const m=clean(std).match(/^(\d{2}):(\d{2})$/),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!m||fd==null||nd==null)return 99999;return (fd-nd)*1440+Number(m[1])*60+Number(m[2])-now.minutes}
const ageMs=v=>{const t=Date.parse(clean(v))||0;return t?Date.now()-t:Infinity};
// "2026-09-30T11:32:35+02:00" -> "11:32" (heure locale de l'aéroport concerné, comme STD/STA stockés dans l'app)
const local=v=>{const m=clean(v).match(/T(\d{2}:\d{2})/);return m?m[1]:""};
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function fullFlight(x,row){const carrier=upper(x.airline||row.airline),n=flightNo(x.flight||row.flight_number,carrier);return carrier&&n?(carrier==="ENT"?"E4":carrier)+n:upper(x.flight||row.flight_number)}

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
export function flighteraKey(env){return clean(env?.FLIGHTERA_RAPIDAPI_KEY)||clean(env?.RAPIDAPI_KEY)||clean(env?.QUARK_RAPIDAPI_KEY)||clean(env?.AVIATIONDATA_RAPIDAPI_KEY)}

async function fetchFlight(env,flight,date){
  const url=`https://${HOST}/flight/info?flnr=${encodeURIComponent(flight)}&date=${encodeURIComponent(date)}`;
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","x-rapidapi-key":flighteraKey(env),"x-rapidapi-host":HOST},signal:AbortSignal.timeout(8000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok,status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}

// null si la réponse ne correspond pas au vol du jour au départ de l'aéroport attendu.
export function parseFlightera(payload,date,origin="CDG"){
  const f=Array.isArray(payload)?payload.find(v=>local(v?.scheduled_departure_local)&&clean(v?.scheduled_departure_local).slice(0,10)===date&&(!origin||upper(v?.departure_iata)===origin)):null;
  if(!f)return null;
  const depEst=Boolean(f.actual_departure_is_estimated),arrEst=Boolean(f.actual_arrival_is_estimated);
  const st=upper(f.status);
  return {
    atd:f.actual_departure_local&&!depEst?local(f.actual_departure_local):"",
    etd:f.actual_departure_local&&depEst?local(f.actual_departure_local):"",
    ata:f.actual_arrival_local&&!arrEst?local(f.actual_arrival_local):"",
    eta:f.actual_arrival_local&&arrEst?local(f.actual_arrival_local):"",
    gate:clean(f.departure_gate),reg:upper(f.reg),model:upper(f.model),status:st
  };
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;
  return true;
}

export async function runFlighteraQueue(env){
  if(!flighteraKey(env)||!env?.OPS_DB)return {ok:true,skipped:"FLIGHTERA_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:"FLIGHTERA_QUEUE_VIDE"};
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:"FLIGHTERA_QUOTA",day:u.day,month:u.month};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  const candidates=[];
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(!FIELDS.some(f=>allowed.has(f)&&needs[f]))continue;
    if(ageMs(x.flighteraLastCheckedAt)<COOLDOWN_MIN*60000)continue;
    if(Number(x.flighteraNotFoundAttempts||0)>=MAX_NOT_FOUND)continue;
    if(Number(x.flighteraAttempts||0)>=MAX_ATTEMPTS_PER_FLIGHT)continue;
    candidates.push({row,x,d,allowed,prio:priorityScore(x,d)});
  }
  candidates.sort((a,b)=>a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(MAX_PER_RUN,DAY_CAP-u.day,MONTH_CAP-u.month)),items=[];
  for(const z of candidates.slice(0,room)){
    const flight=fullFlight(z.x,z.row);if(!flight)continue;
    const r=await fetchFlight(env,flight,z.row.flight_date),at=new Date().toISOString();
    await bump(env,now,r.status);
    z.x.flighteraAttempts=Number(z.x.flighteraAttempts||0)+1;
    z.x.flighteraLastCheckedAt=at;z.x.flighteraLastStatus=r.status;
    const changed=[];
    if(r.ok){
      const data=parseFlightera(r.payload,z.row.flight_date,upper(z.x.origin||"CDG"));
      if(data){
        for(const f of FIELDS)if(z.allowed.has(f)&&apply(z.x,f,data[f],at))changed.push(f);
        if(data.status){z.x.flighteraStatusRaw=data.status}
        if(await noteAndSwitch(env,z.x,data.model,PROVIDER,at))changed.push("aircraft");
      }else z.x.flighteraNotFoundAttempts=Number(z.x.flighteraNotFoundAttempts||0)+1;
    }else if(r.status===404)z.x.flighteraNotFoundAttempts=Number(z.x.flighteraNotFoundAttempts||0)+1;
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
    items.push({flight,status:r.status,changed});
    if([401,403,429].includes(r.status)||r.status>=500)break;
  }
  return {ok:true,processed:items.length,items};
}
