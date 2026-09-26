import app from "./provider-safe-backend-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const s=clean(v);const m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};
const providerCarrier=v=>{const c=upper(v);return c==="ENT"?"E4":c};
const flightNo=(v,carrier="")=>{let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s};
const flightKey=(x,row)=>{const stored=upper(x.airline||row.airline),carrier=providerCarrier(stored),n=flightNo(x.flight||row.flight_number,stored);return carrier&&n?carrier+n:""};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function delta(v,minutes){const h=hhmm(v);if(!h)return 99999;const [a,b]=h.split(":").map(Number);return a*60+b-minutes}
function isFinal(x){return /CANCEL/i.test(upper(x.status))||Boolean(clean(x.atd)&&clean(x.ata))}
function arrivalDate(v){const s=clean(v);const m=s.match(/^(\d{4}-\d{2}-\d{2})[ T]/);return m?m[1]:""}
function sourceCanRefresh(x,field){
  if(missing(x[field]))return true;
  const s=upper(x[field+"Source"]);
  return ["AIRLABS","SKYLINK","OAG_STATUS","OAG_SCHEDULE","AERODATABOX","AERODATABOX_REG"].includes(s);
}
function apply(x,field,value,source,at,{refresh=false}={}){
  const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;
  if(!refresh&&!missing(from))return false;
  if(refresh&&!sourceCanRefresh(x,field))return false;
  const a=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];a.unshift({at,source,field,from,to:next});x.flightInfoLog=a.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true;
}
async function saveRow(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}

async function ensureUsage(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
}
async function bump(env,provider,status){
  try{
    await ensureUsage(env);const now=parisNow(),at=new Date().toISOString();
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(provider,period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run();
  }catch(_){}
}
async function providerUsage(env,provider){
  try{
    await ensureUsage(env);const now=parisNow(),month=now.date.slice(0,7);
    const {results=[]}=await env.OPS_DB.prepare(`SELECT period,calls,last_status,last_at FROM api_provider_usage WHERE provider=? AND period IN (?,?)`).bind(provider,month,now.date).all();
    const day=results.find(x=>x.period===now.date)||{},mon=results.find(x=>x.period===month)||{};
    return {day:Number(day.calls||0),month:Number(mon.calls||0),lastStatus:Number(day.last_status||mon.last_status||0),lastAt:clean(day.last_at||mon.last_at)};
  }catch{return {day:0,month:0,lastStatus:0,lastAt:""}}
}
async function todayRows(env){
  const now=parisNow();const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  return {now,rows:results.map(row=>{let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}return {row,x,d:delta(x.std||row.std,now.minutes)}})};
}

