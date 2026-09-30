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
// Départs CDG : structure sans les images d'avions.
{
  const path="/airports/departures/load-earlier-flights?airport_id=CDG";
  const r=await fetch(`https://${host}${path}`,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(25000)});
  const j=await r.json().catch(()=>null);
  console.log(`### ${path}\nHTTP ${r.status} restant=${r.headers.get("x-ratelimit-requests-remaining")}/${r.headers.get("x-ratelimit-requests-limit")}`);
  console.log("top:",Object.keys(j||{}).join(","),"| page",j?.currentPage,"/",j?.totalPages,"| total",j?.totalResultCount,"| par page",j?.resultsPerPage);
  const d=j?.data||{};console.log("data keys:",Object.keys(d).join(","));
  for(const [k,v] of Object.entries(d)){if(k==="aircraftImages")continue;console.log(`- ${k}:`,Array.isArray(v)?`liste de ${v.length}`:typeof v)}
  const list=d.flights||d.departures||Object.values(d).find(v=>Array.isArray(v)&&v.length&&v[0]&&v[0].flight)||[];
  console.log("premiers vols:",JSON.stringify(deep(list.slice(0,2))).slice(0,3500));
}
