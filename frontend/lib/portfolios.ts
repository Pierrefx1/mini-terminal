"use client";
import { useLocal } from "@/lib/store";

export type Holding = { symbol: string; weight: number };
export type Portfolio = { id: string; name: string; holdings: Holding[]; benchmark: string; base: "USD" | "EUR" | "GBP" | "CHF" | "JPY"; years: number; rebalance: number; capital: number; rf: number };
export type Analysis = {
  base: string; benchmark: string; start: string; end: string; capital: number;
  series: { date: string; value: number; bench: number }[];
  performance: Record<string, number | null>;
  var: Record<string, number>; mc_hist: number[]; mc_edges: number[];
  lines: { symbol: string; name: string; currency: string; type: string; sector: string; country: string; target: number; current: number; return_pct: number; contribution_pct: number | null; vol_pct: number; risk_contribution_pct: number }[];
  sectors: { name: string; weight: number }[]; countries: { name: string; weight: number }[]; currencies: { name: string; weight: number }[];
  correlation: { symbols: string[]; matrix: number[][] };
  factors: { symbol: string; name: string; beta: number | null }[];
  factor_scenarios: { name: string; pnl_pct: number | null }[];
  historical_scenarios: { name: string; start: string; end: string; pnl_pct: number | null; bench_pct?: number; note?: string }[];
};

export const SAMPLE: Portfolio = {
  id: "exemple", name: "Exemple diversifié", benchmark: "URTH", base: "EUR", years: 3, rebalance: 0, capital: 1_000_000, rf: 0.03,
  holdings: [{ symbol: "AAPL", weight: 15 }, { symbol: "MSFT", weight: 15 }, { symbol: "MC.PA", weight: 10 }, { symbol: "ASML.AS", weight: 10 }, { symbol: "TLT", weight: 25 }, { symbol: "GLD", weight: 15 }, { symbol: "USO", weight: 10 }],
};

export function usePortfolios() {
  const [list, setList, ready] = useLocal<Portfolio[]>("mt.portfolios", [SAMPLE]);
  const [currentId, setCurrentId] = useLocal<string>("mt.portfolio.current", SAMPLE.id);
  const current = list.find((p) => p.id === currentId) ?? list[0];
  const save = (p: Portfolio) => setList((l) => (l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [...l, p]));
  const remove = (id: string) => setList((l) => l.filter((x) => x.id !== id));
  return { list, current, setCurrentId, save, remove, ready };
}

export const analysisBody = (p: Portfolio) => ({ holdings: p.holdings.filter((h) => h.symbol && h.weight > 0), benchmark: p.benchmark, base: p.base, years: p.years, rebalance: p.rebalance, rf: p.rf, capital: p.capital });
