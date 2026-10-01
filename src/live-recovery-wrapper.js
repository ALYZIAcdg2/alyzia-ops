import app from "./operational-state-wrapper.js";
import {paceRoom} from "./budget-pace.js";
import {queuedFieldMap} from "./provider-queue-authority.js";
import {noteAndSwitch} from "./aircraft-change.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));
const hhmm=v=>{const s=clean(v),m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const ageMs=v=>{const t=Date.parse(clean(v)||0)||0;return t?Date.now()-t:Infinity};
const etdStale=x=>Boolean(clean(x.etd||x.edt))&&!clean(x.atd)&&ageMs(x.etdUpdatedAt)>=30*60000; // ETD connu mais vieux de 30 min : à rafraîchir (le retard évolue)
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const h=hhmm(std),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!h||fd==null||nd==null)return 99999;const [a,b]=h.split(":").map(Number);return (fd-nd)*1440+a*60+b-now.minutes}
function isFinal(x){const s=upper(x.status||x.opsStatus||x.flight_status);return /CANCEL|ANNUL/.test(s)||Boolean(clean(x.atd)&&clean(x.ata))}
function providerCarrier(v){const c=upper(v);return c==="ENT"?"E4":c}
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function flightKey(x,row){const stored=upper(x.airline||row.airline),carrier=providerCarrier(stored),n=flightNo(x.flight||row.flight_number,stored);return carrier&&n?carrier+n:""}
function liveIncomplete(x){return etdStale(x)||missing(x.atd)||missing(x.ata)||missing(x.etd)||missing(x.eta)||missing(x.gate)||missing(x.reg)}
function priority(z){
  if(missing(z.x.atd)&&z.d<=-30)return 0;
  if(missing(z.x.atd)&&z.d<=0)return 1;
  if(missing(z.x.ata))return 2;
  if(z.d<=120&&(missing(z.x.etd)||etdStale(z.x)))return 3;
  if(z.d<=120&&(missing(z.x.gate)||missing(z.x.reg)))return 4;
  if(missing(z.x.eta))return 5;
  return 9;
}

async function ensureUsage(env){
  await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run();
}
async function usageTotal(env,prefix){
  try{
    await ensureUsage(env);const now=parisNow(),month=now.date.slice(0,7);
    const r=await env.OPS_DB.prepare(`SELECT COALESCE(SUM(calls),0) calls FROM api_provider_usage WHERE provider LIKE ? AND period=?`).bind(`${prefix}%`,month).first();
    return Number(r?.calls||0);
  }catch{return 0}
}
async function usageLane(env,lane){
  try{
    await ensureUsage(env);const now=parisNow();
    const r=await env.OPS_DB.prepare(`SELECT calls,last_at,last_status FROM api_provider_usage WHERE provider=? AND period=?`).bind(lane,now.date).first();
    return {day:Number(r?.calls||0),lastAt:clean(r?.last_at),lastStatus:Number(r?.last_status||0)};
  }catch{return {day:0,lastAt:"",lastStatus:0}}
}
async function bump(env,lane,status){
  try{
    await ensureUsage(env);const now=parisNow(),at=new Date().toISOString();
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(lane,period,status>=200&&status<400?1:0,status>=400?1:0,status,at).run();
  }catch(_){}
}

async function recentRows(env){
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000),{results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  return {now,yesterday,rows:results.map(row=>{let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}return {row,x,d:delta(row.flight_date,x.std||row.std,now)}})};
}
async function recentAuthority(env,provider,now,yesterday){
  const maps=await Promise.all([queuedFieldMap(env,provider,now.date),queuedFieldMap(env,provider,yesterday)]),out=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!out.has(id))out.set(id,new Set());for(const f of fields)out.get(id).add(f)}
  return out;
}
function canRefresh(x,field){
  if(missing(x[field]))return true;
  return ["AIRLABS","AIRLABS_LIVE_RECOVERY","AIRLABS_ROUTE","SKYLINK","SKYLINK_LIVE_RECOVERY","SKYLINK_J0_BACKFILL","SKYLINK_ENT_ALIAS","OAG_STATUS","OAG_SCHEDULE","AERODATABOX","AERODATABOX_REG","ALYZIA_OPS_STATE","OPENSKY_ADSB","FLIGHTRADAR8_EST","FLIGHTRADAR1_EST"].includes(upper(x[field+"Source"]));
}
function apply(x,field,value,source,at,{refresh=true}={}){
  const next=clean(value),from=clean(x[field]);if(!next||next===from)return false;
  if(!refresh&&!missing(from))return false;if(refresh&&!canRefresh(x,field))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=source;x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true;
}
async function save(env,row,x){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run()}

