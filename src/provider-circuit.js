// Disjoncteur sur les fournisseurs dont les appels partent de plusieurs modules (OAG) : après un refus 429, plus aucun appel réel
// n'est envoyé pendant plusieurs heures (les appelants reçoivent un 429 immédiat, marqué x-alyzia-circuit). Un seul appel d'essai est
// autorisé à l'échéance ; un nouveau 429 rallonge la pause (3 h, 6 h, 9 h, 12 h max). Un succès referme le disjoncteur.
// État : table ops_meta, clé "circuit:<FOURNISSEUR>".
const HOSTS={"api.oag.com":"OAG"};
const BASE_MS=3*3600*1000,MAX_MS=12*3600*1000;
const cache=new Map();   // fournisseur -> {until,at} (rafraîchi toutes les 60 s)

async function readState(env,prov){
  const hit=cache.get(prov);if(hit&&Date.now()-hit.at<60000)return hit;
  let st={until:0,strikes:0,at:Date.now()};
  try{
    await env.OPS_DB.prepare(`CREATE TABLE IF NOT EXISTS ops_meta(k TEXT PRIMARY KEY,v TEXT)`).run();
    const row=await env.OPS_DB.prepare(`SELECT v FROM ops_meta WHERE k=?`).bind("circuit:"+prov).first();
    if(row?.v){const v=JSON.parse(row.v);st={until:Date.parse(v.until||"")||0,strikes:Number(v.strikes||0),at:Date.now()}}
  }catch(_){}
  cache.set(prov,st);return st;
}
async function writeState(env,prov,state){
  cache.set(prov,{until:Date.parse(state.until||"")||0,strikes:state.strikes,at:Date.now()});
  try{
    if(!state.strikes){await env.OPS_DB.prepare(`DELETE FROM ops_meta WHERE k=?`).bind("circuit:"+prov).run();return}
    await env.OPS_DB.prepare(`INSERT INTO ops_meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`).bind("circuit:"+prov,JSON.stringify(state)).run();
  }catch(_){}
}
export function circuitPauseMs(strikes){return Math.min(MAX_MS,BASE_MS*Math.max(1,strikes))}

export function installCircuit(env){
  if(!env?.OPS_DB)return;
  globalThis.__ALYZIA_CIRCUIT_ENV=env;
  if(globalThis.__ALYZIA_CIRCUIT_INSTALLED)return;
  globalThis.__ALYZIA_CIRCUIT_INSTALLED=true;
  const orig=globalThis.fetch.bind(globalThis);
  globalThis.fetch=async function(input,init){
    let host="";try{host=new URL(typeof input==="string"?input:input.url).hostname}catch(_){}
    const prov=HOSTS[host];
    if(!prov)return orig(input,init);
    const e=globalThis.__ALYZIA_CIRCUIT_ENV,st=await readState(e,prov);
    if(st.until>Date.now())return new Response(JSON.stringify({message:`DISJONCTEUR ${prov} : refus 429 en cours, nouvel essai à ${new Date(st.until).toISOString()}`}),{status:429,headers:{"content-type":"application/json","x-alyzia-circuit":"open"}});
    const r=await orig(input,init);
    if(r.status===429){const strikes=st.strikes+1;await writeState(e,prov,{strikes,until:new Date(Date.now()+circuitPauseMs(strikes)).toISOString(),at:new Date().toISOString()})}
    else if(r.ok&&st.strikes)await writeState(e,prov,{strikes:0});
    return r;
  };
}
