"use client";
import { useMemo, useState } from "react";
import EChart, { PALETTE } from "@/components/EChart";
import Export from "@/components/Export";
import { Panel, RangeBar, Seg, SourceTag, Spark, State, Toggle } from "@/components/ui";
import { useApi } from "@/lib/api";
import { num, pct, tone } from "@/lib/format";
import {
  type CalEvent, dec, eventDay, eventTime, FLAG, G10, GROUPS, heat, IMPACT_CLS, IMPACT_FR, type Pair, pairLabel, Tile,
  useBoard, useCot, useRates, useStrength,
} from "./shared";

const H = [["d1", "1J"], ["w1", "1S"], ["m1", "1M"], ["m3", "3M"], ["ytd", "YTD"], ["y1", "1A"]] as const;
type Hz = (typeof H)[number][0];

export default function Overview({ pair, open }: { pair: string; open: (p: string) => void }) {
  return (
    <div className="grid grid-cols-12 gap-1">
      <Kpis open={open} />
      <Takeaways open={open} />
      <Board pair={pair} open={open} />
      <StrengthPanel />
      <CrossMatrix open={open} />
      <RatesPanel />
      <Calendar ccys={G10.concat("CNY")} past title="Agenda · ±7 jours" className="col-span-12 md:col-span-6 xl:col-span-4" />
    </div>
  );
}

function Kpis({ open }: { open: (p: string) => void }) {
  const b = useBoard(), s = useStrength();
  const row = (p: string) => b.data?.find((x) => x.pair === p);
  const g10 = (s.data?.table ?? []).filter((r) => r.g10 && r.w1 != null).sort((a, c) => (c.w1 ?? 0) - (a.w1 ?? 0));
  const tile = (p: string) => {
    const r = row(p);
    return <Tile key={p} label={pairLabel(p)} value={num(r?.last, dec(p))} sub={<><span className={tone(r?.d1)}>{pct(r?.d1)}</span> <span className="text-dim">1J · YTD</span> <span className={tone(r?.ytd)}>{pct(r?.ytd, 1)}</span></>} onClick={() => open(p)} />;
  };
  return (
    <div className="col-span-12 grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-8">
      {["DXY", "EURUSD", "USDJPY", "GBPUSD", "USDCHF", "USDCNY"].map(tile)}
      <Tile label="Plus forte du G10 · 1 sem." value={g10[0] ? `${FLAG[g10[0].ccy] ?? ""} ${g10[0].ccy}` : "–"} sub={<span className="text-up">{pct(g10[0]?.w1)} vs panier</span>} cls="text-up" title="Variation de la devise contre la moyenne des devises du G10" />
      <Tile label="Plus faible du G10 · 1 sem." value={g10.at(-1) ? `${FLAG[g10.at(-1)!.ccy] ?? ""} ${g10.at(-1)!.ccy}` : "–"} sub={<span className="text-down">{pct(g10.at(-1)?.w1)} vs panier</span>} cls="text-down" />
    </div>
  );
}

