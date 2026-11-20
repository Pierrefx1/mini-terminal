"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import EChart from "@/components/EChart";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, num, pct, price } from "@/lib/format";
import * as Q from "@/lib/quant";

type FA = { symbol: string; currency: string; sector?: string; annual: { income: { dates: string[]; rows: Record<string, (number | null)[]> }; balance: { rows: Record<string, (number | null)[]> }; cashflow: { rows: Record<string, (number | null)[]> } };
  valuation: Record<string, number | null>; ttm: Record<string, number | null>; ratios: Record<string, number | null> };
type Hist = { candles: { time: number; close: number }[] };
type Quote = { symbol: string; price?: number; name?: string; error?: string };
type Comp = { symbol: string; error?: string; EnterprisesValueEBITDARatio?: number | null; PeRatio?: number | null };

/** Hypothèses, en millions de la devise et en % (sauf bêta, actions en millions, multiples en x). */
type In = { fcf0: number; netDebt: number; shares: number; g1: number; g2: number; years: number; tg: number;
  rf: number; beta: number; mrp: number; kd: number; tax: number; eqW: number; evEbitda: number; per: number; txMult: number; premium: number };
const D: In = { fcf0: 1000, netDebt: 0, shares: 100, g1: 8, g2: 4, years: 5, tg: 2.5, rf: 4.2, beta: 1, mrp: 5, kd: 5, tax: 21, eqW: NaN, evEbitda: 12, per: 20, txMult: 14, premium: 30 };
type Scen = "bear" | "base" | "bull";
const ADJ: Record<Scen, [number, number, number, number]> = { bear: [-3, -1, -0.5, 0.01], base: [0, 0, 0, 0], bull: [3, 1, 0.5, -0.005] }; // Δ croiss. an 1, an N, terminale (pts), Δ WACC
const SCEN_LABEL: Record<Scen, string> = { bear: "Pessimiste", base: "Central", bull: "Optimiste" };
const EXAMPLES = [["AAPL", "Apple"], ["MSFT", "Microsoft"], ["NVDA", "Nvidia"], ["MC.PA", "LVMH"], ["TTE.PA", "TotalEnergies"], ["ASML.AS", "ASML"]];

const last = (a?: (number | null)[]) => (a ?? []).filter((x): x is number => x != null).at(-1);
/** Année de la dernière valeur publiée d'une série annuelle (les dates suivent l'ordre des colonnes). */
const lastYear = (a: (number | null)[] | undefined, dates: string[]) => { const i = (a ?? []).findLastIndex((x) => x != null); return i >= 0 ? dates[i]?.slice(0, 4) ?? "" : ""; };
const r1 = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const up = (v: number | null | undefined, px?: number) => (v != null && px ? v / px - 1 : null);
const C = { up: "#1fd15f", down: "#ff4d4d", amber: "#ffa028", info: "#4aa8ff", dim: "#7486a0", fg: "#d4dbe6", line: "#1c2b42" };

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
    return ra.length > 20 ? { beta: cov / v, n: ra.length } : null;
  }, [a.data, b.data]);
}

/** Champ d'hypothèse : curseur + saisie, aide au survol, origine de la valeur, retour à la valeur préremplie. */
function Field({ label, help, value, onChange, min, max, step, suffix, origin, initial }: {
  label: string; help: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string; origin?: string; initial?: number;
}) {
  const dec = step >= 1 ? 0 : (String(step).split(".")[1]?.length ?? 2);
  const shown = Number.isFinite(value) ? Number(value.toFixed(dec)) : "";
  const changed = initial != null && Number.isFinite(initial) && Math.abs(value - initial) > step / 2;
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5">
        <span className="text-fg">{label}</span>
        <span className="cursor-help text-[10px] text-dim" title={help}>ⓘ</span>
        {changed
          ? <button onClick={() => onChange(initial!)} className="ml-auto text-[9px] text-amber hover:underline" title={`Revenir à ${num(initial!, 2)}${suffix ?? ""}`}>● modifié ↺</button>
          : origin && <span className="ml-auto truncate text-[9px] text-dim" title={origin}>{origin}</span>}
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min}
          onChange={(e) => onChange(Number(e.target.value))} className="h-1 min-w-0 flex-1 cursor-pointer accent-[#ffa028]" aria-label={label} />
        <span className="flex shrink-0 items-center">
          <input type="number" step={step} value={shown} onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))}
            className="w-24 text-right" aria-label={`${label} (saisie)`} />
          <span className="w-6 pl-1 text-dim">{suffix}</span>
        </span>
      </div>
    </div>
  );
}

