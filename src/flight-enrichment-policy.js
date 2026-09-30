const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();
export const isMissing=v=>!clean(v)||["—","-","N/A","NULL"].includes(upper(v));

const API_SOURCES=[
  "OAG","OAG_STATUS","OAG_SCHEDULE","OAG_H2_RECOVERY",
  "AIRLABS","AIRLABS_LIVE_RECOVERY","AIRLABS_ROUTE","AIRLABS_ROUTE_TODAY",
  "SKYLINK","SKYLINK_LIVE_RECOVERY","SKYLINK_J0_BACKFILL","SKYLINK_ENT_ALIAS",
  "AERODATABOX","AERODATABOX_REG","QUARK","AVIATIONDATA","FLIGHTERA","FLIGHTRADAR1","FR24DEP","OPENSKY_ADSB","ALYZIA_OPS_STATE"
];
const FINAL_FIELDS=new Set(["std","sta","atd","ata","gate","reg"]);

export const FIELD_MATRIX={
  std:{providers:["OAG_SCHEDULE","AIRLABS","SKYLINK","AERODATABOX"],window:[-1440,10080]},
  sta:{providers:["OAG_SCHEDULE","AIRLABS","SKYLINK","AERODATABOX"],window:[-1440,10080]},
  etd:{providers:["OAG_STATUS","AIRLABS","SKYLINK","AERODATABOX"],window:[-60,240]},
  eta:{providers:["OAG_STATUS","AIRLABS","SKYLINK","AERODATABOX"],window:[-1800,60]},
  atd:{providers:["OAG_STATUS","SKYLINK","AIRLABS","AERODATABOX"],window:[-1080,30]},
  ata:{providers:["OAG_STATUS","AIRLABS","SKYLINK","AERODATABOX"],window:[-1080,30]},
  gate:{providers:["OAG_STATUS","SKYLINK","AIRLABS","AERODATABOX"],window:[-60,240]},
  reg:{providers:["OPENSKY","SKYLINK","AIRLABS","AERODATABOX"],window:[-360,180]}
};

export function isCancelled(x={}){
  return /CANCEL|ANNUL/.test(upper(x.status||x.opsStatus||x.flight_status));
}
export function hasDeparted(x={}){
  if(!isMissing(x.atd))return true;
  return /(DEPARTED|AIRBORNE|EN\s*ROUTE|IN\s*FLIGHT|TOOK\s*OFF|DÉCOLLÉ|DECOLLE|LANDED|ARRIVED|COMPLETED)/i.test(clean(x.status||x.opsStatus||x.flight_status||x.providerStatusRaw));
}
export function hasArrived(x={}){
  if(!isMissing(x.ata))return true;
  return /(LANDED|ARRIVED|COMPLETED)/i.test(clean(x.status||x.opsStatus||x.flight_status||x.providerStatusRaw));
}
export function flightComplete(x={}){
  return !isMissing(x.std)&&!isMissing(x.sta)&&!isMissing(x.atd)&&!isMissing(x.ata)&&!isMissing(x.gate)&&!isMissing(x.reg);
}
export function stopAll(x={}){return isCancelled(x)||flightComplete(x)}

function inWindow(d,[min,max]){return Number.isFinite(d)&&d>=min&&d<=max}
function minuteOfDay(v){const m=clean(v).match(/^(\d{2}):(\d{2})$/);return m?Number(m[1])*60+Number(m[2]):null}
function minuteDelta(a,b){const x=minuteOfDay(a),y=minuteOfDay(b);if(x==null||y==null)return 0;let d=y-x;if(d<-720)d+=1440;if(d>720)d-=1440;return d}
function durationMinutes(x={}){
  for(const v of [x.duration,x.durationMinutes,x.flightDuration,x.flight_duration,x.scheduledDuration,x.scheduled_duration]){
    if(typeof v==="number"&&Number.isFinite(v)&&v>0)return Math.round(v);
    const s=clean(v),m=s.match(/^(\d{1,2}):(\d{2})$/);if(m)return Number(m[1])*60+Number(m[2]);
  }
  return null;
}
export function arrivalDelta(x={},departureDelta=99999){
  const duration=durationMinutes(x);
  if(!Number.isFinite(departureDelta)||duration==null)return null;
  return departureDelta+duration+minuteDelta(x.sta,x.eta);
}

