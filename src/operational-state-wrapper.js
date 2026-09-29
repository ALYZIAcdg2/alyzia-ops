import app from "./registration-enrichment-wrapper.js";

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
const hhmm=v=>{const s=clean(v),m=s.match(/^(\d{2}:\d{2})$/)||s.match(/(?:T|\s)(\d{2}:\d{2})/);return m?m[1]:""};
const missing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));

function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms));const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function parisNow(){
  const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)};
}
function mins(v){const h=hhmm(v);if(!h)return null;const [a,b]=h.split(":").map(Number);return a*60+b}
function dayNumber(date){const m=clean(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function etaPassedBy10(x,now,flightDate){
  const atd=mins(x.atd),eta=mins(x.eta),std=mins(x.std),sta=mins(x.sta),flightDay=dayNumber(flightDate),nowDay=dayNumber(now.date);
  if(atd==null||eta==null||flightDay==null||nowDay==null)return false;
  const nextDay=((std!=null&&sta!=null&&sta<std)||eta<atd);
  const etaAbs=(flightDay+(nextDay?1:0))*1440+eta;
  const nowAbs=nowDay*1440+now.minutes;
  return nowAbs>=etaAbs+10;
}
function apiSource(x,field){return /(AIRLABS|SKYLINK|OAG|AERODATABOX)/i.test(clean(x?.[field+"Source"]))}
function skylinkSource(x,field){return /SKYLINK/i.test(clean(x?.[field+"Source"]))}
function departedRaw(v){return /(DEPARTED|EN\s*ROUTE|AIRBORNE|IN\s*FLIGHT|TOOK\s*OFF|TAKEOFF|LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function cancelledRaw(v){return /(CANCEL|CANCELED|CANCELLED|ANNUL)/i.test(clean(v))}
function boardingRaw(v){return /(BOARDING|GATE\s*CLOSED|FINAL\s*CALL|EMBARQU)/i.test(clean(v))}
function delayedRaw(v){return /(DELAY|RETARD|LATE)/i.test(clean(v))}
function arrivedRaw(v){return /(LANDED|ARRIVED|COMPLETED)/i.test(clean(v))}
function addLog(x,field,from,to,reason,at){const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:"ALYZIA_OPS_STATE",field,from:clean(from),to:clean(to),reason});x.flightInfoLog=log.slice(0,180)}
function setField(x,field,value,at,reason){const next=clean(value),from=clean(x[field]);if(next===from)return false;addLog(x,field,from,next,reason,at);x[field]=next;x[field+"Source"]="ALYZIA_OPS_STATE";x[field+"UpdatedAt"]=at;if(field==="etd")x.edt=next;return true}
function clearField(x,field,at,reason){const from=clean(x[field]);if(!from)return false;addLog(x,field,from,"",reason,at);x[field]="";x[field+"Source"]="ALYZIA_OPS_STATE";x[field+"UpdatedAt"]=at;return true}
function repairTimes(x,now,at){
  let changed=false;const raw=clean(x.providerStatusRaw||x.status),atd=mins(x.atd),ata=mins(x.ata),std=mins(x.std);
  const atdFuture=atd!=null&&atd>now.minutes+3,ataFuture=ata!=null&&ata>now.minutes+3,skyAmbiguous=skylinkSource(x,"atd")&&!departedRaw(raw),beforeDeparture=std!=null&&now.minutes<std-3;
  if(apiSource(x,"atd")&&(atdFuture||(skyAmbiguous&&beforeDeparture))){if(missing(x.etd)||apiSource(x,"etd")||/ALYZIA_OPS_STATE/i.test(clean(x.etdSource)))changed=setField(x,"etd",x.atd,at,"ATD fournisseur ambigu/futur reclassé en ETD")||changed;changed=clearField(x,"atd",at,"ATD impossible avant départ")||changed}
  if(apiSource(x,"ata")&&ataFuture){if(missing(x.eta)||apiSource(x,"eta")||/ALYZIA_OPS_STATE/i.test(clean(x.etaSource)))changed=setField(x,"eta",x.ata,at,"ATA fournisseur futur reclassé en ETA")||changed;changed=clearField(x,"ata",at,"ATA impossible dans le futur")||changed}
  return changed;
}
function normalizedStatus(x,now,flightDate){
  const raw=clean(x.providerStatusRaw||x.status),s=mins(x.std),e=mins(x.etd);
  if(cancelledRaw(raw))return {status:"ANNULÉ",reason:"provider"};
  if(clean(x.ata)||arrivedRaw(raw))return {status:"ARRIVÉ",reason:"actual_arrival"};
  if(clean(x.atd)&&etaPassedBy10(x,now,flightDate))return {status:"ARRIVÉ",reason:"eta_plus_10_without_ata"};
  if(clean(x.atd))return {status:"EN VOL",reason:"actual_departure"};
  if(departedRaw(raw))return {status:"DÉCOLLÉ",reason:"provider_departure_without_atd"};
  if(boardingRaw(raw))return {status:"EMBARQUEMENT",reason:"provider"};
  if(delayedRaw(raw))return {status:"RETARDÉ",reason:"provider"};
  if(flightDate===now.date&&s!=null&&e!=null&&e-s>=5)return {status:"RETARDÉ",reason:"etd_after_std"};
  if(flightDate===now.date&&s!=null&&now.minutes>s+15)return {status:"À CONFIRMER",reason:"past_std_without_actual"};
  return {status:"PROGRAMMÉ",reason:"scheduled"};
}
async function normalizeRecent(env){
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000),at=new Date().toISOString();
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,data_json FROM flights WHERE flight_date IN (?,?)`).bind(yesterday,now.date).all();
  let changedRows=0,repairedTimes=0,statusChanges=0;
  for(const row of results){
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{continue}
    let changed=false;const currentStatus=clean(x.status),statusSource=clean(x.statusSource),flightDate=clean(row.flight_date||x.flight_date||x.flightDate||now.date);
    if(currentStatus&&/(AIRLABS|SKYLINK|OAG|AERODATABOX)/i.test(statusSource))x.providerStatusRaw=currentStatus;
    if(flightDate===now.date&&repairTimes(x,now,at)){changed=true;repairedTimes++}
    const state=normalizedStatus(x,now,flightDate),next=state.status;
    if(next&&next!==clean(x.status)){if(currentStatus&&currentStatus!==next&&!x.providerStatusRaw)x.providerStatusRaw=currentStatus;changed=setField(x,"status",next,at,"Statut opérationnel ALYZIA normalisé")||changed;statusChanges++}
    x.opsStatus=next;x.opsStatusReason=state.reason;x.opsStatusUpdatedAt=at;
    if(changed){await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(x),row.identity).run();changedRows++}
  }
  return {ok:true,dates:[yesterday,now.date],changedRows,repairedTimes,statusChanges};
}
function legacyProviderMaskedEnv(env){
  const masked=Object.create(env);
  for(const key of ["AIRLABS_API_KEY","SKYLINK_API_KEY","OAG_API_KEY","AERODATABOX_API_KEY"]){try{Object.defineProperty(masked,key,{value:"",enumerable:true})}catch(_){}}
  try{Object.defineProperty(masked,"AERODATABOX",{value:null,enumerable:true})}catch(_){}
  return masked;
}

export default {
  async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==="/api/providers/operational-state/status")return new Response(JSON.stringify(await normalizeRecent(env)),{headers:{"content-type":"application/json; charset=UTF-8","cache-control":"no-store"}});return app.fetch(request,env,ctx)},
  scheduled(controller,env,ctx){ctx.waitUntil((async()=>{try{await normalizeRecent(env)}catch(_){}if(typeof app.scheduled==="function")await app.scheduled(controller,legacyProviderMaskedEnv(env),ctx)})())}
};
