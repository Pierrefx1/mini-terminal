"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Export from "@/components/Export";
import Plot from "@/components/Plot";
import { Num, Panel, Seg, SourceTag, State, Toggle } from "@/components/ui";
import { fetcher, useApi } from "@/lib/api";
import { volGrid } from "@/lib/volgrid";
import { num } from "@/lib/format";

type Metric = { expiry: string; days: number; fwd: number; atm_vol: number | null; skew_90_110: number | null; fly_90_110: number | null };
type Point = { expiry: string; T: number; K: number; F: number; k: number; iv: number };
type CM = { days: number; atm_vol: number | null; skew_90_110: number | null; fly_90_110: number | null; extrapolated: boolean };
type Vol = { ticker: string; spot: number; figure: { data: any[]; layout: any }; metrics: Metric[]; points: Point[]; n_points: number; n_quotes: number; cm30?: CM; cm90?: CM };
type HistRow = { date: string; spot: number; atm30: number | null; skew30: number | null; fly30: number | null; atm90: number | null; skew90: number | null; n_points: number };
type Hist = {
  rv: { dates: string[]; rv20: (number | null)[]; rv60: (number | null)[] }; iv: HistRow[];
  stats: { iv30: number | null; iv30_date: string | null; rv20: number | null; rv60: number | null; spread_20: number | null; spread_60: number | null;
    iv30_pct_vs_rv20: number | null; rv20_pct: number | null; iv30_pct_own: number | null; skew30_pct_own: number | null; n_days: number };
};
type Params = { rate: number; min_open_interest: number; max_rel_spread: number; k_range: number };

const DEFAULTS: Params = { rate: 0.04, min_open_interest: 10, max_rel_spread: 0.35, k_range: 0.35 };
const volPct = (v: number | null | undefined, d = 1) => (v == null ? "–" : num(v * 100, d));
const signed = (v: number | null | undefined, d = 2) => (v == null ? "–" : `${v > 0 ? "+" : ""}${num(v * 100, d)}`);
const P100 = (a: (number | null)[]) => a.map((x) => (x == null ? null : x * 100));

/** Indicateur de la rangée du haut : libellé, valeur, précision. */
function Kpi({ label, value, sub, cls = "text-fg", title }: { label: string; value: React.ReactNode; sub?: React.ReactNode; cls?: string; title?: string }) {
  return (
    <div className="min-w-0 border-l border-line px-3 py-1.5 first:border-l-0" title={title}>
      <div className="truncate text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`num text-[17px] leading-6 ${cls}`}>{value}</div>
      <div className="truncate text-[10px] text-dim">{sub ?? " "}</div>
    </div>
  );
}

