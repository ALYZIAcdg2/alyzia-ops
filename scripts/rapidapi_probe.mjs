// Sonde flightradar24-com (things4u) : lit les messages d'erreur (paramètres requis) et la structure des réponses. Jamais la clé.
const key=process.env.RAPIDAPI_KEY||"";
if(!key){console.log("pas de clé");process.exit(0)}
const host=process.env.HOSTNAME_API||"flightradar24-com.p.rapidapi.com";
const deep=(v,d=0)=>{if(Array.isArray(v))return d>5?`[${v.length}]`:[`len${v.length}`,...v.slice(0,3).map(x=>deep(x,d+1))];if(v&&typeof v==="object")return d>7?"{…}":Object.fromEntries(Object.entries(v).slice(0,40).map(([k,x])=>[k,deep(x,d+1)]));return typeof v==="string"?v.slice(0,60):v};
async function call(path){
  try{
    const r=await fetch(`https://${host}${path}`,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(25000)});
    const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
    console.log(`\n### ${path}\nHTTP ${r.status} restant=${r.headers.get("x-ratelimit-requests-remaining")}/${r.headers.get("x-ratelimit-requests-limit")}`);
    console.log(j?JSON.stringify(deep(j)).slice(0,3200):text.slice(0,300));
  }catch(e){console.log(`\n### ${path}\nERREUR ${e.message}`)}
}
await call("/airports/search?q=CDG");
await call("/airports/departures/load-earlier-flights?airport_id=CDG");
await call("/v2/flights/search?query=TK1822");
