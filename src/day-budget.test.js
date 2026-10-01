import test from "node:test";
import assert from "node:assert/strict";
import {allowedToday} from "./day-budget.js";
test("quota 820, 1er octobre : 27 appels/jour",()=>assert.equal(allowedToday(820,0,"2026-10-01"),27));
test("le budget se recalcule sur les jours restants",()=>{assert.equal(allowedToday(820,420,"2026-10-16"),25);assert.equal(allowedToday(820,800,"2026-10-31"),20)});
test("quota épuisé : au moins 1",()=>assert.equal(allowedToday(820,900,"2026-10-10"),1));
