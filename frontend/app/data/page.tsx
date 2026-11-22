"use client";
import * as echarts from "echarts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import { Panel, SourceTag, State } from "@/components/ui";
import { useApi, useRaw } from "@/lib/api";
import { pieces as mkPieces, colorOf } from "@/lib/choropleth";
import { big, num } from "@/lib/format";

type Indicator = { key: string; label: string; category: string; unit: string; freq: string };
type World = { code: string; iso3: string; name: string; region: string; income: string; detailed: boolean };
type Catalog = { countries: { code: string; name: string }[]; world: World[]; indicators: Indicator[] };
type Row = { key: string; label: string; category: string; unit: string; freq: string; source: string; last: number; period: string; previous: number | null; spark: number[] };
type Table = { country: string; code: string; region: string | null; income: string | null; detailed: boolean; rows: Row[] };
type Series = { key: string; label: string; unit: string; freq: string; series: { country: string; name: string; obs: [string, number, string][] }[] };
type MapData = { key: string; label: string; unit: string; freq: string; values: Record<string, { v: number; period: string }> };

const FREQ: Record<string, string> = { A: "annuel", T: "trimestriel", M: "mensuel", J: "quotidien" };
/** Indicateurs mis en avant en tête de fiche (le premier disponible de chaque groupe). */
const KPIS: [string, string[]][] = [["Croissance", ["gdp_qoq", "gdp_growth"]], ["Inflation", ["hicp", "cpi"]], ["Chômage", ["unemp_m", "unemp"]],
  ["Taux directeur", ["policy"]], ["Dette publique", ["debt_q", "debt"]], ["Solde courant", ["ca_q", "ca"]], ["PIB", ["gdp_usd"]], ["PIB / habitant", ["gdp_pc"]]];
/** Indicateurs où une hausse est une mauvaise nouvelle (couleur de la variation inversée). */
const BAD_UP = new Set(["cpi", "hicp", "unemp", "unemp_m", "debt", "debt_q"]);
// Natural Earth : France et Norvège sans code ISO2, territoires disputés rattachés
const ISO_FIX: Record<string, string> = { FRA: "FR", NOR: "NO", CYN: "CY", SOL: "SO" };
const AGG = [["XC", "Zone euro"]] as const;

const fr = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["fr"], { type: "region" }) : null;
function frName(code: string, fallback?: string) {
  if (code === "XC") return "Zone euro";
  try { const n = fr?.of(code); if (n && n !== code) return n; } catch {}
  return fallback ?? code;
}
const flag = (c: string) => (/^[A-Z]{2}$/.test(c) && c !== "XC" ? String.fromCodePoint(...[...c].map((x) => 0x1f1a5 + x.charCodeAt(0))) : "🇪🇺");
const val = (v: number | null | undefined, unit = "") => (v == null ? "–" : Math.abs(v) >= 1e6 ? big(v) + (unit.startsWith("USD") ? " $" : "") : num(v, Math.abs(v) >= 100 ? 1 : 2) + (unit.startsWith("%") ? " %" : ""));

function Spark({ data, color = "#ffa028" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), w = 56, h = 14;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return <svg width={w} height={h} className="inline-block"><polyline points={pts} fill="none" stroke={color} strokeWidth="1" /></svg>;
}

