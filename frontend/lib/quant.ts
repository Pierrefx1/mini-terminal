/**
 * Bibliothèque de calcul financier (fonctions pures, sans dépendance).
 * Testée par tests/quant.test.mjs contre des valeurs de référence.
 * Conventions : taux et volatilités en décimal (0.05 = 5 %), durées en années.
 */

// ───────────────────────── Loi normale ─────────────────────────
export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
/** Fonction de répartition (approximation de Hart / West, précision ~1e-15). */
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let c: number;
  if (z > 37) c = 0;
  else {
    const e = Math.exp(-z * z / 2);
    if (z < 7.07106781186547) {
      const n = ((((((0.0352624965998911 * z + 0.700383064443688) * z + 6.37396220353165) * z + 33.912866078383) * z + 112.079291497871) * z + 221.213596169931) * z + 220.206867912376);
      const d = (((((((0.0883883476483184 * z + 1.75566716318264) * z + 16.064177579207) * z + 86.7807322029461) * z + 296.564248779674) * z + 637.333633378831) * z + 793.826512519948) * z + 440.413735824752);
      c = e * n / d;
    } else {
      c = e / (z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 0.65))))) / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

/** Générateur pseudo-aléatoire reproductible (mulberry32) et tirages normaux (Box-Muller). */
export function rng(seed = 42) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, n: () => { let x = 0; while (x === 0) x = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * u()); } };
}

// ───────────────────────── Options ─────────────────────────
export type OptType = "call" | "put";
export type OptIn = { S: number; K: number; T: number; r: number; q?: number; sigma: number; type: OptType };
export type Greeks = { price: number; delta: number; gamma: number; vega: number; theta: number; rho: number };

/**
 * Black-Scholes-Merton (dividende continu q ; Garman-Kohlhagen pour le change avec q = taux étranger).
 * vega et rho pour 1 point de pourcentage, theta par jour calendaire.
 */
export function blackScholes({ S, K, T, r, q = 0, sigma, type }: OptIn): Greeks {
  if (T <= 0 || sigma <= 0) {
    const intrinsic = Math.max(type === "call" ? S - K : K - S, 0);
    return { price: intrinsic, delta: type === "call" ? +(S > K) : -(S < K), gamma: 0, vega: 0, theta: 0, rho: 0 };
  }
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / (sigma * sq), d2 = d1 - sigma * sq;
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T);
  const gamma = dq * normPdf(d1) / (S * sigma * sq);
  const vega = S * dq * normPdf(d1) * sq / 100;
  if (type === "call") {
    const price = S * dq * normCdf(d1) - K * dr * normCdf(d2);
    const theta = (-S * dq * normPdf(d1) * sigma / (2 * sq) - r * K * dr * normCdf(d2) + q * S * dq * normCdf(d1)) / 365;
    return { price, delta: dq * normCdf(d1), gamma, vega, theta, rho: K * T * dr * normCdf(d2) / 100 };
  }
  const price = K * dr * normCdf(-d2) - S * dq * normCdf(-d1);
  const theta = (-S * dq * normPdf(d1) * sigma / (2 * sq) + r * K * dr * normCdf(-d2) - q * S * dq * normCdf(-d1)) / 365;
  return { price, delta: -dq * normCdf(-d1), gamma, vega, theta, rho: -K * T * dr * normCdf(-d2) / 100 };
}

