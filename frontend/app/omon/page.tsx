"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import EChart from "@/components/EChart";
import Export from "@/components/Export";
import { Panel, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, num, pct, price, tone } from "@/lib/format";

type Side = { bid: number; ask: number; last: number; iv: number | null; delta: number; gamma: number; vega: number; theta: number; volume: number; oi: number; change: number };
type Chain = { symbol: string; underlying: number; iv30: number; expiries: string[]; expiry: string; T: number; rows: { strike: number; call?: Side; put?: Side }[]; oi_by_expiry: Record<string, { calls_oi: number; puts_oi: number }> };
type Surface = { underlying: number; moneyness: number[]; grid: { expiry: string; T: number; iv: (number | null)[] }[]; points: number };
type HV = Record<string, { current: number; min: number; max: number; median: number }>;

export default function OMON() {
  const router = useRouter();
  const sp = useSearchParams();
  const s = sp.get("s") || "AAPL";
  const [input, setInput] = useState(s);
  useEffect(() => setInput(s), [s]);
  const [expiry, setExpiry] = useState("");
  useEffect(() => setExpiry(""), [s]);
  const [width, setWidth] = useState(15);
  const c = useApi<Chain>(`/api/options/chain?symbol=${encodeURIComponent(s)}${expiry ? `&expiry=${expiry}` : ""}`, 5 * 60_000);
  const surf = useApi<Surface>(`/api/options/surface?symbol=${encodeURIComponent(s)}`, 5 * 60_000);
  const hv = useApi<HV>(`/api/options/hv?symbol=${encodeURIComponent(s)}`);
  const d = c.data;
  const rows = useMemo(() => {
    if (!d) return [];
    const i = d.rows.findIndex((r) => r.strike >= d.underlying);
    return d.rows.slice(Math.max(0, i - width), i + width);
  }, [d, width]);
  const totals = d && Object.values(d.oi_by_expiry).reduce((a, x) => ({ c: a.c + x.calls_oi, p: a.p + x.puts_oi }), { c: 0, p: 0 });
  const heat = useMemo(() => surf.data && {
    tooltip: { formatter: (p: any) => `${surf.data!.grid[p.value[1]].expiry} · ${Math.round(surf.data!.moneyness[p.value[0]] * 100)} % du cours<br/>vol. implicite ${num(p.value[2], 1)} %` },
    grid: { left: 70, right: 10, top: 10, bottom: 56 },
    xAxis: { type: "category", data: surf.data.moneyness.map((m) => `${Math.round(m * 100)} %`), axisLabel: { color: "#7486a0" } },
    yAxis: { type: "category", data: surf.data.grid.map((g) => g.expiry), axisLabel: { color: "#7486a0", fontSize: 9 } },
    visualMap: { min: Math.min(...surf.data.grid.flatMap((g) => g.iv.filter((x): x is number => x != null))), max: Math.max(...surf.data.grid.flatMap((g) => g.iv.filter((x): x is number => x != null))),
      orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, textStyle: { color: "#7486a0" }, inRange: { color: ["#0b3a6e", "#1fd15f", "#ffa028", "#ff4d4d"] } },
    series: [{ type: "heatmap", data: surf.data.grid.flatMap((g, y) => g.iv.map((v, x) => (v == null ? null : [x, y, v])).filter(Boolean)), label: { show: surf.data.grid.length < 14, color: "#000", fontSize: 9, formatter: (p: any) => num(p.value[2], 0) } }],
  }, [surf.data]);
  const toOvme = (k: number, type: "call" | "put", x?: Side) => router.push(`/ovme?S=${d!.underlying}&K=${k}&T=${d!.T.toFixed(4)}&type=${type}${x?.iv ? `&vol=${(x.iv * 100).toFixed(2)}` : ""}${x ? `&px=${((x.bid + x.ask) / 2).toFixed(3)}` : ""}&s=${encodeURIComponent(s)}&mkt=1`);
  const cell = (x: Side | undefined, k: string, f: (v: number) => string) => (x && (x as any)[k] != null ? f((x as any)[k]) : "–");
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 xl:col-span-8 xl:row-span-2" title={<span className="normal-case tracking-normal">OMON · <form className="inline" onSubmit={(e) => { e.preventDefault(); router.push(`/omon?s=${encodeURIComponent(input.trim().toUpperCase())}`); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} className="w-24 uppercase" /></form>
        {d && <> <span className="text-fg">{price(d.underlying)}</span> · vol. impl. 30 j {num(d.iv30, 1)} % · échéance <select value={d.expiry} onChange={(e) => setExpiry(e.target.value)}>{d.expiries.map((e) => <option key={e}>{e}</option>)}</select> ({Math.round(d.T * 365)} j)
          · <select value={width} onChange={(e) => setWidth(+e.target.value)}>{[5, 10, 15, 25, 50].map((w) => <option key={w} value={w}>±{w} prix</option>)}</select></>}</span>}
        right={<>{d && <Export name={`options-${s}-${d.expiry}`} columns={["Strike", "Call bid", "Call ask", "Call IV", "Call delta", "Call OI", "Put bid", "Put ask", "Put IV", "Put delta", "Put OI"]}
          rows={d.rows.map((r) => [r.strike, r.call?.bid, r.call?.ask, r.call?.iv, r.call?.delta, r.call?.oi, r.put?.bid, r.put?.ask, r.put?.iv, r.put?.delta, r.put?.oi])} source={c.env?.source} />}<SourceTag env={c.env} /></>}>
        <State loading={c.loading && !d} error={c.error} />
        {d && <table>
          <thead><tr><th className="num">OI</th><th className="num">Vol.</th><th className="num">Δ</th><th className="num">VI</th><th className="num">Var.</th><th className="num">Bid</th><th className="num">Ask</th>
            <th className="bg-raised text-center text-amber">Strike</th><th className="num">Bid</th><th className="num">Ask</th><th className="num">Var.</th><th className="num">VI</th><th className="num">Δ</th><th className="num">Vol.</th><th className="num">OI</th></tr>
            <tr><th colSpan={7} className="text-center text-up">CALLS</th><th /><th colSpan={7} className="text-center text-down">PUTS</th></tr></thead>
          <tbody>{rows.map((r) => {
            const itmC = r.strike < d.underlying;
            return <tr key={r.strike}>
              {(["oi", "volume", "delta", "iv", "change", "bid", "ask"] as const).map((k) => <td key={k} onClick={() => toOvme(r.strike, "call", r.call)} className={`num cursor-pointer ${itmC ? "bg-up/10" : ""} ${k === "change" ? tone(r.call?.change) : ""}`}>
                {cell(r.call, k, (v) => k === "iv" ? num(v * 100, 1) : k === "delta" ? num(v, 2) : k === "oi" || k === "volume" ? big(v) : num(v, 2))}</td>)}
              <td className="bg-raised text-center font-bold text-amber">{num(r.strike, r.strike % 1 ? 1 : 0)}</td>
              {(["bid", "ask", "change", "iv", "delta", "volume", "oi"] as const).map((k) => <td key={k} onClick={() => toOvme(r.strike, "put", r.put)} className={`num cursor-pointer ${!itmC ? "bg-down/10" : ""} ${k === "change" ? tone(r.put?.change) : ""}`}>
                {cell(r.put, k, (v) => k === "iv" ? num(v * 100, 1) : k === "delta" ? num(v, 2) : k === "oi" || k === "volume" ? big(v) : num(v, 2))}</td>)}
            </tr>;
          })}</tbody>
        </table>}
        <div className="px-2 py-1 text-[10px] text-dim">Fond coloré : dans la monnaie. VI et grecques fournies par la source (Tradier : modèle ORATS, mises à jour toutes les heures). Clic sur une ligne : valorisation dans OVME au marché (smile de la surface VOL, écart du prix coté vs surface). Options cotées aux États-Unis uniquement.</div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Surface de volatilité implicite" right={<SourceTag env={surf.env} />}>
        <State loading={surf.loading && !surf.data} error={surf.error} />
        <div className="h-72">{heat && <EChart option={heat} />}</div>
        {surf.data && <div className="px-2 text-[10px] text-dim">Axe horizontal : prix d&apos;exercice en % du cours. {surf.data.points} options hors de la monnaie avec intérêt ouvert ; médiane par tranche de ±2,5 %.</div>}
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Volatilité historique vs implicite" right={<SourceTag env={hv.env} />}>
        <State loading={hv.loading && !hv.data} error={hv.error} />
        {hv.data && <table><thead><tr><th>Fenêtre</th><th className="num">Actuelle</th><th className="num">Min 2 ans</th><th className="num">Médiane</th><th className="num">Max</th></tr></thead>
          <tbody>{Object.entries(hv.data).map(([n, v]) => <tr key={n}><td>{n} séances</td><td className="num text-fg">{num(v.current, 1)} %</td><td className="num">{num(v.min, 1)}</td><td className="num">{num(v.median, 1)}</td><td className="num">{num(v.max, 1)}</td></tr>)}
            {d && <tr className="border-t border-amber"><td>Implicite 30 j</td><td className="num text-amber">{num(d.iv30, 1)} %</td><td colSpan={3} className="text-dim">prime de vol. : {num(d.iv30 - (hv.data["20"]?.current ?? NaN), 1)} pt vs 20 j</td></tr>}</tbody></table>}
        {totals && <div className="px-2 py-1">Intérêt ouvert total : calls {big(totals.c)} · puts {big(totals.p)} · ratio put/call <span className="text-amber">{num(totals.p / totals.c, 2)}</span></div>}
        <div className="px-2 pb-1"><Link href={`/ovme?s=${encodeURIComponent(s)}`} className="text-info">OVME : calculateur et stratégies →</Link></div>
      </Panel>
    </div>
  );
}
