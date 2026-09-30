const key=process.env.RAPIDAPI_KEY;
const host="quark-aviation-global-flight-tracking-intelligence-api.p.rapidapi.com";
if(!key){console.log("no key");process.exit(0)}
async function get(path){try{const r=await fetch(`https://${host}${path}`,{headers:{Accept:"application/json","X-RapidAPI-Key":key,"X-RapidAPI-Host":host}});return {s:r.status,t:await r.text()}}catch(e){return {s:0,t:String(e.message)}}}
const wNames=["airport_icao","icao_code","airport_iata","iata_code","code","airport_id","id","ident","location","query","q","station_id","airport_ident","icao_airport","airport_code_icao"];
const rO=["from","to","origin_airport","destination_airport","departure_airport","arrival_airport","origin_icao","destination_icao","from_airport","to_airport","dep","arr","source","dest","origin_code","destination_code","departure_iata","arrival_iata","departure_icao","arrival_icao","from_iata","to_iata","start","end"];
let hit=0;
for(const n of wNames)for(const v of ["LFPG","CDG"]){const r=await get(`/aviation_weather?${n}=${v}`);const j=r.t;if(r.s!==200||!/"icao":"KJFK"/.test(j)){console.log("WEATHER",n,v,r.s,j.replace(/\s+/g," ").slice(0,700));hit++;break}}
for(const n of rO){const r=await get(`/route_schedules?${n}=LFPG`);if(r.s!==200||!/"iata":"JFK"/.test(r.t)){console.log("ROUTE",n,r.s,r.t.replace(/\s+/g," ").slice(0,500));hit++}}
// paire complète
for(const [a,b] of [["origin_icao","destination_icao"],["departure_airport","arrival_airport"],["origin_airport","destination_airport"],["from","to"],["origin","destination"],["departure_icao","arrival_icao"]]){const r=await get(`/route_schedules?${a}=LFPG&${b}=SKBO`);if(!/"iata":"JFK"/.test(r.t)){console.log("ROUTE PAIR",a,b,r.s,r.t.replace(/\s+/g," ").slice(0,700));hit++}}
console.log("hits",hit);
