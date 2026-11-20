"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import Export from "@/components/Export";
import { Num, Out, Panel, RangeBar, Seg, SourceTag, Spark, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, num, pct, price, tone } from "@/lib/format";
import * as Q from "@/lib/quant";

type Row = { key: string; group: string; name: string; symbol: string; unit: string; exchange: string; curve: boolean; cot: string | null; error?: string;
  last?: number; d1?: number; w1?: number; m1?: number; ytd?: number; hi52?: number; lo52?: number; range_pos?: number; vol20?: number; spark?: number[] };
type Board = { rows: Row[]; unavailable: { group: string; name: string; reason: string }[] };
type Pt = { symbol: string; expiry: string; months: number; price: number; change_pct: number | null; time: number; last_trade: string; days_left: number; expiring: boolean };
type Curve = { key: string; name: string; unit: string; exchange: string; contract_size: number; points: Pt[]; shape: string; m1_m2: number; m1_m12: number; m12_label: string; slope_pct: number; roll_yield_pct: number; expiry_note: string };
type Inv = { key: string; label: string; unit: string; last?: number; date?: string; change?: number; avg5?: number; min5?: number; max5?: number; vs_avg5_pct?: number; points?: { date: string; value: number }[]; error?: string };
type Cot = { name: string; market: string; net_spec: number; net_spec_change: number; net_comm: number; cot_index: number; zscore: number; spec_pct_oi: number; rows: { date: string; net_spec: number; net_comm: number; oi: number }[] };

const TABS = [["board", "Tableau"], ["curve", "Courbes à terme"], ["spreads", "Spreads et portage"], ["season", "Saisonnalité"], ["eia", "Stocks EIA"],
  ["cot", "Positionnement CFTC"], ["hedge", "Couverture"], ["desk", "Desk énergie et métaux"]] as const;
type Tab = (typeof TABS)[number][0];
const MON = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const ym = (s: string) => { const [y, m] = s.split("-"); return `${MON[+m - 1]} ${y.slice(2)}`; };

function useBoard() { return useApi<Board>("/api/commodities/board", 5 * 60_000); }
function Picker({ value, onChange, filter }: { value: string; onChange: (k: string) => void; filter?: (r: Row) => boolean }) {
  const b = useBoard();
  return <select value={value} onChange={(e) => onChange(e.target.value)}>{(b.data?.rows ?? []).filter(filter ?? (() => true)).map((r) => <option key={r.key} value={r.key}>{r.group} · {r.name}</option>)}</select>;
}

function BoardTab() {
  const router = useRouter();
  const { data, env, error, loading } = useBoard();
  const groups = [...new Set((data?.rows ?? []).map((r) => r.group))];
  return (
    <Panel className="h-full" title="Matières premières · contrat le plus proche" right={<><Export name="matieres-premieres" columns={["Groupe", "Nom", "Symbole", "Unité", "Dernier", "1J %", "5S %", "21S %", "YTD %", "Vol 20j %"]}
      rows={(data?.rows ?? []).map((r) => [r.group, r.name, r.symbol, r.unit, r.last ?? null, r.d1 ?? null, r.w1 ?? null, r.m1 ?? null, r.ytd ?? null, r.vol20 ?? null])} source={env?.source} /><SourceTag env={env} /></>}>
      <State loading={loading && !data} error={error} />
      {data && <table>
        <thead><tr><th>Contrat</th><th>Place</th><th className="num">Dernier</th><th>Unité</th><th className="num">1J</th><th className="num">5S</th><th className="num">21S</th><th className="num">YTD</th>
          <th className="text-center">Fourchette 52s</th><th className="num">Vol 20j</th><th>60 séances</th><th>Outils</th></tr></thead>
        <tbody>{groups.map((g) => [
          <tr key={g}><td colSpan={12} className="bg-raised text-[10px] uppercase text-dim">{g}</td></tr>,
          ...data.rows.filter((r) => r.group === g).map((r) => (
            <tr key={r.key}>
              <td><Link href={`/des?s=${encodeURIComponent(r.symbol)}`} className="text-amber hover:underline">{r.name}</Link> <span className="text-dim">{r.symbol}</span></td>
              <td className="text-dim">{r.exchange}</td>
              {r.error ? <td colSpan={8} className="text-down">{r.error}</td> : <>
                <td className="num text-fg">{price(r.last)}</td><td className="text-dim">{r.unit}</td>
                <td className={`num ${tone(r.d1)}`}>{pct(r.d1)}</td><td className={`num ${tone(r.w1)}`}>{pct(r.w1)}</td><td className={`num ${tone(r.m1)}`}>{pct(r.m1)}</td><td className={`num ${tone(r.ytd)}`}>{pct(r.ytd)}</td>
                <td className="text-center"><RangeBar pos={r.range_pos} /></td><td className="num">{num(r.vol20, 1)}</td></>}
              <td><Spark values={r.spark} /></td>
              <td className="space-x-1">
                {r.curve && <button onClick={() => router.push(`/cmdty?tab=curve&k=${r.key}`)} className="text-info hover:text-amber">courbe</button>}
                {r.cot && <button onClick={() => router.push(`/cmdty?tab=cot&k=${r.key}`)} className="text-info hover:text-amber">COT</button>}
                <button onClick={() => router.push(`/cmdty?tab=season&k=${r.key}`)} className="text-info hover:text-amber">saison</button>
                <Link href={`/graphique?s=${encodeURIComponent(r.symbol)}`} className="text-info hover:text-amber">GP</Link>
              </td>
            </tr>))])}</tbody>
      </table>}
      {data && <div className="border-t border-line px-2 py-1 text-dim">
        <span className="text-amber">Non couverts</span> (aucune source gratuite fiable, rien n&apos;est simulé) : {data.unavailable.map((u) => <span key={u.name} className="mr-3" title={u.reason}>{u.name} <span className="text-[10px]">({u.reason})</span></span>)}
      </div>}
    </Panel>
  );
}

