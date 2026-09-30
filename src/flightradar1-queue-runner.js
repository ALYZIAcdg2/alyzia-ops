import {queuedFieldMap} from "./provider-queue-authority.js";
import {buildNeeds,mayWriteField,priorityScore,stopAll} from "./flight-enrichment-policy.js";
import {noteAndSwitch} from "./aircraft-change.js";
import {flighteraKey} from "./flightera-queue-runner.js";

// "Flightradar1" (apidojo) via RapidAPI : GET /flights/search?query=<vol>. Plan : 500 requêtes/mois.
// Pour un vol EN L'AIR, la recherche renvoie une entrée type "live" avec l'immatriculation (reg) et le type d'appareil réel (ac_type).
// Un vol au sol ou terminé n'a qu'une entrée "schedule" : pas de données, on n'insiste pas.
const CONFIGS={
  FLIGHTRADAR1:{PROVIDER:"FLIGHTRADAR1",HOST:"flight-radar1.p.rapidapi.com",slot:0,fields:["reg","atd","ata","etd","eta","sta","gate"],atd:true,details:true,detailPath:"/flights/detail",prefix:"flightradar1",keyEnv:"FLIGHTRADAR1_RAPIDAPI_KEY"},
  FLIGHTRADAR8:{PROVIDER:"FLIGHTRADAR8",HOST:"flight-radar8.p.rapidapi.com",slot:1,fields:["reg","atd","ata","etd","eta","sta","gate"],atd:true,details:true,detailPath:"/flights/details",prefix:"flightradar8",keyEnv:"FLIGHTRADAR8_RAPIDAPI_KEY"}
};
const MAX_PER_RUN=1;
const DAY_CAP=25;
const MONTH_CAP=430;            // plan 500/mois, marge pour les essais
const COOLDOWN_MIN=60;          // par vol
const MAX_ATTEMPTS_PER_FLIGHT=4;
const MAX_NOT_LIVE=3;
const FIELDS=["reg"];

const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
function parisNow(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return {date:`${m.year}-${m.month}-${m.day}`,minutes:Number(m.hour)*60+Number(m.minute)}}
function parisDateAt(ms){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms)),m=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`}
function dayNumber(d){const m=clean(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):null}
function delta(flightDate,std,now){const m=clean(std).match(/^(\d{2}):(\d{2})$/),fd=dayNumber(flightDate),nd=dayNumber(now.date);if(!m||fd==null||nd==null)return 99999;return (fd-nd)*1440+Number(m[1])*60+Number(m[2])-now.minutes}
const ageMs=v=>{const t=Date.parse(clean(v))||0;return t?Date.now()-t:Infinity};
function flightNo(v,carrier=""){let s=upper(v),c=upper(carrier);if(c&&s.startsWith(c))s=s.slice(c.length);else s=s.replace(/^[A-Z]{2,3}/,"");const m=s.match(/(\d+[A-Z]?)$/);return m?m[1]:s}
function fullFlight(x,row){const carrier=upper(x.airline||row.airline),n=flightNo(x.flight||row.flight_number,carrier);return carrier&&n?(carrier==="ENT"?"E4":carrier)+n:upper(x.flight||row.flight_number)}
export function frKey(env,cfg=CONFIGS.FLIGHTRADAR1){return clean(env?.[cfg.keyEnv])||flighteraKey(env)}

async function ensureUsage(env){await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS api_provider_usage(provider TEXT NOT NULL,period TEXT NOT NULL,calls INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_at TEXT,PRIMARY KEY(provider,period))`).run()}
async function usage(env,now,PROVIDER){
  await ensureUsage(env);
  const month=now.date.slice(0,7),{results=[]}=await env.OPS_DB.prepare(`SELECT period,calls FROM api_provider_usage WHERE provider=? AND period IN (?,?)`).bind(PROVIDER,month,now.date).all();
  return {day:Number(results.find(r=>r.period===now.date)?.calls||0),month:Number(results.find(r=>r.period===month)?.calls||0)};
}
async function bump(env,now,status,PROVIDER){
  try{
    await ensureUsage(env);const at=new Date().toISOString(),ok=status>=200&&status<300?1:0;
    for(const period of [now.date.slice(0,7),now.date])await env.OPS_DB.prepare(`INSERT INTO api_provider_usage(provider,period,calls,successes,errors,last_status,last_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(provider,period) DO UPDATE SET calls=calls+1,successes=successes+excluded.successes,errors=errors+excluded.errors,last_status=excluded.last_status,last_at=excluded.last_at`).bind(PROVIDER,period,ok,ok?0:1,status,at).run();
  }catch(_){}
}

