import app from "./home-list-final-fixes-wrapper.js";

const HELPER=String.raw`
function __alyziaCanonicalValue(value){
  if(Array.isArray(value)) return value.map(__alyziaCanonicalValue);
  if(value && typeof value==='object'){
    const out={};
    Object.keys(value).sort().forEach(key=>{out[key]=__alyziaCanonicalValue(value[key])});
    return out;
  }
  return value;
}
function __alyziaStableStringify(value){
  return JSON.stringify(__alyziaCanonicalValue(value));
}
`;

function patchSelectedFlightSync(html){
  let s=String(html||'');
  const startToken='async function syncSelectedFlightFast(){';
  const endToken='function scheduleSelectedFlightSync(){';
  let cursor=0,patched=0;
  while(true){
    const start=s.indexOf(startToken,cursor);
    if(start<0)break;
    const end=s.indexOf(endToken,start);
    if(end<0)break;
    let block=s.slice(start,end);
    const beforeCount=(block.match(/const before=JSON\.stringify\(\[/g)||[]).length;
    const afterCount=(block.match(/const after=JSON\.stringify\(\[/g)||[]).length;
    if(beforeCount===1&&afterCount===1){
      block=block.replace('const before=JSON.stringify([','const before=__alyziaStableStringify([')
                 .replace('const after=JSON.stringify([','const after=__alyziaStableStringify([');
      s=s.slice(0,start)+block+s.slice(end);
      patched++;
      cursor=start+block.length;
    }else{
      cursor=end+endToken.length;
    }
  }
  if(patched>0&&!s.includes('function __alyziaStableStringify(value){')){
    const first=s.indexOf(startToken);
    s=s.slice(0,first)+HELPER+s.slice(first);
  }
  return s;
}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text();
    const patched=patchSelectedFlightSync(html);
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control','no-store');
    return new Response(patched,{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){
    if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx);
  }
};
