import {queuedFieldMap} from "./provider-queue-authority.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function hm(v){const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null}
function delta(std,now){const n=hm(std);return n==null?99999:n-now}
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function fullFlight(x,row){const carrier=upper(x.airline||row.airline),n=flightNo(x.flight||row.flight_number,carrier);return carrier&&n?carrier+n:upper(x.flight||row.flight_number)}
async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function bumpUsage(env,status){try{await ensureUsage(env);const now=parisNow(),at=new Date().toISOString();for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('AERODATABOX',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run()}catch(_){}}
async function adbFetch(env,path,{count=false}={}){if(!env.AERODATABOX||typeof env.AERODATABOX.fetch!=="function")return {ok:false,status:503,error:"AERODATABOX_SERVICE_NON_CONFIGURE"};try{const r=await env.AERODATABOX.fetch(new Request(`https://aerodatabox.internal${path}`,{headers:{Accept:"application/json"}}));if(count)await bumpUsage(env,r.status);const text=await r.text();let payload=null;try{payload=JSON.parse(text)}catch{}return {ok:r.ok,status:r.status,payload}}catch(e){if(count)await bumpUsage(env,502);return {ok:false,status:502,error:String(e?.message||e)}}}
function choose(payload,wanted){const rows=Array.isArray(payload?.flights)?payload.flights:[];return rows.find(r=>upper(r?.flight)===upper(wanted))||rows[0]||null}
function dataOf(r){return {std:clean(r?.departure?.std),sta:clean(r?.arrival?.sta),etd:clean(r?.departure?.etd),eta:clean(r?.arrival?.eta),atd:clean(r?.departure?.atd),ata:clean(r?.arrival?.ata),gate:clean(r?.departure?.gate),reg:clean(r?.aircraft?.registration),modeS:clean(r?.aircraft?.modeS)}}
function setField(x,field,value,at){const next=clean(value),from=clean(x[field]);if(!next||from===next)return false;const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:"AERODATABOX",field,from,to:next});x.flightInfoLog=log.slice(0,160);x[field]=next;x[field+"Source"]="AERODATABOX";x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true}

export async function runAeroDataBoxQueue(env){
  const now=parisNow(),authority=await queuedFieldMap(env,"AERODATABOX",now.date);
  if(!authority.size)return {ok:true,skipped:"AERODATABOX_QUEUE_VIDE"};
  const usage=await adbFetch(env,"/usage");
  const remaining=Number(usage?.payload?.daily?.remaining||0);
  if(!usage.ok||remaining<2)return {ok:true,skipped:"AERODATABOX_QUOTA",remaining};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  const candidates=[];
  for(const row of results){const allowed=authority.get(row.identity);if(!allowed?.size)continue;let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}const d=delta(x.std||row.std,now.minutes);if(d>120||d<-1080)continue;if(![...allowed].some(f=>!clean(x[f])))continue;const last=Date.parse(clean(x.aeroDataBoxLastCheckedAt)||0)||0;if(last&&Date.now()-last<120*60000)continue;candidates.push({row,x,d,allowed})}
  candidates.sort((a,b)=>Math.abs(a.d)-Math.abs(b.d));
  const z=candidates[0];if(!z)return {ok:true,skipped:"AERODATABOX_AUCUN_CANDIDAT_QUEUE",remaining};
  const flight=fullFlight(z.x,z.row),date=z.row.flight_date;if(!flight)return {ok:false,error:"IDENTITE_INCOMPLETE"};
  const r=await adbFetch(env,`/flight?flight=${encodeURIComponent(flight)}&date=${encodeURIComponent(date)}`,{count:true}),at=new Date().toISOString();z.x.aeroDataBoxLastCheckedAt=at;z.x.aeroDataBoxLastStatus=r.status;
  if(!r.ok||!r.payload?.ok){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();return {ok:false,status:r.status,error:r.payload?.error||r.error||"AERODATABOX_ERROR"}}
  const selected=choose(r.payload,flight);if(!selected)return {ok:false,status:404,error:"VOL_AERODATABOX_INTROUVABLE"};
  const data=dataOf(selected),changed=[];for(const f of ["std","sta","etd","eta","atd","ata","gate","reg"])if(z.allowed.has(f)&&setField(z.x,f,data[f],at))changed.push(f);if(z.allowed.has("reg")&&setField(z.x,"modeS",data.modeS,at))changed.push("modeS");
  await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
  return {ok:true,identity:z.row.identity,flight,fields:[...z.allowed],changed,remainingBefore:remaining};
}
