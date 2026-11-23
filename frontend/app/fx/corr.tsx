"use client";
import { useEffect, useMemo, useState } from "react";
import EChart from "@/components/EChart";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { num } from "@/lib/format";
import { assetLabel, betaSentence, type Driver, FLAG, pairLabel, useCorr, useDrivers } from "./shared";

const TT = { backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 } };
const AX = { axisLabel: { color: "#7486a0", fontSize: 10 }, axisLine: { lineStyle: { color: "#1c2b42" } }, splitLine: { lineStyle: { color: "#0e1828" } } };
const corrCls = (v: number | null | undefined) => (v == null ? "text-dim" : Math.abs(v) >= 0.6 ? (v > 0 ? "text-info" : "text-down") : Math.abs(v) >= 0.3 ? "text-fg" : "text-dim");

/** Mini-courbe de corrélation glissante, entre -1 et 1. */
function CorrSpark({ pts }: { pts: [string, number | null][] }) {
  const v = pts.map((p) => p[1]).filter((x): x is number => x != null);
  if (v.length < 2) return null;
  const W = 90, H = 18, y = (x: number) => (H / 2 - (x * (H / 2 - 1))).toFixed(1);
  return (
    <svg width={W} height={H} className="inline-block align-middle" aria-hidden>
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-line" strokeWidth={1} />
      <polyline points={v.map((x, i) => `${((i / (v.length - 1)) * W).toFixed(1)},${y(x)}`).join(" ")} fill="none" strokeWidth={1} className={v.at(-1)! >= 0 ? "stroke-info" : "stroke-down"} />
    </svg>
  );
}

export default function CorrView({ pair, open }: { pair: string; open: (p: string) => void }) {
  return (
    <div className="grid grid-cols-12 gap-1">
      <DriversPanel pair={pair} />
      <Matrix open={open} />
    </div>
  );
}

function DriversPanel({ pair }: { pair: string }) {
  const { data, env, error, loading } = useDrivers(pair);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => setSel(null), [pair]);
  const d: Driver | undefined = data?.drivers.find((x) => x.name === sel) ?? data?.drivers[0];
  const opt = useMemo(() => {
    if (!d || !data) return null;
    const px = Object.fromEntries(data.pair_series);
    const dates = d.level.map((x) => x[0]);
    return {
      grid: [{ left: 8, right: 8, top: 26, height: "56%", containLabel: true }, { left: 8, right: 8, top: "72%", bottom: 6, containLabel: true }],
      legend: { top: 0, left: 0, textStyle: { color: "#d4dbe6", fontSize: 10 }, itemWidth: 12, itemHeight: 2, icon: "rect" },
      tooltip: { trigger: "axis", ...TT, valueFormatter: (v: number) => num(v, 4) },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      xAxis: [{ type: "category", data: dates, ...AX, axisLabel: { show: false } },
        { type: "category", gridIndex: 1, data: dates, ...AX, axisLabel: { ...AX.axisLabel, formatter: (x: string) => `${x.slice(8)}/${x.slice(5, 7)}` } }],
      yAxis: [{ type: "value", scale: true, ...AX, axisLabel: { ...AX.axisLabel, color: "#ffa028" } },
        { type: "value", scale: true, ...AX, splitLine: { show: false }, position: "right", axisLabel: { ...AX.axisLabel, color: "#4aa8ff" } },
        { type: "value", gridIndex: 1, min: -1, max: 1, interval: 0.5, ...AX }],
      series: [
        { name: pairLabel(pair), type: "line", showSymbol: false, data: dates.map((x) => px[x] ?? null), lineStyle: { color: "#ffa028", width: 1.6 }, itemStyle: { color: "#ffa028" } },
        { name: d.name, type: "line", yAxisIndex: 1, showSymbol: false, data: d.level.map((x) => x[1]), lineStyle: { color: "#4aa8ff", width: 1.2 }, itemStyle: { color: "#4aa8ff" } },
        { name: "Corrélation glissante 60 séances", type: "line", xAxisIndex: 1, yAxisIndex: 2, showSymbol: false, itemStyle: { color: "#c77dff" },
          data: (() => { const r = Object.fromEntries(d.rolling); return dates.map((x) => r[x] ?? null); })(), lineStyle: { color: "#c77dff", width: 1.4 },
          areaStyle: { color: "rgba(199,125,255,.12)", origin: 0 }, markLine: { silent: true, symbol: "none", lineStyle: { color: "#4d5d75", type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } },
      ],
    };
  }, [d, data, pair]);
  return (
    <>
      <Panel className="col-span-12 xl:col-span-5" title={`Moteurs de ${pairLabel(pair)}`} right={<SourceTag env={env} />}>
        <State loading={loading && !data} error={error} />
        {data && <table>
          <thead><tr><th>Moteur</th><th className="num">20 j</th><th className="num">60 j</th><th className="num">1 an</th>
            <th className="num" title="Variation de la paire (en %) pour +1 % du moteur, ou +10 pb pour un taux, sur un an">Bêta</th><th>Corrélation 60 j glissante</th></tr></thead>
          <tbody>{data.drivers.map((x) => (
            <tr key={x.name} onClick={() => setSel(x.name)} className={`cursor-pointer hover:bg-raised ${x.name === d?.name ? "bg-raised" : ""}`}>
              <td className={x.name === d?.name ? "text-amber" : "text-fg"}>{x.name}{x.break && <span className="ml-1 border border-amber px-1 text-[9px] text-amber" title="La corrélation sur 20 séances s'écarte de plus de 0,5 de celle d'un an : la relation habituelle est en train de changer">RUPTURE</span>}</td>
              <td className={`num ${corrCls(x.corr20)}`}>{num(x.corr20, 2)}</td><td className={`num ${corrCls(x.corr60)}`}>{num(x.corr60, 2)}</td><td className={`num ${corrCls(x.corr250)}`}>{num(x.corr250, 2)}</td>
              <td className="num">{num(x.beta, 2)}<span className="text-[9px] text-dim">{x.kind === "yield" ? "/10pb" : ""}</span></td>
              <td><CorrSpark pts={x.rolling} /></td>
            </tr>))}</tbody>
        </table>}
        {data && <div className="space-y-1 px-2 py-1 text-[10px] text-dim">
          <p>Classés par force du lien sur 60 séances. Bleu : la paire monte avec le moteur ; rouge : en sens inverse. Les taux sont pris en variations quotidiennes (points de base), les prix en rendements.</p>
          {data.notes.map((n) => <p key={n} className="text-amber">{n}</p>)}
          {pair === "EURUSD" && <p>Écart 2 ans : taux à 2 ans de la zone euro (courbe AAA de la BCE) moins taux du Trésor américain à 2 ans, le moteur fondamental d&apos;EUR/USD.</p>}
        </div>}
      </Panel>
      <Panel className="col-span-12 xl:col-span-7" title={d ? `${pairLabel(pair)} et ${d.name} · 1 an` : "Moteur"}>
        {d && <div className="px-2 pt-1 text-[11px]">{betaSentence(pair, d)}</div>}
        <div className="h-[420px]">{opt && <EChart option={opt} />}</div>
      </Panel>
    </>
  );
}