function airlabsRows(payload){if(Array.isArray(payload))return payload;if(Array.isArray(payload?.response))return payload.response;if(Array.isArray(payload?.data))return payload.data;return []}
function parseAirlabs(r){return {
  sta:hhmm(r?.arr_time),etd:hhmm(r?.dep_estimated),atd:hhmm(r?.dep_actual),eta:hhmm(r?.arr_estimated),ata:hhmm(r?.arr_actual),
  gate:clean(r?.dep_gate),reg:clean(r?.reg_number)
}}
async function airlabsRecovery(env,rows,now,yesterday){
  if(!env.AIRLABS_API_KEY)return {ok:true,skipped:"AIRLABS_API_KEY_NON_CONFIGURE"};
  const authority=await recentAuthority(env,"AIRLABS",now,yesterday);
  if(!authority.size)return {ok:true,skipped:"AIRLABS_QUEUE_VIDE"};
  const lane="AIRLABS_LIVE_RECOVERY",u=await usageLane(env,lane),total=await usageTotal(env,"AIRLABS"),limit=Number(env.AIRLABS_MONTHLY_LIMIT||1000),reserve=Number(env.AIRLABS_MONTHLY_RESERVE||180);
  if(total>=Math.max(0,limit-reserve))return {ok:true,skipped:"AIRLABS_QUOTA_RESERVE",total};
  const candidates=rows.filter(z=>authority.has(z.row.identity)&&z.d<=180&&z.d>=-1800&&!isFinal(z.x)&&liveIncomplete(z.x));
  if(!candidates.length)return {ok:true,skipped:"AIRLABS_LIVE_AUCUN_VOL_QUEUE"};
  const urgent=candidates.some(z=>z.d<=30&&z.d>=-360&&(missing(z.x.atd)||missing(z.x.etd)||missing(z.x.gate)||missing(z.x.reg)||missing(z.x.ata)));
  const cadence=urgent?20:60;if(!globalThis.__ALYZIA_MANUAL_PUSH&&ageMs(u.lastAt)<cadence*60000)return {ok:true,skipped:"AIRLABS_LIVE_CADENCE",cadence};
  const wanted=new Map(candidates.map(z=>[flightKey(z.x,z.row),z]).filter(([k])=>k));
  const fields="airline_iata,flight_iata,flight_number,dep_iata,dep_gate,dep_time,dep_estimated,dep_actual,arr_iata,arr_time,arr_estimated,arr_actual,reg_number";
  const all=[];let calls=0,lastStatus=0;
  for(let page=0;page<2;page++){
    if(total+calls>=Math.max(0,limit-reserve))break;
    const q=new URLSearchParams({dep_iata:"CDG",api_key:env.AIRLABS_API_KEY,limit:"50",offset:String(page*50),_fields:fields});
    // AirLabs (derrière Cloudflare) renvoie parfois 500/520 de façon passagère : une seule nouvelle tentative après 1,5 s.
    let r;
    for(let attempt=0;attempt<2;attempt++){
      try{r=await fetch(`https://airlabs.co/api/v9/schedules?${q}`,{headers:{Accept:"application/json","User-Agent":"alyzia-ops/1.0"}})}catch(e){await bump(env,lane,502);return {ok:false,status:502,error:String(e?.message||e)}}
      calls++;lastStatus=r.status;await bump(env,lane,r.status);
      if(r.status<500||attempt===1)break;
      await sleep(1500);
    }
    const payload=await r.json().catch(()=>null);if(!r.ok)return {ok:false,status:r.status,error:`AIRLABS_${r.status}`,calls};
    const pageRows=airlabsRows(payload);all.push(...pageRows);if(pageRows.length<50)break;if(page===0)await sleep(200);
  }
  const at=new Date().toISOString(),changes=[];
  for(const r of all){
    const key=upper(r?.flight_iata||`${r?.airline_iata||""}${r?.flight_number||""}`),z=wanted.get(key);if(!z)continue;
    const dest=upper(z.x.destination||z.x.dest),apiDest=upper(r?.arr_iata);if(dest&&apiDest&&dest!==apiDest)continue;
    const allowed=authority.get(z.row.identity)||new Set(),d=parseAirlabs(r),changed=[];
    for(const field of ["sta","etd","atd","eta","ata","gate"]){if(allowed.has(field)&&apply(z.x,field,d[field],"AIRLABS_LIVE_RECOVERY",at,{refresh:field!=="sta"}))changed.push(field)}
    if(allowed.has("reg")&&apply(z.x,"reg",d.reg,"AIRLABS_LIVE_RECOVERY",at,{refresh:false}))changed.push("reg");
    z.x.airlabsRecoveryLastCheckedAt=at;z.x.airlabsRecoveryLastStatus=lastStatus;
    if(changed.length){await save(env,z.row,z.x);changes.push({flight:key,date:z.row.flight_date,changed})}
  }
  return {ok:true,calls,matched:changes.length,changes,cadence};
}