export function buildNeeds(x={},d=99999){
  if(stopAll(x))return {std:false,sta:false,etd:false,eta:false,atd:false,ata:false,gate:false,reg:false,any:false};
  const departed=hasDeparted(x),arrived=hasArrived(x),arrD=arrivalDelta(x,d);
  const atdWindow=inWindow(d,FIELD_MATRIX.atd.window);
  const ataWindow=arrD==null?false:inWindow(arrD,FIELD_MATRIX.ata.window);
  const needs={
    std:isMissing(x.std),
    sta:isMissing(x.sta),
    etd:!departed&&isMissing(x.etd)&&inWindow(d,FIELD_MATRIX.etd.window),
    eta:departed&&!arrived&&isMissing(x.eta)&&inWindow(d,FIELD_MATRIX.eta.window),
    // A provider status is evidence, not the final timestamp: keep chasing ATD until ATD exists.
    atd:isMissing(x.atd)&&(departed||atdWindow),
    // Same rule for arrival: ARRIVED/LANDED must not stop ATA recovery while ATA is missing.
    ata:isMissing(x.ata)&&(arrived||ataWindow),
    gate:!departed&&isMissing(x.gate)&&inWindow(d,FIELD_MATRIX.gate.window),
    reg:isMissing(x.reg)&&inWindow(d,FIELD_MATRIX.reg.window)
  };
  needs.any=Object.values(needs).some(Boolean);
  return needs;
}

const PROVIDER_FIELDS={
  OAG_SCHEDULE:["std","sta"],
  OAG_STATUS:["etd","eta","atd","ata","gate"],
  AIRLABS:["sta","etd","eta","atd","ata","gate","reg"],
  SKYLINK:["sta","etd","eta","atd","ata","gate","reg"],
  OPENSKY:["atd","reg"],
  AERODATABOX:["std","sta","etd","eta","atd","ata","gate","reg"],
  QUARK:["etd","eta","gate"],
  AVIATIONDATA:["atd","ata"],
  FLIGHTERA:["etd","eta","atd","ata","gate","reg"],
  FLIGHTRADAR1:["reg"],
  FR24DEP:["etd","eta","atd","ata","gate","reg"]
};
export function providerNeeded(provider,x={},d=99999){
  if(stopAll(x))return false;
  const needs=buildNeeds(x,d),fields=PROVIDER_FIELDS[provider]||[];
  return fields.some(f=>needs[f]);
}
export function neededFields(provider,x={},d=99999){
  const needs=buildNeeds(x,d),fields=PROVIDER_FIELDS[provider]||[];
  return fields.filter(f=>needs[f]);
}

export function cadenceMinutes(provider,x={},d=99999){
  if(stopAll(x))return Infinity;
  const n=buildNeeds(x,d);
  if(provider==="OPENSKY")return d<=20&&d>=-75?10:Infinity;
  if(provider==="AIRLABS")return d<=30&&d>=-240&&(n.atd||n.etd||n.gate||n.reg)?20:(n.ata?30:90);
  if(provider==="SKYLINK")return n.ata?30:(d<=30&&d>=-240?30:60);
  if(provider==="OAG_STATUS")return n.ata?15:(d<=30&&d>=-240?15:(d<=120&&d>=-360?30:60));
  return 90;
}

export function mayWriteField(x={},field,source=""){
  if(isMissing(x[field]))return true;
  if(FINAL_FIELDS.has(field))return false;
  if(field==="etd"&&hasDeparted(x))return false;
  if(field==="eta"&&hasArrived(x))return false;
  const current=upper(x[field+"Source"]);
  return API_SOURCES.some(s=>current===s||current.startsWith(`${s}_`))&&API_SOURCES.some(s=>upper(source)===s||upper(source).startsWith(`${s}_`));
}

export function priorityScore(x={},d=99999){
  const n=buildNeeds(x,d);
  if(n.atd&&d<=-30)return 0;
  if(n.atd)return 1;
  if(n.ata)return 2;
  if(n.etd)return 3;
  if(n.gate||n.reg)return 4;
  if(n.eta)return 5;
  if(n.sta||n.std)return 6;
  return 99;
}
