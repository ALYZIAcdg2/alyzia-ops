import openSkyLive from "./opensky-live-wrapper.js";
import {quotaPlan} from "./oag-quota.js";
import {queuedFieldMap} from "./provider-queue-authority.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const s=clean(v),m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};
const providerCarrier=v=>upper(v)==="ENT"?"E4":upper(v);
const flightNo=(v,carrier="")=>{let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s};

function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDate(){return parisNow().date}
function flightKey(x,row){const stored=upper(x.airline||row.airline),carrier=providerCarrier(stored),n=flightNo(x.flight||row.flight_number,stored);return carrier&&n?carrier+n:""}
function routeKey(x,row){return `${flightKey(x,row)}|${upper(x.destination||x.dest)}`}
function routeDayMatches(days,date){if(!Array.isArray(days)||!days.length)return true;const names=["sun","mon","tue","wed","thu","fri","sat"],d=new Date(`${date}T12:00:00Z`);return days.map(v=>clean(v).slice(0,3).toLowerCase()).includes(names[d.getUTCDay()])}

async function ensure(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS flight_route_schedule_cache(route_key TEXT PRIMARY KEY,flight_iata TEXT NOT NULL,destination TEXT NOT NULL,sta TEXT,aircraft TEXT,days_json TEXT,provider TEXT NOT NULL,checked_at TEXT NOT NULL,status INTEGER NOT NULL DEFAULT 200)`).run();
}
async function usageTotal(env){await ensure(env);const month=parisDate().slice(0,7),r=await env.OPS_DB.prepare(`SELECT COALESCE(SUM(calls),0) calls FROM api_provider_usage WHERE provider LIKE 'AIRLABS%' AND period=?`).bind(month).first();return Number(r?.calls||0)}
async function bump(env,status){try{await ensure(env);const date=parisDate(),at=new Date().toISOString();for(const period of [date.slice(0,7),date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('AIRLABS_ROUTE_TODAY',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run()}catch(_){}}
async function oagUsage(env){await ensure(env);const now=parisNow(),month=now.date.slice(0,7),{results=[]}=await env.OPS_DB.prepare(`SELECT period,calls FROM api_provider_usage WHERE provider='OAG' AND period IN (?,?)`).bind(month,now.date).all();return {day:Number(results.find(x=>x.period===now.date)?.calls||0),month:Number(results.find(x=>x.period===month)?.calls||0),now}}
async function bumpOag(env,status){try{await ensure(env);const date=parisDate(),at=new Date().toISOString();for(const period of [date.slice(0,7),date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES('OAG',?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run()}catch(_){}}
async function rowsToday(env){const date=parisDate(),{results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date=? ORDER BY std,flight_number`).bind(date).all();return {date,rows:results.map(row=>{let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}return {row,x}})}}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}
function applySta(x,sta,source,at){if(!missing(x.sta)||missing(sta))return false;const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source,field:"sta",from:clean(x.sta),to:sta});x.flightInfoLog=log.slice(0,160);x.sta=sta;x.staSource=source;x.staUpdatedAt=at;return true}
function airlabsRows(p){if(Array.isArray(p))return p;if(Array.isArray(p?.response))return p.response;if(Array.isArray(p?.data))return p.data;return []}
function oagRows(p){if(Array.isArray(p))return p;if(Array.isArray(p?.data))return p.data;if(Array.isArray(p?.results))return p.results;if(Array.isArray(p?.flightInstances))return p.flightInstances;if(Array.isArray(p?.items))return p.items;return []}
function oagSta(row){return hhmm(row?.arrival?.time?.local)||hhmm(row?.arrivalTimeLocal)||hhmm(row?.scheduledArrivalDateTime)||hhmm(row?.arrivalDateTime)}

