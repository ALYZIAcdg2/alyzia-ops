import app from "./provider-safe-backend-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function hm(v){const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null}
function delta(std,now){const n=hm(std);return n==null?99999:n-now}
function flightNumber(v,carrier=""){
  let s=upper(v),c=upper(carrier);
  if(c&&s.startsWith(c))s=s.slice(c.length);
  else s=s.replace(/^[A-Z]{2,3}/,"");
  const m=s.match(/(\d+[A-Z]?)$/);
  return m?m[1]:s;
}
function fullFlight(x,row){
  const carrier=upper(x.airline||row.airline);
  const n=flightNumber(x.flight||row.flight_number,carrier);
  return carrier&&n?carrier+n:upper(x.flight||row.flight_number);
}

async function ensureRuntime(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_runtime(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)`).run();
}
async function getRuntime(env,key){
  try{await ensureRuntime(env);const r=await env.OPS_DB.prepare(`SELECT value,updated_at FROM api_provider_runtime WHERE key=?`).bind(key).first();return r||null}catch{return null}
}
async function setRuntime(env,key,value){
  try{await ensureRuntime(env);await env.OPS_DB.prepare(`INSERT INTO api_provider_runtime(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(key,String(value??"")).run()}catch(_){ }
}

async function adbFetch(env,path){
  if(!env.AERODATABOX||typeof env.AERODATABOX.fetch!=="function")return {ok:false,status:503,error:"AERODATABOX_SERVICE_NON_CONFIGURE"};
  try{
    const r=await env.AERODATABOX.fetch(new Request(`https://aerodatabox.internal${path}`,{headers:{Accept:"application/json"}}));
    const text=await r.text();let payload=null;try{payload=JSON.parse(text)}catch{}
    return {ok:r.ok,status:r.status,payload,text};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}
async function adbUsage(env){
  const r=await adbFetch(env,"/usage");
  return r.ok&&r.payload?.ok?r.payload:null;
}
function mapRow(row){
  return {
    sta:clean(row?.arrival?.sta),
    etd:clean(row?.departure?.etd),
    atd:clean(row?.departure?.atd),
    eta:clean(row?.arrival?.eta),
    ata:clean(row?.arrival?.ata),
    gate:clean(row?.departure?.gate),
    arrivalGate:clean(row?.arrival?.gate),
    terminal:clean(row?.departure?.terminal),
    reg:clean(row?.aircraft?.registration),
    modeS:clean(row?.aircraft?.modeS),
    status:clean(row?.status),
    dataLevel:clean(row?.dataLevel),
    lastUpdatedUtc:clean(row?.lastUpdatedUtc)
  };
}
function chooseFlight(payload,wanted){
  const rows=Array.isArray(payload?.flights)?payload.flights:[];
  if(!rows.length)return null;
  const w=upper(wanted);
  return rows.find(x=>upper(x?.flight)===w)||rows[0];
}
function logField(x,field,value,at){
  const to=clean(value),from=clean(x[field]);
  if(!to||to===from)return false;
  const arr=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];
  arr.unshift({at,source:"AERODATABOX",field,from,to});
  x.flightInfoLog=arr.slice(0,160);
  x[field]=to;x[field+"Source"]="AERODATABOX";x[field+"UpdatedAt"]=at;
  if(field==="etd")x.edt=to;
  return true;
}
async function applyAdb(env,row,x,data){
  const at=new Date().toISOString(),changed=[];
  const fields=[["etd","ETD"],["atd","ATD"],["eta","ETA"],["ata","ATA"],["gate","GATE"],["arrivalGate","ARRIVAL GATE"],["terminal","TERMINAL"],["reg","IMMATRICULATION"],["modeS","MODE-S"],["status","STATUT"]];
  if(!clean(x.sta)&&logField(x,"sta",data.sta,at))changed.push("STA");
  for(const [field,label] of fields)if(logField(x,field,data[field],at))changed.push(label);
  x.aeroDataBoxLastCheckedAt=at;
  x.aeroDataBoxDataLevel=clean(data.dataLevel);
  x.aeroDataBoxLastUpdatedUtc=clean(data.lastUpdatedUtc);
  await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run();
  return changed;
}
async function enrichAdb(env,row,x){
  const flight=fullFlight(x,row),date=clean(x.date||row.flight_date);
  if(!flight||!date)return {ok:false,error:"IDENTITE_INCOMPLETE"};
  const r=await adbFetch(env,`/flight?flight=${encodeURIComponent(flight)}&date=${encodeURIComponent(date)}`);
  const at=new Date().toISOString();
  if(!r.ok||!r.payload?.ok){x.aeroDataBoxLastCheckedAt=at;x.aeroDataBoxLastStatus=r.status;await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run();return {ok:false,status:r.status,error:r.payload?.error||r.payload?.message||r.error||"AERODATABOX_ERROR"}}
  const selected=chooseFlight(r.payload,flight);
  if(!selected)return {ok:false,status:404,error:"VOL_AERODATABOX_INTROUVABLE"};
  const data=mapRow(selected),changed=await applyAdb(env,row,x,data);
  return {ok:true,flight,changed,data,usage:r.payload?.usage||null,cache:r.payload?.cache||null};
}

