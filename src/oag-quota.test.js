import test from "node:test";
import assert from "node:assert/strict";
import {daysRemaining,quotaPlan,releaseRatio} from "./oag-quota.js";

test("daysRemaining utilise le mois calendaire",()=>{
  assert.equal(daysRemaining("2026-09-26"),5);
  assert.equal(daysRemaining("2026-09-30"),1);
});

test("l'objectif journalier reste stable pendant la journée",()=>{
  const morning=quotaPlan({date:"2026-09-01",minutes:9*60,dayCalls:0,monthCalls:0,limit:1000});
  const later=quotaPlan({date:"2026-09-01",minutes:15*60,dayCalls:10,monthCalls:10,limit:1000});
  assert.equal(morning.dailyTarget,32);
  assert.equal(later.dailyTarget,morning.dailyTarget);
  assert.ok(later.normalCap>morning.normalCap);
});

test("la réserve mensuelle diminue en fin de mois",()=>{
  const early=quotaPlan({date:"2026-09-01",minutes:12*60,limit:1000});
  const late=quotaPlan({date:"2026-09-26",minutes:12*60,limit:1000});
  const last=quotaPlan({date:"2026-09-30",minutes:12*60,limit:1000});
  assert.equal(early.reserve,50);
  assert.equal(late.reserve,30);
  assert.equal(last.reserve,10);
});

test("la libération du budget garde des crédits pour la soirée",()=>{
  assert.equal(releaseRatio(5*60),0.08);
  assert.equal(releaseRatio(12*60),0.55);
  assert.equal(releaseRatio(21*60),1);
});