/** Bandeau « à retenir » : plus gros mouvements du jour, prochaine publication majeure, positionnement extrême. */
function Takeaways({ open }: { open: (p: string) => void }) {
  const b = useBoard(), cot = useCot();
  const [now] = useState(() => Date.now());
  const start = new Date(now).toISOString().slice(0, 16), end = new Date(now + 7 * 86400_000).toISOString().slice(0, 16);
  const cal = useApi<{ events: CalEvent[] }>(`/api/calendar?start=${start}&end=${end}`, 60 * 60_000);
  const moves = (b.data ?? []).filter((p) => p.d1 != null && p.hv1m && p.pair !== "DXY")
    .map((p) => ({ ...p, sig: (p.d1! / (p.hv1m! / Math.sqrt(252))) }))
    .sort((a, c) => Math.abs(c.sig) - Math.abs(a.sig)).slice(0, 3);
  const next = (cal.data?.events ?? []).filter((e) => e.impact === "High" && G10.includes(e.country)).slice(0, 2);
  const ext = (cot.data?.markets ?? []).filter((m) => m.lev.index != null && (m.lev.index >= 90 || m.lev.index <= 10));
  const Item = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="min-w-0 border border-line bg-panel px-2 py-1"><div className="text-[10px] uppercase tracking-wider text-dim">{title}</div><div className="truncate text-[12px]">{children}</div></div>
  );
  return (
    <div className="col-span-12 grid grid-cols-1 gap-1 md:grid-cols-3">
      <Item title="Mouvements inhabituels du jour (en écarts-types)">{moves.length ? moves.map((p) => <button key={p.pair} onClick={() => open(p.pair)} className="mr-3 hover:text-amber">{pairLabel(p.pair)} <span className={tone(p.d1)}>{pct(p.d1)}</span> <span className="text-dim">{num(Math.abs(p.sig), 1)}σ</span></button>) : "–"}</Item>
      <Item title="Prochaines publications à fort impact">{next.length ? next.map((e) => <span key={e.id} className="mr-3"><span className="text-dim">{eventDay(e.time)} {eventTime(e.time)}</span> <span className="text-amber">{e.country}</span> {e.title}</span>) : <span className="text-dim">aucune publiée pour l&apos;instant (calendrier hebdomadaire)</span>}</Item>
      <Item title="Positionnement extrême des fonds (COT)">{cot.data ? ext.length ? ext.map((m) => <span key={m.ccy} className="mr-3">{FLAG[m.ccy]} {m.ccy === "USD" ? "DXY" : m.ccy} <span className="text-amber">{m.lev.net > 0 ? "acheteurs" : "vendeurs"} ({Math.round(m.lev.index!)})</span></span>) : <span className="text-dim">aucun</span> : "…"}</Item>
    </div>
  );
}

function Board({ pair, open }: { pair: string; open: (p: string) => void }) {
  const { data, env, error, loading } = useBoard();
  const [group, setGroup] = useState<string>("Majeures");
  const rows = (data ?? []).filter((p) => group === "Toutes" || p.group === group || (p.pair === "DXY" && group === "Majeures"));
  const cols = ["Paire", "Dernier", "1J %", "1S %", "1M %", "YTD %", "Vol 1M", "Vol 3M", "Vol 1A", "RSI 14", "vs MM200 %", "Portage %", "Portage/vol"];
  return (
    <Panel className="col-span-12 xl:col-span-8" title="Paires au comptant"
      right={<><Seg value={group} options={["Toutes", ...GROUPS].map((g) => [g, g === "Scandinaves et Europe centrale" ? "Europe" : g] as [string, string])} onChange={setGroup} />
        <Export name="forex" columns={cols} rows={(data ?? []).map((p) => [p.pair, p.last ?? null, p.d1 ?? null, p.w1 ?? null, p.m1 ?? null, p.ytd ?? null, p.hv1m ?? null, p.hv3m ?? null, p.hv1y ?? null, p.rsi ?? null, p.vs_sma200 ?? null, p.carry ?? null, p.carry_vol ?? null])} source={env?.source} />
        <SourceTag env={env} /></>}>
      <State loading={loading && !data} error={error} />
      {data && <table>
        <thead><tr>
          <th>Paire</th><th className="num">Dernier</th><th className="num">1J</th><th className="num">1S</th><th className="num">1M</th><th className="num">YTD</th>
          <th className="text-center" title="Position du cours dans la fourchette des 52 dernières semaines">52 sem.</th>
          <th className="num" title="Volatilité réalisée annualisée, 21 séances">Vol 1M</th><th className="num" title="Volatilité réalisée annualisée, 63 séances">Vol 3M</th>
          <th className="num" title="RSI de Wilder, 14 séances : > 70 suracheté, < 30 survendu">RSI</th>
          <th className="num" title="Écart du cours à sa moyenne mobile 200 séances">vs MM200</th>
          <th className="num" title="Portage annuel d'une position acheteuse de la devise de base : taux directeur base − taux directeur cotée">Portage</th>
          <th className="num" title="Portage rapporté à la volatilité 3M : rendement du portage par unité de risque">Port./vol</th>
          <th>60 séances</th>
        </tr></thead>
        <tbody>{rows.map((p, i) => [group === "Toutes" && p.group !== rows[i - 1]?.group && <tr key={p.group}><td colSpan={14} className="bg-raised text-[10px] uppercase tracking-wider text-dim">{p.group}</td></tr>,
          <BoardRow key={p.pair} p={p} active={p.pair === pair} onClick={() => open(p.pair)} />])}</tbody>
      </table>}
      <div className="px-2 py-1 text-[10px] text-dim">Cliquer sur une paire ouvre son analyse. Volatilités réalisées (pas de volatilité implicite gratuite sur le change, marché de gré à gré). Portage calculé sur les taux directeurs (BRI).</div>
    </Panel>
  );
}

