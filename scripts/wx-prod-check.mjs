import {chromium} from "playwright";
const b=await chromium.launch();
for(const [name,vp] of [["mobile",{width:390,height:844}],["pc",{width:1300,height:900}]]){
 const p=await (await b.newContext({viewport:vp,isMobile:name==="mobile"})).newPage();
 const errs=[];p.on("pageerror",e=>errs.push(String(e).slice(0,160)));
 p.on("response",r=>{if(/api\/weather/.test(r.url()))console.log(name,"weather",r.status(),r.url().slice(-40))});
 await p.goto("https://alyzia-ops.alyzia-cdg2.workers.dev/",{waitUntil:"load",timeout:60000});
 await p.waitForTimeout(12000);
 const r=await p.evaluate(()=>({wxFn:typeof wxInner,cards:document.querySelectorAll(".v2-card").length,rows:document.querySelectorAll(".flight-home-row").length,lines:document.querySelectorAll(".wx-line").length,inV2:document.querySelectorAll(".v2-time-title .wx-line").length,filled:[...document.querySelectorAll(".v2-time-title .wx-line")].filter(n=>n.textContent.trim()).length,sample:[...document.querySelectorAll(".v2-time-title")].slice(0,4).map(n=>n.innerHTML.slice(0,160))}));
 console.log(name,JSON.stringify(r),"errors",errs.length,errs.slice(0,2));
}
await b.close();
