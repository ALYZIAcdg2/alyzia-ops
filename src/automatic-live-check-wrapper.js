import app from "./free-provider-prefill-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const s=clean(v),m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute),hour:Number(m.hour)};
}
function delta(v,minutes){const h=hhmm(v);if(!h)return 99999;const [a,b]=h.split(":").map(Number);return a*60+b-minutes}
function providerCarrier(v){const c=upper(v);return c==="ENT"?"E4":c}
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function flightKey(x,row){const stored=upper(x.airline||row.airline),carrier=providerCarrier(stored),n=flightNo(x.flight||row.flight_number,stored);return carrier&&n?carrier+n:""}
function isFinal(x){const s=upper(x.status||x.opsStatus||x.flight_status);return /CANCEL|ANNUL/.test(s)||Boolean(clean(x.atd)&&clean(x.ata))}
function needsLive(z){const x=z.x;return !isFinal(x)&&(missing(x.atd)||missing(x.ata)||missing(x.etd)||missing(x.eta)||missing(x.gate)||missing(x.reg))}
function priority(z){
  if(z.d<=0&&missing(z.x.atd))return 0;
  if(z.d<=120&&z.d>=-180&&(missing(z.x.gate)||missing(z.x.reg)||missing(z.x.etd)))return 1;
  if(z.d<-30&&missing(z.x.ata))return 2;
  if(missing(z.x.eta))return 3;
  return 4;
}
function departedStatus(v){return /(DEPARTED|AIRBORNE|EN\s*ROUTE|IN\s*FLIGHT|TOOK\s*OFF|LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function arrivedStatus(v){return /(LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function canRefresh(x,field){
  if(missing(x[field]))return true;
  const s=upper(x[field+"Source"]);
  return ["AIRLABS","AIRLABS_AUTO_LIVE","AIRLABS_ROUTE","SKYLINK","SKYLINK_AUTO_LIVE","SKYLINK_J0_BACKFILL","SKYLINK_ENT_ALIAS","OAG_STATUS","OAG_SCHEDULE","AERODATABOX","AERODATABOX_REG","ALYZIA_OPS_STATE"].includes(s);
}
function apply(x,field,value,source,at,{refresh=true}={}){
  const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;
  if(!refresh&&!missing(from))return false;if(refresh&&!canRefresh(x,field))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true;
}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}

async function ensureTables(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS provider_runtime_state(state_key TEXT PRIMARY KEY,last_at TEXT,last_status INTEGER,details_json TEXT)`).run();
}
async function usage(env,provider){
  try{await ensureTables(env);const now=parisNow(),r=await env.OPS_DB.prepare(`SELECT calls,last_status,last_at FROM api_provider_usage WHERE provider=? AND period=?`).bind(provider,now.date.slice(0,7)).first();return {month:Number(r?.calls||0),lastStatus:Number(r?.last_status||0),lastAt:clean(r?.last_at)}}catch{return {month:0,lastStatus:0,lastAt:""}}
}
async function bump(env,provider,status){
  try{await ensureTables(env);const now=parisNow(),at=new Date().toISOString();for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(provider,period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run()}catch(_){}
}
async function state(env,key){try{await ensureTables(env);return await env.OPS_DB.prepare(`SELECT last_at,last_status,details_json FROM provider_runtime_state WHERE state_key=?`).bind(key).first()||{}}catch{return {}}}
async function setState(env,key,status,details={}){try{await ensureTables(env);const at=new Date().toISOString();await env.OPS_DB.prepare(`INSERT INTO provider_runtime_state(state_key,last_at,last_status,details_json) VALUES(?,?,?,?) ON CONFLICT(state_key) DO UPDATE SET last_at=excluded.last_at,last_status=excluded.last_status,details_json=excluded.details_json`).bind(key,at,status,JSON.stringify(details)).run()}catch(_){}}
async function todayRows(env){
  const now=parisNow(),{results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  return {now,rows:results.map(row=>{let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}return {row,x,d:delta(x.std||row.std,now.minutes)}})};
}
function airlabsCadence(rows,now){
  if(rows.some(z=>needsLive(z)&&z.d<=120&&z.d>=-180))return 30;
  if(rows.some(z=>needsLive(z)&&z.d<=360&&z.d>=-360))return 60;
  return now.hour<5?240:120;
}
function skylinkCadence(rows){
  if(rows.some(z=>needsLive(z)&&z.d<=90&&z.d>=-240))return 45;
  if(rows.some(z=>needsLive(z)&&z.d<=240&&z.d>=-480))return 90;
  return 180;
}
function airlabsRows(p){return Array.isArray(p)?p:Array.isArray(p?.response)?p.response:Array.isArray(p?.data)?p.data:[]}
function parseAirlabs(r){return {
  sta:hhmm(r?.arr_time),etd:hhmm(r?.dep_estimated),atd:hhmm(r?.dep_actual),eta:hhmm(r?.arr_estimated),ata:hhmm(r?.arr_actual),
  gate:clean(r?.dep_gate),arrivalGate:clean(r?.arr_gate),terminal:clean(r?.dep_terminal),arrivalTerminal:clean(r?.arr_terminal),
  reg:clean(r?.reg_number),aircraft:upper(r?.aircraft_icao),status:clean(r?.status)
}}
async function autoAirlabs(env,rows,now){
  if(!env.AIRLABS_API_KEY)return {ok:true,skipped:"NO_KEY"};
  const active=rows.filter(z=>z.d<=720&&z.d>=-900&&needsLive(z));if(!active.length)return {ok:true,skipped:"NO_ACTIVE"};
  const u=await usage(env,"AIRLABS"),cap=Number(env.AIRLABS_MONTHLY_LIMIT||1000),reserve=Number(env.AIRLABS_MONTHLY_RESERVE||180),cadence=airlabsCadence(active,now),st=await state(env,"AIRLABS_AUTO_LIVE");
  if(u.month>=Math.max(0,cap-reserve))return {ok:true,skipped:"QUOTA",usage:u};
  if(ageMs(st.last_at)<cadence*60000)return {ok:true,skipped:"CADENCE",cadence,lastAt:st.last_at};
  const wanted=new Map(active.map(z=>[flightKey(z.x,z.row),z])),fields="airline_iata,flight_iata,flight_number,dep_iata,dep_terminal,dep_gate,dep_time,dep_estimated,dep_actual,arr_iata,arr_terminal,arr_gate,arr_time,arr_estimated,arr_actual,status,reg_number,aircraft_icao",all=[];let calls=0,lastStatus=0;
  for(let page=0;page<2;page++){
    if(u.month+calls>=Math.max(0,cap-reserve))break;
    const q=new URLSearchParams({dep_iata:"CDG",api_key:env.AIRLABS_API_KEY,limit:"50",offset:String(page*50),_fields:fields});
    let r;try{r=await fetch(`https://airlabs.co/api/v9/schedules?${q}`,{headers:{Accept:"application/json"}})}catch(e){await bump(env,"AIRLABS",502);await setState(env,"AIRLABS_AUTO_LIVE",502,{error:String(e?.message||e)});return {ok:false,status:502}}
    calls++;lastStatus=r.status;await bump(env,"AIRLABS",r.status);const p=await r.json().catch(()=>null);if(!r.ok){await setState(env,"AIRLABS_AUTO_LIVE",r.status,{calls});return {ok:false,status:r.status,calls}}
    const list=airlabsRows(p);all.push(...list);if(list.length<50)break;if(page===0)await sleep(200);
  }
  const at=new Date().toISOString(),changes=[];
  for(const r of all){const key=upper(r?.flight_iata||`${r?.airline_iata||""}${r?.flight_number||""}`),z=wanted.get(key);if(!z)continue;const dest=upper(z.x.destination||z.x.dest),apiDest=upper(r?.arr_iata);if(dest&&apiDest&&dest!==apiDest)continue;const d=parseAirlabs(r),changed=[];
    for(const [field,refresh] of [["sta",false],["etd",true],["atd",true],["eta",true],["ata",true],["gate",true],["arrivalGate",true],["terminal",true],["arrivalTerminal",true],["status",true],["reg",false]])if(apply(z.x,field,d[field],"AIRLABS_AUTO_LIVE",at,{refresh}))changed.push(field);
    if(d.aircraft&&missing(z.x.aircraft)&&apply(z.x,"aircraft",d.aircraft,"AIRLABS_AUTO_LIVE",at,{refresh:false}))changed.push("aircraft");
    z.x.airlabsAutoLastCheckedAt=at;z.x.airlabsAutoLastStatus=lastStatus;if(changed.length){await save(env,z.row,z.x);changes.push({flight:key,changed})}
  }
  await setState(env,"AIRLABS_AUTO_LIVE",lastStatus,{calls,matched:changes.length});return {ok:true,calls,matched:changes.length,changes,cadence};
}
function parseSkylink(p){const root=p?.data||p?.response||p||{},dep=root?.departure||{},arr=root?.arrival||{},ac=root?.aircraft||{},status=clean(root?.status||root?.flight_status),depLatest=hhmm(dep?.actual_time||dep?.actual||root?.atd),arrActual=hhmm(arr?.actual_time||arr?.actual||root?.ata);return {
  sta:hhmm(arr?.scheduled_time||arr?.scheduled||root?.sta),etd:hhmm(dep?.estimated_time||dep?.estimated||root?.etd)||(!departedStatus(status)?depLatest:""),atd:departedStatus(status)?depLatest:"",eta:hhmm(arr?.estimated_time||arr?.estimated||root?.eta),ata:arrivedStatus(status)?arrActual:"",
  gate:clean(dep?.gate||root?.departure_gate),arrivalGate:clean(arr?.gate||root?.arrival_gate),terminal:clean(dep?.terminal||root?.departure_terminal),arrivalTerminal:clean(arr?.terminal||root?.arrival_terminal),reg:clean(ac?.registration||root?.registration||root?.aircraft_registration),aircraft:upper(ac?.icao_type||ac?.type||root?.aircraft_type),status
}}
async function autoSkylink(env,rows){
  if(!env.SKYLINK_API_KEY)return {ok:true,skipped:"NO_KEY"};
  const candidates=rows.filter(z=>z.d<=180&&z.d>=-720&&needsLive(z)).sort((a,b)=>priority(a)-priority(b)||Math.abs(a.d)-Math.abs(b.d));if(!candidates.length)return {ok:true,skipped:"NO_CANDIDATE"};
  const u=await usage(env,"SKYLINK"),cap=Number(env.SKYLINK_MONTHLY_LIMIT||1000),reserve=Number(env.SKYLINK_MONTHLY_RESERVE||220),cadence=skylinkCadence(candidates),st=await state(env,"SKYLINK_AUTO_LIVE");
  if(u.month>=Math.max(0,cap-reserve))return {ok:true,skipped:"QUOTA",usage:u};
  if(ageMs(st.last_at)<cadence*60000)return {ok:true,skipped:"CADENCE",cadence,lastAt:st.last_at};
  const z=candidates[0],flight=flightKey(z.x,z.row);if(!flight)return {ok:false,error:"IDENTITY"};
  const base=clean(env.SKYLINK_BASE_URL)||"https://data.skylinkapi.com/v2",headers={Accept:"application/json","x-api-key":env.SKYLINK_API_KEY};
  let r;try{r=await fetch(`${base.replace(/\/$/,"")}/flight_status/${encodeURIComponent(flight)}`,{headers})}catch(e){await bump(env,"SKYLINK",502);await setState(env,"SKYLINK_AUTO_LIVE",502,{flight});return {ok:false,status:502,flight}}
  await bump(env,"SKYLINK",r.status);const p=await r.json().catch(()=>null),at=new Date().toISOString();z.x.skylinkAutoLastCheckedAt=at;z.x.skylinkAutoLastStatus=r.status;
  if(!r.ok){await save(env,z.row,z.x);await setState(env,"SKYLINK_AUTO_LIVE",r.status,{flight});return {ok:false,status:r.status,flight}}
  const d=parseSkylink(p),changed=[];z.x.providerStatusRaw=d.status||z.x.providerStatusRaw;
  for(const [field,refresh] of [["sta",false],["etd",true],["atd",true],["eta",true],["ata",true],["gate",true],["arrivalGate",true],["terminal",true],["arrivalTerminal",true],["status",true],["reg",false]])if(apply(z.x,field,d[field],"SKYLINK_AUTO_LIVE",at,{refresh}))changed.push(field);
  if(d.aircraft&&missing(z.x.aircraft)&&apply(z.x,"aircraft",d.aircraft,"SKYLINK_AUTO_LIVE",at,{refresh:false}))changed.push("aircraft");
  await save(env,z.row,z.x);await setState(env,"SKYLINK_AUTO_LIVE",r.status,{flight,changed});return {ok:true,flight,changed,cadence};
}
async function runAuto(env){
  const {now,rows}=await todayRows(env);
  const airlabs=await autoAirlabs(env,rows,now);
  const fresh=(await todayRows(env)).rows;
  const skylink=await autoSkylink(env,fresh);
  return {ok:true,date:now.date,airlabs,skylink};
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/providers/auto-live/status"){
      const [airlabs,skylink]=await Promise.all([state(env,"AIRLABS_AUTO_LIVE"),state(env,"SKYLINK_AUTO_LIVE")]);
      return new Response(JSON.stringify({ok:true,airlabs,skylink}),{headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){ctx.waitUntil((async()=>{try{await runAuto(env)}catch(_){}if(typeof app.scheduled==="function")await app.scheduled(controller,env,ctx)})())}
};