async function fetchSearch(env,flight,cfg){
  const HOST=cfg.HOST;
  try{
    const r=await fetch(`https://${HOST}/flights/search?query=${encodeURIComponent(flight)}&limit=10`,{headers:{Accept:"application/json","x-rapidapi-key":frKey(env,cfg),"x-rapidapi-host":HOST},signal:AbortSignal.timeout(8000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok,status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}

async function fetchDetails(env,id,cfg){
  const HOST=cfg.HOST;
  try{
    const r=await fetch(`https://${HOST}${cfg.detailPath}?flight=${encodeURIComponent(id)}`,{headers:{Accept:"application/json","x-rapidapi-key":frKey(env,cfg),"x-rapidapi-host":HOST},signal:AbortSignal.timeout(10000)});
    const payload=await r.json().catch(()=>null);
    return {ok:r.ok,status:r.status,payload};
  }catch(e){return {ok:false,status:502,error:String(e?.message||e)}}
}
const localHM=(epoch,offset)=>epoch?new Date((Number(epoch)+Number(offset||0))*1000).toISOString().slice(11,16):"";
// Fiche détaillée FR24 : heures réelles / estimées / programmées (epoch UTC) converties à l'heure locale de chaque aéroport.
export function parseDetail(j){
  const t=j?.time;if(!t||!j?.identification)return null;
  const offO=j.airport?.origin?.timezone?.offset??7200,offD=j.airport?.destination?.timezone?.offset??0;
  const real=t.real||{},est=t.estimated||{},sch=t.scheduled||{};
  return {
    atd:localHM(real.departure,offO),ata:localHM(real.arrival,offD),
    etd:real.departure?"":localHM(est.departure,offO),eta:real.arrival?"":localHM(est.arrival,offD),
    sta:localHM(sch.arrival,offD),gate:clean(j.airport?.origin?.info?.gate),
    reg:upper(j.aircraft?.registration),acType:upper(j.aircraft?.model?.code)
  };
}
// Entrée "live" du bon vol au départ de l'aéroport attendu ; null si le vol n'est pas en l'air.
export function parseLive(payload,flight,origin="CDG"){
  const list=Array.isArray(payload?.results)?payload.results:[];
  const hit=list.find(r=>r?.type==="live"&&upper(r?.detail?.flight)===flight&&(!origin||!upper(r?.detail?.schd_from)||upper(r.detail.schd_from)===origin));
  if(!hit)return null;
  return {id:clean(hit.id),reg:upper(hit.detail?.reg),acType:upper(hit.detail?.ac_type)};
}
function apply(x,field,value,at,PROVIDER){
  const next=clean(value),from=clean(x[field]);
  if(!next||next===from||!mayWriteField(x,field,PROVIDER))return false;
  const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source:PROVIDER,field,from,to:next});x.flightInfoLog=log.slice(0,160);
  x[field]=next;x[field+"Source"]=PROVIDER;x[field+"UpdatedAt"]=at;
  return true;
}

async function runFlightradarQueue(env,cfg){
  const PROVIDER=cfg.PROVIDER,P=cfg.prefix;
  if(!frKey(env,cfg)||!env?.OPS_DB)return {ok:true,skipped:`${PROVIDER}_NON_CONFIGURE`};
  const now=parisNow(),yesterday=parisDateAt(Date.now()-86400000);
  const maps=await Promise.all([queuedFieldMap(env,PROVIDER,now.date),queuedFieldMap(env,PROVIDER,yesterday)]),authority=new Map();
  for(const map of maps)for(const [id,fields] of map){if(!authority.has(id))authority.set(id,new Set());for(const f of fields)authority.get(id).add(f)}
  if(!authority.size)return {ok:true,skipped:`${PROVIDER}_QUEUE_VIDE`};
  const u=await usage(env,now,PROVIDER);
  if(u.day>=DAY_CAP||u.month>=MONTH_CAP)return {ok:true,skipped:`${PROVIDER}_QUOTA`,day:u.day,month:u.month};
  const {results=[]}=await env.OPS_DB.prepare(`SELECT identity,flight_date,airline,flight_number,std,data_json FROM flights WHERE flight_date IN (?,?) ORDER BY flight_date,std,flight_number`).bind(yesterday,now.date).all();
  const candidates=[];
  for(const row of results){
    const allowed=authority.get(row.identity);if(!allowed?.size)continue;
    let x={};try{x=JSON.parse(row.data_json||"{}")}catch{}
    if(stopAll(x))continue;
    const d=delta(row.flight_date,x.std||row.std,now),needs=buildNeeds(x,d);
    if(!cfg.fields.some(f=>allowed.has(f)&&(needs[f]||(f==="ata"&&needs.ata_late))))continue;
    if(d>30)continue;
    // Deux API équivalentes (mêmes données) : on répartit les vols entre elles selon la parité du numéro de vol.
    // Deux API équivalentes : les vols sont répartis entre elles selon la parité du numéro de vol.
    if([...fullFlight(x,row)].reduce((a,c)=>a+c.charCodeAt(0),0)%2!==cfg.slot)continue;                                   // au sol avant le départ : pas de fiche « live »
    if(!globalThis.__ALYZIA_MANUAL_PUSH&&ageMs(x[P+"LastCheckedAt"])<COOLDOWN_MIN*60000)continue;
    if(Number(x[P+"NotLiveAttempts"]||0)>=MAX_NOT_LIVE)continue;
    if(Number(x[P+"Attempts"]||0)>=MAX_ATTEMPTS_PER_FLIGHT)continue;
    candidates.push({row,x,d,allowed,prio:priorityScore(x,d)});
  }
  // Vols partis le plus récemment d'abord (probablement encore en l'air).
  candidates.sort((a,b)=>Math.abs(a.d)-Math.abs(b.d));
  const room=Math.max(0,Math.min(globalThis.__ALYZIA_MANUAL_PUSH?3:MAX_PER_RUN,DAY_CAP-u.day,MONTH_CAP-u.month)),items=[];
  for(const z of candidates.slice(0,room)){
    const flight=fullFlight(z.x,z.row);if(!flight)continue;
    const at=new Date().toISOString(),changed=[];
    z.x[P+"Attempts"]=Number(z.x[P+"Attempts"]||0)+1;
    z.x[P+"LastCheckedAt"]=at;
    let id=cfg.details?clean(z.x.fr24LiveId):"",lastStatus=0,stop=false;
    if(!id){
      const r=await fetchSearch(env,flight,cfg);
      await bump(env,now,r.status,PROVIDER);lastStatus=r.status;
      if([401,403,429].includes(r.status)||r.status>=500)stop=true;
      if(r.ok){
        const live=parseLive(r.payload,flight,upper(z.x.origin||"CDG"));
        if(live){
          id=live.id;if(cfg.details&&id)z.x.fr24LiveId=id;
          if(z.allowed.has("reg")&&apply(z.x,"reg",live.reg,at,PROVIDER))changed.push("reg");
          // Fiche « live » = l'avion a décollé. Sans heure réelle chez le fournisseur, on pose un ATD ESTIMÉ (ETD sinon STD, jamais plus tard que maintenant)
          // avec la source FLIGHTRADAR8_EST : tout fournisseur qui donne le vrai ATD le remplacera.
          if(cfg.atd&&z.allowed.has("atd")&&(!clean(z.x.atd)||["—","-"].includes(clean(z.x.atd)))){
            const base=/^\d{2}:\d{2}$/.test(clean(z.x.etd))?clean(z.x.etd):clean(z.x.std||z.row.std),m=base.match(/^(\d{2}):(\d{2})$/);
            if(m){const est=Math.min(Number(m[1])*60+Number(m[2]),now.minutes),hm=String(Math.floor(est/60)).padStart(2,"0")+":"+String(est%60).padStart(2,"0");
              const log=Array.isArray(z.x.flightInfoLog)?z.x.flightInfoLog:[];log.unshift({at,source:PROVIDER+"_EST",field:"atd",from:"",to:hm,reason:"départ prouvé (vol en l'air), heure estimée"});z.x.flightInfoLog=log.slice(0,160);
              z.x.atd=hm;z.x.atdSource=PROVIDER+"_EST";z.x.atdUpdatedAt=at;z.x.providerStatusRaw=clean(z.x.providerStatusRaw)&&/CANCEL|LANDED|ARRIV/i.test(z.x.providerStatusRaw)?z.x.providerStatusRaw:"AIRBORNE";changed.push("atd~")}
          }
          if(live.acType&&await noteAndSwitch(env,z.x,live.acType,PROVIDER,at))changed.push("aircraft");
        }else z.x[P+"NotLiveAttempts"]=Number(z.x[P+"NotLiveAttempts"]||0)+1;
      }
    }
    // Fiche détaillée (vraies heures) : uniquement Flightradar8, pour les vols dont on connaît l'id « live ».
    if(cfg.details&&id&&!stop){
      const dr=await fetchDetails(env,id,cfg);
      await bump(env,now,dr.status,PROVIDER);lastStatus=dr.status;
      if(dr.ok){
        const d=parseDetail(dr.payload);
        if(d){
          for(const f of ["atd","ata","etd","eta","sta","gate","reg"])if(z.allowed.has(f)&&apply(z.x,f,d[f],at,PROVIDER))changed.push(f);
          if(d.acType&&await noteAndSwitch(env,z.x,d.acType,PROVIDER,at))changed.push("aircraft");
        }
      }else if(dr.status===404||dr.status===400)delete z.x.fr24LiveId;
      if([401,403,429].includes(dr.status)||dr.status>=500)stop=true;
    }
    z.x[P+"LastStatus"]=lastStatus;
    await env.OPS_DB.prepare(`UPDATE flights SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE identity=?`).bind(JSON.stringify(z.x),z.row.identity).run();
    items.push({flight,status:lastStatus,changed});
    if(stop)break;
  }
  return {ok:true,processed:items.length,items};
}

export const runFlightradar1Queue=env=>runFlightradarQueue(env,CONFIGS.FLIGHTRADAR1);
export const runFlightradar8Queue=env=>runFlightradarQueue(env,CONFIGS.FLIGHTRADAR8);
