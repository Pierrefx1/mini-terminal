import assert from "node:assert/strict";
import { test } from "node:test";
import { down, failing, impact } from "../lib/sources.ts";

const now = "2026-11-22T16:00:00+00:00";
const row = (o) => ({ source: "X", last_ok: null, last_error_at: null, last_error: null, ok_count: 0, err_count: 0, last_ms: null, streak: 0, down_since: null, ...o });

test("panne durable : plusieurs échecs d'affilée, le dernier récent", () => {
  assert.equal(down(row({ last_error_at: "2026-11-22T15:50:00+00:00", streak: 42, err_count: 42 }), now), true);
  // un seul raté : échec, pas panne
  const once = row({ last_ok: "2026-11-22T15:00:00+00:00", last_error_at: "2026-11-22T15:50:00+00:00", streak: 1 });
  assert.equal(failing(once), true); assert.equal(down(once, now), false);
  // rétablie : le dernier succès est plus récent que le dernier échec
  assert.equal(down(row({ last_ok: "2026-11-22T15:55:00+00:00", last_error_at: "2026-11-22T15:50:00+00:00", streak: 0 }), now), false);
  // plus appelée depuis plus de 24 h : plus signalée
  assert.equal(down(row({ last_error_at: "2026-11-20T15:00:00+00:00", streak: 9 }), now), false);
});

test("modules touchés : sources majeures et secondaires", () => {
  assert.match(impact("Yahoo Finance via yfinance (options)").modules, /OMON/);
  assert.equal(impact("Yahoo Finance via yfinance (options)").minor, false);
  assert.equal(impact("Yahoo Finance (différé)").minor, false);
  assert.equal(impact("Yahoo Finance (RSS)").minor, true);
  assert.equal(impact("Al Jazeera").minor, true);
  assert.match(impact("Tâche planifiée : geo_risk.sync").modules, /World Monitor/);
});
