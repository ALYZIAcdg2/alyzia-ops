import h2Recovery from "./h2-operational-recovery-wrapper.js";
import {runAeroDataBoxQueue} from "./aerodatabox-queue-runner.js";
import {runQuarkQueue} from "./quark-queue-runner.js";
import {runAviationDataQueue} from "./aviationdata-queue-runner.js";
import {runFlighteraQueue,flighteraKey} from "./flightera-queue-runner.js";
import {runKayakQueue,kayakKey} from "./kayak-queue-runner.js";
import {recordProviderState} from "./provider-state.js";
import {runSerpapiQueue,serpapiKey} from "./serpapi-queue-runner.js";
import {runFr24ApiQueue,fr24apiKey} from "./fr24api-queue-runner.js";
import {runCdgBoardQueue} from "./cdgboard-queue-runner.js";
import {runFlightradar1Queue,runFlightradar8Queue,frKey} from "./flightradar1-queue-runner.js";
import {runFr24DepQueue,fr24Key} from "./fr24dep-queue-runner.js";
import {buildNeeds,neededFields,providerNeeded,stopAll} from "./flight-enrichment-policy.js";

const clean=v=>String(v??"").trim();
const hhmm=v=>{const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?`${m[1]}:${m[2]}`:""};
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const h=hhmm(std),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!h||fd==null||nd==null)return 99999;const [a,b]=h.split(":").map(Number);return (fd-nd)*1440+a*60+b-now.minutes}

