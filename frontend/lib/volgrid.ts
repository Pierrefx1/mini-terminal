/**
 * Grille d'affichage de la surface de volatilité, construite à partir des points de marché (une tranche par échéance).
 * Méthode desk, sans artefact de triangulation :
 * - dans chaque échéance : interpolation linéaire de l'IV en log-moneyness, UNIQUEMENT entre ses strikes cotés
 *   (aucune extrapolation : hors de la plage cotée, la cellule est vide) ;
 * - entre deux échéances : interpolation linéaire de la variance totale w = σ²T, à moneyness constante,
 *   seulement si les deux tranches couvrent ce strike.
 * Module pur, testé dans tests/volgrid.test.mjs.
 */
export type VolPoint = { expiry: string; T: number; K: number; F: number; k: number; iv: number };
export type Slice = { expiry: string; T: number; days: number; k: number[]; iv: number[] };
export type VolGrid = { m: number[]; days: number[]; z: (number | null)[][]; slices: Slice[]; atm: { days: number; iv: number | null }[] };

/** Tranches triées par maturité, points triés par k (doublons de k moyennés). */
export function slices(points: VolPoint[]): Slice[] {
  const by = new Map<string, VolPoint[]>();
  for (const p of points) if (Number.isFinite(p.iv) && Number.isFinite(p.k)) by.set(p.expiry, [...(by.get(p.expiry) ?? []), p]);
  return [...by.entries()].map(([expiry, ps]) => {
    const agg = new Map<number, number[]>();
    for (const p of ps) agg.set(p.k, [...(agg.get(p.k) ?? []), p.iv]);
    const ks = [...agg.keys()].sort((a, b) => a - b);
    return { expiry, T: ps[0].T, days: Math.round(ps[0].T * 365), k: ks, iv: ks.map((k) => agg.get(k)!.reduce((a, b) => a + b, 0) / agg.get(k)!.length) };
  }).filter((s) => s.k.length >= 2).sort((a, b) => a.T - b.T);
}

/** IV d'une tranche en k : linéaire entre deux strikes cotés ; null hors de la plage cotée. */
export function sliceIv(s: Slice, k: number): number | null {
  const { k: ks, iv } = s;
  if (k < ks[0] - 1e-12 || k > ks[ks.length - 1] + 1e-12) return null;
  let j = 1;
  while (j < ks.length - 1 && ks[j] < k) j++;
  const t = (k - ks[j - 1]) / (ks[j] - ks[j - 1] || 1);
  return iv[j - 1] + (iv[j] - iv[j - 1]) * Math.min(1, Math.max(0, t));
}

/**
 * Grille (moneyness K/F en %, jours) : nk colonnes entre mMin et mMax (en % du forward),
 * `between` lignes interpolées entre deux échéances consécutives (en plus des échéances cotées).
 */
export function volGrid(points: VolPoint[], o: { mMin?: number; mMax?: number; nk?: number; between?: number } = {}): VolGrid {
  const ss = slices(points);
  const lo = o.mMin ?? 70, hi = o.mMax ?? 130, nk = o.nk ?? 61, between = o.between ?? 3;
  const m = Array.from({ length: nk }, (_, i) => lo + (hi - lo) * i / (nk - 1));
  const ks = m.map((x) => Math.log(x / 100));
  const rows: { T: number; z: (number | null)[] }[] = [];
  ss.forEach((s, i) => {
    rows.push({ T: s.T, z: ks.map((k) => sliceIv(s, k)) });
    const n = ss[i + 1];
    if (!n) return;
    for (let b = 1; b <= between; b++) {
      const T = s.T + (n.T - s.T) * b / (between + 1);
      rows.push({ T, z: ks.map((k) => {
        const a = sliceIv(s, k), c = sliceIv(n, k);
        if (a == null || c == null) return null;
        const w = a * a * s.T + (c * c * n.T - a * a * s.T) * (T - s.T) / (n.T - s.T);
        return Math.sqrt(Math.max(w, 0) / T);
      }) });
    }
  });
  return {
    m, days: rows.map((r) => r.T * 365), z: rows.map((r) => r.z),
    slices: ss, atm: ss.map((s) => ({ days: s.days, iv: sliceIv(s, 0) })),
  };
}
