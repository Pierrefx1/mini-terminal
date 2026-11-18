"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Export from "@/components/Export";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, num, pct, price, tone } from "@/lib/format";

type Table = { dates: string[]; rows: Record<string, (number | null)[]> };
type FA = { symbol: string; currency: string; sector?: string; annual: { income: Table; balance: Table; cashflow: Table }; quarterly: { income: Table; balance: Table; cashflow: Table };
  valuation: Record<string, number | null>; valuation_date: string | null; ttm: Record<string, number | null>; ratios: Record<string, number | null> };
type Comp = Record<string, any>;

const LABELS: Record<string, string> = {
  TotalRevenue: "Chiffre d'affaires", CostOfRevenue: "Coût des ventes", GrossProfit: "Marge brute", OperatingExpense: "Charges opérationnelles", OperatingIncome: "Résultat opérationnel (EBIT)",
  EBITDA: "EBITDA", InterestExpense: "Charges d'intérêts", PretaxIncome: "Résultat avant impôt", TaxProvision: "Impôt", NetIncome: "Résultat net", DilutedEPS: "BPA dilué",
  DilutedAverageShares: "Actions diluées (moyenne)", TaxRateForCalcs: "Taux d'impôt effectif",
  TotalAssets: "Total de l'actif", CurrentAssets: "Actif courant", CashCashEquivalentsAndShortTermInvestments: "Trésorerie et placements CT", TotalLiabilitiesNetMinorityInterest: "Total des dettes",
  CurrentLiabilities: "Passif courant", TotalDebt: "Dette financière", NetDebt: "Dette nette (publiée)", StockholdersEquity: "Capitaux propres", InvestedCapital: "Capitaux investis", OrdinarySharesNumber: "Actions en circulation",
  OperatingCashFlow: "Flux de trésorerie d'exploitation", CapitalExpenditure: "Investissements (capex)", FreeCashFlow: "Flux de trésorerie disponible (FCF)", CashDividendsPaid: "Dividendes versés", RepurchaseOfCapitalStock: "Rachats d'actions",
};
const RATIOS: [string, string, "pct" | "x" | "big"][] = [["gross_margin", "Marge brute", "pct"], ["operating_margin", "Marge opérationnelle", "pct"], ["ebitda_margin", "Marge d'EBITDA", "pct"], ["net_margin", "Marge nette", "pct"],
  ["fcf_margin", "Marge de FCF", "pct"], ["revenue_growth", "Croissance du CA", "pct"], ["roe", "ROE", "pct"], ["roic", "ROIC", "pct"], ["fcf_yield", "Rendement du FCF", "pct"],
  ["net_debt", "Dette nette", "big"], ["net_debt_ebitda", "Dette nette / EBITDA", "x"], ["debt_equity", "Dette / capitaux propres", "x"], ["tax_rate", "Taux d'impôt", "pct"]];
const VAL: [string, string, "x" | "big"][] = [["MarketCap", "Capitalisation", "big"], ["EnterpriseValue", "Valeur d'entreprise", "big"], ["PeRatio", "PER", "x"], ["ForwardPeRatio", "PER prévisionnel", "x"],
  ["PbRatio", "Price-to-Book", "x"], ["PsRatio", "Price-to-Sales", "x"], ["EnterprisesValueEBITDARatio", "EV/EBITDA", "x"], ["EnterprisesValueRevenueRatio", "EV/CA", "x"]];
const fmt = (v: number | null | undefined, k: "pct" | "x" | "big") => (v == null ? "–" : k === "pct" ? `${num(v, 1)} %` : k === "x" ? `${num(v, 2)}x` : big(v));

function Statement({ t, title, currency }: { t: Table; title: string; currency: string }) {
  if (!t.dates.length) return <div className="p-2 text-dim">{title} : non publié.</div>;
  return (
    <table>
      <thead><tr><th>{title} ({currency})</th>{t.dates.map((d) => <th key={d} className="num">{d}</th>)}<th className="num">Var.</th></tr></thead>
      <tbody>{Object.entries(t.rows).filter(([, v]) => v.some((x) => x != null)).map(([k, v]) => {
        const a = v.at(-1), b = v.at(-2);
        const isRate = k === "TaxRateForCalcs", isEps = k === "DilutedEPS";
        return <tr key={k}><td>{LABELS[k] ?? k}</td>{v.map((x, i) => <td key={i} className="num">{x == null ? "–" : isRate ? `${num(x * 100, 1)} %` : isEps ? num(x, 2) : big(x)}</td>)}
          <td className={`num ${tone(a != null && b ? a - b : null)}`}>{a != null && b ? pct((a / b - 1) * 100 * Math.sign(b)) : "–"}</td></tr>;
      })}</tbody>
    </table>
  );
}

