// Sonde flight-radar1 (apidojo) /flights/search : structure complète des résultats, jamais la clé.
const key=process.env.RAPIDAPI_KEY_FR1||process.env.RAPIDAPI_KEY||"";
if(!key){console.log("pas de clé");process.exit(0)}
const host="flight-radar1.p.rapidapi.com";
const deep=(v,d=0)=>{if(Array.isArray(v))return d>5?`[${v.length}]`:[`len${v.length}`,...v.slice(0,4).map(x=>deep(x,d+1))];if(v&&typeof v==="object")return d>6?"{…}":Object.fromEntries(Object.entries(v).slice(0,40).map(([k,x])=>[k,deep(x,d+1)]));return typeof v==="string"?v.slice(0,60):v};
for(const q of (process.env.QUERIES||"TK1822,LO332").split(",")){
  const r=await fetch(`https://${host}/flights/search?query=${encodeURIComponent(q)}&limit=10`,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(20000)});
  const j=await r.json().catch(()=>null);
  console.log(`\n### ${q} HTTP ${r.status} restant=${r.headers.get("x-ratelimit-requests-remaining")}/${r.headers.get("x-ratelimit-requests-limit")}`);
  console.log(JSON.stringify(deep(j?.results)).slice(0,3500));
  console.log("stats:",JSON.stringify(j?.stats?.count));
}
