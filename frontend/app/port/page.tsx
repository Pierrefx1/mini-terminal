"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import EChart, { lineOption, PALETTE } from "@/components/EChart";
import Export from "@/components/Export";
import { Num, Out, Panel, SourceTag, State } from "@/components/ui";
import { useApi, usePostApi } from "@/lib/api";
import { big, num, pct, price, tone } from "@/lib/format";
import { analysisBody, type Analysis, type Portfolio, usePortfolios } from "@/lib/portfolios";
import { uid } from "@/lib/store";

/** Camembert d'une répartition ; au-delà de 7 parts, les plus petites sont regroupées dans « Autres ». */
function Pie({ rows }: { rows: { name: string; weight: number }[] }) {
  const parts = useMemo(() => {
    const s = [...rows].filter((r) => r.weight > 0).sort((a, b) => b.weight - a.weight);
    if (s.length <= PALETTE.length) return s;
    const head = s.slice(0, PALETTE.length - 1);
    return [...head, { name: "Autres", weight: s.slice(PALETTE.length - 1).reduce((t, r) => t + r.weight, 0) }];
  }, [rows]);
  const option = useMemo(() => ({
    tooltip: { trigger: "item", backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, formatter: (p: any) => `${p.marker} ${p.name} : <b>${num(p.value, 1)} %</b>` },
    series: [{ type: "pie", radius: "88%", center: ["50%", "50%"], label: { show: false }, labelLine: { show: false },
      itemStyle: { borderColor: "#08101d", borderWidth: 1 }, emphasis: { scale: true, scaleSize: 4 },
      data: parts.map((r) => ({ name: r.name, value: r.weight })) }],
  }), [parts]);
  if (!parts.length) return <div className="px-2 py-1 text-dim">–</div>;
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <div className="h-32 w-32 shrink-0"><EChart option={option} /></div>
      <div className="min-w-0 flex-1 space-y-0.5">{parts.map((r, i) => (
        <div key={r.name} className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
          <span className="flex-1 truncate">{r.name}</span><span className="num">{num(r.weight, 1)} %</span></div>))}</div>
    </div>
  );
}

