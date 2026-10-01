import test from "node:test";
import assert from "node:assert/strict";
import {describeState} from "./provider-state.js";

test("raisons lisibles pour chaque type d'arrêt",()=>{
  assert.match(describeState({skipped:"SKYLINK_PLAFOND_JOUR",day:40}).label,/Plafond du jour atteint \(40/);
  assert.match(describeState({skipped:"SKYLINK_RYTHME"}).label,/Budget étalé/);
  assert.match(describeState({skipped:"FR24DEP_QUOTA",day:16,month:40}).label,/Plafond atteint \(aujourd'hui 16 · ce mois 40/);
  assert.match(describeState({skipped:"KAYAK_PAUSE_502",until:"2026-10-01T12:31:41.000Z",message:"API unreachable"}).label,/En pause jusqu'à 12:31 \(HTTP 502\) : API unreachable/);
  assert.match(describeState({skipped:"FLIGHTERA_QUEUE_VIDE"}).label,/Aucun vol à traiter/);
  assert.match(describeState({skipped:"AIRLABS_LIVE_CADENCE"}).label,/cadence/);
  assert.match(describeState({skipped:"QUARK_NON_CONFIGURE"}).label,/Clé non configurée/);
  assert.match(describeState({skipped:"AIRLABS_QUOTA_RESERVE"}).label,/Réserve/);
});
test("actif, rien traité, erreur",()=>{
  assert.equal(describeState({ok:true,processed:1,items:[{}]}).code,"ACTIF");
  assert.equal(describeState({ok:true,results:[{ok:true},{ok:false}]}).label,"Actif : 1 vol traité au dernier passage");
  assert.equal(describeState({ok:true,items:[]}).code,"RIEN");
  assert.match(describeState(null,new Error("boom")).label,/Erreur.*boom/);
});
