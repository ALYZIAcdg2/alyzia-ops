const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const s=clean(v),m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function delta(v,minutes){const h=hhmm(v);if(!h)return 99999;const [a,b]=h.split(":").map(Number);return a*60+b-minutes}
function providerCarrier(v){const c=upper(v);return c==="ENT"?"E4":c}
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function flightKey(x,row){const stored=upper(x.airline||row.airline),carrier=providerCarrier(stored),n=flightNo(x.flight||row.flight_number,stored);return carrier&&n?carrier+n:""}
function isFinal(x){const s=upper(x.status||x.opsStatus||x.flight_status);return /CANCEL|ANNUL/.test(s)||Boolean(clean(x.atd)&&clean(x.ata))}
function needsLive(z){const x=z.x;return !isFinal(x)&&(missing(x.atd)||missing(x.ata)||missing(x.etd)||missing(x.eta)||missing(x.gate)||missing(x.reg))}
function departed(v){return /(DEPARTED|AIRBORNE|EN\s*ROUTE|IN\s*FLIGHT|TOOK\s*OFF|LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function arrived(v){return /(LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function canRefresh(x,field){if(missing(x[field]))return true;return ["AIRLABS","AIRLABS_AUTO_LIVE","AIRLABS_ROUTE","SKYLINK","SKYLINK_AUTO_LIVE","SKYLINK_J0_BACKFILL","SKYLINK_ENT_ALIAS","OAG_STATUS","OAG_SCHEDULE","AERODATABOX","AERODATABOX_REG","ALYZIA_OPS_STATE"].includes(upper(x[field+"Source"]))}
function apply(x,field,value,source,at,{refresh=true}={}){
  const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;if(!refresh&&!missing(from))return false;if(refresh&&!canRefresh(x,field))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true;
}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}
async function ensureTables(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS provider_runtime_state(state_key TEXT PRIMARY KEY,last_at TEXT,last_status INTEGER,details_json TEXT)`).run();
}
async function usage(env,provider){try{await ensureTables(env);const n=parisNow(),r=await env.OPS_DB.prepare(`SELECT calls FROM api_provider_usage WHERE provider=? AND period=?`).bind(provider,n.date.slice(0,7)).first();return Number(r?.calls||0)}catch{return 0}}
async function bump(env,provider,status){try{await ensureTables(env);const n=parisNow(),at=new Date().toISOString();for(const period of [n.date.slice(0,7),n.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(provider,period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run()}catch(_){}}
async function state(env,key){try{await ensureTables(env);return await env.OPS_DB.prepare(`SELECT last_at FROM provider_runtime_state WHERE state_key=?`).bind(key).first()||{}}catch{return {}}}
async function setState(env,key,status,details={}){try{await ensureTables(env);await env.OPS_DB.prepare(`INSERT INTO provider_runtime_state(state_key,last_at,last_status,details_json) VALUES(?,?,?,?) ON CONFLICT(state_key) DO UPDATE SET last_at=excluded.last_at,last_status=excluded.last_status,details_json=excluded.details_json`).bind(key,new Date().toISOString(),status,JSON.stringify(details)).run()}catch(_){}}
async function rowsToday(env){const n=parisNow(),{results=[]}=await env.OPS_DB.prepare(`SELECT identity,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(n.date).all();return {now:n,rows:results.map(row=>{let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}return {row,x,d:delta(x.std||row.std,n.minutes)}})}}
function airCadence(rows){return rows.some(z=>needsLive(z)&&z.d<=120&&z.d>=-180)?30:60}
function skyCadence(rows){return rows.some(z=>needsLive(z)&&z.d<=90&&z.d>=-240)?45:90}
function airRows(p){return Array.isArray(p)?p:Array.isArray(p?.response)?p.response:Array.isArray(p?.data)?p.data:[]}
async function runAirlabs(env,rows){
  if(!env.AIRLABS_API_KEY)return;
  const active=rows.filter(z=>z.d<=180&&z.d>=-720&&needsLive(z));if(!active.length)return;
  const used=await usage(env,"AIRLABS"),cap=Number(env.AIRLABS_MONTHLY_LIMIT||1000),reserve=Number(env.AIRLABS_MONTHLY_RESERVE||180),cadence=airCadence(active),st=await state(env,"AIRLABS_AUTO_LIVE");
  if(used>=Math.max(0,cap-reserve)||ageMs(st.last_at)<cadence*60000)return;
  const wanted=new Map(active.map(z=>[flightKey(z.x,z.row),z])),fields="airline_iata,flight_iata,flight_number,dep_iata,dep_terminal,dep_gate,dep_time,dep_estimated,dep_actual,arr_iata,arr_terminal,arr_gate,arr_time,arr_estimated,arr_actual,status,reg_number,aircraft_icao";
  const q=new URLSearchParams({dep_iata:"CDG",api_key:env.AIRLABS_API_KEY,limit:"100",_fields:fields});let r;
  try{r=await fetch(`https://airlabs.co/api/v9/schedules?${q}`,{headers:{Accept:"application/json"}})}catch{await bump(env,"AIRLABS",502);await setState(env,"AIRLABS_AUTO_LIVE",502);return}
  await bump(env,"AIRLABS",r.status);const p=await r.json().catch(()=>null),at=new Date().toISOString(),changedFlights=[];
  if(r.ok)for(const a of airRows(p)){const key=upper(a?.flight_iata||`${a?.airline_iata||""}${a?.flight_number||""}`),z=wanted.get(key);if(!z)continue;const dest=upper(z.x.destination||z.x.dest),apiDest=upper(a?.arr_iata);if(dest&&apiDest&&dest!==apiDest)continue;const d={sta:hhmm(a?.arr_time),etd:hhmm(a?.dep_estimated),atd:hhmm(a?.dep_actual),eta:hhmm(a?.arr_estimated),ata:hhmm(a?.arr_actual),gate:clean(a?.dep_gate),arrivalGate:clean(a?.arr_gate),terminal:clean(a?.dep_terminal),arrivalTerminal:clean(a?.arr_terminal),reg:clean(a?.reg_number),aircraft:upper(a?.aircraft_icao),status:clean(a?.status)},changed=[];
    for(const [f,refresh] of [["sta",false],["etd",true],["atd",true],["eta",true],["ata",true],["gate",true],["arrivalGate",true],["terminal",true],["arrivalTerminal",true],["status",true],["reg",false]])if(apply(z.x,f,d[f],"AIRLABS_AUTO_LIVE",at,{refresh}))changed.push(f);
    if(d.aircraft&&missing(z.x.aircraft)&&apply(z.x,"aircraft",d.aircraft,"AIRLABS_AUTO_LIVE",at,{refresh:false}))changed.push("aircraft");if(changed.length){await save(env,z.row,z.x);changedFlights.push(key)}}
  await setState(env,"AIRLABS_AUTO_LIVE",r.status,{matched:changedFlights.length});
}
function score(z){if(z.d<=0&&missing(z.x.atd))return 0;if(z.d<=120&&z.d>=-180&&(missing(z.x.gate)||missing(z.x.reg)||missing(z.x.etd)))return 1;if(z.d<-30&&missing(z.x.ata))return 2;return 3}
async function runSkylink(env,rows){
  if(!env.SKYLINK_API_KEY)return;
  const c=rows.filter(z=>z.d<=180&&z.d>=-720&&needsLive(z)).sort((a,b)=>score(a)-score(b)||Math.abs(a.d)-Math.abs(b.d));if(!c.length)return;
  const used=await usage(env,"SKYLINK"),cap=Number(env.SKYLINK_MONTHLY_LIMIT||1000),reserve=Number(env.SKYLINK_MONTHLY_RESERVE||220),cadence=skyCadence(c),st=await state(env,"SKYLINK_AUTO_LIVE");
  if(used>=Math.max(0,cap-reserve)||ageMs(st.last_at)<cadence*60000)return;
  const z=c[0],flight=flightKey(z.x,z.row);if(!flight)return;const base=clean(env.SKYLINK_BASE_URL)||"https://data.skylinkapi.com/v2",headers={Accept:"application/json","x-api-key":env.SKYLINK_API_KEY};let r;
  try{r=await fetch(`${base.replace(/\/$/,"")}/flight_status/${encodeURIComponent(flight)}`,{headers})}catch{await bump(env,"SKYLINK",502);await setState(env,"SKYLINK_AUTO_LIVE",502,{flight});return}
  await bump(env,"SKYLINK",r.status);const p=await r.json().catch(()=>null),root=p?.data||p?.response||p||{},dep=root?.departure||{},arr=root?.arrival||{},ac=root?.aircraft||{},status=clean(root?.status||root?.flight_status),depLatest=hhmm(dep?.actual_time||dep?.actual||root?.atd),arrActual=hhmm(arr?.actual_time||arr?.actual||root?.ata),d={sta:hhmm(arr?.scheduled_time||arr?.scheduled||root?.sta),etd:hhmm(dep?.estimated_time||dep?.estimated||root?.etd)||(!departed(status)?depLatest:""),atd:departed(status)?depLatest:"",eta:hhmm(arr?.estimated_time||arr?.estimated||root?.eta),ata:arrived(status)?arrActual:"",gate:clean(dep?.gate||root?.departure_gate),arrivalGate:clean(arr?.gate||root?.arrival_gate),terminal:clean(dep?.terminal||root?.departure_terminal),arrivalTerminal:clean(arr?.terminal||root?.arrival_terminal),reg:clean(ac?.registration||root?.registration||root?.aircraft_registration),aircraft:upper(ac?.icao_type||ac?.type||root?.aircraft_type),status},at=new Date().toISOString(),changed=[];
  if(r.ok){for(const [f,refresh] of [["sta",false],["etd",true],["atd",true],["eta",true],["ata",true],["gate",true],["arrivalGate",true],["terminal",true],["arrivalTerminal",true],["status",true],["reg",false]])if(apply(z.x,f,d[f],"SKYLINK_AUTO_LIVE",at,{refresh}))changed.push(f);if(d.aircraft&&missing(z.x.aircraft)&&apply(z.x,"aircraft",d.aircraft,"SKYLINK_AUTO_LIVE",at,{refresh:false}))changed.push("aircraft");z.x.providerStatusRaw=d.status||z.x.providerStatusRaw;await save(env,z.row,z.x)}
  await setState(env,"SKYLINK_AUTO_LIVE",r.status,{flight,changed});
}
async function runAuto(env){const {rows}=await rowsToday(env);await runAirlabs(env,rows);const fresh=(await rowsToday(env)).rows;await runSkylink(env,fresh)}

export default {
  scheduled(controller,env,ctx){ctx.waitUntil(runAuto(env).catch(()=>{}))}
};
