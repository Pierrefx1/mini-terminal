"use client";
import * as echarts from "echarts";
import { useEffect, useRef } from "react";

const AXIS = { axisLine: { lineStyle: { color: "#1c2b42" } }, axisLabel: { color: "#7486a0", fontSize: 10 }, splitLine: { lineStyle: { color: "#0e1828" } } };
export const PALETTE = ["#ffa028", "#4aa8ff", "#c77dff", "#1fd15f", "#ff4d9a", "#e6e600", "#9aa0a6", "#00d1c1"];

export default function EChart({ option, onClick, className = "h-full w-full" }: { option: any; onClick?: (p: any) => void; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const cb = useRef(onClick); cb.current = onClick;
  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: "canvas" });
    inst.current = c;
    c.on("click", (p) => cb.current?.(p));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); c.dispose(); };
  }, []);
  useEffect(() => { inst.current?.setOption({ backgroundColor: "transparent", textStyle: { fontFamily: "var(--font-geist-mono), monospace" }, color: PALETTE, ...option }, true); }, [option]);
  return <div ref={el} className={className} />;
}

export type Line = { name: string; data: [string | number, number | null][]; step?: boolean; dashed?: boolean; color?: string };

/** Courbes temporelles (axe des dates) ou catégorielles (axe libre). */
export function lineOption(lines: Line[], o: { category?: string[]; unit?: string; decimals?: number; zero?: boolean; legend?: boolean } = {}) {
  const d = o.decimals ?? 2;
  const fmt = (v: number) => (v == null ? "–" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }) + (o.unit ?? ""));
  return {
    grid: { left: 8, right: 12, top: o.legend === false ? 10 : 26, bottom: 6, containLabel: true },
    legend: { show: o.legend !== false, top: 0, left: 0, textStyle: { color: "#d4dbe6", fontSize: 10 }, itemWidth: 12, itemHeight: 2, icon: "rect" },
    tooltip: { trigger: "axis", backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 }, valueFormatter: fmt, axisPointer: { lineStyle: { color: "#4d5d75" } } },
    xAxis: o.category ? { type: "category", data: o.category, ...AXIS, splitLine: { show: false } } : { type: "time", ...AXIS, splitLine: { show: false } },
    yAxis: { type: "value", scale: !o.zero, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v) } },
    series: lines.map((l) => ({
      name: l.name, type: "line", data: o.category ? l.data.map((p) => p[1]) : l.data, showSymbol: !!o.category, symbolSize: 4, connectNulls: true,
      step: l.step ? "end" : false, lineStyle: { width: 1.5, type: l.dashed ? "dashed" : "solid", color: l.color }, itemStyle: l.color ? { color: l.color } : undefined,
    })),
  };
}
