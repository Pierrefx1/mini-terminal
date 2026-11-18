/** Alertes (stockées dans ce navigateur) : franchissement de prix ou mot-clé dans le fil d'actualités. Module pur, testé. */
export type Alert = {
  id: string; kind: "price" | "news"; active: boolean; created: number;
  symbol?: string; op?: ">=" | "<="; price?: number;
  keyword?: string; lastSeen?: string;
  triggeredAt?: number; triggeredValue?: string; note?: string;
};

/** Alertes de prix déclenchées par les derniers cours. */
export function checkPrice(alerts: Alert[], quotes: Record<string, number | undefined>): Alert[] {
  return alerts.filter((a) => a.active && a.kind === "price" && a.symbol && a.price != null && quotes[a.symbol] != null
    && (a.op === ">=" ? quotes[a.symbol]! >= a.price : quotes[a.symbol]! <= a.price));
}

/** Articles plus récents que le dernier vu, pour une alerte sur mot-clé. */
export function newArticles<T extends { published: string }>(a: Alert, items: T[]): T[] {
  return items.filter((i) => !a.lastSeen || i.published > a.lastSeen);
}