/** Carte du monde : pays colorés selon l'indicateur, clic = sélection. Le zoom et le déplacement sont conservés entre deux sélections. */
function WorldMap({ data, country, onPick, names }: { data?: MapData; country: string; onPick: (c: string) => void; names: Map<string, string> }) {
  const [ready, setReady] = useState(false);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (echarts.getMap("mt-world")) { setReady(true); return; }
    fetch("/world/countries.geojson").then((r) => r.json()).then((geo) => {
      geo.features = geo.features.filter((f: any) => f.properties.ADM0_A3 !== "ATA").map((f: any) => {
        const p = f.properties, iso = typeof p.ISO_A2 === "string" && /^[A-Z]{2}$/.test(p.ISO_A2) ? p.ISO_A2 : ISO_FIX[p.ADM0_A3] ?? p.ADM0_A3;
        return { ...f, properties: { ...p, name: iso } };
      });
      echarts.registerMap("mt-world", geo);
      setReady(true);
    });
  }, []);
  const ps = useMemo(() => mkPieces(Object.values(data?.values ?? {}).map((x) => x.v)), [data]);
  const option = useMemo(() => {
    if (!ready) return null;
    const unit = data?.unit ?? "";
    return {
      tooltip: { trigger: "item", backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, formatter: (p: any) => {
        const x = data?.values[p.name];
        return `${flag(p.name)} <b>${frName(p.name, names.get(p.name))}</b><br/>${data ? `${data.label} : ${x ? `<b>${val(x.v, unit)}</b> <span style="color:#7486a0">${unit} · ${x.period}</span>` : "<span style='color:#7486a0'>non disponible</span>"}` : ""}<br/><span style="color:#7486a0">clic : fiche du pays</span>`;
      } },
      visualMap: ps.pieces.length ? { type: "piecewise", pieces: ps.pieces.map((p, i) => ({ min: p.min, max: p.max, color: p.color, label: `${val(p.min)} – ${val(p.max)}${i === ps.pieces.length - 1 ? "" : ""}` })),
        left: 8, bottom: 8, itemWidth: 12, itemHeight: 8, itemGap: 3, textStyle: { color: "#7486a0", fontSize: 9 }, backgroundColor: "rgba(8,16,29,0.85)", padding: 6 } : undefined,
      series: [{
        type: "map", map: "mt-world", roam: true, scaleLimit: { min: 1, max: 12 }, zoom: 1.15, center: [12, 18], selectedMode: "single",
        itemStyle: { areaColor: "#16233a", borderColor: "#0a1424", borderWidth: 0.5 },
        emphasis: { label: { show: false }, itemStyle: { areaColor: "#ffa028" } },
        select: { label: { show: false }, itemStyle: { areaColor: "#ffa028", borderColor: "#fff", borderWidth: 1 } },
        data: Object.entries(data?.values ?? {}).map(([k, x]) => ({ name: k, value: x.v, itemStyle: { areaColor: colorOf(ps.pieces, x.v) ?? "#16233a" } })),
      }],
    };
  }, [ready, data, ps, names]);
  // sélection appliquée par action : pas de nouvelle option, donc le zoom de l'utilisateur est conservé
  useEffect(() => { const c = inst.current; if (!c || !option) return; c.dispatchAction({ type: "unselect", seriesIndex: 0, name: [...names.keys()] }); c.dispatchAction({ type: "select", seriesIndex: 0, name: country }); }, [country, option, names]);
  if (!option) return <State loading />;
  return <EChart option={option} onInit={(c) => { inst.current = c; }} onClick={(p) => p.name && onPick(p.name)} />;
}

