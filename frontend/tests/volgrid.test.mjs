import assert from "node:assert/strict";
import { test } from "node:test";
import * as V from "../lib/volgrid.ts";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≠ ${b} (±${tol})`);
/** Smile connu, linéaire en k par tranche (l'interpolation linéaire doit donc être exacte sur les tranches). */
const vol = (k, T) => 0.2 + 0.02 * T - 0.1 * k;
function pts() {
  const out = [];
  for (const [expiry, days, lo, hi] of [["A", 30, -0.3, 0.2], ["B", 90, -0.2, 0.15], ["C", 180, -0.1, 0.1]]) {
    const T = days / 365;
    for (let k = lo; k <= hi + 1e-9; k += 0.025) out.push({ expiry, T, K: 100 * Math.exp(k), F: 100, k, iv: vol(k, T) });
  }
  return out;
}

test("tranches : triées, IV exacte entre strikes cotés, rien hors de la plage cotée", () => {
  const s = V.slices(pts());
  assert.deepEqual(s.map((x) => x.expiry), ["A", "B", "C"]);
  near(V.sliceIv(s[1], 0.0123), vol(0.0123, 90 / 365), 1e-12);
  assert.equal(V.sliceIv(s[2], -0.2), null, "pas d'extrapolation");
  assert.equal(V.sliceIv(s[2], 0.11), null);
});

test("grille : échéances cotées exactes, variance totale entre échéances, trous hors couverture", () => {
  const g = V.volGrid(pts(), { mMin: 80, mMax: 120, nk: 41, between: 1 });
  assert.equal(g.z.length, 5); // 3 échéances + 2 lignes intermédiaires
  const iAtm = g.m.findIndex((x) => Math.abs(x - 100) < 1e-9);
  near(g.z[0][iAtm], vol(0, 30 / 365), 1e-12, "ATM 30 j");
  // ligne intermédiaire entre 30 et 90 j : variance totale linéaire
  const T0 = 30 / 365, T1 = 90 / 365, T = (T0 + T1) / 2, a = vol(0, T0), c = vol(0, T1);
  near(g.z[1][iAtm], Math.sqrt((a * a * T0 + (c * c * T1 - a * a * T0) * 0.5) / T), 1e-12);
  near(g.days[1], T * 365, 1e-9);
  // 80 % du forward (k ≈ −0,223) : couvert à 30 j, pas à 90 j (−0,2) ni à 180 j
  assert.notEqual(g.z[0][0], null);
  assert.equal(g.z[2][0], null);
  assert.equal(g.z[1][0], null, "interpolation seulement si les deux tranches couvrent le strike");
  near(g.atm[2].iv, vol(0, 180 / 365), 1e-12);
});
