// Garde des routes d'administration et destructives.
// L'application n'a pas de connexion utilisateur : jusqu'ici n'importe qui connaissant l'adresse pouvait, par exemple,
// vider toute la base (/api/autopilot/full-reset, dont le texte de confirmation est lisible dans le dépôt public),
// supprimer les vols (DELETE /api/flights) ou relancer les traitements Gmail.
// Ces routes exigent maintenant "Authorization: Bearer <ALYZIA_API_SECRET>". Si le secret n'est pas défini côté Cloudflare, elles restent FERMÉES.
// Les routes utilisées par l'interface (vols, cabines, PREPA, 3 routes autopilot, gmail-clean/test-one-message) ne changent pas.
const FRONT_ALLOWED=new Set([
  "/api/autopilot/reconcile-labels",
  "/api/autopilot/specific-browser-complete",
  "/api/autopilot/sq-controlled-bridge",
  "/api/gmail-clean/test-one-message"
]);

export function isProtectedRoute(method,pathname){
  const p=String(pathname||"").toLowerCase().replace(/\/+$/,"");
  const m=String(method||"GET").toUpperCase();
  if(FRONT_ALLOWED.has(p))return false;
  if(p==="/api/autopilot"||p.startsWith("/api/autopilot/"))return true;
  if(p==="/api/gmail-clean"||p.startsWith("/api/gmail-clean/"))return true;
  if(p==="/api/flights"&&m==="DELETE")return true;
  if(p==="/api/cabin/seed"||p==="/api/cabin/recompute-classes"||p==="/api/cabin/equipment")return true;
  if(p==="/api/import-pipeline"||p.startsWith("/api/import-pipeline/"))return m!=="GET"&&m!=="HEAD"&&m!=="OPTIONS";
  if(p==="/api/gmail/sync-now")return true;
  if(p==="/api/oag/enrich-sta"||p==="/api/oag/enrich-operational")return true;
  return false;
}

function safeEqual(a,b){
  const x=String(a),y=String(b);
  let d=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x.charCodeAt(i)||0)^(y.charCodeAt(i)||0);
  return d===0;
}

// Retourne une Response 401/403 si l'appel doit être refusé, sinon null.
export function guardApi(request,env){
  const url=new URL(request.url);
  if(request.method==="OPTIONS")return null;
  if(!isProtectedRoute(request.method,url.pathname))return null;
  const secret=String(env?.ALYZIA_API_SECRET||"").trim();
  const headers={"content-type":"application/json; charset=UTF-8","cache-control":"no-store"};
  if(!secret)return new Response(JSON.stringify({ok:false,error:"ROUTE PROTÉGÉE : ALYZIA_API_SECRET non défini côté serveur"}),{status:403,headers});
  const auth=request.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7).trim():"";
  if(!token||!safeEqual(token,secret))return new Response(JSON.stringify({ok:false,error:"NON AUTORISÉ"}),{status:401,headers});
  return null;
}
