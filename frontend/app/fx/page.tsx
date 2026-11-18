"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Export from "@/components/Export";
import { Num, Out, Panel, RangeBar, Seg, SourceTag, Spark, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { num, pct, price, tone } from "@/lib/format";
import * as Q from "@/lib/quant";

type Pair = { pair: string; symbol: string; last?: number; d1?: number; w1?: number; m1?: number; ytd?: number; hi52?: number; lo52?: number; range_pos?: number; hv1m?: number; hv3m?: number; hv1y?: number; spark?: number[]; error?: string };
type Rate = { ccy: string; bank: string; rate: number; date: string };
const TENORS: [string, number][] = [["1S", 7], ["1M", 30], ["2M", 61], ["3M", 91], ["6M", 182], ["9M", 273], ["1A", 365], ["2A", 730]];
const BASE365 = new Set(["GBP", "AUD", "NZD", "CAD"]); // conventions monétaires en base 365

export default function FX() {
  const board = useApi<Pair[]>("/api/fx/board", 5 * 60_000);
  const rates = useApi<Rate[]>("/api/fx/rates", 6 * 60 * 60_000);
  const s = useSearchParams().get("s")?.replace("=X", "").replace("/", "").toUpperCase();
  const [pair, setPair] = useState("EURUSD");
  useEffect(() => { if (s && s.length === 6) setPair(s); }, [s]);
  const base = pair.slice(0, 3), quote = pair.slice(3, 6);
  const r = Object.fromEntries((rates.data ?? []).map((x) => [x.ccy, x.rate]));
  const row = board.data?.find((p) => p.pair === pair);
  const [spotIn, setSpotIn] = useState(NaN), [rq, setRq] = useState(NaN), [rb, setRb] = useState(NaN), [days, setDays] = useState(91);
  const spot = Number.isNaN(spotIn) ? row?.last ?? NaN : spotIn;
  const rDom = Number.isNaN(rq) ? r[quote] ?? NaN : rq, rFor = Number.isNaN(rb) ? r[base] ?? NaN : rb;
  const pf = Q.pipFactor(pair);
  const dBase = (c: string) => (BASE365.has(c) ? 365 : 360);
  const fw = Q.fxForward(spot, rDom / 100, rFor / 100, days, dBase(quote), dBase(base));
  // option de change (Garman-Kohlhagen)
  const [K, setK] = useState(NaN), [vol, setVol] = useState(NaN), [type, setType] = useState<"call" | "put">("call"), [notional, setNotional] = useState(1_000_000);
  const sigma = Number.isNaN(vol) ? row?.hv3m ?? 8 : vol;
  const strike = Number.isNaN(K) ? fw.forward : K;
  const gk = Q.blackScholes({ S: spot, K: strike, T: days / 365, r: Math.log(1 + rDom / 100), q: Math.log(1 + rFor / 100), sigma: sigma / 100, type });
  // swap de change et swap de devises
  const [swapN, setSwapN] = useState(10_000_000);
  const [ccsYears, setCcsYears] = useState(5), [ccsCpnB, setCcsCpnB] = useState(NaN), [ccsCpnQ, setCcsCpnQ] = useState(NaN);
  const ccs = useMemo(() => {
    const cb = (Number.isNaN(ccsCpnB) ? rFor : ccsCpnB) / 100, cq = (Number.isNaN(ccsCpnQ) ? rDom : ccsCpnQ) / 100;
    const pv = (c: number, disc: number) => Array.from({ length: ccsYears }, (_, i) => (c + (i === ccsYears - 1 ? 1 : 0)) / (1 + disc) ** (i + 1)).reduce((a, b) => a + b, 0);
    const legB = swapN * pv(cb, rFor / 100), legQ = swapN * spot * pv(cq, rDom / 100);
    return { legB, legQ, mtm: legB * spot - legQ };
  }, [ccsYears, ccsCpnB, ccsCpnQ, rFor, rDom, swapN, spot]);
  // conversion
  const [amt, setAmt] = useState(1000), [from, setFrom] = useState("EUR"), [to, setTo] = useState("USD");
  const rate = (a: string, b: string): number | null => {
    if (a === b) return 1;
    const d = board.data?.find((p) => p.pair === a + b)?.last; if (d) return d;
    const i = board.data?.find((p) => p.pair === b + a)?.last; if (i) return 1 / i;
    const ua = rate2(a, "USD"), ub = rate2("USD", b); return ua && ub ? ua * ub : null;
  };
  const rate2 = (a: string, b: string): number | null => { if (a === b) return 1; const d = board.data?.find((p) => p.pair === a + b)?.last; if (d) return d; const i = board.data?.find((p) => p.pair === b + a)?.last; return i ? 1 / i : null; };
  const ccys = ["EUR", "USD", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "CNY"];
  const conv = rate(from, to);
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 xl:col-span-8" title="Paires principales · comptant" right={<><Export name="forex" columns={["Paire", "Dernier", "1J %", "5S %", "21S %", "YTD %", "Vol 1M", "Vol 3M", "Vol 1A"]} rows={(board.data ?? []).map((p) => [p.pair, p.last ?? null, p.d1 ?? null, p.w1 ?? null, p.m1 ?? null, p.ytd ?? null, p.hv1m ?? null, p.hv3m ?? null, p.hv1y ?? null])} source={board.env?.source} /><SourceTag env={board.env} /></>}>
        <State loading={board.loading && !board.data} error={board.error} />
        <table><thead><tr><th>Paire</th><th className="num">Dernier</th><th className="num">1J</th><th className="num">5S</th><th className="num">21S</th><th className="num">YTD</th><th className="text-center">52 sem.</th>
          <th className="num" title="Volatilité historique annualisée">Vol 1M</th><th className="num">Vol 3M</th><th className="num">Vol 1A</th><th className="num" title="Taux directeur cotée − base">Diff. taux</th><th>60 séances</th></tr></thead>
          <tbody>{board.data?.map((p) => <tr key={p.pair} className={`cursor-pointer ${p.pair === pair ? "bg-raised" : ""}`} onClick={() => { setPair(p.pair); setSpotIn(NaN); setRq(NaN); setRb(NaN); setK(NaN); setVol(NaN); }}>
            <td className={p.pair === pair ? "text-amber" : ""}>{p.pair.slice(0, 3)}/{p.pair.slice(3)}</td>
            {p.error ? <td colSpan={10} className="text-down">{p.error}</td> : <>
              <td className="num text-fg">{num(p.last, p.pair.includes("JPY") ? 3 : 5)}</td>
              <td className={`num ${tone(p.d1)}`}>{pct(p.d1)}</td><td className={`num ${tone(p.w1)}`}>{pct(p.w1)}</td><td className={`num ${tone(p.m1)}`}>{pct(p.m1)}</td><td className={`num ${tone(p.ytd)}`}>{pct(p.ytd)}</td>
              <td className="text-center"><RangeBar pos={p.range_pos} /></td><td className="num">{num(p.hv1m, 1)}</td><td className="num">{num(p.hv3m, 1)}</td><td className="num">{num(p.hv1y, 1)}</td>
              <td className="num">{r[p.pair.slice(3)] != null && r[p.pair.slice(0, 3)] != null ? `${num(r[p.pair.slice(3)] - r[p.pair.slice(0, 3)], 2)} %` : "–"}</td></>}
            <td><Spark values={p.spark} /></td></tr>)}</tbody></table>
        <div className="px-2 py-1 text-[10px] text-dim">Volatilité implicite des devises : pas de source gratuite (marché de gré à gré) ; la volatilité historique sert de référence et peut être remplacée dans les calculateurs. <Link href={`/graphique?s=${pair}%3DX`} className="text-info">graphique {pair} →</Link></div>
      </Panel>
      <Panel className="col-span-12 xl:col-span-4" title="Taux directeurs par devise" right={<SourceTag env={rates.env} />}>
        <State loading={rates.loading && !rates.data} error={rates.error} />
        <table><thead><tr><th>Devise</th><th>Banque centrale</th><th className="num">Taux</th><th>Depuis</th></tr></thead>
          <tbody>{rates.data?.map((x) => <tr key={x.ccy}><td className="text-amber">{x.ccy}</td><td>{x.bank}</td><td className="num">{num(x.rate, 3)} %</td><td className="text-dim">{x.date}</td></tr>)}</tbody></table>
        <div className="px-2 py-1 text-[10px] text-dim">Le taux directeur sert d&apos;approximation du taux monétaire à court terme. Les écarts avec les taux de marché (€STR, SOFR, SONIA) et la base cross-currency ne sont pas modélisés.</div>
      </Panel>

      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title={`FWCV · change à terme ${base}/${quote}`}>
        <div className="px-2 py-1">
          <Num label={`Comptant ${base}/${quote}`} value={spot} onChange={setSpotIn} step={0.0001} />
          <Num label={`Taux ${quote} (cotée)`} value={rDom} onChange={setRq} step={0.05} suffix="%" />
          <Num label={`Taux ${base} (base)`} value={rFor} onChange={setRb} step={0.05} suffix="%" />
          <Num label="Durée" value={days} onChange={setDays} step={1} suffix="jours" />
          <Out label="Cours à terme" value={num(fw.forward, pair.includes("JPY") ? 3 : 5)} cls="text-amber" />
          <Out label="Points de terme" value={num(fw.points * pf, 2)} cls={tone(fw.points)} />
          <Out label={fw.points > 0 ? `Report (${base} à terme plus cher)` : `Déport (${base} à terme moins cher)`} value={pct((fw.forward / spot - 1) * 100 * 365 / days)} title="Prime ou décote annualisée" />
          <table className="mt-1"><thead><tr><th>Échéance</th><th className="num">Terme</th><th className="num">Points</th></tr></thead>
            <tbody>{TENORS.map(([l, d]) => { const f = Q.fxForward(spot, rDom / 100, rFor / 100, d, dBase(quote), dBase(base)); return <tr key={l}><td>{l}</td><td className="num">{num(f.forward, pair.includes("JPY") ? 3 : 5)}</td><td className="num">{num(f.points * pf, 2)}</td></tr>; })}</tbody></table>
          <div className="pt-1 text-[10px] text-dim">Parité des taux couverte : F = S × (1 + r{quote} × j/{dBase(quote)}) / (1 + r{base} × j/{dBase(base)}).</div>
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Option de change (Garman-Kohlhagen)">
        <div className="px-2 py-1">
          <div className="flex justify-between py-0.5"><span className="text-dim">Type (sur {base})</span><Seg value={type} options={[["call", "Call"], ["put", "Put"]]} onChange={setType} /></div>
          <Num label="Prix d'exercice (défaut : à terme)" value={strike} onChange={setK} step={0.0005} />
          <Num label="Volatilité (défaut : historique 3M)" value={sigma} onChange={setVol} step={0.1} suffix="%" />
          <Num label={`Nominal (${base})`} value={notional} onChange={setNotional} step={100_000} />
          <Out label={`Prime (${quote} par ${base})`} value={num(gk.price, 5)} cls="text-amber" />
          <Out label={`Prime totale (${quote})`} value={num(gk.price * notional, 0)} />
          <Out label="Prime en % du nominal" value={pct(gk.price / spot * 100, 3).replace("+", "")} />
          <Out label="Delta (couverture en base)" value={`${num(gk.delta, 3)} · ${num(gk.delta * notional, 0)} ${base}`} />
          <Out label="Gamma · Vega (1 %) · Theta (jour)" value={`${num(gk.gamma, 3)} · ${num(gk.vega * notional, 0)} · ${num(gk.theta * notional, 0)}`} />
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="FX swap et swap de devises">
        <div className="px-2 py-1">
          <Num label={`Nominal (${base})`} value={swapN} onChange={setSwapN} step={1_000_000} />
          <Out label={`Jambe proche (au comptant, ${quote})`} value={num(Q.fxSwap(swapN, spot, fw.forward).nearQuote, 0)} />
          <Out label={`Jambe lointaine (à ${days} j, ${quote})`} value={num(Q.fxSwap(swapN, spot, fw.forward).farQuote, 0)} />
          <Out label={`Écart de terme (${quote})`} value={num(Q.fxSwap(swapN, spot, fw.forward).carry, 0)} cls={tone(fw.points)} title="Coût ou gain de portage : différentiel de taux sur la durée" />
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
            <select value={from} onChange={(e) => setFrom(e.target.value)}>{ccys.map((c) => <option key={c}>{c}</option>)}</select>
            <button onClick={() => { setFrom(to); setTo(from); }} className="border border-line px-1">⇄</button>
            <select value={to} onChange={(e) => setTo(e.target.value)}>{ccys.map((c) => <option key={c}>{c}</option>)}</select></span></div>
          <Out label="Résultat" value={conv == null ? "taux indisponible" : `${num(amt * conv, 2)} ${to}`} cls="text-amber" />
          <Out label="Taux appliqué" value={conv == null ? "–" : `1 ${from} = ${price(conv)} ${to}`} />
          <div className="text-[10px] text-dim">Cours différés ; paires absentes calculées par croisement via le dollar.</div>
        </div>
      </Panel>
    </div>
  );
}
