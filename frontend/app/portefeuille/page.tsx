"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { send, useApi, useRaw } from "@/lib/api";
import { dateOnly, num, pct, price, tone } from "@/lib/format";

type Pos = { symbol: string; name: string; currency: string; type: string; qty: number; pru_local: number; pru_base: number; price: number | null; value: number; cost_base: number;
  unrealized: number; market_effect: number; fx_effect: number; realized: number; dividends: number; total_pnl: number; total_pct: number | null; bought: number; weight: number; day_pct: number | null; pnl_pct: number | null; contribution: number | null };
type Period = { label: string; available: boolean; from?: string; twr?: number; benchmark?: number | null; excess?: number | null; mwr?: number | null; twr_annual?: number | null; benchmark_annual?: number | null; mwr_annual?: number | null };
type Summary = {
  empty: boolean; base: string; benchmark: { symbol: string; name: string; currency: string }; as_of: string; tracked_cash: boolean;
  totals: Record<string, number | null>; positions: Pos[]; periods: Period[]; risk: Record<string, any>;
  allocations: Record<string, { key: string; value: number; weight: number }[]>;
  series: { dates: string[]; value: number[]; invested: number[]; twr: number[]; benchmark: (number | null)[] }; warnings: string[]; methods: Record<string, string>;
  simulated: { dates: string[]; portfolio: number[]; benchmark: number[]; return: number; benchmark_return: number; from: string } | null;
};
type TxRow = { id: number; date: string; type: string; symbol: string; quantity: string | null; price: string | null; amount: string | null; fees: string; currency: string; note: string };

const TYPES: [string, string][] = [["BUY", "Achat"], ["SELL", "Vente"], ["DIVIDEND", "Dividende"], ["DEPOSIT", "Dépôt"], ["WITHDRAWAL", "Retrait"], ["FEE", "Frais"], ["SPLIT", "Split"]];
const TLABEL = Object.fromEntries(TYPES);
const P = (v: number | null | undefined) => pct(v == null ? null : v * 100);
const RISK: [string, string, (v: number) => string][] = [
  ["alpha", "Alpha (Jensen, annualisé)", (v) => P(v)], ["beta", "Bêta", (v) => num(v, 2)], ["volatility", "Volatilité annualisée", (v) => num(v * 100, 2) + " %"],
  ["sharpe", "Ratio de Sharpe", (v) => num(v, 2)], ["sortino", "Ratio de Sortino", (v) => num(v, 2)], ["max_drawdown", "Drawdown maximal", (v) => P(v)],
  ["tracking_error", "Tracking error", (v) => num(v * 100, 2) + " %"], ["information_ratio", "Ratio d'information", (v) => num(v, 2)], ["correlation", "Corrélation", (v) => num(v, 2)],
];

