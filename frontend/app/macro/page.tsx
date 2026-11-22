"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import EChart, { lineOption, type Line } from "@/components/EChart";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi, useRaw } from "@/lib/api";
import { dateOnly, num } from "@/lib/format";

type Row = { date: string } & Record<string, number | null>;
type Yields = { nominal: Row[]; real: Row[] };
type Ind = { key: string; id: string; label: string; unit: string; group: string; transform: string };
type IndData = Ind & { title: string; last_updated: string; obs: [string, number][] };

const MATS = ["1M", "3M", "6M", "1A", "2A", "3A", "5A", "7A", "10A", "20A", "30A"];
const KEY_ROWS = [
  { id: "3M", label: "Bon du Trésor 3 mois" }, { id: "2A", label: "Taux 2 ans" }, { id: "5A", label: "Taux 5 ans" }, { id: "10A", label: "Taux 10 ans" }, { id: "30A", label: "Taux 30 ans" },
  { id: "2A-10A", label: "Écart 2-10 ans" }, { id: "3M-10A", label: "Écart 3 mois-10 ans" }, { id: "R10A", label: "Taux réel 10 ans (TIPS)" },
];
const HORIZONS = { "1A": 1, "2A": 2, "5A": 5, Max: 99 } as const;

/** Dernière ligne dont la date est ≤ à la date cible. */
function at(rows: Row[], iso: string): Row | undefined {
  let lo = 0, hi = rows.length - 1, best: Row | undefined;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= iso) { best = rows[m]; lo = m + 1; } else hi = m - 1; }
  return best;
}
function shift(iso: string, days: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }
function value(y: Yields, id: string, r: Row | undefined, real?: Row): number | null {
  if (id === "R10A") return real?.["10A"] ?? null;
  if (!r) return null;
  if (id.includes("-")) { const [a, b] = id.split("-"); return r[a] != null && r[b] != null ? (r[b]! - r[a]!) : null; }
  return r[id] ?? null;
}
const bp = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 100));
const Bp = ({ v }: { v: number | null }) => <td className={`num ${v == null || v === 0 ? "text-dim" : v > 0 ? "text-up" : "text-down"}`}>{v == null ? "–" : (v > 0 ? "+" : "") + v}</td>;

function Indicator({ ind }: { ind: Ind }) {
  const { data, env, error, loading } = useApi<IndData>(`/api/macro/indicator?key=${ind.key}&start=2005-01-01`);
  const last = data?.obs.at(-1), prev = data?.obs.at(-2);
  const dec = Math.abs(last?.[1] ?? 0) >= 1000 ? 0 : 2;
  const opt = useMemo(() => data && lineOption([{ name: ind.label, data: data.obs }], { legend: false, decimals: dec }), [data, ind.label, dec]);
  return (
    <Panel title={ind.label} right={<SourceTag env={env} />} className="h-44">
      {error || loading ? <State loading={loading} error={error} /> : (
        <div className="flex h-full flex-col">
          <div className="flex items-baseline gap-2 px-2 pt-1">
            <span className="text-lg text-fg">{num(last?.[1], dec)}</span><span className="text-dim">{ind.unit}</span>
            <span className="ml-auto text-dim">{last && dateOnly(last[0])} · préc. {num(prev?.[1], dec)}</span>
          </div>
          <div className="min-h-0 flex-1">{opt && <EChart option={opt} />}</div>
        </div>
      )}
    </Panel>
  );
}

