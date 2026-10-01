// Génère public/airports.json : { "TRS": ["TRIESTE","Europe/Rome","LIPQ"], ... } (IATA -> ville, fuseau, ICAO)
// Source : OurAirports (domaine public). Usage :
//   curl -o airports.csv https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv
//   npm i tz-lookup csv-parse && node scripts/build-airports.mjs airports.csv public/airports.json
import {readFileSync,writeFileSync} from "node:fs";
import {parse} from "csv-parse/sync";
import tz from "tz-lookup";
const strip=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
// Nom de ville lisible : municipalité nettoyée (parenthèses, virgule, « A/B » -> le segment présent dans le nom de l'aéroport),
// sinon début du nom de l'aéroport (« Lyon Saint-Exupéry Airport » -> LYON SAINT-EXUPÉRY).
function cityOf(r){
  const name=String(r.name||"").trim(),nameN=strip(name),m0=String(r.municipality||"").trim();
  let m=m0.replace(/\s*\(.*?\)/g,"").split(",")[0].trim();
  if(m.includes("/")){const segs=m.split("/").map(x=>x.trim()).filter(Boolean);m=segs.find(x=>nameN.includes(strip(x)))||segs[0]}
  if(!m0.includes(","))return (m||name).toUpperCase();   // municipalité simple : on la garde
  const fromName=name.split(/\s+[-–—(]|\s+(?:International|Intl|Airport|Aeroporto|Aéroport|Aeropuerto|Flughafen|Airfield|Regional|Municipal)\b/i)[0].trim();
  const tokens=strip(m).split(/[^A-Z0-9]+/).filter(t=>t.length>2);
  return (m&&tokens.some(t=>nameN.includes(t))?m:(fromName||m||name)).toUpperCase();
}
const [src="airports.csv",dst="public/airports.json"]=process.argv.slice(2);
const rows=parse(readFileSync(src,"utf8"),{columns:true,skip_empty_lines:true});
const out={};
for(const r of rows){
  const iata=String(r.iata_code||"").trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(iata))continue;
  if(!["large_airport","medium_airport","small_airport"].includes(r.type))continue;
  const lat=Number(r.latitude_deg),lon=Number(r.longitude_deg);
  let zone="";try{zone=tz(lat,lon)}catch{}
  if(!zone)continue;
  const city=cityOf(r);
  const icao=String(r.icao_code||r.ident||"").trim().toUpperCase();
  const score=(r.scheduled_service==="yes"?2:0)+(r.type==="large_airport"?2:r.type==="medium_airport"?1:0);
  if(out[iata]&&out[iata].score>=score)continue;
  out[iata]={score,v:[city,zone,/^[A-Z0-9]{4}$/.test(icao)?icao:""]};
}
const final={};for(const k of Object.keys(out).sort())final[k]=out[k].v;
writeFileSync(dst,JSON.stringify(final));
console.log(Object.keys(final).length,"aéroports ->",dst);