function Matrix({ open }: { open: (p: string) => void }) {
  const { data, env, error, loading } = useCorr();
  const [w, setW] = useState("60");
  const [mode, setMode] = useState<"ccy" | "assets">("ccy");
  const labels = mode === "ccy" ? data?.ccy_labels ?? [] : data?.labels ?? [];
  const m = mode === "ccy" ? data?.ccy_windows[w] : data?.windows[w];
  const shown = labels.map((l) => (mode === "ccy" ? `${FLAG[l] ?? ""} ${l}` : assetLabel(l)));
  const opt = useMemo(() => m && ({
    grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
    tooltip: { ...TT, formatter: (p: { value: [number, number, number | null] }) => `${shown[p.value[1] + 1]} × ${shown[p.value[0]]}<br/>corrélation ${num(p.value[2], 2)}` },
    xAxis: { type: "category", data: shown.slice(0, -1), axisLabel: { color: "#d4dbe6", fontSize: 10, rotate: mode === "ccy" ? 0 : 40 }, axisLine: { lineStyle: { color: "#1c2b42" } }, splitLine: { show: false } },
    yAxis: { type: "category", data: shown.slice(1), inverse: true, axisLabel: { color: "#d4dbe6", fontSize: 10 }, axisLine: { lineStyle: { color: "#1c2b42" } } },
    visualMap: { min: -1, max: 1, show: false, inRange: { color: ["#ff4d4d", "#5a1f28", "#0e1828", "#163a5c", "#4aa8ff"] } },
    // triangle inférieur seulement : la matrice est symétrique
    series: [{ type: "heatmap", data: m.flatMap((row, i) => row.map((v, j) => (j < i ? [j, i - 1, v] : null)).filter(Boolean)),
      label: { show: true, color: "#d4dbe6", fontSize: 9, formatter: (p: { value: [number, number, number | null] }) => (p.value[2] == null ? "" : num(p.value[2], 2)) },
      itemStyle: { borderColor: "#08101d", borderWidth: 1 }, emphasis: { itemStyle: { borderColor: "#ffa028", borderWidth: 1 } } }],
  }), [m, shown, mode]);
  return (
    <Panel className="col-span-12" title="Matrice de corrélation"
      right={<><Seg value={mode} options={[["ccy", "Devises contre le panier"], ["assets", "Paires et actifs"]]} onChange={setMode} />
        <Seg value={w} options={[["20", "20 j"], ["60", "60 j"], ["250", "1 an"]]} onChange={setW} /><SourceTag env={env} /></>}>
      <State loading={loading && !data} error={error} />
      {opt && <div className={mode === "ccy" ? "h-[380px]" : "h-[520px]"}><EChart option={opt} onClick={(p) => { if (mode === "assets") { const l = labels[p.value[1] + 1]; if (/^[A-Z]{6}$/.test(l)) open(l); } }} /></div>}
      <div className="px-2 py-1 text-[10px] text-dim">{mode === "ccy"
        ? "Chaque devise est mesurée contre la moyenne des 10 devises du G10, ce qui retire l'effet mécanique du dollar commun aux paires : on voit quelles devises évoluent réellement ensemble (blocs européen, valeurs refuges, devises liées aux matières premières)."
        : `Rendements quotidiens des paires, du DXY et d'actifs croisés (${data?.obs ?? "–"} séances communes). Les paires cotées dans des sens opposés contre le dollar (EUR/USD et USD/CHF) sont naturellement opposées. Cliquer sur une case ouvre la paire en ligne.`}</div>
    </Panel>
  );
}
