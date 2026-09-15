const REPORTS = [
  [/\b(?:ALL\s+(?:CUSTOMERS|PAX|RESERV(?:ATION|ETION)\s+LIST)|PDF-ACC)\b/i,'MASTER'],
  [/\b(?:FQTV|FQA)\b/i,'FQTV'],[/\b(?:INFANT|INFT|PDF-(?:INF|CINFT))\b/i,'INF'],
  [/\b(?:ETKT|ETICKET|TICKET)\b/i,'ETKT'],[/\bEMD\b/i,'EMD'],
  [/\b(?:INBOUND|\bINC\b)\b/i,'INBOUND'],[/\b(?:ONCARRIAGE|OUTBOUND|\bONC\b)\b/i,'OUTBOUND'],
  [/\b(?:SSR|WCHR|WCHS|WCHC|UMNR|PRM)\b/i,'SSR'],
  [/\b(?:MEAL|VBCPLIST|SPML)\b/i,'MEAL'],[/\b(?:GROUP|GRP)\b/i,'GROUP'],
  [/\b(?:BOOKED|LOAD)\b/i,'BOOKED'],[/\b(?:STAFF|STFFIRM|REBATE|PASS2)\b/i,'STAFF']
];

export function classifyDocument(document) {
  const head = document.text.slice(0,12000);
  const title = head.match(/\bLIST\s+OF\s*:\s*([^\n\r]{2,120})/i)?.[1] ||
    head.match(/\b(?:ALL\s+RESERVETION\s+LIST|INBOUND\s+CUSTOMER\s+SUMMARY|ONCARRIAGE\s+CUSTOMER\s+SUMMARY|JFE\s+SCREEN\s+COPY)\b/i)?.[0] || '';
  const explicit = title || head.split('\n').slice(0,12).join(' ');
  const found = REPORTS.filter(([re]) => re.test(explicit)).map(([,type]) => type);
  const combined = /\b(?:ONC\s*[+*/]\s*INC|INBOUND\s*(?:AND|&)\s*OUTBOUND)\b/i.test(explicit);
  const types = combined ? ['INBOUND','OUTBOUND'] : [...new Set(found)];
  if (/\bJFE\s+SCREEN\s+COPY\b/i.test(title)) types.splice(0,types.length,'OPERATIONAL_INFO');
  return {types,title:title.trim(),confidence:title ? 'EXPLICIT' : 'HEADER',
    issues:!types.length ? ['CLASSIFICATION_UNKNOWN'] :
      (types.length>1 && !combined ? ['CLASSIFICATION_AMBIGUOUS'] : [])};
}
