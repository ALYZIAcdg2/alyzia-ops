import {chromium} from "playwright";
const b=await chromium.launch();
for(const [name,vp,mob] of [["pc",{width:1300,height:900},false],["mobile",{width:390,height:844},true]]){
 const p=await (await b.newContext({viewport:vp,isMobile:mob})).newPage();
 const errs=[],reqs=[];p.on("pageerror",e=>errs.push(String(e).slice(0,160)));
 p.on("response",async r=>{const u=r.url();if(/\/api\/flights\?/.test(u)&&!/identity=/.test(u)){let n="?";try{n=(await r.text()).length}catch{}reqs.push(`${Math.round(performance.now()/1000)}s ${/since=/.test(u)?"delta":"liste"} ${(u.match(/from=([\d-]+)&to=([\d-]+)/)||[]).slice(1).join(">")||"TOUT"} ${(n/1e6).toFixed(2)}Mo`)}});
 const t0=Date.now();
 await p.goto("https://alyzia-ops.alyzia-cdg2.workers.dev/",{waitUntil:"load",timeout:60000});
 await p.waitForFunction(()=>document.querySelectorAll(".flight-home-row").length>0,null,{timeout:40000}).catch(()=>{});
 const tCards=Date.now()-t0;
 const a=await p.evaluate(()=>({n:FLIGHTS.length,range:opsRangeKey(),rows:document.querySelectorAll(".flight-home-row").length}));
 console.log(name,"premières cartes affichées après",tCards,"ms |",JSON.stringify(a));
 await p.waitForTimeout(22000);
 const c=await p.evaluate(()=>({n:FLIGHTS.length,range:opsRangeKey(),rows:document.querySelectorAll(".flight-home-row").length}));
 console.log(name,"après ~22 s :",JSON.stringify(c),"| erreurs JS:",errs.length,errs.slice(0,2));
 console.log(name,"requêtes vols:",reqs.filter(x=>!/delta/.test(x)).join(" ; "),"| nb deltas:",reqs.filter(x=>/delta/.test(x)).length);
}
await b.close();
