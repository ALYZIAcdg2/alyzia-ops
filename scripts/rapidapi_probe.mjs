// Sonde flightradar24-com : pagination des départs CDG (pages 1, 2, 3, 12) – dates de départ programmées min/max de chaque page. Jamais la clé.
const key=process.env.RAPIDAPI_KEY||"";
if(!key){console.log("pas de clé");process.exit(0)}
const host="flightradar24-com.p.rapidapi.com";
const fmt=t=>t?new Date(t*1000).toISOString().slice(0,16)+"Z":"-";
async function page(n,extra=""){
  const path=`/airports/departures/load-earlier-flights?airport_id=CDG&page=${n}${extra}`;
  const r=await fetch(`https://${host}${path}`,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(30000)});
  const j=await r.json().catch(()=>null);
  const list=j?.data?.airport?.pluginData?.schedule?.departures?.data||[];
  const sd=list.map(x=>x.flight?.time?.scheduled?.departure).filter(Boolean);
  const real=list.filter(x=>x.flight?.time?.real?.departure).length,arr=list.filter(x=>x.flight?.time?.real?.arrival).length;
  const bytes=JSON.stringify(j||{}).length;
  console.log(`page ${n}${extra}: HTTP ${r.status} restant=${r.headers.get("x-ratelimit-requests-remaining")} | page renvoyée=${j?.currentPage}/${j?.totalPages} | ${list.length} vols | départs prévus ${fmt(Math.min(...sd))} → ${fmt(Math.max(...sd))} | départs réels ${real} | arrivées réelles ${arr} | ~${Math.round(bytes/1024)} Ko`);
  console.log("  exemples:",list.slice(0,3).map(x=>x.flight?.identification?.number?.default).join(","),"...",list.slice(-2).map(x=>x.flight?.identification?.number?.default).join(","));
}
await page(1);
await page(2);
await page(3);