export default function FAPage() {
  const router = useRouter();
  const s = useSearchParams().get("s");
  const [input, setInput] = useState(s ?? "");
  useEffect(() => setInput(s ?? ""), [s]);
  const fa = useApi<FA>(s ? `/api/equities/fa?symbol=${encodeURIComponent(s)}` : null);
  const q = useApi<{ symbol: string; price?: number; change_pct?: number; name?: string }[]>(s ? `/api/market/quotes?symbols=${encodeURIComponent(s)}` : null, 60_000);
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const [st, setSt] = useState<"income" | "balance" | "cashflow">("income");
  const [peers, setPeers] = useState("");
  useEffect(() => setPeers(s ? `${s},` + ({ AAPL: "MSFT,GOOGL,AMZN,META", MSFT: "AAPL,GOOGL,ORCL,CRM", "MC.PA": "RMS.PA,KER.PA,CFR.SW,OR.PA" } as Record<string, string>)[s.toUpperCase()] || `${s}` : ""), [s]);
  const [peerQ, setPeerQ] = useState("");
  useEffect(() => setPeerQ(peers), [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const comps = useApi<Comp[]>(peerQ && peerQ.includes(",") ? `/api/equities/comps?symbols=${encodeURIComponent(peerQ)}` : null);
  const d = fa.data, quote = q.data?.[0];
  const tbl = d?.[period][st];
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12" title={<span className="normal-case tracking-normal">FA · analyse fondamentale <form className="ml-2 inline" onSubmit={(e) => { e.preventDefault(); if (input.trim()) router.push(`/fa?s=${encodeURIComponent(input.trim().toUpperCase())}`); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Symbole (AAPL, MC.PA…)" className="w-40 uppercase" /></form>
        {quote && !("error" in quote) && <span className="ml-3 text-fg">{quote.name} {price(quote.price)} <span className={tone(quote.change_pct)}>{pct(quote.change_pct)}</span></span>}
        {d?.sector && <span className="ml-2 text-dim">{d.sector}</span>}</span>}
        right={<>{s && <><Link href={`/des?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info">DES</Link><Link href={`/graphique?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info">GP</Link><Link href={`/dcf?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info">DCF</Link><Link href={`/research?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info">RES</Link></>}<SourceTag env={fa.env} /></>}>
        {!s && <div className="p-2 text-dim">Saisir un symbole d&apos;action, ou taper <span className="text-amber">AAPL US Equity FA</span> dans la barre de commandes.</div>}
        <State loading={fa.loading && !d} error={fa.error} />
      </Panel>
      {d && <>
        <Panel className="col-span-12 md:col-span-4 xl:col-span-3" title={`Valorisation (${d.valuation_date ?? "dernier trimestre"})`}>
          <table><tbody>{VAL.map(([k, l, f]) => <tr key={k}><td className="text-dim">{l}</td><td className="num">{fmt(d.valuation[k], f)}</td></tr>)}
            <tr><td className="text-dim">BPA (12 mois glissants)</td><td className="num">{num(d.ttm.DilutedEPS, 2)}</td></tr>
            <tr><td className="text-dim">EBITDA (12 mois)</td><td className="num">{big(d.ttm.EBITDA)}</td></tr>
            <tr><td className="text-dim">FCF (12 mois)</td><td className="num">{big(d.ttm.FreeCashFlow)}</td></tr></tbody></table>
          <div className="px-2 py-1 text-[10px] text-dim">Multiples publiés en fin de trimestre, pas recalculés en séance.</div>
        </Panel>
        <Panel className="col-span-12 md:col-span-4 xl:col-span-3" title="Rentabilité, croissance, endettement (dernier exercice)">
          <table><tbody>{RATIOS.map(([k, l, f]) => <tr key={k}><td className="text-dim">{l}</td><td className={`num ${f === "pct" ? tone(d.ratios[k]) : ""}`}>{fmt(d.ratios[k], f)}</td></tr>)}</tbody></table>
          <div className="px-2 py-1 text-[10px] text-dim">ROE : résultat net / capitaux propres moyens. ROIC : EBIT × (1 − taux d&apos;impôt) / capitaux investis moyens.</div>
        </Panel>
        <Panel className="col-span-12 md:col-span-4 xl:col-span-6" title="Consensus, objectifs de cours, actionnariat institutionnel">
          <div className="p-2 leading-relaxed text-dim">Ces données ne sont pas disponibles : elles proviennent de fournisseurs sous licence (FactSet, LSEG, S&amp;P), et l&apos;accès gratuit de Yahoo exige une authentification que le terminal ne contourne pas. Rien n&apos;est estimé à leur place.
            <div className="mt-2">Disponible : <Link href={`/research?s=${encodeURIComponent(s!)}`} className="text-info">note de recherche (RES)</Link> générée à partir des données publiées, et <Link href={`/dcf?s=${encodeURIComponent(s!)}`} className="text-info">modèle DCF</Link> prérempli avec les flux publiés.</div></div>
        </Panel>
        <Panel className="col-span-12" title="États financiers" right={<>
          <Seg value={period} options={[["annual", "Annuel"], ["quarterly", "Trimestriel"]]} onChange={setPeriod} />
          <Seg value={st} options={[["income", "Compte de résultat"], ["balance", "Bilan"], ["cashflow", "Flux de trésorerie"]]} onChange={setSt} />
          {tbl && <Export name={`${d.symbol}-${st}-${period}`} columns={["Poste", ...tbl.dates]} rows={Object.entries(tbl.rows).map(([k, v]) => [LABELS[k] ?? k, ...v])} source={fa.env?.source} />}</>}>
          {tbl && <Statement t={tbl} title={{ income: "Compte de résultat", balance: "Bilan", cashflow: "Flux de trésorerie" }[st]} currency={d.currency} />}
        </Panel>
      </>}
      {s && <Panel className="col-span-12" title="Comparaison d'entreprises" right={<><form onSubmit={(e) => { e.preventDefault(); setPeerQ(peers); }} className="flex gap-1">
        <input value={peers} onChange={(e) => setPeers(e.target.value.toUpperCase())} className="w-80" placeholder="Symboles séparés par des virgules" /><button className="border border-line px-1 text-info">comparer</button></form>
        {comps.data && <Export name="comparables" columns={["Symbole", "Cours", "PER", "EV/EBITDA", "P/B", "Marge nette %", "ROE %", "ROIC %", "Croissance CA %", "Dette nette/EBITDA"]}
          rows={comps.data.map((c) => [c.symbol, c.price, c.PeRatio, c.EnterprisesValueEBITDARatio, c.PbRatio, c.net_margin, c.roe, c.roic, c.revenue_growth, c.net_debt_ebitda])} source={comps.env?.source} />}<SourceTag env={comps.env} /></>}>
        <State loading={comps.loading && !comps.data} error={comps.error} empty={!peerQ.includes(",") && "Ajouter au moins un autre symbole pour comparer."} />
        {comps.data && <table><thead><tr><th>Société</th><th className="num">Cours</th><th className="num">Capi.</th><th className="num">PER</th><th className="num">EV/EBITDA</th><th className="num">P/B</th><th className="num">P/S</th>
          <th className="num">Marge op.</th><th className="num">Marge nette</th><th className="num">ROE</th><th className="num">ROIC</th><th className="num">Croiss. CA</th><th className="num">DN/EBITDA</th><th className="num">Rdt FCF</th></tr></thead>
          <tbody>{comps.data.map((c) => c.error ? <tr key={c.symbol}><td>{c.symbol}</td><td colSpan={13} className="text-down">{c.error}</td></tr> : (
            <tr key={c.symbol} className={c.symbol === s.toUpperCase() ? "bg-raised" : ""}><td><Link href={`/fa?s=${c.symbol}`} className="text-amber">{c.symbol}</Link> <span className="text-dim">{c.currency}</span></td>
              <td className="num">{price(c.price)}</td><td className="num">{big(c.MarketCap)}</td><td className="num">{fmt(c.PeRatio, "x")}</td><td className="num">{fmt(c.EnterprisesValueEBITDARatio, "x")}</td>
              <td className="num">{fmt(c.PbRatio, "x")}</td><td className="num">{fmt(c.PsRatio, "x")}</td><td className="num">{fmt(c.operating_margin, "pct")}</td><td className="num">{fmt(c.net_margin, "pct")}</td>
              <td className="num">{fmt(c.roe, "pct")}</td><td className="num">{fmt(c.roic, "pct")}</td><td className={`num ${tone(c.revenue_growth)}`}>{fmt(c.revenue_growth, "pct")}</td><td className="num">{fmt(c.net_debt_ebitda, "x")}</td><td className="num">{fmt(c.fcf_yield, "pct")}</td></tr>))}
            {comps.data.filter((c) => !c.error).length > 2 && (() => { const med = (k: string) => { const v = comps.data!.map((c) => c[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
              return <tr className="border-t border-amber"><td className="text-amber">Médiane</td><td /><td /><td className="num">{fmt(med("PeRatio"), "x")}</td><td className="num">{fmt(med("EnterprisesValueEBITDARatio"), "x")}</td><td className="num">{fmt(med("PbRatio"), "x")}</td>
                <td className="num">{fmt(med("PsRatio"), "x")}</td><td className="num">{fmt(med("operating_margin"), "pct")}</td><td className="num">{fmt(med("net_margin"), "pct")}</td><td className="num">{fmt(med("roe"), "pct")}</td><td className="num">{fmt(med("roic"), "pct")}</td>
                <td className="num">{fmt(med("revenue_growth"), "pct")}</td><td className="num">{fmt(med("net_debt_ebitda"), "x")}</td><td className="num">{fmt(med("fcf_yield"), "pct")}</td></tr>; })()}</tbody></table>}
      </Panel>}
    </div>
  );
}
