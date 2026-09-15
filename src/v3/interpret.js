export function interpretDocument(document,identity,classification,adapters={}) {
  const types=classification.types;
  if(identity.issues.length || classification.issues.length)return {items:[],cards:[],issues:['UPSTREAM_NOT_READY']};
  const results=[];
  for(const type of types){
    const result=adapters.interpret?.(document.text,identity,type,classification.title);
    if(!result)throw new Error('INTERPRETER_UNAVAILABLE');
    results.push({type,...result});
  }
  return {items:results.flatMap(x=>x.passengerItems||[]),cards:results,
    issues:results.flatMap(x=>x.issues||[])};
}
