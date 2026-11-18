"use client";
import { useMemo, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import Export from "@/components/Export";
import { Num, Out, Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { num, pct, tone } from "@/lib/format";
import * as Q from "@/lib/quant";

type Curve = { name: string; date?: string; error?: string; points: { tenor: string; years: number; rate: number; prev: number | null }[] };
type Series = { label: string; id: string; last?: number; date?: string; prev?: number; year_ago?: number; obs?: [string, number][]; error?: string };

function Curves() {
  const c = useApi<Curve[]>("/api/rates/curves", 30 * 60_000);
  const opt = useMemo(() => c.data && {
    ...lineOption(c.data.filter((x) => x.points.length).map((x) => ({ name: x.name, data: x.points.map((p) => [p.years, p.rate] as [number, number]) })), { unit: " %" }),
    xAxis: { type: "value", name: "années", nameTextStyle: { color: "#7486a0" }, axisLabel: { color: "#7486a0" }, splitLine: { show: false } },
  }, [c.data]);
  return (
    <Panel className="h-full" title="Courbes des taux souverains" right={<SourceTag env={c.env} />}>
      <State loading={c.loading && !c.data} error={c.error} />
      <div className="h-56">{opt && <EChart option={opt} />}</div>
      {c.data?.map((x) => (
        <div key={x.name}>
          <div className="bg-raised px-2 text-[10px] uppercase text-dim">{x.name} {x.date && `· ${x.date}`} {x.error && <span className="text-down">{x.error}</span>}</div>
          <table><tbody><tr>{x.points.map((p) => <td key={p.tenor} className="num"><div className="text-[10px] text-dim">{p.tenor}</div>{num(p.rate, 2)}<div className={`text-[10px] ${tone(p.prev == null ? null : p.rate - p.prev)}`}>{p.prev == null ? "" : `${p.rate - p.prev > 0 ? "+" : ""}${Math.round((p.rate - p.prev) * 100)} pb`}</div></td>)}</tr></tbody></table>
          {x.points.length > 2 && <div className="px-2 pb-1 text-[11px] text-dim">
            {(() => { const g = (t: number) => x.points.find((p) => p.years === t)?.rate; const s2 = g(2), s10 = g(10), s30 = g(30), m3 = x.points.find((p) => p.years === 0.25)?.rate;
              return <>2-10 ans <span className={tone(s10 != null && s2 != null ? s10 - s2 : null)}>{s10 != null && s2 != null ? `${Math.round((s10 - s2) * 100)} pb` : "–"}</span> · 3 mois-10 ans {s10 != null && m3 != null ? `${Math.round((s10 - m3) * 100)} pb` : "–"} · 10-30 ans {s30 != null && s10 != null ? `${Math.round((s30 - s10) * 100)} pb` : "–"}</>; })()}
          </div>}
        </div>))}
    </Panel>
  );
}

function SeriesTable({ url, title, unit, spreadVs, bp }: { url: string; title: string; unit: string; spreadVs?: string; bp?: boolean }) {
  const s = useApi<Series[]>(url, 60 * 60_000);
  const [sel, setSel] = useState<string | null>(null);
  const cur = s.data?.find((x) => x.id === sel) ?? s.data?.[0];
  const ref = spreadVs ? s.data?.find((x) => x.label.startsWith(spreadVs))?.last : undefined;
  const opt = useMemo(() => cur?.obs && lineOption([{ name: cur.label, data: cur.obs.map(([d, v]) => [d, v]) }], { legend: false, unit }), [cur, unit]);
  return (
    <Panel className="h-full" title={title} right={<><Export name={title} columns={["Série", "Code", "Date", "Dernier", "Précédent", "Il y a un an"]} rows={(s.data ?? []).map((x) => [x.label, x.id, x.date ?? null, x.last ?? null, x.prev ?? null, x.year_ago ?? null])} source={s.env?.source} /><SourceTag env={s.env} /></>}>
      <State loading={s.loading && !s.data} error={s.error} />
      <table><thead><tr><th>Série</th><th className="num">Dernier</th><th className="num">Var.</th><th className="num">1 an</th>{spreadVs && <th className="num">vs {spreadVs}</th>}<th>Date</th></tr></thead>
        <tbody>{s.data?.map((x) => <tr key={x.id} onClick={() => setSel(x.id)} className={`cursor-pointer ${cur?.id === x.id ? "bg-raised" : ""}`}>
          <td className={cur?.id === x.id ? "text-amber" : ""}>{x.label}</td>
          {x.error ? <td colSpan={4} className="text-down">{x.error}</td> : <>
            <td className="num text-fg">{num(x.last, 2)}{unit}</td>
            <td className={`num ${tone(x.prev == null ? null : x.last! - x.prev)}`}>{x.prev == null ? "–" : bp ? `${Math.round((x.last! - x.prev) * 100)} pb` : num(x.last! - x.prev, 2)}</td>
            <td className={`num ${tone(x.year_ago == null ? null : x.last! - x.year_ago)}`}>{x.year_ago == null ? "–" : `${Math.round((x.last! - x.year_ago) * 100)} pb`}</td>
            {spreadVs && <td className="num">{ref == null || x.last == null ? "–" : `${Math.round((x.last - ref) * 100)} pb`}</td>}
            <td className="text-dim">{x.date}</td></>}</tr>)}</tbody></table>
      <div className="h-40">{opt && <EChart option={opt} />}</div>
    </Panel>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function Calculator() {
  const curves = useApi<Curve[]>("/api/rates/curves", 30 * 60_000);
  const [settle, setSettle] = useState(today()), [maturity, setMaturity] = useState("2036-02-15");
  const [coupon, setCoupon] = useState(4.5), [freq, setFreq] = useState<"1" | "2" | "4">("2");
  const [mode, setMode] = useState<"price" | "yield">("price");
  const [clean, setClean] = useState(98.5), [yld, setYld] = useState(4.7);
  const [notional, setNotional] = useState(10_000_000), [callDate, setCallDate] = useState(""), [callPx, setCallPx] = useState(100), [sigma, setSigma] = useState(1);
  const [curveName, setCurveName] = useState("États-Unis, Trésor (nominal)");
  const out = useMemo(() => {
    try {
      const b: Q.Bond = { settle, maturity, coupon: coupon / 100, freq: +freq as 1 | 2 | 4 };
      const y = mode === "price" ? Q.yieldFromClean(b, clean) : yld / 100;
      const r = Q.bondFromYield(b, y);
      const c = curves.data?.find((x) => x.name === curveName);
      // rendements au pair (composition semestrielle) -> taux zéro continus approchés
      const zero = c?.points.length ? c.points.map((p) => ({ t: p.years, r: 2 * Math.log(1 + p.rate / 200) })) : null;
      return {
        y, r, shocks: Q.rateShocks(b, y, [-200, -100, -50, -25, 25, 50, 100, 200]),
        ytc: callDate && callDate < maturity && callDate > settle ? Q.yieldToCall(b, r.clean, callDate, callPx) : null,
        z: zero ? Q.zSpread(b, r.dirty, zero) : null,
        oas: zero ? Q.oasHoLee(b, r.dirty, zero, sigma / 100, callDate && callDate < maturity && callDate > settle ? callDate : undefined, callPx) : null,
      };
    } catch (e) { return { error: (e as Error).message }; }
  }, [settle, maturity, coupon, freq, mode, clean, yld, callDate, callPx, sigma, curves.data, curveName]);
  return (
    <Panel className="h-full" title="YAS · calculateur obligataire">
      <div className="grid grid-cols-12 gap-x-6 px-2 py-1">
        <div className="col-span-12 md:col-span-5">
          <label className="flex justify-between py-0.5"><span className="text-dim">Règlement</span><input type="date" value={settle} onChange={(e) => setSettle(e.target.value)} /></label>
          <label className="flex justify-between py-0.5"><span className="text-dim">Échéance</span><input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} /></label>
          <Num label="Coupon" value={coupon} onChange={setCoupon} step={0.125} suffix="%" />
          <div className="flex justify-between py-0.5"><span className="text-dim">Fréquence</span><Seg value={freq} options={[["1", "Annuel"], ["2", "Semestriel"], ["4", "Trim."]]} onChange={setFreq} /></div>
          <div className="flex justify-between py-0.5"><span className="text-dim">Saisie</span><Seg value={mode} options={[["price", "Prix → rendement"], ["yield", "Rendement → prix"]]} onChange={setMode} /></div>
          {mode === "price" ? <Num label="Prix pied de coupon" value={clean} onChange={setClean} step={0.01} /> : <Num label="Rendement actuariel" value={yld} onChange={setYld} step={0.01} suffix="%" />}
          <Num label="Nominal" value={notional} onChange={setNotional} step={1_000_000} />
          <label className="flex justify-between py-0.5"><span className="text-dim">Date de call (facultatif)</span><input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} /></label>
          <Num label="Prix de call" value={callPx} onChange={setCallPx} step={0.5} />
          <label className="flex justify-between py-0.5"><span className="text-dim">Courbe de référence (spreads)</span>
            <select value={curveName} onChange={(e) => setCurveName(e.target.value)}>{curves.data?.filter((c) => c.points.length).map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
          <Num label="Volatilité des taux (modèle de Ho-Lee)" value={sigma} onChange={setSigma} step={0.1} suffix="%/an" />
        </div>
        <div className="col-span-12 md:col-span-7">
          {"error" in out ? <div className="text-down">{out.error}</div> : <>
            <Out label="Rendement actuariel (YTM)" value={pct(out.y * 100, 4).replace("+", "")} cls="text-amber" />
            {out.ytc != null && <Out label="Rendement au call (YTC)" value={pct(out.ytc * 100, 4).replace("+", "")} />}
            {out.ytc != null && <Out label="Rendement au pire (YTW)" value={pct(Math.min(out.ytc, out.y) * 100, 4).replace("+", "")} />}
            <Out label="Prix pied de coupon / plein coupon" value={`${num(out.r.clean, 4)} / ${num(out.r.dirty, 4)}`} />
            <Out label="Coupon couru (ACT/ACT ICMA)" value={num(out.r.accrued, 4)} />
            <Out label="Duration de Macaulay / modifiée" value={`${num(out.r.macaulay, 3)} / ${num(out.r.modified, 3)}`} />
            <Out label="Convexité" value={num(out.r.convexity, 3)} />
            <Out label="DV01 (pour 100 / pour le nominal)" value={`${num(out.r.dv01, 4)} / ${num(out.r.dv01 * notional / 100, 0)}`} />
            <Out label="Valeur de la position (plein coupon)" value={num(out.r.dirty * notional / 100, 0)} />
            <Out label="Z-spread" value={out.z == null ? "–" : `${num(out.z * 10_000, 1)} pb`} title="Écart constant ajouté à la courbe zéro (approchée à partir des rendements au pair) qui redonne le prix." />
            <Out label="OAS (Ho-Lee)" value={out.oas == null ? "–" : `${num(out.oas * 10_000, 1)} pb`} title="Écart ajusté de l'option : arbre de Ho-Lee calé sur la courbe zéro. Sans call, égal au Z-spread." />
            <table className="mt-1"><thead><tr><th className="num">Choc</th><th className="num">Prix</th><th className="num">Variation</th><th className="num">Var. %</th><th className="num">Approx. dur.+conv.</th><th className="num">P&L position</th></tr></thead>
              <tbody>{out.shocks.map((s) => <tr key={s.bp}><td className={`num ${tone(-s.bp)}`}>{s.bp > 0 ? "+" : ""}{s.bp} pb</td><td className="num">{num(s.price, 3)}</td><td className={`num ${tone(s.change)}`}>{num(s.change, 3)}</td>
                <td className={`num ${tone(s.pct)}`}>{pct(s.pct)}</td><td className="num text-dim">{pct(s.approxPct)}</td><td className={`num ${tone(s.change)}`}>{num(s.change * notional / 100, 0)}</td></tr>)}</tbody></table>
          </>}
        </div>
      </div>
      <div className="px-2 pb-1 text-[10px] text-dim">Convention de marché : actualisation à la fréquence du coupon, coupon couru ACT/ACT ICMA. Les cotations d&apos;obligations individuelles (entreprises, convertibles) ne sont pas diffusées gratuitement : le calculateur valorise tout titre à partir de ses caractéristiques.</div>
    </Panel>
  );
}

export default function FixedIncome() {
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <div className="col-span-12 min-h-[420px] xl:col-span-5"><Curves /></div>
      <div className="col-span-12 min-h-[420px] xl:col-span-7"><Calculator /></div>
      <div className="col-span-12 min-h-[380px] lg:col-span-6"><SeriesTable url="/api/rates/sovereign" title="Taux souverains à 10 ans (moyenne mensuelle)" unit=" %" spreadVs="Allemagne" bp /></div>
      <div className="col-span-12 min-h-[380px] lg:col-span-6"><SeriesTable url="/api/rates/credit" title="Crédit (OAS) et inflation" unit=" %" bp /></div>
    </div>
  );
}