function departedStatus(v){return /(DEPARTED|AIRBORNE|EN\s*ROUTE|IN\s*FLIGHT|TOOK\s*OFF|LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function arrivedStatus(v){return /(LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function parseSkylink(p){
  const root=p?.data||p?.response||p||{},dep=root?.departure||{},arr=root?.arrival||{},ac=root?.aircraft||{},status=clean(root?.status||root?.flight_status);
  const depLatest=hhmm(dep?.actual_time||dep?.actual||root?.atd),arrActual=hhmm(arr?.actual_time||arr?.actual||root?.ata);
  return {
    sta:hhmm(arr?.scheduled_time||arr?.scheduled||root?.sta),
    etd:hhmm(dep?.estimated_time||dep?.estimated||root?.etd)||(!departedStatus(status)?depLatest:""),
    atd:departedStatus(status)?depLatest:"",eta:hhmm(arr?.estimated_time||arr?.estimated||root?.eta),ata:arrivedStatus(status)?arrActual:"",
    gate:clean(dep?.gate||root?.departure_gate),reg:clean(ac?.registration||root?.registration||root?.aircraft_registration),
    aircraft:clean(ac?.icao_type||ac?.icao||ac?.type_code||ac?.model_code||ac?.type||root?.aircraft_type)
  };
}
async function skylinkRecovery(env,rows,now,yesterday){
  if(!env.SKYLINK_API_KEY)return {ok:true,skipped:"SKYLINK_API_KEY_NON_CONFIGURE"};
  const authority=await recentAuthority(env,"SKYLINK",now,yesterday);
  if(!authority.size)return {ok:true,skipped:"SKYLINK_QUEUE_VIDE"};
  const lane="SKYLINK_LIVE_RECOVERY",u=await usageLane(env,lane),total=await usageTotal(env,"SKYLINK"),limit=Number(env.SKYLINK_MONTHLY_LIMIT||1000),reserve=Number(env.SKYLINK_MONTHLY_RESERVE||220);
  if(total>=Math.max(0,limit-reserve))return {ok:true,skipped:"SKYLINK_QUOTA_RESERVE",total};
  // Cadence 10 min, jusqu'à 3 vols par passage (avant : 1 vol / 30 min, trop lent pour rattraper les ATD manquants), plafond 40 appels/jour.
  if(u.day>=40)return {ok:true,skipped:"SKYLINK_PLAFOND_JOUR",day:u.day};
  const paceLeft=paceRoom(u.day,40,now.minutes);   // budget étalé sur la journée (voir budget-pace.js)
  if(paceLeft<=0)return {ok:true,skipped:"SKYLINK_RYTHME",day:u.day};
  if(!globalThis.__ALYZIA_MANUAL_PUSH&&ageMs(u.lastAt)<10*60000)return {ok:true,skipped:"SKYLINK_LIVE_CADENCE"};
  const candidates=rows.filter(z=>authority.has(z.row.identity)&&z.d<=120&&z.d>=-1800&&!isFinal(z.x)&&liveIncomplete(z.x)&&ageMs(z.x.skylinkRecoveryLastCheckedAt)>=30*60000).sort((a,b)=>priority(a)-priority(b)||Math.abs(a.d)-Math.abs(b.d));
  if(!candidates.length)return {ok:true,skipped:"SKYLINK_LIVE_AUCUN_VOL_QUEUE"};
  const base=clean(env.SKYLINK_BASE_URL)||"https://data.skylinkapi.com/v2",headers={Accept:"application/json","x-api-key":env.SKYLINK_API_KEY};
  const results=[];
  for(const z of candidates.slice(0,Math.min(3,40-u.day,paceLeft))){
    const flight=flightKey(z.x,z.row);if(!flight){results.push({ok:false,error:"SKYLINK_IDENTITE_INCOMPLETE"});continue}
    let r;try{r=await fetch(`${base.replace(/\/$/,"")}/flight_status/${encodeURIComponent(flight)}`,{headers})}catch(e){await bump(env,lane,502);results.push({ok:false,status:502,error:String(e?.message||e),flight});break}
    await bump(env,lane,r.status);const payload=await r.json().catch(()=>null),at=new Date().toISOString();z.x.skylinkRecoveryLastCheckedAt=at;z.x.skylinkRecoveryLastStatus=r.status;
    if(!r.ok){await save(env,z.row,z.x);results.push({ok:false,status:r.status,error:`SKYLINK_${r.status}`,flight});if(r.status===429||r.status===401||r.status===403)break;continue}
    const allowed=authority.get(z.row.identity)||new Set(),d=parseSkylink(payload),changed=[];
    for(const field of ["sta","etd","atd","eta","ata","gate"]){if(allowed.has(field)&&apply(z.x,field,d[field],"SKYLINK_LIVE_RECOVERY",at,{refresh:field!=="sta"}))changed.push(field)}
    if(allowed.has("reg")&&apply(z.x,"reg",d.reg,"SKYLINK_LIVE_RECOVERY",at,{refresh:false}))changed.push("reg");
    if(await noteAndSwitch(env,z.x,d.aircraft,"SKYLINK_LIVE_RECOVERY",at))changed.push("aircraft");
    await save(env,z.row,z.x);results.push({ok:true,flight,date:z.row.flight_date,changed});
    await sleep(300);
  }
  return {ok:true,results};
}

async function recover(env){
  const first=await recentRows(env);
  const airlabs=await airlabsRecovery(env,first.rows,first.now,first.yesterday);
  const fresh=await recentRows(env);
  const skylink=await skylinkRecovery(env,fresh.rows,fresh.now,fresh.yesterday);
  return {ok:true,airlabs,skylink};
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==="/api/providers/live-recovery/status"){
      const {now,yesterday,rows}=await recentRows(env),candidates=rows.filter(z=>z.d<=180&&z.d>=-1800&&!isFinal(z.x)&&liveIncomplete(z.x));
      return new Response(JSON.stringify({ok:true,date:now.date,previousDate:yesterday,candidates:candidates.length,urgent:candidates.filter(z=>priority(z)<=2).length,airlabs:{totalMonth:await usageTotal(env,"AIRLABS"),lane:await usageLane(env,"AIRLABS_LIVE_RECOVERY")},skylink:{totalMonth:await usageTotal(env,"SKYLINK"),lane:await usageLane(env,"SKYLINK_LIVE_RECOVERY")}}),{headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});
    }
    return app.fetch(request,env,ctx);
  },
  scheduled(controller,env,ctx){ctx.waitUntil((async()=>{try{await recover(env)}catch(_){}if(typeof app.scheduled==="function")await app.scheduled(controller,env,ctx)})())}
};
