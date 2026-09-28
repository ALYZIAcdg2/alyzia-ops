import test from "node:test";
import assert from "node:assert/strict";
import {buildNeeds,flightComplete,mayWriteField,providerNeeded,stopAll} from "./flight-enrichment-policy.js";

test("un vol complet coupe tous les providers",()=>{
  const x={std:"10:00",sta:"12:00",atd:"10:11",ata:"12:07",gate:"K45",reg:"9V-SWM"};
  assert.equal(flightComplete(x),true);
  assert.equal(stopAll(x),true);
  assert.equal(providerNeeded("OAG_STATUS",x,-120),false);
  assert.equal(providerNeeded("AIRLABS",x,-120),false);
});

test("ETD et gate ne sont plus demandés après départ",()=>{
  const x={std:"10:00",sta:"12:00",atd:"10:11",etd:"",gate:"",ata:"",reg:"9V-SWM"};
  const n=buildNeeds(x,-30);
  assert.equal(n.etd,false);
  assert.equal(n.gate,false);
  assert.equal(n.ata,true);
});

test("OpenSky ne sert qu'autour du départ pour ATD ou immat",()=>{
  const x={std:"10:00",sta:"12:00",atd:"",ata:"",gate:"K45",reg:""};
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
