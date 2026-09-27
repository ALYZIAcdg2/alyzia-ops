import app from "./admin-flight-processing-wrapper.js";

const FIX=String.raw`<style id="alyzia-admin-processing-fix-css">
#alyzia-admin-processing-fix{display:none;margin:16px 12px 28px;padding:18px;border:1px solid #dfe7f1;border-radius:22px;background:#f8fbff;color:#10233f;font-family:inherit;position:relative;z-index:2}
#alyzia-admin-processing-fix.show{display:block!important}.apfx-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.apfx-title{font-size:20px;font-weight:950}.apfx-sub{font-size:12px;color:#708299;font-weight:800}.apfx-refresh{border:0;border-radius:12px;padding:9px 12px;background:#e8f3ff;color:#0874d1;font-weight:950}.apfx-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}.apfx-card,.apfx-section{background:#fff;border:1px solid #e3eaf2;border-radius:16px;padding:12px}.apfx-card b{font-size:18px}.apfx-mini{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px;font-size:11px;font-weight:900}.apfx-ok{color:#087443}.apfx-part{color:#a76a00}.apfx-check{color:#cc2f43}.apfx-none{color:#6b7787}.apfx-section{margin-top:10px;overflow:auto}.apfx-section h3{margin:0 0 10px;font-size:13px}.apfx-quota{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}.apfx-q{border:1px solid #e6ecf2;border-radius:12px;padding:9px}.apfx-qtop{display:flex;justify-content:space-between;gap:8px;font-size:11px;font-weight:950}.apfx-qsmall{margin-top:5px;font-size:10px;color:#71839a;font-weight:800}.apfx-table{width:100%;border-collapse:collapse;min-width:980px;font-size:11px}.apfx-table th,.apfx-table td{padding:7px 6px;border-bottom:1px solid #edf1f5;text-align:left;white-space:nowrap}.apfx-table th{font-size:10px;color:#6f8098}.apfx-badge{display:inline-flex;padding:4px 7px;border-radius:999px;font-weight:950}.apfx-badge.OK{background:#e2f6eb;color:#087443}.apfx-badge.PARTIEL{background:#fff0d2;color:#986100}.apfx-badge.CTRL{background:#ffe5e9;color:#c6283c}.apfx-badge.NONE{background:#eef1f4;color:#616d7c}
@media(max-width:700px){#alyzia-admin-processing-fix{margin:10px 8px 24px;padding:12px;border-radius:17px}.apfx-cards{grid-template-columns:1fr}.apfx-title{font-size:17px}}
</style><script id="alyzia-admin-processing-fix-js">(()=>{'use strict';
const norm=v=>String(v||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
let data=null,loading=false,adminMode=false;
function textOf(el){let s='';for(let i=0;el&&i<5;i++,el=el.parentElement)s+=' '+(el.textContent||'');return norm(s)}
function isAdminText(s){return /(^|\s)ADMIN(?:ISTRATION)?(\s|$)/.test(s)}
function activeAdmin(){return [...document.querySelectorAll('#app .active,#app [aria-selected="true"],#app [aria-current="page"]')].some(el=>isAdminText(norm(el.textContent)))}
function host(){return document.querySelector('#app')||document.body}
function ensure(){let box=document.getElementById('alyzia-admin-processing-fix');if(box)return box;box=document.createElement('section');box.id='alyzia-admin-processing-fix';host().prepend(box);return box}
function stateClass(s){const n=norm(s);if(n==='OK')return 'OK';if(n==='PARTIEL')return 'PARTIEL';if(n.includes('CONTROLER'))return 'CTRL';return 'NONE'}
function summary(title,s){return '<div class="apfx-card"><b>'+title+' · '+(s?.total||0)+'</b><div class="apfx-mini"><span class="apfx-ok">OK '+(s?.ok||0)+'</span><span class="apfx-part">PARTIEL '+(s?.partial||0)+'</span><span class="apfx-check">À CONTRÔLER '+(s?.check||0)+'</span><span class="apfx-none">NON TRAITÉ '+(s?.untreated||0)+'</span></div></div>'}
function render(){const box=ensure();box.classList.toggle('show',adminMode);if(!adminMode)return;if(!data){box.innerHTML='<b>Chargement du traitement des vols…</b>';return}const rows=(data.flights||[]).filter(x=>x.state!=='OK'||x.date===data.date).slice(0,160);box.innerHTML='<div class="apfx-head"><div><div class="apfx-title">Traitement des vols</div><div class="apfx-sub">Aujourd’hui + futur · '+new Date(data.generatedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</div></div><button class="apfx-refresh">Actualiser</button></div><div class="apfx-cards">'+summary('AUJOURD’HUI',data.summary?.today)+summary('FUTUR',data.summary?.future)+'</div><div class="apfx-section"><h3>QUOTAS API</h3><div class="apfx-quota">'+(data.quotas||[]).map(q=>'<div class="apfx-q"><div class="apfx-qtop"><span>'+esc(q.provider)+'</span><span>'+((q.period==='day'?q.today:q.month)||0)+(q.limit?' / '+q.limit:'')+'</span></div><div class="apfx-qsmall">Jour '+(q.today||0)+' · Mois '+(q.month||0)+' · Restant '+(q.remaining==null?'—':q.remaining)+' · HTTP '+(q.lastStatus??'—')+'</div></div>').join('')+'</div></div><div class="apfx-section"><h3>VOLS À SURVEILLER / TRAITÉS</h3><table class="apfx-table"><thead><tr><th>DATE</th><th>VOL</th><th>DEST</th><th>STD</th><th>STA</th><th>ETD</th><th>ATD</th><th>ETA</th><th>ATA</th><th>GATE</th><th>REG</th><th>ÉTAT</th><th>MANQUE</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(String(x.date||'').slice(5))+'</td><td><b>'+esc(x.flight||'—')+'</b></td><td>'+esc(x.destination||'—')+'</td><td>'+esc(x.std||'—')+'</td><td>'+esc(x.sta||'—')+'</td><td>'+esc(x.etd||'—')+'</td><td>'+esc(x.atd||'—')+'</td><td>'+esc(x.eta||'—')+'</td><td>'+esc(x.ata||'—')+'</td><td>'+esc(x.gate||'—')+'</td><td>'+esc(x.reg||'—')+'</td><td><span class="apfx-badge '+stateClass(x.state)+'">'+esc(x.state||'—')+'</span></td><td>'+esc((x.missing||[]).join(', ')||'—')+'</td></tr>').join('')+'</tbody></table></div>';box.querySelector('.apfx-refresh').onclick=load}
async function load(){if(loading)return;loading=true;const box=ensure();box.classList.add('show');box.innerHTML='<b>Chargement du traitement des vols…</b>';try{const r=await fetch('/api/admin/flight-processing',{cache:'no-store'});data=await r.json();if(!r.ok||!data?.ok)throw new Error(data?.error||'HTTP '+r.status);render()}catch(e){box.innerHTML='<b>Erreur tableau de bord :</b> '+esc(e.message||e)}finally{loading=false}}
function openAdmin(){adminMode=true;render();load()}
function closeAdmin(){adminMode=false;render()}
document.addEventListener('click',e=>{const s=textOf(e.target);if(isAdminText(s)){setTimeout(openAdmin,80);return}if(/(^|\s)(VOLS?|PREPA|OUTILS?|ACCUEIL|HOME)(\s|$)/.test(s))closeAdmin()},true);
const obs=new MutationObserver(()=>{if(activeAdmin()&&!adminMode)openAdmin()});obs.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class','aria-selected','aria-current']});
setTimeout(()=>{if(activeAdmin())openAdmin()},700);
})();</script>`;

function patch(html){let s=String(html||'');if(s.includes('id="alyzia-admin-processing-fix-css"'))return s;const i=s.lastIndexOf('</body>');return i>=0?s.slice(0,i)+FIX+'\n'+s.slice(i):s+FIX}

export default {
  async fetch(request,env,ctx){
    const response=await app.fetch(request,env,ctx);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(!type.includes('text/html'))return response;
    const html=await response.text(),headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
    return new Response(patch(html),{status:response.status,statusText:response.statusText,headers});
  },
  scheduled(controller,env,ctx){if(typeof app.scheduled==='function')return app.scheduled(controller,env,ctx)}
};
