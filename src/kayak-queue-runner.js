import {queuedFieldMap} from "./provider-queue-authority.js";
import {buildNeeds,mayWriteField,priorityScore,stopAll} from "./flight-enrichment-policy.js";
import {noteAndSwitch} from "./aircraft-change.js";
import {flighteraKey} from "./flightera-queue-runner.js";
import {providerPause,recordProviderResult} from "./provider-errors.js";

// Kayak5 (RapidAPI) : GET /api/v1/flights/details?flight_id=<tk1828>&search_id=<cdg>. Une réponse donne les heures de porte (départ/arrivée), le statut (S/A/L/C), la porte et le terminal.
// Rôle : rattraper ATD / ATA / ETA / ETD / STA / porte des vols partis, en complément de Flightera / FlightRadar.
const PROVIDER="KAYAK";
const HOST="kayak5.p.rapidapi.com";
const MAX_PER_RUN=1;             // cron toutes les 5 min
const DAY_CAP=7;
const MONTH_CAP=170;            // plan 200/mois, marge pour les essais manuels
const COOLDOWN_MIN=90;           // par vol
const MAX_ATTEMPTS_PER_FLIGHT=3;
const MAX_NOT_FOUND=2;
const FIELDS=["sta","atd","ata","etd","eta","gate"];

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
export function kayakKey(env){return clean(env?.KAYAK_RAPIDAPI_KEY)||flighteraKey(env)}

async function fetchFlight(env,flight,origin){
  const url=`https://${HOST}/api/v1/flights/details?flight_id=${encodeURIComponent(clean(flight).toLowerCase())}&search_id=${encodeURIComponent(clean(origin).toLowerCase())}`;
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","x-rapidapi-key":kayakKey(env),"x-rapidapi-host":HOST},signal:AbortSignal.timeout(8000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok,status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}

// Heure locale (HH:MM) d'un horodatage en ms avec le décalage UTC de l'aéroport (utcOffsetMinutes fourni par l'API).
const localHm=(ms,off)=>{const t=Number(ms);if(!Number.isFinite(t)||t<=0||!Number.isFinite(Number(off)))return "";const d=new Date(t+Number(off)*60000);return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`};
const localDate=(ms,off)=>{const t=Number(ms);if(!Number.isFinite(t)||t<=0||!Number.isFinite(Number(off)))return "";return new Date(t+Number(off)*60000).toISOString().slice(0,10)};
const minOf=hm=>{const m=clean(hm).match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
// null si la réponse ne correspond pas au vol attendu : même date locale de départ, même aéroport, STD proche de la STD de l'app (±90 min).
// Statut : S programmé -> ETD/ETA ; A en vol -> ATD + ETA ; L atterri -> ATD + ATA ; C annulé / autres -> rien d'exploitable.
export function parseKayak(payload,date,origin="CDG",std=""){
  const f=Array.isArray(payload?.flights)?payload.flights.find(v=>v&&v.departure&&v.arrival&&(!origin||upper(v.departure.code)===origin)):null;
  if(!f)return null;
  const dOff=f.departure.utcOffsetMinutes,aOff=f.arrival.utcOffsetMinutes,dt=f.departureTimes||{},at=f.arrivalTimes||{};
  const sched=dt.scheduledGateTimestampMs;
  if(localDate(sched,dOff)!==date)return null;
  const stdMin=minOf(std),schedMin=minOf(localHm(sched,dOff));
  if(stdMin!==null&&schedMin!==null){let d=Math.abs(schedMin-stdMin);if(d>720)d=1440-d;if(d>90)return null}
  const status=upper(f.statusCode),depGate=localHm(dt.gateTimestampMs,dOff),depSched=localHm(sched,dOff),arrGate=localHm(at.gateTimestampMs,aOff);
  const out={sta:localHm(at.scheduledGateTimestampMs,aOff),atd:"",etd:"",ata:"",eta:"",gate:clean(f.departure.gate),model:"",status};
  if(status==="L"){out.atd=depGate;out.ata=arrGate}
  else if(status==="A"){out.atd=depGate;out.eta=arrGate}
  else if(status==="S"){if(depGate&&depGate!==depSched)out.etd=depGate;if(arrGate&&arrGate!==out.sta)out.eta=arrGate}
  return out;
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;
  return true;
}

export async function runKayakQueue(env){
  if(!kayakKey(env)||!env?.OPS_DB)return {ok:true,skipped:"KAYAK_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const pause=await providerPause(env,PROVIDER,kayakKey(env));
  if(pause.paused&&!globalThis.__ALYZIA_MANUAL_PUSH)return {ok:true,skipped:"KAYAK_PAUSE_"+pause.status,until:pause.until,message:pause.message};
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:"KAYAK_QUEUE_VIDE"};
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:"KAYAK_QUOTA",day:u.day,month:u.month};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  const candidates=[];
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(!FIELDS.some(f=>allowed.has(f)&&(needs[f]||(f==="ata"&&needs.ata_late))))continue;
    if(!globalThis.__ALYZIA_MANUAL_PUSH&&ageMs(x.kayakLastCheckedAt)<COOLDOWN_MIN*60000)continue;
    if(Number(x.kayakNotFoundAttempts||0)>=MAX_NOT_FOUND)continue;
    if(Number(x.kayakAttempts||0)>=MAX_ATTEMPTS_PER_FLIGHT)continue;
    candidates.push({row,x,d,allowed,prio:priorityScore(x,d)});
  }
  candidates.sort((a,b)=>a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(globalThis.__ALYZIA_MANUAL_PUSH?3:MAX_PER_RUN,DAY_CAP-u.day,MONTH_CAP-u.month)),items=[];
  for(const z of candidates.slice(0,room)){
    const flight=fullFlight(z.x,z.row);if(!flight)continue;
    const origin=upper(z.x.origin||"CDG"),r=await fetchFlight(env,flight,origin),at=new Date().toISOString();
    await bump(env,now,r.status);
    await recordProviderResult(env,PROVIDER,r.status,r.payload,kayakKey(env));
    z.x.kayakAttempts=Number(z.x.kayakAttempts||0)+1;
    z.x.kayakLastCheckedAt=at;z.x.kayakLastStatus=r.status;
    const changed=[];
    if(r.ok){
      const data=parseKayak(r.payload,z.row.flight_date,origin,z.x.std||z.row.std);
      if(data){
        for(const f of FIELDS)if(z.allowed.has(f)&&apply(z.x,f,data[f],at))changed.push(f);
        if(data.status){z.x.kayakStatusRaw=data.status}
        if(await noteAndSwitch(env,z.x,data.model,PROVIDER,at))changed.push("aircraft");
      }else z.x.kayakNotFoundAttempts=Number(z.x.kayakNotFoundAttempts||0)+1;
    }else if(r.status===404)z.x.kayakNotFoundAttempts=Number(z.x.kayakNotFoundAttempts||0)+1;
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
    items.push({flight,status:r.status,changed});
    if([401,403,429].includes(r.status)||r.status>=500)break;
  }
  return {ok:true,processed:items.length,items};
}