export default function VOL() {
  const router = useRouter();
  const sp = useSearchParams();
  const s = (sp.get("s") || "SPY").toUpperCase();
  const [input, setInput] = useState(s);
  useEffect(() => setInput(s), [s]);
  const [draft, setDraft] = useState<Params>(DEFAULTS);   // champs du formulaire
  const [params, setParams] = useState<Params>(DEFAULTS); // paramètres appliqués
  const [refreshing, setRefreshing] = useState(false);
  const [expiry, setExpiry] = useState("");

  const url = `/api/vol/surface?symbol=${encodeURIComponent(s)}&rate=${params.rate}&min_open_interest=${params.min_open_interest}&max_rel_spread=${params.max_rel_spread}&k_range=${params.k_range}`;
  const v = useApi<Vol>(url);
  const d = v.data;
  // l'historique est relu après chaque nouvelle surface (elle peut y ajouter la séance du jour)
  const h = useApi<Hist>(d ? `/api/vol/history?symbol=${encodeURIComponent(s)}&t=${v.env?.fetched_at ?? ""}` : null);
  const hd = h.data;
  const st = hd?.stats;
  useEffect(() => { if (d && !d.metrics.some((m) => m.expiry === expiry)) setExpiry(d.metrics.find((m) => m.days >= 25)?.expiry ?? d.metrics[0]?.expiry ?? ""); }, [d, expiry]);

  const go = (sym: string) => { const t = sym.trim().toUpperCase(); if (t) router.push(`/vol?s=${encodeURIComponent(t)}`); };
  const refresh = async () => {
    setRefreshing(true);
    try { await v.reload(fetcher(`${url}&force=true`), { revalidate: false }); } catch { await v.reload(); } finally { setRefreshing(false); }
  };
  const custom = JSON.stringify(params) !== JSON.stringify(DEFAULTS);

  // Surface 3D : grille construite côté terminal à partir des points de marché (voir lib/volgrid.ts)
  const [view, setView] = useState<"3d" | "smile" | "term" | "top">("3d");
  const [span, setSpan] = useState(20);
  const [quotes, setQuotes] = useState(false);
  const surface = useMemo(() => {
    if (!d) return null;
    const g = volGrid(d.points, { mMin: 100 - span, mMax: 100 + span, nk: 81, between: 3 });
    const all = g.z.flat().filter((x): x is number => x != null).map((x) => x * 100);
    if (!all.length) return null;
    const sorted = [...all].sort((a, b) => a - b);
    // couleurs bornées aux percentiles 2–98 % : quelques ailes très courtes ne doivent pas écraser l'échelle
    const zmin = sorted[Math.floor(sorted.length * 0.02)], zmax = sorted[Math.ceil(sorted.length * 0.98) - 1];
    const inRange = (k: number) => { const m = Math.exp(k) * 100; return m >= 100 - span - 1e-9 && m <= 100 + span + 1e-9; };
    const CAM = {
      "3d": { eye: { x: 0.95, y: -1.75, z: 0.7 }, up: { x: 0, y: 0, z: 1 } },
      smile: { eye: { x: 0, y: -2.1, z: 0.1 }, up: { x: 0, y: 0, z: 1 } },
      term: { eye: { x: 2.1, y: 0, z: 0.1 }, up: { x: 0, y: 0, z: 1 } },
      top: { eye: { x: 0, y: 0, z: 2.2 }, up: { x: 0, y: 1, z: 0 } },
    }[view];
    const data: any[] = [
      { type: "surface", x: g.m, y: g.days, z: g.z.map((r) => r.map((x) => (x == null ? null : x * 100))), connectgaps: false,
        cmin: zmin, cmax: zmax, colorscale: [[0, "#0b2a5b"], [0.2, "#1565c0"], [0.4, "#00a6b4"], [0.6, "#1fd15f"], [0.8, "#ffa028"], [1, "#ff4d4d"]],
        opacity: 0.97, showscale: true,
        colorbar: { title: { text: "IV %", font: { color: "#7486a0", size: 10 } }, thickness: 8, len: 0.6, x: 0.98, outlinewidth: 0, tickfont: { color: "#7486a0", size: 9 }, ticksuffix: " %" },
        lighting: { ambient: 0.62, diffuse: 0.75, specular: 0.18, roughness: 0.55, fresnel: 0.15 }, lightposition: { x: -1000, y: -2000, z: 3000 },
        contours: {
          x: { show: true, start: 100 - span, end: 100 + span, size: span >= 30 ? 10 : 5, color: "rgba(212,219,230,0.18)", width: 1 },
          z: { show: true, usecolormap: true, width: 2, project: { z: view === "top" } },
        },
        hovertemplate: "K/F %{x:.1f} %<br>%{y:.0f} jours<br>IV %{z:.2f} %<extra></extra>" },
      // smiles réellement cotés, une ligne par échéance
      ...g.slices.map((sl) => {
        const idx = sl.k.map((k, i) => (inRange(k) ? i : -1)).filter((i) => i >= 0);
        return { type: "scatter3d", mode: "lines", x: idx.map((i) => Math.exp(sl.k[i]) * 100), y: idx.map(() => sl.days), z: idx.map((i) => sl.iv[i] * 100 + 0.08),
          line: { color: sl.expiry === expiry ? "#ffffff" : "rgba(230,236,245,0.55)", width: sl.expiry === expiry ? 5 : 2 }, hoverinfo: "skip", showlegend: false };
      }),
      // structure par terme à la monnaie
      { type: "scatter3d", mode: "lines+markers", x: g.atm.map(() => 100), y: g.atm.map((a) => a.days), z: g.atm.map((a) => (a.iv == null ? null : a.iv * 100 + 0.12)),
        line: { color: "#ffa028", width: 6 }, marker: { size: 3, color: "#ffa028" }, name: "ATM", hovertemplate: "ATM · %{y} j<br>IV %{z:.2f} %<extra></extra>", showlegend: false },
      ...(quotes ? [{ type: "scatter3d", mode: "markers", x: d.points.filter((p) => inRange(p.k)).map((p) => Math.exp(p.k) * 100), y: d.points.filter((p) => inRange(p.k)).map((p) => p.T * 365),
        z: d.points.filter((p) => inRange(p.k)).map((p) => p.iv * 100), marker: { size: 1.8, color: "#d4dbe6", opacity: 0.7 }, hovertemplate: "cotation · K/F %{x:.1f} %<br>%{y:.0f} j · IV %{z:.2f} %<extra></extra>", showlegend: false }] : []),
    ];
    return {
      data,
      layout: {
        margin: { l: 0, r: 0, t: 0, b: 0 }, showlegend: false, uirevision: `${d.ticker}-${view}-${span}`,
        scene: {
          domain: { x: [0, 0.95], y: [0, 1] },
          xaxis: { title: { text: "Moneyness K/F" }, ticksuffix: " %", nticks: 7, range: [100 - span, 100 + span], showspikes: false },
          yaxis: { title: { text: "Échéance" }, ticksuffix: " j", nticks: 7, showspikes: false },
          zaxis: { title: { text: "IV" }, ticksuffix: " %", nticks: 6, showspikes: false },
          camera: { ...CAM, center: { x: 0, y: 0, z: -0.12 }, projection: { type: view === "3d" ? "perspective" : "orthographic" } },
          aspectmode: "manual", aspectratio: { x: 1.7, y: 1.5, z: 0.85 },
        },
      },
    };
  }, [d, view, span, quotes, expiry]);

  const term = useMemo(() => d && {
    data: [{ type: "scatter", mode: "lines+markers", x: d.metrics.map((m) => m.days), y: d.metrics.map((m) => (m.atm_vol == null ? null : m.atm_vol * 100)),
      text: d.metrics.map((m) => m.expiry), line: { color: "#ffa028", width: 2 }, marker: { size: 5 }, connectgaps: true,
      hovertemplate: "%{text} · %{x} j<br>ATM %{y:.2f} %<extra></extra>" }],
    layout: { margin: { l: 40, r: 10, t: 6, b: 30 }, xaxis: { ticksuffix: " j" }, yaxis: { ticksuffix: " %" } },
  }, [d]);

  const smile = useMemo(() => {
    if (!d || !expiry) return null;
    const pts = d.points.filter((p) => p.expiry === expiry).sort((a, b) => a.k - b.k);
    if (!pts.length) return null;
    return {
      data: [{ type: "scatter", mode: "lines+markers", x: pts.map((p) => p.k), y: pts.map((p) => p.iv * 100), customdata: pts.map((p) => [p.K, p.T]),
        line: { color: "#2a3d5c", width: 1 }, marker: { size: 4, color: pts.map((p) => (p.k < 0 ? "#ff4d4d" : "#1fd15f")) },
        hovertemplate: "K %{customdata[0]} · ln(K/F) %{x:.3f}<br>IV %{y:.2f} %<br>clic : valoriser dans OVME<extra></extra>" }],
      layout: { margin: { l: 40, r: 10, t: 6, b: 30 }, xaxis: { tickformat: ".2f" }, yaxis: { ticksuffix: " %" },
        shapes: [0, Math.log(0.9), Math.log(1.1)].map((x) => ({ type: "line", x0: x, x1: x, yref: "paper", y0: 0, y1: 1, line: { color: x === 0 ? "#ffa028" : "#2a3d5c", width: 1, dash: x === 0 ? "solid" : "dot" } })) },
    };
  }, [d, expiry]);

  const ivrv = useMemo(() => {
    if (!hd) return null;
    const start = hd.rv.dates.length > 260 ? hd.rv.dates[hd.rv.dates.length - 260] : hd.rv.dates[0];
    const ivPts = hd.iv.filter((r) => r.atm30 != null);
    const cur = hd.stats.iv30 ?? d?.cm30?.atm_vol ?? null;
    return {
      data: [
        { type: "scatter", mode: "lines", name: "RV 20 j", x: hd.rv.dates, y: P100(hd.rv.rv20), line: { color: "#4aa8ff", width: 1.5 }, hovertemplate: "%{x}<br>RV 20 j %{y:.1f} %<extra></extra>" },
        { type: "scatter", mode: "lines", name: "RV 60 j", x: hd.rv.dates, y: P100(hd.rv.rv60), line: { color: "#c77dff", width: 1.5 }, hovertemplate: "%{x}<br>RV 60 j %{y:.1f} %<extra></extra>" },
        { type: "scatter", mode: "lines+markers", name: "IV ATM 30 j", x: ivPts.map((r) => r.date), y: ivPts.map((r) => r.atm30! * 100), line: { color: "#ffa028", width: 2 }, marker: { size: 6 }, hovertemplate: "%{x}<br>IV 30 j %{y:.1f} %<extra></extra>" },
      ],
      layout: {
        margin: { l: 40, r: 10, t: 6, b: 26 }, showlegend: true, legend: { orientation: "h", x: 0, y: 1, yanchor: "top", font: { color: "#7486a0", size: 9 } },
        xaxis: { type: "date", range: [start, hd.rv.dates.at(-1)] }, yaxis: { ticksuffix: " %", rangemode: "tozero" },
        shapes: cur == null ? [] : [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: cur * 100, y1: cur * 100, line: { color: "#ffa028", width: 1, dash: "dot" } }],
      },
    };
  }, [hd, d]);

  const sel = d?.metrics.find((m) => m.expiry === expiry);
  const slope = d?.cm30?.atm_vol != null && d?.cm90?.atm_vol != null ? d.cm90.atm_vol - d.cm30.atm_vol : null;

  return (
    <div className="grid h-full auto-rows-max grid-cols-12 content-start gap-1 overflow-auto">
      {/* Barre d'outils */}
      <div className="col-span-12 flex flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-raised px-2 py-1">
        <span className="text-[11px] uppercase tracking-wider text-amber">VOL</span>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); go(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} className="w-20 uppercase" aria-label="Sous-jacent" />
        </form>
        <button onClick={refresh} disabled={refreshing || v.loading} className="border border-amber px-2 text-amber hover:bg-amber hover:text-black disabled:opacity-50" title="Recalcule la surface sans attendre la fin du cache de 5 minutes">
          {refreshing ? "Actualisation…" : "↻ Actualiser"}
        </button>
        <details className="relative">
          <summary className={`cursor-pointer list-none border px-2 ${custom ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}>Paramètres{custom ? " •" : ""} ▾</summary>
          <form className="absolute left-0 top-6 z-20 w-72 border border-line bg-panel p-2 shadow-xl" onSubmit={(e) => { e.preventDefault(); if (Object.values(draft).every(Number.isFinite)) setParams(draft); }}>
            <Num label="Taux sans risque" value={draft.rate} step={0.0025} onChange={(x) => setDraft({ ...draft, rate: x })} w="w-20" title="Taux (décimal) pour l'actualisation Black-76" />
            <Num label="Intérêt ouvert min" value={draft.min_open_interest} step={1} onChange={(x) => setDraft({ ...draft, min_open_interest: x })} w="w-20" />
            <Num label="Spread relatif max" value={draft.max_rel_spread} step={0.05} onChange={(x) => setDraft({ ...draft, max_rel_spread: x })} w="w-20" title="(ask − bid) / mid" />
            <Num label="|ln(K/F)| max" value={draft.k_range} step={0.05} onChange={(x) => setDraft({ ...draft, k_range: x })} w="w-20" title="Plage de log-moneyness conservée" />
            <div className="flex gap-2 pt-2">
              <button type="submit" className="border border-amber px-2 text-amber hover:bg-amber hover:text-black">Appliquer</button>
              <button type="button" onClick={() => { setDraft(DEFAULTS); setParams(DEFAULTS); }} className="border border-line px-2 text-dim hover:text-fg">Défauts</button>
            </div>
            <div className="pt-1 text-[10px] text-dim">L&apos;historique n&apos;enregistre que les surfaces aux paramètres par défaut.</div>
          </form>
        </details>
        {d && <span className="text-[10px] text-dim">{d.n_points} points IV · {d.n_quotes} cotations · {d.metrics.length} échéances</span>}
        <span className="ml-auto"><SourceTag env={v.env} /></span>
      </div>

      {(v.error || (v.loading && !d)) && <div className="col-span-12 border border-line bg-panel">
        <State loading={v.loading && !d} error={v.error} />
        {v.loading && !d && <div className="px-2 pb-2 text-[10px] text-dim">Récupération de toutes les échéances sur Yahoo Finance : 5 à 30 s au premier appel, puis cache de 5 minutes.</div>}
      </div>}

      {d && <>
        {/* Indicateurs */}
        <div className="col-span-12 grid grid-cols-2 border border-line bg-panel sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-9">
          <Kpi label={d.ticker} value={num(d.spot, 2)} sub="spot" />
          <Kpi label="ATM 30 j" value={`${volPct(d.cm30?.atm_vol, 2)} %`} cls="text-amber" sub={st?.iv30_pct_own != null ? `${num(st.iv30_pct_own, 0)}e pct historique` : "maturité constante"} />
          <Kpi label="ATM 90 j" value={`${volPct(d.cm90?.atm_vol, 2)} %`} sub={d.cm90?.extrapolated ? "extrapolé" : "maturité constante"} />
          <Kpi label="Pente 30→90" value={signed(slope)} cls={slope == null ? "text-fg" : slope < 0 ? "text-down" : "text-up"} sub={slope == null ? " " : slope < 0 ? "inversée (stress)" : "contango"} title="ATM 90 j − ATM 30 j, en points de vol" />
          <Kpi label="Skew 30 j" value={volPct(d.cm30?.skew_90_110, 2)} sub={st?.skew30_pct_own != null ? `${num(st.skew30_pct_own, 0)}e pct historique` : "IV 90 % − IV 110 %"} title="En points de vol" />
          <Kpi label="Fly 30 j" value={volPct(d.cm30?.fly_90_110, 2)} sub="½(90+110) − ATM" title="En points de vol" />
          <Kpi label="RV 20 j" value={st ? `${volPct(st.rv20, 2)} %` : "…"} sub={st ? `RV 60 j ${volPct(st.rv60, 1)} %` : " "} />
          <Kpi label="IV − RV20" value={st ? signed(st.spread_20) : "…"} cls={st?.spread_20 == null ? "text-fg" : st.spread_20 > 0 ? "text-up" : "text-down"} sub="prime de vol (pts)" />
          <Kpi label="IV vs RV 2 ans" value={st?.iv30_pct_vs_rv20 == null ? "–" : `${num(st.iv30_pct_vs_rv20, 0)}e pct`} sub="distribution RV 20 j" title="Part des 2 dernières années où la vol réalisée 20 j était inférieure à l'IV 30 j actuelle" />
        </div>

        {/* Surface + métriques */}
        <Panel className="col-span-12 h-[460px] xl:col-span-8" title={`Surface ${d.ticker} · IV selon la moneyness et l'échéance`}
          right={<span className="flex items-center gap-2" title="Glisser : rotation · molette : zoom · double-clic : vue initiale">
            <Seg value={view} options={[["3d", "3D"], ["smile", "Smile"], ["term", "Terme"], ["top", "Dessus"]]} onChange={setView} />
            <select value={span} onChange={(e) => setSpan(+e.target.value)}>{[10, 20, 30, 40].map((x) => <option key={x} value={x}>K/F ±{x} %</option>)}</select>
            <Toggle on={quotes} onChange={setQuotes}>cotations</Toggle></span>}>
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">{surface && <Plot data={surface.data} layout={surface.layout} />}</div>
            <div className="shrink-0 px-2 pb-0.5 text-[10px] text-dim">Lignes blanches : smiles cotés (en gras : échéance sélectionnée) · orange : vol à la monnaie. Zones vides : aucun strike coté, rien n&apos;est extrapolé.</div>
          </div>
        </Panel>

        <Panel className="col-span-12 h-[460px] xl:col-span-4" title="Par échéance"
          right={<Export name={`vol-${d.ticker}`} columns={["Échéance", "Jours", "Forward", "ATM vol %", "Skew 90/110 (pts)", "Fly 90/110 (pts)"]}
            rows={d.metrics.map((m) => [m.expiry, m.days, m.fwd, m.atm_vol == null ? null : m.atm_vol * 100, m.skew_90_110 == null ? null : m.skew_90_110 * 100, m.fly_90_110 == null ? null : m.fly_90_110 * 100])} source={v.env?.source} />}>
          <table>
            <thead className="sticky top-0 bg-panel"><tr><th>Échéance</th><th className="num">J</th><th className="num">Fwd</th><th className="num">ATM %</th>
              <th className="num" title="IV(90 %) − IV(110 %), en points de vol">Skew</th><th className="num" title="½(IV90 + IV110) − ATM, en points de vol">Fly</th></tr></thead>
            <tbody>{d.metrics.map((m) => (
              <tr key={m.expiry} onClick={() => setExpiry(m.expiry)} className={`cursor-pointer hover:bg-raised ${m.expiry === expiry ? "bg-raised text-amber" : ""}`}>
                <td>{m.expiry}</td><td className="num">{m.days}</td><td className="num">{num(m.fwd, 2)}</td>
                <td className="num text-fg">{volPct(m.atm_vol, 2)}</td><td className="num">{volPct(m.skew_90_110, 2)}</td><td className="num">{volPct(m.fly_90_110, 2)}</td>
              </tr>))}</tbody>
          </table>
          <div className="px-2 py-1 text-[10px] text-dim">Clic sur une ligne : smile de l&apos;échéance ; clic sur un point du smile : valorisation dans OVME. « – » : 90 % ou 110 % hors des strikes cotés.</div>
        </Panel>

        {/* Graphiques 2D */}
        <Panel className="col-span-12 h-[300px] md:col-span-6 xl:col-span-4"
          title={<span className="normal-case tracking-normal">SMILE · <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>{d.metrics.map((m) => <option key={m.expiry} value={m.expiry}>{m.expiry} ({m.days} j)</option>)}</select></span>}
          right={sel && <span>fwd {num(sel.fwd, 2)} · ATM <span className="text-fg">{volPct(sel.atm_vol, 2)} %</span></span>}>
          {smile && <Plot data={smile.data} layout={smile.layout} onClick={(p) => {
            const [K, T] = p.customdata as [number, number];
            router.push(`/ovme?s=${encodeURIComponent(d.ticker)}&S=${d.spot.toFixed(2)}&K=${K}&T=${T.toFixed(4)}&vol=${(+p.y).toFixed(2)}&type=${p.x < 0 ? "put" : "call"}&mkt=1`);
          }} />}
        </Panel>

        <Panel className="col-span-12 h-[300px] md:col-span-6 xl:col-span-4" title="Structure par terme ATM" right={<span>{d.metrics.length} échéances</span>}>
          {term && <Plot data={term.data} layout={term.layout} />}
        </Panel>

        <Panel className="col-span-12 h-[300px] xl:col-span-4" title="IV vs RV · 1 an" right={st?.spread_20 != null && <span>prime <span className={st.spread_20 > 0 ? "text-up" : "text-down"}>{signed(st.spread_20)} pts</span></span>}>
          <div className="flex h-full flex-col">
            <State loading={h.loading && !hd} error={h.error} />
            <div className="min-h-0 flex-1">{ivrv && <Plot data={ivrv.data} layout={ivrv.layout} />}</div>
            <div className="shrink-0 px-2 pb-0.5"><SourceTag env={h.env} /></div>
          </div>
        </Panel>

        {/* Historique */}
        <Panel className="col-span-12" title={`Historique 30 j · ${st?.n_days ?? 0} séance${(st?.n_days ?? 0) > 1 ? "s" : ""} enregistrée${(st?.n_days ?? 0) > 1 ? "s" : ""}`}
          right={hd && hd.iv.length > 0 && <Export name={`vol-historique-${s}`} columns={["Date", "Spot", "ATM 30 j %", "Skew 30 j (pts)", "Fly 30 j (pts)", "ATM 90 j %", "Skew 90 j (pts)", "Points"]}
            rows={hd.iv.map((r) => [r.date, r.spot, r.atm30 == null ? null : r.atm30 * 100, r.skew30 == null ? null : r.skew30 * 100, r.fly30 == null ? null : r.fly30 * 100, r.atm90 == null ? null : r.atm90 * 100, r.skew90 == null ? null : r.skew90 * 100, r.n_points])} source="VOL (historique local)" />}>
          {hd && hd.iv.length > 0 && <div className="max-h-56 overflow-auto"><table>
            <thead className="sticky top-0 bg-panel"><tr><th>Séance</th><th className="num">Spot</th><th className="num">ATM 30 j</th><th className="num">Skew 30 j</th><th className="num">Fly 30 j</th><th className="num">ATM 90 j</th><th className="num">Skew 90 j</th><th className="num">Pente 30→90</th><th className="num">Points IV</th></tr></thead>
            <tbody>{[...hd.iv].reverse().map((r) => <tr key={r.date}><td>{r.date}</td><td className="num">{num(r.spot, 2)}</td><td className="num text-fg">{volPct(r.atm30, 2)}</td>
              <td className="num">{volPct(r.skew30, 2)}</td><td className="num">{volPct(r.fly30, 2)}</td><td className="num">{volPct(r.atm90, 2)}</td><td className="num">{volPct(r.skew90, 2)}</td>
              <td className="num">{r.atm30 != null && r.atm90 != null ? signed(r.atm90 - r.atm30) : "–"}</td><td className="num text-dim">{r.n_points}</td></tr>)}</tbody>
          </table></div>}
          <div className="px-2 py-1 text-[10px] text-dim">
            Une ligne par séance : enregistrée à chaque calcul aux paramètres par défaut, et chaque jour de bourse à 15 h 30 (New York) pour SPY, QQQ, IWM et les sous-jacents déjà consultés.
            Les rangs historiques s&apos;affichent à partir de 20 séances.
          </div>
        </Panel>

        <div className="col-span-12 px-1 pb-1 text-[10px] text-dim">
          Méthode : options OTM uniquement (puts sous le forward, calls au-dessus), forward implicite par parité call-put, IV Black-76 sur le forward, surface 3D : chaque échéance interpolée linéairement entre ses seuls strikes cotés, variance totale interpolée entre échéances, aucune extrapolation.
          Maturité constante : variance totale interpolée entre les échéances encadrantes. RV : close-to-close annualisée √252. Vols en %, skew, fly et écarts en points de vol.
        </div>
      </>}
    </div>
  );
}