function Kpi({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return <div className="border-r border-line px-3 py-1"><div className="text-[10px] uppercase text-dim">{label}</div><div className={`text-base ${cls}`}>{value}</div>{sub && <div className="text-[10px] text-dim">{sub}</div>}</div>;
}

type Found = { symbol: string; name: string; type: string; exchange: string };
type Q = { symbol: string; name?: string; price?: number; currency?: string; error?: string };

/** Saisie simple d'une ligne : symbole, quantité, prix d'achat. La performance s'affiche avant même l'ajout. */
function QuickAdd({ onDone }: { onDone: () => void }) {
  const [symbol, setSymbol] = useState(""); const [dq, setDq] = useState("");
  const [qty, setQty] = useState(""); const [px, setPx] = useState(""); const [date, setDate] = useState(""); const [fees, setFees] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(symbol.trim().toUpperCase()), 350); return () => clearTimeout(t); }, [symbol]);
  const found = useApi<Found[]>(dq.length >= 2 ? `/api/market/search?q=${encodeURIComponent(dq)}` : null);
  const quote = useApi<Q[]>(dq ? `/api/market/quotes?symbols=${encodeURIComponent(dq)}` : null);
  const q = quote.data?.[0], ok = q && !q.error && q.price != null;
  const n = (v: string) => parseFloat(v.replace(/\s/g, "").replace(",", "."));
  const Q = n(qty), P = n(px), F = fees ? n(fees) : 0;
  const cost = Q > 0 && P >= 0 ? Q * P + (F || 0) : null;
  const value = ok && Q > 0 ? Q * q!.price! : null;
  const gain = cost != null && value != null ? value - cost : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      await send("POST", "/api/portfolio/transactions", { type: "BUY", symbol: dq, quantity: qty, price: px, fees, date, currency: "" });
      setMsg({ ok: true, text: `${dq} ajouté au portefeuille.` }); setSymbol(""); setQty(""); setPx(""); setFees(""); onDone();
    } catch (x: any) { setMsg({ ok: false, text: x.message }); }
    setBusy(false);
  };
  return (
    <div className="border-b border-line p-2">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-[10px] uppercase text-dim">Symbole
          <input list="symbols" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL, MC.PA, BTC-USD…" className="w-44 text-xs uppercase text-fg" required />
          <datalist id="symbols">{found.data?.map((f) => <option key={f.symbol} value={f.symbol}>{f.name} · {f.exchange}</option>)}</datalist>
        </label>
        <label className="flex flex-col text-[10px] uppercase text-dim">Quantité<input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="10" className="w-24 text-xs text-fg" required /></label>
        <label className="flex flex-col text-[10px] uppercase text-dim">Prix d'achat unitaire{ok ? ` (${q!.currency})` : ""}<input value={px} onChange={(e) => setPx(e.target.value)} placeholder="150,00" className="w-36 text-xs text-fg" required /></label>
        <label className="flex flex-col text-[10px] uppercase text-dim">Date d'achat (facultatif)<input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className="text-xs text-fg" /></label>
        <label className="flex flex-col text-[10px] uppercase text-dim">Frais (facultatif)<input value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" className="w-20 text-xs text-fg" /></label>
        <button disabled={busy} className="bg-amber px-3 py-0.5 text-black disabled:opacity-50">Ajouter la ligne</button>
        <div className="ml-2 min-w-64 flex-1 pb-0.5">
          {dq && quote.error && <span className="text-down">{quote.error.message}</span>}
          {dq && q?.error && <span className="text-down">Symbole introuvable : choisis-en un dans la liste proposée.</span>}
          {ok && <span><span className="text-fg">{q!.name}</span> <span className="text-dim">· cours actuel</span> {price(q!.price)} {q!.currency}
            {gain != null && cost ? <> <span className="text-dim">· performance</span> <span className={tone(gain)}>{pct((gain / cost) * 100)} ({gain > 0 ? "+" : ""}{num(gain, 2)} {q!.currency})</span></> : null}</span>}
        </div>
      </form>
      {msg && <div className={`mt-1 whitespace-pre-wrap ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</div>}
      <div className="mt-1 text-[10px] leading-snug text-dim">La devise est celle de cotation du symbole. Sans date d'achat, la ligne est datée d'aujourd'hui : la performance de la ligne reste exacte, mais la courbe historique, les rendements par période, l'alpha et l'effet de change ne démarrent qu'aujourd'hui. Ventes, dividendes, splits et import CSV : onglet Journal.</div>
    </div>
  );
}

function TxForm({ base, onDone }: { base: string; onDone: () => void }) {
  const empty = { date: new Date().toISOString().slice(0, 10), type: "BUY", symbol: "", quantity: "", price: "", amount: "", fees: "", currency: base, note: "" };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const trade = f.type === "BUY" || f.type === "SELL", split = f.type === "SPLIT", cash = !trade && !split;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try { await send("POST", "/api/portfolio/transactions", f); setF({ ...empty, date: f.date, type: f.type, currency: f.currency }); onDone(); } catch (x: any) { setErr(x.message); }
  };
  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files?.[0]; if (!fl) return; setErr("");
    try { const r = await send("POST", "/api/portfolio/import", { text: await fl.text() }); setErr(`${r.imported} transactions importées.`); onDone(); } catch (x: any) { setErr(x.message); }
    e.target.value = "";
  };
  return (
    <div className="border-b border-line p-2">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-1">
        <input type="date" value={f.date} onChange={set("date")} required />
        <select value={f.type} onChange={set("type")}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {f.type !== "DEPOSIT" && f.type !== "WITHDRAWAL" && f.type !== "FEE" && <input placeholder="Symbole Yahoo" value={f.symbol} onChange={set("symbol")} className="w-28 uppercase" required />}
        {(trade || split) && <input placeholder={split ? "Ratio (4 = 4-pour-1)" : "Quantité"} value={f.quantity} onChange={set("quantity")} className="w-36" required />}
        {trade && <input placeholder="Prix unitaire" value={f.price} onChange={set("price")} className="w-28" required />}
        {cash && <input placeholder="Montant" value={f.amount} onChange={set("amount")} className="w-28" required />}
        {!split && <input placeholder="Frais" value={f.fees} onChange={set("fees")} className="w-20" />}
        <input placeholder="Devise" value={f.currency} onChange={set("currency")} className="w-16 uppercase" maxLength={3} required />
        <input placeholder="Note" value={f.note} onChange={set("note")} className="w-40" />
        <button className="bg-amber px-3 py-0.5 text-black">Ajouter</button>
        <button type="button" onClick={() => file.current?.click()} className="border border-line px-3 py-0.5 hover:border-amber">Importer un CSV</button>
        <a href="/modele-transactions.csv" download className="text-info underline">modèle</a>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={importCsv} />
      </form>
      {err && <div className={`mt-1 whitespace-pre-wrap ${err.includes("importées") ? "text-up" : "text-down"}`}>{err}</div>}
      <div className="mt-1 text-[10px] text-dim">Le prix et les frais sont saisis dans la devise de la ligne ; la conversion en {base} se fait au taux BCE du jour de la transaction. Dividende : montant net reçu.</div>
    </div>
  );
}

export default function Portefeuille() {
  const [win, setWin] = useState("Origine");
  const [viewSel, setView] = useState<"perf" | "valeur" | "simu" | null>(null);
  const [dim, setDim] = useState("Perf. par ligne");
  const [tab, setTab] = useState<"positions" | "journal">("positions");
  const s = useApi<Summary>(`/api/portfolio/summary?window=${encodeURIComponent(win)}`, 5 * 60_000);
  const txs = useRaw<TxRow[]>("/api/portfolio/transactions");
  const d = s.data;
  const refresh = () => { s.reload(); txs.reload(); };
  const del = async (id: number) => { try { await send("DELETE", `/api/portfolio/transactions/${id}`); refresh(); } catch (x: any) { alert(x.message); } };

  // Avec moins de deux séances d'historique réel, il n'y a pas de courbe à tracer : on ouvre sur la simulation.
  const short = !!d && !d.empty && d.series.dates.length < 2;
  const view = viewSel ?? (short ? "simu" : "perf");
  const chart = useMemo(() => {
    if (!d || d.empty) return null;
    const z = d.series, sm = d.simulated;
    if (view === "simu") return sm ? lineOption([{ name: "Lignes actuelles (base 100)", data: sm.dates.map((t, i) => [t, sm.portfolio[i]]) }, { name: `${d.benchmark.symbol} en ${d.base} (dividendes réinvestis)`, data: sm.dates.map((t, i) => [t, sm.benchmark[i]]) }], { decimals: 1 }) : null;
    if (z.dates.length < 2) return null;
    return view === "perf"
      ? lineOption([{ name: "Portefeuille (TWR, base 100)", data: z.dates.map((t, i) => [t, z.twr[i]]) }, { name: `${d.benchmark.symbol} en ${d.base} (dividendes réinvestis)`, data: z.dates.map((t, i) => [t, z.benchmark[i]]) }], { decimals: 1 })
      : lineOption([{ name: `Valeur (${d.base})`, data: z.dates.map((t, i) => [t, z.value[i]]) }, { name: "Apports nets cumulés", data: z.dates.map((t, i) => [t, z.invested[i]]), step: true, dashed: true }], { decimals: 0 });
  }, [d, view]);

  if (s.error && !d) return <Panel title="Portefeuille"><State error={s.error} /></Panel>;
  if (!d) return <Panel title="Portefeuille"><State loading /></Panel>;
  if (d.empty) return (
    <Panel title="Portefeuille · journal vide">
      <QuickAdd onDone={refresh} />
      <div className="p-2 text-dim">Portefeuille vide. Ajoute ta première ligne ci-dessus : symbole, quantité et prix d'achat suffisent. Pour importer un historique complet (CSV) ou saisir ventes et dividendes :</div>
      <TxForm base={d.base} onDone={refresh} />
    </Panel>
  );
  const t = d.totals, c = d.base;
  const maxPerf = Math.max(0.0001, ...d.positions.filter((p) => p.qty).map((p) => Math.abs(p.pnl_pct ?? 0)));
  const money = (v: number | null | undefined) => (v == null ? "–" : num(v, 2) + " " + c);
  return (
    <div className="flex h-full flex-col gap-1 overflow-auto">
      <div className="flex shrink-0 flex-wrap items-stretch border border-line bg-panel">
        <Kpi label={`Valeur au ${dateOnly(d.as_of)}`} value={money(t.value)} sub={d.tracked_cash ? `dont liquidités ${money(t.cash)}` : "titres seuls (aucun dépôt dans le journal)"} />
        <Kpi label="Investi (lignes en cours)" value={money(t.cost)} sub={`cumul des achats ${money(t.bought)}`} />
        <div className="border-r border-line bg-raised px-3 py-1" title={d.methods.total_pct}><div className="text-[10px] uppercase text-amber">Performance totale</div>
          <div className={`text-xl ${tone(t.total_pct)}`}>{P(t.total_pct)}</div><div className={`text-[11px] ${tone(t.total_pnl)}`}>{(t.total_pnl ?? 0) > 0 ? "+" : ""}{money(t.total_pnl)}</div></div>
        <Kpi label="Jour" value={P(t.day_pct)} sub={money(t.day_change)} cls={tone(t.day_pct)} />
        <Kpi label="Plus-value latente" value={`${P(t.unrealized_pct)}`} sub={`${money(t.unrealized)} · marché ${num(t.market_effect, 0)} · change ${num(t.fx_effect, 0)}`} cls={tone(t.unrealized)} />
        <Kpi label="Plus-value réalisée" value={money(t.realized)} cls={tone(t.realized)} />
        <Kpi label="Dividendes nets" value={money(t.dividends)} sub={t.fees_other ? `autres frais ${money(t.fees_other)}` : undefined} />
        <div className="ml-auto flex items-center px-2"><SourceTag env={s.env} /></div>
      </div>
      {d.warnings.map((w) => <div key={w} className="shrink-0 border border-down/60 px-2 py-1 text-down">⚠ {w}</div>)}
      <div className="grid shrink-0 grid-cols-12 gap-1">
        <Panel title="Performance" className="col-span-6 h-80" right={<Seg value={view} options={[["perf", "Réel vs benchmark"], ["valeur", "Valeur vs apports"], ["simu", "Simulation 1 an"]]} onChange={(v) => setView(v as any)} />}>
          <div className="flex h-full flex-col">
            {view === "simu" && d.simulated && (
              <div className="shrink-0 border-b border-line px-2 py-1 text-[11px]">
                <span className="bg-amber px-1 text-black">SIMULATION</span> Tes lignes actuelles, supposées détenues depuis le {dateOnly(d.simulated.from)} avec les mêmes quantités :
                {" "}<span className={tone(d.simulated.return)}>{P(d.simulated.return)}</span> contre <span className={tone(d.simulated.benchmark_return)}>{P(d.simulated.benchmark_return)}</span> pour {d.benchmark.symbol}.
                <span className="text-dim"> Ce n'est pas ta performance réelle : elle ignore tes vraies dates et prix d'achat.</span>
              </div>)}
            {view !== "simu" && short && (
              <div className="m-2 border border-amber/60 p-2 text-amber">
                Pas encore de courbe : toutes tes lignes sont datées du {dateOnly(d.series.dates[0])}, l'historique réel ne compte donc qu'une séance.
                <div className="mt-1 text-fg">Deux solutions : renseigner les vraies dates d'achat dans l'onglet <button className="text-info underline" onClick={() => setTab("journal")}>Journal</button> (colonne Date modifiable), ou regarder la <button className="text-info underline" onClick={() => setView("simu")}>simulation sur 1 an</button> de tes lignes actuelles.</div>
                <div className="mt-1 text-dim">Sans rien changer, la courbe se construira d'elle-même jour après jour à partir d'aujourd'hui.</div>
              </div>)}
            {view === "simu" && !d.simulated && <div className="p-2 text-dim">Simulation indisponible : pas assez d'historique de cours pour les lignes détenues.</div>}
            <div className="min-h-0 flex-1">{chart && <EChart option={chart} />}</div>
          </div>
        </Panel>
        <Panel title="Rendements" className="col-span-3 h-80" right={`benchmark ${d.benchmark.symbol}`}>
          <table>
            <thead><tr><th>Période</th><th className="num" title={d.methods.twr}>TWR</th><th className="num">Bench.</th><th className="num">Écart</th><th className="num" title={d.methods.mwr}>MWR</th></tr></thead>
            <tbody>{d.periods.map((p) => p.available ? (
              <tr key={p.label} title={`depuis le ${dateOnly(p.from!)}${p.twr_annual != null ? ` · annualisé : TWR ${P(p.twr_annual)}, bench. ${P(p.benchmark_annual)}, MWR ${P(p.mwr_annual)}` : ""}`}>
                <td>{p.label}</td><td className={`num ${tone(p.twr)}`}>{P(p.twr)}</td><td className={`num ${tone(p.benchmark)}`}>{P(p.benchmark)}</td><td className={`num ${tone(p.excess)}`}>{P(p.excess)}</td><td className={`num ${tone(p.mwr)}`}>{P(p.mwr)}</td>
              </tr>) : <tr key={p.label}><td>{p.label}</td><td colSpan={4} className="num text-dim">historique insuffisant</td></tr>)}
              {d.periods.filter((p) => p.twr_annual != null).map((p) => (
                <tr key={p.label + "a"}><td className="text-dim">{p.label} / an</td><td className={`num ${tone(p.twr_annual)}`}>{P(p.twr_annual)}</td><td className={`num ${tone(p.benchmark_annual)}`}>{P(p.benchmark_annual)}</td><td className="num text-dim">–</td><td className={`num ${tone(p.mwr_annual)}`}>{P(p.mwr_annual)}</td></tr>))}
            </tbody>
          </table>
          <div className="p-2 text-[10px] leading-snug text-dim">TWR : {d.methods.twr}<br />MWR : {d.methods.mwr}</div>
        </Panel>
        <Panel title={dim === "Perf. par ligne" ? "Performance par ligne" : `Répartition · ${dim}`} className="col-span-3 h-80" right={<select value={dim} onChange={(e) => setDim(e.target.value)}>{["Perf. par ligne", ...Object.keys(d.allocations)].map((k) => <option key={k}>{k}</option>)}</select>}>
          {dim === "Perf. par ligne" ? (<>
            <table><tbody>{[...d.positions].filter((p) => p.qty).sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0)).map((p) => { const w = Math.min(Math.abs(p.pnl_pct ?? 0) / maxPerf, 1) * 50; return (
              <tr key={p.symbol}><td><Link href={`/graphique?s=${encodeURIComponent(p.symbol)}`} className="text-amber hover:underline">{p.symbol}</Link></td>
                <td className="w-1/2"><div className="relative h-2"><div className="absolute left-1/2 top-0 h-2 w-px bg-line" /><div className={`absolute top-0 h-2 ${(p.pnl_pct ?? 0) >= 0 ? "bg-up" : "bg-down"}`} style={(p.pnl_pct ?? 0) >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} /></div></td>
                <td className={`num ${tone(p.pnl_pct)}`}>{P(p.pnl_pct)}</td><td className={`num ${tone(p.unrealized)}`}>{num(p.unrealized, 0)}</td></tr>); })}</tbody></table>
            <div className="p-2 text-[10px] leading-snug text-dim">{d.methods.line_pct}</div>
          </>) : <table><tbody>{d.allocations[dim].map((a) => (
            <tr key={a.key}><td>{a.key}</td><td className="w-1/2"><div className="h-2 bg-amber" style={{ width: `${Math.max(a.weight * 100, 0.5)}%` }} /></td><td className="num">{num(a.weight * 100, 1)} %</td><td className="num text-dim">{num(a.value, 0)}</td></tr>))}</tbody></table>}
        </Panel>
      </div>
      <Panel title="Risque" className="shrink-0" right={<><span>{d.risk.n} séances · {d.risk.from && dateOnly(d.risk.from)} → {d.risk.to && dateOnly(d.risk.to)} · sans risque : {d.risk.risk_free ?? "0 %"} ({num((d.risk.risk_free_avg ?? 0) * 100, 2)} % en moyenne)</span><Seg value={win} options={["6M", "1A", "3A", "Origine"]} onChange={setWin} /></>}>
        {d.risk.n < 20 ? <div className="p-2 text-dim">Moins de 20 séances sur la fenêtre : mesures de risque non calculées.</div> : (
          <div className="grid grid-cols-3">
            {RISK.map(([k, label, fmt]) => (
              <div key={k} className="border-b border-r border-line px-2 py-1">
                <div className="flex items-baseline justify-between"><span className="text-dim">{label}</span><span className={`text-base ${k === "alpha" ? tone(d.risk[k]) : ""}`}>{d.risk[k] == null ? "–" : fmt(d.risk[k])}</span></div>
                <div className="text-[10px] leading-snug text-dim">{d.methods[k]}</div>
              </div>))}
          </div>)}
      </Panel>
      <Panel className="min-h-80 shrink-0" title={<Seg value={tab} options={[["positions", `Positions (${d.positions.filter((p) => p.qty).length})`], ["journal", `Journal (${txs.data?.length ?? 0})`]]} onChange={(v) => setTab(v as any)} />} right={tab === "positions" ? `montants en ${c}, sauf prix d'achat et cours (devise de l'actif)` : undefined}>
        {tab === "positions" ? (<>
          <QuickAdd onDone={refresh} />
          <table>
            <thead><tr><th>Symbole</th><th>Nom</th><th className="num">Qté</th><th className="num" title={d.methods.pru}>Prix d'achat</th><th className="num">Cours actuel</th><th className="num">Investi</th><th className="num">Valeur</th>
              <th className="num" title={d.methods.line_pct}>+/− value</th><th className="num" title={d.methods.line_pct}>Perf.</th><th className="num">Jour</th><th className="num">Poids</th>
              <th className="num" title={d.methods.effects}>Marché</th><th className="num" title={d.methods.effects}>Change</th><th className="num">Réalisé</th><th className="num">Divid.</th><th className="num">Résultat total</th><th className="num">Perf. totale</th></tr></thead>
            <tbody>{d.positions.map((p) => (
              <tr key={p.symbol} className={p.qty ? "" : "text-dim"}>
                <td><Link href={`/graphique?s=${encodeURIComponent(p.symbol)}`} className="text-amber hover:underline">{p.symbol}</Link></td><td className="max-w-56 truncate">{p.name}</td>
                <td className="num">{num(p.qty, p.qty % 1 ? 4 : 0)}</td><td className="num">{p.qty ? `${price(p.pru_local)} ${p.currency}` : "–"}</td><td className="num">{p.price == null ? "–" : `${price(p.price)} ${p.currency}`}</td>
                <td className="num">{p.qty ? num(p.cost_base, 2) : "–"}</td><td className="num">{num(p.value, 2)}</td>
                <td className={`num ${tone(p.unrealized)}`}>{p.qty ? (p.unrealized > 0 ? "+" : "") + num(p.unrealized, 2) : "–"}</td><td className={`num font-bold ${tone(p.pnl_pct)}`}>{P(p.pnl_pct)}</td>
                <td className={`num ${tone(p.day_pct)}`}>{P(p.day_pct)}</td><td className="num">{num(p.weight * 100, 1)} %</td>
                <td className={`num ${tone(p.market_effect)}`}>{num(p.market_effect, 2)}</td><td className={`num ${tone(p.fx_effect)}`}>{num(p.fx_effect, 2)}</td>
                <td className={`num ${tone(p.realized)}`}>{num(p.realized, 2)}</td><td className="num">{num(p.dividends, 2)}</td><td className={`num ${tone(p.total_pnl)}`}>{num(p.total_pnl, 2)}</td><td className={`num ${tone(p.total_pct)}`}>{P(p.total_pct)}</td>
              </tr>))}
              <tr className="bg-raised font-bold"><td colSpan={5}>Total du portefeuille</td><td className="num">{num(t.cost, 2)}</td><td className="num">{num(d.positions.reduce((a, p) => a + p.value, 0), 2)}</td>
                <td className={`num ${tone(t.unrealized)}`}>{(t.unrealized ?? 0) > 0 ? "+" : ""}{num(t.unrealized, 2)}</td><td className={`num ${tone(t.unrealized_pct)}`}>{P(t.unrealized_pct)}</td><td className={`num ${tone(t.day_pct)}`}>{P(t.day_pct)}</td><td className="num">100 %</td>
                <td className={`num ${tone(t.market_effect)}`}>{num(t.market_effect, 2)}</td><td className={`num ${tone(t.fx_effect)}`}>{num(t.fx_effect, 2)}</td><td className={`num ${tone(t.realized)}`}>{num(t.realized, 2)}</td><td className="num">{num(t.dividends, 2)}</td>
                <td className={`num ${tone(t.total_pnl)}`}>{num(t.total_pnl, 2)}</td><td className={`num ${tone(t.total_pct)}`}>{P(t.total_pct)}</td></tr>
            </tbody>
          </table>
          <div className="p-2 text-[10px] leading-snug text-dim">Perf. : {d.methods.line_pct}<br />Perf. totale : {d.methods.total_pct}<br />PRU : {d.methods.pru}<br />Marché / change : {d.methods.effects}</div>
        </>) : (<>
          <TxForm base={c} onDone={refresh} />
          <State loading={txs.loading} error={txs.error} />
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Symbole</th><th className="num">Quantité</th><th className="num">Prix</th><th className="num">Montant</th><th className="num">Frais</th><th>Devise</th><th>Note</th><th /></tr></thead>
            <tbody>{txs.data?.map((x) => (
              <tr key={x.id}><td><input type="date" defaultValue={x.date} max={new Date().toISOString().slice(0, 10)} title="Modifier la date de la transaction"
                onChange={async (e) => { const v = e.target.value; if (!v || v === x.date) return; try { await send("PUT", `/api/portfolio/transactions/${x.id}/date`, { date: v }); refresh(); } catch (err: any) { alert(err.message); e.target.value = x.date; } }} /></td><td>{TLABEL[x.type] ?? x.type}</td><td>{x.symbol}</td><td className="num">{x.quantity ?? ""}</td><td className="num">{x.price ?? ""}</td><td className="num">{x.amount ?? ""}</td><td className="num">{x.fees}</td><td>{x.currency}</td><td className="text-dim">{x.note}</td>
                <td className="num"><button onClick={() => confirm(`Supprimer la transaction du ${dateOnly(x.date)} ?`) && del(x.id)} className="text-dim hover:text-down">supprimer</button></td></tr>))}</tbody>
          </table>
        </>)}
      </Panel>
    </div>
  );
}
