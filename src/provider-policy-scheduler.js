import h2Recovery from "./h2-operational-recovery-wrapper.js";
import {buildNeeds,neededFields,providerNeeded,stopAll} from "./flight-enrichment-policy.js";

const clean=v=>String(v??"").trim();
const hhmm=v=>{const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?`${m[1]}:${m[2]}`:""};
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function delta(std,minutes){const h=hhmm(std);if(!h)return 99999;const [a,b]=h.split(":").map(Number);return a*60+b-minutes}

const PROVIDERS=["OAG_SCHEDULE","OAG_STATUS","AIRLABS","SKYLINK","OPENSKY","AERODATABOX"];

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
}

export async function refreshProviderQueue(env){
  if(!env?.OPS_DB)return {ok:false,error:"OPS_DB_NON_CONFIGURE"};
  await ensure(env);
  const now=parisNow(),at=new Date().toISOString();
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  await env.OPS_DB.prepare(`DELETE FROM provider_enrichment_queue WHERE flight_date=?`).bind(now.date).run();
  let queued=0,stopped=0;
  const providerCounts=Object.fromEntries(PROVIDERS.map(p=>[p,0]));
  for(const row of results){
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    const d=delta(x.std||row.std,now.minutes),stoppedFlight=stopAll(x),needs=buildNeeds(x,d);
    if(stoppedFlight){stopped++;continue}
    for(const provider of PROVIDERS){
      if(!providerNeeded(provider,x,d))continue;
      const fields=neededFields(provider,x,d);if(!fields.length)continue;
      await env.OPS_DB.prepare(`INSERT INTO provider_enrichment_queue(flight_identity,flight_date,provider,fields_json,delta_minutes,stop_all,evaluated_at) VALUES(?,?,?,?,?,0,?) ON CONFLICT(flight_identity,provider) DO UPDATE SET fields_json=excluded.fields_json,delta_minutes=excluded.delta_minutes,stop_all=0,evaluated_at=excluded.evaluated_at`).bind(row.identity,row.flight_date,provider,JSON.stringify(fields),d,at).run();
      providerCounts[provider]++;queued++;
    }
    x.enrichmentNeeds=needs;
    x.enrichmentPolicyEvaluatedAt=at;
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=? WHERE identity=?`).bind(JSON.stringify(x),row.identity).run();
  }
  return {ok:true,date:now.date,flights:results.length,queued,stopped,providerCounts,evaluatedAt:at};
}

export default {
  scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      try{await refreshProviderQueue(env)}catch(_){}
      if(typeof h2Recovery.scheduled==="function")await h2Recovery.scheduled(controller,env,ctx);
    })());
  }
};
