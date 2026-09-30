// Météo aéroport : METAR officiel (aviationweather.gov, gratuit, sans clé) pour la carte départ / arrivée.
// GET /api/weather?iata=CDG,BOG -> {CDG:{temp,icon,label,raw,at},...}. Cache 15 min (Cache API).
const ICAO={
 CDG:"LFPG",ORY:"LFPO",NCE:"LFMN",LIL:"LFQQ",LRT:"LFRH",PUF:"LFBP",CHR:"LFLX",LIG:"LFBL",SYS:"LFLN",QIE:"LFRQ",
 LYS:"LFLL",MRS:"LFML",TLS:"LFBO",BOD:"LFBD",NTE:"LFRS",
 ALG:"DAAG",ORN:"DAOO",CZL:"DABC",AAE:"DABB",TLM:"DAON",CFK:"DAOI",QSF:"DAAS",BLJ:"DABT",BSK:"DAUB",ELU:"DAUO",
 IST:"LTFM",SAW:"LTFJ",ESB:"LTAC",AYT:"LTAI",DUB:"EIDW",SNN:"EINN",NOC:"EIKN",TLV:"LLBG",LCA:"LCLK",
 TUN:"DTTA",DJE:"DTTJ",MIR:"DTMB",TTU:"GMTN",CPH:"EKCH",ARN:"ESSA",SVG:"ENZV",OSL:"ENGM",LYR:"ENSB",
 FRA:"EDDF",LEJ:"EDDP",BER:"EDDB",WAW:"EPWA",KTW:"EPKT",PRG:"LKPR",SOF:"LBSF",BEG:"LYBE",ZAD:"LDZD",TIA:"LATI",ATH:"LGAV",
 CMN:"GMMN",RBA:"GMME",RAK:"GMMX",OUD:"GMFO",KEF:"BIKF",PDL:"LPPD",CAI:"HECA",LXR:"HELX",
 SIN:"WSSS",KUL:"WMKK",BKK:"VTBS",YUL:"CYUL",YYZ:"CYYZ",YQB:"CYQB",DEL:"VIDP",ICN:"RKSI",HND:"RJTT",
 ABJ:"DIAP",KGL:"HRYR",AMM:"OJAI",KWI:"OKKK",BOG:"SKBO",GRU:"SBGR",MIA:"KMIA",JFK:"KJFK",GYD:"UBBB",TBS:"UGTB",SEZ:"FSIA",
 CKG:"ZUCK",SZX:"ZGSZ",XIY:"ZLXY",BRU:"EBBR",MST:"EHBK",AMS:"EHAM",LBA:"EGNM",LGW:"EGKK",LHR:"EGLL",BQH:"EGKB",
 OPO:"LPPR",LIS:"LPPT",BCN:"LEBL",MAD:"LEMD",IBZ:"LEIB",ACE:"GCRR",FUE:"GCLP",MXP:"LIMC",FCO:"LIRF",VRN:"LIPX",PMO:"LICJ",SUF:"LICA",BLQ:"LIPE",
 GVA:"LSGG",ZRH:"LSZH",DXB:"OMDB",DOH:"OTHH",GOH:"BGGH",SFJ:"BGSF"
};
const clean=v=>String(v??"").trim();
export function describe(m){
  const wx=clean(m.wxString).toUpperCase(),cover=clean(m.cover||(Array.isArray(m.clouds)&&m.clouds.length?m.clouds[m.clouds.length-1].cover:"")).toUpperCase();
  if(/TS/.test(wx))return {icon:"⛈",label:"ORAGE"};
  if(/SN|SG|PL|GS|GR/.test(wx))return {icon:"❄",label:"NEIGE"};
  if(/RA|DZ|SH/.test(wx))return {icon:"🌧",label:"PLUIE"};
  if(/FG|BR|HZ|FU|DU|SA/.test(wx))return {icon:"🌫",label:"BRUME"};
  if(/OVC|BKN/.test(cover))return {icon:"☁",label:"COUVERT"};
  if(/SCT|FEW/.test(cover))return {icon:"⛅",label:"NUAGEUX"};
  return {icon:"☀",label:"DÉGAGÉ"};
}
export async function handleWeather(request,ctx){
  const url=new URL(request.url);
  const iatas=[...new Set(clean(url.searchParams.get("iata")).toUpperCase().split(",").map(clean).filter(v=>/^[A-Z]{3}$/.test(v)))].slice(0,10);
  const pairs=iatas.map(i=>[i,ICAO[i]]).filter(p=>p[1]);
  const headers={"content-type":"application/json;charset=utf-8","cache-control":"public,max-age=300","access-control-allow-origin":"*"};
  if(!pairs.length)return new Response("{}",{headers});
  const cacheKey=new Request("https://weather.cache/"+pairs.map(p=>p[1]).sort().join(","));
  const cache=caches.default;
  const hit=await cache.match(cacheKey).catch(()=>null);
  if(hit)return new Response(hit.body,{headers});
  const out={};
  try{
    const r=await fetch(`https://aviationweather.gov/api/data/metar?ids=${pairs.map(p=>p[1]).join(",")}&format=json`,{headers:{Accept:"application/json","User-Agent":"alyzia-ops"}});
    const list=r.ok?await r.json().catch(()=>[]):[];
    for(const [iata,icao] of pairs){
      const m=(Array.isArray(list)?list:[]).find(x=>clean(x.icaoId).toUpperCase()===icao);
      if(!m)continue;
      const t=Number(m.temp),d=describe(m);
      out[iata]={temp:Number.isFinite(t)?Math.round(t):null,icon:d.icon,label:d.label,raw:clean(m.rawOb).slice(0,160),at:clean(m.reportTime||m.obsTime)};
    }
  }catch(_){}
  const body=JSON.stringify(out);
  if(Object.keys(out).length&&ctx?.waitUntil)ctx.waitUntil(cache.put(cacheKey,new Response(body,{headers:{...headers,"cache-control":"public,max-age=900"}})));
  return new Response(body,{headers});
}
