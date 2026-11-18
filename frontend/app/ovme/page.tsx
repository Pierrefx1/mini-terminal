"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import { Num, Out, Panel, Seg } from "@/components/ui";
import { num, pct, tone } from "@/lib/format";
import * as Q from "@/lib/quant";

type LegIn = Q.Leg & { id: number; T?: number };
const STRATS: Record<string, (S: number) => Omit<LegIn, "id">[]> = {
  "Call acheté": (S) => [{ kind: "call", side: 1, qty: 1, K: S }],
  "Put acheté": (S) => [{ kind: "put", side: 1, qty: 1, K: S }],
  "Call couvert": (S) => [{ kind: "underlying", side: 1, qty: 1 }, { kind: "call", side: -1, qty: 1, K: S * 1.05 }],
  "Put de protection": (S) => [{ kind: "underlying", side: 1, qty: 1 }, { kind: "put", side: 1, qty: 1, K: S * 0.95 }],
  "Écart haussier (call spread)": (S) => [{ kind: "call", side: 1, qty: 1, K: S }, { kind: "call", side: -1, qty: 1, K: S * 1.1 }],
  "Écart baissier (put spread)": (S) => [{ kind: "put", side: 1, qty: 1, K: S }, { kind: "put", side: -1, qty: 1, K: S * 0.9 }],
  Straddle: (S) => [{ kind: "call", side: 1, qty: 1, K: S }, { kind: "put", side: 1, qty: 1, K: S }],
  Strangle: (S) => [{ kind: "call", side: 1, qty: 1, K: S * 1.05 }, { kind: "put", side: 1, qty: 1, K: S * 0.95 }],
  "Tunnel (collar)": (S) => [{ kind: "underlying", side: 1, qty: 1 }, { kind: "put", side: 1, qty: 1, K: S * 0.9 }, { kind: "call", side: -1, qty: 1, K: S * 1.1 }],
  "Papillon (butterfly)": (S) => [{ kind: "call", side: 1, qty: 1, K: S * 0.95 }, { kind: "call", side: -1, qty: 2, K: S }, { kind: "call", side: 1, qty: 1, K: S * 1.05 }],
  "Condor de fer (iron condor)": (S) => [{ kind: "put", side: 1, qty: 1, K: S * 0.85 }, { kind: "put", side: -1, qty: 1, K: S * 0.92 }, { kind: "call", side: -1, qty: 1, K: S * 1.08 }, { kind: "call", side: 1, qty: 1, K: S * 1.15 }],
};