function airlabsRows(payload){
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.response))return payload.response;
  if(Array.isArray(payload?.data))return payload.data;
  return [];
}
function parseAirlabs(r){return {
  sta:hhmm(r?.arr_time),etd:hhmm(r?.dep_estimated),atd:hhmm(r?.dep_actual),eta:hhmm(r?.arr_estimated),ata:hhmm(r?.arr_actual),
  gate:clean(r?.dep_gate),arrivalGate:clean(r?.arr_gate),terminal:clean(r?.dep_terminal),arrivalTerminal:clean(r?.arr_terminal),
  reg:clean(r?.reg_number),aircraft:upper(r?.aircraft_icao),status:clean(r?.status),staArrivalDate:arrivalDate(r?.arr_time)
}}
async function runAirlabs(env,baseRows,now){
  if(!env.AIRLABS_API_KEY)return {ok:true,skipped:"AIRLABS_API_KEY_NON_CONFIGURE"};
  const u=await providerUsage(env,"AIRLABS"),monthCap=Number(env.AIRLABS_MONTHLY_LIMIT||1000),reserve=Number(env.AIRLABS_MONTHLY_RESERVE||40),cadence=Number(env.AIRLABS_CADENCE_MINUTES||90);
  if(u.month>=Math.max(0,monthCap-reserve))return {ok:true,skipped:"AIRLABS_QUOTA_RESERVE",usage:u};
  if(ageMs(u.lastAt)<cadence*60000)return {ok:true,skipped:"AIRLABS_CADENCE",usage:u};
  const active=baseRows.filter(z=>z.d<=600&&z.d>=-900&&!isFinal(z.x));if(!active.length)return {ok:true,skipped:"AIRLABS_AUCUN_VOL"};
  const carriers=[...new Set(active.map(z=>providerCarrier(z.x.airline||z.row.airline)).filter(Boolean))];
  const wanted=new Map(active.map(z=>[flightKey(z.x,z.row),z]));
  const fields="airline_iata,flight_iata,flight_number,dep_iata,dep_terminal,dep_gate,dep_time,dep_estimated,dep_actual,arr_iata,arr_terminal,arr_gate,arr_time,arr_estimated,arr_actual,status,reg_number,aircraft_icao";
  const maxPages=Math.max(1,Math.min(2,Number(env.AIRLABS_MAX_PAGES||2))),all=[];let calls=0,lastStatus=0;
  for(let page=0;page<maxPages;page++){
    if(u.month+calls>=Math.max(0,monthCap-reserve))break;
    const p=new URLSearchParams({dep_iata:"CDG",api_key:env.AIRLABS_API_KEY,limit:"50",offset:String(page*50),_fields:fields});if(carriers.length)p.set("airline_iata",carriers.join(","));
    let r;try{r=await fetch(`https://airlabs.co/api/v9/schedules?${p}`,{headers:{Accept:"application/json"}})}catch(e){await bump(env,"AIRLABS",502);return {ok:false,status:502,error:String(e?.message||e),calls:calls+1}}
    calls++;lastStatus=r.status;await bump(env,"AIRLABS",r.status);const payload=await r.json().catch(()=>null);if(!r.ok)return {ok:false,status:r.status,error:`AIRLABS_${r.status}`,calls};
    const pageRows=airlabsRows(payload);all.push(...pageRows);const hasMore=Boolean(payload?.request?.has_more||payload?.has_more);if(!hasMore||pageRows.length<50)break;if(page+1<maxPages)await sleep(250);
  }
  const at=new Date().toISOString(),changes=[];
  for(const r of all){
    const key=upper(r?.flight_iata||`${r?.airline_iata||""}${r?.flight_number||""}`),z=wanted.get(key);if(!z)continue;
    const dest=upper(z.x.destination||z.x.dest),apiDest=upper(r?.arr_iata);if(dest&&apiDest&&dest!==apiDest)continue;
    const a=parseAirlabs(r),changed=[];
    for(const [field,refresh] of [["sta",false],["etd",true],["atd",true],["eta",true],["ata",true],["gate",true],["arrivalGate",true],["terminal",true],["arrivalTerminal",true],["status",true],["reg",false]])if(apply(z.x,field,a[field],"AIRLABS",at,{refresh}))changed.push(field);
    if(a.aircraft&&missing(z.x.aircraft)&&apply(z.x,"aircraft",a.aircraft,"AIRLABS",at))changed.push("aircraft");
    if(a.staArrivalDate&&!clean(z.x.staArrivalDate))z.x.staArrivalDate=a.staArrivalDate;
    z.x.airlabsLastCheckedAt=at;z.x.airlabsLastStatus=lastStatus;if(changed.length){await saveRow(env,z.row,z.x);changes.push({flight:key,changed})}
  }
  return {ok:true,calls,matched:changes.length,changes,usageBefore:u};
}

