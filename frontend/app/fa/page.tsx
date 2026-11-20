"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import Export from "@/components/Export";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, num, pct, price, tone } from "@/lib/format";

type Table = { dates: string[]; rows: Record<string, (number | null)[]> };
type FA = { symbol: string; currency: string; sector?: string; annual: { income: Table; balance: Table; cashflow: Table }; quarterly: { income: Table; balance: Table; cashflow: Table };
  valuation: Record<string, number | null>; valuation_date: string | null; ttm: Record<string, number | null>; ratios: Record<string, number | null> };
type Comp = Record<string, any>;
const PEERS: Record<string, string> = { AAPL: "MSFT,GOOGL,AMZN,META", MSFT: "AAPL,GOOGL,ORCL,CRM", "MC.PA": "RMS.PA,KER.PA,CFR.SW,OR.PA" };
type SecFA = { symbol: string; currency: string; entity: string; income: Table; balance: Table; cashflow: Table; derived: string[]; tags: Record<string, string[]>; ratios: Record<string, (number | null)[]> };
/** Métriques proposées pour le nuage de points des comparables : [clé, libellé, unité]. */
const SCATTER: [string, string, "pct" | "x"][] = [["revenue_growth", "Croissance du CA", "pct"], ["EnterprisesValueEBITDARatio", "EV/EBITDA", "x"], ["PeRatio", "PER", "x"],
  ["PsRatio", "Price-to-Sales", "x"], ["PbRatio", "Price-to-Book", "x"], ["operating_margin", "Marge opérationnelle", "pct"], ["net_margin", "Marge nette", "pct"],
  ["roe", "ROE", "pct"], ["roic", "ROIC", "pct"], ["fcf_yield", "Rendement du FCF", "pct"], ["net_debt_ebitda", "Dette nette / EBITDA", "x"]];

/** Moindres carrés y = a + b·x ; null sous trois points. */
function ols(pts: [number, number][]) {
  if (pts.length < 3) return null;
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (!sxx) return null;
  const b = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx, a = my - b * mx;
  const ssr = pts.reduce((s, p) => s + (p[1] - a - b * p[0]) ** 2, 0), sst = pts.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  return { a, b, r2: sst ? 1 - ssr / sst : 0 };
}

function CompsScatter({ rows, self }: { rows: Comp[]; self: string }) {
  const [xk, setXk] = useState("revenue_growth"), [yk, setYk] = useState("EnterprisesValueEBITDARatio");
  const lx = SCATTER.find((m) => m[0] === xk)!, ly = SCATTER.find((m) => m[0] === yk)!;
  const ok = rows.filter((c) => !c.error && c[xk] != null && c[yk] != null && Number.isFinite(c[xk]) && Number.isFinite(c[yk]));
  const peersOnly = ok.filter((c) => c.symbol !== self);
  const fit = ols((peersOnly.length >= 3 ? peersOnly : ok).map((c) => [c[xk], c[yk]])); // la société étudiée est exclue de l'estimation
  const caps = ok.map((c) => c.MarketCap ?? 0), cmax = Math.max(1, ...caps);
  const u = (m: typeof lx, v: number) => (m[2] === "pct" ? `${num(v, 1)} %` : `${num(v, 2)}x`);
  const xs = ok.map((c) => c[xk] as number), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const option = {
    grid: { left: 8, right: 16, top: 16, bottom: 28, containLabel: true },
    tooltip: { backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, formatter: (p: any) => {
      if (p.seriesType !== "scatter") return "";
      const c = ok[p.dataIndex], res = fit ? c[yk] - (fit.a + fit.b * c[xk]) : null;
      return `<b>${c.symbol}</b> · capi. ${big(c.MarketCap)}<br/>${lx[1]} ${u(lx, c[xk])}<br/>${ly[1]} ${u(ly, c[yk])}${res == null ? "" : `<br/>écart à la droite : ${res >= 0 ? "+" : ""}${u(ly, res)}`}`;
    } },
    xAxis: { type: "value", scale: true, name: lx[1], nameLocation: "middle", nameGap: 22, nameTextStyle: { color: "#7486a0" }, axisLabel: { color: "#7486a0", fontSize: 10 }, splitLine: { lineStyle: { color: "#0e1828" } } },
    yAxis: { type: "value", scale: true, name: ly[1], nameTextStyle: { color: "#7486a0" }, axisLabel: { color: "#7486a0", fontSize: 10 }, splitLine: { lineStyle: { color: "#0e1828" } } },
    series: [
      { type: "scatter", data: ok.map((c) => [c[xk], c[yk]]), symbolSize: (_: any, p: any) => 10 + 30 * Math.sqrt((caps[p.dataIndex] || 0) / cmax),
        itemStyle: { color: (p: any) => (ok[p.dataIndex].symbol === self ? "#ffa028" : "#4aa8ff"), opacity: 0.85 },
        label: { show: true, position: "right", color: "#d4dbe6", fontSize: 10, formatter: (p: any) => ok[p.dataIndex].symbol } },
      ...(fit && x1 > x0 ? [{ type: "line", data: [[x0, fit.a + fit.b * x0], [x1, fit.a + fit.b * x1]], showSymbol: false, silent: true, lineStyle: { color: "#7486a0", type: "dashed", width: 1 } }] : []),
    ],
  };
  const sel = (v: string, set: (v: string) => void) => <select value={v} onChange={(e) => set(e.target.value)}>{SCATTER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-2 pt-1 text-dim">Axe horizontal {sel(xk, setXk)} · vertical {sel(yk, setYk)}
        {fit && <span>· droite des pairs : R² {num(fit.r2, 2)}</span>}</div>
      {ok.length < 2 ? <div className="p-2 text-dim">Pas assez de sociétés avec ces deux métriques.</div> : <EChart className="h-80 w-full" option={option} />}
      <div className="px-2 pb-1 text-[10px] text-dim">Taille des bulles : capitalisation. Droite en pointillé : régression des pairs, hors société étudiée (orange) ; au-dessus, la société se paie plus cher que ses pairs à métrique égale (si l&apos;axe vertical est un multiple). Avec peu de sociétés, la droite reste indicative.</div>
    </div>
  );
}

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