export default function OVME() {
  const sp = useSearchParams();
  const f = (k: string, d: number) => { const v = Number(sp.get(k)); return sp.get(k) && Number.isFinite(v) ? v : d; };
  const [S, setS] = useState(100), [K, setK] = useState(100), [T, setT] = useState(0.5), [r, setR] = useState(4), [q, setQ] = useState(0), [vol, setVol] = useState(25);
  const [type, setType] = useState<"call" | "put">("call"), [style, setStyle] = useState<"eu" | "us">("eu"), [mkt, setMkt] = useState(NaN);
  useEffect(() => { setS(f("S", 100)); setK(f("K", f("S", 100))); setT(f("T", 0.5)); setVol(f("vol", 25)); setType(sp.get("type") === "put" ? "put" : "call"); setMkt(f("px", NaN)); }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const o: Q.OptIn = { S, K, T, r: r / 100, q: q / 100, sigma: vol / 100, type };
  const bs = Q.blackScholes(o);
  const bin = useMemo(() => Q.binomial(o, 400, style === "us"), [S, K, T, r, q, vol, type, style]); // eslint-disable-line react-hooks/exhaustive-deps
  const mc = useMemo(() => Q.monteCarlo(o, 100_000), [S, K, T, r, q, vol, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const iv = Number.isFinite(mkt) ? Q.impliedVol(mkt, { S, K, T, r: r / 100, q: q / 100, type }) : null;
  // sensibilité : prix selon cours et volatilité
  const grid = [-20, -10, -5, 0, 5, 10, 20].map((dS) => ({ dS, v: [-10, -5, 0, 5, 10].map((dv) => Q.blackScholes({ ...o, S: S * (1 + dS / 100), sigma: Math.max(0.01, (vol + dv) / 100) }).price) }));
  // stratégie
  const [legs, setLegs] = useState<LegIn[]>([]);
  const [strat, setStrat] = useState("Straddle");
  useEffect(() => { setLegs(STRATS[strat](S).map((l, i) => ({ ...l, id: i, K: l.K ? Math.round(l.K * 100) / 100 : undefined }))); }, [strat]); // eslint-disable-line react-hooks/exhaustive-deps
  const priced = legs.map((l) => (l.kind === "underlying" ? { ...l, premium: 0 } : { ...l, premium: Q.blackScholes({ S, K: l.K!, T, r: r / 100, q: q / 100, sigma: vol / 100, type: l.kind }).price }));
  const greeks = priced.reduce((a, l) => {
    if (l.kind === "underlying") return { ...a, delta: a.delta + l.side * l.qty };
    const g = Q.blackScholes({ S, K: l.K!, T, r: r / 100, q: q / 100, sigma: vol / 100, type: l.kind });
    return { delta: a.delta + l.side * l.qty * g.delta, gamma: a.gamma + l.side * l.qty * g.gamma, vega: a.vega + l.side * l.qty * g.vega, theta: a.theta + l.side * l.qty * g.theta };
  }, { delta: 0, gamma: 0, vega: 0, theta: 0 });
  const cost = priced.reduce((a, l) => a + l.side * l.qty * (l.premium ?? 0), 0);
  const xs = Array.from({ length: 81 }, (_, i) => S * (0.6 + i * 0.01));
  const pay = xs.map((x) => Q.payoff(priced, x, S));
  const today = xs.map((x) => priced.reduce((a, l) => a + l.side * l.qty * (l.kind === "underlying" ? x - S : Q.blackScholes({ S: x, K: l.K!, T: T / 2, r: r / 100, q: q / 100, sigma: vol / 100, type: l.kind }).price - (l.premium ?? 0)), 0));
  const be = xs.filter((x, i) => i > 0 && Math.sign(pay[i]) !== Math.sign(pay[i - 1])).map((x) => num(x, 2));
  const opt = useMemo(() => lineOption([{ name: "À l'échéance", data: xs.map((x, i) => [num(x, 1), pay[i]]) }, { name: "À mi-parcours (modèle)", data: xs.map((x, i) => [num(x, 1), today[i]]), dashed: true }],
    { category: xs.map((x) => num(x, 1)) }), [JSON.stringify(priced), S, T, vol]); // eslint-disable-line react-hooks/exhaustive-deps
  const setLeg = (id: number, p: Partial<LegIn>) => setLegs(legs.map((l) => (l.id === id ? { ...l, ...p } : l)));
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title={`OVME · valorisation d'option${sp.get("s") ? ` · ${sp.get("s")}` : ""}`}>
        <div className="px-2 py-1">
          <div className="flex justify-between py-0.5"><span className="text-dim">Type</span><Seg value={type} options={[["call", "Call"], ["put", "Put"]]} onChange={setType} /></div>
          <div className="flex justify-between py-0.5"><span className="text-dim">Exercice (binomial)</span><Seg value={style} options={[["eu", "Européen"], ["us", "Américain"]]} onChange={setStyle} /></div>
          <Num label="Sous-jacent S" value={S} onChange={setS} step={0.5} /><Num label="Prix d'exercice K" value={K} onChange={setK} step={0.5} />
          <Num label="Maturité" value={T} onChange={setT} step={0.01} suffix="ans" /><Num label="Taux sans risque" value={r} onChange={setR} step={0.05} suffix="%" />
          <Num label="Dividende continu (ou taux étranger)" value={q} onChange={setQ} step={0.05} suffix="%" /><Num label="Volatilité" value={vol} onChange={setVol} step={0.5} suffix="%" />
          <Num label="Prix de marché (pour la vol. implicite)" value={mkt} onChange={setMkt} step={0.01} />
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Prix et grecques">
        <div className="px-2 py-1">
          <Out label="Black-Scholes-Merton" value={num(bs.price, 4)} cls="text-amber" />
          <Out label={`Binomial CRR 400 pas (${style === "us" ? "américain" : "européen"})`} value={num(bin, 4)} />
          {style === "us" && <Out label="Prime d'exercice anticipé" value={num(bin - Q.binomial(o, 400, false), 4)} />}
          <Out label="Monte Carlo 100 000 trajectoires" value={`${num(mc.price, 4)} ± ${num(1.96 * mc.stderr, 4)}`} title="Intervalle de confiance à 95 %, variables antithétiques" />
          <Out label="Volatilité implicite" value={iv == null ? (Number.isFinite(mkt) ? "hors bornes" : "–") : `${num(iv * 100, 2)} %`} cls="text-amber" />
          <Out label="Delta" value={num(bs.delta, 4)} /><Out label="Gamma" value={num(bs.gamma, 5)} /><Out label="Vega (pour 1 point de vol.)" value={num(bs.vega, 4)} />
          <Out label="Theta (par jour)" value={num(bs.theta, 4)} cls={tone(bs.theta)} /><Out label="Rho (pour 1 point de taux)" value={num(bs.rho, 4)} />
          <Out label="Valeur intrinsèque / temps" value={`${num(Math.max(type === "call" ? S - K : K - S, 0), 4)} / ${num(bs.price - Math.max(type === "call" ? S - K : K - S, 0), 4)}`} />
          <Out label="Couverture : actions par option" value={`${num(-bs.delta, 4)} (delta neutre)`} />
        </div>
      </Panel>
      <Panel className="col-span-12 xl:col-span-4" title="Sensibilité du prix (Black-Scholes)">
        <table><thead><tr><th>Cours \ vol.</th>{[-10, -5, 0, 5, 10].map((dv) => <th key={dv} className="num">{num(vol + dv, 0)} %</th>)}</tr></thead>
          <tbody>{grid.map((g) => <tr key={g.dS} className={g.dS === 0 ? "bg-raised" : ""}><td>{pct(g.dS, 0)} ({num(S * (1 + g.dS / 100), 1)})</td>{g.v.map((v, i) => <td key={i} className={`num ${i === 2 && g.dS === 0 ? "text-amber" : ""}`}>{num(v, 2)}</td>)}</tr>)}</tbody></table>
      </Panel>
      <Panel className="col-span-12" title="Stratégies : diagramme de gains et pertes" right={<select value={strat} onChange={(e) => setStrat(e.target.value)}>{Object.keys(STRATS).map((k) => <option key={k}>{k}</option>)}</select>}>
        <div className="grid grid-cols-12">
          <div className="col-span-12 lg:col-span-5">
            <table><thead><tr><th>Jambe</th><th>Sens</th><th className="num">Qté</th><th className="num">Strike</th><th className="num">Prime (modèle)</th><th /></tr></thead>
              <tbody>{priced.map((l) => <tr key={l.id}>
                <td><select value={l.kind} onChange={(e) => setLeg(l.id, { kind: e.target.value as Q.Leg["kind"], K: l.K ?? S })}><option value="call">Call</option><option value="put">Put</option><option value="underlying">Sous-jacent</option></select></td>
                <td><select value={l.side} onChange={(e) => setLeg(l.id, { side: +e.target.value as 1 | -1 })}><option value={1}>Achat</option><option value={-1}>Vente</option></select></td>
                <td className="num"><input type="number" value={l.qty} onChange={(e) => setLeg(l.id, { qty: +e.target.value })} className="w-14 text-right" /></td>
                <td className="num">{l.kind === "underlying" ? "–" : <input type="number" step={0.5} value={l.K} onChange={(e) => setLeg(l.id, { K: +e.target.value })} className="w-20 text-right" />}</td>
                <td className="num">{l.kind === "underlying" ? num(S, 2) : num(l.premium, 3)}</td>
                <td><button onClick={() => setLegs(legs.filter((x) => x.id !== l.id))} className="text-down">×</button></td></tr>)}</tbody></table>
            <button onClick={() => setLegs([...legs, { id: Date.now(), kind: "call", side: 1, qty: 1, K: S }])} className="m-2 border border-line px-2 text-info">+ jambe</button>
            <div className="px-2">
              <Out label={cost >= 0 ? "Coût net (débit)" : "Prime nette reçue (crédit)"} value={num(Math.abs(cost), 3)} />
              <Out label="Gain maximal / perte maximale (sur la plage)" value={`${num(Math.max(...pay), 2)} / ${num(Math.min(...pay), 2)}`} />
              <Out label="Points morts" value={be.join(" · ") || "–"} />
              <Out label="Delta · Gamma · Vega · Theta" value={`${num(greeks.delta, 3)} · ${num(greeks.gamma, 4)} · ${num(greeks.vega, 3)} · ${num(greeks.theta, 3)}`} />
            </div>
          </div>
          <div className="col-span-12 h-80 lg:col-span-7"><EChart option={opt} /></div>
        </div>
        <div className="px-2 pb-1 text-[10px] text-dim">Primes calculées avec les paramètres ci-dessus (même volatilité pour toutes les jambes). Pour utiliser les prix de marché, ouvrir OVME depuis OMON.</div>
      </Panel>
    </div>
  );
}
