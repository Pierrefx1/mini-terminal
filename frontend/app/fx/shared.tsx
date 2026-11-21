"use client";
import { useApi } from "@/lib/api";

export type Pair = {
  pair: string; group: string; symbol: string; last?: number; d1?: number; w1?: number; m1?: number; ytd?: number; hi52?: number; lo52?: number;
  range_pos?: number; hv1m?: number; hv3m?: number; hv1y?: number; rsi?: number; sma50?: number; sma200?: number; vs_sma200?: number;
  carry?: number | null; carry_vol?: number | null; spark?: number[]; error?: string;
};
export type Rate = { ccy: string; name: string; bank: string; g10: boolean; rate: number; date: string; last_change?: string; previous?: number | null; move?: number | null; steps: [string, number][] };
export type StrengthRow = { ccy: string; name: string; g10: boolean; d1: number | null; w1: number | null; m1: number | null; m3: number | null; y1: number | null; ytd: number | null };
export type Strength = { table: StrengthRow[]; path: { dates: string[]; series: Record<string, number[]> } | Record<string, never>; date: string | null };
export type Corr = { labels: string[]; windows: Record<string, (number | null)[][]>; ccy_labels: string[]; ccy_windows: Record<string, (number | null)[][]>; obs: number; date: string | null };
export type Driver = { name: string; kind: "price" | "yield"; corr20: number | null; corr60: number | null; corr250: number | null; beta: number | null; break: boolean; rolling: [string, number | null][]; level: [string, number][] };
export type Drivers = { pair: string; drivers: Driver[]; pair_series: [string, number][]; notes: string[] };
export type Pos = { net: number; chg: number | null; index: number | null; z: number | null; pct_oi: number | null; min: number; max: number };
export type CotHist = { date: string; lev: number; am: number; dealer: number; spec: number | null; oi: number; price: number | null; lev_idx: number | null; am_idx: number | null; lev_usd: number | null; am_usd: number | null };
export type CotMarket = {
  ccy: string; name: string; market: string; date: string; contract_size: number; pair: string; inverted: boolean; oi: number; oi_chg: number;
  lev: Pos; am: Pos; dealer: Pos; other: Pos; small: Pos; spec: Pos | null; lev_long_pct: number | null;
  traders_lev: [number, number]; traders_am: [number, number]; lev_usd: number | null; am_usd: number | null; lev_chg_usd: number | null; flip: boolean; history: CotHist[];
};
export type Cot = { markets: CotMarket[]; usd_aggregate: { date: string; lev: number; am: number }[]; lookback_weeks: number };
export type CalEvent = { id: string; title: string; country: string; time: string; impact: string; forecast: string; previous: string; actual: string; surprise: number | null };
export type Season = { pair: string; years: number; months: { month: number; avg: number | null; median: number | null; hit: number | null; n: number }[] };

export const useBoard = () => useApi<Pair[]>("/api/fx/board", 5 * 60_000);
export const useRates = () => useApi<Rate[]>("/api/fx/rates", 6 * 60 * 60_000);
export const useStrength = () => useApi<Strength>("/api/fx/strength", 5 * 60_000);
export const useCorr = () => useApi<Corr>("/api/fx/corr", 30 * 60_000);
export const useCot = () => useApi<Cot>("/api/fx/cot", 60 * 60_000);
export const useDrivers = (pair: string) => useApi<Drivers>(`/api/fx/drivers?pair=${pair}`, 15 * 60_000);

export const GROUPS = ["Majeures", "Croisées", "Scandinaves et Europe centrale", "Émergentes"] as const;
export const G10 = ["USD", "EUR", "JPY", "GBP", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK"];
export const FLAG: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", JPY: "🇯🇵", GBP: "🇬🇧", CHF: "🇨🇭", CAD: "🇨🇦", AUD: "🇦🇺", NZD: "🇳🇿", SEK: "🇸🇪", NOK: "🇳🇴", CNY: "🇨🇳", MXN: "🇲🇽",
  BRL: "🇧🇷", ZAR: "🇿🇦", TRY: "🇹🇷", INR: "🇮🇳", KRW: "🇰🇷", PLN: "🇵🇱", HKD: "🇭🇰", SGD: "🇸🇬",
};
export const COT_LABEL = { lev: "Fonds à levier", am: "Gérants d'actifs", dealer: "Courtiers (dealers)", spec: "Non commerciaux (legacy)" } as const;

