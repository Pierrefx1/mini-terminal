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