export default function Macro() {
  const y = useApi<Yields>("/api/macro/yields");
  const cat = useRaw<Ind[]>("/api/macro/catalog");
  const status = useRaw<{ keys: { fred: boolean } }>("/api/status");
  const [sel, setSel] = useState("10A");
  const [hz, setHz] = useState<keyof typeof HORIZONS>("5A");
  const [custom, setCustom] = useState("");
  const nominal = y.data?.nominal ?? [], real = y.data?.real ?? [];
  const last = nominal.at(-1);

  const curve = useMemo(() => {
    if (!last) return null;
    const refs: [string, Row | undefined][] = [[`Dernière (${dateOnly(last.date)})`, last], ["Il y a 1 mois", at(nominal, shift(last.date, 30))], ["Il y a 1 an", at(nominal, shift(last.date, 365))]];
    if (custom) { const r = at(nominal, custom); if (r) refs.push([dateOnly(r.date), r]); }
    const lines: Line[] = refs.filter(([, r]) => r).map(([name, r], i) => ({ name, data: MATS.map((m) => [m, r![m] ?? null] as [string, number | null]), dashed: i > 0 }));
    return lineOption(lines, { category: MATS, unit: " %" });
  }, [nominal, last, custom]);

  const table = useMemo(() => {
    if (!last) return [];
    const rl = real.at(-1);
    const ref = (days: number) => [at(nominal, shift(last.date, days)), at(real, shift(rl?.date ?? last.date, days))] as const;
    const d1 = [nominal.at(-2), real.at(-2)] as const, m1 = ref(30), y1 = ref(365);
    return KEY_ROWS.map((k) => {
      const v = value(y.data!, k.id, last, rl);
      return { ...k, v, d1: bp(v, value(y.data!, k.id, d1[0], d1[1])), m1: bp(v, value(y.data!, k.id, m1[0], m1[1])), y1: bp(v, value(y.data!, k.id, y1[0], y1[1])) };
    });
  }, [nominal, real, last, y.data]);

  const hist = useMemo(() => {
    if (!last) return null;
    const from = shift(last.date, HORIZONS[hz] * 365);
    const src = sel === "R10A" ? real : nominal;
    const data = src.filter((r) => r.date >= from).map((r) => [r.date, sel === "R10A" ? r["10A"] ?? null : value(y.data!, sel, r)] as [string, number | null]);
    return lineOption([{ name: KEY_ROWS.find((k) => k.id === sel)!.label, data }], { unit: " %" });
  }, [sel, hz, nominal, real, last, y.data]);

  const groups = useMemo(() => { const g: Record<string, Ind[]> = {}; (cat.data ?? []).forEach((i) => (g[i.group] ??= []).push(i)); return g; }, [cat.data]);

  return (
    <div className="h-full overflow-auto">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 border border-line bg-panel px-2 py-1">
        <span className="text-[11px] uppercase tracking-wider text-amber">MAC · macro US</span>
        <span className="text-dim">États-Unis en haute fréquence : courbe du Trésor, inflation, emploi, activité, monnaie (FRED)</span>
        <span className="ml-auto flex gap-4">
          <Link href="/econ" className="text-info">ECST · taux directeurs et décisions des banques centrales →</Link>
          <Link href="/data?c=US" className="text-info">DATA · comparer les États-Unis aux autres pays →</Link>
        </span>
      </div>
      <div className="grid grid-cols-12 gap-1">
        <Panel title="Courbe des taux US" className="col-span-5 h-80" right={<><input type="date" value={custom} max={last?.date} onChange={(e) => setCustom(e.target.value)} title="Ajouter une date de comparaison" /><SourceTag env={y.env} /></>}>
          <State loading={y.loading} error={y.error} />{curve && <EChart option={curve} />}
        </Panel>
        <Panel title="Taux clés et écarts" className="col-span-3 h-80" right="variations en points de base">
          <State loading={y.loading} error={y.error} />
          <table><thead><tr><th>Série</th><th className="num">%</th><th className="num">1J</th><th className="num">1M</th><th className="num">1A</th></tr></thead>
            <tbody>{table.map((r) => (
              <tr key={r.id} onClick={() => setSel(r.id)} className={`cursor-pointer ${sel === r.id ? "bg-raised" : ""}`}>
                <td className={sel === r.id ? "text-amber" : ""}>{r.label}</td><td className="num">{num(r.v, 2)}</td><Bp v={r.d1} /><Bp v={r.m1} /><Bp v={r.y1} />
              </tr>))}</tbody></table>
        </Panel>
        <Panel title={`Historique · ${KEY_ROWS.find((k) => k.id === sel)!.label}`} className="col-span-4 h-80" right={<Seg value={hz} options={Object.keys(HORIZONS) as (keyof typeof HORIZONS)[]} onChange={setHz} />}>
          {hist && <EChart option={hist} />}
        </Panel>
      </div>
      {status.data && !status.data.keys.fred && (
        <div className="my-1 border border-amber/60 p-2 text-amber">
          Indicateurs US (inflation, emploi, PIB, monétaire) : clé FRED manquante. Créer une clé gratuite sur fred.stlouisfed.org, la mettre dans le fichier .env (FRED_API_KEY) et relancer.
          <span className="text-dim"> PMI ISM : non disponible gratuitement, module non alimenté.</span>
        </div>
      )}
      {status.data?.keys.fred && Object.entries(groups).map(([g, list]) => (
        <div key={g} className="mt-1">
          <div className="px-1 py-0.5 text-[11px] uppercase tracking-wider text-dim">{g}</div>
          <div className="grid grid-cols-4 gap-1">{list.map((i) => <Indicator key={i.key} ind={i} />)}</div>
        </div>
      ))}
    </div>
  );
}
