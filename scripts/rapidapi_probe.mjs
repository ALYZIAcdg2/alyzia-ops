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
const deep=(v,d=0)=>{if(Array.isArray(v))return d>4?`[${v.length}]`:[`len${v.length}`,...v.slice(0,2).map(x=>deep(x,d+1))];if(v&&typeof v==="object")return d>5?"{…}":Object.fromEntries(Object.entries(v).slice(0,40).map(([k,x])=>[k,deep(x,d+1)]));return typeof v==="string"?v.slice(0,40):v};
async function callDeep(name,host,path,key,pick){
  const url=`https://${host}${path}`;
  const r=await fetch(url,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(20000)});
  const j=await r.json().catch(()=>null);
  console.log(`\n### ${name} ${path}\nHTTP ${r.status} restant=${r.headers.get("x-ratelimit-requests-remaining")}/${r.headers.get("x-ratelimit-requests-limit")}`);
  console.log(JSON.stringify(deep(pick?pick(j):j)).slice(0,3500));
}
await callDeep("flightradar24-data","flightradar24-data.p.rapidapi.com",`/flights/flight-info?query=${FL}`,keys.fr24,j=>j?.data?.response?.data);
await callDeep("flight-radar8","flight-radar8.p.rapidapi.com",`/flights/flight-by-route?airportFrom=${ROUTE[0]}&airportTo=${ROUTE[1]}`,keys.fr8);
