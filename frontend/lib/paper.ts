/**
 * Moteur de paper trading : aucune transaction réelle, tout est SIMULÉ.
 * Exécution sur le cours différé de la source, avec demi-écart, glissement et impact de marché modélisés.
 * Module pur (état passé en argument, nouvel état renvoyé) : testé par tests/paper.test.mjs.
 */

export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
export type Order = {
  id: string; symbol: string; side: Side; type: OrderType; qty: number;
  limit?: number; stop?: number; createdAt: number;
  /** Ordre conditionnel : ne devient actif que lorsque `cond.symbol` franchit `cond.price` dans le sens `cond.dir`. */
  cond?: { symbol: string; dir: "above" | "below"; price: number };
  /** Ordres liés : l'exécution de l'un annule les autres (OCO, ex. prise de bénéfice + stop). */
  ocoGroup?: string;
  status: "WORKING" | "FILLED" | "CANCELLED" | "REJECTED"; triggered?: boolean; reason?: string;
};
export type Fill = { orderId: string; symbol: string; side: Side; qty: number; price: number; ref: number; slippage: number; fees: number; time: number };
export type Position = { symbol: string; qty: number; avgPrice: number; realized: number };
export type Account = { cash: number; initialCash: number; orders: Order[]; fills: Fill[]; positions: Record<string, Position> };
/** Cotation utilisée pour l'exécution : bid/ask s'ils existent, sinon écart modélisé autour du dernier cours. */
export type Quote = { last: number; bid?: number | null; ask?: number | null; adv?: number | null; vol?: number | null; time?: number };

export const newAccount = (cash = 1_000_000): Account => ({ cash, initialCash: cash, orders: [], fills: [], positions: {} });

export type CostModel = { spreadBps: number; impactCoef: number; feeBps: number; minFee: number };
export const DEFAULT_COSTS: CostModel = { spreadBps: 5, impactCoef: 0.1, feeBps: 1, minFee: 1 };

/** Écart maximal toléré entre le milieu de la fourchette et le dernier cours (fourchette d'une autre séance, source décalée). */
export const MAX_BOOK_DEVIATION = 0.005;

/** Meilleure offre et meilleure demande : réelles si fournies et cohérentes avec le dernier cours, sinon ± demi-écart modélisé. */
export function touch(q: Quote, c: CostModel = DEFAULT_COSTS) {
  const real = q.bid && q.ask && q.ask >= q.bid;
  const stale = !!real && Math.abs((q.bid! + q.ask!) / 2 / q.last - 1) > MAX_BOOK_DEVIATION;
  if (real && !stale) return { bid: q.bid!, ask: q.ask!, modelled: false, stale: false };
  const h = q.last * c.spreadBps / 20_000;
  return { bid: q.last - h, ask: q.last + h, modelled: true, stale };
}

/**
 * Impact de marché (modèle en racine carrée) : coef × volatilité quotidienne × √(quantité / volume moyen) × prix.
 * Sans volume ni volatilité connus, l'impact est nul et seul l'écart s'applique.
 */
export function impact(q: Quote, qty: number, c: CostModel = DEFAULT_COSTS) {
  if (!q.adv || !q.vol) return 0;
  return c.impactCoef * (q.vol / Math.sqrt(252)) * Math.sqrt(qty / q.adv) * q.last;
}

/** Carnet d'ordres SIMULÉ (5 niveaux) construit autour de la meilleure offre et demande. */
export function syntheticBook(q: Quote, levels = 5, c: CostModel = DEFAULT_COSTS) {
  const { bid, ask } = touch(q, c);
  const tick = Math.max((ask - bid) / 2, q.last * 1e-4);
  const base = q.adv ? Math.max(1, Math.round(q.adv / 2000)) : 100;
  return {
    bids: Array.from({ length: levels }, (_, i) => ({ price: bid - i * tick, size: Math.round(base * (1 + i * 0.6)) })),
    asks: Array.from({ length: levels }, (_, i) => ({ price: ask + i * tick, size: Math.round(base * (1 + i * 0.6)) })),
  };
}

const fee = (notional: number, c: CostModel) => Math.max(c.minFee, notional * c.feeBps / 10_000);

/** Prix d'exécution d'un ordre au marché (côté opposé + impact), ou null si non exécutable. */
export function execPrice(o: Order, q: Quote, c: CostModel = DEFAULT_COSTS): number | null {
  const { bid, ask } = touch(q, c);
  const imp = impact(q, o.qty, c);
  const mkt = o.side === "BUY" ? ask + imp : bid - imp;
  const t = o.type === "STOP_LIMIT" && o.triggered ? "LIMIT" : o.type === "STOP" && o.triggered ? "MARKET" : o.type;
  if (t === "MARKET") return mkt;
  if (t === "LIMIT" || t === "STOP_LIMIT") {
    if (o.limit == null) return null;
    return o.side === "BUY" ? (mkt <= o.limit ? mkt : null) : (mkt >= o.limit ? mkt : null);
  }
  return null; // stop non déclenché
}

