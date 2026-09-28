import app from "./admin-dashboard-v5-wrapper.js";

const clean=v=>String(v??"").trim();
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};

function periodStats(raw,key){
  const p=raw?.[key]||raw?.usage?.[key]||raw?.quota?.[key]||null;
  if(!p||typeof p!=="object")return null;
  const limit=num(p.limit??p.quota??p.total??p.max);
  let used=num(p.used??p.calls??p.consumed??p.usage);
  const remaining=num(p.remaining??p.left??p.available);
  if(used==null&&limit!=null&&remaining!=null)used=Math.max(0,limit-remaining);
  return {limit,used,remaining};
}
async function adbUsage(env){
  try{
    if(!env.AERODATABOX||typeof env.AERODATABOX.fetch!=="function")return null;
    const r=await env.AERODATABOX.fetch(new Request("https://aerodatabox.internal/usage",{headers:{Accept:"application/json"}}));
    if(!r.ok)return null;
    const j=await r.json().catch(()=>null);
    return j?.ok===false?null:j;
  }catch{return null}
}
async function adbRuntime(env){
  try{
    const {results=[]}=await env.OPS_DB.prepare(`SELECT key,value,updated_at FROM api_provider_runtime WHERE key IN ('adb_auto_last_call','adb_auto_last_result')`).all();
    let lastAt="",lastStatus=null;
    for(const r of results){
      if(r.key==='adb_auto_last_call')lastAt=clean(r.value)||clean(r.updated_at)||lastAt;
      if(r.key==='adb_auto_last_result'){
        try{const j=JSON.parse(r.value||'{}');lastStatus=num(j?.result?.status)??lastStatus;lastAt=clean(j?.at)||clean(r.updated_at)||lastAt}catch{}
      }
    }
    return {lastAt,lastStatus};
  }catch{return {lastAt:"",lastStatus:null}}
}
async function openSkyRuntime(env){
  try{
    const r=await env.OPS_DB.prepare(`SELECT last_at,last_status FROM provider_runtime_state WHERE provider='OPENSKY_LIVE'`).first();
    return {lastAt:clean(r?.last_at),lastStatus:num(r?.last_status)};
  }catch{return {lastAt:"",lastStatus:null}}
}
function findQuota(data,provider){return Array.isArray(data?.quotas)?data.quotas.find(q=>q?.provider===provider):null}
async function enrich(data,env){
  if(!data?.ok)return data;
  const [usage,adbRt,osRt]=await Promise.all([adbUsage(env),adbRuntime(env),openSkyRuntime(env)]);
  const adb=findQuota(data,"AERODATABOX");
  if(adb){
    const day=periodStats(usage,"daily"),month=periodStats(usage,"monthly");
    if(day?.used!=null)adb.today=day.used;
    if(month?.used!=null)adb.month=month.used;
    if(month?.limit!=null)adb.limit=month.limit;
    else if(adb.limit==null||!adb.limit){const fallback=num(usage?.monthlyLimit??usage?.monthLimit);if(fallback!=null)adb.limit=fallback}
    if(month?.remaining!=null)adb.remaining=Math.max(0,month.remaining-Number(adb.reserve||0));
    else if(adb.limit)adb.remaining=Math.max(0,Number(adb.limit)-Number(adb.reserve||0)-Number(adb.month||0));
    if(adbRt.lastAt)adb.lastAt=adbRt.lastAt;
    if(adbRt.lastStatus!=null)adb.lastStatus=adbRt.lastStatus;
  }
  const os=findQuota(data,"OPENSKY");
  if(os){
    if(!os.lastAt&&osRt.lastAt&&osRt.lastStatus!==204)os.lastAt=osRt.lastAt;
    if((os.lastStatus==null||os.lastStatus==='')&&osRt.lastStatus!=null&&osRt.lastStatus!==204)os.lastStatus=osRt.lastStatus;
  }
  return data;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname!=="/api/admin/flight-processing")return app.fetch(request,env,ctx);
    const response=await app.fetch(request,env,ctx);
    const data=await response.json().catch(()=>null);
    if(!data)return response;
    const out=await enrich(data,env);
    const headers=new Headers(response.headers);headers.delete("content-length");headers.set("content-type","application/json; charset=UTF-8");headers.set("cache-control","no-store");
    return new Response(JSON.stringify(out),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
