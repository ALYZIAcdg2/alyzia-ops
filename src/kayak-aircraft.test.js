import test from "node:test";
import assert from "node:assert/strict";
import {kayakAircraftToIata as k} from "./kayak-aircraft.js";
test("libellés réels du tableau Kayak -> codes app",()=>{
  const m={"Airbus A330-300":"333","Boeing 787-9":"789","Airbus A320":"320","Boeing 737-800 (winglets)":"738","Airbus A320neo":"32N","Boeing 737MAX 8":"7M8","Airbus A220-300":"223","Embraer 190":"E90","Boeing 777-300ER":"77W","Boeing 777-200 / 200ER":"772","Airbus A318":"318","Boeing 737-800":"738","Airbus A350-900":"359","Airbus A321neo":"32Q","Airbus A321":"321"};
  for(const [n,c] of Object.entries(m))assert.equal(k(n),c,n);
  assert.equal(k(""),"");assert.equal(k("Avion inconnu"),"");
});
