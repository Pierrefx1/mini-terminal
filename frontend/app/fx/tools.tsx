"use client";
import { useEffect, useMemo, useState } from "react";
import EChart from "@/components/EChart";
import { Num, Out, Panel, Seg, SourceTag } from "@/components/ui";
import { num, pct, price, tone } from "@/lib/format";
import * as Q from "@/lib/quant";
import { dec, pairLabel, pipSize, useBoard, useRates } from "./shared";

const TENORS: [string, number][] = [["1S", 7], ["1M", 30], ["2M", 61], ["3M", 91], ["6M", 182], ["9M", 273], ["1A", 365], ["2A", 730]];
const BASE365 = new Set(["GBP", "AUD", "NZD", "CAD"]); // conventions monétaires en base 365
const CCYS = ["EUR", "USD", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "SEK", "NOK", "CNY", "MXN", "BRL", "ZAR", "TRY", "INR", "KRW", "SGD", "HKD"];

export default function Tools({ pair: p0 }: { pair: string }) {
  const pair = p0 === "DXY" ? "EURUSD" : p0;
  const board = useBoard(), rates = useRates();
  const base = pair.slice(0, 3), quote = pair.slice(3, 6);
  const r = Object.fromEntries((rates.data ?? []).map((x) => [x.ccy, x.rate]));
  const row = board.data?.find((p) => p.pair === pair);
  const [spotIn, setSpotIn] = useState(NaN), [rq, setRq] = useState(NaN), [rb, setRb] = useState(NaN), [days, setDays] = useState(91);
  const [K, setK] = useState(NaN), [vol, setVol] = useState(NaN), [type, setType] = useState<"call" | "put">("call"), [notional, setNotional] = useState(1_000_000);
  useEffect(() => { setSpotIn(NaN); setRq(NaN); setRb(NaN); setK(NaN); setVol(NaN); }, [pair]);
  const spot = Number.isNaN(spotIn) ? row?.last ?? NaN : spotIn;
  const rDom = Number.isNaN(rq) ? r[quote] ?? NaN : rq, rFor = Number.isNaN(rb) ? r[base] ?? NaN : rb;
  const pip = pipSize(pair), d = dec(pair);
  const dBase = (c: string) => (BASE365.has(c) ? 365 : 360);
  const fw = Q.fxForward(spot, rDom / 100, rFor / 100, days, dBase(quote), dBase(base));
  // option de change (Garman-Kohlhagen)
  const sigma = Number.isNaN(vol) ? Math.round((row?.hv3m ?? 8) * 100) / 100 : vol;
  const strike = Number.isNaN(K) ? Number(fw.forward.toFixed(d)) : K;
  const gk = Q.blackScholes({ S: spot, K: strike, T: days / 365, r: Math.log(1 + rDom / 100), q: Math.log(1 + rFor / 100), sigma: sigma / 100, type });
  // profil de gain de l'option : à l'échéance et aujourd'hui, en devise cotée pour le nominal
  const payoff = useMemo(() => {
    if (!Number.isFinite(spot) || !Number.isFinite(gk.price)) return null;
    const sd = (sigma / 100) * Math.sqrt(days / 365), xs = Array.from({ length: 81 }, (_, i) => spot * Math.exp(-3 * sd + (6 * sd * i) / 80));
    const now = (S: number) => Q.blackScholes({ S, K: strike, T: days / 365, r: Math.log(1 + rDom / 100), q: Math.log(1 + rFor / 100), sigma: sigma / 100, type }).price;
    const exp = (S: number) => Math.max(type === "call" ? S - strike : strike - S, 0);
    return {
      grid: { left: 8, right: 12, top: 24, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: "#d4dbe6", fontSize: 10 }, itemWidth: 12, itemHeight: 2, icon: "rect" },
      tooltip: { trigger: "axis", backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, valueFormatter: (v: number) => `${num(v, 0)} ${quote}` },
      xAxis: { type: "value", min: xs[0], max: xs.at(-1), axisLabel: { color: "#7486a0", fontSize: 10, formatter: (v: number) => num(v, d - 1) }, splitLine: { show: false }, axisLine: { lineStyle: { color: "#1c2b42" } } },
      yAxis: { type: "value", axisLabel: { color: "#7486a0", fontSize: 10, formatter: (v: number) => `${num(v / 1000, 0)}k` }, splitLine: { lineStyle: { color: "#0e1828" } } },
      series: [
        { name: "À l'échéance", type: "line", showSymbol: false, data: xs.map((x) => [x, (exp(x) - gk.price) * notional]), lineStyle: { color: "#ffa028", width: 1.6 }, itemStyle: { color: "#ffa028" },
          markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#4d5d75", type: "dashed" }, data: [{ yAxis: 0 }, { xAxis: spot }] } },
        { name: "Aujourd'hui", type: "line", showSymbol: false, data: xs.map((x) => [x, (now(x) - gk.price) * notional]), lineStyle: { color: "#4aa8ff", width: 1.2 }, itemStyle: { color: "#4aa8ff" } },
      ],
    };
  }, [spot, gk.price, sigma, days, strike, rDom, rFor, type, notional, quote, d]);
  // swap de change et swap de devises
  const [swapN, setSwapN] = useState(10_000_000);
  const [ccsYears, setCcsYears] = useState(5), [ccsCpnB, setCcsCpnB] = useState(NaN), [ccsCpnQ, setCcsCpnQ] = useState(NaN);
  const ccs = useMemo(() => {
    const cb = (Number.isNaN(ccsCpnB) ? rFor : ccsCpnB) / 100, cq = (Number.isNaN(ccsCpnQ) ? rDom : ccsCpnQ) / 100;
    const pv = (c: number, disc: number) => Array.from({ length: ccsYears }, (_, i) => (c + (i === ccsYears - 1 ? 1 : 0)) / (1 + disc) ** (i + 1)).reduce((a, b) => a + b, 0);
    const legB = swapN * pv(cb, rFor / 100), legQ = swapN * spot * pv(cq, rDom / 100);
    return { legB, legQ, mtm: legB * spot - legQ };
  }, [ccsYears, ccsCpnB, ccsCpnQ, rFor, rDom, swapN, spot]);
  // taille de position : risque en devise de compte, stop en pips
  const [acct, setAcct] = useState(100_000), [riskPct, setRiskPct] = useState(1), [stop, setStop] = useState(50);
  const quoteToEur = conv(board.data, quote, "EUR");
  const pipValuePerUnit = pip * (quoteToEur ?? NaN); // valeur d'un pip pour 1 unité de base, en EUR
  const units = (acct * riskPct / 100) / (stop * pipValuePerUnit);
  // conversion
  const [amt, setAmt] = useState(1000), [from, setFrom] = useState("EUR"), [to, setTo] = useState("USD");
  const cv = conv(board.data, from, to);
  const sw = Q.fxSwap(swapN, spot, fw.forward);
  return (
    <div className="grid grid-cols-12 gap-1">
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title={`Change à terme · ${pairLabel(pair)}`} right={<SourceTag env={rates.env} />}>
        <div className="px-2 py-1">
          <Num label={`Comptant ${base}/${quote}`} value={spot} onChange={setSpotIn} step={pip} />
          <Num label={`Taux ${quote} (cotée)`} value={rDom} onChange={setRq} step={0.05} suffix="%" />
          <Num label={`Taux ${base} (base)`} value={rFor} onChange={setRb} step={0.05} suffix="%" />
          <Num label="Durée" value={days} onChange={setDays} step={1} suffix="jours" />
          <Out label="Cours à terme" value={num(fw.forward, d)} cls="text-amber" />
          <Out label="Points de terme" value={num(fw.points / pip, 2)} cls={tone(fw.points)} />
          <Out label={fw.points > 0 ? `Report (${base} plus cher à terme)` : `Déport (${base} moins cher à terme)`} value={pct((fw.forward / spot - 1) * 100 * 365 / days)} title="Prime ou décote annualisée" />
          <table className="mt-1"><thead><tr><th>Échéance</th><th className="num">Terme</th><th className="num">Points</th><th className="num">Ann.</th></tr></thead>
            <tbody>{TENORS.map(([l, dd]) => { const f = Q.fxForward(spot, rDom / 100, rFor / 100, dd, dBase(quote), dBase(base)); return <tr key={l} className="cursor-pointer hover:bg-raised" onClick={() => setDays(dd)}><td className={dd === days ? "text-amber" : ""}>{l}</td><td className="num">{num(f.forward, d)}</td><td className={`num ${tone(f.points)}`}>{num(f.points / pip, 1)}</td><td className="num text-dim">{pct((f.forward / spot - 1) * 100 * 365 / dd)}</td></tr>; })}</tbody></table>
          <div className="pt-1 text-[10px] text-dim">Parité des taux couverte : F = S × (1 + r{quote} × j/{dBase(quote)}) / (1 + r{base} × j/{dBase(base)}). Taux directeurs par défaut, modifiables.</div>
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Option de change · Garman-Kohlhagen">
        <div className="px-2 py-1">
          <div className="flex justify-between py-0.5"><span className="text-dim">Type (sur {base})</span><Seg value={type} options={[["call", "Call"], ["put", "Put"]]} onChange={setType} /></div>
          <Num label="Prix d'exercice (défaut : à terme)" value={strike} onChange={setK} step={pip * 5} />
          <Num label="Volatilité (défaut : réalisée 3M)" value={sigma} onChange={setVol} step={0.1} suffix="%" />
          <Num label={`Nominal (${base})`} value={notional} onChange={setNotional} step={100_000} />
          <Out label={`Prime (${quote} par ${base})`} value={num(gk.price, d)} cls="text-amber" />
          <Out label={`Prime totale (${quote})`} value={num(gk.price * notional, 0)} />
          <Out label="Prime en % du nominal" value={pct(gk.price / spot * 100, 3).replace("+", "")} />
          <Out label="Prime en pips" value={num(gk.price / pip, 1)} />
          <Out label="Delta (couverture en base)" value={`${num(gk.delta, 3)} · ${num(gk.delta * notional, 0)} ${base}`} />
          <Out label="Gamma · Vega (1 %) · Theta (jour)" value={`${num(gk.gamma, 3)} · ${num(gk.vega * notional, 0)} · ${num(gk.theta * notional, 0)}`} />
          <Out label="Point mort à l'échéance" value={num(type === "call" ? strike + gk.price : strike - gk.price, d)} />
          <div className="mt-1 h-44">{payoff && <EChart option={payoff} />}</div>
          <div className="pt-1 text-[10px] text-dim">Gain ou perte de l&apos;acheteur en {quote}, prime déduite ; ligne verticale : comptant. Pas de volatilité implicite gratuite sur le change : la volatilité réalisée sert de référence.</div>
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Taille de position et valeur du pip">
        <div className="px-2 py-1">
          <Num label="Capital (EUR)" value={acct} onChange={setAcct} step={1000} />
          <Num label="Risque par trade" value={riskPct} onChange={setRiskPct} step={0.25} suffix="%" />
          <Num label="Stop" value={stop} onChange={setStop} step={5} suffix="pips" />
          <Out label="Montant risqué" value={`${num(acct * riskPct / 100, 0)} €`} />
          <Out label={`Taille (${base})`} value={num(units, 0)} cls="text-amber" />
          <Out label="Lots standard (100 000)" value={num(units / 100_000, 2)} />
          <Out label="Valeur du pip pour 1 lot" value={`${num(pipValuePerUnit * 100_000, 2)} €`} />
          <Out label="Nominal en EUR" value={`${num(units * (conv(board.data, base, "EUR") ?? NaN), 0)} €`} />
          <div className="pt-1 text-[10px] text-dim">Valeur du pip = taille du pip × cours {quote}/EUR. Pip : {pip === 0.01 ? "0,01" : "0,0001"}.</div>
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="FX swap et swap de devises">
        <div className="px-2 py-1">
          <Num label={`Nominal (${base})`} value={swapN} onChange={setSwapN} step={1_000_000} />
          <Out label={`Jambe proche (au comptant, ${quote})`} value={num(sw.nearQuote, 0)} />
          <Out label={`Jambe lointaine (à ${days} j, ${quote})`} value={num(sw.farQuote, 0)} />
          <Out label={`Écart de terme (${quote})`} value={num(sw.carry, 0)} cls={tone(fw.points)} title="Coût ou gain de portage : différentiel de taux sur la durée" />
          <div className="mt-2 text-[10px] uppercase text-amber">Swap de devises taux fixe contre taux fixe</div>
          <Num label="Maturité" value={ccsYears} onChange={setCcsYears} step={1} suffix="ans" />
          <Num label={`Coupon reçu en ${base}`} value={Number.isNaN(ccsCpnB) ? rFor : ccsCpnB} onChange={setCcsCpnB} step={0.05} suffix="%" />
          <Num label={`Coupon payé en ${quote}`} value={Number.isNaN(ccsCpnQ) ? rDom : ccsCpnQ} onChange={setCcsCpnQ} step={0.05} suffix="%" />
          <Out label={`Jambe ${base} (valeur actuelle)`} value={num(ccs.legB, 0)} /><Out label={`Jambe ${quote} (valeur actuelle)`} value={num(ccs.legQ, 0)} />
          <Out label={`Valeur de marché (${quote})`} value={num(ccs.mtm, 0)} cls={tone(ccs.mtm)} title="Courbes plates aux taux directeurs ; échange des nominaux au début et à la fin." />
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Convertisseur" right={<SourceTag env={board.env} />}>
        <div className="space-y-1 px-2 py-1">
          <Num label="Montant" value={amt} onChange={setAmt} />
          <div className="flex items-center justify-between"><span className="text-dim">De → vers</span><span className="flex gap-1">
            <select value={from} onChange={(e) => setFrom(e.target.value)}>{CCYS.map((c) => <option key={c}>{c}</option>)}</select>
            <button onClick={() => { setFrom(to); setTo(from); }} className="border border-line px-1">⇄</button>
            <select value={to} onChange={(e) => setTo(e.target.value)}>{CCYS.map((c) => <option key={c}>{c}</option>)}</select></span></div>
          <Out label="Résultat" value={cv == null ? "taux indisponible" : `${num(amt * cv, 2)} ${to}`} cls="text-amber" />
          <Out label="Taux appliqué" value={cv == null ? "–" : `1 ${from} = ${price(cv)} ${to}`} />
          <Out label="Taux inverse" value={cv == null ? "–" : `1 ${to} = ${price(1 / cv)} ${from}`} />
          <div className="text-[10px] text-dim">Cours différés ; paires absentes calculées par croisement via le dollar.</div>
        </div>
      </Panel>
    </div>
  );
}

type Row = { pair: string; last?: number };
/** Cours de conversion a → b à partir des paires cotées, croisé via le dollar si besoin. */
function conv(rows: Row[] | undefined, a: string, b: string): number | null {
  const direct = (x: string, y: string): number | null => {
    if (x === y) return 1;
    const d = rows?.find((p) => p.pair === x + y)?.last; if (d) return d;
    const i = rows?.find((p) => p.pair === y + x)?.last; return i ? 1 / i : null;
  };
  const d = direct(a, b); if (d) return d;
  const ua = direct(a, "USD"), ub = direct("USD", b);
  return ua && ub ? ua * ub : null;
}