function applyFill(acc: Account, o: Order, price: number, q: Quote, now: number, c: CostModel): Account {
  const notional = price * o.qty, f = fee(notional, c);
  const sign = o.side === "BUY" ? 1 : -1;
  const pos = acc.positions[o.symbol] ?? { symbol: o.symbol, qty: 0, avgPrice: 0, realized: 0 };
  let { qty, avgPrice, realized } = pos;
  const signed = sign * o.qty;
  if (qty === 0 || Math.sign(qty) === Math.sign(signed)) {
    avgPrice = (avgPrice * Math.abs(qty) + price * o.qty) / (Math.abs(qty) + o.qty);
    qty += signed;
  } else {
    const closing = Math.min(Math.abs(qty), o.qty);
    realized += closing * (price - avgPrice) * Math.sign(qty);
    qty += signed;
    if (Math.abs(signed) > closing) avgPrice = price; // retournement de position
    if (qty === 0) avgPrice = 0;
  }
  realized -= f;
  const fill: Fill = { orderId: o.id, symbol: o.symbol, side: o.side, qty: o.qty, price, ref: q.last, slippage: (price - q.last) * sign, fees: f, time: now };
  let orders = acc.orders.map((x) => (x.id === o.id ? { ...x, status: "FILLED" as const } : x));
  if (o.ocoGroup) orders = orders.map((x) => (x.ocoGroup === o.ocoGroup && x.id !== o.id && x.status === "WORKING" ? { ...x, status: "CANCELLED" as const, reason: "OCO : ordre lié exécuté" } : x));
  return { ...acc, cash: acc.cash - sign * notional - f, orders, fills: [fill, ...acc.fills], positions: { ...acc.positions, [o.symbol]: { symbol: o.symbol, qty, avgPrice, realized } } };
}

/** Soumet un ordre : contrôle de validité, puis tentative d'exécution immédiate. */
export function submit(acc: Account, o: Omit<Order, "status" | "createdAt">, quotes: Record<string, Quote>, now = Date.now(), c: CostModel = DEFAULT_COSTS): Account {
  const order: Order = { ...o, status: "WORKING", createdAt: now };
  const bad = !(o.qty > 0) ? "Quantité invalide"
    : (o.type === "LIMIT" || o.type === "STOP_LIMIT") && !(o.limit! > 0) ? "Prix limite requis"
      : (o.type === "STOP" || o.type === "STOP_LIMIT") && !(o.stop! > 0) ? "Prix de déclenchement requis" : null;
  if (bad) return { ...acc, orders: [{ ...order, status: "REJECTED", reason: bad }, ...acc.orders] };
  return evaluate({ ...acc, orders: [order, ...acc.orders] }, quotes, now, c);
}

/** Réévalue les ordres en attente sur les dernières cotations (déclenchement des stops, conditions, limites). */
export function evaluate(acc: Account, quotes: Record<string, Quote>, now = Date.now(), c: CostModel = DEFAULT_COSTS): Account {
  let a = acc;
  for (const o0 of acc.orders) {
    const o = a.orders.find((x) => x.id === o0.id)!;
    if (o.status !== "WORKING") continue;
    const q = quotes[o.symbol];
    if (!q) continue;
    if (o.cond) {
      const cq = quotes[o.cond.symbol];
      if (!cq || !(o.cond.dir === "above" ? cq.last >= o.cond.price : cq.last <= o.cond.price)) continue;
    }
    let cur = o;
    if ((o.type === "STOP" || o.type === "STOP_LIMIT") && !o.triggered) {
      const hit = o.side === "BUY" ? q.last >= o.stop! : q.last <= o.stop!;
      if (!hit) continue;
      cur = { ...o, triggered: true };
      a = { ...a, orders: a.orders.map((x) => (x.id === o.id ? cur : x)) };
    }
    const px = execPrice(cur, q, c);
    if (px != null) a = applyFill(a, cur, px, q, now, c);
  }
  return a;
}

export const cancel = (acc: Account, id: string): Account => ({ ...acc, orders: acc.orders.map((o) => (o.id === id && o.status === "WORKING" ? { ...o, status: "CANCELLED", reason: "annulé" } : o)) });

/** Valorisation : P&L latent au dernier cours, réalisé, exposition brute et nette. */
export function valuation(acc: Account, quotes: Record<string, Quote>) {
  const rows = Object.values(acc.positions).filter((p) => p.qty !== 0 || p.realized !== 0).map((p) => {
    const last = quotes[p.symbol]?.last ?? null;
    const mv = last == null ? null : p.qty * last;
    return { ...p, last, marketValue: mv, unrealized: last == null || p.qty === 0 ? 0 : (last - p.avgPrice) * p.qty };
  });
  const mv = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0);
  const gross = rows.reduce((s, r) => s + Math.abs(r.marketValue ?? 0), 0);
  const equity = acc.cash + mv;
  return {
    rows, equity, cash: acc.cash, net: mv, gross, leverage: equity ? gross / equity : 0,
    unrealized: rows.reduce((s, r) => s + r.unrealized, 0), realized: rows.reduce((s, r) => s + r.realized, 0),
    pnl: equity - acc.initialCash,
  };
}