/** Volatilité implicite par dichotomie ; null si le prix est hors des bornes d'arbitrage. */
export function impliedVol(price: number, o: Omit<OptIn, "sigma">): number | null {
  const lo0 = blackScholes({ ...o, sigma: 1e-6 }).price, hi0 = blackScholes({ ...o, sigma: 5 }).price;
  if (!(price > lo0 + 1e-10 && price < hi0)) return null; // au plus la valeur intrinsèque actualisée : pas de solution
  let lo = 1e-6, hi = 5;
  for (let i = 0; i < 200 && hi - lo > 1e-10; i++) {
    const m = (lo + hi) / 2;
    if (blackScholes({ ...o, sigma: m }).price > price) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}

/** Arbre binomial de Cox-Ross-Rubinstein, européen ou américain. */
export function binomial({ S, K, T, r, q = 0, sigma, type }: OptIn, steps = 500, american = false): number {
  const dt = T / steps, u = Math.exp(sigma * Math.sqrt(dt)), d = 1 / u;
  const p = (Math.exp((r - q) * dt) - d) / (u - d), disc = Math.exp(-r * dt);
  const pay = (s: number) => Math.max(type === "call" ? s - K : K - s, 0);
  const v = new Float64Array(steps + 1);
  for (let j = 0; j <= steps; j++) v[j] = pay(S * u ** j * d ** (steps - j));
  for (let i = steps - 1; i >= 0; i--) {
    for (let j = 0; j <= i; j++) {
      const cont = disc * (p * v[j + 1] + (1 - p) * v[j]);
      v[j] = american ? Math.max(cont, pay(S * u ** j * d ** (i - j))) : cont;
    }
  }
  return v[0];
}

/** Monte Carlo européen (variables antithétiques) : prix et erreur-type. */
export function monteCarlo({ S, K, T, r, q = 0, sigma, type }: OptIn, paths = 100_000, seed = 7): { price: number; stderr: number } {
  const g = rng(seed), drift = (r - q - sigma * sigma / 2) * T, vol = sigma * Math.sqrt(T), disc = Math.exp(-r * T);
  let sum = 0, sum2 = 0;
  const n = Math.floor(paths / 2);
  for (let i = 0; i < n; i++) {
    const z = g.n();
    const a = S * Math.exp(drift + vol * z), b = S * Math.exp(drift - vol * z);
    const x = (Math.max(type === "call" ? a - K : K - a, 0) + Math.max(type === "call" ? b - K : K - b, 0)) / 2 * disc;
    sum += x; sum2 += x * x;
  }
  const mean = sum / n;
  return { price: mean, stderr: Math.sqrt(Math.max(sum2 / n - mean * mean, 0) / n) };
}

export type Leg = { kind: "call" | "put" | "underlying"; side: 1 | -1; qty: number; K?: number; premium?: number };
/** Gain ou perte à l'échéance d'une combinaison, pour un prix du sous-jacent S. */
export function payoff(legs: Leg[], S: number, entry = 0): number {
  return legs.reduce((acc, l) => {
    const p = l.premium ?? 0;
    const v = l.kind === "underlying" ? S - entry : Math.max(l.kind === "call" ? S - l.K! : l.K! - S, 0) - p;
    return acc + l.side * l.qty * v;
  }, 0);
}

// ───────────────────────── Obligations ─────────────────────────
export type Bond = { settle: string; maturity: string; coupon: number; freq: 1 | 2 | 4; redemption?: number };
const DAY = 86_400_000;
const parse = (d: string) => new Date(d + "T00:00:00Z");
const addMonths = (d: Date, m: number) => { const x = new Date(d); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + m); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x; };

/** Échéancier : dates de coupon postérieures au règlement, coupon précédent, fraction de période restante (ACT/ACT ICMA). */
export function schedule(b: Bond) {
  const settle = parse(b.settle), mat = parse(b.maturity), step = 12 / b.freq;
  if (!(mat > settle)) throw new Error("L'échéance doit suivre la date de règlement");
  const dates: Date[] = [];
  let d = mat, k = 0;
  while (d > settle) { dates.unshift(d); k++; d = addMonths(mat, -step * k); }
  const prev = d, next = dates[0];
  const w = (next.getTime() - settle.getTime()) / (next.getTime() - prev.getTime());
  return { dates, prev, next, w, accruedFrac: 1 - w };
}

export type BondRisk = { dirty: number; clean: number; accrued: number; macaulay: number; modified: number; convexity: number; dv01: number };

