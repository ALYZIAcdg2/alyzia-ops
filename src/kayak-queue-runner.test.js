import test from "node:test";
import assert from "node:assert/strict";
import {parseKayak} from "./kayak-queue-runner.js";

// Réponse réelle de Kayak5 (TK1822 CDG -> IST, vol en l'air)
const sample=(over={})=>({success:true,count:1,flights:[{
  id:"1411563476",airlineCode:"TK",flightNumber:"1822",statusCode:"A",
  departure:{code:"CDG",terminal:"1",gate:"26",timeZone:"Europe/Paris",utcOffsetMinutes:120},
  arrival:{code:"IST",timeZone:"Europe/Istanbul",utcOffsetMinutes:180},
  departureTimes:{gateTimestampMs:1790847540000,runwayTimestampMs:1790848440000,scheduledGateTimestampMs:1790847600000,delayMinutes:-1},
  arrivalTimes:{gateTimestampMs:1790860200000,runwayTimestampMs:1790859840000,scheduledGateTimestampMs:1790860200000,delayMinutes:0},
  durationMinutes:211,aircraft:"Airbus A350-900",...over}]});

test("vol en l'air : ATD et ETA en heure locale, STA, porte",()=>{
  const r=parseKayak(sample(),"2026-10-01","CDG","11:40");
  assert.ok(r);
  assert.equal(r.status,"A");
  assert.equal(r.atd,"11:39");   // 1790847540000 ms = 09:39 UTC = 11:39 Paris
  assert.equal(r.sta,"16:10");   // 1790860200000 ms = 13:10 UTC = 16:10 Istanbul
  assert.equal(r.eta,"16:10");
  assert.equal(r.ata,"");
  assert.equal(r.etd,"");
  assert.equal(r.gate,"26");
});
test("vol atterri : ATD + ATA, pas d'ETA",()=>{
  const r=parseKayak(sample({statusCode:"L"}),"2026-10-01","CDG","11:40");
  assert.equal(r.atd,"11:39");assert.equal(r.ata,"16:10");assert.equal(r.eta,"");
});
test("vol programmé : ETD seulement si l'heure de porte diffère de la STD",()=>{
  const r=parseKayak(sample({statusCode:"S"}),"2026-10-01","CDG","11:40");
  assert.equal(r.atd,"");assert.equal(r.etd,"11:39");
  const same=sample({statusCode:"S"});same.flights[0].departureTimes.gateTimestampMs=1790847600000;
  assert.equal(parseKayak(same,"2026-10-01","CDG","11:40").etd,"");
});
test("date différente, autre aéroport ou STD trop éloignée : ignoré",()=>{
  assert.equal(parseKayak(sample(),"2026-10-02","CDG","11:40"),null);
  assert.equal(parseKayak(sample(),"2026-10-01","ORY","11:40"),null);
  assert.equal(parseKayak(sample(),"2026-10-01","CDG","20:00"),null);
  assert.equal(parseKayak({success:true,count:0,flights:[]},"2026-10-01","CDG","11:40"),null);
  assert.equal(parseKayak(null,"2026-10-01","CDG","11:40"),null);
});
