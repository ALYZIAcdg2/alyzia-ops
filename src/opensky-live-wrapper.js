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
  "VF":"TKJ","WB":"RWD",
  // Frequent carriers at CDG that were missing (without them OpenSky could never match the callsign)
  "AF":"AFR","A5":"HOP","BA":"BAW","LH":"DLH","KL":"KLM","IB":"IBE","VY":"VLG","U2":"EZY","FR":"RYR","TP":"TAP",
  "AZ":"ITY","LX":"SWR","OS":"AUA","SN":"BEL","EK":"UAE","QR":"QTR","EY":"ETD","AC":"ACA","DL":"DAL","UA":"UAL",
  "AA":"AAL","TO":"TVF","HV":"TRA","AY":"FIN","HU":"CHH","CA":"CCA","MU":"CES","CZ":"CSN","KE":"KAL","JL":"JAL",
  "WY":"OMA","SV":"SVA","ET":"ETH","LA":"LAN","AV":"AVA","AM":"AMX","PS":"AUI","BT":"BTI","DY":"NOZ","D8":"IBK",
  "W6":"WZZ","EW":"EWG","LG":"LGL","OU":"CTN","RO":"ROT","OK":"CSA","J2":"AHY","KC":"KZR","HY":"UZB","B6":"JBU",
  "WS":"WJA","TS":"TSC","SS":"CRL","XK":"CCM"
};

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function apply(x,field,value,source,at,estimated=true){
  const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source,field,from,to:next,estimated});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;return true;
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

