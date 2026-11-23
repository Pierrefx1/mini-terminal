"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import SymbolInput from "@/components/SymbolInput";
import PriceChart, { IND_COLORS, type ChartOpts, type History } from "@/components/PriceChart";
import { Panel, Seg, SourceTag, State, Toggle } from "@/components/ui";
import { send, useApi } from "@/lib/api";
import { pct, price, tone } from "@/lib/format";

// période -> plage demandée à la source et unité de temps proposée par défaut
const PERIODS: Record<string, { range: string; interval: string }> = {
  "1J": { range: "1d", interval: "5m" }, "5J": { range: "5d", interval: "15m" }, "1M": { range: "1mo", interval: "60m" },
  "2M": { range: "60d", interval: "60m" }, "6M": { range: "6mo", interval: "1d" }, YTD: { range: "ytd", interval: "1d" },
  "1A": { range: "1y", interval: "1d" }, "2A": { range: "2y", interval: "1d" }, "5A": { range: "5y", interval: "1wk" }, MAX: { range: "max", interval: "1mo" },
};
// périodes servies par Yahoo pour chaque unité de temps (1 min : 7 jours ; 5 à 30 min : 60 jours ; 1 h : 2 ans)
const INTRA = ["1J", "5J", "1M", "2M"];
const ALLOWED: Record<string, string[]> = {
  "1m": ["1J", "5J"], "5m": INTRA, "15m": INTRA, "30m": INTRA, "60m": ["5J", "1M", "2M", "6M", "YTD", "1A", "2A"],
  "1d": ["1M", "2M", "6M", "YTD", "1A", "2A", "5A", "MAX"], "1wk": ["6M", "YTD", "1A", "2A", "5A", "MAX"], "1mo": ["1A", "2A", "5A", "MAX"],
};
const INTERVALS = [["1m", "1 min"], ["5m", "5 min"], ["15m", "15 min"], ["30m", "30 min"], ["60m", "1 h"], ["1d", "Jour"], ["1wk", "Sem."], ["1mo", "Mois"]] as [string, string][];
const INTERVAL_LABEL: Record<string, string> = { "1m": "1 min", "5m": "5 min", "15m": "15 min", "30m": "30 min", "60m": "1 heure", "1d": "jour", "1wk": "semaine", "1mo": "mois" };
const DEFAULT_OPTS: ChartOpts = { type: "candles", log: false, volume: true, sma20: false, sma50: true, sma200: true, ema20: false, boll: false, rsi: false, macd: false, vwap: false, atr: false, sr: false, mono: true };
const PREFS = "gp:prefs";
type Quote = { symbol: string; name?: string; price?: number; change_pct?: number; error?: string };

// libellé, info-bulle et couleur de chaque indicateur
const IND: Record<string, [string, string]> = {
  sma20: ["MM20", "Moyenne mobile simple sur 20 bougies"], sma50: ["MM50", "Moyenne mobile simple sur 50 bougies"],
  sma200: ["MM200", "Moyenne mobile simple sur 200 bougies"], ema20: ["EMA20", "Moyenne mobile exponentielle sur 20 bougies"],
  boll: ["Bollinger", "Bandes de Bollinger : MM20 ± 2 écarts-types"], vwap: ["VWAP", "Prix moyen pondéré par les volumes (remis à zéro chaque séance en intraday)"],
  rsi: ["RSI", "Relative Strength Index 14 : > 70 suracheté, < 30 survendu (panneau sous le graphique)"],
  macd: ["MACD", "MACD 12/26/9 : croisement de moyennes exponentielles (panneau sous le graphique)"],
  atr: ["ATR", "Average True Range 14 : amplitude moyenne des bougies (panneau sous le graphique)"],
};

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1"><span className="text-[10px] uppercase tracking-wider text-dim">{label}</span>{children}</span>;
}

