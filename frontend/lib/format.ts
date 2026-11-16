const nf = (d: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function num(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return nf(d).format(v);
}
export function price(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const a = Math.abs(v);
  return num(v, a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 3 : 4);
}
export function pct(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const r = Math.round(v * 10 ** d) / 10 ** d || 0; // évite « -0,00 »
  return (r > 0 ? "+" : "") + nf(d).format(r) + " %";
}
export function big(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const a = Math.abs(v);
  if (a >= 1e12) return num(v / 1e12, 2) + " T";
  if (a >= 1e9) return num(v / 1e9, 1) + " Md";
  if (a >= 1e6) return num(v / 1e6, 1) + " M";
  if (a >= 1e4) return num(v / 1e3, 0) + " k";
  return num(v, 0);
}
export const tone = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.005 ? "text-dim" : v > 0 ? "text-up" : "text-down");

const dtf = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const df = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
export const dateTime = (iso: string | number | Date) => dtf.format(new Date(iso));
export const dateOnly = (iso: string | number | Date) => df.format(new Date(iso));

/** Décalage (secondes) du fuseau Europe/Paris par rapport à UTC à l'instant donné. */
export function parisOffset(tsSec: number): number {
  const d = new Date(tsSec * 1000);
  const p = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const u = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((p.getTime() - u.getTime()) / 1000);
}
