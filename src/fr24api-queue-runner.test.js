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