function CurveTab({ k, setK }: { k: string; setK: (k: string) => void }) {
  const c = useApi<Curve>(`/api/commodities/curve?key=${k}`, 5 * 60_000);
  const d = c.data;
  const [a, setA] = useState(0), [b, setB] = useState(3);
  const [lots, setLots] = useState(10), [entry, setEntry] = useState(NaN);
  const pa = d?.points[Math.min(a, (d?.points.length ?? 1) - 1)], pb = d?.points[Math.min(b, (d?.points.length ?? 1) - 1)];
  const sp = useApi<{ rows: { date: string; a: number; b: number; spread: number }[] }>(pa && pb && pa.symbol !== pb.symbol ? `/api/commodities/spread?a=${pa.symbol}&b=${pb.symbol}` : null);
  const cur = pa && pb ? pa.price - pb.price : NaN;
  const curveOpt = useMemo(() => d && lineOption([{ name: `${d.name} (${d.unit})`, data: d.points.map((p) => [ym(p.expiry), p.price]) }], { category: d.points.map((p) => ym(p.expiry)), legend: false }), [d]);
  const spOpt = useMemo(() => sp.data && lineOption([{ name: `${pa?.symbol} − ${pb?.symbol}`, data: sp.data.rows.map((r) => [r.date, r.spread]) }], { legend: false }), [sp.data, pa, pb]);
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 lg:col-span-7" title={<span>Courbe à terme · <Picker value={k} onChange={setK} filter={(r) => r.curve} /></span>} right={<SourceTag env={c.env} />}>
        <State loading={c.loading && !d} error={c.error} />
        {d && <>
          <div className="h-64">{curveOpt && <EChart option={curveOpt} />}</div>
          <div className="grid grid-cols-2 gap-x-6 px-2 py-1 md:grid-cols-3">
            <Out label="Structure" value={d.shape} cls={d.shape === "backwardation" ? "text-up" : "text-amber"} title="Backwardation : contrat proche plus cher que les échéances lointaines (tension sur l'offre disponible). Contango : l'inverse (portage, stocks abondants)." />
            <Out label={`M1 − M2 (${d.unit})`} value={num(d.m1_m2, 3)} cls={tone(d.m1_m2)} />
            <Out label={`M1 − ${ym(d.m12_label)}`} value={num(d.m1_m12, 3)} cls={tone(d.m1_m12)} />
            <Out label="Pente M1 → 12 mois" value={pct(d.slope_pct)} />
            <Out label="Rendement de roulement annualisé" value={pct(d.roll_yield_pct)} cls={tone(d.roll_yield_pct)} title="(F1 / F2 − 1) annualisé : gain (ou coût) d'une position longue roulée du contrat proche vers le suivant, à courbe inchangée." />
            <Out label="Taille du contrat" value={big(d.contract_size)} />
          </div>
        </>}
      </Panel>
      <Panel className="col-span-12 lg:col-span-5" title="Échéances" right={d && <Export name={`courbe-${k}`} columns={["Contrat", "Échéance", "Prix", "Var. %"]} rows={d.points.map((p) => [p.symbol, p.expiry, p.price, p.change_pct])} source={c.env?.source} />}>
        {d && <table><thead><tr><th>Contrat</th><th>Échéance</th><th className="num">Prix</th><th className="num">1J</th><th className="num">vs M1</th><th className="num">Roulement ann.</th><th className="num">Dernier jour</th></tr></thead>
          <tbody>{d.points.map((p, i) => <tr key={p.symbol}><td className="text-amber">{p.symbol}</td><td>{ym(p.expiry)}</td><td className="num text-fg">{price(p.price)}</td>
            <td className={`num ${tone(p.change_pct)}`}>{pct(p.change_pct)}</td><td className={`num ${tone(p.price - d.points[0].price)}`}>{i ? num(p.price - d.points[0].price, 3) : "–"}</td>
            <td className="num">{i ? pct(Q.rollYield(d.points[0].price, p.price, (p.months - d.points[0].months) * 30.4) * 100) : "–"}</td>
            <td className={`num ${p.expiring ? "text-amber" : "text-dim"}`} title={p.expiring ? "Expire dans moins de 5 jours ouvrés : exclu du calcul de la structure" : undefined}>{p.last_trade.slice(8)}/{p.last_trade.slice(5, 7)} ({p.days_left} j){p.expiring ? " ⚠" : ""}</td></tr>)}</tbody></table>}
        {d && <div className="px-2 py-1 text-[10px] text-dim">{d.expiry_note}</div>}
      </Panel>
      <Panel className="col-span-12 lg:col-span-7" title="Spread calendaire : historique" right={<SourceTag env={sp.env} />}>
        {d && <div className="flex flex-wrap items-center gap-2 px-2 py-1">
          Long <select value={a} onChange={(e) => setA(+e.target.value)}>{d.points.map((p, i) => <option key={p.symbol} value={i}>{p.symbol} ({ym(p.expiry)})</option>)}</select>
          − Court <select value={b} onChange={(e) => setB(+e.target.value)}>{d.points.map((p, i) => <option key={p.symbol} value={i}>{p.symbol} ({ym(p.expiry)})</option>)}</select>
          <span>spread actuel <span className={tone(cur)}>{num(cur, 3)}</span> {d.unit}</span>
        </div>}
        <State loading={sp.loading && !sp.data} error={sp.error} />
        <div className="h-56">{spOpt && <EChart option={spOpt} />}</div>
      </Panel>
      <Panel className="col-span-12 lg:col-span-5" title="P&L d'une position de spread">
        {d && <div className="px-2 py-1">
          <Num label="Nombre de spreads (lots)" value={lots} onChange={setLots} step={1} />
          <Num label={`Prix d'entrée du spread (${d.unit})`} value={Number.isNaN(entry) ? Math.round(cur * 1e4) / 1e4 : entry} onChange={setEntry} step={0.01} />
          <Out label="Spread actuel" value={num(cur, 3)} />
          <Out label="P&L latent" value={`${num(((cur - (Number.isNaN(entry) ? cur : entry)) * lots * d.contract_size), 0)} $`} cls={tone(cur - (Number.isNaN(entry) ? cur : entry))} title="(spread actuel − spread d'entrée) × lots × taille du contrat. Pour les contrats cotés en cents, diviser par 100." />
          <Out label="Sensibilité : 1 unité de spread" value={`${big(lots * d.contract_size)} $`} />
          <div className="pt-1 text-[10px] text-dim">Achat du spread = long {pa?.symbol}, court {pb?.symbol}. Gagne si l&apos;écart s&apos;élargit (backwardation qui se renforce).</div>
        </div>}
      </Panel>
    </div>
  );
}

