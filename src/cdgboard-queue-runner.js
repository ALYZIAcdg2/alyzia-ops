import {queuedFieldMap} from "./provider-queue-authority.js";
import {paceRoom} from "./budget-pace.js";
import {buildNeeds,mayWriteField,stopAll} from "./flight-enrichment-policy.js";
import {providerPause,recordProviderResult} from "./provider-errors.js";
import {kayakKey,parseKayak} from "./kayak-queue-runner.js";
import {noteAndSwitch} from "./aircraft-change.js";
import {kayakAircraftToIata} from "./kayak-aircraft.js";

// Tableau des départs de CDG (Kayak5 / RapidAPI) : GET /api/v1/flights/track/airport?airport=cdg&query_type=departure&datetime_str=AAAAMMJJ-HH:MM (UTC)&jitter=<minutes>&limit=100
// UN appel renvoie tous les départs de CDG dans la fenêtre (≈ 40-60 vols pour ~170 min) avec heure de porte (ETD/ATD), ETA/ATA, porte et statut (S/A/L/C).
// Même quota RapidAPI que KAYAK (200 appels/mois) : les deux fournisseurs se partagent MONTH_CAP_TOTAL.
const PROVIDER="CDGBOARD";
const SHARED=["KAYAK","CDGBOARD"];
const HOST="kayak5.p.rapidapi.com";
const DAY_CAP=5;
const MONTH_CAP_TOTAL=155;       // plan 200/mois (Kayak vol par vol désactivé) : 5 appels/jour x 31, marge pour les essais manuels
const MIN_GAP_MIN=165;           // 5 appels répartis de ~06 h à ~20 h : chaque départ est vu une fois, juste après son décollage
const JITTER=85;                 // minutes de part et d'autre du centre de la fenêtre
const CENTER_AHEAD_MIN=-25;      // fenêtre = de -110 min à +60 min autour de l'heure actuelle : surtout des ATD réels, plus les ETD imminents
export const BOARD_WINDOW={from:CENTER_AHEAD_MIN-JITTER,to:CENTER_AHEAD_MIN+JITTER};
const LIMIT=100;
const MAX_PAGES=2;
const AC_RECHECK_MIN=150;       // le type d'appareil est recontrôlé à chaque passage du tableau (≥ 150 min)
const FIELDS=["sta","atd","ata","etd","eta","gate"];

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const m=clean(std).match(/^(\d{2}):(\d{2})$/),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!m||fd==null||nd==null)return 99999;return (fd-nd)*1440+Number(m[1])*60+Number(m[2])-now.minutes}
function flightKey(x,row){const carrier=upper(x.airline||row.airline),raw=upper(x.flight||row.flight_number);let s=raw;if(carrier&&s.startsWith(carrier))s=s.slice(carrier.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/),n=m?m[1]:s;return carrier&&n?(carrier==="ENT"?"E4":carrier)+n:raw}

// "AAAAMMJJ-HH:MM" en UTC
export function boardDatetime(ms){const d=new Date(ms),p=n=>String(n).padStart(2,"0");return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`}
// Index des vols du tableau : clé "TK1828" -> entrée. Le vol opérant (sans operatingFlight) prime sur sa version code-share.
export function indexBoard(flights){
  const own=new Map(),shared=new Map();
  for(const f of Array.isArray(flights)?flights:[]){
    if(!f||upper(f.departure?.code)!=="CDG")continue;
    const k=upper(f.airlineCode)+upper(f.flightNumber);if(!upper(f.airlineCode)||!upper(f.flightNumber))continue;
    if(f.operatingFlight&&f.operatingFlight.airlineCode){
      const ok=upper(f.operatingFlight.airlineCode)+upper(f.operatingFlight.flightNumber);
      if(!shared.has(ok))shared.set(ok,f);
      if(!own.has(k))own.set(k,f);   // la clé commerciale reste utilisable si c'est le numéro de l'app
    }else own.set(k,f);
  }
  return {find:key=>own.get(key)||shared.get(key)||null};
}
// Vol déjà décollé alors que le statut est encore « S » : un horaire piste passé suffit.
export function normalizeStatus(f,nowMs=Date.now()){
  const s=upper(f?.statusCode),rw=Number(f?.departureTimes?.runwayTimestampMs);
  if(s==="S"&&Number.isFinite(rw)&&rw>0&&rw<=nowMs)return {...f,statusCode:"A"};
  return f;
}

async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function usage(env,now){
  await ensureUsage(env);
  const month=now.date.slice(0,7),{results=[]}=await env.OPS_DB.prepare(`SELECT provider,period,calls,last_at FROM api_provider_usage WHERE provider IN (?,?) AND period IN (?,?)`).bind(SHARED[0],SHARED[1],month,now.date).all();
  const mine=results.find(r=>r.provider===PROVIDER&&r.period===now.date);
  return {day:Number(mine?.calls||0),month:results.filter(r=>r.period===month).reduce((n,r)=>n+Number(r.calls||0),0),lastAt:Date.parse(mine?.last_at||"")||0};
}
async function bump(env,now,status){
  try{
    await ensureUsage(env);const at=new Date().toISOString(),ok=status>=200&&status<300?1:0;
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(PROVIDER,period,ok,ok?0:1,status,at).run();
  }catch(_){}
}
async function fetchBoard(env,offset){
  const dt=boardDatetime(Date.now()+CENTER_AHEAD_MIN*60000);
  const url=`https://${HOST}/api/v1/flights/track/airport?limit=${LIMIT}&offset=${offset}&jitter=${JITTER}&query_type=departure&datetime_str=${encodeURIComponent(dt)}&airport=cdg`;
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","x-rapidapi-key":kayakKey(env),"x-rapidapi-host":HOST},signal:AbortSignal.timeout(20000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok&&payload?.success!==false,status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;
  return true;
}

