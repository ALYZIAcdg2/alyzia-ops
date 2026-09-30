import {queuedFieldMap} from "./provider-queue-authority.js";
import {buildNeeds,mayWriteField,stopAll} from "./flight-enrichment-policy.js";
import {noteAndSwitch} from "./aircraft-change.js";
import {flighteraKey} from "./flightera-queue-runner.js";

// "Flightradar24 (things4u)" via RapidAPI : GET /airports/departures/load-earlier-flights?airport_id=CDG&page=N. Plan : 500 requêtes/mois.
// UN appel = 100 départs de CDG (~2 h de programme, page 1 = les plus récents jusqu'à maintenant, puis on remonte le temps) avec, par vol :
// départ/arrivée réels (epoch UTC), estimés, immatriculation, type d'appareil réel, porte, statut (annulé / atterri…).
// Rôle : rattrapage GROUPÉ de tous les vols du jour encore incomplets (ATD, ATA, ETD, ETA, porte, immat.) en 1 à 4 appels.
const PROVIDER="FR24DEP";
const HOST="flightradar24-com.p.rapidapi.com";
const AIRPORT="CDG";
const DAY_CAP=12;
const MONTH_CAP=430;              // plan 500/mois, marge pour les essais
const MIN_INTERVAL_MIN=45;        // entre deux passages complets
const MAX_PAGES=4;                // ~8 h de programme par passage
const FIELDS=["atd","ata","etd","eta","gate","reg"];

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const m=clean(std).match(/^(\d{2}):(\d{2})$/),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!m||fd==null||nd==null)return 99999;return (fd-nd)*1440+Number(m[1])*60+Number(m[2])-now.minutes}
const ageMs=v=>{const t=Date.parse(clean(v))||0;return t?Date.now()-t:Infinity};
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function fullFlight(x,row){const carrier=upper(x.airline||row.airline),n=flightNo(x.flight||row.flight_number,carrier);return carrier&&n?(carrier==="ENT"?"E4":carrier)+n:upper(x.flight||row.flight_number)}
export function fr24Key(env){return clean(env?.FR24COM_RAPIDAPI_KEY)||flighteraKey(env)}

// epoch (secondes UTC) + décalage du fuseau (secondes) -> "HH:MM" local, et date locale.
const localHM=(epoch,offset)=>{if(!epoch)return "";const d=new Date((Number(epoch)+Number(offset||0))*1000);return d.toISOString().slice(11,16)};
const localDate=(epoch,offset)=>{const d=new Date((Number(epoch)+Number(offset||0))*1000);return d.toISOString().slice(0,10)};

async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function usage(env,now){
  await ensureUsage(env);
  const month=now.date.slice(0,7),{results=[]}=await env.OPS_DB.prepare(`SELECT period,calls,last_at FROM api_provider_usage WHERE provider=? AND period IN (?,?)`).bind(PROVIDER,month,now.date).all();
  const day=results.find(r=>r.period===now.date);
  return {day:Number(day?.calls||0),month:Number(results.find(r=>r.period===month)?.calls||0),lastAt:clean(day?.last_at)};
}
async function bump(env,now,status){
  try{
    await ensureUsage(env);const at=new Date().toISOString(),ok=status>=200&&status<300?1:0;
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(PROVIDER,period,ok,ok?0:1,status,at).run();
  }catch(_){}
}

