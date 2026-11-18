"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AreaSeries, CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, LineSeries, PriceScaleMode } from "lightweight-charts";
import { fetcher, type Envelope } from "@/lib/api";
import { bollinger, ema, macd, rsi, sma } from "@/lib/indicators";
import { big, parisOffset, pct, price } from "@/lib/format";
import { SourceTag, State } from "./ui";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type History = { symbol: string; name: string; currency: string; exchange: string; type: string; gmtoffset: number; interval: string; candles: Candle[] };
export type ChartOpts = { type: "candles" | "line"; log: boolean; volume: boolean; sma20: boolean; sma50: boolean; sma200: boolean; ema20: boolean; boll: boolean; rsi: boolean; macd: boolean };

const COLORS = ["#ffa028", "#4aa8ff", "#c77dff", "#1fd15f", "#ff4d9a", "#e6e600"];
const INTRADAY = new Set(["1m", "5m", "15m", "30m", "60m"]);

/** Axe du temps : date de bourse en quotidien, heure de Paris en intraday. */
function toTime(c: Candle, h: History): any {
  if (INTRADAY.has(h.interval)) return c.time + parisOffset(c.time);
  return new Date((c.time + h.gmtoffset) * 1000).toISOString().slice(0, 10);
}

export default function PriceChart({ symbol, interval, range, compare, opts, onMeta }: {
  symbol: string; interval: string; range: string; compare: string[]; opts: ChartOpts; onMeta?: (h: History | undefined) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<(Candle & { chg: number | null }) | null>(null);
  const symbols = [symbol, ...compare];
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
    const line = (d: any[], color: string, pane = 0, width: 1 | 2 = 1) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      s.setData(d); return s;
    };
    let mainSeries: any;
    if (comparing || opts.type === "line") {
      mainSeries = comparing
        ? chart.addSeries(LineSeries, { color: COLORS[0], lineWidth: 2 })
        : chart.addSeries(AreaSeries, { lineColor: COLORS[0], topColor: "rgba(255,160,40,.25)", bottomColor: "rgba(255,160,40,0)", lineWidth: 2 });
      mainSeries.setData(main.candles.map((c, i) => ({ time: t[i], value: c.close })));
    } else {
      mainSeries = chart.addSeries(CandlestickSeries, { upColor: "#1fd15f", downColor: "#ff4d4d", wickUpColor: "#1fd15f", wickDownColor: "#ff4d4d", borderVisible: false });
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
        v.setData(main.candles.map((c, i) => ({ time: t[i], value: c.volume, color: c.close >= c.open ? "rgba(31,209,95,.35)" : "rgba(255,77,77,.35)" })));
      }
      if (opts.sma20) line(sma(t, closes, 20), "#4aa8ff");
      if (opts.sma50) line(sma(t, closes, 50), "#c77dff");
      if (opts.sma200) line(sma(t, closes, 200), "#e6e600");
      if (opts.ema20) line(ema(t, closes, 20), "#ff4d9a");
      if (opts.boll) { const b = bollinger(t, closes); line(b.up, "#4d5d75"); line(b.lo, "#4d5d75"); }
      let pane = 1;
      if (opts.rsi) {
        const s = line(rsi(t, closes), "#ffa028", pane);
        s.applyOptions({ lastValueVisible: true, title: "RSI 14" });
        s.createPriceLine({ price: 70, color: "#4d5d75", lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        s.createPriceLine({ price: 30, color: "#4d5d75", lineStyle: 2, lineWidth: 1, axisLabelVisible: false });
        pane++;
      }
      if (opts.macd) {
        const m = macd(t, closes);
        const hst = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        hst.setData(m.hist.map((p) => ({ ...p, color: p.value >= 0 ? "rgba(31,209,95,.5)" : "rgba(255,77,77,.5)" })));
        line(m.macd, "#4aa8ff", pane).applyOptions({ title: "MACD 12/26/9" }); line(m.signal, "#ffa028", pane);
        pane++;
      }
      const panes = chart.panes();
      for (let i = 1; i < panes.length; i++) panes[i].setHeight(110);
    }
    chart.timeScale().fitContent();
    const byTime = new Map(main.candles.map((c, i) => [String(t[i]), i]));
    chart.subscribeCrosshairMove((p) => {
      const i = p.time !== undefined ? byTime.get(String(p.time)) : undefined;
      if (i === undefined) return setHover(null);
      const c = main.candles[i]; const prev = i > 0 ? main.candles[i - 1].close : null;
      setHover({ ...c, chg: prev ? (c.close / prev - 1) * 100 : null });
    });
    return () => chart.remove();
  }, [data, opts, interval]); // eslint-disable-line

  const last = main?.candles.at(-1);
  const shown = hover ?? (last && main ? { ...last, chg: main.candles.length > 1 ? (last.close / main.candles.at(-2)!.close - 1) * 100 : null } : null);
  return (
    <div className="relative h-full w-full">
      <div ref={el} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 text-[11px]">
        {shown && (<>
          <span className="text-dim">O <span className="text-fg">{price(shown.open)}</span></span>
          <span className="text-dim">H <span className="text-fg">{price(shown.high)}</span></span>
          <span className="text-dim">B <span className="text-fg">{price(shown.low)}</span></span>
          <span className="text-dim">C <span className="text-fg">{price(shown.close)}</span></span>
          <span className={shown.chg == null ? "text-dim" : shown.chg >= 0 ? "text-up" : "text-down"}>{pct(shown.chg)}</span>
          {shown.volume > 0 && <span className="text-dim">Vol <span className="text-fg">{big(shown.volume)}</span></span>}
        </>)}
        {data && data.length > 1 && data.map((e, k) => <span key={e.data.symbol} style={{ color: COLORS[k % COLORS.length] }}>■ {e.data.symbol}</span>)}
      </div>
      <div className="absolute right-20 top-1 z-10"><SourceTag env={data?.[0]} /></div>
      <div className="absolute inset-x-0 top-8 z-10">
        <State loading={isLoading} error={error} empty={main && main.candles.length === 0 ? "Aucune donnée pour cette période." : false} />
      </div>
    </div>
  );
}