// Failure stage is encoded in the status shown by provider observability:
//   598 = token request (auth.opensky-network.org) timed out / unreachable
//   599 = states request (opensky-network.org/api/states/all) timed out / unreachable
//   401/403/429/5xx = real HTTP status returned by OpenSky
async function token(env){
  const body=new URLSearchParams({grant_type:"client_credentials",client_id:env.OPENSKY_CLIENT_ID,client_secret:env.OPENSKY_CLIENT_SECRET});
  const r=await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body,signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`OPENSKY_AUTH_${r.status}`);
  const j=await r.json();if(!j?.access_token)throw new Error("OPENSKY_AUTH_TOKEN_ABSENT");return j.access_token;
}
let TOKEN_CACHE={t:"",exp:0};
async function cachedToken(env){
  if(TOKEN_CACHE.t&&Date.now()<TOKEN_CACHE.exp)return TOKEN_CACHE.t;
  const t=await token(env);TOKEN_CACHE={t,exp:Date.now()+25*60000};return t;
}
// Registration from the OpenSky aircraft database (icao24 -> registration). Null when unknown/unreachable.
async function registrationFor(env,icao24){
  try{
    const t=await cachedToken(env);
    const r=await fetch(`https://opensky-network.org/api/metadata/aircraft/icao/${encodeURIComponent(clean(icao24).toLowerCase())}`,{headers:{Authorization:`Bearer ${t}`,Accept:"application/json"},signal:AbortSignal.timeout(10000)});
    await bumpUsage(env,r.status);
    if(!r.ok)return {status:r.status,reg:""};
    const j=await r.json().catch(()=>null),reg=upper(j?.registration);
    return {status:r.status,reg:/^[A-Z0-9-]{3,8}$/.test(reg)?reg:""};
  }catch{return {status:0,reg:""}}
}
async function states(env){
  let t;try{t=await cachedToken(env)}catch(e){if(/OPENSKY_AUTH_\d{3}$/.test(String(e?.message||"")))throw e;const err=new Error("OPENSKY_AUTH_598");throw err}
  const q=new URLSearchParams({lamin:"48.70",lamax:"49.20",lomin:"1.95",lomax:"2.85"});
  return fetch(`https://opensky-network.org/api/states/all?${q}`,{headers:{Authorization:`Bearer ${t}`,Accept:"application/json"},signal:AbortSignal.timeout(20000)}).catch(()=>{throw new Error("OPENSKY_STATES_599")});
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
  // Normal window -75..+20 min around STD; widened to -360 min for flights still missing an ATD,
  // so that an airborne aircraft can give an estimated ATD instead of staying "À CONTRÔLER".
  const candidates=rows.filter(z=>authority.has(z.row.identity)&&z.d<=20&&(z.d>=-75||(z.d>=-360&&missing(z.x.atd)&&authority.get(z.row.identity)?.has("atd")))&&!isFinal(z.x));
  // REG lookup: flights (up to 6h after STD, 3h before) whose queue entry asks for REG; each flight tried at most twice, 6h apart.
  const regCandidates=rows.filter(z=>authority.get(z.row.identity)?.has("reg")&&missing(z.x.reg)&&z.d<=180&&z.d>=-360&&!isFinal(z.x)&&Number(z.x.openSkyRegAttempts||0)<2&&ageMs(z.x.openSkyRegCheckedAt)>=6*3600000&&expectedCallsign(z));
  if(!candidates.length&&!regCandidates.length){await bump(env,204,{candidates:0,queue:authority.size});return {ok:true,skipped:"OPENSKY_AUCUN_VOL_QUEUE"}}
  let r;try{r=await states(env)}catch(e){
    // Surface auth/network failures in the usage table (provider observability) with the real HTTP code when known.
    const code=Number(String(e?.message||"").match(/_(\d{3})$/)?.[1])||502;
    await bumpUsage(env,code);await bump(env,code,{error:clean(e?.message||e),candidates:candidates.length});return {ok:false,status:code,error:clean(e?.message||e)};
  }
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
    // Estimated ATD: aircraft is airborne but no provider gave an ATD yet. Use ETD (else STD), never later than now.
    // Source stays OPENSKY_ADSB, so real providers (OAG/AirLabs/SkyLink/AeroDataBox) overwrite it when they answer.
    if(missing(z.x.atd)&&authority.get(z.row.identity)?.has("atd")){
      const base=hhmm(z.x.etd)||hhmm(z.x.std)||hhmm(z.row.std);
      if(base){
        const [h,m]=base.split(":").map(Number),est=Math.min(h*60+m,now.minutes);
        apply(z.x,"atd",String(Math.floor(est/60)).padStart(2,"0")+":"+String(est%60).padStart(2,"0"),"OPENSKY_ADSB",at);
      }
    }
    await save(env,z.row,z.x);changes.push({flight:upper(z.x.flight||z.row.flight_number),callsign,icao24:z.x.openSkyIcao24,fields:[...(authority.get(z.row.identity)||new Set())]});
  }
  // Registration: aircraft seen with the expected callsign (on the ground or airborne) -> icao24 -> registration. Max 3 lookups per run.
  let regLookups=0;const regChanges=[];
  for(const z of regCandidates){
    if(regLookups>=3)break;
    const s=byCallsign.get(expectedCallsign(z));if(!s)continue;
    const icao24=upper(s?.[0]);if(!icao24)continue;
    regLookups++;
    const res=await registrationFor(env,icao24);
    z.x.openSkyIcao24=icao24;z.x.openSkyRegCheckedAt=at;z.x.openSkyRegAttempts=Number(z.x.openSkyRegAttempts||0)+1;
    if(res.reg&&missing(z.x.reg)&&apply(z.x,"reg",res.reg,"OPENSKY_ADSB",at,false))regChanges.push({flight:upper(z.x.flight||z.row.flight_number),reg:res.reg});
    await save(env,z.row,z.x);
  }
  await bump(env,200,{candidates:candidates.length,regCandidates:regCandidates.length,regLookups,regFilled:regChanges.length,vectors:vectors.length,confirmed:changes.length,queue:authority.size});
  return {ok:true,candidates:candidates.length,vectors:vectors.length,confirmed:changes.length,changes,regChanges};
}

export default {
  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      try{await confirm(env)}catch(_){}
      if(typeof liveRecovery.scheduled==="function")await liveRecovery.scheduled(controller,env,ctx);
    })());
  }
};