function SpreadsTab() {
  const q = useApi<{ symbol: string; price?: number }[]>("/api/market/quotes?symbols=CL=F,RB=F,HO=F,ZS=F,ZM=F,ZL=F,TTF=F,NG=F", 60_000);
  const m = Object.fromEntries((q.data ?? []).map((x) => [x.symbol, x.price ?? NaN]));
  const [power, setPower] = useState(90), [heat, setHeat] = useState(2), [co2, setCo2] = useState(70), [ef, setEf] = useState(0.37);
  const [spot, setSpot] = useState(NaN), [r, setR] = useState(4.5), [stor, setStor] = useState(3), [conv, setConv] = useState(1), [T, setT] = useState(0.5), [fwdIn, setFwdIn] = useState(NaN);
  const [qty, setQty] = useState(100_000), [cpm, setCpm] = useState(0.5), [months, setMonths] = useState(6);
  const S = Number.isNaN(spot) ? m["CL=F"] : spot;
  const F = Q.carryForward(S, r / 100, stor / 100, conv / 100, T);
  const fwd = Number.isNaN(fwdIn) ? F : fwdIn;
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Crack spread 3-2-1 (raffinage US)" right={<SourceTag env={q.env} />}>
        <div className="px-2 py-1">
          <Out label="WTI ($/baril)" value={price(m["CL=F"])} /><Out label="Essence RBOB ($/gallon)" value={price(m["RB=F"])} /><Out label="Diesel ULSD ($/gallon)" value={price(m["HO=F"])} />
          <Out label="Crack 3-2-1 ($/baril)" value={num(Q.crack321(m["CL=F"], m["RB=F"], m["HO=F"]), 2)} cls="text-amber" />
          <Out label="Crack essence ($/baril)" value={num(m["RB=F"] * 42 - m["CL=F"], 2)} /><Out label="Crack diesel ($/baril)" value={num(m["HO=F"] * 42 - m["CL=F"], 2)} />
          <div className="pt-1 text-[10px] text-dim">(2 × RBOB × 42 + ULSD × 42 − 3 × WTI) / 3, contrats les plus proches. Marge brute indicative d&apos;une raffinerie.</div>
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Crush du soja (trituration)" right={<SourceTag env={q.env} />}>
        <div className="px-2 py-1">
          <Out label="Soja (¢/boisseau)" value={price(m["ZS=F"])} /><Out label="Tourteau ($/tonne courte)" value={price(m["ZM=F"])} /><Out label="Huile (¢/livre)" value={price(m["ZL=F"])} />
          <Out label="Board crush ($/boisseau)" value={num(Q.soyCrush(m["ZM=F"], m["ZL=F"], m["ZS=F"]), 3)} cls="text-amber" />
          <Out label="Part de l'huile dans la valeur" value={pct(m["ZL=F"] * 0.11 / (m["ZL=F"] * 0.11 + m["ZM=F"] * 0.022) * 100)} />
          <div className="pt-1 text-[10px] text-dim">Un boisseau donne environ 44 livres de tourteau (0,022 tonne courte) et 11 livres d&apos;huile.</div>
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Spark spread (production électrique au gaz)">
        <div className="px-2 py-1">
          <Num label="Électricité (€/MWh)" value={power} onChange={setPower} suffix="saisie" title="Aucun prix d'électricité gratuit fiable : à saisir (EEX, Epex)." />
          <Out label="Gaz TTF (€/MWh), cours" value={price(m["TTF=F"])} />
          <Num label="Taux de chaleur (MWh gaz / MWh élec.)" value={heat} onChange={setHeat} step={0.05} />
          <Num label="CO₂ (€/t)" value={co2} onChange={setCo2} suffix="saisie" /><Num label="Facteur d'émission (t/MWh)" value={ef} onChange={setEf} step={0.01} />
          <Out label="Spark spread (sans CO₂)" value={num(Q.sparkSpread(power, m["TTF=F"], heat), 2)} />
          <Out label="Clean spark spread" value={num(Q.sparkSpread(power, m["TTF=F"], heat, co2, ef), 2)} cls="text-amber" />
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6" title="Coût de portage et rendement d'opportunité">
        <div className="grid grid-cols-1 gap-x-6 px-2 py-1 md:grid-cols-2">
          <div>
            <Num label="Prix comptant (défaut : WTI M1)" value={S} onChange={setSpot} step={0.01} />
            <Num label="Taux sans risque" value={r} onChange={setR} step={0.1} suffix="%" />
            <Num label="Coût de stockage" value={stor} onChange={setStor} step={0.1} suffix="%/an" />
            <Num label="Rendement d'opportunité" value={conv} onChange={setConv} step={0.1} suffix="%/an" />
            <Num label="Maturité" value={T} onChange={setT} step={0.25} suffix="ans" />
          </div>
          <div>
            <Out label="Prix à terme de portage" value={num(F, 3)} cls="text-amber" />
            <Out label="Base (F − S)" value={num(F - S, 3)} />
            <Num label="Prix à terme observé" value={fwd} onChange={setFwdIn} step={0.01} />
            <Out label="Rendement d'opportunité implicite" value={pct(Q.impliedConvenience(S, fwd, r / 100, stor / 100, T) * 100)} title="r + stockage − ln(F/S)/T" />
            <Out label="Rendement de roulement implicite" value={pct((S / fwd - 1) / T * 100)} />
          </div>
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6" title="Coût de stockage physique">
        <div className="px-2 py-1">
          <Num label="Quantité (barils, tonnes…)" value={qty} onChange={setQty} step={1000} />
          <Num label="Coût par unité et par mois" value={cpm} onChange={setCpm} step={0.05} suffix="$" />
          <Num label="Durée" value={months} onChange={setMonths} step={1} suffix="mois" />
          <Out label="Stockage" value={`${big(Q.storageCost(qty, cpm, months))} $`} />
          <Out label={`Financement du stock (${r} %/an)`} value={`${big(qty * S * r / 100 * months / 12)} $`} />
          <Out label="Coût total de portage par unité" value={`${num((Q.storageCost(qty, cpm, months, r / 100, S)) / qty, 3)} $`} cls="text-amber" />
          <div className="pt-1 text-[10px] text-dim">Le stockage est rentable (cash and carry) si le contango sur la période dépasse ce coût par unité.</div>
        </div>
      </Panel>
    </div>
  );
}

