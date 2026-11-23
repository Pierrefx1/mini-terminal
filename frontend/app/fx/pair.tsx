"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import EChart from "@/components/EChart";
import PriceChart, { type ChartOpts, type History } from "@/components/PriceChart";
import { Out, Panel, RangeBar, Seg, SourceTag, State, Toggle } from "@/components/ui";
import { useApi } from "@/lib/api";
import { atr, rsi as rsiSeries } from "@/lib/indicators";
import { num, pct, tone } from "@/lib/format";
import * as Q from "@/lib/quant";
import { Calendar } from "./overview";
import { betaSentence, COT_LABEL, dec, FLAG, IndexBar, pairLabel, pipSize, type Season, symbolOf, useBoard, useCot, useDrivers, useRates } from "./shared";

const PERIODS = { "5J": ["5d", "15m"], "1M": ["1mo", "60m"], "3M": ["3mo", "1d"], "6M": ["6mo", "1d"], "1A": ["1y", "1d"], "2A": ["2y", "1d"], "5A": ["5y", "1wk"] } as const;
type Period = keyof typeof PERIODS;
const MON = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const BASE365 = new Set(["GBP", "AUD", "NZD", "CAD"]);

export default function PairView({ pair, goCot, goDrivers }: { pair: string; goCot: (ccy: string) => void; goDrivers: () => void }) {
  const isIndex = pair === "DXY";
  const base = isIndex ? "USD" : pair.slice(0, 3), quote = isIndex ? "" : pair.slice(3);
  return (
    <div className="grid grid-cols-12 gap-1">
      <Header pair={pair} />
      <ChartPanel pair={pair} />
      <Technicals pair={pair} />
      {!isIndex && <Carry pair={pair} />}
      <Positioning ccys={isIndex ? ["USD"] : [base, quote]} goCot={goCot} />
      <DriversSummary pair={pair} more={goDrivers} />
      {!isIndex && <Seasonality pair={pair} />}
      <Calendar ccys={isIndex ? ["USD"] : [base, quote]} past title={`Publications ${isIndex ? "USD" : `${base} et ${quote}`} · ±7 jours`} className="col-span-12 md:col-span-6 xl:col-span-4" />
    </div>
  );
}

function Header({ pair }: { pair: string }) {
  const { data, env } = useBoard();
  const r = data?.find((p) => p.pair === pair);
  const d = dec(pair);
  const cell = (l: string, v: React.ReactNode, cls = "", title?: string) => (
    <div className="flex flex-col px-3 py-1" title={title}><span className="text-[10px] uppercase tracking-wider text-dim">{l}</span><span className={`num ${cls}`}>{v}</span></div>
  );
  return (
    <div className="col-span-12 flex flex-wrap items-center divide-x divide-line border border-line bg-panel">
      <div className="flex items-baseline gap-3 px-3 py-1">
        <span className="text-[18px] text-amber">{pair !== "DXY" && <>{FLAG[pair.slice(0, 3)]}{FLAG[pair.slice(3)]} </>}{pairLabel(pair)}</span>
        <span className="num text-[20px] text-fg">{num(r?.last, d)}</span>
        <span className={`num text-[14px] ${tone(r?.d1)}`}>{pct(r?.d1)}</span>
      </div>
      {cell("1 sem.", pct(r?.w1), tone(r?.w1))}{cell("1 mois", pct(r?.m1), tone(r?.m1))}{cell("YTD", pct(r?.ytd), tone(r?.ytd))}
      <div className="flex flex-col px-3 py-1"><span className="text-[10px] uppercase tracking-wider text-dim">52 sem. {num(r?.lo52, d)} – {num(r?.hi52, d)}</span><RangeBar pos={r?.range_pos} width={140} /></div>
      {cell("Vol 1M · 3M · 1A", `${num(r?.hv1m, 1)} · ${num(r?.hv3m, 1)} · ${num(r?.hv1y, 1)}`, "", "Volatilité réalisée annualisée (%)")}
      {cell("RSI 14", num(r?.rsi, 0), r?.rsi == null ? "" : r.rsi >= 70 ? "text-down" : r.rsi <= 30 ? "text-up" : "")}
      {r?.carry != null && cell("Portage", `${num(r.carry, 2)} %`, tone(r.carry), "Taux directeur base − cotée, pour une position acheteuse de la base")}
      <div className="ml-auto flex items-center gap-2 px-3 py-1 text-[11px]">
        <Link href={`/graphique?s=${encodeURIComponent(symbolOf(pair))}`} className="text-info hover:text-amber">graphique complet →</Link>
        <Link href={`/news?s=${encodeURIComponent(symbolOf(pair))}`} className="text-info hover:text-amber">actualités →</Link>
        <SourceTag env={env} />
      </div>
    </div>
  );
}