function BoardRow({ p, active, onClick }: { p: Pair; active: boolean; onClick: () => void }) {
  if (p.error) return <tr><td>{pairLabel(p.pair)}</td><td colSpan={13} className="text-down">{p.error}</td></tr>;
  const rsiCls = p.rsi == null ? "" : p.rsi >= 70 ? "text-down" : p.rsi <= 30 ? "text-up" : "";
  return (
    <tr className={`cursor-pointer hover:bg-raised ${active ? "bg-raised" : ""}`} onClick={onClick}>
      <td className={active ? "text-amber" : "text-fg"}>{pairLabel(p.pair)}</td>
      <td className="num text-fg">{num(p.last, dec(p.pair))}</td>
      <td className={`num ${tone(p.d1)}`}>{pct(p.d1)}</td><td className={`num ${tone(p.w1)}`}>{pct(p.w1)}</td>
      <td className={`num ${tone(p.m1)}`}>{pct(p.m1)}</td><td className={`num ${tone(p.ytd)}`}>{pct(p.ytd)}</td>
      <td className="text-center"><RangeBar pos={p.range_pos} /></td>
      <td className="num">{num(p.hv1m, 1)}</td><td className="num">{num(p.hv3m, 1)}</td>
      <td className={`num ${rsiCls}`}>{num(p.rsi, 0)}</td>
      <td className={`num ${tone(p.vs_sma200)}`}>{pct(p.vs_sma200, 1)}</td>
      <td className={`num ${tone(p.carry)}`}>{p.carry == null ? "–" : `${num(p.carry, 2)} %`}</td>
      <td className={`num ${tone(p.carry_vol)}`}>{num(p.carry_vol, 2)}</td>
      <td><Spark values={p.spark} /></td>
    </tr>
  );
}