/** Prix (pour 100 de nominal) et sensibilités à partir du rendement actuariel y (convention de marché, composé à la fréquence du coupon). */
export function bondFromYield(b: Bond, y: number): BondRisk {
  const { dates, w, accruedFrac } = schedule(b);
  const f = b.freq, c = 100 * b.coupon / f, red = b.redemption ?? 100;
  let pv = 0, tw = 0, cx = 0;
  dates.forEach((_, k) => {
    const n = w + k, cf = c + (k === dates.length - 1 ? red : 0);
    const df = (1 + y / f) ** -n, v = cf * df;
    pv += v; tw += v * n; cx += v * n * (n + 1);
  });
  const accrued = c * accruedFrac;
  const macaulay = tw / pv / f, modified = macaulay / (1 + y / f);
  const convexity = cx / (pv * (1 + y / f) ** 2 * f * f);
  return { dirty: pv, clean: pv - accrued, accrued, macaulay, modified, convexity, dv01: modified * pv / 10_000 };
}

/** Rendement actuariel à partir du prix pied de coupon (dichotomie robuste). */
export function yieldFromClean(b: Bond, clean: number): number {
  let lo = -0.5, hi = 2;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (bondFromYield(b, m).clean > clean) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** Rendement au premier call : l'obligation est traitée comme remboursée au prix de call à la date de call. */
export function yieldToCall(b: Bond, clean: number, callDate: string, callPrice: number): number {
  return yieldFromClean({ ...b, maturity: callDate, redemption: callPrice }, clean);
}

/** Variation de prix pour des chocs de taux : réévaluation complète et approximation duration + convexité. */
export function rateShocks(b: Bond, y: number, shocksBp = [-200, -100, -50, -25, 25, 50, 100, 200]) {
  const base = bondFromYield(b, y);
  return shocksBp.map((bp) => {
    const dy = bp / 10_000, full = bondFromYield(b, y + dy).dirty;
    const approx = base.dirty * (-base.modified * dy + 0.5 * base.convexity * dy * dy);
    return { bp, price: full - base.accrued, change: full - base.dirty, pct: (full / base.dirty - 1) * 100, approxPct: approx / base.dirty * 100 };
  });
}

export type ZeroCurve = { t: number; r: number }[]; // taux zéro-coupon continus
export function zeroRate(curve: ZeroCurve, t: number): number {
  const c = [...curve].sort((a, b) => a.t - b.t);
  if (t <= c[0].t) return c[0].r;
  if (t >= c.at(-1)!.t) return c.at(-1)!.r;
  const i = c.findIndex((p) => p.t >= t);
  const a = c[i - 1], b2 = c[i];
  return a.r + (b2.r - a.r) * (t - a.t) / (b2.t - a.t);
}

const cashflows = (b: Bond) => {
  const { dates, w } = schedule(b);
  const c = 100 * b.coupon / b.freq, red = b.redemption ?? 100;
  return dates.map((_, k) => ({ t: (w + k) / b.freq, cf: c + (k === dates.length - 1 ? red : 0) }));
};

/** Z-spread : écart constant ajouté à la courbe zéro (composition continue) qui redonne le prix plein coupon. */
export function zSpread(b: Bond, dirty: number, curve: ZeroCurve): number {
  const cfs = cashflows(b);
  const pv = (s: number) => cfs.reduce((a, x) => a + x.cf * Math.exp(-(zeroRate(curve, x.t) + s) * x.t), 0);
  let lo = -0.2, hi = 1;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (pv(m) > dirty) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * OAS d'une obligation remboursable par anticipation (call au prix `callPrice` à chaque date de coupon à partir de `callDate`).
 * Modèle de Ho-Lee en arbre binomial recombinant, calé sur la courbe zéro ; volatilité normale des taux `sigma` (ex. 0.01 = 100 pb/an).
 * Sans option (ou sigma → 0), l'OAS rejoint le Z-spread.
 */
export function oasHoLee(b: Bond, dirty: number, curve: ZeroCurve, sigma: number, callDate?: string, callPrice = 100): number {
  const cfs = cashflows(b);
  const times = [0, ...cfs.map((x) => x.t)];
  const n = cfs.length;
  const dts = times.slice(1).map((t, i) => t - times[i]);
  const dx = sigma * Math.sqrt(1 / b.freq);
  const P = (t: number) => Math.exp(-zeroRate(curve, t) * t);
  // calage des dérives a_i par prix d'Arrow-Debreu
  const a: number[] = [];
  let Q = [1];
  for (let i = 0; i < n; i++) {
    const s = Q.reduce((acc, q, j) => acc + q * Math.exp(-dx * (2 * j - i) * dts[i]), 0);
    a[i] = Math.log(s / P(times[i + 1])) / dts[i];
    const next = new Array(i + 2).fill(0);
    Q.forEach((q, j) => { const v = q * Math.exp(-(a[i] + dx * (2 * j - i)) * dts[i]) / 2; next[j] += v; next[j + 1] += v; });
    Q = next;
  }
  const callT = callDate ? (parse(callDate).getTime() - parse(b.settle).getTime()) / DAY / 365.25 : Infinity;
  const price = (s: number) => {
    let V = new Array(n + 1).fill(0); // valeur ex-coupon après le dernier flux
    for (let i = n - 1; i >= 0; i--) {
      const cf = cfs[i].cf, t = cfs[i].t, callable = t >= callT - 1e-9 && i < n - 1;
      const W = new Array(i + 1).fill(0);
      for (let j = 0; j <= i; j++) {
        let cont = (V[j] + V[j + 1]) / 2; // valeur ex-coupon au nœud suivant
        if (callable) cont = Math.min(cont, callPrice);
        W[j] = (cont + cf) * Math.exp(-(a[i] + dx * (2 * j - i) + s) * dts[i]);
      }
      V = W;
    }
    return V[0];
  };
  let lo = -0.2, hi = 1;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (price(m) > dirty) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ───────────────────────── Change ─────────────────────────
/** Terme théorique par parité des taux (intérêts simples, base 360 ou 365 selon la devise). */
export function fxForward(spot: number, rDom: number, rFor: number, days: number, baseDom = 360, baseFor = 360) {
  const fwd = spot * (1 + rDom * days / baseDom) / (1 + rFor * days / baseFor);
  return { forward: fwd, points: fwd - spot };
}
/** Facteur des points de terme : 10 000, ou 100 pour les paires cotées en yen. */
export const pipFactor = (pair: string) => (pair.toUpperCase().includes("JPY") ? 100 : 10_000);

/** FX swap : achat (ou vente) au comptant et opération inverse au terme ; résultat de portage implicite. */
export function fxSwap(notional: number, spot: number, forward: number) {
  return { nearQuote: notional * spot, farQuote: notional * forward, carry: notional * (forward - spot) };
}

// ───────────────────────── Matières premières ─────────────────────────
/** Rendement de roulement annualisé en restant long sur le contrat proche (positif en backwardation). */
export const rollYield = (near: number, far: number, daysBetween: number) => (near / far - 1) * 365 / daysBetween;
/** Prix à terme de portage : F = S·e^{(r + stockage − convenience)·T}. */
export const carryForward = (spot: number, r: number, storage: number, convenience: number, T: number) => spot * Math.exp((r + storage - convenience) * T);
/** Rendement d'opportunité (convenience yield) implicite. */
export const impliedConvenience = (spot: number, fwd: number, r: number, storage: number, T: number) => r + storage - Math.log(fwd / spot) / T;
/** Crack 3-2-1 en $/baril : 2 barils d'essence RBOB + 1 baril de diesel ULSD − 3 barils de brut (produits cotés en $/gallon). */
export const crack321 = (crude: number, rbobGal: number, hoGal: number) => (2 * rbobGal * 42 + hoGal * 42 - 3 * crude) / 3;
/** Crush du soja en $/boisseau : tourteau ($/tonne courte) × 0,022 + huile (¢/livre) × 0,11 − graines (¢/boisseau) / 100. */
export const soyCrush = (mealPerTon: number, oilCents: number, beansCents: number) => mealPerTon * 0.022 + oilCents * 0.11 - beansCents / 100;
/** Spark spread en €/MWh : électricité − gaz × taux de chaleur (MWh gaz par MWh électrique) − CO₂ × facteur d'émission. */
export const sparkSpread = (power: number, gas: number, heatRate = 2, co2 = 0, emission = 0.37) => power - gas * heatRate - co2 * emission;
/** Coût de stockage total d'une quantité sur une durée. */
export const storageCost = (qty: number, costPerUnitMonth: number, months: number, financingRate = 0, price = 0) => qty * costPerUnitMonth * months + qty * price * financingRate * months / 12;
/** Ratio de couverture à variance minimale h* = ρ·σ_spot/σ_futures et nombre de contrats. */
export function minVarHedge(spotRet: number[], futRet: number[], exposureUnits: number, contractSize: number) {
  const n = Math.min(spotRet.length, futRet.length);
  const s = spotRet.slice(-n), f = futRet.slice(-n);
  const ms = s.reduce((a, b) => a + b, 0) / n, mf = f.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vs = 0, vf = 0;
  for (let i = 0; i < n; i++) { cov += (s[i] - ms) * (f[i] - mf); vs += (s[i] - ms) ** 2; vf += (f[i] - mf) ** 2; }
  const h = cov / vf, rho = cov / Math.sqrt(vs * vf);
  return { hedgeRatio: h, correlation: rho, effectiveness: rho * rho, contracts: h * exposureUnits / contractSize };
}

// ───────────────────────── Valorisation ─────────────────────────
export const capm = (rf: number, beta: number, mrp: number) => rf + beta * mrp;
export function wacc(equity: number, debt: number, costEquity: number, costDebt: number, tax: number) {
  const v = equity + debt;
  return (equity / v) * costEquity + (debt / v) * costDebt * (1 - tax);
}
export type DcfIn = { fcf: number[]; wacc: number; terminalGrowth: number; netDebt: number; shares: number };
/** DCF : flux explicites + valeur terminale de Gordon-Shapiro, actualisés en fin d'année. */
export function dcf({ fcf, wacc: w, terminalGrowth: g, netDebt, shares }: DcfIn) {
  if (w <= g) throw new Error("Le WACC doit dépasser la croissance terminale");
  const pvFlows = fcf.reduce((a, f, i) => a + f / (1 + w) ** (i + 1), 0);
  const tv = fcf.at(-1)! * (1 + g) / (w - g);
  const pvTv = tv / (1 + w) ** fcf.length;
  const ev = pvFlows + pvTv, equity = ev - netDebt;
  return { pvFlows, terminalValue: tv, pvTerminal: pvTv, ev, equity, perShare: equity / shares, tvShare: pvTv / ev };
}
/** Projection des flux : FCF de départ et taux de croissance annuels. */
export const projectFcf = (fcf0: number, growth: number[]) => growth.reduce<number[]>((acc, g) => [...acc, (acc.at(-1) ?? fcf0) * (1 + g)], []);

/**
 * DCF inversé : croissance annuelle constante du FCF (sur `years` ans, puis croissance terminale) qui donne
 * une valeur par action égale au cours. Résolution par dichotomie (la valeur croît avec la croissance quand FCF > 0).
 * null si le FCF de départ n'est pas positif ou si aucune croissance entre −50 % et +100 % ne convient.
 */
export function impliedGrowth(target: number, p: { fcf0: number; years: number; wacc: number; terminalGrowth: number; netDebt: number; shares: number }): number | null {
  if (!(p.fcf0 > 0) || !(p.wacc > p.terminalGrowth) || !Number.isFinite(target)) return null;
  const value = (g: number) => dcf({ fcf: projectFcf(p.fcf0, Array(p.years).fill(g)), wacc: p.wacc, terminalGrowth: p.terminalGrowth, netDebt: p.netDebt, shares: p.shares }).perShare;
  let lo = -0.5, hi = 1;
  if (value(lo) > target || value(hi) < target) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (value(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function median(x: number[]): number | null {
  const v = x.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ───────────────────────── Statistiques ─────────────────────────
export const logReturns = (x: number[]) => x.slice(1).map((v, i) => Math.log(v / x[i]));
export function stdev(x: number[]) { const m = x.reduce((a, b) => a + b, 0) / x.length; return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)); }
/** Volatilité historique annualisée (écart-type des rendements logarithmiques). */
export const histVol = (closes: number[], periods = 252) => stdev(logReturns(closes)) * Math.sqrt(periods);