function SeasonTab({ k, setK }: { k: string; setK: (k: string) => void }) {
  const s = useApi<{ name: string; years: number; months: { month: number; avg: number | null; median: number | null; hit: number | null; n: number }[] }>(`/api/commodities/seasonality?key=${k}`);
  const opt = useMemo(() => s.data && {
    grid: { left: 8, right: 8, top: 10, bottom: 6, containLabel: true }, tooltip: { trigger: "axis", valueFormatter: (v: number) => pct(v) },
    xAxis: { type: "category", data: MON, axisLabel: { color: "#7486a0" } }, yAxis: { type: "value", axisLabel: { color: "#7486a0", formatter: (v: number) => `${v} %` }, splitLine: { lineStyle: { color: "#0e1828" } } },
    series: [{ type: "bar", data: s.data.months.map((m) => ({ value: m.avg, itemStyle: { color: (m.avg ?? 0) >= 0 ? "#1fd15f" : "#ff4d4d" } })) }],
  }, [s.data]);
  return (
    <Panel className="h-full" title={<span>Saisonnalité · <Picker value={k} onChange={setK} /></span>} right={<SourceTag env={s.env} />}>
      <State loading={s.loading && !s.data} error={s.error} />
      {s.data && <div className="grid h-full grid-cols-12">
        <div className="col-span-12 h-72 lg:col-span-7">{opt && <EChart option={opt} />}</div>
        <div className="col-span-12 lg:col-span-5"><table><thead><tr><th>Mois</th><th className="num">Moyenne</th><th className="num">Médiane</th><th className="num">% de hausse</th><th className="num">Années</th></tr></thead>
          <tbody>{s.data.months.map((m) => <tr key={m.month}><td>{MON[m.month - 1]}</td><td className={`num ${tone(m.avg)}`}>{pct(m.avg)}</td><td className={`num ${tone(m.median)}`}>{pct(m.median)}</td><td className="num">{num(m.hit, 0)} %</td><td className="num text-dim">{m.n}</td></tr>)}</tbody></table>
          <div className="px-2 py-1 text-[10px] text-dim">Rendement mensuel du contrat le plus proche (série continue, sauts de roulement inclus) sur les {s.data.years} dernières années.</div></div>
      </div>}
    </Panel>
  );
}

