"use client";
import { useMemo, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import { Panel, SourceTag, State } from "@/components/ui";
import { useApi, useRaw } from "@/lib/api";
import { big, num } from "@/lib/format";

type Catalog = { countries: { code: string; name: string }[]; indicators: { key: string; label: string; category: string; unit: string; freq: string }[] };
type Row = { key: string; label: string; category: string; unit: string; freq: string; source: string; last: number; period: string; previous: number | null; spark: number[] };
type Series = { key: string; label: string; unit: string; freq: string; series: { country: string; name: string; obs: [string, number, string][] }[] };
const FREQ: Record<string, string> = { A: "annuel", T: "trimestriel", M: "mensuel", J: "quotidien" };
const val = (v: number | null | undefined) => (v == null ? "–" : Math.abs(v) >= 1e6 ? big(v) : num(v, 2));

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), w = 80, h = 16;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return <svg width={w} height={h} className="inline-block"><polyline points={pts} fill="none" stroke="#ffa028" strokeWidth="1" /></svg>;
}

export default function DataPage() {
  const cat = useRaw<Catalog>("/api/data/catalog");
  const [country, setCountry] = useState("FR");
  const [key, setKey] = useState("gdp_growth");
  const [cmp, setCmp] = useState<string[]>(["DE", "US"]);
  const table = useApi<{ country: string; rows: Row[] }>(`/api/data/table?country=${country}`);
  const all = [country, ...cmp.filter((c) => c !== country)];
  const ser = useApi<Series>(`/api/data/series?key=${key}&countries=${all.join(",")}`);
  const groups = useMemo(() => { const g = new Map<string, Row[]>(); (table.data?.rows ?? []).forEach((r) => (g.get(r.category) ?? g.set(r.category, []).get(r.category)!).push(r)); return [...g.entries()]; }, [table.data]);
  const option = useMemo(() => ser.data && lineOption(ser.data.series.map((s) => ({ name: s.name, data: s.obs.map((o) => [o[0], o[1]] as [string, number]), step: key === "policy" })), { decimals: Math.abs(ser.data.series[0]?.obs.at(-1)?.[1] ?? 0) >= 1e6 ? 0 : 2 }), [ser.data, key]);
  const name = (c: string) => cat.data?.countries.find((x) => x.code === c)?.name ?? c;

  const exportCsv = () => {
    if (!ser.data) return;
    const periods = [...new Set(ser.data.series.flatMap((s) => s.obs.map((o) => o[2])))].sort();
    const lines = [["periode", ...ser.data.series.map((s) => s.name)].join(";"), ...periods.map((p) => [p, ...ser.data!.series.map((s) => { const o = s.obs.find((x) => x[2] === p); return o ? String(o[1]).replace(".", ",") : ""; })].join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `${ser.data.key}_${all.join("-")}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex h-full gap-1">
      <Panel title="Pays" className="w-44 shrink-0">
        {cat.error && <State error={cat.error} />}
        {cat.data?.countries.map((c) => (
          <button key={c.code} onClick={() => setCountry(c.code)} className={`block w-full px-2 py-0.5 text-left ${c.code === country ? "bg-amber text-black" : "hover:bg-raised"}`}>{c.name}</button>))}
      </Panel>
      <Panel title={`Indicateurs · ${table.data?.country ?? name(country)}`} right={<SourceTag env={table.env} />} className="w-[46%] shrink-0">
        {table.env?.error && <div className="border-b border-down/60 px-2 py-1 text-down">{table.env.error}</div>}
        <State loading={table.loading && !table.data} error={table.error} />
        <table>
          <thead><tr><th>Indicateur</th><th className="num">Dernier</th><th className="num">Précédent</th><th>Unité</th><th>Période</th><th>Tendance</th><th>Source</th></tr></thead>
          <tbody>{groups.map(([g, rows]) => [
            <tr key={g}><td colSpan={7} className="bg-raised text-amber">{g}</td></tr>,
            ...rows.map((r) => (
              <tr key={r.key} onClick={() => setKey(r.key)} className={`cursor-pointer ${key === r.key ? "bg-raised" : ""}`}>
                <td className={key === r.key ? "text-amber" : ""}>{r.label}</td><td className="num">{val(r.last)}</td>
                <td className={`num ${r.previous == null || r.previous === r.last ? "text-dim" : r.last > r.previous ? "text-up" : "text-down"}`}>{val(r.previous)}</td>
                <td className="text-dim">{r.unit}</td><td className="text-dim" title={FREQ[r.freq]}>{r.period}</td><td><Spark data={r.spark} /></td><td className="text-dim">{r.source.split(" ")[0]}</td>
              </tr>))])}</tbody>
        </table>
        <div className="p-2 text-[10px] leading-snug text-dim">Banque mondiale : données annuelles, publiées avec plusieurs mois de retard. Eurostat : mensuel ou trimestriel, pays européens uniquement. La période affichée est celle de la dernière observation disponible.</div>
      </Panel>
      <Panel className="flex-1" title={ser.data ? `${ser.data.label} · ${ser.data.unit} · ${FREQ[ser.data.freq]}` : "Historique"} right={<><button onClick={exportCsv} className="border border-line px-2 text-fg hover:border-amber">Exporter CSV</button><SourceTag env={ser.env} /></>}>
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1">
            <span className="text-dim">Comparer avec</span>
            {cmp.filter((c) => c !== country).map((c) => <button key={c} onClick={() => setCmp(cmp.filter((x) => x !== c))} className="border border-line px-1 text-info hover:text-down">{name(c)} ×</button>)}
            <select value="" onChange={(e) => e.target.value && setCmp([...cmp, e.target.value])}>
              <option value="">+ pays</option>{cat.data?.countries.filter((c) => c.code !== country && !cmp.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            {ser.data && ser.data.series.length < all.length && <span className="text-dim">· indisponible pour : {all.filter((c) => !ser.data!.series.some((s) => s.country === c)).map(name).join(", ")}</span>}
          </div>
          <State loading={ser.loading && !ser.data} error={ser.error} />
          <div className="min-h-0 flex-1">{option && !ser.error && <EChart option={option} />}</div>
        </div>
      </Panel>
    </div>
  );
}
