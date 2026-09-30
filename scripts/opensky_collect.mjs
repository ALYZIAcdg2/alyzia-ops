// Collecte OpenSky depuis un serveur GitHub (OpenSky time out depuis Cloudflare) puis envoie les positions à l'application.
// Variables: ALYZIA_INGEST_URL (ex: https://<app>/api/opensky/ingest), OPENSKY_INGEST_TOKEN,
//            OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET (facultatifs: sans eux, accès anonyme)
const {ALYZIA_INGEST_URL,OPENSKY_INGEST_TOKEN,OPENSKY_CLIENT_ID,OPENSKY_CLIENT_SECRET}=process.env;
if(!ALYZIA_INGEST_URL||!OPENSKY_INGEST_TOKEN){console.error("ALYZIA_INGEST_URL et OPENSKY_INGEST_TOKEN sont requis");process.exit(1)}

async function token(){
  if(!OPENSKY_CLIENT_ID||!OPENSKY_CLIENT_SECRET)return "";
  try{
    const r=await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",{
      method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"client_credentials",client_id:OPENSKY_CLIENT_ID,client_secret:OPENSKY_CLIENT_SECRET}),
      signal:AbortSignal.timeout(15000)});
    if(!r.ok){console.warn("jeton refusé, accès anonyme:",r.status);return ""}
    return (await r.json()).access_token||"";
  }catch(e){console.warn("jeton indisponible, accès anonyme:",e.message);return ""}
}

// Découpe les 2 premiers champs d'une ligne CSV (guillemets simples ou doubles possibles).
function firstFields(line,n){
  const out=[];let i=0;
  while(out.length<n&&i<=line.length){
    let f="";
    if(line[i]==='"'||line[i]==="'"){
      const q=line[i++];
      while(i<line.length){if(line[i]===q){if(line[i+1]===q){f+=q;i+=2;continue}i++;break}f+=line[i++]}
      if(line[i]===",")i++;
    }else{
      const j=line.indexOf(",",i);
      if(j<0){f=line.slice(i);i=line.length+1}else{f=line.slice(i,j);i=j+1}
    }
    out.push(f);
  }
  return out;
}
export async function lookupRegistrations(file,wanted){
  const out={};
  const {existsSync,createReadStream}=await import("node:fs");
  if(!existsSync(file)||!wanted.length)return out;
  const {createInterface}=await import("node:readline");
  const want=new Set(wanted);
  let ci=0,cr=1,first=true;
  const rl=createInterface({input:createReadStream(file,{encoding:"utf8"}),crlfDelay:Infinity});
  for await(const line of rl){
    if(first){
      first=false;
      const h=firstFields(line,60).map(x=>x.replace(/['"]/g,"").trim().toLowerCase());
      const a=h.indexOf("icao24"),b=h.indexOf("registration");
      if(a>=0)ci=a;if(b>=0)cr=b;
      continue;
    }
    const f=firstFields(line,Math.max(ci,cr)+1);
    const id=String(f[ci]||"").trim().toLowerCase();
    if(want.has(id)){const reg=String(f[cr]||"").trim().toUpperCase();if(reg)out[id.toUpperCase()]=reg}
  }
  return out;
}

const t=await token();
const headers={Accept:"application/json"};if(t)headers.Authorization=`Bearer ${t}`;
const r=await fetch("https://opensky-network.org/api/states/all?lamin=48.70&lamax=49.20&lomin=1.95&lomax=2.85",{headers,signal:AbortSignal.timeout(30000)});
console.log("opensky states:",r.status,t?"(authentifié)":"(anonyme)");
if(!r.ok)process.exit(1);
const data=await r.json();
// On n'envoie que les champs utiles: icao24, indicatif, altitude baro, au sol, vitesse (index 0,1,7,8,9).
const states=(data.states||[]).map(s=>[s[0],String(s[1]||"").trim(),null,null,null,null,null,s[7],s[8],s[9]]);
console.log("avions:",states.length);

// Immatriculations: base d'avions OpenSky (fichier CSV mis en cache par le workflow). icao24 -> registration.
const registrations=await lookupRegistrations(process.env.AIRCRAFT_DB||"aircraftDatabase.csv",states.map(x=>String(x[0]).toLowerCase()));
console.log("immatriculations trouvées:",Object.keys(registrations).length);

const res=await fetch(ALYZIA_INGEST_URL,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${OPENSKY_INGEST_TOKEN}`},body:JSON.stringify({states,registrations}),signal:AbortSignal.timeout(30000)});
const out=await res.text();
console.log("application:",res.status,out.slice(0,400));
if(!res.ok)process.exit(1);
