import {queuedFieldMap} from "./provider-queue-authority.js";
import {paceRoom} from "./budget-pace.js";
import {buildNeeds,mayWriteField,priorityScore,stopAll} from "./flight-enrichment-policy.js";
import {noteAndSwitch} from "./aircraft-change.js";
import {providerPause,recordProviderResult} from "./provider-errors.js";

// SerpApi (Google, bloc « statut du vol » : source Cirium/OAG) : GET https://serpapi.com/search.json?engine=google&q=<TK1824 flight status>. 250 recherches/mois.
// Une recherche renvoie, pour la date du vol : heure prévue et estimée/réelle de départ et d'arrivée, porte, statut. Rôle : ETD / ATD / ETA / ATA des vols proches du départ.
const PROVIDER="SERPAPI";
const HOST="serpapi.com";
const MAX_PER_RUN=1;             // cron toutes les 5 min
const DAY_CAP=6;
const MONTH_CAP=215;            // 250 recherches/mois, marge pour les essais
const COOLDOWN_MIN=45;           // par vol
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
export function serpapiKey(env){return clean(env?.SERPAPI_API_KEY)||clean(env?.SERPAPI_KEY)}

async function fetchFlight(env,flight){
  const url=`https://${HOST}/search.json?engine=google&q=${encodeURIComponent(clean(flight)+" flight status")}&hl=en&gl=fr&api_key=${encodeURIComponent(serpapiKey(env))}`;
  try{
    const r=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(25000)});
    const payload=await r.json().catch(()=>null);
    // SerpApi signale certaines erreurs par un 200 + {error}
    let status=r.status;const err=clean(payload?.error);
    if(r.ok&&err){status=/invalid api key/i.test(err)?401:/(run out|exceeded|limit)/i.test(err)?429:/hasn't returned any results|no results/i.test(err)?404:502}
    return {ok:status>=200&&status<300,status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}

const hmIso=v=>{const m=clean(v).match(/T(\d{2}:\d{2})/);return m?m[1]:""};
const minOf=hm=>{const m=clean(hm).match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
const gateOf=v=>{const g=clean(v);return g&&g!=="-"?g:""};
// null si la réponse ne correspond pas au vol attendu : bonne date, bon aéroport de départ, heure prévue proche de la STD (±90 min).
// Statuts (metadata.status) : ON_THE_RUNWAY / EN_ROUTE / AIRBORNE / DEPARTED -> parti (ATD, ETA) ; ARRIVED / LANDED -> ATD + ATA ; sinon ETD / ETA si l'heure diffère de la prévue.
export function parseSerpapi(payload,date,origin="CDG",std=""){
  const dates=Array.isArray(payload?.flight_result?.dates)?payload.flight_result.dates:[];
  const e=dates.find(v=>v&&v.date===date&&v.departure_airport&&v.arrival_airport);
  if(!e)return null;
  const meta=e.metadata||{},dep=e.departure_airport,arr=e.arrival_airport;
  if(origin&&upper(meta.origin||dep.id)!==origin)return null;
  const depTime=hmIso(dep.time),depSched=hmIso(dep.scheduled_time)||depTime,arrTime=hmIso(arr.time),arrSched=hmIso(arr.scheduled_time)||arrTime;
  const stdMin=minOf(std),schedMin=minOf(depSched);
  if(stdMin!==null&&schedMin!==null){let d=Math.abs(schedMin-stdMin);if(d>720)d=1440-d;if(d>90)return null}
  const status=upper(meta.status);
  const out={sta:arrSched,atd:"",etd:"",ata:"",eta:"",gate:gateOf(dep.gate),model:"",status};
  if(/CANCEL/.test(status))return {...out,sta:"",gate:"",status:"CANCELLED"};
  const arrived=/(ARRIVED|LANDED)/.test(status),departed=arrived||/(RUNWAY|EN_ROUTE|AIRBORNE|IN_AIR|IN_FLIGHT|DEPARTED|DIVERT)/.test(status);
  if(arrived){out.atd=depTime;out.ata=arrTime}
  else if(departed){out.atd=depTime;out.eta=arrTime}
  else{if(depTime&&depTime!==depSched)out.etd=depTime;if(arrTime&&arrTime!==arrSched)out.eta=arrTime}
  return out;
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;
  return true;
}

export async function runSerpapiQueue(env){
  if(!serpapiKey(env)||!env?.OPS_DB)return {ok:true,skipped:"SERPAPI_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const pause=await providerPause(env,PROVIDER,serpapiKey(env));
  if(pause.paused&&!globalThis.__ALYZIA_MANUAL_PUSH)return {ok:true,skipped:"SERPAPI_PAUSE_"+pause.status,until:pause.until,message:pause.message};
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:"SERPAPI_QUEUE_VIDE"};
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:"SERPAPI_QUOTA",day:u.day,month:u.month};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  const candidates=[];
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(!FIELDS.some(f=>allowed.has(f)&&(needs[f]||(f==="ata"&&needs.ata_late))))continue;
    if(!globalThis.__ALYZIA_MANUAL_PUSH&&ageMs(x.serpapiLastCheckedAt)<COOLDOWN_MIN*60000)continue;
    if(Number(x.serpapiNotFoundAttempts||0)>=MAX_NOT_FOUND)continue;
    if(Number(x.serpapiAttempts||0)>=MAX_ATTEMPTS_PER_FLIGHT)continue;
    candidates.push({row,x,d,allowed,prio:priorityScore(x,d)});
  }
  candidates.sort((a,b)=>a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(globalThis.__ALYZIA_MANUAL_PUSH?3:MAX_PER_RUN,DAY_CAP-u.day,MONTH_CAP-u.month,paceRoom(u.day,DAY_CAP,now.minutes))),items=[];
  for(const z of candidates.slice(0,room)){
    const flight=fullFlight(z.x,z.row);if(!flight)continue;
    const origin=upper(z.x.origin||"CDG"),r=await fetchFlight(env,flight),at=new Date().toISOString();
    await bump(env,now,r.status);
    await recordProviderResult(env,PROVIDER,r.status,r.payload,serpapiKey(env));
    z.x.serpapiAttempts=Number(z.x.serpapiAttempts||0)+1;
    z.x.serpapiLastCheckedAt=at;z.x.serpapiLastStatus=r.status;
    const changed=[];
    if(r.ok){
      const data=parseSerpapi(r.payload,z.row.flight_date,origin,z.x.std||z.row.std);
      if(data){
        for(const f of FIELDS)if(z.allowed.has(f)&&apply(z.x,f,data[f],at))changed.push(f);
        if(data.status){z.x.serpapiStatusRaw=data.status}
        if(await noteAndSwitch(env,z.x,data.model,PROVIDER,at))changed.push("aircraft");
      }else z.x.serpapiNotFoundAttempts=Number(z.x.serpapiNotFoundAttempts||0)+1;
    }else if(r.status===404)z.x.serpapiNotFoundAttempts=Number(z.x.serpapiNotFoundAttempts||0)+1;
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
    items.push({flight,status:r.status,changed});
    if([401,403,429].includes(r.status)||r.status>=500)break;
  }
  return {ok:true,processed:items.length,items};
}