function EiaTab() {
  const e = useApi<Inv[]>("/api/commodities/inventories", 30 * 60_000);
  const [sel, setSel] = useState("crude");
  const cur = e.data?.find((x) => x.key === sel);
  const opt = useMemo(() => cur?.points && lineOption([{ name: cur.label, data: cur.points.map((p) => [p.date, p.value]) }], { legend: false, decimals: 0 }), [cur]);
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 lg:col-span-6" title="Stocks et production US · rapport hebdomadaire" right={<SourceTag env={e.env} />}>
        <State loading={e.loading && !e.data} error={e.error} />
        {e.data && <table><thead><tr><th>Série</th><th className="num">Dernier</th><th className="num">Var. sem.</th><th className="num">Moy. 5 ans</th><th className="num">vs moy.</th><th className="num">Min–max 5 ans</th></tr></thead>
          <tbody>{e.data.map((x) => <tr key={x.key} className={`cursor-pointer ${x.key === sel ? "bg-raised" : ""}`} onClick={() => setSel(x.key)}>
            <td className={x.key === sel ? "text-amber" : ""}>{x.label} <span className="text-dim">{x.unit}</span></td>
            {x.error ? <td colSpan={5} className="text-down">{x.error}</td> : <>
              <td className="num text-fg">{num(x.last, x.unit === "%" ? 1 : 0)}</td><td className={`num ${tone(x.change)}`}>{x.change == null ? "–" : (x.change > 0 ? "+" : "") + num(x.change, x.unit === "%" ? 1 : 0)}</td>
              <td className="num">{num(x.avg5, 0)}</td><td className={`num ${tone(x.vs_avg5_pct)}`}>{pct(x.vs_avg5_pct)}</td><td className="num text-dim">{num(x.min5, 0)} – {num(x.max5, 0)}</td></>}</tr>)}</tbody></table>}
        {e.data && <div className="px-2 py-1 text-[10px] text-dim">Relevé du {e.data[0]?.date}. Moyenne et fourchette : même semaine des 5 années précédentes. Publication : mercredi (pétrole), jeudi (gaz).</div>}
      </Panel>
      <Panel className="col-span-12 lg:col-span-6" title={cur?.label ?? "Série"}>
        <div className="h-80">{opt && <EChart option={opt} />}</div>
      </Panel>
    </div>
  );
}

