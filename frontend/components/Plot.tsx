"use client";
import { useEffect, useRef } from "react";

/** Thème Plotly du terminal : fond transparent, police mono, grilles et textes aux couleurs de globals.css. */
const AXIS = { gridcolor: "#1c2b42", zerolinecolor: "#2a3d5c", linecolor: "#1c2b42", tickfont: { color: "#7486a0", size: 10 }, title: { font: { color: "#7486a0", size: 10 } } };
export const PLOT_LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "var(--font-geist-mono), ui-monospace, Menlo, monospace", color: "#d4dbe6", size: 10 },
  margin: { l: 48, r: 12, t: 8, b: 36 },
  xaxis: AXIS, yaxis: AXIS,
  scene: { bgcolor: "rgba(0,0,0,0)", xaxis: { ...AXIS, backgroundcolor: "rgba(0,0,0,0)" }, yaxis: { ...AXIS, backgroundcolor: "rgba(0,0,0,0)" }, zaxis: { ...AXIS, backgroundcolor: "rgba(0,0,0,0)" } },
  hoverlabel: { bgcolor: "#0e1828", bordercolor: "#ffa028", font: { color: "#d4dbe6" } },
  legend: { font: { color: "#7486a0" }, bgcolor: "rgba(0,0,0,0)" },
};

/** Fusion profonde des objets de mise en page (les tableaux et valeurs simples remplacent). */
function merge(a: any, b: any): any {
  if (!b || typeof b !== "object" || Array.isArray(b)) return b ?? a;
  const out = { ...(a ?? {}) };
  for (const k of Object.keys(b)) out[k] = a && typeof a[k] === "object" && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k];
  return out;
}

/** Graphique Plotly (chargé côté navigateur uniquement), redimensionné avec son panneau. */
export default function Plot({ data, layout, className = "h-full w-full" }: { data: any[]; layout?: any; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const lib = useRef<any>(null);
  useEffect(() => {
    let alive = true;
    const node = el.current;
    if (!node) return;
    import("plotly.js-dist-min").then((m) => {
      if (!alive) return;
      lib.current = m.default ?? m;
      lib.current.react(node, data, merge(PLOT_LAYOUT, { ...layout, autosize: true }), { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["toImage", "sendDataToCloud"] });
    });
    return () => { alive = false; };
  }, [data, layout]);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const ro = new ResizeObserver(() => { if (lib.current && node.offsetParent) lib.current.Plots.resize(node); });
    ro.observe(node);
    return () => { ro.disconnect(); lib.current?.purge(node); };
  }, []);
  return <div ref={el} className={className} />;
}