export default function DataPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const cat = useRaw<Catalog>("/api/data/catalog");
  const country = (sp.get("c") || "FR").toUpperCase();
  const setCountry = (c: string) => router.replace(`/data?c=${c}${sp.get("k") ? `&k=${sp.get("k")}` : ""}`, { scroll: false });
  const key = sp.get("k") || "gdp_growth";
  const setKey = (k: string) => router.replace(`/data?c=${country}&k=${k}`, { scroll: false });
  const [cmp, setCmp] = useState<string[]>(["US", "DE"]);
  const [search, setSearch] = useState("");

  const names = useMemo(() => new Map((cat.data?.world ?? []).map((w) => [w.code, frName(w.code, w.name)])), [cat.data]);
  const world = useMemo(() => [...names.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr")), [names]);
  const ind = cat.data?.indicators.find((i) => i.key === key);
  const map = useApi<MapData>(`/api/data/map?key=${key}`);
  const table = useApi<Table>(`/api/data/table?country=${country}`);
  const all = [country, ...cmp.filter((c) => c !== country)];
  const ser = useApi<Series>(`/api/data/series?key=${key}&countries=${all.join(",")}`);
  const t = table.data?.code === country ? table.data : undefined;
  const byKey = useMemo(() => new Map((t?.rows ?? []).map((r) => [r.key, r])), [t]);
  const groups = useMemo(() => { const g = new Map<string, Row[]>(); (t?.rows ?? []).forEach((r) => (g.get(r.category) ?? g.set(r.category, []).get(r.category)!).push(r)); return [...g.entries()]; }, [t]);
  const option = useMemo(() => ser.data && lineOption(ser.data.series.map((s) => ({ name: frName(s.country, s.name), data: s.obs.map((o) => [o[0], o[1]] as [string, number]), step: key === "policy" })),
    { decimals: Math.abs(ser.data.series[0]?.obs.at(-1)?.[1] ?? 0) >= 1e6 ? 0 : 2 }), [ser.data, key]);
  const rank = useMemo(() => {
    if (!map.data) return null;
    const xs = Object.entries(map.data.values).filter(([c]) => names.has(c)).sort((a, b) => b[1].v - a[1].v);
    const i = xs.findIndex(([c]) => c === country);
    return i < 0 ? null : { pos: i + 1, n: xs.length };
  }, [map.data, country, names]);
  const pick = (c: string) => { if (names.has(c) || c === "XC") setCountry(c); };
  const searchHit = (q: string) => world.find(([, n]) => n.toLowerCase() === q.trim().toLowerCase()) ?? world.find(([, n]) => n.toLowerCase().startsWith(q.trim().toLowerCase()));
  const cname = frName(country, t?.country ?? names.get(country));

  const exportCsv = () => {
    if (!ser.data) return;
    const periods = [...new Set(ser.data.series.flatMap((s) => s.obs.map((o) => o[2])))].sort();
    const lines = [["periode", ...ser.data.series.map((s) => s.name)].join(";"), ...periods.map((p) => [p, ...ser.data!.series.map((s) => { const o = s.obs.find((x) => x[2] === p); return o ? String(o[1]).replace(".", ",") : ""; })].join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `${ser.data.key}_${all.join("-")}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      {/* Barre : recherche de pays, indicateur affiché sur la carte */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-line bg-panel px-2 py-1">
        <span className="text-[11px] uppercase tracking-wider text-amber">DATA · données pays</span>
        <form onSubmit={(e) => { e.preventDefault(); const h = searchHit(search); if (h) { pick(h[0]); setSearch(""); } }} className="flex items-center gap-1">
          <input list="mt-countries" value={search} onChange={(e) => { setSearch(e.target.value); const h = world.find(([, n]) => n === e.target.value); if (h) { pick(h[0]); setSearch(""); } }}
            placeholder={`Rechercher un pays (${world.length || "…"})`} className="w-56" />
          <datalist id="mt-countries">{world.map(([c, n]) => <option key={c} value={n} />)}</datalist>
        </form>
        {AGG.map(([c, n]) => <button key={c} onClick={() => pick(c)} className={`border px-2 py-0.5 ${country === c ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}>{flag(c)} {n}</button>)}
        <span className="ml-auto flex items-center gap-1 text-dim">Carte :
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            {[...new Set(cat.data?.indicators.map((i) => i.category))].map((g) => <optgroup key={g} label={g}>{cat.data!.indicators.filter((i) => i.category === g).map((i) => <option key={i.key} value={i.key}>{i.label} ({FREQ[i.freq]})</option>)}</optgroup>)}
          </select>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-1">
        {/* Colonne gauche : carte + historique */}
        <div className="col-span-12 flex min-h-0 flex-col gap-1 xl:col-span-7">
          <Panel className="min-h-[340px] flex-[3]" title={ind ? `${ind.label} · ${ind.unit} · dernière valeur par pays` : "Carte"}
            right={<>{map.data && <span>{Object.keys(map.data.values).filter((c) => names.has(c)).length} pays</span>}<SourceTag env={map.env} /></>}>
            <div className="relative h-full">
              <State loading={map.loading && !map.data} error={map.error} />
              <WorldMap data={map.data} country={country} onPick={pick} names={names} />
              <div className="pointer-events-none absolute right-2 top-1 text-[10px] text-dim">molette : zoom · glisser : déplacer · clic : fiche du pays</div>
            </div>
          </Panel>
          <Panel className="min-h-[220px] flex-[2]" title={ser.data ? `Historique · ${ser.data.label} · ${ser.data.unit} · ${FREQ[ser.data.freq]}` : "Historique"}
            right={<><button onClick={exportCsv} className="border border-line px-2 text-fg hover:border-amber">CSV</button><SourceTag env={ser.env} /></>}>
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1">
                <span className="text-dim">Comparer {flag(country)} {cname} avec</span>
                {cmp.filter((c) => c !== country).map((c) => <button key={c} onClick={() => setCmp(cmp.filter((x) => x !== c))} className="border border-line px-1 text-info hover:text-down">{flag(c)} {frName(c, names.get(c))} ×</button>)}
                <select value="" onChange={(e) => e.target.value && setCmp([...cmp, e.target.value])}>
                  <option value="">+ pays</option>
                  <option value="XC">Zone euro</option>
                  {world.filter(([c]) => c !== country && !cmp.includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
                {ser.data && ser.data.series.length < all.length && <span className="text-dim">· indisponible pour : {all.filter((c) => !ser.data!.series.some((s) => s.country === c)).map((c) => frName(c, names.get(c))).join(", ")}</span>}
              </div>
              <State loading={ser.loading && !ser.data} error={ser.error} />
              <div className="min-h-0 flex-1">{option && !ser.error && <EChart option={option} />}</div>
            </div>
          </Panel>
        </div>

        {/* Colonne droite : fiche du pays */}
        <Panel className="col-span-12 min-h-0 xl:col-span-5" title={<span className="normal-case tracking-normal"><span className="mr-1 text-base">{flag(country)}</span>{cname}</span>} right={<SourceTag env={table.env} />}>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-line px-2 py-1 text-[10px] text-dim">
            {t?.region && <span>{t.region}</span>}{t?.income && <span>· {t.income}</span>}
            {t && <span>· {[...new Set(t.rows.map((r) => r.source.split(" (")[0]))].join(" + ")} · {t.rows.length} indicateurs{t.rows.some((r) => r.freq === "M" || r.freq === "T") ? ", dont mensuels ou trimestriels" : ", annuels"}</span>}
            {rank && ind && <span className="text-amber">· {rank.pos}e sur {rank.n} pays pour « {ind.label} »</span>}
          </div>
          {country === "US" && <div className="border-b border-line px-2 py-1 text-[10px] text-dim">Ici, les États-Unis sont comparés aux autres pays, souvent en données annuelles. Séries mensuelles et hebdomadaires (CPI, PCE, NFP, inscriptions au chômage) et courbe des taux : <Link href="/macro" className="text-info">MAC · macro US →</Link></div>}
          {table.env?.error &&<div className="border-b border-down/60 px-2 py-1 text-[10px] text-down">{table.env.error}</div>}
          <State loading={table.loading && !t} error={table.error} />
          {t && <>
            <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
              {KPIS.map(([label, keys]) => {
                const r = keys.map((k) => byKey.get(k)).find(Boolean);
                const d = r && r.previous != null ? r.last - r.previous : null;
                const good = d == null || d === 0 ? null : (d > 0) !== BAD_UP.has(r!.key);
                return (
                  <button key={label} disabled={!r} onClick={() => r && setKey(r.key)} className={`bg-panel px-2 py-1.5 text-left ${r ? "hover:bg-raised" : "opacity-40"} ${r?.key === key ? "outline outline-1 -outline-offset-1 outline-amber" : ""}`}>
                    <div className="truncate text-[10px] uppercase tracking-wider text-dim">{label}</div>
                    <div className="text-[17px] leading-6 text-fg">{r ? val(r.last, r.unit) : "–"}</div>
                    <div className="truncate text-[10px] text-dim">{r ? <>{d != null && d !== 0 && <span className={good ? "text-up" : "text-down"}>{d > 0 ? "▲" : "▼"} </span>}{r.period}</> : "non publié"}</div>
                  </button>
                );
              })}
            </div>
            <table>
              <thead><tr><th>Indicateur</th><th className="num">Dernier</th><th className="num">Préc.</th><th>Période</th><th>Tendance</th></tr></thead>
              <tbody>{groups.map(([g, rows]) => [
                <tr key={g}><td colSpan={5} className="bg-raised text-amber">{g}</td></tr>,
                ...rows.map((r) => (
                  <tr key={r.key} onClick={() => setKey(r.key)} className={`cursor-pointer hover:bg-raised ${key === r.key ? "bg-raised" : ""}`} title={`${r.unit} · ${FREQ[r.freq]} · ${r.source} · clic : carte et historique`}>
                    <td className={`!whitespace-normal ${key === r.key ? "text-amber" : ""}`}>{r.label} <span className="text-[10px] text-dim">{r.unit}</span></td>
                    <td className="num text-fg">{val(r.last)}</td>
                    <td className={`num ${r.previous == null || r.previous === r.last ? "text-dim" : (r.last > r.previous) !== BAD_UP.has(r.key) ? "text-up" : "text-down"}`}>{val(r.previous)}</td>
                    <td className="text-dim">{r.period}</td><td><Spark data={r.spark} color={key === r.key ? "#ffa028" : "#4aa8ff"} /></td>
                  </tr>))])}</tbody>
            </table>
            <div className="p-2 text-[10px] leading-snug text-dim">Clic sur un indicateur : il colore la carte et s&apos;affiche dans l&apos;historique. Vert / rouge : évolution favorable ou défavorable (une hausse de l&apos;inflation, du chômage ou de la dette est défavorable). Banque mondiale : annuel, publié avec plusieurs mois de retard ; Eurostat : pays européens ; BRI : taux directeurs d&apos;une quarantaine de banques centrales.</div>
          </>}
        </Panel>
      </div>
    </div>
  );
}
