"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AreaSeries, BarSeries, CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, LineSeries, PriceScaleMode, type IChartApi } from "lightweight-charts";
import { fetcher, type Envelope } from "@/lib/api";
import { atr, bollinger, ema, levels, macd, rsi, sma, vwap } from "@/lib/indicators";
import { big, parisOffset, pct, price } from "@/lib/format";
import { SourceTag, State } from "./ui";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type History = { symbol: string; name: string; currency: string; exchange: string; type: string; gmtoffset: number; interval: string; candles: Candle[] };
export type ChartOpts = { type: "candles" | "bars" | "line"; log: boolean; volume: boolean; sma20: boolean; sma50: boolean; sma200: boolean; ema20: boolean; boll: boolean; rsi: boolean; macd: boolean; vwap?: boolean; atr?: boolean; sr?: boolean; mono?: boolean };

/** Couleur de chaque indicateur, reprise par les boutons de la barre d'outils. */
export const IND_COLORS = { sma20: "#4aa8ff", sma50: "#c77dff", sma200: "#e6e600", ema20: "#ff4d9a", boll: "#6b7d99", vwap: "#00d1c1", rsi: "#ffa028", macd: "#4aa8ff", atr: "#c77dff" } as const;

// bougies : [hausse, baisse] en couleurs ou en noir et blanc
const PALETTE = {
  color: { up: "#1fd15f", down: "#ff4d4d", upBody: "#1fd15f", downBody: "#ff4d4d", volUp: "rgba(31,209,95,.35)", volDown: "rgba(255,77,77,.35)" },
  mono: { up: "#f2f2f2", down: "#9aa3ad", upBody: "#f2f2f2", downBody: "#000000", volUp: "rgba(242,242,242,.28)", volDown: "rgba(154,163,173,.14)" },
};

const COLORS = ["#ffa028", "#4aa8ff", "#c77dff", "#1fd15f", "#ff4d9a", "#e6e600"];
const INTRADAY = new Set(["1m", "5m", "15m", "30m", "60m"]);
const MIN_BAR_PX = 3; // en deçà, les bougies deviennent illisibles : la vue par défaut ne montre que les plus récentes

/** Axe du temps : date de bourse en quotidien, heure de Paris en intraday. */
function toTime(c: Candle, h: History): any {
  if (INTRADAY.has(h.interval)) return c.time + parisOffset(c.time);
  return new Date((c.time + h.gmtoffset) * 1000).toISOString().slice(0, 10);
}

const intradayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" });
/** Horodatage lisible d'une bougie : heure de Paris en intraday, date de bourse sinon. */
function stamp(c: Candle, h: History): string {
  return INTRADAY.has(h.interval) ? intradayFmt.format(c.time * 1000) : dayFmt.format(new Date((c.time + h.gmtoffset) * 1000));
}

/** Vue par défaut : tout l'historique s'il tient à l'écran, sinon les bougies les plus récentes. */
function defaultView(chart: IChartApi, n: number, width: number) {
  const fit = Math.max(60, Math.floor(width / MIN_BAR_PX));
  if (n > fit) chart.timeScale().setVisibleLogicalRange({ from: n - fit, to: n + 2 });
  else chart.timeScale().fitContent();
}

