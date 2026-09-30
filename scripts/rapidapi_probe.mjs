// Sonde flightradar24-live-api1 (Glavier) : /v1/airports/arrivals et /v1/airports/departures pour CDG. Jamais la clé.
const key=process.env.RAPIDAPI_KEY||"";
if(!key){console.log("pas de clé");process.exit(0)}
const host="flightradar24-live-api1.p.rapidapi.com";
const deep=(v,d=0)=>{if(Array.isArray(v))return d>4?`[${v.length}]`:[`len${v.length}`,...v.slice(0,1).map(x=>deep(x,d+1))];if(v&&typeof v==="object")return d>7?"{…}":Object.fromEntries(Object.entries(v).filter(([k])=>!/image|logo|photo/i.test(k)).slice(0,40).map(([k,x])=>[k,deep(x,d+1)]));return typeof v==="string"?v.slice(0,50):v};
const find=(v,path="",depth=0)=>{if(depth>8||!v||typeof v!=="object")return null;if(Array.isArray(v)){if(v.length>3&&v[0]&&typeof v[0]==="object")return {path,list:v};return null}for(const [k,x] of Object.entries(v)){const r=find(x,path+"."+k,depth+1);if(r)return r}return null};
for(const path of ["/v1/airports/arrivals?page=1&limit=100&code=ist","/v1/airports/arrivals?page=1&limit=20&code=cdg","/v1/airports/arrivals?page=1&limit=20&code=LFPG"]){
  try{
    const r=await fetch(`https://${host}${path}`,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(30000)});
    const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
    console.log(`\n### ${path}\nHTTP ${r.status} limite=${r.headers.get("x-ratelimit-requests-limit")} restant=${r.headers.get("x-ratelimit-requests-remaining")} taille=${Math.round(text.length/1024)}Ko`);
    if(!j){console.log(text.slice(0,300));continue}
    console.log("clés:",Object.keys(j).join(","));
    const hit=find(j);
    if(hit){
      console.log("chemin liste:",hit.path||"(racine)","| nombre:",hit.list.length);
      console.log("vol 1:",JSON.stringify(deep(hit.list[0])).slice(0,3000));
    }else console.log(JSON.stringify(deep(j)).slice(0,1500));
  }catch(e){console.log(`\n### ${path}\nERREUR ${e.message}`)}
}
