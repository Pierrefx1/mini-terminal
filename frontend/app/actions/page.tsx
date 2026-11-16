"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import Crypto from "@/components/Crypto";
import EChart from "@/components/EChart";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, dateTime, num, pct, price, tone } from "@/lib/format";

type Row = { symbol: string; name: string; sector: string; industry: string; country: string; weight: number | null; price: number | null;
  d1?: number | null; w1?: number | null; m1?: number | null; ytd?: number | null; y1?: number | null; currency: string | null; avg_volume: number | null; div_yield: number | null; turnover_eur: number | null };
type Data = { label: string; rows: Row[]; priced: number; details: { fetched_at: string | null; done?: number; total?: number; running?: boolean; error?: string | null }; members_source: string; members_fetched_at: string };
type PerfKey = "d1" | "w1" | "m1" | "ytd" | "y1";
const PERIODS: [PerfKey, string, number][] = [["d1", "1J", 3], ["w1", "1S", 7], ["m1", "1M", 15], ["ytd", "YTD", 30], ["y1", "1A", 40]];

/** Rouge -> neutre -> vert, saturé à ±lim %. */
function color(v: number | null | undefined, lim: number) {
  if (v == null) return "#2a2a2a";
  const x = Math.max(-1, Math.min(1, v / lim)), a = Math.abs(x);
  const mix = (from: number, to: number) => Math.round(from + (to - from) * a);
  return x >= 0 ? `rgb(${mix(38, 18)},${mix(42, 168)},${mix(40, 72)})` : `rgb(${mix(42, 214)},${mix(38, 48)},${mix(40, 48)})`;
}

const UNIVERSES: [string, string][] = [["sp500", "S&P 500"], ["stoxx600", "STOXX Europe 600"], ["crypto", "Crypto"]];

export default function Screener() {
  const initial = useSearchParams().get("u");
  const [u, setU] = useState(UNIVERSES.some((x) => x[0] === initial) ? initial! : "sp500");
  const universe = <Seg value={u} options={UNIVERSES} onChange={setU} />;
  return u === "crypto" ? <Crypto universe={universe} /> : <Actions u={u} universe={universe} />;
}