function CotTab({ k, setK }: { k: string; setK: (k: string) => void }) {
  const c = useApi<Cot>(`/api/commodities/cot?key=${k}`, 60 * 60_000);
  const opt = useMemo(() => c.data && lineOption([
    { name: "Spéculateurs (non commerciaux), net", data: c.data.rows.map((r) => [r.date, r.net_spec]) },
    { name: "Commerciaux (couvreurs), net", data: c.data.rows.map((r) => [r.date, r.net_comm]) }], { decimals: 0 }), [c.data]);
  const d = c.data;
  return (
    <Panel className="h-full" title={<span>Positionnement · <Picker value={k} onChange={setK} filter={(r) => !!r.cot} /></span>} right={<SourceTag env={c.env} />}>
      <State loading={c.loading && !d} error={c.error} />
      {d && <div className="grid h-full grid-cols-12">
        <div className="col-span-12 h-80 lg:col-span-8"><EChart option={opt} /></div>
        <div className="col-span-12 px-2 lg:col-span-4">
          <div className="py-1 text-dim">{d.market}</div>
          <Out label="Position nette des spéculateurs (contrats)" value={num(d.net_spec, 0)} cls={tone(d.net_spec)} />
          <Out label="Variation sur la semaine" value={num(d.net_spec_change, 0)} cls={tone(d.net_spec_change)} />
          <Out label="Indice COT 3 ans (0 = plus court, 100 = plus long)" value={num(d.cot_index, 0)} cls={d.cot_index > 80 || d.cot_index < 20 ? "text-amber" : ""} />
          <Out label="Z-score 3 ans" value={num(d.zscore, 2)} />
          <Out label="Net spéculatif en % de l'intérêt ouvert" value={pct(d.spec_pct_oi)} />
          <Out label="Position nette des commerciaux" value={num(d.net_comm, 0)} cls={tone(d.net_comm)} />
          <div className="pt-2 text-[10px] text-dim">Rapport « legacy », futures seuls, positions du mardi publiées le vendredi. Un indice COT extrême signale un positionnement encombré, pas un signal d&apos;entrée en soi.</div>
        </div>
      </div>}
    </Panel>
  );
}

