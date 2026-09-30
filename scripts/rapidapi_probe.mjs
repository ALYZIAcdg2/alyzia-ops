// Sonde les 5 API RapidAPI avec un vol réel du jour et affiche statut, en-têtes de quota et structure de la réponse (jamais la clé).
const base=process.env.RAPIDAPI_KEY||"";
const keys={flightera:process.env.RAPIDAPI_KEY_FLIGHTERA||base,fr1:process.env.RAPIDAPI_KEY_FR1||base,fr8:process.env.RAPIDAPI_KEY_FR8||base,fr24:process.env.RAPIDAPI_KEY_FR24||base};
console.log("clés disponibles:",Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,v?`oui(${v.length} car.)`:"NON"])));
const today=new Date().toISOString().slice(0,10);
const FL="TK1830",FLNUM="1830",ROUTE=["CDG","IST"];
const shape=(v,d=0)=>{if(Array.isArray(v))return d>2?`[${v.length}]`:[v.length,v[0]!==undefined?shape(v[0],d+1):null];if(v&&typeof v==="object")return d>2?"{…}":Object.fromEntries(Object.entries(v).slice(0,25).map(([k,x])=>[k,shape(x,d+1)]));return typeof v==="string"?v.slice(0,40):v};
async function call(name,host,path,key){
  if(!key){console.log(`\n### ${name} ${path}: PAS DE CLÉ`);return}
  const url=`https://${host}${path}`;
  try{
    const r=await fetch(url,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(20000)});
    const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
    const q=["x-ratelimit-requests-limit","x-ratelimit-requests-remaining","x-ratelimit-limit","x-ratelimit-remaining"].map(h=>r.headers.get(h)?`${h}=${r.headers.get(h)}`:"").filter(Boolean).join(" ");
    console.log(`\n### ${name} ${path}\nHTTP ${r.status} ${q}`);
    console.log(j?JSON.stringify(shape(j)).slice(0,1400):text.slice(0,300));
  }catch(e){console.log(`\n### ${name} ${path}: ERREUR ${e.message}`)}
}
const E=encodeURIComponent;
await call("flightera","flightera-flight-data.p.rapidapi.com",`/flight/info?flnr=${FL}&date=${today}`,keys.flightera);
await call("flightera","flightera-flight-data.p.rapidapi.com",`/flight/info?flnr=${FL}`,keys.flightera);
await call("flight-radar1","flight-radar1.p.rapidapi.com",`/flights/search?query=${FL}&limit=5`,keys.fr1);
await call("flight-radar8","flight-radar8.p.rapidapi.com",`/flights/search?query=${FL}&limit=5`,keys.fr8);
await call("flight-radar8","flight-radar8.p.rapidapi.com",`/flights/flight-by-route?origin=${ROUTE[0]}&destination=${ROUTE[1]}`,keys.fr8);
await call("flight-radar8","flight-radar8.p.rapidapi.com",`/flights/flight-by-route?from=${ROUTE[0]}&to=${ROUTE[1]}`,keys.fr8);
await call("flightradar24-data","flightradar24-data.p.rapidapi.com",`/flights/flight-info?flight=${FL}`,keys.fr24);
await call("flightradar24-data","flightradar24-data.p.rapidapi.com",`/flights/flight-info?query=${FL}`,keys.fr24);
