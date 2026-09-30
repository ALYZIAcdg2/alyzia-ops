// Test réel de Flightradar8 (recherche puis fiche détaillée) sur un vol donné. Jamais la clé.
import {parseLive,parseDetail} from "../src/flightradar1-queue-runner.js";
const key=process.env.RAPIDAPI_KEY||"";
if(!key){console.log("pas de clé");process.exit(0)}
const host="flight-radar8.p.rapidapi.com",fl=process.env.FLIGHT||"FI543";
const get=async p=>{const r=await fetch(`https://${host}${p}`,{headers:{"x-rapidapi-key":key,"x-rapidapi-host":host,Accept:"application/json"},signal:AbortSignal.timeout(25000)});return {status:r.status,j:await r.json().catch(()=>null),remaining:r.headers.get("x-ratelimit-requests-remaining")}};
const s=await get(`/flights/search?query=${fl}&limit=10`);
const live=parseLive(s.j,fl,"CDG");
console.log(`search ${fl}: HTTP ${s.status} restant=${s.remaining} | live: ${live?JSON.stringify(live):"aucune fiche live"}`);
if(live){
  const d=await get(`/flights/details?flight=${live.id}`);
  console.log(`details: HTTP ${d.status} restant=${d.remaining}`);
  console.log("heures locales (Paris au départ, locale à l'arrivée):",JSON.stringify(parseDetail(d.j)));
  console.log("statut FR24:",d.j?.status?.text);
}