function HedgeTab() {
  const [spotSym, setSpotSym] = useState("USO"), [futSym, setFutSym] = useState("CL=F");
  const [units, setUnits] = useState(500_000), [size, setSize] = useState(1000), [move, setMove] = useState(-15);
  const a = useApi<{ candles: { time: number; close: number }[] }>(`/api/market/history?symbol=${encodeURIComponent(spotSym)}&interval=1d&range=1y`);
  const b = useApi<{ candles: { time: number; close: number }[] }>(`/api/market/history?symbol=${encodeURIComponent(futSym)}&interval=1d&range=1y`);
  const res = useMemo(() => {
    if (!a.data || !b.data) return null;
    const day = (t: number) => Math.floor(t / 86400);
    const mb = new Map(b.data.candles.map((c) => [day(c.time), c.close]));
    const pairs = a.data.candles.filter((c) => mb.has(day(c.time))).map((c) => [c.close, mb.get(day(c.time))!] as const);
    if (pairs.length < 30) return null;
    const rs = pairs.slice(1).map((p, i) => p[0] / pairs[i][0] - 1), rf = pairs.slice(1).map((p, i) => p[1] / pairs[i][1] - 1);
    return { ...Q.minVarHedge(rs, rf, units, size), n: rs.length, spot: pairs.at(-1)![0], fut: pairs.at(-1)![1] };
  }, [a.data, b.data, units, size]);
  return (
    <Panel className="h-full" title="Simulation de couverture par contrats à terme" right={<SourceTag env={b.env} />}>
      <div className="grid grid-cols-12 gap-4 px-2 py-1">
        <div className="col-span-12 md:col-span-5">
          <label className="flex justify-between py-0.5"><span className="text-dim">Exposition (symbole du risque physique ou de l&apos;actif)</span><input value={spotSym} onChange={(e) => setSpotSym(e.target.value.toUpperCase())} className="w-28" /></label>
          <label className="flex justify-between py-0.5"><span className="text-dim">Instrument de couverture (contrat)</span><input value={futSym} onChange={(e) => setFutSym(e.target.value.toUpperCase())} className="w-28" /></label>
          <Num label="Exposition (unités du sous-jacent couvert)" value={units} onChange={setUnits} step={1000} />
          <Num label="Taille d'un contrat (unités)" value={size} onChange={setSize} step={1} />
          <Num label="Scénario de prix du contrat" value={move} onChange={setMove} step={1} suffix="%" />
          <State error={a.error || b.error} />
        </div>
        {res && <div className="col-span-12 md:col-span-7">
          <Out label="Ratio de couverture à variance minimale h*" value={num(res.hedgeRatio, 3)} cls="text-amber" />
          <Out label="Corrélation des rendements quotidiens" value={num(res.correlation, 3)} />
          <Out label="Efficacité de la couverture (R²)" value={pct(res.effectiveness * 100)} />
          <Out label="Contrats à vendre" value={num(res.contracts, 1)} cls="text-amber" />
          <Out label="Arrondi" value={`${Math.round(res.contracts)} contrats`} />
          <Out label="Exposition non couverte : P&L du scénario" value={`${big(units * res.spot * res.hedgeRatio * move / 100)} (devise du sous-jacent, approx.)`} cls={tone(move)} />
          <Out label="P&L de la couverture (vente de futures)" value={`${big(-Math.round(res.contracts) * size * res.fut * move / 100)}`} cls={tone(-move)} />
          <div className="pt-1 text-[10px] text-dim">Estimation sur {res.n} séances communes (un an). h* = ρ · σ(exposition) / σ(contrat). Le risque de base résiduel vaut 1 − R² de la variance.</div>
        </div>}
      </div>
    </Panel>
  );
}