export default function PriceChart({ symbol, interval, range, compare, opts, onMeta, resetKey = 0 }: {
  symbol: string; interval: string; range: string; compare: string[]; opts: ChartOpts; onMeta?: (h: History | undefined) => void;
  /** Incrémenté par le parent pour revenir à la vue par défaut. */
  resetKey?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Zoom courant, conservé quand le graphique est reconstruit (rafraîchissement intraday, indicateur ajouté)
  const view = useRef<{ key: string; from: number; to: number; n: number } | null>(null);
  const [hover, setHover] = useState<(Candle & { chg: number | null }) | null>(null);
  // valeurs des indicateurs affichées dans la légende (bougie survolée, sinon la dernière)
  const [vals, setVals] = useState<{ label: string; color: string; v: number | null }[]>([]);
  const symbols = [symbol, ...compare];
  const viewKey = `${symbols.join(",")}|${interval}|${range}`;
  const { data, error, isLoading } = useSWR<Envelope<History>[], Error>(
    ["hist", interval, range, ...symbols],
    () => Promise.all(symbols.map((s) => fetcher(`/api/market/history?symbol=${encodeURIComponent(s)}&interval=${interval}&range=${range}`))),
    { refreshInterval: INTRADAY.has(interval) ? 60_000 : 0, revalidateOnFocus: false, keepPreviousData: false, shouldRetryOnError: false },
  );
  const main = data?.[0]?.data;
  useEffect(() => { onMeta?.(main); }, [main]); // eslint-disable-line

  useEffect(() => {
    if (!el.current || !data || !main || main.candles.length === 0) return;
    const comparing = data.length > 1;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#08101d" }, textColor: "#7486a0", fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, panes: { separatorColor: "#1c2b42" } },
      grid: { vertLines: { color: "#0e1828" }, horzLines: { color: "#0e1828" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#1c2b42", mode: comparing ? PriceScaleMode.Percentage : opts.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { borderColor: "#1c2b42", timeVisible: INTRADAY.has(interval), secondsVisible: false },
      localization: { locale: "fr-FR" },
    });
    const t = main.candles.map((c) => toTime(c, main));
    const closes = main.candles.map((c) => c.close);
    const pal = opts.mono ? PALETTE.mono : PALETTE.color;
    const legend: { label: string; color: string; s: any }[] = [];
    const line = (d: any[], color: string, pane = 0, width: 1 | 2 = 1, label?: string) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      s.setData(d);
      if (label) legend.push({ label, color, s });
      return s;
    };
    let mainSeries: any;
    if (comparing || opts.type === "line") {
      mainSeries = comparing
        ? chart.addSeries(LineSeries, { color: COLORS[0], lineWidth: 2 })
        : opts.mono
          ? chart.addSeries(AreaSeries, { lineColor: "#f2f2f2", topColor: "rgba(242,242,242,.18)", bottomColor: "rgba(242,242,242,0)", lineWidth: 2 })
          : chart.addSeries(AreaSeries, { lineColor: COLORS[0], topColor: "rgba(255,160,40,.25)", bottomColor: "rgba(255,160,40,0)", lineWidth: 2 });
      mainSeries.setData(main.candles.map((c, i) => ({ time: t[i], value: c.close })));
    } else {
      mainSeries = opts.type === "bars"
        ? chart.addSeries(BarSeries, { upColor: pal.up, downColor: pal.down, thinBars: false })
        : chart.addSeries(CandlestickSeries, { upColor: pal.upBody, downColor: pal.downBody, wickUpColor: pal.up, wickDownColor: pal.down,
            borderVisible: !!opts.mono, borderUpColor: pal.up, borderDownColor: pal.down });
      mainSeries.setData(main.candles.map((c, i) => ({ time: t[i], open: c.open, high: c.high, low: c.low, close: c.close })));
    }
    if (comparing) {
      data.slice(1).forEach((e, k) => {
        const h = e.data;
        chart.addSeries(LineSeries, { color: COLORS[(k + 1) % COLORS.length], lineWidth: 2, title: h.symbol }).setData(h.candles.map((c) => ({ time: toTime(c, h), value: c.close })));
      });
    } else {
      if (opts.volume && main.candles.some((c) => c.volume > 0)) {
        const v = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", priceLineVisible: false, lastValueVisible: false });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
        v.setData(main.candles.map((c, i) => ({ time: t[i], value: c.volume, color: c.close >= c.open ? pal.volUp : pal.volDown })));
      }
      if (opts.sma20) line(sma(t, closes, 20), IND_COLORS.sma20, 0, 1, "MM20");
      if (opts.sma50) line(sma(t, closes, 50), IND_COLORS.sma50, 0, 1, "MM50");
      if (opts.sma200) line(sma(t, closes, 200), IND_COLORS.sma200, 0, 1, "MM200");
      if (opts.ema20) line(ema(t, closes, 20), IND_COLORS.ema20, 0, 1, "EMA20");
      if (opts.boll) { const b = bollinger(t, closes); line(b.up, IND_COLORS.boll, 0, 1, "Boll. haut"); line(b.lo, IND_COLORS.boll, 0, 1, "Boll. bas"); }
      if (opts.vwap && main.candles.some((c) => c.volume > 0)) {
        const dayKey = INTRADAY.has(interval) ? (i: number) => new Date(main.candles[i].time * 1000).toISOString().slice(0, 10) : undefined;
        line(vwap(t, main.candles, dayKey), IND_COLORS.vwap, 0, 2, "VWAP").applyOptions({ title: INTRADAY.has(interval) ? "VWAP" : "VWAP ancré" });
      }
      if (opts.sr) for (const l of levels(main.candles)) mainSeries.createPriceLine({ price: l.price, color: l.kind === "support" ? "#1fd15f" : "#ff4d4d", lineStyle: 1, lineWidth: 1, axisLabelVisible: true, title: `${l.kind === "support" ? "S" : "R"} ×${l.touches}` });
      let pane = 1;
      if (opts.rsi) {
        const s = line(rsi(t, closes), IND_COLORS.rsi, pane, 1, "RSI");
        s.applyOptions({ lastValueVisible: true, title: "RSI 14" });
        s.createPriceLine({ price: 70, color: "#4d5d75", lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        s.createPriceLine({ price: 30, color: "#4d5d75", lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        pane++;
      }
      if (opts.macd) {
        const m = macd(t, closes);
        const hst = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        hst.setData(m.hist.map((p) => ({ ...p, color: p.value >= 0 ? "rgba(31,209,95,.5)" : "rgba(255,77,77,.5)" })));
        line(m.macd, IND_COLORS.macd, pane, 1, "MACD").applyOptions({ title: "MACD 12/26/9" }); line(m.signal, "#ffa028", pane);
        pane++;
      }
      if (opts.atr) { line(atr(t, main.candles), IND_COLORS.atr, pane, 1, "ATR").applyOptions({ lastValueVisible: true, title: "ATR 14" }); pane++; }
      const panes = chart.panes();
      for (let i = 1; i < panes.length; i++) panes[i].setHeight(110);
    }
    const n = main.candles.length, prev = view.current;
    if (prev && prev.key === viewKey) {
      // collé au bord droit : on suit les nouvelles bougies ; sinon on garde exactement la fenêtre regardée
      const shift = prev.to >= prev.n - 2 ? n - prev.n : 0;
      chart.timeScale().setVisibleLogicalRange({ from: prev.from + shift, to: prev.to + shift });
    } else defaultView(chart, n, el.current.clientWidth);
    chartRef.current = chart;
    const byTime = new Map(main.candles.map((c, i) => [String(t[i]), i]));
    const lastVals = () => legend.map(({ label, color, s }) => ({ label, color, v: (s.data().at(-1) as any)?.value ?? null }));
    setVals(lastVals());
    chart.subscribeCrosshairMove((p) => {
      const i = p.time !== undefined ? byTime.get(String(p.time)) : undefined;
      if (i === undefined) { setVals(lastVals()); return setHover(null); }
      setVals(legend.map(({ label, color, s }) => ({ label, color, v: (p.seriesData.get(s) as any)?.value ?? null })));
      const c = main.candles[i]; const prev = i > 0 ? main.candles[i - 1].close : null;
      setHover({ ...c, chg: prev ? (c.close / prev - 1) * 100 : null });
    });
    return () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      if (r) view.current = { key: viewKey, from: r.from, to: r.to, n };
      chartRef.current = null;
      chart.remove();
    };
  }, [data, opts, interval]); // eslint-disable-line

  const reset = () => { if (chartRef.current && main && el.current) defaultView(chartRef.current, main.candles.length, el.current.clientWidth); };
  useEffect(() => { if (resetKey) reset(); }, [resetKey]); // eslint-disable-line

  const last = main?.candles.at(-1);
  const shown = hover ?? (last && main ? { ...last, chg: main.candles.length > 1 ? (last.close / main.candles.at(-2)!.close - 1) * 100 : null } : null);
  return (
    <div className="relative h-full w-full">
      <div ref={el} className="absolute inset-0" onDoubleClick={reset} />
      <div className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 text-[11px]">
        {shown && main && <span className={hover ? "text-amber" : "text-dim"}>{stamp(shown, main)}</span>}
        {shown && (<>
          <span className="text-dim">O <span className="text-fg">{price(shown.open)}</span></span>
          <span className="text-dim">H <span className="text-fg">{price(shown.high)}</span></span>
          <span className="text-dim">B <span className="text-fg">{price(shown.low)}</span></span>
          <span className="text-dim">C <span className="text-fg">{price(shown.close)}</span></span>
          <span className={shown.chg == null ? "text-dim" : shown.chg >= 0 ? "text-up" : "text-down"}>{pct(shown.chg)}</span>
          {shown.volume > 0 && <span className="text-dim">Vol <span className="text-fg">{big(shown.volume)}</span></span>}
        </>)}
        {vals.map((x) => <span key={x.label} style={{ color: x.color }}>{x.label} <span className="text-fg">{x.v == null ? "–" : price(x.v)}</span></span>)}
        {data && data.length > 1 && data.map((e, k) => <span key={e.data.symbol} style={{ color: COLORS[k % COLORS.length] }}>■ {e.data.symbol}</span>)}
      </div>
      <div className="absolute right-20 top-1 z-10"><SourceTag env={data?.[0]} /></div>
      <div className="absolute inset-x-0 top-8 z-10">
        <State loading={isLoading} error={error} empty={main && main.candles.length === 0 ? "Aucune donnée pour cette période." : false} />
      </div>
    </div>
  );
}