export async function runCdgBoardQueue(env){
  if(!kayakKey(env)||!env?.OPS_DB)return {ok:true,skipped:"CDGBOARD_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const pause=await providerPause(env,"KAYAK",kayakKey(env));
  if(pause.paused&&!globalThis.__ALYZIA_MANUAL_PUSH)return {ok:true,skipped:"CDGBOARD_PAUSE_"+pause.status,until:pause.until,message:pause.message};
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP_TOTAL)return {ok:true,skipped:"CDGBOARD_QUOTA",day:u.day,month:u.month};
  if(!globalThis.__ALYZIA_MANUAL_PUSH&&Date.now()-u.lastAt<MIN_GAP_MIN*60000)return {ok:true,skipped:"CDGBOARD_INTERVALLE"};
  if(!globalThis.__ALYZIA_MANUAL_PUSH&&paceRoom(u.day,DAY_CAP,now.minutes)<1)return {ok:true,skipped:"CDGBOARD_PACE"};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?)`).bind(yesterday,now.date).all();
  const wanted=[];
  for(const row of results){
    const allowed=authority.get(row.identity)||new Set();
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(d>BOARD_WINDOW.to-5||d<BOARD_WINDOW.from+5)continue;   // dans la fenêtre du tableau
    // Champs manquants, ou type d'appareil pas encore vérifié contre le tableau (le tableau donne l'appareil réel AVANT le départ).
    const needsFields=FIELDS.some(f=>allowed.has(f)&&(needs[f]||(f==="ata"&&needs.ata_late)));
    const needsAircraft=d>-45&&(Date.now()-(Date.parse(clean(x.cdgboardAcCheckedAt))||0))>AC_RECHECK_MIN*60000;
    if(!needsFields&&!needsAircraft)continue;
    wanted.push({row,x,allowed,d,key:flightKey(x,row)});
  }
  if(!wanted.length)return {ok:true,skipped:"CDGBOARD_RIEN_A_FAIRE"};
  const at=new Date().toISOString(),all=[];let calls=0,last=null;
  for(let page=0;page<MAX_PAGES&&u.day+calls<DAY_CAP&&u.month+calls<MONTH_CAP_TOTAL;page++){
    const r=await fetchBoard(env,page*LIMIT);calls++;last=r;
    await bump(env,now,r.status);
    await recordProviderResult(env,"KAYAK",r.status,r.payload,kayakKey(env));
    if(!r.ok)break;
    all.push(...(r.payload?.flights||[]));
    if(!r.payload?.hasMore)break;
  }
  if(!all.length)return {ok:Boolean(last?.ok),status:last?.status,calls,error:last?.error};
  const board=indexBoard(all),items=[];
  for(const z of wanted){
    const f=board.find(z.key),data=f?parseKayak({flights:[normalizeStatus(f)]},z.row.flight_date,"CDG",z.x.std||z.row.std):null;
    const changed=[];
    if(data)for(const fld of FIELDS)if(z.allowed.has(fld)&&apply(z.x,fld,data[fld],at))changed.push(fld);
    z.x.cdgboardLastCheckedAt=at;   // vu (ou non trouvé) par le tableau : les API payantes vol par vol prennent le relais
    if(f&&!data)z.x.cdgboardMismatchAt=at;
    // Appareil réel annoncé par le tableau (ex. "Airbus A330-300" -> 333) : bascule type + config si différent de l'import.
    const acCode=f?kayakAircraftToIata(f.aircraft):"";
    if(acCode){z.x.cdgboardAcCheckedAt=at;if(await noteAndSwitch(env,z.x,acCode,PROVIDER,at))changed.push("aircraft")}
    {
      await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
      if(changed.length)items.push({flight:z.key,changed});
    }
  }
  return {ok:true,calls,board:all.length,wanted:wanted.length,processed:items.length,items};
}