function ChartPanel({ pair }: { pair: string }) {
  const [period, setPeriod] = useState<Period>("1A");
  const [opts, setOpts] = useState<ChartOpts>({ type: "candles", log: false, volume: false, sma20: false, sma50: true, sma200: true, ema20: false, boll: false, rsi: true, macd: false, sr: false });
  const t = (k: keyof ChartOpts, label: string) => <Toggle on={!!opts[k]} onChange={(v) => setOpts({ ...opts, [k]: v })}>{label}</Toggle>;
  const [range, interval] = PERIODS[period];
  return (
    <Panel className="col-span-12 xl:col-span-8" title={`${pairLabel(pair)} · graphique`}
      right={<span className="flex flex-wrap items-center gap-1">{t("sma50", "MM50")}{t("sma200", "MM200")}{t("boll", "Bollinger")}{t("sr", "Supports")}{t("rsi", "RSI")}
        <Seg value={period} options={Object.keys(PERIODS) as Period[]} onChange={setPeriod} /></span>}>
      <div className="h-[440px]"><PriceChart key={pair + period} symbol={symbolOf(pair)} interval={interval} range={range} compare={[]} opts={opts} /></div>
    </Panel>
  );
}

/** Points pivots classiques à partir de la dernière séance complète. */
function pivots(h: number, l: number, c: number) {
  const p = (h + l + c) / 3;
  return { R3: h + 2 * (p - l), R2: p + (h - l), R1: 2 * p - l, P: p, S1: 2 * p - h, S2: p - (h - l), S3: l - 2 * (h - p) };
}

