import test from "node:test";
import assert from "node:assert/strict";
import {paceAllowed,paceRoom} from "./budget-pace.js";

test("le budget est étalé : 20 % dès le matin, 100 % à 23 h",()=>{
  const h=n=>n*60;
  assert.equal(paceAllowed(40,h(3)),8);           // nuit : 20 %
  assert.equal(paceAllowed(40,h(8)),14);          // 08 h : 8 appels + 6 (17 % de 80 %)
  assert.equal(paceAllowed(40,h(14)),24);
  assert.equal(paceAllowed(40,h(23)),40);
  assert.equal(paceAllowed(16,h(3)),4);
  assert.equal(paceAllowed(7,h(3)),2);
  assert.equal(paceAllowed(0,h(12)),0);
  assert.ok(paceAllowed(25,h(10))<=25);
});
test("on ne peut plus dépenser tout le plafond le matin",()=>{
  assert.equal(paceRoom(14,40,8*60),0);           // 14 appels déjà faits à 08 h : on attend
  assert.equal(paceRoom(10,40,8*60),4);
  assert.equal(paceRoom(39,40,23*60),1);
});
test("le PUSH manuel ignore l'étalement mais respecte le plafond",()=>{
  globalThis.__ALYZIA_MANUAL_PUSH=true;
  try{assert.equal(paceRoom(14,40,8*60),26);assert.equal(paceRoom(40,40,8*60),0)}finally{globalThis.__ALYZIA_MANUAL_PUSH=false}
});
