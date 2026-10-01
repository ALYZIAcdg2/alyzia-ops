import test from "node:test";
import assert from "node:assert/strict";
import {parseSerpapi} from "./serpapi-queue-runner.js";

// Réponses réelles (Google « statut du vol » via SerpApi), 1er octobre 2026
const tk1824={flight_result:{dates:[
  {date:"2026-09-30",metadata:{origin:"CDG",destination:"IST",status:"ARRIVED_DELAYED",departure_delay:6,arrival_delay:19}},
  {date:"2026-10-01",metadata:{airline_iata_code:"TK",flight_number:"1824",origin:"CDG",destination:"IST",status:"ON_THE_RUNWAY_AT_ORIGIN",departure_delay:7,arrival_delay:12},
   departure_airport:{time:"2026-10-01T14:27:00.000+02:00",scheduled_time:"2026-10-01T14:20:00.000+02:00",terminal:"1",gate:"18",id:"CDG"},
   arrival_airport:{time:"2026-10-01T19:07:00.000+03:00",scheduled_time:"2026-10-01T18:55:00.000+03:00",id:"IST",terminal:"-",gate:"-"},duration:220,source:"Cirium"}]}};
const bj509={flight_result:{dates:[
  {date:"2026-10-01",metadata:{origin:"CDG",destination:"DJE",status:"DEPARTING_ON_TIME",departure_delay:0,arrival_delay:0},
   departure_airport:{time:"2026-10-01T15:00:00.000+02:00",scheduled_time:"2026-10-01T15:00:00.000+02:00",terminal:"3",gate:"8",id:"CDG"},
   arrival_airport:{time:"2026-10-01T16:50:00.000+01:00",scheduled_time:"2026-10-01T16:50:00.000+01:00",id:"DJE",terminal:"-",gate:"-"},source:"OAG"}]}};

test("TK1824 au roulage/décollage : ATD réel, ETA estimée, STA et porte",()=>{
  const r=parseSerpapi(tk1824,"2026-10-01","CDG","14:20");
  assert.equal(r.atd,"14:27");assert.equal(r.eta,"19:07");assert.equal(r.sta,"18:55");assert.equal(r.gate,"18");
  assert.equal(r.etd,"");assert.equal(r.ata,"");
});
test("BJ509 à l'heure : aucun ETD ni ETA inventé, STA et porte",()=>{
  const r=parseSerpapi(bj509,"2026-10-01","CDG","15:00");
  assert.equal(r.etd,"");assert.equal(r.eta,"");assert.equal(r.atd,"");assert.equal(r.sta,"16:50");assert.equal(r.gate,"8");
});
test("vol programmé en retard : ETD et ETA estimées ; vol arrivé : ATD + ATA ; annulé : rien",()=>{
  const late=JSON.parse(JSON.stringify(bj509));const e=late.flight_result.dates[0];e.metadata.status="DEPARTING_LATE";e.departure_airport.time="2026-10-01T15:40:00.000+02:00";e.arrival_airport.time="2026-10-01T17:30:00.000+01:00";
  const a=parseSerpapi(late,"2026-10-01","CDG","15:00");assert.equal(a.etd,"15:40");assert.equal(a.eta,"17:30");assert.equal(a.atd,"");
  const arrived=JSON.parse(JSON.stringify(tk1824));arrived.flight_result.dates[1].metadata.status="ARRIVED_DELAYED";
  const b=parseSerpapi(arrived,"2026-10-01","CDG","14:20");assert.equal(b.atd,"14:27");assert.equal(b.ata,"19:07");assert.equal(b.eta,"");
  const canc=JSON.parse(JSON.stringify(tk1824));canc.flight_result.dates[1].metadata.status="CANCELLED";
  const c=parseSerpapi(canc,"2026-10-01","CDG","14:20");assert.equal(c.status,"CANCELLED");assert.equal(c.atd,"");assert.equal(c.eta,"");
});
test("mauvaise date, mauvais aéroport, STD trop éloignée, réponse vide : ignoré",()=>{
  assert.equal(parseSerpapi(tk1824,"2026-10-02","CDG","14:20"),null);
  assert.equal(parseSerpapi(tk1824,"2026-10-01","ORY","14:20"),null);
  assert.equal(parseSerpapi(tk1824,"2026-10-01","CDG","20:00"),null);
  assert.equal(parseSerpapi({organic_results:[]},"2026-10-01","CDG","14:20"),null);
  assert.equal(parseSerpapi(null,"2026-10-01","CDG","14:20"),null);
});