function Technicals({ pair }: { pair: string }) {
  const h = useApi<History>(`/api/market/history?symbol=${encodeURIComponent(symbolOf(pair))}&interval=1d&range=2y`, 15 * 60_000);
  const t = useMemo(() => {
    const c = h.data?.candles;
    if (!c || c.length < 30) return null;
    const closes = c.map((x) => x.close), times = c.map((x) => x.time);
    const avg = (n: number) => (closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : null);
    const last = closes.at(-1)!;
    // la dernière bougie du jour est incomplète tant que la séance n'est pas finie
    const today = new Date().toISOString().slice(0, 10);
    const lastDay = new Date(c.at(-1)!.time * 1000).toISOString().slice(0, 10);
    const ref = lastDay === today && c.length > 1 ? c.at(-2)! : c.at(-1)!;
    const atr14 = atr(times, c, 14).at(-1)?.value ?? null;
    const adr = c.slice(-21, -1).reduce((a, x) => a + (x.high - x.low), 0) / 20;
    const m = { s20: avg(20), s50: avg(50), s200: avg(200) };
    const r = rsiSeries(times, closes, 14).at(-1)?.value ?? null;
    const mom = closes.length > 63 ? (last / closes.at(-64)! - 1) * 100 : null;
    const signals: [string, boolean | null][] = [
      ["Cours au-dessus de la MM20", m.s20 == null ? null : last > m.s20],
      ["Cours au-dessus de la MM50", m.s50 == null ? null : last > m.s50],
      ["Cours au-dessus de la MM200", m.s200 == null ? null : last > m.s200],
      ["MM50 au-dessus de la MM200", m.s50 == null || m.s200 == null ? null : m.s50 > m.s200],
      ["Momentum 3 mois positif", mom == null ? null : mom > 0],
    ];
    const score = signals.filter(([, v]) => v === true).length - signals.filter(([, v]) => v === false).length;
    const hi20 = Math.max(...c.slice(-20).map((x) => x.high)), lo20 = Math.min(...c.slice(-20).map((x) => x.low));
    return { last, m, r, atr14, adr, mom, signals, score, piv: pivots(ref.high, ref.low, ref.close), hi20, lo20 };
  }, [h.data]);
  const pip = pipSize(pair), d = dec(pair);
  const verdict = !t ? "" : t.score >= 3 ? "Tendance haussière" : t.score <= -3 ? "Tendance baissière" : "Sans tendance nette";
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Analyse technique · quotidien" right={<SourceTag env={h.env} />}>
      <State loading={h.loading && !h.data} error={h.error} />
      {t && <div className="px-2 py-1">
        <div className={`mb-1 border px-2 py-1 text-center ${t.score >= 3 ? "border-up text-up" : t.score <= -3 ? "border-down text-down" : "border-line text-dim"}`}>{verdict} · score {t.score > 0 ? "+" : ""}{t.score}/5</div>
        {t.signals.map(([l, v]) => <div key={l} className="flex justify-between py-px text-[11px]"><span className="text-dim">{l}</span><span className={v == null ? "text-dim" : v ? "text-up" : "text-down"}>{v == null ? "–" : v ? "oui" : "non"}</span></div>)}
        <div className="mt-1" />
        <Out label="MM20 · MM50 · MM200" value={`${num(t.m.s20, d)} · ${num(t.m.s50, d)} · ${num(t.m.s200, d)}`} />
        <Out label="RSI 14" value={num(t.r, 1)} cls={t.r == null ? "" : t.r >= 70 ? "text-down" : t.r <= 30 ? "text-up" : ""} />
        <Out label="ATR 14 (amplitude moyenne vraie)" value={`${num(t.atr14 == null ? null : t.atr14 / pip, 0)} pips`} title="Average True Range sur 14 séances, en pips" />
        <Out label="Amplitude quotidienne moyenne 20 j" value={`${num(t.adr / pip, 0)} pips`} />
        <Out label="Plus haut · plus bas 20 séances" value={`${num(t.hi20, d)} · ${num(t.lo20, d)}`} />
        <div className="mt-2 text-[10px] uppercase tracking-wider text-amber">Points pivots (séance précédente)</div>
        <table className="text-[11px]"><tbody>
          {(["R3", "R2", "R1", "P", "S1", "S2", "S3"] as const).map((k) => {
            const v = t.piv[k];
            return <tr key={k}><td className={k.startsWith("R") ? "text-down" : k.startsWith("S") ? "text-up" : "text-amber"}>{k}</td><td className="num">{num(v, d)}</td>
              <td className="num text-dim">{num((v - t.last) / pip, 0)} pips</td></tr>;
          })}
        </tbody></table>
      </div>}
    </Panel>
  );
}