const PROVIDERS=["OAG_SCHEDULE","OAG_STATUS","AIRLABS","SKYLINK","OPENSKY","QUARK","AVIATIONDATA","FLIGHTERA","KAYAK","SERPAPI","FR24API","CDGBOARD","FLIGHTRADAR1","FLIGHTRADAR8","FR24DEP","AERODATABOX"];
function available(env,p){if(p==="FLIGHTRADAR8")return Boolean(frKey(env,{keyEnv:"FLIGHTRADAR8_RAPIDAPI_KEY"}));if(p==="FR24DEP")return Boolean(fr24Key(env));if(p==="FLIGHTRADAR1")return Boolean(frKey(env));if(p==="FLIGHTERA")return Boolean(flighteraKey(env));if(p==="KAYAK"||p==="CDGBOARD")return Boolean(kayakKey(env));if(p==="SERPAPI")return Boolean(serpapiKey(env));if(p==="FR24API")return Boolean(fr24apiKey(env));if(p==="AVIATIONDATA")return Boolean(env.AVIATIONDATA_RAPIDAPI_KEY);if(p==="QUARK")return Boolean(env.QUARK_RAPIDAPI_KEY);if(p.startsWith("OAG_"))return Boolean(env.OAG_API_KEY);if(p==="AIRLABS")return Boolean(env.AIRLABS_API_KEY);if(p==="SKYLINK")return Boolean(env.SKYLINK_API_KEY);if(p==="OPENSKY")return Boolean(env.OPENSKY_CLIENT_ID&&env.OPENSKY_CLIENT_SECRET);if(p==="AERODATABOX")return Boolean(env.AERODATABOX);return false}
function attempted(x,p){if(p.startsWith("OAG_"))return Boolean(clean(x.oagH2LastCheckedAt)||clean(x.oagLastCheckedAt)||clean(x.oagCoverageCheckedDate));if(p==="AIRLABS")return Boolean(clean(x.airlabsRecoveryLastCheckedAt)||clean(x.airlabsLastCheckedAt)||clean(x.airlabsRegBatchCheckedAt));if(p==="SKYLINK")return Boolean(clean(x.skylinkRecoveryLastCheckedAt)||clean(x.entAliasLastCheckedAt));if(p==="OPENSKY")return Boolean(clean(x.openSkyLastSeenAt)||clean(x.openSkyAirborneConfirmedAt));if(p==="AERODATABOX")return Boolean(clean(x.aeroDataBoxLastCheckedAt));return false}
function providerEligible(env,p,x,d){
  if(!available(env,p))return false;
  if(p==="OAG_SCHEDULE"||p==="OAG_STATUS"||p==="AIRLABS"||p==="OPENSKY"||p==="QUARK")return true;
  if(p==="FR24DEP")return d<=30&&d>=-1800;   // rattrapage groupé : tous les départs de CDG déjà partis ou sur le point de partir
  if(p==="FLIGHTRADAR1"||p==="FLIGHTRADAR8")return d<=30&&d>=-360;   // fiche « live » : vol en l'air, immatriculation + type d'appareil réel
  if(p==="FLIGHTERA")return d<=0||(d<=1440&&!clean(x.sta));   // vol parti, ou vol du jour sans STA (aucun autre fournisseur ne la donne)   // dès l'heure de départ passée : ATD/ATA réels en un seul appel
  if(p==="SERPAPI")return d<=120&&d>=-120;   // vols proches du départ : ETD / ATD / ETA réels (Google, source Cirium)
  if(p==="FR24API")return d<=0&&d>=-1080;   // vol en l'air : ETA, immatriculation, type (appel groupé)
  if(p==="CDGBOARD")return d<=85&&d>=-45;   // départs de CDG dans la fenêtre du tableau : ETD / ATD / ETA / ATA / porte en un appel
  if(p==="KAYAK")return d<=0;   // vol parti : ATD / ATA / ETA réels en un appel (rattrapage, comme Flightera)
  if(p==="AVIATIONDATA")return d<=0&&(attempted(x,"OAG_STATUS")||attempted(x,"AIRLABS")||attempted(x,"SKYLINK"));   // last resort, flight already scheduled to have departed
  if(p==="SKYLINK")return d<=30||attempted(x,"OAG_STATUS")||attempted(x,"OAG_SCHEDULE")||attempted(x,"AIRLABS")||attempted(x,"OPENSKY");
  if(p==="AERODATABOX"){
    const prior=["OAG_STATUS","OAG_SCHEDULE","AIRLABS","SKYLINK","OPENSKY"].filter(q=>attempted(x,q)).length;
    return prior>=2||(d<=0&&prior>=1);
  }
  return false;
}
function eligibleFields(env,p,x,d){
  let fields=neededFields(p,x,d);
  if(p==="AIRLABS"&&available(env,"OAG_SCHEDULE")&&!attempted(x,"OAG_SCHEDULE"))fields=fields.filter(f=>!["std","sta"].includes(f));
  if(p==="AERODATABOX"&&fields.length){
    const prior=["OAG_STATUS","OAG_SCHEDULE","AIRLABS","SKYLINK","OPENSKY"].filter(q=>attempted(x,q)).length;
    if(prior<2&&d>0)fields=[];
  }
  return fields;
}

async function ensure(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS provider_enrichment_queue(
    flight_identity TEXT NOT NULL,
    flight_date TEXT NOT NULL,
    provider TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    delta_minutes INTEGER,
    stop_all INTEGER NOT NULL DEFAULT 0,
    evaluated_at TEXT NOT NULL,
    PRIMARY KEY(flight_identity,provider)
  )`).run();
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS provider_observability_snapshot(
    flight_date TEXT NOT NULL,
    provider TEXT NOT NULL,
    potential INTEGER NOT NULL DEFAULT 0,
    waiting INTEGER NOT NULL DEFAULT 0,
    avoided INTEGER NOT NULL DEFAULT 0,
    stop_all INTEGER NOT NULL DEFAULT 0,
    evaluated_at TEXT NOT NULL,
    PRIMARY KEY(flight_date,provider)
  )`).run();
}