async function fetchPage(env,page){
  try{
    const r=await fetch(`https://${HOST}/airports/departures/load-earlier-flights?airport_id=${AIRPORT}&page=${page}`,{headers:{Accept:"application/json","x-rapidapi-key":fr24Key(env),"x-rapidapi-host":HOST},signal:AbortSignal.timeout(20000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok&&payload?.status!==false,status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}
const listOf=payload=>payload?.data?.airport?.pluginData?.schedule?.departures?.data||[];

// Transforme une entrée FR24 en champs de l'app ; null si l'entrée est inexploitable.
export function parseDeparture(entry){
  const f=entry?.flight;if(!f)return null;
  const number=upper(f.identification?.number?.default);if(!number)return null;
  const offO=f.airport?.origin?.timezone?.offset??7200,offD=f.airport?.destination?.timezone?.offset??0;
  const t=f.time||{},real=t.real||{},est=t.estimated||{},sch=t.scheduled||{};
  const st=clean(f.status?.text);
  let statusRaw="";
  if(/^canceled|^cancelled/i.test(st))statusRaw="CANCELED";
  else if(/^landed/i.test(st))statusRaw="LANDED";
  else if(f.status?.live)statusRaw="AIRBORNE";
  else if(/^departed/i.test(st))statusRaw="DEPARTED";
  return {
    number,dest:upper(f.airport?.destination?.code?.iata),date:localDate(sch.departure,offO),
    atd:localHM(real.departure,offO),ata:localHM(real.arrival,offD),
    etd:real.departure?"":localHM(est.departure,offO),eta:real.arrival?"":localHM(est.arrival,offD),
    gate:clean(f.airport?.origin?.info?.gate),reg:upper(f.aircraft?.registration),model:upper(f.aircraft?.model?.code),
    statusRaw
  };
}
function apply(x,field,value,at){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;
  return true;
}

export async function runFr24DepQueue(env){
  if(!fr24Key(env)||!env?.OPS_DB)return {ok:true,skipped:"FR24DEP_NON_CONFIGURE"};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:"FR24DEP_QUEUE_VIDE"};
  const u=await usage(env,now);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:"FR24DEP_QUOTA",day:u.day,month:u.month};
  if(!globalThis.__ALYZIA_MANUAL_PUSH&&ageMs(u.lastAt)<MIN_INTERVAL_MIN*60000)return {ok:true,skipped:"FR24DEP_CADENCE"};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  const wanted=new Map();   // "VOL|date" -> candidat
  let earliest=Infinity;
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(d>30||d<-480||!FIELDS.some(f=>allowed.has(f)&&(needs[f]||(f==="ata"&&needs.ata_late))))continue;   // les pages couvrent ~8 h en arrière
    if(Number(x.fr24depMisses||0)>=2)continue;    // vol introuvable dans la liste deux fois de suite : on n'insiste plus (il faisait remonter 4 pages à chaque passage)
    const key=`${fullFlight(x,row)}|${row.flight_date}`;
    wanted.set(key,{row,x,allowed,changed:[]});
    const m=clean(x.std||row.std).match(/^(\d{2}):(\d{2})$/);
    if(m)earliest=Math.min(earliest,Date.parse(`${row.flight_date}T${m[1]}:${m[2]}:00Z`)/1000);
  }
  if(!wanted.size)return {ok:true,skipped:"FR24DEP_AUCUN_VOL"};
  const room=Math.max(0,Math.min(MAX_PAGES,DAY_CAP-u.day,MONTH_CAP-u.month));
  const at=new Date().toISOString(),summary={pages:0,seen:0,matched:0,changedFlights:0};
  const touched=new Set();
  let coveredFrom=Infinity;   // plus ancien départ programmé effectivement lu (epoch UTC)
  for(let page=1;page<=room;page++){
    const r=await fetchPage(env,page);
    await bump(env,now,r.status);summary.pages++;
    if(!r.ok){summary.error=r.status;break}
    const list=listOf(r.payload);summary.seen+=list.length;
    let minSched=Infinity,offO=7200;
    for(const entry of list){
      const p=parseDeparture(entry);if(!p)continue;
      const sd=entry.flight?.time?.scheduled?.departure;if(sd){minSched=Math.min(minSched,sd);offO=entry.flight?.airport?.origin?.timezone?.offset??offO}
      const z=wanted.get(`${p.number}|${p.date}`);if(!z)continue;
      const dest=upper(z.x.destination||z.x.dest);if(dest&&p.dest&&dest!==p.dest)continue;
      summary.matched++;
      for(const f of FIELDS)if(z.allowed.has(f)&&apply(z.x,f,p[f],at))z.changed.push(f);
      if(p.model&&await noteAndSwitch(env,z.x,p.model,PROVIDER,at))z.changed.push("aircraft");
      if(p.statusRaw&&clean(z.x.providerStatusRaw)!==p.statusRaw){z.x.providerStatusRaw=p.statusRaw;z.changed.push("statut")}
      z.x.fr24depLastCheckedAt=at;
      touched.add(`${p.number}|${p.date}`);
    }
    coveredFrom=Math.min(coveredFrom,minSched);
    // Page la plus ancienne atteinte : inutile de remonter plus loin que le premier vol à compléter.
    if(!(minSched>earliest-offO-1800))break;   // earliest = STD local lu comme UTC : on retire le décalage Paris
    if(list.length<100)break;
  }
  // Vols à compléter dont l'horaire tombe dans la zone lue mais absents de la liste : on compte l'échec (2 échecs = abandon).
  for(const [key,z] of wanted){
    if(touched.has(key))continue;
    const m=clean(z.x.std||z.row.std).match(/^(\d{2}):(\d{2})$/);if(!m)continue;
    const stdUtc=Date.parse(`${z.row.flight_date}T${m[1]}:${m[2]}:00Z`)/1000-7200;
    if(stdUtc>=coveredFrom){z.x.fr24depMisses=Number(z.x.fr24depMisses||0)+1;touched.add(key)}
  }
  for(const key of touched){
    const z=wanted.get(key);
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
    if(z.changed.length)summary.changedFlights++;
  }
  return {ok:true,...summary};
}