const TIP = { trigger: "axis", backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, axisPointer: { type: "shadow" } };
const AX = { axisLine: { lineStyle: { color: "#1c2b42" } }, axisLabel: { color: "#7486a0", fontSize: 10 }, splitLine: { lineStyle: { color: "#0e1828" } } };

/** Un petit graphique en barres par poste : le formateur dépend de la nature du poste. */
function StatementCharts({ t, currency, income }: { t: Table; currency: string; income: boolean }) {
  if (!t.dates.length) return <div className="p-2 text-dim">Non publié.</div>;
  const rows = Object.entries(t.rows).filter(([, v]) => v.some((x) => x != null));
  const f = (k: string) => (x: number | null) => x == null ? "–" : k === "TaxRateForCalcs" ? `${num(x * 100, 1)} %` : k === "DilutedEPS" ? num(x, 2) : big(x);
  const margins = income ? ([["GrossProfit", "Marge brute"], ["OperatingIncome", "Marge opérationnelle"], ["EBITDA", "Marge d'EBITDA"], ["NetIncome", "Marge nette"]] as const)
    .filter(([k]) => t.rows[k] && t.rows.TotalRevenue)
    .map(([k, name]) => ({ name, data: t.rows[k].map((x, i) => { const r = t.rows.TotalRevenue[i]; return x != null && r ? (x / r) * 100 : null; }) })) : [];
  return (
    <div className="grid grid-cols-1 gap-1 p-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {margins.length > 0 && <div className="border border-line sm:col-span-2">
        <div className="px-2 pt-1 text-dim">Marges (% du chiffre d&apos;affaires)</div>
        <EChart className="h-44 w-full" option={{
          grid: { left: 8, right: 12, top: 26, bottom: 6, containLabel: true },
          legend: { top: 0, right: 8, textStyle: { color: "#d4dbe6", fontSize: 10 }, itemWidth: 12, itemHeight: 2, icon: "rect" },
          tooltip: { ...TIP, axisPointer: { lineStyle: { color: "#4d5d75" } }, valueFormatter: (v: number) => v == null ? "–" : `${num(v, 1)} %` },
          xAxis: { type: "category", data: t.dates, ...AX, splitLine: { show: false } },
          yAxis: { type: "value", ...AX, axisLabel: { ...AX.axisLabel, formatter: (v: number) => `${v} %` } },
          series: margins.map((m) => ({ name: m.name, type: "line", data: m.data, connectNulls: true, symbolSize: 4, lineStyle: { width: 1.5 } })),
        }} />
      </div>}
      {rows.map(([k, v]) => {
        const a = v.at(-1), b = v.at(-2), chg = a != null && b ? (a / b - 1) * 100 * Math.sign(b) : null;
        return (
          <div key={k} className="border border-line">
            <div className="flex items-baseline justify-between gap-2 px-2 pt-1">
              <span className="truncate text-dim">{LABELS[k] ?? k}</span>
              <span className="whitespace-nowrap"><span className="text-fg">{f(k)(a ?? null)}</span> <span className={tone(chg)}>{chg == null ? "" : pct(chg)}</span></span>
            </div>
            <EChart className="h-36 w-full" option={{
              grid: { left: 8, right: 8, top: 10, bottom: 4, containLabel: true },
              tooltip: { ...TIP, valueFormatter: f(k) },
              xAxis: { type: "category", data: t.dates, ...AX, splitLine: { show: false } },
              yAxis: { type: "value", ...AX, axisLabel: { ...AX.axisLabel, formatter: (x: number) => f(k)(x) } },
              series: [{ name: `${LABELS[k] ?? k}${k === "TaxRateForCalcs" ? "" : ` (${currency})`}`, type: "bar", barMaxWidth: 28,
                data: v.map((x) => ({ value: x, itemStyle: { color: x != null && x < 0 ? "#ff4d4d" : "#ffa028" } })) }],
            }} />
          </div>
        );
      })}
    </div>
  );
}

