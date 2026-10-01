import test from "node:test";
import assert from "node:assert/strict";
import {parseLive,localHm} from "./fr24api-queue-runner.js";

const payload={data:[
  {fr24_id:"41ebe183",flight:"TK1824",orig_iata:"CDG",dest_iata:"IST",eta:"2026-10-01T16:10:00Z",reg:"TC-JNH",type:"A333"},
  {flight:"BJ509",orig_iata:"CDG",dest_iata:"DJE",eta:"2026-10-01T15:50:00Z",reg:"TS-IAB",type:"A320"},
  {flight:"XX1",orig_iata:"LHR",dest_iata:"JFK",eta:"2026-10-01T15:50:00Z"}]};
test("parseLive garde les départs CDG avec ETA/immat/type",()=>{
  const m=parseLive(payload);
  assert.equal(m.size,2);assert.deepEqual(m.get("TK1824"),{eta:"2026-10-01T16:10:00Z",reg:"TC-JNH",type:"A333",dest:"IST"});
});
test("ETA UTC convertie en heure locale d'arrivée",()=>{
  assert.equal(localHm("2026-10-01T16:10:00Z","Europe/Istanbul"),"19:10");
  assert.equal(localHm("2026-10-01T15:50:00Z","Africa/Tunis"),"16:50");
  assert.equal(localHm("","Europe/Paris"),"");assert.equal(localHm("2026-10-01T15:50:00Z",""),"");
});

import {parseSummary,parseGateArrivals} from "./fr24api-queue-runner.js";
test("parseSummary garde le tronçon CDG de la date et signale l'atterrissage",()=>{
  const p={data:[
    {fr24_id:"a1",flight:"LO334",orig_iata:"CDG",dest_iata:"WAW",datetime_takeoff:"2026-10-01T05:33:23Z",datetime_landed:"2026-10-01T07:29:13Z"},
    {fr24_id:"a2",flight:"LO334",orig_iata:"WAW",dest_iata:"CDG",datetime_takeoff:"2026-10-01T09:00:00Z",datetime_landed:null},
    {fr24_id:"a3",flight:"AV55",orig_iata:"CDG",dest_iata:"BOG",datetime_takeoff:"2026-10-01T07:20:11Z",datetime_landed:null}]};
  const m=parseSummary(p,"2026-10-01");
  assert.deepEqual(m.get("LO334"),{id:"a1",dest:"WAW",landed:true,takeoff:"2026-10-01T05:33:23Z"});
  assert.equal(m.get("AV55").landed,false);
});
test("parseGateArrivals ne retient que gate_arrival, jamais landed",()=>{
  const p={data:[{fr24_id:"a1",events:[{type:"takeoff",timestamp:"2026-10-01T05:33:00Z"},{type:"landed",timestamp:"2026-10-01T07:29:13Z"},{type:"gate_arrival",timestamp:"2026-10-01T07:33:00Z"}]},{fr24_id:"a2",events:[{type:"landed",timestamp:"2026-10-01T08:41:00Z"}]}]};
  const m=parseGateArrivals(p);
  assert.equal(m.get("a1"),"2026-10-01T07:33:00Z");assert.equal(m.has("a2"),false);
  assert.equal(localHm(m.get("a1"),"Europe/Warsaw"),"09:33");
});
