// Fuseaux des aéroports (copie de public/index.html) : les heures STA/ETA/ATA sont en heure locale de destination.
export const AIRPORT_TZ={
 CDG:"Europe/Paris", ORY:"Europe/Paris", NCE:"Europe/Paris", LIL:"Europe/Paris", LRT:"Europe/Paris",
 PUF:"Europe/Paris", CHR:"Europe/Paris", LIG:"Europe/Paris", SYS:"Europe/Paris", QIE:"Europe/Paris",
 ALG:"Africa/Algiers", ORN:"Africa/Algiers", CZL:"Africa/Algiers", AAE:"Africa/Algiers",
 TLM:"Africa/Algiers", CFK:"Africa/Algiers", QSF:"Africa/Algiers", BLJ:"Africa/Algiers",
 BSK:"Africa/Algiers", ELU:"Africa/Algiers",
 IST:"Europe/Istanbul", SAW:"Europe/Istanbul", ESB:"Europe/Istanbul", AYT:"Europe/Istanbul",
 DUB:"Europe/Dublin", SNN:"Europe/Dublin", NOC:"Europe/Dublin",
 TLV:"Asia/Jerusalem", LCA:"Asia/Nicosia",
 TUN:"Africa/Tunis", DJE:"Africa/Tunis", MIR:"Africa/Tunis", TTU:"Africa/Tunis",
 CPH:"Europe/Copenhagen", ARN:"Europe/Stockholm", SVG:"Europe/Oslo", OSL:"Europe/Oslo",
 LYR:"Europe/Oslo", FRA:"Europe/Berlin", LEJ:"Europe/Berlin", BER:"Europe/Berlin",
 WAW:"Europe/Warsaw", KTW:"Europe/Warsaw", PRG:"Europe/Prague", SOF:"Europe/Sofia",
 BEG:"Europe/Belgrade", ZAD:"Europe/Zagreb", TIA:"Europe/Tirane", ATH:"Europe/Athens",
 CMN:"Africa/Casablanca", RBA:"Africa/Casablanca", RAK:"Africa/Casablanca", OUD:"Africa/Casablanca",
 KEF:"Atlantic/Reykjavik", PDL:"Atlantic/Azores",
 CAI:"Africa/Cairo", LXR:"Africa/Cairo",
 SIN:"Asia/Singapore", KUL:"Asia/Kuala_Lumpur", BKK:"Asia/Bangkok",
 YUL:"America/Toronto", YYZ:"America/Toronto", YQB:"America/Toronto",
 DEL:"Asia/Kolkata", ICN:"Asia/Seoul", HND:"Asia/Tokyo",
 ABJ:"Africa/Abidjan", KGL:"Africa/Kigali", AMM:"Asia/Amman", KWI:"Asia/Kuwait",
 BOG:"America/Bogota", GRU:"America/Sao_Paulo", MIA:"America/New_York", JFK:"America/New_York",
 GYD:"Asia/Baku", TBS:"Asia/Tbilisi", SEZ:"Indian/Mahe",
 CKG:"Asia/Shanghai", SZX:"Asia/Shanghai", XIY:"Asia/Shanghai",
 BRU:"Europe/Brussels", MST:"Europe/Amsterdam", LBA:"Europe/London", LGW:"Europe/London",
 BQH:"Europe/London", OPO:"Europe/Lisbon", BCN:"Europe/Madrid", IBZ:"Europe/Madrid",
 ACE:"Atlantic/Canary", FUE:"Atlantic/Canary", MXP:"Europe/Rome", VRN:"Europe/Rome",
 PMO:"Europe/Rome", SUF:"Europe/Rome", BLQ:"Europe/Rome",
 GOH:"America/Nuuk", SFJ:"America/Nuuk"
};
const cache={};
export function tzOffsetMinutes(iata,date=new Date()){
  const zone=AIRPORT_TZ[String(iata||"").toUpperCase()]||"Europe/Paris";
  const key=zone+"|"+Math.floor(date.getTime()/900000);
  if(cache[key]!==undefined)return cache[key];
  let v;
  try{const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:zone,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(date).map(x=>[x.type,x.value]));v=Math.round((Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-date.getTime())/60000)}catch{v=120}
  return cache[key]=v;
}
// Décalage (min) à retrancher d'une heure locale destination pour l'exprimer en heure de Paris.
export function shiftToParis(dest,date=new Date()){return tzOffsetMinutes(dest,date)-tzOffsetMinutes("CDG",date)}
