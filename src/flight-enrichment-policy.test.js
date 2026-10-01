import test from "node:test";
import assert from "node:assert/strict";
import {buildNeeds,flightComplete,mayWriteField,providerNeeded,stopAll} from "./flight-enrichment-policy.js";

test("un vol complet coupe tous les providers",()=>{
  const x={std:"10:00",sta:"12:00",duration:120,atd:"10:11",ata:"12:07",gate:"K45",reg:"9V-SWM"};
  assert.equal(flightComplete(x),true);
  assert.equal(stopAll(x),true);
  assert.equal(providerNeeded("OAG_STATUS",x,-120),false);
  assert.equal(providerNeeded("AIRLABS",x,-120),false);
});

test("ETD et gate ne sont plus demandés après départ; ATA demandée seulement à l'approche de l'arrivée",()=>{
  const x={std:"10:00",sta:"12:00",duration:120,atd:"10:11",etd:"",gate:"",ata:"",reg:"9V-SWM"};
  const airborne=buildNeeds(x,-30);              // arrivée prévue dans 90 min: pas d'appel inutile
  assert.equal(airborne.etd,false);
  assert.equal(airborne.gate,false);
  assert.equal(airborne.ata,false);
  const approaching=buildNeeds(x,-100);          // arrivée prévue dans 20 min: ATA recherchée
  assert.equal(approaching.ata,true);
  const landed=buildNeeds({...x,status:"LANDED"},-30);   // statut atterri sans ATA: on continue jusqu'à l'obtenir
  assert.equal(landed.ata,true);
});

test("un statut AIRBORNE ne coupe jamais la recherche ATD",()=>{
  const x={std:"10:00",sta:"12:00",duration:120,atd:"",ata:"",status:"AIRBORNE"};
  const n=buildNeeds(x,-180);
  assert.equal(n.atd,true);
  assert.equal(providerNeeded("OAG_STATUS",x,-180),true);
});

test("un statut ARRIVED ne coupe jamais la recherche ATA",()=>{
  const x={std:"10:00",sta:"12:00",duration:120,atd:"10:11",ata:"",status:"ARRIVED"};
  const n=buildNeeds(x,-150);
  assert.equal(n.ata,true);
  assert.equal(providerNeeded("SKYLINK",x,-150),true);
});

test("ATA est pilotée par l'arrivée estimée et non uniquement par STD",()=>{
  const x={std:"20:45",sta:"09:55",eta:"09:34",duration:670,atd:"20:56",ata:""};
  const n=buildNeeds(x,-390);
  assert.equal(n.ata,false);
  const nearArrival=buildNeeds(x,-620);
  assert.equal(nearArrival.ata,true);
});

test("OpenSky ne sert qu'autour du départ pour ATD ou immat",()=>{
  const x={std:"10:00",sta:"12:00",duration:120,atd:"",ata:"",gate:"K45",reg:""};
  assert.equal(providerNeeded("OPENSKY",x,10),true);
  assert.equal(providerNeeded("OPENSKY",x,300),false);
});

test("une valeur finale existante n'est pas écrasée",()=>{
  const x={atd:"10:11",atdSource:"OAG_STATUS"};
  assert.equal(mayWriteField(x,"atd","AIRLABS_LIVE_RECOVERY"),false);
});

test("ETA API peut évoluer avant ATA",()=>{
  const x={atd:"10:11",ata:"",eta:"12:00",etaSource:"OAG_STATUS"};
  assert.equal(mayWriteField(x,"eta","AIRLABS_LIVE_RECOVERY"),true);
});

test("ETD déjà connu : redemandé quand il date de plus de 30 min, pas avant",async()=>{
  const {buildNeeds}=await import("./flight-enrichment-policy.js");
  const recent=new Date(Date.now()-5*60000).toISOString(),old=new Date(Date.now()-40*60000).toISOString();
  const base={std:"10:00",sta:"12:00",gate:"A1",reg:"F-ABCD"};
  assert.equal(buildNeeds({...base},60).etd,true);                                              // ETD absent : demandé
  assert.equal(buildNeeds({...base,etd:"10:30",etdUpdatedAt:recent},60).etd,false);           // ETD récent : pas de nouvel appel
  assert.equal(buildNeeds({...base,etd:"10:30",etdUpdatedAt:old},60).etd,true);               // ETD périmé : rafraîchi
  assert.equal(buildNeeds({...base,etd:"10:30"},60).etd,true);                                 // sans horodatage : rafraîchi
  assert.equal(buildNeeds({...base,etd:"10:30",etdUpdatedAt:old},600).etd,false);             // hors fenêtre (> 4 h) : pas demandé
  assert.equal(buildNeeds({...base,atd:"10:10",etd:"10:30",etdUpdatedAt:old},-20).etd,false); // déjà parti : plus d'ETD
});