function parseSkylink(p){const dep=p?.departure||{},arr=p?.arrival||{};return {
  sta:hhmm(arr?.scheduled_time),atd:hhmm(dep?.actual_time),eta:hhmm(arr?.estimated_time),gate:clean(dep?.gate),arrivalGate:clean(arr?.gate),terminal:clean(dep?.terminal),arrivalTerminal:clean(arr?.terminal),status:clean(p?.status)
}}
async function runSkylink(env,rows,now){
  if(!env.SKYLINK_API_KEY)return {ok:true,skipped:"SKYLINK_API_KEY_NON_CONFIGURE"};
  const u=await providerUsage(env,"SKYLINK"),monthCap=Number(env.SKYLINK_MONTHLY_LIMIT||1000),reserve=Number(env.SKYLINK_MONTHLY_RESERVE||80),cadence=Number(env.SKYLINK_CADENCE_MINUTES||60);
  if(u.month>=Math.max(0,monthCap-reserve))return {ok:true,skipped:"SKYLINK_QUOTA_RESERVE",usage:u};
  if(ageMs(u.lastAt)<cadence*60000)return {ok:true,skipped:"SKYLINK_CADENCE",usage:u};
  const candidates=rows.filter(z=>z.d<=180&&z.d>=-720&&!isFinal(z.x)&&(missing(z.x.atd)||missing(z.x.ata)||missing(z.x.gate)||missing(z.x.terminal)||missing(z.x.eta)))
    .sort((a,b)=>{const pa=missing(a.x.atd)&&a.d<0?0:missing(a.x.gate)&&a.d<=90?1:missing(a.x.eta)?2:3,pb=missing(b.x.atd)&&b.d<0?0:missing(b.x.gate)&&b.d<=90?1:missing(b.x.eta)?2:3;return pa-pb||Math.abs(a.d)-Math.abs(b.d)});
  const z=candidates[0];if(!z)return {ok:true,skipped:"SKYLINK_AUCUN_VOL"};const flight=flightKey(z.x,z.row);if(!flight)return {ok:false,error:"SKYLINK_IDENTITE_INCOMPLETE"};
  const base=clean(env.SKYLINK_BASE_URL)||"https://data.skylinkapi.com/v3.1",headers={Accept:"application/json"};
  if(/rapidapi\.com/i.test(base)){headers["X-RapidAPI-Key"]=env.SKYLINK_API_KEY;headers["X-RapidAPI-Host"]=clean(env.SKYLINK_RAPIDAPI_HOST)||"skylink-api.p.rapidapi.com"}else headers["x-api-key"]=env.SKYLINK_API_KEY;
  let r;try{r=await fetch(`${base.replace(/\/$/,"")}/flight_status/${encodeURIComponent(flight)}`,{headers})}catch(e){await bump(env,"SKYLINK",502);return {ok:false,status:502,error:String(e?.message||e),flight}}
  await bump(env,"SKYLINK",r.status);const p=await r.json().catch(()=>null),at=new Date().toISOString();z.x.skylinkLastCheckedAt=at;z.x.skylinkLastStatus=r.status;
  if(!r.ok){await saveRow(env,z.row,z.x);return {ok:false,status:r.status,error:`SKYLINK_${r.status}`,flight}}
  const d=parseSkylink(p),changed=[];
  for(const field of ["sta","atd","eta","gate","arrivalGate","terminal","arrivalTerminal","status"]){const refresh=field!=="sta";if(apply(z.x,field,d[field],"SKYLINK",at,{refresh}))changed.push(field)}
  await saveRow(env,z.row,z.x);return {ok:true,flight,changed};
}

async function prefill(env){
  const {now,rows}=await todayRows(env);const airlabs=await runAirlabs(env,rows,now);
  const fresh=(await todayRows(env)).rows;const skylink=await runSkylink(env,fresh,now);
  return {ok:true,date:now.date,airlabs,skylink};
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/providers/prefill/status"){
      const [airlabs,skylink]=await Promise.all([providerUsage(env,"AIRLABS"),providerUsage(env,"SKYLINK")]);
      return new Response(JSON.stringify({ok:true,airlabs,skylink}),{headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{try{await prefill(env)}catch(_){}if(typeof app.scheduled==="function")await app.scheduled(controller,env,ctx)})());
  }
};
