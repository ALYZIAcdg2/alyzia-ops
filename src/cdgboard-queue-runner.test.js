import test from "node:test";
import assert from "node:assert/strict";
import {boardDatetime,indexBoard,normalizeStatus} from "./cdgboard-queue-runner.js";
import {parseKayak} from "./kayak-queue-runner.js";

// Extraits réels du tableau des départs CDG (Kayak5, 1er octobre 2026)
const dl8371={id:"1",airlineCode:"DL",flightNumber:"8371",statusCode:"L",departure:{code:"CDG",gate:"F30",utcOffsetMinutes:120},arrival:{code:"FCO",utcOffsetMinutes:120},
  departureTimes:{gateTimestampMs:1790839860000,runwayTimestampMs:1790840640000,scheduledGateTimestampMs:1790838900000,delayMinutes:16},
  arrivalTimes:{gateTimestampMs:1790846940000,runwayTimestampMs:1790846400000,scheduledGateTimestampMs:1790846700000,delayMinutes:4},operatingFlight:{airlineCode:"AF",flightNumber:"1104"}};
const af3143={id:"2",airlineCode:"AF",flightNumber:"3143",statusCode:"C",departure:{code:"CDG",utcOffsetMinutes:120},arrival:{code:"AMS",utcOffsetMinutes:120},
  departureTimes:{gateTimestampMs:1790840400000,scheduledGateTimestampMs:1790840400000,delayMinutes:0},arrivalTimes:{gateTimestampMs:1790844900000,scheduledGateTimestampMs:1790844900000}};
const ly328={id:"3",airlineCode:"LY",flightNumber:"328",statusCode:"S",departure:{code:"CDG",gate:"L26",utcOffsetMinutes:120},arrival:{code:"TLV",utcOffsetMinutes:180},
  departureTimes:{gateTimestampMs:1790841000000,runwayTimestampMs:1790842080000,scheduledGateTimestampMs:1790839500000,delayMinutes:25},
  arrivalTimes:{gateTimestampMs:1790856540000,scheduledGateTimestampMs:1790855100000,delayMinutes:24}};

test("fenêtre du tableau en UTC",()=>{assert.equal(boardDatetime(Date.UTC(2026,9,1,15,39)),"20261001-15:39")});
test("code-share : le vol opérant est retrouvé par son numéro, le vol propre prime",()=>{
  const own={...ly328,airlineCode:"AM",flightNumber:"7890",operatingFlight:{airlineCode:"LY",flightNumber:"328"}};
  const b=indexBoard([own,ly328,dl8371]);
  assert.equal(b.find("LY328"),ly328);assert.equal(b.find("AM7890"),own);
  assert.equal(b.find("AF1104"),dl8371);assert.equal(b.find("DL8371"),dl8371);assert.equal(b.find("XX1"),null);
});
test("vol atterri : ATD, ATA et STA en heure locale",()=>{
  const r=parseKayak({flights:[dl8371]},"2026-10-01","CDG","09:15");
  assert.equal(r.atd,"09:31");assert.equal(r.ata,"11:29");assert.equal(r.sta,"11:25");assert.equal(r.gate,"F30");assert.equal(r.etd,"");
});
test("vol programmé en retard : ETD et ETA, rien d'inventé ; annulé : rien",()=>{
  const r=parseKayak({flights:[normalizeStatus(ly328,Date.UTC(2026,9,1,6,0))]},"2026-10-01","CDG","09:25");
  assert.equal(r.etd,"09:50");assert.equal(r.atd,"");assert.equal(r.eta,"15:09");
  const c=parseKayak({flights:[af3143]},"2026-10-01","CDG","09:40");assert.equal(c.etd,"");assert.equal(c.atd,"");
});
test("statut S avec horaire piste passé = parti (ATD)",()=>{
  const r=parseKayak({flights:[normalizeStatus(ly328,Date.UTC(2026,9,1,8,30))]},"2026-10-01","CDG","09:25");
  assert.equal(r.atd,"09:50");assert.equal(r.etd,"");
});
