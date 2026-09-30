// Sonde flightradar24-live-api1 (Glavier) : messages d'erreur (paramètres requis) et structure des réponses. Jamais la clé.
const key=process.env.RAPIDAPI_KEY||"";
if(!key){console.log("pas de clé");process.exit(0)}
const host="flightradar24-live-api1.p.rapidapi.com";
const deep=(v,d=0)=>{if(Array.isArray(v))return d>4?`[${v.length}]`:[`len${v.length}`,...v.slice(0,2).map(x=>deep(x,d+1))];if(v&&typeof v==="object")return d>6?"{…}":Object.fromEntries(Object.entries(v).filter(([k])=>!/image|logo|photo/i.test(k)).slice(0,40).map(([k,x])=>[k,deep(x,d+1)]));return typeof v==="string"?v.slice(0,60):v};
for(const path of (process.env.PATHS||"/Arrivals,/arrivals").split(",")){
  try{
    const r=await fetch(`https://${host}${path}`,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(25000)});
    const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
    console.log(`\n### ${path}\nHTTP ${r.status} limite=${r.headers.get("x-ratelimit-requests-limit")} restant=${r.headers.get("x-ratelimit-requests-remaining")} taille=${text.length}`);
    console.log(j?JSON.stringify(deep(j)).slice(0,2500):text.slice(0,300));
  }catch(e){console.log(`\n### ${path}\nERREUR ${e.message}`)}
}