/** Décimales d'affichage d'une paire. */
export function dec(pair: string): number {
  if (pair === "DXY") return 2;
  if (pair.includes("KRW")) return 2;
  if (pair.includes("JPY")) return 3;
  if (/USD(SEK|NOK|MXN|ZAR|TRY|INR|HKD|CNY|BRL)|EUR(SEK|NOK|PLN)/.test(pair)) return 4;
  return 5;
}
/** Taille du pip : 0,01 pour les paires cotées en yen, en won ou le DXY ; 0,0001 sinon. */
export const pipSize = (pair: string) => (/JPY|KRW|DXY/.test(pair) ? 0.01 : 0.0001);
export const pairLabel = (p: string) => (p === "DXY" ? "DXY" : `${p.slice(0, 3)}/${p.slice(3)}`);
export const symbolOf = (p: string) => (p === "DXY" ? "DX-Y.NYB" : `${p}=X`);

/** Barre horizontale centrée sur 0 (valeur entre -max et +max). */
export function CenterBar({ v, max, width = 80 }: { v: number | null | undefined; max: number; width?: number }) {
  if (v == null || !max) return <span className="inline-block" style={{ width }} />;
  const w = Math.min(1, Math.abs(v) / max) * 50;
  return (
    <span className="relative inline-block h-2 bg-line/40 align-middle" style={{ width }}>
      <span className="absolute top-0 h-2 w-px bg-dim" style={{ left: "50%" }} />
      <span className={`absolute top-0 h-2 ${v >= 0 ? "bg-up" : "bg-down"}`} style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
    </span>
  );
}

/** Jauge 0-100 (indice COT) : extrêmes en ambre. */
export function IndexBar({ v, width = 70 }: { v: number | null | undefined; width?: number }) {
  if (v == null) return <span className="text-dim">–</span>;
  const ext = v >= 80 || v <= 20;
  return (
    <span className="inline-flex items-center gap-1 align-middle" title={`${Math.round(v)} / 100 : position dans la fourchette des 3 dernières années`}>
      <span className="relative inline-block h-1.5 bg-line" style={{ width }}>
        <span className="absolute top-0 h-1.5 bg-line/0" />
        <span className={`absolute top-[-2px] h-2.5 w-1 ${ext ? "bg-amber" : "bg-info"}`} style={{ left: `calc(${Math.max(0, Math.min(100, v))}% - 2px)` }} />
      </span>
      <span className={`num w-6 text-right ${ext ? "text-amber" : ""}`}>{Math.round(v)}</span>
    </span>
  );
}

/** Tuile d'indicateur clé. */
export function Tile({ label, value, sub, cls = "text-fg", onClick, title }: { label: string; value: React.ReactNode; sub?: React.ReactNode; cls?: string; onClick?: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title} className={`flex min-w-0 flex-col items-start border border-line bg-panel px-2 py-1 text-left ${onClick ? "hover:border-amber" : "cursor-default"}`}>
      <span className="truncate text-[10px] uppercase tracking-wider text-dim">{label}</span>
      <span className={`num text-[15px] leading-tight ${cls}`}>{value}</span>
      {sub && <span className="num truncate text-[11px]">{sub}</span>}
    </button>
  );
}

export const heat = (v: number | null | undefined, scale = 1) => {
  if (v == null || Number.isNaN(v)) return undefined;
  const a = Math.min(1, Math.abs(v) / scale) * 0.55;
  return { background: v >= 0 ? `rgba(31,209,95,${a})` : `rgba(255,77,77,${a})` };
};

const wd = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit" });
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
export const eventDay = (iso: string) => wd.format(new Date(iso));
export const eventTime = (iso: string) => hm.format(new Date(iso));
export const IMPACT_CLS: Record<string, string> = { High: "bg-down", Medium: "bg-amber", Low: "bg-dim", Holiday: "bg-info" };
export const IMPACT_FR: Record<string, string> = { High: "Fort", Medium: "Moyen", Low: "Faible", Holiday: "Férié" };

/** Libellé d'un actif de la matrice : paire « EUR/USD » ou nom tel quel. */
export const assetLabel = (l: string) => (/^[A-Z]{6}$/.test(l) ? pairLabel(l) : l);

/** Phrase de lecture d'un bêta. */
export function betaSentence(pair: string, d: { name: string; kind: string; beta: number | null }) {
  if (d.beta == null) return "";
  const unit = d.kind === "yield" ? "+10 pb" : "+1 %";
  return `Sur un an, quand ${d.name} fait ${unit}, ${pairLabel(pair)} varie en moyenne de ${d.beta >= 0 ? "+" : ""}${d.beta.toFixed(2).replace(".", ",")} %.`;
}
