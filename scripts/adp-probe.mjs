import {chromium} from "playwright";
const URL_="https://www.parisaeroport.fr/vols/tableau-des-departs";
const b=await chromium.launch();
const ctx=await b.newContext({locale:"fr-FR",userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"});
const p=await ctx.newPage();
const seen=[];
p.on("response",async r=>{try{const u=r.url(),ct=r.headers()["content-type"]||"";if(!/json/i.test(ct))return;const t=await r.text();seen.push({u:u.slice(0,200),s:r.status(),n:t.length,head:t.slice(0,300),req:r.request().method()})}catch{}});
let st="";
try{const r=await p.goto(URL_,{waitUntil:"networkidle",timeout:45000});st=r.status()}catch(e){st="ERR "+e.message.slice(0,150)}
console.log("page status",st,"title",await p.title().catch(()=>""));
await p.waitForTimeout(5000);
console.log("body sample:",(await p.innerText("body").catch(()=>"")).replace(/\s+/g," ").slice(0,600));
console.log("json responses:",seen.length);
for(const s of seen)console.log(s.req,s.s,s.n,s.u,"\n   ",s.head.replace(/\s+/g," "));
await b.close();