function StrengthPanel() {
  const { data, env, error, loading } = useStrength();
  const [h, setH] = useState<Hz>("w1");
  const [em, setEm] = useState(false);
  const rows = useMemo(() => (data?.table ?? []).filter((r) => (em || r.g10) && r[h] != null).sort((a, b) => (a[h] ?? 0) - (b[h] ?? 0)), [data, h, em]);
  const barOpt = useMemo(() => ({
    grid: { left: 8, right: 40, top: 4, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, valueFormatter: (v: number) => pct(v) },
    xAxis: { type: "value", axisLabel: { color: "#7486a0", fontSize: 10, formatter: (v: number) => `${v}%` }, splitLine: { lineStyle: { color: "#0e1828" } } },
    yAxis: { type: "category", data: rows.map((r) => `${FLAG[r.ccy] ?? ""} ${r.ccy}`), axisLabel: { color: "#d4dbe6", fontSize: 11 }, axisLine: { lineStyle: { color: "#1c2b42" } } },
    series: [{ type: "bar", data: rows.map((r) => ({ value: r[h], itemStyle: { color: (r[h] ?? 0) >= 0 ? "#1fd15f" : "#ff4d4d" } })), barMaxWidth: 12,
      label: { show: true, position: "right", color: "#7486a0", fontSize: 10, formatter: (p: { value: number }) => pct(p.value, 1) } }],
  }), [rows, h]);
  const path = data?.path && "dates" in data.path ? data.path : null;
  const visible = useMemo(() => {
    if (!path) return {};
    const last = Object.entries(path.series).map(([c, v]) => [c, v.at(-1) ?? 100] as const).sort((a, b) => b[1] - a[1]);
    const keep = new Set([...last.slice(0, 3), ...last.slice(-3)].map((x) => x[0]).concat("USD"));
    return Object.fromEntries(last.map(([c]) => [c, keep.has(c)]));
  }, [path]);
  const lineOpt = useMemo(() => path && ({
    grid: { left: 8, right: 44, top: 22, bottom: 4, containLabel: true },
    legend: { top: 0, left: 0, selected: visible, textStyle: { color: "#d4dbe6", fontSize: 10 }, inactiveColor: "#4d5d75", itemWidth: 10, itemHeight: 2, icon: "rect" },
    tooltip: { trigger: "axis", backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, order: "valueDesc", valueFormatter: (v: number) => num(v, 2) },
    xAxis: { type: "category", data: path.dates, axisLabel: { color: "#7486a0", fontSize: 10, formatter: (d: string) => `${d.slice(8)}/${d.slice(5, 7)}` }, axisLine: { lineStyle: { color: "#1c2b42" } } },
    yAxis: { type: "value", scale: true, axisLabel: { color: "#7486a0", fontSize: 10 }, splitLine: { lineStyle: { color: "#0e1828" } } },
    series: Object.entries(path.series).map(([c, v], i) => ({ name: c, type: "line", data: v, showSymbol: false, lineStyle: { width: c === "USD" ? 2.5 : 1.3 }, color: [...PALETTE, "#ffffff", "#ff8c69"][i % 10],
      endLabel: { show: true, formatter: c, color: "inherit", fontSize: 10 } })),
  }), [path, visible]);
  return (
    <Panel className="col-span-12 xl:col-span-4" title="Force des devises" right={<SourceTag env={env} />}>
      <State loading={loading && !data} error={error} />
      {data && <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1">
          <Seg value={h} options={H as unknown as [Hz, string][]} onChange={setH} />
          <Toggle on={em} onChange={setEm}>+ émergentes</Toggle>
        </div>
        <div style={{ height: Math.max(180, rows.length * 18 + 16) }}><EChart option={barOpt} /></div>
        <div className="border-t border-line px-2 pt-1 text-[10px] uppercase tracking-wider text-dim">G10 contre le panier · base 100 il y a 3 mois <span className="normal-case tracking-normal">(3 plus fortes, 3 plus faibles et USD ; cliquer la légende pour les autres)</span></div>
        <div className="h-56">{lineOpt && <EChart option={lineOpt} />}</div>
        <div className="px-2 py-1 text-[10px] text-dim">Variation de chaque devise contre la moyenne équipondérée des 10 devises du G10 (dollar inclus) : une valeur positive indique une devise qui s&apos;est appréciée face au panier.</div>
      </div>}
    </Panel>
  );
}

function CrossMatrix({ open }: { open: (p: string) => void }) {
  const { data, env } = useBoard();
  const ccys = ["USD", "EUR", "JPY", "GBP", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK"];
  // valeur en dollars et variation 1J de chaque devise, à partir des paires contre dollar
  const v = useMemo(() => {
    const out: Record<string, { usd: number; d1: number }> = { USD: { usd: 1, d1: 0 } };
    for (const c of ccys) {
      const d = data?.find((p) => p.pair === `${c}USD`), i = data?.find((p) => p.pair === `USD${c}`);
      if (d?.last) out[c] = { usd: d.last, d1: d.d1 ?? 0 };
      else if (i?.last) out[c] = { usd: 1 / i.last, d1: ((1 / (1 + (i.d1 ?? 0) / 100)) - 1) * 100 };
    }
    return out;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const listed = new Set((data ?? []).map((p) => p.pair));
  return (
    <Panel className="col-span-12 xl:col-span-5" title="Cours croisés · G10" right={<SourceTag env={env} />}>
      <table className="text-[11px]">
        <thead><tr><th className="text-dim">1 ↓ =</th>{ccys.map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
        <tbody>{ccys.map((r) => <tr key={r}><td className="text-amber">{FLAG[r]} {r}</td>{ccys.map((c) => {
          if (r === c) return <td key={c} className="num text-dim">—</td>;
          const a = v[r], b = v[c];
          if (!a || !b) return <td key={c} className="num text-dim">–</td>;
          const x = a.usd / b.usd, chg = ((1 + a.d1 / 100) / (1 + b.d1 / 100) - 1) * 100;
          const p = listed.has(r + c) ? r + c : listed.has(c + r) ? c + r : null;
          return <td key={c} className={`num ${p ? "cursor-pointer hover:outline hover:outline-1 hover:outline-amber" : ""}`} style={heat(chg, 1)} title={`${r}/${c} : ${pct(chg)} sur 1 jour${p ? " · cliquer pour analyser" : ""}`} onClick={() => p && open(p)}>{num(x, x >= 100 ? 2 : x >= 10 ? 3 : 4)}</td>;
        })}</tr>)}</tbody>
      </table>
      <div className="px-2 py-1 text-[10px] text-dim">Unités de la devise en colonne pour 1 unité de la devise en ligne, croisées via le dollar. Couleur : variation sur 1 jour (vert = la devise en ligne s&apos;apprécie).</div>
    </Panel>
  );
}

function RatesPanel() {
  const { data, env, error, loading } = useRates();
  const [all, setAll] = useState(false);
  const rows = (data ?? []).filter((r) => all || r.g10).sort((a, b) => b.rate - a.rate);
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-3" title="Taux directeurs" right={<><Toggle on={all} onChange={setAll}>+ émergents</Toggle><SourceTag env={env} /></>}>
      <State loading={loading && !data} error={error} />
      {data && <table>
        <thead><tr><th>Devise</th><th>Banque</th><th className="num">Taux</th><th className="num" title="Dernier mouvement de taux">Dernier mvt</th><th>Le</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.ccy}>
          <td className="text-amber">{FLAG[r.ccy]} {r.ccy}</td><td className="text-dim">{r.bank}</td>
          <td className="num text-fg">{num(r.rate, 2)} %</td>
          <td className={`num ${tone(r.move)}`}>{r.move == null ? "–" : `${r.move > 0 ? "▲ +" : "▼ "}${num(r.move * 100, 0)} pb`}</td>
          <td className="text-dim">{r.last_change ? `${r.last_change.slice(8)}/${r.last_change.slice(5, 7)}/${r.last_change.slice(2, 4)}` : "–"}</td>
        </tr>)}</tbody>
      </table>}
    </Panel>
  );
}

