export type Pt = { time: any; value: number };

export function sma(t: any[], v: number[], n: number): Pt[] {
  const out: Pt[] = []; let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out.push({ time: t[i], value: s / n }); }
  return out;
}
function emaArr(v: number[], n: number): number[] {
  const k = 2 / (n + 1); const out: number[] = []; let e = 0;
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) { e += v[i]; out.push(NaN); }
    else if (i === n - 1) { e = (e + v[i]) / n; out.push(e); }
    else { e = v[i] * k + e * (1 - k); out.push(e); }
  }
  return out;
}
const pts = (t: any[], a: number[]) => a.map((x, i) => ({ time: t[i], value: x })).filter((p) => !Number.isNaN(p.value));
export const ema = (t: any[], v: number[], n: number) => pts(t, emaArr(v, n));

export function bollinger(t: any[], v: number[], n = 20, k = 2) {
  const up: Pt[] = [], lo: Pt[] = [];
  for (let i = n - 1; i < v.length; i++) {
    const w = v.slice(i - n + 1, i + 1); const m = w.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    up.push({ time: t[i], value: m + k * sd }); lo.push({ time: t[i], value: m - k * sd });
  }
  return { up, lo };
}
/** RSI de Wilder. */
export function rsi(t: any[], v: number[], n = 14): Pt[] {
  const out: Pt[] = []; let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1]; const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    if (i >= n) out.push({ time: t[i], value: l === 0 ? 100 : 100 - 100 / (1 + g / l) });
  }
  return out;
}
export function macd(t: any[], v: number[], f = 12, s = 26, sig = 9) {
  const a = emaArr(v, f), b = emaArr(v, s);
  const line = a.map((x, i) => x - b[i]);
  const start = line.findIndex((x) => !Number.isNaN(x));
  if (start < 0) return { macd: [], signal: [], hist: [] };
  const sg = emaArr(line.slice(start), sig);
  const tt = t.slice(start), ll = line.slice(start);
  return { macd: pts(tt, ll), signal: pts(tt, sg), hist: pts(tt, ll.map((x, i) => x - sg[i])) };
}

type OHLCV = { high: number; low: number; close: number; volume: number };

/** ATR de Wilder (moyenne lissée de l'étendue vraie). */
export function atr(t: any[], c: OHLCV[], n = 14): Pt[] {
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
  const out: Pt[] = [];
  let a = 0;
  tr.forEach((v, i) => {
    if (i < n) { a += v / n; if (i === n - 1) out.push({ time: t[i], value: a }); }
    else { a = (a * (n - 1) + v) / n; out.push({ time: t[i], value: a }); }
  });
  return out;
}

/** VWAP : cumul prix typique × volume / volume, remis à zéro à chaque séance (intrajournalier) ou ancré au début de la période. */
export function vwap(t: any[], c: OHLCV[], dayKey?: (i: number) => string): Pt[] {
  let pv = 0, vv = 0, key = "";
  return c.map((x, i) => {
    const k = dayKey ? dayKey(i) : "";
    if (k !== key) { pv = 0; vv = 0; key = k; }
    pv += (x.high + x.low + x.close) / 3 * x.volume; vv += x.volume;
    return { time: t[i], value: vv ? pv / vv : x.close };
  }).filter((p) => Number.isFinite(p.value));
}

/** Supports et résistances : sommets et creux locaux (fenêtre ±w) regroupés à moins de `tol` (relatif), les plus touchés d'abord. */
export function levels(c: OHLCV[], w = 5, tol = 0.01, max = 6): { price: number; kind: "support" | "résistance"; touches: number }[] {
  const piv: { p: number; k: "support" | "résistance" }[] = [];
  for (let i = w; i < c.length - w; i++) {
    const win = c.slice(i - w, i + w + 1);
    if (c[i].high === Math.max(...win.map((x) => x.high))) piv.push({ p: c[i].high, k: "résistance" });
    if (c[i].low === Math.min(...win.map((x) => x.low))) piv.push({ p: c[i].low, k: "support" });
  }
  const groups: { price: number; touches: number; kinds: string[] }[] = [];
  for (const x of piv) {
    const g = groups.find((g) => Math.abs(g.price - x.p) / g.price < tol);
    if (g) { g.price = (g.price * g.touches + x.p) / (g.touches + 1); g.touches++; g.kinds.push(x.k); } else groups.push({ price: x.p, touches: 1, kinds: [x.k] });
  }
  const last = c.at(-1)?.close ?? 0;
  return groups.filter((g) => g.touches >= 2).sort((a, b) => b.touches - a.touches).slice(0, max)
    .map((g) => ({ price: g.price, touches: g.touches, kind: g.price <= last ? "support" : "résistance" }));
}