function DeskTab() {
  const keys = ["BRENT", "WTI", "NG", "GC", "HG"];
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      {keys.map((k) => <MiniCurve key={k} k={k} />)}
      <MiniCot k="WTI" /><MiniCot k="GC" /><SpreadsSummary />
    </div>
  );
}
function MiniCurve({ k }: { k: string }) {
  const c = useApi<Curve>(`/api/commodities/curve?key=${k}`, 5 * 60_000);
  const opt = useMemo(() => c.data && lineOption([{ name: c.data.name, data: c.data.points.map((p) => [ym(p.expiry), p.price]) }], { category: c.data.points.map((p) => ym(p.expiry)), legend: false }), [c.data]);
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title={<Link href={`/cmdty?tab=curve&k=${k}`}>{c.data?.name ?? k} · courbe</Link>} right={<SourceTag env={c.env} />}>
      <State loading={c.loading && !c.data} error={c.error} />
      {c.data && <><div className="h-36"><EChart option={opt} /></div>
        <div className="flex justify-between px-2 text-[11px]"><span>M1 <span className="text-fg">{price(c.data.points[0].price)}</span> <span className={tone(c.data.points[0].change_pct)}>{pct(c.data.points[0].change_pct)}</span></span>
          <span className={c.data.shape === "backwardation" ? "text-up" : "text-amber"}>{c.data.shape}</span><span>roulement {pct(c.data.roll_yield_pct)}</span></div></>}
    </Panel>
  );
}
function MiniCot({ k }: { k: string }) {
  const c = useApi<Cot>(`/api/commodities/cot?key=${k}`, 60 * 60_000);
  const opt = useMemo(() => c.data && lineOption([{ name: "Net spéculatif", data: c.data.rows.slice(-104).map((r) => [r.date, r.net_spec]) }], { legend: false, decimals: 0 }), [c.data]);
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title={`COT · ${c.data?.name ?? k}`} right={<SourceTag env={c.env} />}>
      <State loading={c.loading && !c.data} error={c.error} />
      {c.data && <><div className="h-36"><EChart option={opt} /></div><div className="flex justify-between px-2 text-[11px]"><span>net {num(c.data.net_spec, 0)}</span><span>indice COT {num(c.data.cot_index, 0)}</span><span>z {num(c.data.zscore, 2)}</span></div></>}
    </Panel>
  );
}
function SpreadsSummary() {
  const q = useApi<{ symbol: string; price?: number }[]>("/api/market/quotes?symbols=CL=F,RB=F,HO=F,BZ=F,GC=F,SI=F,HG=F", 60_000);
  const m = Object.fromEntries((q.data ?? []).map((x) => [x.symbol, x.price ?? NaN]));
  return (
    <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Spreads clés" right={<SourceTag env={q.env} />}>
      <div className="px-2 py-1">
        <Out label="Brent − WTI ($/baril)" value={num(m["BZ=F"] - m["CL=F"], 2)} />
        <Out label="Crack 3-2-1 ($/baril)" value={num(Q.crack321(m["CL=F"], m["RB=F"], m["HO=F"]), 2)} />
        <Out label="Ratio or / argent" value={num(m["GC=F"] / m["SI=F"], 1)} />
        <Out label="Ratio cuivre / or (×1000)" value={num(m["HG=F"] / m["GC=F"] * 1000, 3)} title="Baromètre cyclique : hausse = anticipations de croissance" />
        <Link href="/cmdty?tab=spreads" className="mt-1 block text-info hover:text-amber">tous les calculateurs de spreads →</Link>
      </div>
    </Panel>
  );
}

export default function Commodities() {
  const sp = useSearchParams(); const router = useRouter();
  const tab = (sp.get("tab") as Tab) || "board";
  const k = sp.get("k") || "WTI";
  const go = (t: string, key = k) => router.replace(`/cmdty?tab=${t}&k=${key}`);
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-line bg-panel px-2 py-1">
        <span className="text-[11px] uppercase tracking-wider text-amber">CMDTY · matières premières</span>
        <Seg value={tab} options={TABS as unknown as [Tab, string][]} onChange={(t) => go(t)} />
      </div>
      <div className="min-h-0 flex-1">
        {tab === "board" && <BoardTab />}
        {tab === "curve" && <CurveTab k={k} setK={(x) => go("curve", x)} />}
        {tab === "spreads" && <SpreadsTab />}
        {tab === "season" && <SeasonTab k={k} setK={(x) => go("season", x)} />}
        {tab === "eia" && <EiaTab />}
        {tab === "cot" && <CotTab k={k} setK={(x) => go("cot", x)} />}
        {tab === "hedge" && <HedgeTab />}
        {tab === "desk" && <DeskTab />}
      </div>
    </div>
  );
}