/** Calendrier économique filtré par devise (ForexFactory). */
export function Calendar({ ccys, title, className, past = false }: { ccys: string[]; title: string; className?: string; past?: boolean }) {
  const [now] = useState(() => Date.now());
  const start = new Date(now - (past ? 7 : 0) * 86400_000 - 3600_000).toISOString().slice(0, 16);
  const end = new Date(now + 7 * 86400_000).toISOString().slice(0, 16);
  const c = useApi<{ events: CalEvent[] }>(`/api/calendar?start=${start}&end=${end}`, 60 * 60_000);
  const [imp, setImp] = useState<"High" | "Medium">("Medium");
  const ev = (c.data?.events ?? []).filter((e) => ccys.includes(e.country) && (e.impact === "High" || (imp === "Medium" && e.impact === "Medium")));
  let lastDay = "";
  return (
    <Panel className={className} title={title} right={<><Seg value={imp} options={[["High", "Fort"], ["Medium", "Fort + moyen"]]} onChange={setImp} /><SourceTag env={c.env} /></>}>
      <State loading={c.loading && !c.data} error={c.error} empty={c.data && !ev.length ? "Aucune publication importante sur la période." : false} />
      {ev.length > 0 && <table className="text-[11px]">
        <tbody>{ev.map((e) => {
          const d = eventDay(e.time), head = d !== lastDay; lastDay = d;
          const done = new Date(e.time).getTime() < now;
          return [head && <tr key={e.id + "h"}><td colSpan={5} className="bg-raised text-[10px] uppercase tracking-wider text-dim">{d}</td></tr>,
            <tr key={e.id} className={done ? "opacity-60" : ""}>
              <td className="num text-dim">{eventTime(e.time)}</td>
              <td><span className={`mr-1 inline-block h-2 w-2 ${IMPACT_CLS[e.impact] ?? "bg-dim"}`} title={`Impact ${IMPACT_FR[e.impact] ?? e.impact}`} /><span className="text-amber">{e.country}</span></td>
              <td className="max-w-[180px] truncate" title={e.title}>{e.title}</td>
              <td className="num text-dim" title="Consensus · précédent">{e.forecast || "–"} · {e.previous || "–"}</td>
              {past && <td className={`num ${tone(e.surprise)}`} title="Chiffre publié (surprise vs consensus)">{e.actual || ""}</td>}
            </tr>];
        })}</tbody>
      </table>}
    </Panel>
  );
}

