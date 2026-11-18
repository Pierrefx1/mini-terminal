"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Num, Out, Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, num, pct, price, tone } from "@/lib/format";
import * as Q from "@/lib/quant";

type FA = { symbol: string; currency: string; annual: { income: { dates: string[]; rows: Record<string, (number | null)[]> }; balance: { rows: Record<string, (number | null)[]> }; cashflow: { rows: Record<string, (number | null)[]> } };
  valuation: Record<string, number | null>; ttm: Record<string, number | null>; ratios: Record<string, number | null> };
type Hist = { candles: { time: number; close: number }[] };
const last = (a?: (number | null)[]) => (a ?? []).filter((x): x is number => x != null).at(-1);

function useBeta(sym: string | null) {
  const a = useApi<Hist>(sym ? `/api/market/history?symbol=${encodeURIComponent(sym)}&interval=1wk&range=5y` : null);
  const b = useApi<Hist>(sym ? `/api/market/history?symbol=%5EGSPC&interval=1wk&range=5y` : null);
  return useMemo(() => {
    if (!a.data || !b.data) return null;
    const mb = new Map(b.data.candles.map((c) => [Math.round(c.time / 86400 / 7), c.close]));
    const p = a.data.candles.map((c) => [c.close, mb.get(Math.round(c.time / 86400 / 7))] as const).filter((x): x is readonly [number, number] => x[1] != null);
    const ra = p.slice(1).map((x, i) => x[0] / p[i][0] - 1), rb = p.slice(1).map((x, i) => x[1] / p[i][1] - 1);
    const ma = ra.reduce((s, x) => s + x, 0) / ra.length, mbb = rb.reduce((s, x) => s + x, 0) / rb.length;
    let cov = 0, v = 0; ra.forEach((x, i) => { cov += (x - ma) * (rb[i] - mbb); v += (rb[i] - mbb) ** 2; });
    return { beta: cov / v, n: ra.length };
  }, [a.data, b.data]);
}

