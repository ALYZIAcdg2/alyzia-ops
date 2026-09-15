const tickets = p => Array.isArray(p.etkt) ? p.etkt : (p.etkt ? [p.etkt] : []);
const key = p => String(tickets(p)[0] || p.ticket || '').trim() ||
  [p.name||p.passengerName||p.passenger_name_raw||'',p.seat||''].map(x=>String(x).toUpperCase().replace(/[^A-Z0-9]/g,'')).join('|');

export function consolidateFlight(decisions) {
  const first=decisions[0]?.identity;
  const issues=[];
  if(!first)return {identity:null,cards:[],passengers:[],issues:['EMPTY_BATCH']};
  const cards=[], passengers=new Map();
  for(const d of decisions){
    if(d.identity.key!==first.key || d.identity.route!==first.route){issues.push('MIXED_FLIGHTS');continue}
    for(const card of d.interpreter.cards){
      cards.push({...card,sourceId:d.sourceId});
      for(const p of card.passengerItems||[]){
        const id=key(p);
        if(!id || id==='|'){issues.push('PASSENGER_UNIDENTIFIED');continue}
        const existing=passengers.get(id)||{};
        if(existing.seat && p.seat && existing.seat!==p.seat)issues.push('SEAT_CONFLICT');
        passengers.set(id,{...existing,...p,ssr:[...new Set([...(existing.ssr||[]),...(p.ssr||[])])],
          sourceIds:[...new Set([...(existing.sourceIds||[]),d.sourceId])]});
      }
    }
  }
  return {identity:first,cards,passengers:[...passengers.values()],issues:[...new Set(issues)]};
}

export function validateFlight(batch) {
  const blocking=[...batch.issues];
  const warnings=[];
  if(batch.identity?.issues.length)blocking.push(...batch.identity.issues);
  if(!batch.cards.length)blocking.push('NO_CLASSIFIED_DOCUMENT');
  for(const card of batch.cards){
    if(card.passengerCount<0 || !Number.isFinite(Number(card.passengerCount)))blocking.push('INVALID_COUNT');
    if(card.type==='MASTER' && card.passengerCount>0 && !card.passengerItems?.length)
      blocking.push('MASTER_PASSENGERS_MISSING');
    if(card.type==='MASTER' && card.passengerItems?.length && card.passengerCount &&
       card.passengerItems.length!==card.passengerCount)blocking.push('MASTER_COUNT_MISMATCH');
    const counts=Object.values(card.classCounts||{}).filter(x=>Number.isFinite(Number(x)));
    if(card.type==='MASTER' && counts.length && card.passengerCount &&
       counts.reduce((n,x)=>n+Number(x),0)!==Number(card.passengerCount))
      blocking.push('CLASS_COUNT_MISMATCH');
    if(['INF','SSR','FQTV','ETKT','EMD','INBOUND','OUTBOUND'].includes(card.type) &&
       card.passengerCount && !card.passengerItems?.length && !card.connectionRows?.length)
      warnings.push(`${card.type}_DETAILS_MISSING`);
  }
  const ticketOwners=new Map();
  for(const p of batch.passengers){
    for(const ticket of tickets(p)){
      if(ticketOwners.has(ticket) && ticketOwners.get(ticket)!==p.name)blocking.push('ETKT_CONFLICT');
      ticketOwners.set(ticket,p.name);
    }
    if(p.passengerType==='INF' && !p.parentPassengerId && !p.parentRef)
      warnings.push('INF_PARENT_UNKNOWN');
  }
  return {status:blocking.length?'BLOCKING_ERROR':(warnings.length?'WARNING':'VALID'),
    blocking:[...new Set(blocking)],warnings:[...new Set(warnings)]};
}