async function fillToday(env){
  await ensure(env);const {date,rows}=await rowsToday(env);let cached=0;
  for(const z of rows){
    if(!missing(z.x.sta))continue;const key=routeKey(z.x,z.row);if(key.startsWith("|"))continue;
    const c=await env.OPS_DB.prepare(`SELECT * FROM flight_route_schedule_cache WHERE route_key=?`).bind(key).first();
    if(!c||missing(c.sta)||ageMs(c.checked_at)>30*86400000)continue;let days=[];try{days=JSON.parse(c.days_json||"[]")}catch{}
    if(!routeDayMatches(days,date))continue;const at=new Date().toISOString();if(applySta(z.x,c.sta,"AIRLABS_ROUTE",at)){await save(env,z.row,z.x);cached++}
  }
  const fresh=(await rowsToday(env)).rows.filter(z=>missing(z.x.sta));if(!fresh.length)return {ok:true,date,cached,remaining:0,calls:0};
  const airlabsAuthority=await queuedFieldMap(env,"AIRLABS",date),oagAuthority=await queuedFieldMap(env,"OAG_SCHEDULE",date);
  let calls=0,applied=0,before=await usageTotal(env);
  if(env.AIRLABS_API_KEY&&airlabsAuthority.size){
    const limit=Number(env.AIRLABS_MONTHLY_LIMIT||1000),reserve=Number(env.AIRLABS_MONTHLY_RESERVE||180),budget=Math.max(0,limit-reserve-before),maxCalls=Math.min(10,budget);
    const groups=new Map();for(const z of fresh){if(!airlabsAuthority.get(z.row.identity)?.has("sta"))continue;const key=routeKey(z.x,z.row);if(!key.startsWith("|"))groups.set(key,z)}
    for(const [key,z] of groups){
      if(calls>=maxCalls)break;const old=await env.OPS_DB.prepare(`SELECT sta,checked_at,status FROM flight_route_schedule_cache WHERE route_key=?`).bind(key).first();
      if(old&&!missing(old.sta)&&ageMs(old.checked_at)<=30*86400000)continue;
      if(old&&missing(old.sta)&&ageMs(old.checked_at)<3*3600000)continue;
      const flight=flightKey(z.x,z.row),dest=upper(z.x.destination||z.x.dest);if(!flight||!dest)continue;
      const p=new URLSearchParams({dep_iata:"CDG",arr_iata:dest,api_key:env.AIRLABS_API_KEY,limit:"50",_fields:"airline_iata,flight_iata,flight_number,dep_iata,arr_iata,arr_time,days,aircraft_icao"});
      let r;try{r=await fetch(`https://airlabs.co/api/v9/routes?${p}`,{headers:{Accept:"application/json"}})}catch{await bump(env,502);calls++;continue}
      calls++;await bump(env,r.status);const payload=await r.json().catch(()=>null),list=airlabsRows(payload),match=list.find(q=>upper(q?.flight_iata||`${q?.airline_iata||""}${q?.flight_number||""}`)===flight),at=new Date().toISOString();
      const sta=hhmm(match?.arr_time),aircraft=upper(match?.aircraft_icao),days=Array.isArray(match?.days)?match.days:[];
      await env.OPS_DB.prepare(`INSERT INTO flight_route_schedule_cache(route_key,flight_iata,destination,sta,aircraft,days_json,provider,checked_at,status) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(route_key) DO UPDATE SET sta=excluded.sta,aircraft=excluded.aircraft,days_json=excluded.days_json,provider=excluded.provider,checked_at=excluded.checked_at,status=excluded.status`).bind(key,flight,dest,sta,aircraft,JSON.stringify(days),"AIRLABS_ROUTE",at,r.status).run();
      if(!r.ok||!match||!sta||!routeDayMatches(days,date))continue;
      for(const q of fresh){if(!airlabsAuthority.get(q.row.identity)?.has("sta"))continue;if(routeKey(q.x,q.row)!==key||!missing(q.x.sta))continue;if(applySta(q.x,sta,"AIRLABS_ROUTE",at)){await save(env,q.row,q.x);applied++}}
    }
  }

  let oagCalls=0,oagApplied=0;
  const unresolved=(await rowsToday(env)).rows.filter(z=>missing(z.x.sta)&&oagAuthority.get(z.row.identity)?.has("sta"));
  if(unresolved.length&&env.OAG_API_KEY){
    const u=await oagUsage(env),plan=quotaPlan({date:u.now.date,minutes:u.now.minutes,dayCalls:u.day,monthCalls:u.month,limit:Number(env.OAG_QUOTA_LIMIT||1000)}),allow=Math.max(0,Math.min(2,plan.normalCap-u.day));
    for(const z of unresolved){
      if(oagCalls>=allow)break;
      if(Number(z.x.oagLastStatus)===404&&clean(z.x.oagCoverageCheckedDate)===date)continue;
      if(ageMs(z.x.oagLastCheckedAt)<90*60000)continue;
      const stored=upper(z.x.airline||z.row.airline),carrier=providerCarrier(stored),number=flightNo(z.x.flight||z.row.flight_number,stored),dest=upper(z.x.destination||z.x.dest);if(!carrier||!number)continue;
      const p=new URLSearchParams({DepartureDateTime:date,CarrierCode:carrier,FlightNumber:number,FlightType:"scheduled",CodeType:"IATA",Content:"Status",version:"v2"});
      let r;try{r=await fetch(`https://api.oag.com/flight-instances/?${p}`,{headers:{"Subscription-Key":env.OAG_API_KEY,Accept:"application/json"}})}catch{await bumpOag(env,502);oagCalls++;continue}
      oagCalls++;await bumpOag(env,r.status);const payload=await r.json().catch(()=>null),list=oagRows(payload),match=list.find(q=>{const a=upper(q?.departure?.airport?.iata||q?.departureAirport?.iata||q?.departureAirport),b=upper(q?.arrival?.airport?.iata||q?.arrivalAirport?.iata||q?.arrivalAirport);return (!a||a==="CDG")&&(!dest||!b||b===dest)})||list[0],at=new Date().toISOString(),sta=oagSta(match);
      z.x.oagLastCheckedAt=at;z.x.oagLastStatus=r.status;z.x.oagCoverageCheckedDate=date;
      if(r.ok&&match&&sta&&applySta(z.x,sta,"OAG_SCHEDULE",at))oagApplied++;
      await save(env,z.row,z.x);
    }
  }
  const remaining=(await rowsToday(env)).rows.filter(z=>missing(z.x.sta)).length;
  return {ok:true,date,cached,calls,applied,oagCalls,oagApplied,remaining,usageBefore:before,queue:{airlabs:airlabsAuthority.size,oag:oagAuthority.size}};
}

export default {
  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      try{await fillToday(env)}catch(_){}
      if(typeof openSkyLive.scheduled==="function")await openSkyLive.scheduled(controller,env,ctx);
    })());
  }
};
