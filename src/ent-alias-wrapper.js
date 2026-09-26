import app from "./free-provider-prefill-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const s=clean(v);const m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function flightNo(v){const s=upper(v);const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:""}
function delta(std,minutes){const h=hhmm(std);if(!h)return 99999;const [a,b]=h.split(":").map(Number);return a*60+b-minutes}
function isFinal(x){return /CANCEL/i.test(upper(x.status))||Boolean(clean(x.atd)&&clean(x.ata))}
function canRefresh(x,field){if(missing(x[field]))return true;return ["AIRLABS","AIRLABS_ROUTE","SKYLINK","SKYLINK_ENT_ALIAS","OAG_STATUS","OAG_SCHEDULE","AERODATABOX","AERODATABOX_REG"].includes(upper(x[field+"Source"]))}
function apply(x,field,value,at,{refresh=true}={}){
  const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;
  if(!refresh&&!missing(from))return false;if(refresh&&!canRefresh(x,field))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:"SKYLINK_ENT_ALIAS",field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]="SKYLINK_ENT_ALIAS";x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true;
}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}
async function bump(env,status){
  try{
    const now=parisNow(),at=new Date().toISOString();
    await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('SKYLINK',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run();
  }catch(_){}
}
async function usage(env){
  try{const now=parisNow(),r=await env.OPS_DB.prepare(`SELECT calls,last_at FROM api_provider_usage WHERE provider='SKYLINK' AND period=?`).bind(now.date.slice(0,7)).first();return {month:Number(r?.calls||0),lastAt:clean(r?.last_at)}}catch{return {month:0,lastAt:""}}
}
function parse(p){
  const root=p?.data||p?.response||p||{},dep=root?.departure||{},arr=root?.arrival||{},ac=root?.aircraft||{};
  return {
    sta:hhmm(arr?.scheduled_time||arr?.scheduled||root?.sta),
    etd:hhmm(dep?.estimated_time||dep?.estimated||root?.etd),
    atd:hhmm(dep?.actual_time||dep?.actual||root?.atd),
    eta:hhmm(arr?.estimated_time||arr?.estimated||root?.eta),
    ata:hhmm(arr?.actual_time||arr?.actual||root?.ata),
    gate:clean(dep?.gate||root?.departure_gate),arrivalGate:clean(arr?.gate||root?.arrival_gate),
    terminal:clean(dep?.terminal||root?.departure_terminal),arrivalTerminal:clean(arr?.terminal||root?.arrival_terminal),
    reg:clean(ac?.registration||root?.registration||root?.aircraft_registration),aircraft:upper(ac?.icao_type||ac?.type||root?.aircraft_type),status:clean(root?.status||root?.flight_status)
  };
}
async function fetchAlias(env,alias){
  const base=clean(env.SKYLINK_BASE_URL)||"https://data.skylinkapi.com/v2",headers={Accept:"application/json","x-api-key":env.SKYLINK_API_KEY};
  let r;try{r=await fetch(`${base.replace(/\/$/,"")}/flight_status/${encodeURIComponent(alias)}`,{headers})}catch(e){await bump(env,502);return {ok:false,status:502,error:String(e?.message||e)}}
  await bump(env,r.status);const payload=await r.json().catch(()=>null);return {ok:r.ok,status:r.status,payload};
}
async function enrichOneEnt(env){
  if(!env.SKYLINK_API_KEY)return {ok:true,skipped:"SKYLINK_API_KEY_NON_CONFIGURE"};
  const u=await usage(env),limit=Number(env.SKYLINK_MONTHLY_LIMIT||1000),reserve=Number(env.SKYLINK_MONTHLY_RESERVE||220);
  if(u.month>=Math.max(0,limit-reserve))return {ok:true,skipped:"SKYLINK_QUOTA_RESERVE",usage:u};
  const now=parisNow(),{results=[]}=await env.OPS_DB.prepare(`SELECT identity,airline,flight_number,std,data_json FROM flights WHERE flight_date=? AND UPPER(airline)='ENT' ORDER BY std,flight_number`).bind(now.date).all();
  const candidates=[];
  for(const row of results){let x={};try{x=JSON.parse(row.data_json||"{}")}catch{};const d=delta(x.std||row.std,now.minutes);if(d>720||d<-900||isFinal(x))continue;
    if(!(missing(x.sta)||missing(x.etd)||missing(x.eta)||missing(x.atd)||missing(x.ata)||missing(x.gate)||missing(x.reg)))continue;
    if(ageMs(x.entAliasLastCheckedAt)<45*60000)continue;candidates.push({row,x,d});}
  candidates.sort((a,b)=>Math.abs(a.d)-Math.abs(b.d));const z=candidates[0];if(!z)return {ok:true,skipped:"ENT_AUCUN_VOL_A_COMPLETER"};
  const n=flightNo(z.x.flight||z.row.flight_number);if(!n)return {ok:false,error:"ENT_NUMERO_VOL_MANQUANT"};
  const aliases=[`E4${n}`,`ENT${n}`],at=new Date().toISOString();let found=null,last=null;
  for(const alias of aliases){const r=await fetchAlias(env,alias);last={alias,...r};if(r.ok){const d=parse(r.payload);if(Object.values(d).some(v=>clean(v))){found={alias,data:d,status:r.status};break}}if(![400,404].includes(Number(r.status)))break;}
  z.x.entAliasLastCheckedAt=at;z.x.entAliasLastStatus=Number(found?.status||last?.status||0);z.x.entAliasTried=aliases;
  if(!found){await save(env,z.row,z.x);return {ok:false,status:last?.status||404,flight:`ENT${n}`,tried:aliases,error:"ENT_ALIAS_NOT_FOUND"}}
  const changed=[];for(const field of ["sta","etd","atd","eta","ata","gate","arrivalGate","terminal","arrivalTerminal","status"]){if(apply(z.x,field,found.data[field],at,{refresh:field!=="sta"}))changed.push(field)}
  if(apply(z.x,"reg",found.data.reg,at,{refresh:false}))changed.push("reg");if(found.data.aircraft&&missing(z.x.aircraft)&&apply(z.x,"aircraft",found.data.aircraft,at,{refresh:false}))changed.push("aircraft");
  await save(env,z.row,z.x);return {ok:true,flight:`ENT${n}`,matchedAs:found.alias,changed};
}

export default {
  fetch(request,env,ctx){return app.fetch(request,env,ctx)},
  scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{try{await enrichOneEnt(env)}catch(_){}if(typeof app.scheduled==="function")await app.scheduled(controller,env,ctx)})());
  }
};
