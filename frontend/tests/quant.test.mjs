import assert from "node:assert/strict";
import { test } from "node:test";
import * as Q from "../lib/quant.ts";
import * as P from "../lib/paper.ts";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≠ ${b} (±${tol})`);

test("loi normale", () => {
  near(Q.normCdf(0), 0.5, 1e-12); near(Q.normCdf(1.96), 0.9750021, 1e-6); near(Q.normCdf(-1), 0.1586553, 1e-6);
});

test("Black-Scholes : valeurs de référence (Hull) et parité call-put", () => {
  const o = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 };
  const c = Q.blackScholes({ ...o, type: "call" }), p = Q.blackScholes({ ...o, type: "put" });
  near(c.price, 10.4506, 1e-4); near(p.price, 5.5735, 1e-4);
  near(c.price - p.price, 100 - 100 * Math.exp(-0.05), 1e-10, "parité");
  near(c.delta, 0.6368, 1e-4); near(c.gamma, 0.018762, 1e-6); near(c.vega, 0.37524, 1e-5);
  // Hull, exemple 15.6 : S=42, K=40, r=10 %, σ=20 %, T=0,5 -> call 4,76, put 0,81
  near(Q.blackScholes({ S: 42, K: 40, T: 0.5, r: 0.1, sigma: 0.2, type: "call" }).price, 4.76, 5e-3);
  near(Q.blackScholes({ S: 42, K: 40, T: 0.5, r: 0.1, sigma: 0.2, type: "put" }).price, 0.81, 5e-3);
});

test("grecques cohérentes avec des différences finies", () => {
  const o = { S: 100, K: 95, T: 0.75, r: 0.03, q: 0.01, sigma: 0.25, type: "put" };
  const g = Q.blackScholes(o), h = 0.01;
  near(g.delta, (Q.blackScholes({ ...o, S: 100 + h }).price - Q.blackScholes({ ...o, S: 100 - h }).price) / (2 * h), 1e-6, "delta");
  near(g.vega, (Q.blackScholes({ ...o, sigma: 0.26 }).price - Q.blackScholes({ ...o, sigma: 0.24 }).price) / 2, 1e-4, "vega");
  near(g.theta, (Q.blackScholes({ ...o, T: 0.75 - 1 / 365 }).price - g.price), 1e-3, "theta");
});

test("volatilité implicite : aller-retour", () => {
  const o = { S: 100, K: 110, T: 0.5, r: 0.02, type: "call" };
  const px = Q.blackScholes({ ...o, sigma: 0.31 }).price;
  near(Q.impliedVol(px, o), 0.31, 1e-8);
  assert.equal(Q.impliedVol(0, o), null);
});

test("binomial converge vers Black-Scholes ; put américain ≥ européen", () => {
  const o = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2, type: "put" };
  near(Q.binomial(o, 1000), Q.blackScholes(o).price, 5e-3);
  assert.ok(Q.binomial(o, 500, true) > Q.binomial(o, 500, false));
  near(Q.binomial(o, 1000, true), 6.0896, 5e-3, "put américain de référence");
});

test("Monte Carlo à moins de 3 erreurs-types", () => {
  const o = { S: 100, K: 105, T: 1, r: 0.03, sigma: 0.25, type: "call" };
  const mc = Q.monteCarlo(o, 200_000);
  near(mc.price, Q.blackScholes(o).price, 3 * mc.stderr + 1e-9);
});

test("payoff d'un straddle", () => {
  const legs = [{ kind: "call", side: 1, qty: 1, K: 100, premium: 5 }, { kind: "put", side: 1, qty: 1, K: 100, premium: 4 }];
  assert.equal(Q.payoff(legs, 100), -9); assert.equal(Q.payoff(legs, 120), 11); assert.equal(Q.payoff(legs, 80), 11);
});

test("obligation au pair : prix 100, duration de Macaulay connue", () => {
  const b = { settle: "2026-01-15", maturity: "2031-01-15", coupon: 0.05, freq: 1 };
  const r = Q.bondFromYield(b, 0.05);
  near(r.clean, 100, 1e-9); near(r.accrued, 0, 1e-12);
  near(r.macaulay, 4.5460, 1e-4); near(r.modified, 4.3295, 1e-4);
  near(r.dv01, r.modified * 100 / 10000, 1e-12);
  near(Q.yieldFromClean(b, 95), Q.yieldFromClean(b, 95), 0);
  near(Q.bondFromYield(b, Q.yieldFromClean(b, 95)).clean, 95, 1e-8, "aller-retour rendement");
});

test("coupon couru en cours de période et chocs de taux", () => {
  const b = { settle: "2026-04-15", maturity: "2036-01-15", coupon: 0.04, freq: 2 };
  const r = Q.bondFromYield(b, 0.04);
  near(r.accrued, 2 * (90 / 181), 1e-9);  // 15/01 -> 15/04 : 90 jours sur 181
  const s = Q.rateShocks(b, 0.04);
  const up100 = s.find((x) => x.bp === 100), dn100 = s.find((x) => x.bp === -100);
  assert.ok(up100.pct < 0 && dn100.pct > 0 && Math.abs(dn100.pct) > Math.abs(up100.pct), "convexité positive");
  near(up100.pct, up100.approxPct, 0.1, "duration + convexité proche de la réévaluation");
});

test("Z-spread nul sur sa propre courbe ; OAS = Z-spread sans option", () => {
  const b = { settle: "2026-01-15", maturity: "2033-01-15", coupon: 0.045, freq: 2 };
  const curve = [{ t: 0.5, r: 0.04 }, { t: 2, r: 0.041 }, { t: 5, r: 0.042 }, { t: 10, r: 0.044 }];
  const cfs = [...Array(14)].map((_, k) => ({ t: (k + 1) / 2, cf: 2.25 + (k === 13 ? 100 : 0) }));
  const dirty = cfs.reduce((a, x) => a + x.cf * Math.exp(-(Q.zeroRate(curve, x.t) + 0.012) * x.t), 0);
  near(Q.zSpread(b, dirty, curve), 0.012, 1e-8);
  near(Q.oasHoLee(b, dirty, curve, 0.01), 0.012, 5e-5, "OAS sans call");
  assert.ok(Q.oasHoLee(b, dirty, curve, 0.01, "2028-01-15", 100) < 0.012, "le call réduit l'OAS");
});

test("change à terme par parité des taux", () => {
  const { forward } = Q.fxForward(1.1, 0.04, 0.02, 360); // EUR/USD : USD domestique 4 %, EUR 2 %
  near(forward, 1.1 * 1.04 / 1.02, 1e-12);
  assert.equal(Q.pipFactor("USDJPY"), 100);
});

test("matières premières", () => {
  near(Q.crack321(80, 2.5, 2.8), (2 * 105 + 117.6 - 240) / 3, 1e-9);
  near(Q.soyCrush(300, 50, 1100), 6.6 + 5.5 - 11, 1e-9);
  near(Q.impliedConvenience(100, Q.carryForward(100, 0.05, 0.02, 0.03, 0.5), 0.05, 0.02, 0.5), 0.03, 1e-12);
  assert.ok(Q.rollYield(90, 85, 30) > 0, "backwardation : rendement de roulement positif");
  const h = Q.minVarHedge([0.01, -0.02, 0.015, 0.005], [0.02, -0.04, 0.03, 0.01], 1000, 100);
  near(h.hedgeRatio, 0.5, 1e-12); near(h.correlation, 1, 1e-12); near(h.contracts, 5, 1e-9);
});

test("valorisation : CAPM, WACC, DCF", () => {
  near(Q.capm(0.04, 1.2, 0.05), 0.10, 1e-12);
  near(Q.wacc(600, 400, 0.1, 0.05, 0.25), 0.075, 1e-12);
  const r = Q.dcf({ fcf: [100, 100], wacc: 0.1, terminalGrowth: 0, netDebt: 0, shares: 1 });
  near(r.ev, 1000, 1e-9, "rente perpétuelle de 100 à 10 %");
  assert.throws(() => Q.dcf({ fcf: [1], wacc: 0.02, terminalGrowth: 0.03, netDebt: 0, shares: 1 }));
  assert.deepEqual(Q.projectFcf(100, [0.1, 0.1]).map((x) => Math.round(x * 100) / 100), [110, 121]);
});

test("DCF inversé : retrouve la croissance qui a servi à fixer le cours", () => {
  const p = { fcf0: 100, years: 5, wacc: 0.09, terminalGrowth: 0.025, netDebt: 200, shares: 10 };
  for (const g of [-0.05, 0, 0.07, 0.25]) {
    const price = Q.dcf({ fcf: Q.projectFcf(p.fcf0, Array(5).fill(g)), wacc: p.wacc, terminalGrowth: p.terminalGrowth, netDebt: p.netDebt, shares: p.shares }).perShare;
    near(Q.impliedGrowth(price, p), g, 1e-9, `g=${g}`);
  }
  assert.equal(Q.impliedGrowth(100, { ...p, fcf0: -5 }), null);           // FCF négatif : pas de réponse
  assert.equal(Q.impliedGrowth(1e9, p), null);                            // cours hors d'atteinte
  assert.equal(Q.impliedGrowth(100, { ...p, wacc: 0.02 }), null);         // WACC ≤ g terminale
});

test("médiane", () => {
  assert.equal(Q.median([3, 1, 2]), 2);
  assert.equal(Q.median([4, 1, 3, 2]), 2.5);
  assert.equal(Q.median([NaN, 5]), 5);
  assert.equal(Q.median([]), null);
});

test("paper trading : exécution, prix moyen, P&L réalisé et latent", () => {
  const costs = { spreadBps: 0, impactCoef: 0, feeBps: 0, minFee: 0 };
  const q = { AAPL: { last: 100, bid: 99.9, ask: 100.1 } };
  let a = P.newAccount(10_000);
  a = P.submit(a, { id: "1", symbol: "AAPL", side: "BUY", type: "MARKET", qty: 10 }, q, 1, costs);
  assert.equal(a.positions.AAPL.qty, 10); assert.equal(a.positions.AAPL.avgPrice, 100.1);
  a = P.submit(a, { id: "2", symbol: "AAPL", side: "BUY", type: "MARKET", qty: 10 }, { AAPL: { last: 110, bid: 109.9, ask: 110.1 } }, 2, costs);
  near(a.positions.AAPL.avgPrice, 105.1, 1e-9);
  a = P.submit(a, { id: "3", symbol: "AAPL", side: "SELL", type: "MARKET", qty: 5 }, { AAPL: { last: 120, bid: 119.9, ask: 120.1 } }, 3, costs);
  near(a.positions.AAPL.realized, 5 * (119.9 - 105.1), 1e-9);
  const v = P.valuation(a, { AAPL: { last: 120 } });
  near(v.unrealized, 15 * (120 - 105.1), 1e-9);
  near(v.equity, 10_000 + v.pnl, 1e-9);
  near(v.pnl, v.realized + v.unrealized, 1e-9, "P&L = réalisé + latent sans frais");
});

test("ordres limite, stop et OCO", () => {
  const costs = { spreadBps: 0, impactCoef: 0, feeBps: 0, minFee: 0 };
  let a = P.newAccount(10_000);
  a = P.submit(a, { id: "L", symbol: "X", side: "BUY", type: "LIMIT", qty: 1, limit: 95 }, { X: { last: 100 } }, 1, costs);
  assert.equal(a.orders[0].status, "WORKING");
  a = P.evaluate(a, { X: { last: 94 } }, 2, costs);
  assert.equal(a.orders.find((o) => o.id === "L").status, "FILLED");
  a = P.submit(a, { id: "TP", symbol: "X", side: "SELL", type: "LIMIT", qty: 1, limit: 110, ocoGroup: "g" }, { X: { last: 100 } }, 3, costs);
  a = P.submit(a, { id: "SL", symbol: "X", side: "SELL", type: "STOP", qty: 1, stop: 90, ocoGroup: "g" }, { X: { last: 100 } }, 4, costs);
  a = P.evaluate(a, { X: { last: 89 } }, 5, costs);
  assert.equal(a.orders.find((o) => o.id === "SL").status, "FILLED");
  assert.equal(a.orders.find((o) => o.id === "TP").status, "CANCELLED");
  assert.equal(a.positions.X.qty, 0);
  const r = P.submit(a, { id: "Z", symbol: "X", side: "BUY", type: "LIMIT", qty: 1 }, { X: { last: 1 } });
  assert.equal(r.orders[0].status, "REJECTED");
});

test("coûts : glissement et impact augmentent avec la taille", () => {
  const q = { last: 100, adv: 1_000_000, vol: 0.3 };
  assert.ok(P.impact(q, 100_000) > P.impact(q, 1_000));
  const t = P.touch({ last: 100 }, { ...P.DEFAULT_COSTS, spreadBps: 10 });
  near(t.ask - t.bid, 0.1, 1e-12); assert.equal(t.modelled, true);
  assert.equal(P.syntheticBook({ last: 100, bid: 99.9, ask: 100.1 }).bids.length, 5);
});

test("alertes de prix et d'actualité", async () => {
  const A = await import("../lib/alerts.ts");
  const al = [{ id: "a", kind: "price", active: true, created: 0, symbol: "X", op: ">=", price: 10 }, { id: "b", kind: "price", active: true, created: 0, symbol: "X", op: "<=", price: 5 },
    { id: "c", kind: "price", active: false, created: 0, symbol: "X", op: ">=", price: 1 }];
  assert.deepEqual(A.checkPrice(al, { X: 12 }).map((a) => a.id), ["a"]);
  assert.deepEqual(A.checkPrice(al, { X: 4 }).map((a) => a.id), ["b"]);
  assert.equal(A.newArticles({ lastSeen: "2026-01-02" }, [{ published: "2026-01-03" }, { published: "2026-01-01" }]).length, 1);
});

test("indicateurs techniques : ATR, VWAP, supports et résistances", async () => {
  const I = await import("../lib/indicators.ts");
  const c = Array.from({ length: 30 }, (_, i) => ({ high: 11, low: 9, close: 10, volume: 100 }));
  const a = I.atr(c.map((_, i) => i), c, 14);
  near(a.at(-1).value, 2, 1e-12, "étendue constante de 2");
  const v = I.vwap([0, 1], [{ high: 10, low: 10, close: 10, volume: 1 }, { high: 20, low: 20, close: 20, volume: 3 }]);
  near(v[1].value, 17.5, 1e-12, "(10×1 + 20×3) / 4");
  const wave = Array.from({ length: 60 }, (_, i) => { const p = 100 + 10 * Math.sin(i / 3); return { high: p + 1, low: p - 1, close: p, volume: 1 }; });
  const lv = I.levels(wave, 3, 0.02);
  assert.ok(lv.some((l) => l.kind === "résistance" && Math.abs(l.price - 111) < 1.5));
  assert.ok(lv.some((l) => l.kind === "support" && Math.abs(l.price - 89) < 1.5));
});

test("paper trading : fourchette réelle écartée si elle est décalée du dernier cours", () => {
  const ok = P.touch({ last: 100, bid: 99.9, ask: 100.1 });
  assert.equal(ok.modelled, false);
  const stale = P.touch({ last: 355.29, bid: 350.9, ask: 351.08 }); // fourchette de la veille, cas observé le 18/11
  assert.equal(stale.modelled, true); assert.equal(stale.stale, true);
  near((stale.bid + stale.ask) / 2, 355.29, 1e-9);
});
