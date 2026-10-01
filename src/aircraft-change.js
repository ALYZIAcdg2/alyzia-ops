// Détection du changement d'appareil entre l'IMPORT (x.aircraft, code IATA de l'Excel : 789, 32Q, 73H…) et le type RÉEL
// remonté par un fournisseur (code ICAO : B789, A21N, B738…). Le type réel est mémorisé dans x.aircraftActual ;
// x.aircraftChange = {from,to,source,at} n'existe que si les deux appareils diffèrent réellement (variantes équivalentes ignorées).
const clean=v=>String(v??"").trim();
const upper=v=>clean(v).toUpperCase();

const ICAO_TO_IATA={
  B788:"788",B789:"789",B78X:"78X",B772:"772",B77L:"77L",B77W:"77W",B773:"773",B744:"744",B748:"748",B752:"752",B753:"753",B763:"763",B764:"764",
  B737:"73G",B738:"738",B739:"739",B38M:"7M8",B39M:"7M9",B734:"734",
  A318:"318",A319:"319",A320:"320",A321:"321",A19N:"31N",A20N:"32N",A21N:"32Q",
  A306:"306",A310:"310",A332:"332",A333:"333",A338:"338",A339:"339",A342:"342",A343:"343",A345:"345",A346:"346",A359:"359",A35K:"351",A388:"388",
  E170:"E70",E75L:"E75",E75S:"E75",E190:"E90",E195:"E95",E290:"E290",E295:"295",
  AT72:"AT7",AT75:"AT7",AT76:"AT7",DH8D:"DH4",CRJ7:"CR7",CRJ9:"CR9",CRJX:"CRK",BCS1:"221",BCS3:"223",
};
// Codes IATA d'équipement considérés comme le MÊME appareil (variantes winglets / sièges). 32N (A320neo) et 32Q (A321neo) restent distincts.
const STRICT=[["738","73H","73W","73J","7S8"],["320","32A"],["321","32S","32B"],["7M8","38M"],["763","76W"],["32Q","N32"],["359","35D"]];
// Codes sous lesquels le catalogue cabines peut ranger le même appareil (ex. LY enregistre son 777-200 en « 777 » alors que le type réel remonte « 772 »).
const CONFIG_ALIASES={"772":["777"],"777":["772"],"32Q":["N32"],"N32":["32Q"],"321":["32B","32S"],"32B":["321"],"32S":["321"],"763":["76W"],"76W":["763"],"738":["73H","7S8"],"73H":["738"],"7S8":["738"],"359":["35D"],"35D":["359"]};
export function configCodes(code){const c=upper(code);return c?[c,...(CONFIG_ALIASES[c]||[])]:[]}

export function toIata(raw){
  const v=upper(raw);if(!v)return "";
  if(ICAO_TO_IATA[v])return ICAO_TO_IATA[v];
  return /^[A-Z0-9]{3}$/.test(v)?v:"";
}
export function sameAircraft(a,b){
  const x=upper(a),y=upper(b);if(!x||!y)return true;
  if(x===y)return true;
  return STRICT.some(g=>g.includes(x)&&g.includes(y));
}
// Retourne true si x a été modifié. N'écrase jamais x.aircraft (import) : le type réel est ajouté à côté.
export async function noteAndSwitch(env,x,rawType,source,at){
  const changed=noteActualAircraft(x,rawType,source,at);
  if(x.aircraftChange){try{const m=await import("./index.js");if(await m.applyCabinConfigForActualAircraft(env,x))return true}catch(_){}}
  return changed;
}
export function noteActualAircraft(x,rawType,source,at){
  const actual=toIata(rawType);if(!actual)return false;
  const imported=upper(x.aircraftImported||x.aircraft);
  let changed=false;
  if(upper(x.aircraftActual)!==actual){x.aircraftActual=actual;x.aircraftActualSource=source;x.aircraftActualUpdatedAt=at;changed=true}
  const differs=imported&&imported!=="NON RENSEIGNÉ"&&!sameAircraft(imported,actual);
  if(differs){
    const cur=x.aircraftChange;
    if(!cur||cur.to!==actual||cur.from!==imported){x.aircraftChange={from:imported,to:actual,source,at};changed=true;
      const log=Array.isArray(x.flightInfoLog)?x.flightInfoLog:[];log.unshift({at,source,field:"aircraftChange",from:imported,to:actual});x.flightInfoLog=log.slice(0,160)}
  }else if(x.aircraftChange){delete x.aircraftChange;changed=true}
  return changed;
}