function Line({ label, value, cls = "text-fg", help, strong }: { label: string; value: React.ReactNode; cls?: string; help?: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-2 border-b border-line/50 py-[3px] ${strong ? "text-[12px]" : ""}`} title={help}><span className="text-dim">{label}</span><span className={`num ${cls}`}>{value}</span></div>;
}

function Step({ n, title, children, className = "" }: { n: number; title: string; children: React.ReactNode; className?: string }) {
  return (
    <Panel className={className} title={<span className="flex items-center gap-2"><span className="grid h-4 w-4 place-items-center rounded-full bg-amber text-[10px] font-bold text-black">{n}</span>{title}</span>}>
      <div className="px-2 pb-2 pt-1">{children}</div>
    </Panel>
  );
}

export default function Valuation() {
  const router = useRouter();
  const s = useSearchParams().get("s");
  const [input, setInput] = useState(s ?? "");
  useEffect(() => setInput(s ?? ""), [s]);
  const go = (sym: string) => { const t = sym.trim().toUpperCase(); if (t) router.push(`/dcf?s=${encodeURIComponent(t)}`); };

  const fa = useApi<FA>(s ? `/api/equities/fa?symbol=${encodeURIComponent(s)}` : null);
  const q = useApi<Quote[]>(s ? `/api/market/quotes?symbols=${encodeURIComponent(`${s},^TNX`)}` : null, 60_000);
  const est = useBeta(s);
  const quote = q.data?.find((x) => x.symbol?.toUpperCase() === s?.toUpperCase()) ?? q.data?.[0];
  const px = quote?.price;
  const tnx = q.data?.find((x) => x.symbol === "^TNX")?.price;
  const d = fa.data;
  const cur = d?.currency ?? "";

  // Valeurs préremplies depuis les données publiées, avec leur origine
  const pre = useMemo(() => {
    const v: Partial<In> = {}, o: Partial<Record<keyof In, string>> = {};
    if (!d) return { v, o };
    const M = 1e6, dates = d.annual.income.dates;
    const fcfA = last(d.annual.cashflow.rows.FreeCashFlow), fcf = fcfA ?? d.ttm.FreeCashFlow;
    if (fcf != null) { v.fcf0 = Math.round(fcf / M); o.fcf0 = fcfA != null ? `comptes ${lastYear(d.annual.cashflow.rows.FreeCashFlow, dates)}` : "12 derniers mois"; }
    const year = lastYear(d.annual.balance.rows.TotalDebt ?? d.annual.balance.rows.OrdinarySharesNumber, dates);
    const debt = last(d.annual.balance.rows.TotalDebt) ?? 0, cash = last(d.annual.balance.rows.CashCashEquivalentsAndShortTermInvestments) ?? 0;
    v.netDebt = Math.round((debt - cash) / M); o.netDebt = `bilan ${year}`;
    const sh = last(d.annual.balance.rows.OrdinarySharesNumber) ?? last(d.annual.income.rows.DilutedAverageShares);
    if (sh) { v.shares = Math.round(sh / M * 100) / 100; o.shares = `bilan ${year}`; }
    if (d.ratios.revenue_growth != null) { v.g1 = r1(Math.min(Math.max(d.ratios.revenue_growth, -5), 25)); o.g1 = `croissance du CA ${lastYear(d.annual.income.rows.TotalRevenue, dates)}`; }
    if (d.ratios.tax_rate != null) { v.tax = r1(d.ratios.tax_rate); o.tax = "taux effectif publié"; }
    const ie = last(d.annual.income.rows.InterestExpense);
    if (ie && debt) { v.kd = r1(Math.abs(ie) / debt * 100); o.kd = "charges d'intérêts / dette"; }
    if (est) { v.beta = Math.round(est.beta * 100) / 100; o.beta = `${est.n} semaines vs S&P 500`; }
    if (tnx != null && cur === "USD") { v.rf = r1(tnx, 2); o.rf = "taux US 10 ans"; }
    o.g2 = "hypothèse"; o.tg = "≈ inflation long terme"; o.mrp = "hypothèse usuelle"; o.years = "hypothèse";
    return { v, o };
  }, [d, est, tnx, cur]);

  const [x, setX] = useState<In>(D);
  const [scen, setScen] = useState<Scen>("base");
  const [heat, setHeat] = useState<"value" | "upside">("upside");
  useEffect(() => { setX({ ...D, ...pre.v }); }, [pre]);
  const set = <K extends keyof In>(k: K) => (v: In[K]) => setX((p) => ({ ...p, [k]: v }));
  const initial = { ...D, ...pre.v };

  // Pairs : médianes des multiples, appliquées automatiquement à l'arrivée des données
  const [peersText, setPeersText] = useState("");
  const [peers, setPeers] = useState("");
  const comps = useApi<Comp[]>(peers ? `/api/equities/comps?symbols=${encodeURIComponent(peers)}` : null);
  const peerStats = useMemo(() => {
    const ok = (comps.data ?? []).filter((c) => !c.error);
    const ev = ok.map((c) => c.EnterprisesValueEBITDARatio).filter((v): v is number => v != null && v > 0 && v < 200);
    const pe = ok.map((c) => c.PeRatio).filter((v): v is number => v != null && v > 0 && v < 300);
    const q = (a: number[], p: number) => { const v = [...a].sort((m, n) => m - n); if (!v.length) return null; const i = (v.length - 1) * p, lo = Math.floor(i); return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo); };
    return { n: ok.length, ev: Q.median(ev), pe: Q.median(pe), evR: [q(ev, 0.25), q(ev, 0.75)], peR: [q(pe, 0.25), q(pe, 0.75)], ok };
  }, [comps.data]);
  useEffect(() => {
    if (peerStats.ev != null) setX((p) => ({ ...p, evEbitda: r1(peerStats.ev!) }));
    if (peerStats.pe != null) setX((p) => ({ ...p, per: r1(peerStats.pe!) }));
  }, [peerStats.ev, peerStats.pe]);

  // ── Calculs ──
  const mcap = (px ?? 0) * x.shares;
  const autoW = mcap + Math.max(x.netDebt, 0) > 0 ? mcap / (mcap + Math.max(x.netDebt, 0)) * 100 : 100;
  const we = Number.isNaN(x.eqW) ? autoW : x.eqW;
  const ke = Q.capm(x.rf / 100, x.beta, x.mrp / 100);
  const w = Q.wacc(we, 100 - we, ke, x.kd / 100, x.tax / 100);
  const growth = (a: number, b: number) => Array.from({ length: x.years }, (_, i) => (a + (b - a) * (x.years > 1 ? i / (x.years - 1) : 0)) / 100);
  const run = (wacc: number, gT: number, ga: number, gb: number) => { try { return Q.dcf({ fcf: Q.projectFcf(x.fcf0, growth(ga, gb)), wacc, terminalGrowth: gT, netDebt: x.netDebt, shares: x.shares }); } catch { return null; } };
  const runScen = (k: Scen) => { const a = ADJ[k]; return run(w + a[3], (x.tg + a[2]) / 100, x.g1 + a[0], x.g2 + a[1]); };
  const scens = { bear: runScen("bear"), base: runScen("base"), bull: runScen("bull") };
  const res = scens[scen];
  const a = ADJ[scen];
  const wS = w + a[3];
  const flows = Q.projectFcf(x.fcf0, growth(x.g1 + a[0], x.g2 + a[1]));
  const waccs = [-1, -0.5, 0, 0.5, 1].map((dd) => wS + dd / 100), tgs = [-1, -0.5, 0, 0.5, 1].map((dd) => (x.tg + a[2]) / 100 + dd / 100);
  const grid = waccs.map((wc) => tgs.map((g) => run(wc, g, x.g1 + a[0], x.g2 + a[1])?.perShare ?? null));
  const gridVals = grid.flat().filter((v): v is number => v != null);
  const implied = px != null ? Q.impliedGrowth(px, { fcf0: x.fcf0, years: x.years, wacc: w, terminalGrowth: x.tg / 100, netDebt: x.netDebt, shares: x.shares }) : null;

  const ebitda = (d?.ttm.EBITDA ?? 0) / 1e6, eps = d?.ttm.DilutedEPS ?? NaN;
  const perShareEv = (m: number | null) => (m != null && ebitda > 0 ? (m * ebitda - x.netDebt) / x.shares : null);
  const perSharePe = (m: number | null) => (m != null && Number.isFinite(eps) && eps > 0 ? m * eps : null);
  const vEv = perShareEv(x.evEbitda), vPe = perSharePe(x.per), vTx = perShareEv(x.txMult);

  const upside = up(res?.perShare, px);
  const verdict = upside == null ? null : upside > 0.15 ? { t: "Sous-évalué", c: C.up } : upside < -0.15 ? { t: "Surévalué", c: C.down } : { t: "Proche de la juste valeur", c: C.amber };

  const warnings: string[] = [];
  if (d && x.fcf0 <= 0) warnings.push("FCF de départ négatif ou nul : le DCF n'est pas pertinent, privilégier les multiples.");
  if (res && res.tvShare > 0.75) warnings.push(`La valeur terminale pèse ${num(res.tvShare * 100, 0)} % de la valeur d'entreprise : résultat très sensible au WACC et à la croissance terminale.`);
  if (w - x.tg / 100 < 0.025 && w > x.tg / 100) warnings.push("Écart WACC − croissance terminale inférieur à 2,5 points : la valeur terminale s'envole.");
  if (x.tg > 3.5) warnings.push("Croissance terminale au-dessus de 3,5 % : supérieure à la croissance nominale de long terme de la plupart des économies.");
  if (x.g1 > 20) warnings.push("Croissance de l'année 1 supérieure à 20 % : à justifier.");
  if (d && cur !== "USD") warnings.push(`Société cotée en ${cur} : ajuster le taux sans risque au taux souverain 10 ans de la devise (prérempli à ${num(D.rf, 1)} %).`);

  // ── Graphiques ──
  const football = useMemo(() => {
    const rows: { name: string; lo: number; hi: number; mid?: number; color: string; note: string }[] = [];
    const add = (name: string, lo: number | null | undefined, hi: number | null | undefined, color: string, note: string, mid?: number | null) => {
      if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
      rows.push({ name, lo: Math.min(lo, hi), hi: Math.max(lo, hi), mid: mid ?? undefined, color, note });
    };
    add("DCF · scénarios", scens.bear?.perShare, scens.bull?.perShare, C.amber, "pessimiste → optimiste", scens.base?.perShare);
    add("DCF · sensibilité", gridVals.length ? Math.min(...gridVals) : null, gridVals.length ? Math.max(...gridVals) : null, "#c9852a", "WACC ±1 pt × croissance terminale ±1 pt");
    const evLo = peerStats.evR[0] ?? x.evEbitda - 2, evHi = peerStats.evR[1] ?? x.evEbitda + 2;
    add("VE/EBITDA · pairs", perShareEv(evLo), perShareEv(evHi), C.info, peerStats.ev != null ? `quartiles des pairs (${num(evLo, 1)}x – ${num(evHi, 1)}x)` : `${num(evLo, 1)}x – ${num(evHi, 1)}x (multiple saisi ±2x)`, vEv);
    const peLo = peerStats.peR[0] ?? x.per - 4, peHi = peerStats.peR[1] ?? x.per + 4;
    add("PER · pairs", perSharePe(peLo), perSharePe(peHi), "#7fb8ff", peerStats.pe != null ? `quartiles des pairs (${num(peLo, 1)}x – ${num(peHi, 1)}x)` : `${num(peLo, 1)}x – ${num(peHi, 1)}x (multiple saisi ±4x)`, vPe);
    add("Transactions", perShareEv(x.txMult - 2), perShareEv(x.txMult + 2), "#c77dff", `VE/EBITDA payé ${num(x.txMult - 2, 1)}x – ${num(x.txMult + 2, 1)}x`, vTx);
    if (px != null) add("Offre avec prime", px, px * (1 + x.premium / 100), "#9aa0a6", `cours → cours + ${num(x.premium, 0)} % de prime`);
    const all = rows.flatMap((r) => [r.lo, r.hi]).concat(px != null ? [px] : []);
    const pad = all.length ? (Math.max(...all) - Math.min(...all)) * 0.08 : 0;
    return rows.length ? {
      grid: { left: 118, right: 70, top: 22, bottom: 22 },
      tooltip: { trigger: "item", backgroundColor: "#0e1828", borderColor: C.line, textStyle: { color: C.fg, fontSize: 11 },
        formatter: (p: any) => { const r = rows[p.dataIndex]; return `<b>${r.name}</b><br/>${num(r.lo, 2)} – ${num(r.hi, 2)} ${cur}${r.mid != null ? `<br/>point central ${num(r.mid, 2)}` : ""}<br/><span style="color:${C.dim}">${r.note}</span>`; } },
      xAxis: { type: "value", min: Math.floor(Math.max(0, Math.min(...all) - pad) / 10) * 10, max: Math.ceil((Math.max(...all) + pad) / 10) * 10, axisLabel: { color: C.dim, fontSize: 10, formatter: (v: number) => num(v, 0) }, splitLine: { lineStyle: { color: "#0e1828" } } },
      yAxis: { type: "category", inverse: true, data: rows.map((r) => r.name), axisLabel: { color: C.fg, fontSize: 10 }, axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false } },
      series: [
        { type: "bar", stack: "r", data: rows.map((r) => r.lo), itemStyle: { color: "transparent" }, silent: true, barWidth: 14 },
        { type: "bar", stack: "r", data: rows.map((r) => ({ value: r.hi - r.lo, itemStyle: { color: r.color, opacity: 0.85 } })), barWidth: 14,
          label: { show: true, position: "right", color: C.dim, fontSize: 9, formatter: (p: any) => `${num(rows[p.dataIndex].lo, 0)} – ${num(rows[p.dataIndex].hi, 0)}` },
          markLine: px != null ? { symbol: "none", silent: true, lineStyle: { color: C.fg, type: "dashed", width: 1 }, label: { formatter: `cours ${num(px, 2)}`, color: C.fg, fontSize: 10, position: "start", distance: 2 }, data: [{ xAxis: px }] } : undefined },
        { type: "scatter", data: rows.map((r, i) => (r.mid != null ? [r.mid, i] : null)).filter(Boolean), symbol: "rect", symbolSize: [2, 18], itemStyle: { color: "#fff" }, silent: true, z: 5 },
      ],
    } : null;
  }, [scens.bear?.perShare, scens.base?.perShare, scens.bull?.perShare, gridVals.join(","), peerStats, x, px, ebitda, eps, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  const fcfChart = useMemo(() => {
    if (!d) return null;
    const hist = d.annual.cashflow.rows.FreeCashFlow ?? [];
    const years = d.annual.income.dates.map((t) => t.slice(0, 4));
    const base = Number(years.at(-1) ?? new Date().getFullYear());
    const cats = [...years, ...flows.map((_, i) => `${base + i + 1}e`)];
    const nH = years.length;
    return {
      grid: { left: 8, right: 10, top: 26, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.fg, fontSize: 10 }, itemWidth: 10, itemHeight: 8 },
      tooltip: { trigger: "axis", backgroundColor: "#0e1828", borderColor: C.line, textStyle: { color: C.fg, fontSize: 11 }, valueFormatter: (v: number) => (v == null ? "–" : `${big(v * 1e6)}`) },
      xAxis: { type: "category", data: cats, axisLabel: { color: C.dim, fontSize: 10 }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: "value", axisLabel: { color: C.dim, fontSize: 10, formatter: (v: number) => big(v * 1e6) }, splitLine: { lineStyle: { color: "#0e1828" } } },
      series: [
        { name: "FCF publié", type: "bar", data: [...hist.map((v) => (v == null ? null : v / 1e6)), ...flows.map(() => null)], itemStyle: { color: "#4d5d75" }, barGap: "-100%", barWidth: "55%" },
        { name: `FCF projeté (${SCEN_LABEL[scen].toLowerCase()})`, type: "bar", data: [...Array(nH).fill(null), ...flows], itemStyle: { color: C.amber }, barWidth: "55%" },
        { name: "Valeur actualisée", type: "line", data: [...Array(nH).fill(null), ...flows.map((f, i) => f / (1 + wS) ** (i + 1))], lineStyle: { color: C.info, width: 1.5 }, itemStyle: { color: C.info }, symbolSize: 5 },
      ],
    };
  }, [d, flows.join(","), wS, scen]); // eslint-disable-line react-hooks/exhaustive-deps

  const bridge = useMemo(() => {
    if (!res) return null;
    const steps = [
      { n: "Flux", full: "Valeur actuelle des flux explicites", v: res.pvFlows, base: 0, c: C.amber },
      { n: "+ Terminale", full: "Valeur terminale actualisée", v: res.pvTerminal, base: res.pvFlows, c: "#c9852a" },
      { n: "= VE", full: "Valeur d'entreprise", v: res.ev, base: 0, c: C.fg },
      { n: x.netDebt >= 0 ? "− Dette" : "+ Tréso.", full: x.netDebt >= 0 ? "Dette nette" : "Trésorerie nette", v: Math.abs(x.netDebt), base: x.netDebt >= 0 ? res.equity : res.ev, c: x.netDebt >= 0 ? C.down : C.up },
      { n: "= Fonds propres", full: "Valeur des fonds propres", v: res.equity, base: 0, c: C.info },
    ];
    return {
      grid: { left: 8, right: 10, top: 20, bottom: 4, containLabel: true },
      tooltip: { trigger: "item", backgroundColor: "#0e1828", borderColor: C.line, textStyle: { color: C.fg, fontSize: 11 }, formatter: (p: any) => p.seriesIndex ? `${steps[p.dataIndex].full} : ${big(steps[p.dataIndex].v * 1e6)} ${cur}` : "" },
      xAxis: { type: "category", data: steps.map((t) => t.n), axisLabel: { color: C.dim, fontSize: 9, interval: 0 }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: "value", axisLabel: { color: C.dim, fontSize: 10, formatter: (v: number) => big(v * 1e6) }, splitLine: { lineStyle: { color: "#0e1828" } } },
      series: [
        { type: "bar", stack: "b", data: steps.map((t) => t.base), itemStyle: { color: "transparent" }, silent: true },
        { type: "bar", stack: "b", data: steps.map((t) => ({ value: t.v, itemStyle: { color: t.c } })), barWidth: "50%",
          label: { show: true, position: "top", color: C.dim, fontSize: 9, formatter: (p: any) => big(steps[p.dataIndex].v * 1e6) } },
      ],
    };
  }, [res?.ev, res?.equity, x.netDebt, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  const cellBg = (v: number | null) => {
    if (v == null || !px) return undefined;
    const u = Math.max(-0.5, Math.min(0.5, v / px - 1));
    return u >= 0 ? `rgba(31,209,95,${0.08 + u * 0.7})` : `rgba(255,77,77,${0.08 - u * 0.7})`;
  };

  // ── Accueil sans symbole ──
  if (!s) return (
    <div className="grid h-full place-items-center overflow-auto p-4">
      <div className="w-full max-w-2xl border border-line bg-panel p-6">
        <div className="text-[11px] uppercase tracking-[0.2em] text-amber">Valorisation · DCF et multiples</div>
        <h1 className="mt-2 text-[18px] text-fg">Quelle est la valeur d&apos;une action ?</h1>
        <p className="mt-2 leading-relaxed text-dim">Saisissez un symbole : les hypothèses se préremplissent depuis les comptes publiés, puis vous les ajustez en direct.</p>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); go(input); }}>
          <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="AAPL, MC.PA, ASML.AS…" className="flex-1 px-2 py-1 text-[13px] uppercase" />
          <button className="border border-amber px-4 text-amber hover:bg-amber hover:text-black">Valoriser</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">{EXAMPLES.map(([sym, n]) => <button key={sym} onClick={() => go(sym)} className="border border-line px-2 py-0.5 text-dim hover:border-amber hover:text-amber">{n} <span className="text-[10px]">{sym}</span></button>)}</div>
        <ol className="mt-6 grid gap-3 sm:grid-cols-3">
          {[["Flux de trésorerie", "FCF de départ, croissance sur 5 ans, croissance à l'infini."], ["Coût du capital", "Rendement exigé (CAPM) et coût de la dette, pondérés : le WACC."],
            ["Verdict", "Valeur par action vs cours, fourchette de scénarios, comparaison aux multiples des pairs."]].map(([t, dd], i) => (
            <li key={t} className="border border-line p-2"><div className="flex items-center gap-2 text-fg"><span className="grid h-4 w-4 place-items-center rounded-full bg-amber text-[10px] font-bold text-black">{i + 1}</span>{t}</div><div className="mt-1 text-[10px] leading-relaxed text-dim">{dd}</div></li>))}
        </ol>
      </div>
    </div>
  );

  return (
    <div className="grid h-full auto-rows-max grid-cols-12 content-start gap-1 overflow-auto">
      {/* Barre */}
      <div className="col-span-12 flex flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-raised px-2 py-1">
        <span className="text-[11px] uppercase tracking-wider text-amber">Valorisation</span>
        <form onSubmit={(e) => { e.preventDefault(); go(input); }}><input value={input} onChange={(e) => setInput(e.target.value)} className="w-24 uppercase" aria-label="Symbole" /></form>
        {quote?.name && <span className="text-fg">{quote.name}</span>}
        {d?.sector && <span className="text-dim">{d.sector}</span>}
        {px != null && <span className="text-dim">cours <span className="text-fg">{price(px)} {cur}</span></span>}
        {d && <span className="text-dim">montants en millions de {cur}</span>}
        <button onClick={() => { setX({ ...D, ...pre.v }); setScen("base"); }} className="ml-auto border border-line px-2 text-dim hover:border-amber hover:text-amber" title="Revenir aux hypothèses préremplies">↺ Réinitialiser</button>
        <SourceTag env={fa.env} />
      </div>
      {(fa.error || (fa.loading && !d)) && <div className="col-span-12 border border-line bg-panel"><State loading={fa.loading && !d} error={fa.error} /></div>}

      {d && <>
        {/* Verdict */}
        <section className="col-span-12 grid border border-line bg-panel xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="border-b border-line p-3 xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-dim" title="Valeur intrinsèque issue du DCF">Valeur par action</span>
              <Seg value={scen} options={[["bear", "Pessimiste"], ["base", "Central"], ["bull", "Optimiste"]]} onChange={setScen} />
            </div>
            {res ? <>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="num text-[30px] leading-9 text-amber">{num(res.perShare, 2)}</span><span className="text-dim">{cur}</span>
                {upside != null && <span className="num text-[18px]" style={{ color: upside >= 0 ? C.up : C.down }}>{pct(upside * 100, 1)}</span>}
              </div>
              {verdict && <div className="mt-1 inline-block border px-2 py-0.5 text-[11px] font-bold tracking-wider" style={{ color: verdict.c, borderColor: verdict.c }}>{verdict.t.toUpperCase()}</div>}
              <div className="mt-2 space-y-0.5">
                {(["bear", "base", "bull"] as Scen[]).map((k) => { const r = scens[k], u = up(r?.perShare, px); return (
                  <button key={k} onClick={() => setScen(k)} className={`flex w-full justify-between px-1 ${k === scen ? "bg-raised" : "hover:bg-raised"}`}>
                    <span className={k === scen ? "text-fg" : "text-dim"}>{SCEN_LABEL[k]}</span>
                    <span className="num">{r ? num(r.perShare, 2) : "–"} <span className="inline-block w-16 text-right" style={{ color: u == null ? C.dim : u >= 0 ? C.up : C.down }}>{u == null ? "–" : pct(u * 100, 1)}</span></span>
                  </button>); })}
              </div>
              {implied != null && <div className="mt-2 border-t border-line pt-2 leading-relaxed text-dim">
                Le cours actuel suppose une croissance du FCF de <span className="num text-fg">{pct(implied * 100, 1).replace("+", "")}</span> par an pendant {x.years} ans
                {d.ratios.revenue_growth != null && <> (croissance récente du CA : <span className="num text-fg">{num(d.ratios.revenue_growth, 1)} %</span>)</>}.
              </div>}
            </> : <div className="mt-2 text-down">Le WACC doit dépasser la croissance terminale.</div>}
          </div>
          <div className="min-w-0 p-2">
            <div className="flex items-center justify-between px-1 text-[10px] uppercase tracking-wider text-dim"><span>Fourchettes de valeur par méthode ({cur} par action)</span><span className="normal-case tracking-normal">trait blanc : point central · tirets : cours</span></div>
            <div className="h-[220px]">{football && <EChart option={football} />}</div>
          </div>
        </section>

        {warnings.length > 0 && <div className="col-span-12 border border-amber/40 bg-amber/5 px-2 py-1">{warnings.map((m) => <div key={m} className="text-amber">⚠ {m}</div>)}</div>}

        {/* Étapes */}
        <Step n={1} title="Flux de trésorerie" className="col-span-12 md:col-span-6 xl:col-span-4">
          <Field label="FCF de départ" help="Free cash flow : flux de trésorerie d'exploitation moins investissements, dernière année publiée. Point de départ de la projection." value={x.fcf0} onChange={set("fcf0")} min={Math.min(-Math.abs(initial.fcf0), 0)} max={Math.max(Math.abs(initial.fcf0) * 3, 100)} step={Math.max(1, Math.round(Math.abs(initial.fcf0) / 200))} origin={pre.o.fcf0} initial={initial.fcf0} />
          <Field label="Croissance année 1" help="Croissance du FCF la première année. La croissance évolue ensuite linéairement jusqu'à celle de la dernière année explicite." value={x.g1} onChange={set("g1")} min={-20} max={40} step={0.5} suffix="%" origin={pre.o.g1} initial={initial.g1} />
          <Field label={`Croissance année ${x.years}`} help="Croissance du FCF la dernière année de projection explicite ; elle doit converger vers la croissance terminale." value={x.g2} onChange={set("g2")} min={-10} max={25} step={0.5} suffix="%" origin={pre.o.g2} initial={initial.g2} />
          <Field label="Années de projection" help="Nombre d'années projetées explicitement avant la valeur terminale." value={x.years} onChange={(v) => set("years")(Math.max(1, Math.min(15, Math.round(v))))} min={1} max={15} step={1} origin={pre.o.years} initial={initial.years} />
          <Field label="Croissance terminale" help="Croissance perpétuelle après la projection (modèle de Gordon-Shapiro). Généralement entre 1,5 et 3 % : ne peut durablement dépasser la croissance de l'économie." value={x.tg} onChange={set("tg")} min={0} max={5} step={0.1} suffix="%" origin={pre.o.tg} initial={initial.tg} />
          <div className="mt-1 grid grid-cols-2 gap-x-3">
            <Field label="Dette nette" help="Dette financière moins trésorerie. Négative = trésorerie nette, ajoutée à la valeur des fonds propres." value={x.netDebt} onChange={set("netDebt")} min={-Math.max(Math.abs(initial.netDebt) * 3, 1000)} max={Math.max(Math.abs(initial.netDebt) * 3, 1000)} step={10} origin={pre.o.netDebt} initial={initial.netDebt} />
            <Field label="Actions (M)" help="Nombre d'actions en circulation, en millions." value={x.shares} onChange={set("shares")} min={0} max={Math.max(initial.shares * 2, 1)} step={0.01} origin={pre.o.shares} initial={initial.shares} />
          </div>
        </Step>

        <Step n={2} title="Coût du capital" className="col-span-12 md:col-span-6 xl:col-span-4">
          <Field label="Taux sans risque" help="Rendement de l'obligation d'État à 10 ans dans la devise de la société." value={x.rf} onChange={set("rf")} min={0} max={10} step={0.05} suffix="%" origin={pre.o.rf} initial={initial.rf} />
          <Field label="Bêta" help="Sensibilité de l'action au marché : 1 = comme le marché, > 1 plus volatile. Estimé par régression des rendements hebdomadaires sur 5 ans." value={x.beta} onChange={set("beta")} min={0} max={3} step={0.05} origin={pre.o.beta} initial={initial.beta} />
          <Field label="Prime de risque du marché" help="Rendement supplémentaire exigé pour détenir des actions plutôt que l'actif sans risque. Usuellement 4,5 à 6 %." value={x.mrp} onChange={set("mrp")} min={2} max={10} step={0.25} suffix="%" origin={pre.o.mrp} initial={initial.mrp} />
          <Field label="Coût de la dette (avant impôt)" help="Taux d'intérêt moyen payé sur la dette." value={x.kd} onChange={set("kd")} min={0} max={15} step={0.1} suffix="%" origin={pre.o.kd} initial={initial.kd} />
          <Field label="Taux d'impôt" help="Les intérêts étant déductibles, le coût de la dette est réduit de l'impôt." value={x.tax} onChange={set("tax")} min={0} max={40} step={0.5} suffix="%" origin={pre.o.tax} initial={initial.tax} />
          <Field label="Poids des fonds propres" help="Part des fonds propres dans le financement. Par défaut : capitalisation boursière / (capitalisation + dette nette)." value={we} onChange={set("eqW")} min={0} max={100} step={1} suffix="%" origin={Number.isNaN(x.eqW) ? "valeur de marché" : undefined} initial={autoW} />
          <div className="mt-2 border border-line p-2">
            <Line label="Coût des fonds propres" value={`${num(ke * 100, 2)} %`} help="CAPM : taux sans risque + bêta × prime de risque" />
            <div className="pb-1 text-[10px] text-dim">= {num(x.rf, 2)} % + {num(x.beta, 2)} × {num(x.mrp, 2)} %</div>
            <Line label="Coût de la dette après impôt" value={`${num(x.kd * (1 - x.tax / 100), 2)} %`} />
            <Line label="WACC" value={`${num(w * 100, 2)} %`} cls="text-amber" strong help="Coût moyen pondéré du capital : taux d'actualisation des flux" />
            <div className="text-[10px] text-dim">= {num(we, 0)} % × {num(ke * 100, 2)} % + {num(100 - we, 0)} % × {num(x.kd * (1 - x.tax / 100), 2)} %</div>
          </div>
        </Step>

        <Step n={3} title={`Résultat · scénario ${SCEN_LABEL[scen].toLowerCase()}`} className="col-span-12 xl:col-span-4">
          {res ? <>
            <div className="h-[170px]">{bridge && <EChart option={bridge} />}</div>
            <Line label="Valeur actuelle des flux explicites" value={big(res.pvFlows * 1e6)} />
            <Line label="Valeur terminale actualisée" value={big(res.pvTerminal * 1e6)} />
            <Line label="Part de la valeur terminale" value={`${num(res.tvShare * 100, 0)} %`} cls={res.tvShare > 0.75 ? "text-amber" : "text-fg"} />
            <Line label="Valeur d'entreprise" value={big(res.ev * 1e6)} />
            <Line label="Valeur des fonds propres" value={big(res.equity * 1e6)} />
            <Line label="Valeur par action" value={`${num(res.perShare, 2)} ${cur}`} cls="text-amber" strong />
            {ebitda > 0 && <Line label="VE / EBITDA implicite" value={`${num(res.ev / ebitda, 1)}x`} help="Multiple implicite du résultat, à comparer au multiple actuel et à celui des pairs" />}
            {d.valuation.EnterprisesValueEBITDARatio != null && <Line label="VE / EBITDA actuel (marché)" value={`${num(d.valuation.EnterprisesValueEBITDARatio, 1)}x`} cls="text-dim" />}
          </> : <div className="text-down">Le WACC doit dépasser la croissance terminale.</div>}
        </Step>

        {/* Graphiques */}
        <Panel className="col-span-12 lg:col-span-7" title="Flux de trésorerie disponibles : historique et projection">
          <div className="h-[240px] px-1">{fcfChart && <EChart option={fcfChart} />}</div>
        </Panel>

        <Panel className="col-span-12 lg:col-span-5" title="Sensibilité de la valeur par action"
          right={<Seg value={heat} options={[["upside", "vs cours"], ["value", "valeur"]]} onChange={setHeat} />}>
          <table>
            <thead><tr><th className="text-dim">WACC ↓ · g →</th>{tgs.map((g) => <th key={g} className="num">{num(g * 100, 1)} %</th>)}</tr></thead>
            <tbody>{waccs.map((wc, i) => <tr key={wc}><td className="text-dim">{num(wc * 100, 2)} %</td>{grid[i].map((v, j) => {
              const center = i === 2 && j === 2;
              return <td key={j} className={`num ${center ? "outline outline-1 outline-amber" : ""}`} style={{ background: cellBg(v) }}>
                {v == null ? "n/a" : heat === "value" ? num(v, 1) : px ? pct((v / px - 1) * 100, 0) : num(v, 1)}</td>;
            })}</tr>)}</tbody>
          </table>
          <div className="px-2 py-1 text-[10px] text-dim">Vert : au-dessus du cours · rouge : en dessous · encadré : hypothèses actuelles. n/a : WACC ≤ croissance terminale.</div>
        </Panel>

        {/* Multiples */}
        <Panel className="col-span-12" title="Valorisation par les multiples">
          <div className="grid gap-x-6 px-2 py-1 md:grid-cols-3">
            <div>
              <div className="pb-1 text-[10px] uppercase text-amber">Pairs (sociétés comparables)</div>
              <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); setPeers(peersText.split(/[\s,;]+/).filter(Boolean).map((t) => t.toUpperCase()).join(",")); }}>
                <input value={peersText} onChange={(e) => setPeersText(e.target.value)} placeholder="ex. MSFT GOOGL META" className="min-w-0 flex-1 uppercase" />
                <button className="border border-line px-2 text-dim hover:border-amber hover:text-amber">Calculer</button>
              </form>
              <State loading={comps.loading} error={comps.error} />
              {peerStats.ok.length > 0 && <table className="mt-1"><thead><tr><th>Pair</th><th className="num">VE/EBITDA</th><th className="num">PER</th></tr></thead>
                <tbody>{peerStats.ok.map((c) => <tr key={c.symbol}><td>{c.symbol}</td><td className="num">{c.EnterprisesValueEBITDARatio == null ? "–" : `${num(c.EnterprisesValueEBITDARatio, 1)}x`}</td><td className="num">{c.PeRatio == null ? "–" : `${num(c.PeRatio, 1)}x`}</td></tr>)}
                  <tr className="border-t border-amber text-amber"><td>Médiane</td><td className="num">{peerStats.ev == null ? "–" : `${num(peerStats.ev, 1)}x`}</td><td className="num">{peerStats.pe == null ? "–" : `${num(peerStats.pe, 1)}x`}</td></tr></tbody></table>}
              {!peers && <div className="py-1 text-[10px] text-dim">Les médianes des pairs remplacent automatiquement les multiples ci-contre.</div>}
            </div>
            <div>
              <div className="pb-1 text-[10px] uppercase text-amber">Comparables</div>
              <Field label="VE / EBITDA" help="Multiple de valeur d'entreprise sur EBITDA des pairs. Valeur par action = (multiple × EBITDA − dette nette) / actions." value={x.evEbitda} onChange={set("evEbitda")} min={2} max={60} step={0.5} suffix="x" origin={peerStats.ev != null ? `médiane de ${peerStats.n} pairs` : "à saisir ou calculer"} />
              <Line label="→ valeur par action" value={vEv == null ? "–" : `${num(vEv, 2)} ${cur}`} cls="text-fg" />
              <Field label="PER" help="Cours / bénéfice par action des pairs. Valeur par action = multiple × BPA sur 12 mois." value={x.per} onChange={set("per")} min={3} max={80} step={0.5} suffix="x" origin={peerStats.pe != null ? `médiane de ${peerStats.n} pairs` : "à saisir ou calculer"} />
              <Line label="→ valeur par action" value={vPe == null ? "–" : `${num(vPe, 2)} ${cur}`} cls="text-fg" />
              <div className="pt-1 text-[10px] text-dim">Société : VE/EBITDA {d.valuation.EnterprisesValueEBITDARatio == null ? "–" : `${num(d.valuation.EnterprisesValueEBITDARatio, 1)}x`} · PER {d.valuation.PeRatio == null ? "–" : `${num(d.valuation.PeRatio, 1)}x`} · EBITDA 12 mois {big(ebitda * 1e6)} · BPA {num(eps, 2)}</div>
            </div>
            <div>
              <div className="pb-1 text-[10px] uppercase text-amber">Transactions et prime de contrôle</div>
              <Field label="VE / EBITDA payé" help="Multiple payé lors d'acquisitions comparables (bases de transactions sous licence : à saisir)." value={x.txMult} onChange={set("txMult")} min={2} max={60} step={0.5} suffix="x" origin="à saisir" />
              <Line label="→ valeur par action" value={vTx == null ? "–" : `${num(vTx, 2)} ${cur}`} cls="text-fg" />
              <Field label="Prime de contrôle" help="Prime payée au-dessus du cours pour prendre le contrôle, usuellement 20 à 40 %." value={x.premium} onChange={set("premium")} min={0} max={100} step={1} suffix="%" origin="usuel 20 – 40 %" />
              <Line label="→ prix d'offre implicite" value={px == null ? "–" : `${num(px * (1 + x.premium / 100), 2)} ${cur}`} cls="text-fg" />
            </div>
          </div>
        </Panel>

        <div className="col-span-12 px-1 pb-1 text-[10px] text-dim">
          DCF : flux de fin d&apos;année actualisés au WACC, valeur terminale de Gordon-Shapiro. Scénarios : pessimiste = croissance −3 / −1 pt, terminale −0,5 pt, WACC +1 pt ; optimiste = +3 / +1 pt, +0,5 pt, WACC −0,5 pt.
          Verdict : écart de plus de 15 % entre la valeur centrale et le cours. Outil d&apos;analyse, pas une recommandation d&apos;investissement.
        </div>
      </>}
    </div>
  );
}
