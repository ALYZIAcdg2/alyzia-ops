import app from "./etd-compat-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function hm(v){const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null}
function delta(std,now){const n=hm(std);return n==null?99999:n-now}
function flightNo(v,carrier=""){
  let s=upper(v),c=upper(carrier);
  if(c&&s.startsWith(c))s=s.slice(c.length);
  else s=s.replace(/^[A-Z]{2,3}/,"");
  const m=s.match(/(\d+[A-Z]?)$/);
  return m?m[1]:s;
}
function oagCarrier(v){const c=upper(v);return c==="ENT"?"E4":c}
function first(...xs){for(const x of xs){const v=clean(x);if(v)return v}return ""}
function hhmm(v){const s=clean(v);const m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""}

async function ensureTables(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
}
async function bump(env,status){
  try{
    await ensureTables(env);
    const at=new Date().toISOString();
    for(const period of [at.slice(0,7),at.slice(0,10)]){
      await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('OAG',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run();
    }
  }catch(_){}
}
async function usage(env){
  try{
    await ensureTables(env);
    const now=parisNow(),month=now.date.slice(0,7);
    const {results=[]}=await env.OPS_DB.prepare(`SELECT period,calls FROM api_provider_usage WHERE provider='OAG' AND period IN (?,?)`).bind(month,now.date).all();
    return {day:Number(results.find(x=>x.period===now.date)?.calls||0),month:Number(results.find(x=>x.period===month)?.calls||0)};
  }catch{return {day:0,month:0}}
}
function daysRemaining(date){const [y,m,d]=date.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate()-d+1}
function dailyBudget(date,monthCalls,limit){return Math.max(1,Math.floor(Math.max(0,limit-monthCalls)/Math.max(1,daysRemaining(date))))}
function logChange(x,field,to,source,at){
  const next=clean(to),from=clean(x[field]);if(!next||next===from)return false;
  const a=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];a.unshift({at,source,field,from,to:next});x.flightInfoLog=a.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;return true;
}

async function enrichSta(env,row,x,date){
  const storedCarrier=upper(x.airline||row.airline),carrier=oagCarrier(storedCarrier),number=flightNo(x.flight||row.flight_number,storedCarrier);
  if(!carrier||!number)return {ok:false,error:"IDENTITE_INCOMPLETE"};
  const p=new URLSearchParams({DepartureDateTime:date,CarrierCode:carrier,FlightNumber:number,FlightType:"scheduled",CodeType:"IATA",version:"v2"});
  const origin=upper(x.origin||x.dep||"CDG"),dest=upper(x.destination||x.dest);
  if(origin)p.set("DepartureAirport",origin);if(dest)p.set("ArrivalAirport",dest);
  let r;try{r=await fetch(`https://api.oag.com/flight-instances/?${p}`,{headers:{"Subscription-Key":env.OAG_API_KEY,"Accept":"application/json"}})}catch(e){await bump(env,502);return {ok:false,status:502,error:String(e?.message||e)}}
  await bump(env,r.status);
  const payload=await r.json().catch(()=>null);
  const rows=Array.isArray(payload)?payload:(payload?.data||payload?.results||payload?.flightInstances||payload?.items||[]);
  const at=new Date().toISOString();x.oagSafeCheckedDate=date;x.oagSafeCheckedAt=at;x.oagSafeStatus=r.status;
  if(!r.ok||!Array.isArray(rows)||!rows.length){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run();return {ok:false,status:r.status||404,carrier,number}}
  const q=rows[0];
  const sta=first(q?.arrival?.time?.local,q?.arrivalTimeLocal,hhmm(q?.scheduledArrivalDateTime),hhmm(q?.arrivalDateTime));
  const arrDate=first(q?.arrival?.date?.local,q?.arrivalDateLocal);
  const aircraft=upper(first(q?.aircraftType?.iata,q?.equipment?.iata,q?.aircraft?.type?.iata));
  const changed=[];
  if(sta&&!clean(x.sta)&&logChange(x,"sta",sta,"OAG_SCHEDULE",at))changed.push("STA");
  if(arrDate)x.staArrivalDate=arrDate;
  if(!clean(x.aircraft)&&/^[A-Z0-9]{3}$/.test(aircraft)&&logChange(x,"aircraft",aircraft,"OAG_SCHEDULE",at))changed.push("TYPE A/C");
  await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run();
  return {ok:true,status:r.status,carrier,number,changed,sta:sta||null};
}

async function runSafeOag(env){
  if(!env.OAG_API_KEY)return {ok:false,error:"OAG_API_KEY_NON_CONFIGURE"};
  const now=parisNow(),limit=Number(env.OAG_QUOTA_LIMIT||1000),u=await usage(env),budget=dailyBudget(now.date,u.month,limit);
  if(u.day>=budget||u.month>=limit)return {ok:true,skipped:"QUOTA_BUDGET",usage:{...u,budget,limit}};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(now.date).all();
  const candidates=[];
  for(const row of results){let x={};try{x=JSON.parse(row.data_json||"{}")}catch{};if(clean(x.sta)||clean(x.oagSafeCheckedDate)===now.date)continue;const d=delta(x.std||row.std,now.minutes);if(d>720||d<-720)continue;candidates.push({row,x,d,prio:["ENT","TU","A9"].includes(upper(x.airline||row.airline))?0:1})}
  candidates.sort((a,b)=>a.prio-b.prio||Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(2,budget-u.day,limit-u.month)),picked=candidates.slice(0,room),items=[];
  for(let i=0;i<picked.length;i++){if(i)await sleep(6500);items.push({flight:picked[i].x.flight||picked[i].row.flight_number,result:await enrichSta(env,picked[i].row,picked[i].x,now.date)})}
  return {ok:true,date:now.date,usage:{...u,budget,limit},candidates:candidates.length,processed:items.length,items};
}

export default {
  async fetch(request,env,ctx){return app.fetch(request,env,ctx)},
  scheduled(controller,env,ctx){
    if(typeof app.scheduled==="function"){
      try{const masked=Object.create(env);Object.defineProperty(masked,"OAG_API_KEY",{value:"",enumerable:true});app.scheduled(controller,masked,ctx)}catch(_){}
    }
    ctx.waitUntil(runSafeOag(env));
  }
};