async function runSafeAdb(env){
  const usage=await adbUsage(env);
  if(!usage)return {ok:false,skipped:"USAGE_INDISPONIBLE"};
  const remaining=Number(usage?.daily?.remaining||0);
  if(remaining<2)return {ok:true,skipped:"QUOTA_JOURNALIER",remaining};

  const last=await getRuntime(env,"adb_auto_last_call");
  const lastMs=Date.parse(clean(last?.value)||clean(last?.updated_at)||0)||0;
  if(lastMs&&Date.now()-lastMs<75*60*1000)return {ok:true,skipped:"CADENCE_75_MIN",remaining,lastAt:new Date(lastMs).toISOString()};

  const now=parisNow();
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  const candidates=[];
  for(const row of results){
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    const d=delta(x.std||row.std,now.minutes);
    if(d>120||d<-360)continue;
    const lastFlight=Date.parse(clean(x.aeroDataBoxLastCheckedAt)||0)||0;
    if(lastFlight&&Date.now()-lastFlight<120*60*1000)continue;
    const missingActual=d<0&&(!clean(x.atd)||!clean(x.ata));
    const missingOps=!clean(x.reg)||!clean(x.gate)||!clean(x.terminal);
    const missingEstimate=d>=0&&(!clean(x.etd)||!clean(x.eta));
    if(!missingActual&&!missingOps&&!missingEstimate)continue;
    const carrier=upper(x.airline||row.airline);
    const priority=missingActual?0:["ENT","TU","A9"].includes(carrier)?1:missingOps?2:3;
    candidates.push({row,x,d,priority});
  }
  candidates.sort((a,b)=>a.priority-b.priority||Math.abs(a.d)-Math.abs(b.d));
  if(!candidates.length)return {ok:true,skipped:"AUCUN_CANDIDAT",remaining};

  const pick=candidates[0];
  await setRuntime(env,"adb_auto_last_call",new Date().toISOString());
  const result=await enrichAdb(env,pick.row,pick.x);
  await setRuntime(env,"adb_auto_last_result",JSON.stringify({at:new Date().toISOString(),identity:pick.row.identity,result:{ok:result.ok,status:result.status||200,changed:result.changed||[],error:result.error||""}}));
  return {ok:true,date:now.date,remainingBefore:remaining,candidates:candidates.length,identity:pick.row.identity,result};
}

export default {
  async fetch(request,env,ctx){return app.fetch(request,env,ctx)},
  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function"){
      try{
        const masked=Object.create(env);
        Object.defineProperty(masked,"AERODATABOX_API_KEY",{value:"",enumerable:true});
        Object.defineProperty(masked,"OAG_API_KEY",{value:"",enumerable:true});
        app.scheduled(controller,masked,ctx);
      }catch(_){ }
    }
    ctx.waitUntil(runSafeAdb(env));
  }
};
