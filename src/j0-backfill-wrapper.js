import app from "./free-provider-prefill-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const s=clean(v);const m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};
const flightNo=(v,carrier="")=>{let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s};
const providerCarrier=v=>{const c=upper(v);return c==="ENT"?"E4":c};
const flightKey=(x,row)=>{const stored=upper(x.airline||row.airline),carrier=providerCarrier(stored),n=flightNo(x.flight||row.flight_number,stored);return carrier&&n?carrier+n:""};

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function delta(std,minutes){const h=hhmm(std);if(!h)return 99999;const [a,b]=h.split(":").map(Number);return a*60+b-minutes}
function isFinal(x){const s=upper(x.status||x.opsStatus||x.flight_status);return /CANCEL|ANNUL/.test(s)||Boolean(clean(x.atd)&&clean(x.ata))}
function needsBackfill(x){return missing(x.atd)||missing(x.ata)||missing(x.reg)||missing(x.gate)}
function priority(z){
  if(missing(z.x.atd))return 0;
  if(missing(z.x.ata))return 1;
  if(missing(z.x.reg)||missing(z.x.gate))return 2;
  return 9;
}
async function ensureUsage(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
}
async function usage(env){
  try{await ensureUsage(env);const now=parisNow(),r=await env.OPS_DB.prepare(`SELECT calls,last_at FROM api_provider_usage WHERE provider='SKYLINK' AND period=?`).bind(now.date.slice(0,7)).first();return {month:Number(r?.calls||0),lastAt:clean(r?.last_at)}}catch{return {month:0,lastAt:""}}
}
async function bump(env,status){
  try{await ensureUsage(env);const now=parisNow(),at=new Date().toISOString();for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('SKYLINK',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run()}catch(_){}
}
function departedStatus(v){return /(DEPARTED|AIRBORNE|EN\s*ROUTE|IN\s*FLIGHT|TOOK\s*OFF|LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function arrivedStatus(v){return /(LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function parse(p){
  const root=p?.data||p?.response||p||{},dep=root?.departure||{},arr=root?.arrival||{},ac=root?.aircraft||{};
  const status=clean(root?.status||root?.flight_status),depLatest=hhmm(dep?.actual_time||dep?.actual||root?.atd),arrActual=hhmm(arr?.actual_time||arr?.actual||root?.ata);
  return {
    sta:hhmm(arr?.scheduled_time||arr?.scheduled||root?.sta),etd:hhmm(dep?.estimated_time||dep?.estimated||root?.etd),
    atd:departedStatus(status)?depLatest:"",eta:hhmm(arr?.estimated_time||arr?.estimated||root?.eta),ata:arrivedStatus(status)?arrActual:"",
    gate:clean(dep?.gate||root?.departure_gate),arrivalGate:clean(arr?.gate||root?.arrival_gate),terminal:clean(dep?.terminal||root?.departure_terminal),arrivalTerminal:clean(arr?.terminal||root?.arrival_terminal),
    reg:clean(ac?.registration||root?.registration||root?.aircraft_registration),aircraft:upper(ac?.icao_type||ac?.type||root?.aircraft_type),status
  };
}
function canRefresh(x,field){if(missing(x[field]))return true;return ["AIRLABS","AIRLABS_ROUTE","SKYLINK","SKYLINK_J0_BACKFILL","OAG_STATUS","OAG_SCHEDULE","AERODATABOX","AERODATABOX_REG","ALYZIA_OPS_STATE"].includes(upper(x[field+"Source"]))}
function apply(x,field,value,at,{refresh=true}={}){
  const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;if(!refresh&&!missing(from))return false;if(refresh&&!canRefresh(x,field))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:"SKYLINK_J0_BACKFILL",field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]="SKYLINK_J0_BACKFILL";x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true;
}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}
async function backfillOne(env){
  if(!env.SKYLINK_API_KEY)return {ok:true,skipped:"SKYLINK_API_KEY_NON_CONFIGURE"};
  const u=await usage(env),limit=Number(env.SKYLINK_MONTHLY_LIMIT||1000),reserve=Number(env.SKYLINK_MONTHLY_RESERVE||220);
  if(u.month>=Math.max(0,limit-reserve))return {ok:true,skipped:"SKYLINK_QUOTA_RESERVE",usage:u};
  if(ageMs(u.lastAt)<30*60000)return {ok:true,skipped:"SKYLINK_GLOBAL_CADENCE",usage:u};
  const now=parisNow(),{results=[]}=await env.OPS_DB.prepare(`SELECT identity,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  const candidates=[];
  for(const row of results){let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}const d=delta(x.std||row.std,now.minutes);if(d>-30||d<-900||isFinal(x)||!needsBackfill(x))continue;if(ageMs(x.j0BackfillLastCheckedAt)<60*60000)continue;candidates.push({row,x,d})}
  candidates.sort((a,b)=>priority(a)-priority(b)||a.d-b.d);const z=candidates[0];if(!z)return {ok:true,skipped:"J0_AUCUN_VOL_INCOMPLET"};
  const flight=flightKey(z.x,z.row);if(!flight)return {ok:false,error:"J0_IDENTITE_INCOMPLETE"};
  const base=clean(env.SKYLINK_BASE_URL)||"https://data.skylinkapi.com/v2",headers={Accept:"application/json","x-api-key":env.SKYLINK_API_KEY};
  let r;try{r=await fetch(`${base.replace(/\/$/,"")}/flight_status/${encodeURIComponent(flight)}`,{headers})}catch(e){await bump(env,502);return {ok:false,status:502,error:String(e?.message||e),flight}}
  await bump(env,r.status);const payload=await r.json().catch(()=>null),at=new Date().toISOString();z.x.j0BackfillLastCheckedAt=at;z.x.j0BackfillLastStatus=r.status;
  if(!r.ok){await save(env,z.row,z.x);return {ok:false,status:r.status,error:`SKYLINK_${r.status}`,flight}}
  const d=parse(payload),changed=[];z.x.providerStatusRaw=d.status||z.x.providerStatusRaw;
  for(const field of ["sta","etd","atd","eta","ata","gate","arrivalGate","terminal","arrivalTerminal","status"]){if(apply(z.x,field,d[field],at,{refresh:field!=="sta"}))changed.push(field)}
  if(apply(z.x,"reg",d.reg,at,{refresh:false}))changed.push("reg");if(d.aircraft&&missing(z.x.aircraft)&&apply(z.x,"aircraft",d.aircraft,at,{refresh:false}))changed.push("aircraft");
  await save(env,z.row,z.x);return {ok:true,flight,priority:priority(z),changed};
}

export default {
  fetch(request,env,ctx){return app.fetch(request,env,ctx)},
  scheduled(controller,env,ctx){ctx.waitUntil((async()=>{try{await backfillOne(env)}catch(_){}if(typeof app.scheduled==="function")await app.scheduled(controller,env,ctx)})())}
};
