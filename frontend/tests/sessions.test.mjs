import assert from "node:assert/strict";
import { test } from "node:test";
import { EXCHANGES, sessionState } from "../lib/sessions.ts";

const ex = (code) => EXCHANGES.find((e) => e.code === code);

test("NYSE ouvert un mardi à 10 h New York (heure d'hiver)", () => {
  assert.equal(sessionState(ex("NYSE"), new Date("2026-11-17T15:00:00Z")).state, "OPEN");
});

test("NYSE fermé avant l'ouverture et à 16 h pile", () => {
  assert.equal(sessionState(ex("NYSE"), new Date("2026-11-17T14:00:00Z")).state, "CLOSED"); // 9 h
  assert.equal(sessionState(ex("NYSE"), new Date("2026-11-17T21:00:00Z")).state, "CLOSED"); // 16 h
});

test("heure d'été prise en compte (Paris, juillet)", () => {
  // 07:30 UTC = 9 h 30 à Paris en été
  assert.equal(sessionState(ex("EPA"), new Date("2026-07-15T07:30:00Z")).state, "OPEN");
  assert.equal(sessionState(ex("EPA"), new Date("2026-07-15T06:30:00Z")).state, "CLOSED");
});

test("pause déjeuner à Tokyo et Hong Kong", () => {
  assert.equal(sessionState(ex("TSE"), new Date("2026-11-17T03:00:00Z")).state, "BREAK"); // 12 h Tokyo
  assert.equal(sessionState(ex("HKEX"), new Date("2026-11-17T04:30:00Z")).state, "BREAK"); // 12 h 30 HK
});

test("week-end fermé", () => {
  assert.equal(sessionState(ex("LSE"), new Date("2026-11-21T11:00:00Z")).state, "CLOSED"); // samedi
});
