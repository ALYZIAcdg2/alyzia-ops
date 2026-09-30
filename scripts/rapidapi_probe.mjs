// Sonde flight-radar1 / flight-radar8 : la recherche donne un id de vol « live » ; existe-t-il un endpoint de détail avec les heures ? Jamais la clé.
const key=process.env.RAPIDAPI_KEY||"";
if(!key){console.log("pas de clé");process.exit(0)}
const deep=(v,d=0)=>{if(Array.isArray(v))return d>4?`[${v.length}]`:[`len${v.length}`,...v.slice(0,1).map(x=>deep(x,d+1))];if(v&&typeof v==="object")return d>6?"{…}":Object.fromEntries(Object.entries(v).filter(([k])=>!/image|logo|photo|trail/i.test(k)).slice(0,40).map(([k,x])=>[k,deep(x,d+1)]));return typeof v==="string"?v.slice(0,50):v};
async function get(host,path){
  try{
    const r=await fetch(`https://${host}${path}`,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(25000)});
    const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
    return {status:r.status,remaining:r.headers.get("x-ratelimit-requests-remaining"),j,text};
  }catch(e){return {status:0,j:null,text:String(e.message)}}
}
const fl=process.env.FLIGHT||"SQ335";
for(const host of ["flight-radar1.p.rapidapi.com"]){
  console.log(`\n===== ${host} =====`);
  const s=await get(host,`/flights/search?query=${fl}&limit=10`);
  const live=(s.j?.results||[]).find(r=>r.type==="live");
  console.log(`search ${fl}: HTTP ${s.status} restant=${s.remaining} | live: ${live?live.id+" "+live.label:"aucun"}`);
  if(!live)continue;
  const id=live.id;
  for(const p of [`/flights/details?flight=${id}`,`/flights/detail?flight=${id}`,`/flights/get-more-info?flight=${id}`,`/flights/get-more-info?query=${id}&limit=1`,`/flights/get-flight?flight=${id}`,`/flights/flight-info?flight=${id}`,`/flights/get-details?flight=${id}`,`/flights/live-details?flight=${id}`]){
    const r=await get(host,p);
    const ok=r.status===200;
    console.log(`${ok?"OK  ":"    "}${p} -> HTTP ${r.status}${ok?" restant="+r.remaining:""} ${ok?"":(r.j?.message||r.text).slice(0,80)}`);
    if(ok){console.log(JSON.stringify(deep(r.j)).slice(0,2800));break}
  }
}
