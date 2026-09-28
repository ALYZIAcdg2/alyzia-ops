import liveRecovery from "./live-recovery-wrapper.js";
import {queuedFieldMap} from "./provider-queue-authority.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};

const IATA_TO_ICAO={
  "A9":"TGZ","AH":"DAH","AI":"AIC","AT":"RAM","BJ":"LBT","DE":"CFG","EI":"EIN","FB":"LZB",
  "FI":"ICE","IZ":"AIZ","JU":"ASL","LO":"LOT","LS":"EXS","LY":"ELY","MS":"MSR","NH":"ANA",
  "OZ":"AAR","PC":"PGT","RJ":"RJA","SK":"SAS","SQ":"SIA","TK":"THY","TU":"TAR","TW":"TWB",
  "VF":"TKJ","WB":"RWD"
};

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function hhmm(v){const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?`${m[1]}:${m[2]}`:""}
function delta(std,minutes){const h=hhmm(std);if(!h)return 99999;const [a,b]=h.split(":").map(Number);return a*60+b-minutes}
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function isFinal(x){const s=upper([x.status,x.opsStatus,x.flight_status].filter(Boolean).join(" "));return /CANCEL|ANNUL/.test(s)||Boolean(clean(x.atd)&&clean(x.ata))}

async function ensureState(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS provider_runtime_state(provider TEXT PRIMARY KEY,last_at TEXT,last_status INTEGER,meta_json TEXT)`).run();
}
async function ensureUsage(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
}
async function lane(env){
  try{await ensureState(env);const r=await env.OPS_DB.prepare(`SELECT last_at,last_status,meta_json FROM provider_runtime_state WHERE provider='OPENSKY_LIVE'`).first();return {lastAt:clean(r?.last_at),lastStatus:Number(r?.last_status||0),meta:clean(r?.meta_json)}}catch{return {lastAt:"",lastStatus:0,meta:""}}
}
async function bump(env,status,meta={}){
  try{await ensureState(env);await env.OPS_DB.prepare(`INSERT INTO provider_runtime_state(provider,last_at,last_status,meta_json) VALUES('OPENSKY_LIVE',?,?,?) ON CONFLICT(provider) DO UPDATE SET last_at=excluded.last_at,last_status=excluded.last_status,meta_json=excluded.meta_json`).bind(new Date().toISOString(),status,JSON.stringify(meta)).run()}catch(_){}
}
async function bumpUsage(env,status){
  try{
    await ensureUsage(env);const now=parisNow(),at=new Date().toISOString();
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('OPENSKY_LIVE',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run();
  }catch(_){}
}

async function token(env){
  const body=new URLSearchParams({grant_type:"client_credentials",client_id:env.OPENSKY_CLIENT_ID,client_secret:env.OPENSKY_CLIENT_SECRET});
  const r=await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});
  if(!r.ok)throw new Error(`OPENSKY_AUTH_${r.status}`);
  const j=await r.json();if(!j?.access_token)throw new Error("OPENSKY_AUTH_TOKEN_ABSENT");return j.access_token;
}
async function states(env){
  const t=await token(env);
  const q=new URLSearchParams({lamin:"48.70",lamax:"49.20",lomin:"1.95",lomax:"2.85"});
  return fetch(`https://opensky-network.org/api/states/all?${q}`,{headers:{Authorization:`Bearer ${t}`,Accept:"application/json"}});
}

async function todayRows(env){
  const now=parisNow(),{results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  return {now,rows:results.map(row=>{let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}return {row,x,d:delta(x.std||row.std,now.minutes)}})};
}
function expectedCallsign(z){
  const iata=upper(z.x.airline||z.row.airline),icao=IATA_TO_ICAO[iata],n=flightNo(z.x.flight||z.row.flight_number,iata);
  return icao&&n?`${icao}${n}`:"";
}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}

async function confirm(env){
  if(!env.OPENSKY_CLIENT_ID||!env.OPENSKY_CLIENT_SECRET)return {ok:true,skipped:"OPENSKY_NON_CONFIGURE"};
  const now=parisNow(),authority=await queuedFieldMap(env,"OPENSKY",now.date);
  if(!authority.size){await bump(env,204,{candidates:0,queue:0});return {ok:true,skipped:"OPENSKY_QUEUE_VIDE"}}
  const l=await lane(env);if(ageMs(l.lastAt)<10*60000)return {ok:true,skipped:"OPENSKY_CADENCE"};
  const {rows}=await todayRows(env);
  const candidates=rows.filter(z=>authority.has(z.row.identity)&&z.d<=20&&z.d>=-75&&!isFinal(z.x));
  if(!candidates.length){await bump(env,204,{candidates:0,queue:authority.size});return {ok:true,skipped:"OPENSKY_AUCUN_VOL_QUEUE"}}
  let r;try{r=await states(env)}catch(e){await bump(env,502,{error:clean(e?.message||e),candidates:candidates.length});return {ok:false,status:502,error:clean(e?.message||e)}}
  await bumpUsage(env,r.status);
  if(!r.ok){await bump(env,r.status,{candidates:candidates.length});return {ok:false,status:r.status,error:`OPENSKY_${r.status}`}}
  const j=await r.json().catch(()=>({})),vectors=Array.isArray(j?.states)?j.states:[];
  const byCallsign=new Map();
  for(const s of vectors){const cs=upper(s?.[1]);if(cs)byCallsign.set(cs,s)}
  const at=new Date().toISOString(),changes=[];
  for(const z of candidates){
    const callsign=expectedCallsign(z);if(!callsign)continue;
    const s=byCallsign.get(callsign);if(!s)continue;
    const onGround=Boolean(s?.[8]),baro=Number(s?.[7]),velocity=Number(s?.[9]);
    if(onGround)continue;
    if(Number.isFinite(baro)&&baro<150)continue;
    z.x.openSkyLastSeenAt=at;z.x.openSkyCallsign=callsign;z.x.openSkyIcao24=upper(s?.[0]);z.x.openSkyOnGround=false;
    if(Number.isFinite(baro))z.x.openSkyBaroAltitudeM=baro;
    if(Number.isFinite(velocity))z.x.openSkyVelocityMs=velocity;
    z.x.openSkyAirborneConfirmedAt=z.x.openSkyAirborneConfirmedAt||at;
    z.x.providerStatusRaw="AIRBORNE";
    const old=upper(z.x.status||z.x.opsStatus||z.x.flight_status);
    if(!/ARRIV|CANCEL|ANNUL/.test(old)){
      z.x.status="DÉCOLLÉ";z.x.statusSource="OPENSKY_ADSB";z.x.statusUpdatedAt=at;
    }
    const log=Array.isArray(z.x.flightInfoLog)?z.x.flightInfoLog:[];
    log.unshift({at,source:"OPENSKY_ADSB",field:"status",from:old||"",to:"DÉCOLLÉ",evidence:{callsign,icao24:z.x.openSkyIcao24}});z.x.flightInfoLog=log.slice(0,160);
    await save(env,z.row,z.x);changes.push({flight:upper(z.x.flight||z.row.flight_number),callsign,icao24:z.x.openSkyIcao24,fields:[...(authority.get(z.row.identity)||new Set())]});
  }
  await bump(env,200,{candidates:candidates.length,vectors:vectors.length,confirmed:changes.length,queue:authority.size});
  return {ok:true,candidates:candidates.length,vectors:vectors.length,confirmed:changes.length,changes};
}

export default {
  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      try{await confirm(env)}catch(_){}
      if(typeof liveRecovery.scheduled==="function")await liveRecovery.scheduled(controller,env,ctx);
    })());
  }
};