export default function FAPage() {
  const router = useRouter();
  const s = useSearchParams().get("s");
  const [input, setInput] = useState(s ?? "");
  useEffect(() => setInput(s ?? ""), [s]);
  const fa = useApi<FA>(s ? `/api/equities/fa?symbol=${encodeURIComponent(s)}` : null);
  const q = useApi<{ symbol: string; price?: number; change_pct?: number; name?: string }[]>(s ? `/api/market/quotes?symbols=${encodeURIComponent(s)}` : null, 60_000);
  const [period, setPeriod] = useState<"annual" | "quarterly" | "long">("annual");
  const [st, setSt] = useState<"income" | "balance" | "cashflow">("income");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [peers, setPeers] = useState("");
  const [peerQ, setPeerQ] = useState("");
  useEffect(() => {
    // pairs par défaut, appliqués à la saisie et à la requête en même temps (sinon la requête lirait l'ancienne liste)
    const u = s?.toUpperCase() ?? "", def = u && PEERS[u] ? `${u},${PEERS[u]}` : u;
    setPeers(def); setPeerQ(def);
  }, [s]);
  const comps = useApi<Comp[]>(peerQ && peerQ.includes(",") ? `/api/equities/comps?symbols=${encodeURIComponent(peerQ)}` : null);
  const d = fa.data, quote = q.data?.[0];
  const sec = useApi<SecFA>(s && period === "long" ? `/api/equities/fa/sec?symbol=${encodeURIComponent(s)}` : null);
  const rh = period === "long" && sec.data && sec.data.symbol === s?.toUpperCase() ? sec.data : null;
  const tbl = period === "long" ? rh?.[st] : d?.[period][st];
  return (
    <div className="grid h-full auto-rows-max grid-cols-12 content-start gap-1 overflow-auto">
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
          <Seg value={view} options={[["chart", "Graphiques"], ["table", "Tableau"]]} onChange={setView} />
          <Seg value={period} options={[["annual", "Annuel"], ["quarterly", "Trimestriel"], ["long", "15 ans (SEC)"]]} onChange={setPeriod} />
          <Seg value={st} options={[["income", "Compte de résultat"], ["balance", "Bilan"], ["cashflow", "Flux de trésorerie"]]} onChange={setSt} />
          {tbl && <Export name={`${d.symbol}-${st}-${period}`} columns={["Poste", ...tbl.dates]} rows={Object.entries(tbl.rows).map(([k, v]) => [LABELS[k] ?? k, ...v])} source={period === "long" ? sec.env?.source : fa.env?.source} />}{period === "long" && <SourceTag env={sec.env} />}</>}>
          {period === "long" && <State loading={sec.loading && !tbl} error={sec.error} />}
          {tbl && (view === "chart" ? <StatementCharts t={tbl} currency={d.currency} income={st === "income"} />
            : <Statement t={tbl} title={{ income: "Compte de résultat", balance: "Bilan", cashflow: "Flux de trésorerie" }[st]} currency={d.currency} />)}
          {rh && <div className="px-2 pb-1 text-[10px] text-dim">{rh.entity} · 10-K déposés à la SEC (XBRL US-GAAP), dépôt le plus récent retenu en cas de retraitement. Recalculés : marge brute si absente, EBITDA (résultat opérationnel + amortissements), dette financière (hors loyers), dette nette, capitaux investis, FCF, taux d&apos;impôt.</div>}
        </Panel>
        {rh && <>
          <Panel className="col-span-12 lg:col-span-6" title={`Marges sur ${rh.income.dates.length} exercices (SEC)`}>
            <EChart className="h-64 w-full" option={lineOption([["gross_margin", "Marge brute"], ["operating_margin", "Marge opérationnelle"], ["net_margin", "Marge nette"], ["fcf_margin", "Marge de FCF"]]
              .map(([k, name]) => ({ name, data: rh.income.dates.map((dt, i) => [dt.slice(0, 4), rh.ratios[k][i]] as [string, number | null]) })), { category: rh.income.dates.map((dt) => dt.slice(0, 4)), unit: " %", decimals: 1 })} />
          </Panel>
          <Panel className="col-span-12 lg:col-span-6" title="Rentabilité du capital et croissance (SEC)">
            <EChart className="h-64 w-full" option={lineOption([["roe", "ROE"], ["roic", "ROIC"], ["revenue_growth", "Croissance du CA"]]
              .map(([k, name]) => ({ name, data: rh.income.dates.map((dt, i) => [dt.slice(0, 4), rh.ratios[k][i]] as [string, number | null]) })), { category: rh.income.dates.map((dt) => dt.slice(0, 4)), unit: " %", decimals: 1, zero: true })} />
            <div className="px-2 pb-1 text-[10px] text-dim">ROE et ROIC sur capitaux moyens de deux clôtures. Un ROE extrême signale des capitaux propres faibles (rachats d&apos;actions massifs), pas forcément une rentabilité exceptionnelle.</div>
          </Panel>
        </>}
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
        {comps.data && comps.data.filter((c) => !c.error).length >= 2 && <CompsScatter rows={comps.data} self={s.toUpperCase()} />}
      </Panel>}
    </div>
  );
}