function Carry({ pair }: { pair: string }) {
  const rates = useRates(), b = useBoard();
  const base = pair.slice(0, 3), quote = pair.slice(3);
  const rb = rates.data?.find((r) => r.ccy === base), rq = rates.data?.find((r) => r.ccy === quote);
  const row = b.data?.find((p) => p.pair === pair);
  const spot = row?.last ?? NaN;
  const dBase = (c: string) => (BASE365.has(c) ? 365 : 360);
  const fw = (days: number) => Q.fxForward(spot, (rq?.rate ?? NaN) / 100, (rb?.rate ?? NaN) / 100, days, dBase(quote), dBase(base));
  const pip = pipSize(pair);
  const diffOpt = useMemo(() => {
    if (!rb || !rq) return null;
    // différentiel de taux en escalier, depuis 2021
    const dates = [...new Set([...rb.steps.map((s) => s[0]), ...rq.steps.map((s) => s[0])])].sort();
    const at = (steps: [string, number][], d: string) => { let v: number | null = null; for (const [x, y] of steps) { if (x > d) break; v = y; } return v; };
    const pts = dates.map((d) => { const a = at(rb.steps, d), c = at(rq.steps, d); return [d, a != null && c != null ? a - c : null]; });
    return {
      grid: { left: 8, right: 12, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, valueFormatter: (v: number) => `${num(v, 2)} %` },
      xAxis: { type: "time", axisLabel: { color: "#7486a0", fontSize: 10 }, axisLine: { lineStyle: { color: "#1c2b42" } } },
      yAxis: { type: "value", axisLabel: { color: "#7486a0", fontSize: 10, formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: "#0e1828" } } },
      series: [{ type: "line", step: "end", data: pts, showSymbol: false, lineStyle: { color: "#ffa028", width: 1.5 }, areaStyle: { color: "rgba(255,160,40,.12)" } }],
    };
  }, [rb, rq]);
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Taux, portage et terme" right={<SourceTag env={rates.env} />}>
      <State loading={rates.loading && !rates.data} error={rates.error} />
      {rb && rq && <div className="px-2 py-1">
        <Out label={`${FLAG[base]} ${rb.bank} (${base})`} value={`${num(rb.rate, 2)} %`} />
        <Out label={`${FLAG[quote]} ${rq.bank} (${quote})`} value={`${num(rq.rate, 2)} %`} />
        <Out label={`Différentiel ${base} − ${quote}`} value={`${num(rb.rate - rq.rate, 2)} %`} cls={tone(rb.rate - rq.rate)} />
        <Out label="Portage / volatilité 3M" value={num(row?.carry_vol, 2)} cls={tone(row?.carry_vol)} title="Rendement annuel du portage par unité de volatilité : > 0,5 attractif pour une stratégie de portage" />
        <Out label="Points de terme 1M · 3M · 1A" value={`${num(fw(30).points / pip, 1)} · ${num(fw(91).points / pip, 1)} · ${num(fw(365).points / pip, 1)}`} cls={tone(fw(91).points)} />
        <Out label="Cours à terme 3 mois" value={num(fw(91).forward, dec(pair))} cls="text-amber" />
        <div className="mt-1 text-[10px] uppercase tracking-wider text-dim">Différentiel de taux directeurs depuis 2021</div>
        <div className="h-32">{diffOpt && <EChart option={diffOpt} />}</div>
        <div className="text-[10px] text-dim">{rb.rate > rq.rate ? `Être acheteur ${base} rapporte le portage ; être vendeur le coûte.` : `Être vendeur ${base} rapporte le portage ; être acheteur le coûte.`} Taux directeurs (BRI), approximation des taux monétaires.</div>
      </div>}
    </Panel>
  );
}

function Positioning({ ccys, goCot }: { ccys: string[]; goCot: (c: string) => void }) {
  const c = useCot();
  const ms = ccys.map((x) => c.data?.markets.find((m) => m.ccy === x)).filter(Boolean) as NonNullable<typeof c.data>["markets"];
  const missing = ccys.filter((x) => !ms.some((m) => m.ccy === x));
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Positionnement CFTC" right={<SourceTag env={c.env} />}>
      <State loading={c.loading && !c.data} error={c.error} />
      {ms.map((m) => (
        <div key={m.ccy} className="border-b border-line px-2 py-1">
          <div className="flex items-center justify-between"><span className="text-amber">{FLAG[m.ccy]} {m.ccy === "USD" ? "Dollar (indice DXY)" : m.name}</span>
            <button onClick={() => goCot(m.ccy)} className="text-[11px] text-info hover:text-amber">détail COT →</button></div>
          <table className="text-[11px]"><thead><tr><th></th><th className="num">Net</th><th className="num">Δ sem.</th><th>Indice 3 ans</th></tr></thead>
            <tbody>{(["lev", "am"] as const).map((k) => <tr key={k}><td className="text-dim">{COT_LABEL[k]}</td>
              <td className={`num ${tone(m[k].net)}`}>{num(m[k].net, 0)}</td><td className={`num ${tone(m[k].chg)}`}>{num(m[k].chg, 0)}</td><td><IndexBar v={m[k].index} /></td></tr>)}</tbody></table>
          <div className="text-[10px] text-dim">{sentence(m.ccy, m.lev.net, m.lev.index)} Rapport du {m.date.slice(8)}/{m.date.slice(5, 7)}.</div>
        </div>
      ))}
      {missing.length > 0 && c.data && <div className="px-2 py-1 text-[10px] text-dim">{missing.join(", ")} : pas de contrat à terme suivi par la CFTC.</div>}
    </Panel>
  );
}