export default function DCF() {
  const router = useRouter();
  const s = useSearchParams().get("s");
  const [input, setInput] = useState(s ?? "");
  const fa = useApi<FA>(s ? `/api/equities/fa?symbol=${encodeURIComponent(s)}` : null);
  const q = useApi<{ price?: number; name?: string }[]>(s ? `/api/market/quotes?symbols=${encodeURIComponent(s)}` : null, 60_000);
  const est = useBeta(s);
  const px = q.data?.[0]?.price;
  // hypothèses (unités : millions de la devise)
  const [fcf0, setFcf0] = useState(1000), [netDebt, setNetDebt] = useState(0), [shares, setShares] = useState(100);
  const [g1, setG1] = useState(8), [g2, setG2] = useState(5), [tg, setTg] = useState(2.5), [years, setYears] = useState(5);
  const [rf, setRf] = useState(4.2), [beta, setBeta] = useState(1), [mrp, setMrp] = useState(5), [kd, setKd] = useState(5), [tax, setTax] = useState(21);
  const [eqW, setEqW] = useState(NaN), [scen, setScen] = useState<"bear" | "base" | "bull">("base");
  useEffect(() => {
    const d = fa.data; if (!d) return;
    const M = 1e6;
    const fcf = last(d.annual.cashflow.rows.FreeCashFlow) ?? d.ttm.FreeCashFlow;
    if (fcf) setFcf0(Math.round(fcf / M));
    const debt = last(d.annual.balance.rows.TotalDebt) ?? 0, cash = last(d.annual.balance.rows.CashCashEquivalentsAndShortTermInvestments) ?? 0;
    setNetDebt(Math.round((debt - cash) / M));
    const sh = last(d.annual.balance.rows.OrdinarySharesNumber) ?? last(d.annual.income.rows.DilutedAverageShares);
    if (sh) setShares(Math.round(sh / M * 100) / 100);
    if (d.ratios.revenue_growth != null) setG1(Math.round(Math.min(Math.max(d.ratios.revenue_growth, -5), 25) * 10) / 10);
    if (d.ratios.tax_rate != null) setTax(Math.round(d.ratios.tax_rate * 10) / 10);
    const ie = last(d.annual.income.rows.InterestExpense);
    if (ie && debt) setKd(Math.round(Math.abs(ie) / debt * 1000) / 10);
  }, [fa.data]);
  useEffect(() => { if (est) setBeta(Math.round(est.beta * 100) / 100); }, [est]);
  const mcap = (px ?? 0) * shares;
  const we = Number.isNaN(eqW) ? (mcap + Math.max(netDebt, 0) > 0 ? mcap / (mcap + Math.max(netDebt, 0)) * 100 : 100) : eqW;
  const ke = Q.capm(rf / 100, beta, mrp / 100);
  const w = Q.wacc(we, 100 - we, ke, kd / 100, tax / 100);
  const adj = { bear: [-3, -1, -0.5, 0.01], base: [0, 0, 0, 0], bull: [3, 1, 0.5, -0.005] }[scen];
  const growth = (a: number, b: number) => Array.from({ length: years }, (_, i) => (a + (b - a) * (years > 1 ? i / (years - 1) : 0)) / 100);
  const run = (wacc: number, gT: number, ga = g1 + adj[0], gb = g2 + adj[1]) => { try { return Q.dcf({ fcf: Q.projectFcf(fcf0, growth(ga, gb)), wacc, terminalGrowth: gT, netDebt, shares }); } catch { return null; } };
  const res = run(w + adj[3], (tg + adj[2]) / 100);
  const flows = Q.projectFcf(fcf0, growth(g1 + adj[0], g2 + adj[1]));
  const waccs = [-1, -0.5, 0, 0.5, 1].map((d) => w + d / 100), tgs = [-1, -0.5, 0, 0.5, 1].map((d) => tg / 100 + d / 100);
  const scen3 = (["bear", "base", "bull"] as const).map((k) => { const a = { bear: [-3, -1, -0.5, 0.01], base: [0, 0, 0, 0], bull: [3, 1, 0.5, -0.005] }[k]; return { k, r: run(w + a[3], (tg + a[2]) / 100, g1 + a[0], g2 + a[1]) }; });
  // multiples
  const [peEbitda, setPeEbitda] = useState(12), [pePer, setPePer] = useState(20), [txMult, setTxMult] = useState(14), [premium, setPremium] = useState(30);
  const ebitda = (fa.data?.ttm.EBITDA ?? 0) / 1e6, eps = fa.data?.ttm.DilutedEPS ?? NaN;
  const cur = fa.data?.currency ?? "";
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12" title={<span className="normal-case tracking-normal">DCF · valorisation <form className="ml-2 inline" onSubmit={(e) => { e.preventDefault(); router.push(`/dcf?s=${encodeURIComponent(input.trim().toUpperCase())}`); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Symbole" className="w-28 uppercase" /></form>
        {s && px != null && <span className="ml-2 text-fg">{q.data?.[0]?.name} · cours {price(px)} {cur}</span>}</span>} right={<SourceTag env={fa.env} />}>
        <State loading={fa.loading && !fa.data} error={fa.error} />
        <div className="px-2 py-1 text-[11px] text-dim">Montants en millions de {cur || "la devise"}. Hypothèses préremplies depuis les comptes publiés (FCF, dette nette, actions, croissance du CA, taux d&apos;impôt, coût de la dette) et le bêta hebdomadaire sur 5 ans vs S&amp;P 500 ; toutes modifiables, recalcul immédiat.</div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-3" title="Hypothèses d'exploitation">
        <div className="px-2 py-1">
          <Num label="FCF de départ" value={fcf0} onChange={setFcf0} step={10} /><Num label="Dette nette" value={netDebt} onChange={setNetDebt} step={10} /><Num label="Actions (millions)" value={shares} onChange={setShares} step={0.1} />
          <Num label="Croissance du FCF, année 1" value={g1} onChange={setG1} step={0.5} suffix="%" /><Num label={`Croissance, année ${years}`} value={g2} onChange={setG2} step={0.5} suffix="%" />
          <Num label="Années explicites" value={years} onChange={(v) => setYears(Math.max(1, Math.min(15, Math.round(v))))} step={1} /><Num label="Croissance terminale" value={tg} onChange={setTg} step={0.1} suffix="%" />
          <div className="flex justify-between py-0.5"><span className="text-dim">Scénario</span><Seg value={scen} options={[["bear", "Pessimiste"], ["base", "Central"], ["bull", "Optimiste"]]} onChange={setScen} /></div>
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-3" title="Coût du capital (CAPM, WACC)">
        <div className="px-2 py-1">
          <Num label="Taux sans risque" value={rf} onChange={setRf} step={0.05} suffix="%" /><Num label={`Bêta${est ? ` (estimé ${num(est.beta, 2)}, ${est.n} sem.)` : ""}`} value={beta} onChange={setBeta} step={0.05} />
          <Num label="Prime de risque du marché" value={mrp} onChange={setMrp} step={0.25} suffix="%" /><Out label="Coût des fonds propres (CAPM)" value={pct(ke * 100).replace("+", "")} />
          <Num label="Coût de la dette avant impôt" value={kd} onChange={setKd} step={0.1} suffix="%" /><Num label="Taux d'impôt" value={tax} onChange={setTax} step={0.5} suffix="%" />
          <Num label="Poids des fonds propres (défaut : marché)" value={we} onChange={setEqW} step={1} suffix="%" />
          <Out label="WACC" value={pct(w * 100).replace("+", "")} cls="text-amber" />
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-3" title={`Résultat · scénario ${{ bear: "pessimiste", base: "central", bull: "optimiste" }[scen]}`}>
        {res ? <div className="px-2 py-1">
          <Out label="Valeur actuelle des flux explicites" value={big(res.pvFlows)} /><Out label="Valeur terminale (actualisée)" value={big(res.pvTerminal)} />
          <Out label="Part de la valeur terminale" value={pct(res.tvShare * 100).replace("+", "")} cls={res.tvShare > 0.8 ? "text-amber" : ""} />
          <Out label="Valeur d'entreprise" value={big(res.ev)} /><Out label="Valeur des fonds propres" value={big(res.equity)} />
          <Out label="Valeur par action" value={`${num(res.perShare, 2)} ${cur}`} cls="text-amber" />
          {px != null && <Out label="Potentiel vs cours" value={pct((res.perShare / px - 1) * 100)} cls={tone(res.perShare - px)} />}
          {px != null && <Out label="EV / EBITDA implicite" value={ebitda ? `${num(res.ev / ebitda, 1)}x` : "–"} />}
          <table className="mt-1"><thead><tr><th>Scénario</th><th className="num">Valeur / action</th><th className="num">vs cours</th></tr></thead>
            <tbody>{scen3.map(({ k, r }) => <tr key={k}><td>{{ bear: "Pessimiste", base: "Central", bull: "Optimiste" }[k]}</td><td className="num">{r ? num(r.perShare, 2) : "–"}</td><td className={`num ${tone(r && px ? r.perShare - px : null)}`}>{r && px ? pct((r.perShare / px - 1) * 100) : "–"}</td></tr>)}</tbody></table>
          <div className="text-[10px] text-dim">Pessimiste : croissance −3/−1 pt, terminale −0,5 pt, WACC +1 pt. Optimiste : symétrique (WACC −0,5 pt).</div>
        </div> : <div className="p-2 text-down">Le WACC doit dépasser la croissance terminale.</div>}
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-3" title="Flux projetés">
        <table><thead><tr><th>Année</th><th className="num">FCF</th><th className="num">Croiss.</th><th className="num">Actualisé</th></tr></thead>
          <tbody>{flows.map((f, i) => <tr key={i}><td>{i + 1}</td><td className="num">{big(f)}</td><td className="num">{pct((f / (i ? flows[i - 1] : fcf0) - 1) * 100)}</td><td className="num">{big(f / (1 + w + adj[3]) ** (i + 1))}</td></tr>)}</tbody></table>
      </Panel>
      <Panel className="col-span-12 lg:col-span-6" title="Sensibilité de la valeur par action : WACC × croissance terminale">
        <table><thead><tr><th>WACC \ g</th>{tgs.map((g) => <th key={g} className="num">{num(g * 100, 1)} %</th>)}</tr></thead>
          <tbody>{waccs.map((wc) => <tr key={wc}><td>{num(wc * 100, 2)} %</td>{tgs.map((g) => { const r = run(wc, g); return <td key={g} className={`num ${px && r ? tone(r.perShare - px) : ""} ${Math.abs(wc - w) < 1e-9 && Math.abs(g - tg / 100) < 1e-9 ? "bg-raised text-amber" : ""}`}>{r ? num(r.perShare, 1) : "n/a"}</td>; })}</tr>)}</tbody></table>
        <div className="px-2 py-1 text-[10px] text-dim">Vert : au-dessus du cours actuel. Scénario central.</div>
      </Panel>
      <Panel className="col-span-12 lg:col-span-6" title="Valorisation par les multiples">
        <div className="grid grid-cols-2 gap-x-6 px-2 py-1">
          <div>
            <div className="text-[10px] uppercase text-amber">Sociétés comparables</div>
            <Num label="EV/EBITDA des pairs" value={peEbitda} onChange={setPeEbitda} step={0.5} suffix="x" />
            <Out label="Valeur par action" value={ebitda ? num((peEbitda * ebitda - netDebt) / shares, 2) : "–"} />
            <Num label="PER des pairs" value={pePer} onChange={setPePer} step={0.5} suffix="x" />
            <Out label="Valeur par action" value={Number.isFinite(eps) ? num(pePer * eps, 2) : "–"} />
            <div className="text-[10px] text-dim">Médianes disponibles dans FA, onglet comparaison.</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-amber">Transactions précédentes</div>
            <Num label="EV/EBITDA payé (transactions)" value={txMult} onChange={setTxMult} step={0.5} suffix="x" />
            <Out label="Valeur par action" value={ebitda ? num((txMult * ebitda - netDebt) / shares, 2) : "–"} />
            <Num label="Prime de contrôle observée" value={premium} onChange={setPremium} step={1} suffix="%" />
            <Out label="Prix d'offre implicite" value={px != null ? num(px * (1 + premium / 100), 2) : "–"} />
            <div className="text-[10px] text-dim">Bases de transactions M&amp;A sous licence : multiples à saisir.</div>
          </div>
        </div>
        <div className="px-2 pb-1 text-[11px]">EBITDA 12 mois : {big(ebitda)} · BPA 12 mois : {num(eps, 2)} · dette nette : {big(netDebt)} · actions : {num(shares, 2)} M</div>
      </Panel>
    </div>
  );
}
