const key=process.env.RAPIDAPI_KEY;
const host="quark-aviation-global-flight-tracking-intelligence-api.p.rapidapi.com";
if(!key){console.log("no key");process.exit(0)}
async function call(path){
  try{const r=await fetch(`https://${host}${path}`,{headers:{Accept:"application/json","X-RapidAPI-Key":key,"X-RapidAPI-Host":host}});
    const t=await r.text();console.log(r.status,path,"\n  ",t.replace(/\s+/g," ").slice(0,1400));
  }catch(e){console.log("ERR",path,String(e.message).slice(0,100))}
}
// 1) sans paramètre : une API FastAPI liste les paramètres requis dans l'erreur 422
for(const p of ["/route_schedules","/aviation_weather"])await call(p);
// 2) essais plausibles
for(const p of [
 "/route_schedules?origin=CDG&destination=BOG","/route_schedules?departure=CDG&arrival=BOG","/route_schedules?origin_iata=CDG&destination_iata=BOG","/route_schedules?dep_iata=CDG&arr_iata=BOG",
 "/aviation_weather?airport=CDG","/aviation_weather?icao=LFPG","/aviation_weather?iata=CDG","/aviation_weather?airport_code=CDG","/aviation_weather?station=LFPG"])await call(p);