function sentence(ccy: string, net: number, idx: number | null) {
  const side = net >= 0 ? "acheteurs" : "vendeurs";
  const ext = idx == null ? "" : idx >= 90 ? ", au plus haut de 3 ans : positionnement encombré" : idx <= 10 ? ", au plus bas de 3 ans : positionnement encombré" : idx >= 80 || idx <= 20 ? ", proche d'un extrême" : "";
  return `Fonds à levier nets ${side} de ${ccy === "USD" ? "dollar" : ccy}${ext}.`;
}

function DriversSummary({ pair, more }: { pair: string; more: () => void }) {
  const c = useDrivers(pair);
  const rows = (c.data?.drivers ?? []).slice(0, 6);
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Moteurs principaux" right={<><button onClick={more} className="text-info hover:text-amber">détail →</button><SourceTag env={c.env} /></>}>
      <State loading={c.loading && !c.data} error={c.error} />
      {rows.length > 0 && <table className="text-[11px]"><thead><tr><th>Moteur</th><th>Corrélation 60 j</th><th className="num">1 an</th><th className="num">Bêta</th></tr></thead>
        <tbody>{rows.map((d) => <tr key={d.name}><td>{d.name}{d.break && <span className="ml-1 text-[9px] text-amber" title="Relation en train de changer">⚠</span>}</td>
          <td className="w-2/5"><span className="flex items-center gap-1"><span className="relative block h-2 flex-1 bg-line/40"><span className="absolute top-0 h-2 w-px bg-dim" style={{ left: "50%" }} />
            <span className={`absolute top-0 h-2 ${(d.corr60 ?? 0) >= 0 ? "bg-info" : "bg-down"}`} style={(d.corr60 ?? 0) >= 0 ? { left: "50%", width: `${Math.abs(d.corr60 ?? 0) * 50}%` } : { right: "50%", width: `${Math.abs(d.corr60 ?? 0) * 50}%` }} /></span>
            <span className="num w-10 text-right">{num(d.corr60, 2)}</span></span></td>
          <td className="num text-dim">{num(d.corr250, 2)}</td><td className="num">{num(d.beta, 2)}</td></tr>)}</tbody></table>}
      {rows[0] && <div className="px-2 py-1 text-[10px] text-dim">{betaSentence(pair, rows[0])}</div>}
    </Panel>
  );
}

function Seasonality({ pair }: { pair: string }) {
  const s = useApi<Season>(`/api/fx/seasonality?pair=${pair}`, 24 * 3600_000);
  const cur = new Date().getMonth() + 1;
  const opt = useMemo(() => s.data && ({
    grid: { left: 8, right: 12, top: 8, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 },
      formatter: (p: { dataIndex: number }[]) => { const m = s.data!.months[p[0].dataIndex]; return `${MON[m.month - 1]}<br/>Moyenne ${pct(m.avg)} · médiane ${pct(m.median)}<br/>Hausse ${num(m.hit, 0)} % des années (${m.n})`; } },
    xAxis: { type: "category", data: s.data.months.map((m) => MON[m.month - 1]), axisLabel: { color: "#7486a0", fontSize: 10 }, axisLine: { lineStyle: { color: "#1c2b42" } } },
    yAxis: { type: "value", axisLabel: { color: "#7486a0", fontSize: 10, formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: "#0e1828" } } },
    series: [{ type: "bar", data: s.data.months.map((m) => ({ value: m.avg, itemStyle: { color: (m.avg ?? 0) >= 0 ? "#1fd15f" : "#ff4d4d", opacity: m.month === cur ? 1 : 0.55, borderColor: m.month === cur ? "#ffa028" : undefined, borderWidth: m.month === cur ? 1.5 : 0 } })), barMaxWidth: 18 }],
  }), [s.data, cur]);
  const m = s.data?.months.find((x) => x.month === cur);
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title={`Saisonnalité · ${s.data?.years ?? 15} ans`} right={<SourceTag env={s.env} />}>
      <State loading={s.loading && !s.data} error={s.error} />
      {opt && <><div className="h-44"><EChart option={opt} /></div>
        <div className="px-2 py-1 text-[11px]"><span className="text-dim">{MON[cur - 1]} (mois en cours) :</span> moyenne <span className={tone(m?.avg)}>{pct(m?.avg)}</span>, hausse {num(m?.hit, 0)} % des années.</div></>}
    </Panel>
  );
}