function Actions({ u, universe }: { u: string; universe: React.ReactNode }) {
  const router = useRouter();
  const [view, setView] = useState<"heatmap" | "screener">("heatmap");
  const [per, setPer] = useState<PerfKey>("d1");
  const [size, setSize] = useState<"weight" | "turnover" | "equal">("weight");
  const [sector, setSector] = useState(""); const [country, setCountry] = useState(""); const [q, setQ] = useState("");
  const [minPerf, setMinPerf] = useState(""); const [minYield, setMinYield] = useState("");
  const [sort, setSort] = useState<{ k: keyof Row; dir: 1 | -1 }>({ k: "d1", dir: -1 });
  const { data, env, error, loading } = useApi<Data>(`/api/screener?universe_id=${u}`, 5 * 60_000);
  const rows = data?.rows ?? [];
  const hasWeight = rows.some((r) => r.weight != null), hasTurn = rows.some((r) => r.turnover_eur != null);
  const sizeMode = size === "weight" && !hasWeight ? (hasTurn ? "turnover" : "equal") : size === "turnover" && !hasTurn ? "equal" : size;
  const lim = PERIODS.find((p) => p[0] === per)![2];

  const tree = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      if (r.price == null) continue;
      const v = sizeMode === "weight" ? r.weight : sizeMode === "turnover" ? r.turnover_eur : 1;
      if (!v) continue;
      (groups.get(r.sector) ?? groups.set(r.sector, []).get(r.sector)!).push({ name: r.symbol, value: v, row: r, itemStyle: { color: color(r[per], lim) } });
    }
    return {
      tooltip: { backgroundColor: "#161616", borderColor: "#262626", textStyle: { color: "#d6d6d6", fontSize: 11 },
        formatter: (p: any) => { const r: Row | undefined = p.data.row; return r ? `<b>${r.symbol}</b> ${r.name}<br/>${r.sector} · ${r.country}<br/>Cours ${price(r.price)} ${r.currency ?? ""}<br/>${PERIODS.map(([k, l]) => `${l} ${pct(r[k])}`).join(" · ")}${r.weight != null ? `<br/>Poids dans l'indice ${num(r.weight, 2)} %` : ""}` : p.name; } },
      series: [{
        type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%",
        label: { show: true, color: "#fff", fontSize: 11, formatter: (p: any) => (p.data.row ? `${p.name.split(".")[0]}\n${pct(p.data.row[per], 1)}` : p.name) },
        upperLabel: { show: true, height: 16, color: "#ffa028", fontSize: 10, backgroundColor: "#0d0d0d" },
        itemStyle: { borderColor: "#050505", borderWidth: 1, gapWidth: 1 },
        levels: [{ itemStyle: { borderWidth: 2, borderColor: "#050505", gapWidth: 2 } }, { itemStyle: { borderColor: "#0d0d0d", gapWidth: 1 } }],
        data: [...groups.entries()].map(([name, children]) => ({ name, children })).sort((a, b) => b.children.reduce((s, c) => s + c.value, 0) - a.children.reduce((s, c) => s + c.value, 0)),
      }],
    };
  }, [rows, per, sizeMode, lim]);

  const sectors = useMemo(() => [...new Set(rows.map((r) => r.sector))].sort(), [rows]);
  const countries = useMemo(() => [...new Set(rows.map((r) => r.country))].sort(), [rows]);
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase(), mp = minPerf === "" ? null : +minPerf, my = minYield === "" ? null : +minYield;
    const out = rows.filter((r) => (!sector || r.sector === sector) && (!country || r.country === country) && (!k || r.symbol.toLowerCase().includes(k) || r.name.toLowerCase().includes(k))
      && (mp == null || (r[per] != null && r[per]! >= mp)) && (my == null || (r.div_yield != null && r.div_yield >= my)));
    return out.sort((a, b) => { const x = a[sort.k], y = b[sort.k]; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [rows, sector, country, q, minPerf, minYield, per, sort]);
  const Th = ({ k, children, numeric = true }: { k: keyof Row; children: React.ReactNode; numeric?: boolean }) => (
    <th className={`${numeric ? "num" : ""} cursor-pointer hover:text-fg`} onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : numeric ? -1 : 1 }))}>{children}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>);
  const det = data?.details;

  return (
    <Panel className="h-full" title={<Seg value={view} options={[["heatmap", "Heatmap"], ["screener", "Screener"]]} onChange={(v) => setView(v as any)} />}
      right={<><span>{data ? `${data.priced}/${data.rows.length} valeurs cotées · composition : ${data.members_source}, ${dateTime(data.members_fetched_at)}` : ""}</span><SourceTag env={env} /></>}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1">
          {universe}
          <span className="text-dim">Performance</span><Seg value={per} options={PERIODS.map(([k, l]) => [k, l] as [PerfKey, string])} onChange={setPer} />
          {view === "heatmap" ? (<>
            <span className="text-dim">Taille</span>
            <Seg value={sizeMode} options={[...(hasWeight ? [["weight", "Poids dans l'indice"] as ["weight", string]] : []), ...(hasTurn ? [["turnover", "Volume échangé"] as ["turnover", string]] : []), ["equal", "Égale"] as ["equal", string]]} onChange={setSize} />
            <span className="ml-2 flex items-center gap-1 text-dim">−{lim} %<span className="inline-block h-2 w-24" style={{ background: `linear-gradient(90deg, ${color(-lim, lim)}, ${color(0, lim)}, ${color(lim, lim)})` }} />+{lim} %</span>
          </>) : (<>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbole ou nom" className="w-40" />
            <select value={sector} onChange={(e) => setSector(e.target.value)}><option value="">Tous secteurs</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select>
            {countries.length > 1 && <select value={country} onChange={(e) => setCountry(e.target.value)}><option value="">Tous pays</option>{countries.map((s) => <option key={s}>{s}</option>)}</select>}
            <input value={minPerf} onChange={(e) => setMinPerf(e.target.value)} placeholder="Perf. min %" type="number" className="w-28" />
            <input value={minYield} onChange={(e) => setMinYield(e.target.value)} placeholder="Rendement min %" type="number" className="w-36" />
            <span className="text-dim">{filtered.length} valeurs</span>
          </>)}
        </div>
        <div className="shrink-0 border-b border-line px-2 py-0.5 text-[10px] text-dim">
          Capitalisation et PER : non disponibles gratuitement (la source refuse l'accès aux fondamentaux). Taille des tuiles : poids dans l'indice (S&P 500, fichier SPDR) ou volume moyen échangé en EUR.
          {" "}Volume et rendement du dividende (12 mois glissants) : {det?.running ? `calcul en cours ${det.done ?? 0}/${det.total ?? "…"}` : det?.fetched_at ? `calculés le ${dateTime(det.fetched_at)}` : "pas encore calculés"}{det?.error ? ` · ${det.error}` : ""}.
        </div>
        <State loading={loading && !data} error={error} />
        {data && (view === "heatmap"
          ? <div className="min-h-0 flex-1"><EChart option={tree} onClick={(p) => p.data?.row && router.push(`/graphique?s=${encodeURIComponent(p.data.row.symbol)}`)} /></div>
          : <div className="min-h-0 flex-1 overflow-auto">
              <table>
                <thead><tr><Th k="symbol" numeric={false}>Symbole</Th><Th k="name" numeric={false}>Nom</Th><Th k="sector" numeric={false}>Secteur</Th><Th k="country" numeric={false}>Pays</Th><Th k="price">Cours</Th>
                  {PERIODS.map(([k, l]) => <Th key={k} k={k}>{l}</Th>)}<Th k="weight">Poids indice</Th><Th k="avg_volume">Vol. moyen 1M</Th><Th k="turnover_eur">Échangé / j (EUR)</Th><Th k="div_yield">Rendement</Th></tr></thead>
                <tbody>{filtered.map((r) => (
                  <tr key={r.symbol} className="cursor-pointer" onClick={() => router.push(`/graphique?s=${encodeURIComponent(r.symbol)}`)}>
                    <td className="text-amber">{r.symbol}</td><td className="max-w-64 truncate">{r.name}</td><td>{r.sector}</td><td>{r.country}</td><td className="num">{price(r.price)} <span className="text-dim">{r.currency ?? ""}</span></td>
                    {PERIODS.map(([k]) => <td key={k} className={`num ${tone(r[k])}`}>{pct(r[k])}</td>)}
                    <td className="num">{r.weight == null ? "–" : num(r.weight, 2) + " %"}</td><td className="num">{big(r.avg_volume)}</td><td className="num">{big(r.turnover_eur)}</td><td className="num">{r.div_yield == null ? "–" : num(r.div_yield, 2) + " %"}</td>
                  </tr>))}</tbody>
              </table>
            </div>)}
      </div>
    </Panel>
  );
}