export default function Graphique() {
  const router = useRouter();
  const symbol = useSearchParams().get("s") || "^GSPC";
  const [ready, setReady] = useState(false);
  const [period, setPeriod] = useState("1A");
  const [interval, setIntervalV] = useState("1d");
  const [opts, setOpts] = useState<ChartOpts>(DEFAULT_OPTS);
  const [compare, setCompare] = useState<string[]>([]);
  const [cmpInput, setCmpInput] = useState("");
  const [symInput, setSymInput] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [tools, setTools] = useState(false); // panneau de réglages replié par défaut
  const [meta, setMeta] = useState<History>();
  const set = (k: keyof ChartOpts) => (v: boolean) => setOpts((o) => ({ ...o, [k]: v }));
  const wl = useApi<Quote[]>("/api/market/watchlist", 60_000);
  const q = useApi<Quote[]>(`/api/market/quotes?symbols=${encodeURIComponent(symbol)}`, 60_000);
  const quote = q.data?.[0];
  const inWl = wl.data?.some((x) => x.symbol === symbol.toUpperCase());

  // réglages mémorisés dans ce navigateur (unité, période, indicateurs)
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) || "null");
      if (p && ALLOWED[p.interval]?.includes(p.period)) { setPeriod(p.period); setIntervalV(p.interval); }
      if (p?.opts) setOpts({ ...DEFAULT_OPTS, ...p.opts });
      if (typeof p?.tools === "boolean") setTools(p.tools);
    } catch { /* stockage indisponible : réglages par défaut */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(PREFS, JSON.stringify({ period, interval, opts, tools })); } catch { /* ignoré */ }
  }, [ready, period, interval, opts, tools]);

  // changer de période garde l'unité de temps si la source la sert sur cette période
  const pickPeriod = (p: string) => { setPeriod(p); if (!ALLOWED[interval].includes(p)) setIntervalV(PERIODS[p].interval); };
  const pickInterval = (i: string) => { setIntervalV(i); if (!ALLOWED[i].includes(period)) setPeriod(ALLOWED[i].at(-1)!); };
  const toggleWl = async () => { await send(inWl ? "DELETE" : "PUT", `/api/market/watchlist/${encodeURIComponent(symbol)}`); wl.reload(); };
  const openSymbol = (raw: string) => { const s = raw.trim().toUpperCase(); if (s) router.push(`/graphique?s=${encodeURIComponent(s)}`); setSymInput(""); };
  const addCompare = (raw: string) => {
    const s = raw.trim().toUpperCase();
    if (s && s !== symbol.toUpperCase() && !compare.includes(s) && compare.length < 5) setCompare([...compare, s]);
    setCmpInput("");
  };
  const comparing = compare.length > 0;
  const nActive = (["sma20", "sma50", "sma200", "ema20", "boll", "vwap", "rsi", "macd", "atr", "sr"] as const).filter((k) => opts[k]).length;
  const ind = (k: keyof typeof IND_COLORS) => {
    const on = !!opts[k];
    return (
      <button key={k} onClick={() => set(k)(!on)} title={IND[k][1]}
        className={`flex items-center gap-1 border px-2 py-0.5 ${on ? "border-amber text-fg" : "border-line text-dim hover:text-fg"}`}>
        <span className="inline-block h-0.5 w-3" style={{ background: IND_COLORS[k], opacity: on ? 1 : 0.5 }} />{IND[k][0]}
      </button>
    );
  };

  return (
    <div className="flex h-full gap-1">
      <Panel title="Watchlist" right={wl.env?.stale ? <SourceTag env={wl.env} /> : undefined} className="w-48 shrink-0">
        <State loading={wl.loading} error={wl.error} empty={wl.data?.length === 0 && "Vide : « + Watchlist » ajoute le symbole affiché."} />
        <table className="text-[11px]"><tbody>
          {(wl.data ?? []).map((w) => (
            <tr key={w.symbol} className={`cursor-pointer ${w.symbol === symbol.toUpperCase() ? "bg-raised" : ""}`} onClick={() => router.push(`/graphique?s=${encodeURIComponent(w.symbol)}`)}>
              <td className={`max-w-[60px] truncate ${w.symbol === symbol.toUpperCase() ? "text-amber" : ""}`} title={`${w.name ?? w.symbol}${w.error ? "" : ` · ${price(w.price)}`}`}>{w.symbol}</td>
              {w.error ? <td colSpan={2} className="num text-down" title={w.error}>erreur</td> : <>
                <td className="num px-1">{price(w.price)}</td>
                <td className={`num ${tone(w.change_pct)}`}>{pct(w.change_pct, 1)}</td>
              </>}
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
          <span className="ml-3 text-dim">· bougies {INTERVAL_LABEL[interval]} · {period}</span>
        </span>}
        right={<button onClick={toggleWl} className="border border-line px-2 text-fg hover:border-amber">{inWl ? "− Watchlist" : "+ Watchlist"}</button>}>
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 py-1">
            <Group label="Unité"><Seg value={interval} options={INTERVALS} onChange={pickInterval} /></Group>
            <Group label="Période"><Seg value={period} options={ALLOWED[interval]} onChange={pickPeriod} /></Group>
            <button onClick={() => setResetKey((k) => k + 1)} className="border border-line px-2 py-0.5 text-dim hover:text-fg" title="Revenir à la vue par défaut (ou double-clic sur le graphique)">⟲ Vue</button>
            <button onClick={() => setTools((v) => !v)} aria-expanded={tools}
              className={`ml-auto border px-2 py-0.5 ${tools ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}
              title={tools ? "Masquer les réglages" : "Afficher symbole, style, indicateurs et comparaison"}>
              {tools ? "▴" : "▾"} Réglages{nActive ? ` · ${nActive} indicateur${nActive > 1 ? "s" : ""}` : ""}{comparing ? ` · ${compare.length} comparé${compare.length > 1 ? "s" : ""}` : ""}
            </button>
          </div>
          {tools && (<>
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 py-1">
              <form onSubmit={(e) => { e.preventDefault(); openSymbol(symInput); }}>
                <SymbolInput value={symInput} onChange={setSymInput} onPick={openSymbol} placeholder="Symbole ou nom… ↵" className="w-36"
                  title="Symbole Yahoo (AAPL, ^FCHI, EURUSD=X…) ou nom de société : choisis une suggestion" ariaLabel="Ouvrir un symbole" />
              </form>
              <Group label="Style">
                <Seg value={opts.type} options={[["candles", "Bougies"], ["bars", "Barres"], ["line", "Ligne"]]} onChange={(v) => setOpts((o) => ({ ...o, type: v as ChartOpts["type"] }))} />
                <Seg value={opts.mono ? "mono" : "color"} options={[["mono", "N&B"], ["color", "Couleur"]]} onChange={(v) => setOpts((o) => ({ ...o, mono: v === "mono" }))} />
              </Group>
              <span className="flex items-center gap-1">
                <span title="Échelle logarithmique : des variations en % de même taille"><Toggle on={opts.log} onChange={set("log")}>Log</Toggle></span>
                <span title="Volumes échangés en bas du graphique"><Toggle on={opts.volume} onChange={set("volume")}>Volume</Toggle></span>
              </span>
              <span className="flex items-center gap-1">
                <form onSubmit={(e) => { e.preventDefault(); addCompare(cmpInput); }}>
                  <SymbolInput value={cmpInput} onChange={setCmpInput} onPick={addCompare} placeholder="Comparer à… ↵" className="w-32"
                    title="Ajoute jusqu'à 5 symboles, affichés en % de variation" ariaLabel="Ajouter un symbole à comparer" />
                </form>
                {compare.map((c) => <button key={c} onClick={() => setCompare(compare.filter((x) => x !== c))} className="border border-line px-1 text-info hover:text-down" title="Retirer">{c} ×</button>)}
              </span>
            </div>
            <div className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 py-1 ${comparing ? "opacity-40" : ""}`}
              title={comparing ? "Indicateurs masqués pendant une comparaison" : undefined}>
              <Group label="Tendance">{(["sma20", "sma50", "sma200", "ema20", "boll", "vwap"] as const).map(ind)}</Group>
              <Group label="Oscillateurs">{(["rsi", "macd", "atr"] as const).map(ind)}</Group>
              <Group label="Niveaux"><span title="Supports (S) et résistances (R) touchés plusieurs fois"><Toggle on={!!opts.sr} onChange={set("sr")}>Supports/rés.</Toggle></span></Group>
            </div>
          </>)}
          <div className="min-h-0 flex-1">
            {ready && <PriceChart key={symbol} symbol={symbol} interval={interval} range={PERIODS[period].range} compare={compare} opts={opts} onMeta={setMeta} resetKey={resetKey} />}
          </div>
          <div className="shrink-0 border-t border-line px-2 py-0.5 text-[10px] text-dim">
            Molette : zoom · glisser : déplacer · double-clic : vue par défaut · heures de Paris en intraday · rafraîchi chaque minute en intraday
          </div>
        </div>
      </Panel>
    </div>
  );
}
