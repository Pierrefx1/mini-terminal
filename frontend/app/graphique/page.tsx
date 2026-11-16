"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import PriceChart, { type ChartOpts, type History } from "@/components/PriceChart";
import { Panel, Seg, SourceTag, State, Toggle } from "@/components/ui";
import { send, useApi } from "@/lib/api";
import { pct, price, tone } from "@/lib/format";

const PERIODS: Record<string, { range: string; interval: string }> = {
  "1J": { range: "1d", interval: "5m" }, "5J": { range: "5d", interval: "15m" }, "1M": { range: "1mo", interval: "60m" },
  "6M": { range: "6mo", interval: "1d" }, YTD: { range: "ytd", interval: "1d" }, "1A": { range: "1y", interval: "1d" },
  "5A": { range: "5y", interval: "1wk" }, MAX: { range: "max", interval: "1mo" },
};
// périodes servies par la source pour chaque unité de temps
const ALLOWED: Record<string, string[]> = {
  "1m": ["1J", "5J"], "5m": ["1J", "5J", "1M"], "15m": ["1J", "5J", "1M"], "60m": ["5J", "1M", "6M", "YTD", "1A"],
  "1d": ["1M", "6M", "YTD", "1A", "5A", "MAX"], "1wk": ["6M", "YTD", "1A", "5A", "MAX"], "1mo": ["1A", "5A", "MAX"],
};
const INTERVALS = [["1m", "1 min"], ["5m", "5 min"], ["15m", "15 min"], ["60m", "1 h"], ["1d", "Jour"], ["1wk", "Sem."], ["1mo", "Mois"]] as [string, string][];
type Quote = { symbol: string; name?: string; price?: number; change_pct?: number; error?: string };

export default function Graphique() {
  const router = useRouter();
  const symbol = useSearchParams().get("s") || "^GSPC";
  const [period, setPeriod] = useState("1A");
  const [interval, setIntervalV] = useState("1d");
  const [compare, setCompare] = useState<string[]>([]);
  const [cmpInput, setCmpInput] = useState("");
  const [meta, setMeta] = useState<History>();
  const [opts, setOpts] = useState<ChartOpts>({ type: "candles", log: false, volume: true, sma20: false, sma50: true, sma200: true, ema20: false, boll: false, rsi: false, macd: false });
  const set = (k: keyof ChartOpts) => (v: boolean) => setOpts((o) => ({ ...o, [k]: v }));
  const wl = useApi<Quote[]>("/api/market/watchlist", 60_000);
  const q = useApi<Quote[]>(`/api/market/quotes?symbols=${encodeURIComponent(symbol)}`, 60_000);
  const quote = q.data?.[0];
  const inWl = wl.data?.some((x) => x.symbol === symbol.toUpperCase());

  const pickPeriod = (p: string) => { setPeriod(p); setIntervalV(PERIODS[p].interval); };
  const pickInterval = (i: string) => { setIntervalV(i); if (!ALLOWED[i].includes(period)) setPeriod(ALLOWED[i].at(-1)!); };
  const toggleWl = async () => { await send(inWl ? "DELETE" : "PUT", `/api/market/watchlist/${encodeURIComponent(symbol)}`); wl.reload(); };

  return (
    <div className="flex h-full gap-1">
      <Panel title="Watchlist" right={<SourceTag env={wl.env} />} className="w-64 shrink-0">
        <State loading={wl.loading} error={wl.error} empty={wl.data?.length === 0 && "Vide. Ouvre un symbole (⌘K) puis « + Watchlist »."} />
        <table><tbody>
          {(wl.data ?? []).map((w) => (
            <tr key={w.symbol} className="cursor-pointer" onClick={() => router.push(`/graphique?s=${encodeURIComponent(w.symbol)}`)}>
              <td className={w.symbol === symbol.toUpperCase() ? "text-amber" : ""} title={w.name}>{w.symbol}</td>
              <td className="num">{w.error ? <span className="text-down" title={w.error}>erreur</span> : price(w.price)}</td>
              <td className={`num ${tone(w.change_pct)}`}>{pct(w.change_pct)}</td>
            </tr>
          ))}
        </tbody></table>
      </Panel>
      <Panel className="flex-1"
        title={<span className="normal-case tracking-normal">
          <span className="font-bold">{meta?.symbol ?? symbol}</span>
          <span className="ml-2 text-fg">{meta?.name}</span>
          <span className="ml-2 text-dim">{meta ? `${meta.exchange} · ${meta.currency}` : ""}</span>
          {quote && !quote.error && <><span className="ml-3 text-fg">{price(quote.price)}</span><span className={`ml-2 ${tone(quote.change_pct)}`}>{pct(quote.change_pct)}</span></>}
        </span>}
        right={<button onClick={toggleWl} className="border border-line px-2 text-fg hover:border-amber">{inWl ? "− Watchlist" : "+ Watchlist"}</button>}>
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1">
            <Seg value={period} options={Object.keys(PERIODS)} onChange={pickPeriod} />
            <Seg value={interval} options={INTERVALS} onChange={pickInterval} />
            <Seg value={opts.type} options={[["candles", "Bougies"], ["line", "Ligne"]]} onChange={(v) => setOpts((o) => ({ ...o, type: v as ChartOpts["type"] }))} />
            <Toggle on={opts.log} onChange={set("log")}>Log</Toggle>
            <Toggle on={opts.volume} onChange={set("volume")}>Vol</Toggle>
            <span className="text-dim">|</span>
            <Toggle on={opts.sma20} onChange={set("sma20")}>MM20</Toggle>
            <Toggle on={opts.sma50} onChange={set("sma50")}>MM50</Toggle>
            <Toggle on={opts.sma200} onChange={set("sma200")}>MM200</Toggle>
            <Toggle on={opts.ema20} onChange={set("ema20")}>EMA20</Toggle>
            <Toggle on={opts.boll} onChange={set("boll")}>Bollinger</Toggle>
            <Toggle on={opts.rsi} onChange={set("rsi")}>RSI</Toggle>
            <Toggle on={opts.macd} onChange={set("macd")}>MACD</Toggle>
            <span className="text-dim">|</span>
            <form onSubmit={(e) => { e.preventDefault(); const s = cmpInput.trim().toUpperCase(); if (s && !compare.includes(s) && compare.length < 5) setCompare([...compare, s]); setCmpInput(""); }}>
              <input value={cmpInput} onChange={(e) => setCmpInput(e.target.value)} placeholder="Comparer (symbole)" className="w-40" />
            </form>
            {compare.map((c) => <button key={c} onClick={() => setCompare(compare.filter((x) => x !== c))} className="border border-line px-1 text-info hover:text-down" title="Retirer">{c} ×</button>)}
          </div>
          <div className="min-h-0 flex-1">
            <PriceChart key={symbol} symbol={symbol} interval={interval} range={PERIODS[period].range} compare={compare} opts={opts} onMeta={setMeta} />
          </div>
        </div>
      </Panel>
    </div>
  );
}
