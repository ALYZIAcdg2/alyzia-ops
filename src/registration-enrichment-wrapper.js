import app from "./ent-alias-wrapper.js";
import {noteActualAircraft,noteAndSwitch} from "./aircraft-change.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function hhmm(v){const s=clean(v),m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""}
function delta(std,minutes){const h=hhmm(std);if(!h)return 99999;const [a,b]=h.split(":").map(Number);return a*60+b-minutes}
function flightNo(v){const m=upper(v).match(/(\d+[A-Z]?)$/);return m?m[1]:""}
function isFinal(x){return /CANCEL/i.test(upper(x.status))||Boolean(clean(x.atd)&&clean(x.ata))}
function aliasesFor(row,x){
  const stored=upper(x.airline||row.airline),n=flightNo(x.flight||row.flight_number);if(!n)return [];
  const set=new Set();
  if(stored==="ENT"){set.add(`E4${n}`);set.add(`ENT${n}`)}
  else {set.add(`${stored}${n}`)}
  return [...set];
}
function canWriteReg(x){return missing(x.reg)||["AIRLABS","SKYLINK","SKYLINK_ENT_ALIAS","OAG_STATUS","OAG_SCHEDULE","AERODATABOX_REG"].includes(upper(x.regSource))}
function setField(x,field,value,source,at){
  const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;
  if(field==="reg"&&!canWriteReg(x))return false;
  if(field!=="reg"&&!missing(from))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;return true;
}
async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function usage(env){
  try{await ensureUsage(env);const now=parisNow(),month=now.date.slice(0,7);const {results=[]}=await env.OPS_DB.prepare(`SELECT period,calls,last_at FROM api_provider_usage WHERE provider='AIRLABS' AND period IN (?,?)`).bind(month,now.date).all();const d=results.find(r=>r.period===now.date)||{},m=results.find(r=>r.period===month)||{};return {day:Number(d.calls||0),month:Number(m.calls||0),lastAt:clean(d.last_at||m.last_at)}}catch{return {day:0,month:0,lastAt:""}}
}
async function bump(env,status){
  try{await ensureUsage(env);const now=parisNow(),at=new Date().toISOString();for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('AIRLABS',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run()}catch(_){}
}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}
function rowsOf(payload){if(Array.isArray(payload))return payload;if(Array.isArray(payload?.response))return payload.response;if(Array.isArray(payload?.data))return payload.data;return []}

async function enrichRegistrations(env){
  if(!env.AIRLABS_API_KEY)return {ok:true,skipped:"AIRLABS_API_KEY_NON_CONFIGURE"};
  const u=await usage(env),limit=Number(env.AIRLABS_MONTHLY_LIMIT||1000),reserve=Number(env.AIRLABS_MONTHLY_RESERVE||180),cadence=Math.max(90,Number(env.AIRLABS_REG_CADENCE_MINUTES||120));
  if(u.month>=Math.max(0,limit-reserve))return {ok:true,skipped:"AIRLABS_QUOTA_RESERVE",usage:u};
  const now=parisNow(),{results=[]}=await env.OPS_DB.prepare(`SELECT identity,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  const candidates=[];
  for(const row of results){let x={};try{x=JSON.parse(row.data_json||"{}")}catch{};const d=delta(x.std||row.std,now.minutes);if(d>180||d<-720||isFinal(x)||!missing(x.reg))continue;candidates.push({row,x,d,aliases:aliasesFor(row,x)})}
  if(!candidates.length)return {ok:true,skipped:"AUCUNE_IMMAT_MANQUANTE"};
  const last=Math.max(...candidates.map(z=>Date.parse(clean(z.x.airlabsRegBatchCheckedAt)||0)||0),0);if(last&&Date.now()-last<cadence*60000)return {ok:true,skipped:"AIRLABS_REG_CADENCE",cadence};
  const fields="flight_iata,flight_icao,flight_number,airline_iata,airline_icao,dep_iata,arr_iata,reg_number,hex,aircraft_icao,status,updated";
  const p=new URLSearchParams({dep_iata:"CDG",api_key:env.AIRLABS_API_KEY,_fields:fields,limit:"250"});
  let r;try{r=await fetch(`https://airlabs.co/api/v9/flights?${p}`,{headers:{Accept:"application/json"}})}catch(e){await bump(env,502);return {ok:false,status:502,error:String(e?.message||e)}}
  await bump(env,r.status);const payload=await r.json().catch(()=>null),live=rowsOf(payload),at=new Date().toISOString();
  for(const z of candidates){z.x.airlabsRegBatchCheckedAt=at;z.x.airlabsRegBatchStatus=r.status}
  if(!r.ok){for(const z of candidates)await save(env,z.row,z.x);return {ok:false,status:r.status,error:`AIRLABS_${r.status}`}}
  const changed=[];
  for(const z of candidates){
    const dest=upper(z.x.destination||z.x.dest),n=flightNo(z.x.flight||z.row.flight_number);
    const match=live.find(q=>{
      const ids=[upper(q?.flight_iata),upper(q?.flight_icao),upper(`${q?.airline_iata||""}${q?.flight_number||""}`),upper(`${q?.airline_icao||""}${q?.flight_number||""}`)].filter(Boolean);
      const numberOk=n&&flightNo(q?.flight_iata||q?.flight_icao||q?.flight_number)===n;
      const aliasOk=z.aliases.some(a=>ids.includes(a));
      const destOk=!dest||!upper(q?.arr_iata)||upper(q?.arr_iata)===dest;
      return (aliasOk||numberOk)&&destOk;
    });
    if(match&&clean(match.reg_number)){
      const fieldsChanged=[];if(setField(z.x,"reg",match.reg_number,"AIRLABS_LIVE",at))fieldsChanged.push("reg");if(setField(z.x,"modeS",match.hex,"AIRLABS_LIVE",at))fieldsChanged.push("modeS");if(setField(z.x,"aircraft",match.aircraft_icao,"AIRLABS_LIVE",at)||await noteAndSwitch(env,z.x,match.aircraft_icao,"AIRLABS_LIVE",at))fieldsChanged.push("aircraft");
      if(fieldsChanged.length)changed.push({flight:z.aliases[0]||z.row.flight_number,registration:clean(match.reg_number),changed:fieldsChanged});
    }
    await save(env,z.row,z.x);
  }
  return {ok:true,cadence,candidates:candidates.length,liveRows:live.length,matched:changed.length,changes:changed};
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/providers/registration/status")return new Response(JSON.stringify({ok:true,usage:await usage(env),cadenceMinutes:Number(env.AIRLABS_REG_CADENCE_MINUTES||120)}),{headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){ctx.waitUntil((async()=>{try{await enrichRegistrations(env)}catch(_){}if(typeof app.scheduled==="function")await app.scheduled(controller,env,ctx)})())}
};
