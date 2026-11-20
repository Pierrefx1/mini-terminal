/**
 * Paliers de couleur d'une carte choroplèthe, par quantiles : chaque palier regroupe à peu près autant de pays,
 * ce qui reste lisible même pour des indicateurs très asymétriques (PIB, population).
 * Valeurs de signes mixtes (croissance, solde courant) : échelle divergente, zéro comme frontière entre rouges et bleus.
 * Module pur, testé dans tests/choropleth.test.mjs.
 */
export type Piece = { min: number; max: number; color: string };

const SEQ = ["#0f2a4d", "#14457a", "#1a62a3", "#2383c6", "#3fa6de", "#7cc6ec", "#c2e5f7"];
const NEG = ["#8f1d1d", "#c0392b", "#e8735f"];
const POS = ["#14457a", "#1a62a3", "#2f8fd0", "#7cc6ec"];

/** Bornes de quantiles (valeurs distinctes, triées) découpant `xs` en au plus n groupes. */
export function quantileBreaks(xs: number[], n: number): number[] {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return [];
  const b = [s[0]];
  for (let i = 1; i < n; i++) {
    const q = s[Math.min(s.length - 1, Math.floor((i * s.length) / n))];
    if (q > b[b.length - 1]) b.push(q);
  }
  if (s[s.length - 1] > b[b.length - 1]) b.push(s[s.length - 1]);
  return b;
}

function piecesFrom(breaks: number[], colors: string[]): Piece[] {
  if (breaks.length === 1) return [{ min: breaks[0], max: breaks[0], color: colors[colors.length - 1] }];
  const n = breaks.length - 1;
  return Array.from({ length: n }, (_, i) => ({ min: breaks[i], max: breaks[i + 1], color: colors[Math.round((i * (colors.length - 1)) / Math.max(1, n - 1))] }));
}

export function pieces(values: number[]): { pieces: Piece[]; diverging: boolean } {
  const xs = values.filter((x) => Number.isFinite(x));
  if (!xs.length) return { pieces: [], diverging: false };
  const neg = xs.filter((x) => x < 0), pos = xs.filter((x) => x >= 0);
  // échelle divergente seulement si chaque côté pèse (au moins 5 % des pays)
  if (neg.length >= Math.max(2, xs.length * 0.05) && pos.length >= Math.max(2, xs.length * 0.05)) {
    const nb = quantileBreaks(neg, NEG.length), pb = quantileBreaks(pos, POS.length);
    const np = piecesFrom(nb, NEG), pp = piecesFrom(pb, POS);
    if (np.length) np[np.length - 1].max = 0; // contiguïté autour de zéro
    if (pp.length) pp[0].min = 0;
    return { pieces: [...np, ...pp], diverging: true };
  }
  return { pieces: piecesFrom(quantileBreaks(xs, SEQ.length), SEQ), diverging: false };
}

/** Couleur d'une valeur (le dernier palier inclut sa borne haute). */
export function colorOf(ps: Piece[], v: number): string | null {
  const p = ps.find((x, i) => v >= x.min && (v < x.max || (i === ps.length - 1 && v <= x.max)));
  return p?.color ?? null;
}