export async function refreshProviderQueue(env){
  if(!env?.OPS_DB)return {ok:false,error:"OPS_DB_NON_CONFIGURE"};
  await ensure(env);
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000),at=new Date().toISOString();
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  await env.OPS_DB.prepare(`DELETE FROM provider_enrichment_queue WHERE flight_date IN (?,?)`).bind(yesterday,now.date).run();
  let queued=0,stopped=0;
  const stmts=[];   // écritures regroupées (batch D1) : des centaines d'appels séquentiels dépassaient 25 s
  const providerCounts=Object.fromEntries(PROVIDERS.map(p=>[p,0]));
  const potentialCounts=Object.fromEntries(PROVIDERS.map(p=>[p,0]));
  const avoidedCounts=Object.fromEntries(PROVIDERS.map(p=>[p,0]));
  for(const row of results){
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    const d=delta(row.flight_date,x.std||row.std,now),stoppedFlight=stopAll(x),needs=buildNeeds(x,d);
    if(stoppedFlight){stopped++;continue}
    for(const provider of PROVIDERS){
      if(!providerNeeded(provider,x,d))continue;
      potentialCounts[provider]++;
      if(!providerEligible(env,provider,x,d)){avoidedCounts[provider]++;continue}
      const fields=eligibleFields(env,provider,x,d);
      if(!fields.length){avoidedCounts[provider]++;continue}
      stmts.push(env.OPS_DB.prepare(`INSERT INTO provider_enrichment_queue(flight_identity,flight_date,provider,fields_json,delta_minutes,stop_all,evaluated_at) VALUES(?,?,?,?,?,0,?) ON CONFLICT(flight_identity,provider) DO UPDATE SET flight_date=excluded.flight_date,fields_json=excluded.fields_json,delta_minutes=excluded.delta_minutes,stop_all=0,evaluated_at=excluded.evaluated_at`).bind(row.identity,row.flight_date,provider,JSON.stringify(fields),d,at));
      providerCounts[provider]++;queued++;
    }
    x.enrichmentNeeds=needs;x.enrichmentPolicyEvaluatedAt=at;
    stmts.push(env.OPS_DB.prepare(`UPDATE flights SET data_json=? WHERE identity=?`).bind(JSON.stringify(x),row.identity));
  }
  for(let i=0;i<stmts.length;i+=40)await env.OPS_DB.batch(stmts.slice(i,i+40));
  for(const provider of PROVIDERS){
    await env.OPS_DB.prepare(`INSERT INTO provider_observability_snapshot(flight_date,provider,potential,waiting,avoided,stop_all,evaluated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(flight_date,provider) DO UPDATE SET potential=excluded.potential,waiting=excluded.waiting,avoided=excluded.avoided,stop_all=excluded.stop_all,evaluated_at=excluded.evaluated_at`).bind(now.date,provider,potentialCounts[provider],providerCounts[provider],avoidedCounts[provider],stopped,at).run();
  }
  return {ok:true,date:now.date,previousDate:yesterday,flights:results.length,queued,stopped,providerCounts,potentialCounts,avoidedCounts,evaluatedAt:at};
}

export default {
  scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      try{await refreshProviderQueue(env)}catch(_){}
      if(typeof h2Recovery.scheduled==="function")await h2Recovery.scheduled(controller,env,ctx);
      const track=async(name,fn)=>{try{await recordProviderState(env,name,await fn(env))}catch(e){await recordProviderState(env,name,null,e)}};
      await track("QUARK",runQuarkQueue);
      await track("FR24DEP",runFr24DepQueue);
      await track("FLIGHTERA",runFlighteraQueue);
      await track("KAYAK",runKayakQueue);
      await track("SERPAPI",runSerpapiQueue);
      await track("FR24API",runFr24ApiQueue);
      await track("CDGBOARD",runCdgBoardQueue);
      await track("FLIGHTRADAR1",runFlightradar1Queue);
      await track("FLIGHTRADAR8",runFlightradar8Queue);
      await track("AVIATIONDATA",runAviationDataQueue);
      await track("AERODATABOX",runAeroDataBoxQueue);
    })());
  }
};