export default function Port() {
  const { list, current, setCurrentId, save, remove, ready } = usePortfolios();
  const [draft, setDraft] = useState<Portfolio | null>(null);
  useEffect(() => { if (current) setDraft(current); }, [current?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const [applied, setApplied] = useState<Portfolio | null>(null);
  useEffect(() => { if (current) setApplied(current); }, [current?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = usePostApi<Analysis>(applied ? "/api/portfolio/analyze" : null, applied ? analysisBody(applied) : null);
  const d = a.data;
  const syms = d?.lines.map((l) => l.symbol).join(",") ?? "";
  const quotes = useApi<{ symbol: string; price?: number }[]>(syms ? `/api/market/quotes?symbols=${encodeURIComponent(syms)}` : null, 60_000);
  const px = Object.fromEntries((quotes.data ?? []).map((q) => [q.symbol, q.price]));
  const opt = useMemo(() => d && lineOption([{ name: draft?.name ?? "Portefeuille", data: d.series.map((s) => [s.date, s.value]) }, { name: `Indice de référence ${d.benchmark}`, data: d.series.map((s) => [s.date, s.bench]), dashed: true }], { decimals: 1 }), [d, draft?.name]);
  if (!draft) return <State loading />;
  const tot = draft.holdings.reduce((s, h) => s + (h.weight || 0), 0);
  const set = (p: Partial<Portfolio>) => setDraft({ ...draft, ...p });
  const apply = () => { save(draft); setApplied(draft); };
  const perf = d?.performance;
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 lg:col-span-4" title="PORT · portefeuilles" right={<>
        <select value={current?.id} onChange={(e) => setCurrentId(e.target.value)}>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button onClick={() => { const p = { ...draft, id: uid(), name: "Nouveau portefeuille", holdings: [{ symbol: "SPY", weight: 60 }, { symbol: "TLT", weight: 40 }] }; save(p); setCurrentId(p.id); }} className="border border-line px-1 text-info">+ nouveau</button>
        {list.length > 1 && <button onClick={() => { if (confirm(`Supprimer « ${draft.name} » ?`)) { remove(draft.id); setCurrentId(list.find((p) => p.id !== draft.id)!.id); } }} className="border border-line px-1 text-down">supprimer</button>}</>}>
        <div className="px-2 py-1">
          <label className="flex justify-between py-0.5"><span className="text-dim">Nom</span><input value={draft.name} onChange={(e) => set({ name: e.target.value })} className="w-48" /></label>
          <label className="flex justify-between py-0.5"><span className="text-dim">Indice de référence</span><input value={draft.benchmark} onChange={(e) => set({ benchmark: e.target.value.toUpperCase() })} className="w-24 uppercase" /></label>
          <label className="flex justify-between py-0.5"><span className="text-dim">Devise de base</span><select value={draft.base} onChange={(e) => set({ base: e.target.value as Portfolio["base"] })}>{["EUR", "USD", "GBP", "CHF", "JPY"].map((c) => <option key={c}>{c}</option>)}</select></label>
          <Num label="Historique" value={draft.years} onChange={(v) => set({ years: Math.max(1, Math.min(10, Math.round(v))) })} step={1} suffix="ans" />
          <label className="flex justify-between py-0.5"><span className="text-dim">Rééquilibrage</span><select value={draft.rebalance} onChange={(e) => set({ rebalance: +e.target.value })}>
            <option value={0}>Aucun (achat-conservation)</option><option value={21}>Mensuel</option><option value={63}>Trimestriel</option><option value={252}>Annuel</option></select></label>
          <Num label="Capital" value={draft.capital} onChange={(v) => set({ capital: v })} step={100_000} />
          <Num label="Taux sans risque" value={draft.rf * 100} onChange={(v) => set({ rf: v / 100 })} step={0.1} suffix="%" />
        </div>
        <table><thead><tr><th>Instrument</th><th className="num">Poids</th><th className="num">Normalisé</th><th /></tr></thead>
          <tbody>{draft.holdings.map((h, i) => <tr key={i}>
            <td><input value={h.symbol} onChange={(e) => set({ holdings: draft.holdings.map((x, j) => (j === i ? { ...x, symbol: e.target.value.toUpperCase() } : x)) })} className="w-28 uppercase" /></td>
            <td className="num"><input type="number" value={h.weight} onChange={(e) => set({ holdings: draft.holdings.map((x, j) => (j === i ? { ...x, weight: +e.target.value } : x)) })} className="w-20 text-right" /></td>
            <td className="num text-dim">{tot ? num(h.weight / tot * 100, 1) : "–"} %</td>
            <td><button onClick={() => set({ holdings: draft.holdings.filter((_, j) => j !== i) })} className="text-down">×</button></td></tr>)}</tbody></table>
        <div className="flex gap-2 px-2 py-1">
          <button onClick={() => set({ holdings: [...draft.holdings, { symbol: "", weight: 10 }] })} className="border border-line px-2 text-info">+ instrument</button>
          <button onClick={apply} className="bg-amber px-3 font-bold text-black">Analyser</button>        </div>
        <div className="px-2 pb-1 text-[10px] text-dim">Symboles de la source de cotation (AAPL, MC.PA, TLT, GC=F…). Poids relatifs, normalisés à 100 %. Portefeuilles enregistrés dans ce navigateur.</div>
      </Panel>
      <Panel className="col-span-12 lg:col-span-8" title={`Performance ${d ? `du ${d.start} au ${d.end} en ${d.base}` : ""}`} right={<><Link href="/risk" className="text-info">RISK →</Link><SourceTag env={a.env} /></>}>
        <State loading={a.loading && !d} error={a.error} />
        {perf && <>
          <div className="grid grid-cols-2 gap-x-6 px-2 py-1 md:grid-cols-4">
            <Out label="Performance totale" value={pct(perf.total_pct)} cls={tone(perf.total_pct)} /><Out label={`Référence ${d.benchmark}`} value={pct(perf.bench_total_pct)} cls={tone(perf.bench_total_pct)} />
            <Out label="P&L sur le capital" value={big(perf.pnl)} cls={tone(perf.pnl)} /><Out label="Performance annualisée" value={pct((perf.ann_return ?? 0) * 100)} />
            <Out label="Volatilité annualisée" value={pct((perf.ann_vol ?? 0) * 100).replace("+", "")} /><Out label="Sharpe · Sortino" value={`${num(perf.sharpe, 2)} · ${num(perf.sortino, 2)}`} />
            <Out label="Bêta · alpha annualisé" value={`${num(perf.beta, 2)} · ${pct((perf.alpha ?? 0) * 100)}`} /><Out label="Perte maximale (portefeuille / réf.)" value={`${pct((perf.max_drawdown ?? 0) * 100)} / ${pct((perf.bench_max_drawdown ?? 0) * 100)}`} cls="text-down" />
            <Out label="Tracking error" value={pct((perf.tracking_error ?? 0) * 100).replace("+", "")} /><Out label="Ratio d'information" value={num(perf.information_ratio, 2)} /><Out label="Corrélation à la référence" value={num(perf.correlation, 2)} />
          </div>
          <div className="h-64">{opt && <EChart option={opt} />}</div>
        </>}
      </Panel>
      {d && <>
        <Panel className="col-span-12" title="Lignes : allocation, performance, contribution, rééquilibrage" right={<Export name={`portefeuille-${draft.name}`} columns={["Symbole", "Nom", "Secteur", "Pays", "Devise", "Poids cible %", "Poids actuel %", "Performance %", "Contribution %", "Contribution au risque %"]}
          rows={d.lines.map((l) => [l.symbol, l.name, l.sector, l.country, l.currency, l.target * 100, l.current * 100, l.return_pct, l.contribution_pct, l.risk_contribution_pct])} source={a.env?.source} />}>
          <table><thead><tr><th>Instrument</th><th>Secteur</th><th>Pays</th><th>Devise</th><th className="num">Cible</th><th className="num">Actuel</th><th className="num">Écart</th><th className="num">Perf.</th><th className="num">Contrib.</th><th className="num">Risque</th><th className="num">Cours</th><th className="num">Ordre de rééquilibrage</th></tr></thead>
            <tbody>{d.lines.map((l) => {
              const drift = l.current - l.target, amount = -drift * d.capital * (1 + (perf?.total_pct ?? 0) / 100), p = px[l.symbol];
              return <tr key={l.symbol}><td><Link href={`/des?s=${encodeURIComponent(l.symbol)}`} className="text-amber">{l.symbol}</Link> <span className="text-dim">{l.name?.slice(0, 22)}</span></td>
                <td>{l.sector}</td><td>{l.country}</td><td>{l.currency}</td><td className="num">{num(l.target * 100, 1)} %</td><td className="num">{num(l.current * 100, 1)} %</td>
                <td className={`num ${Math.abs(drift) > 0.02 ? "text-amber" : "text-dim"}`}>{drift > 0 ? "+" : ""}{num(drift * 100, 1)} pt</td>
                <td className={`num ${tone(l.return_pct)}`}>{pct(l.return_pct)}</td><td className={`num ${tone(l.contribution_pct)}`}>{l.contribution_pct == null ? "–" : pct(l.contribution_pct)}</td>
                <td className="num">{num(l.risk_contribution_pct, 1)} %</td><td className="num">{price(p)}</td>
                <td className={`num ${tone(amount)}`}>{Math.abs(drift) < 0.0005 ? "–" : `${amount > 0 ? "acheter" : "vendre"} ${big(Math.abs(amount))}${p ? ` (≈ ${num(Math.abs(amount) / p, 0)} titres)` : ""}`}</td></tr>;
            })}</tbody></table>
          <div className="px-2 py-1 text-[10px] text-dim">Contribution : poids initial × performance de la ligne (somme = performance du portefeuille en achat-conservation). Risque : part de la variance sur un an. Rééquilibrage : montants en {d.base} pour revenir aux poids cibles ; nombre de titres approché au cours en devise locale.</div>
        </Panel>
        <Panel className="col-span-12" title="Expositions">
          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
            {([["Secteurs", d.sectors], ["Pays", d.countries], ["Devises", d.currencies]] as const).map(([t, rows]) => (
              <div key={t}><div className="px-2 pt-1 text-[10px] uppercase text-amber">{t}</div><Pie rows={rows} /></div>))}
          </div>
        </Panel>
      </>}
    </div>
  );
}
