"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import Plot from "@/components/Plot";
import { Num, Out, Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { num, pct, tone } from "@/lib/format";
import * as Q from "@/lib/quant";

type LegIn = Q.Leg & { id: number };
type Market = { symbol: string; rate: number; T: number; spot: number; carry: number; forward: number; extrapolated: boolean; expiries_used: number[]; strikes: number[]; iv: number[] };

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
  "Risk reversal (put vendu, call acheté)": (S) => [{ kind: "put", side: -1, qty: 1, K: S * 0.95 }, { kind: "call", side: 1, qty: 1, K: S * 1.05 }],
  "Ratio call spread 1×2": (S) => [{ kind: "call", side: 1, qty: 1, K: S }, { kind: "call", side: -1, qty: 2, K: S * 1.08 }],
};
/** Pas de cotation des strikes, pour que les jambes tombent sur des prix d'exercice réalistes. */
const tick = (S: number) => (S >= 500 ? 5 : S >= 100 ? 1 : S >= 20 ? 0.5 : 0.1);
const roundK = (k: number, S: number) => Math.round(Math.round(k / tick(S)) * tick(S) * 100) / 100;
const key = (k: number) => k.toFixed(2);
const SPOT_SHOCKS = [-20, -15, -10, -5, -2, 0, 2, 5, 10, 15, 20];
const VOL_SHOCKS = [-10, -5, -2, 0, 2, 5, 10];

export default function OVME() {
  const router = useRouter();
  const sp = useSearchParams();
  const f = (k: string, d: number) => { const v = Number(sp.get(k)); return sp.get(k) && Number.isFinite(v) ? v : d; };
  const sym = (sp.get("s") || "").toUpperCase();
  const [symIn, setSymIn] = useState(sym);
  useEffect(() => setSymIn(sym), [sym]);
  const [S, setS] = useState(100), [K, setK] = useState(100), [T, setT] = useState(0.5), [r, setR] = useState(4), [q, setQ] = useState(0), [vol, setVol] = useState(25);
  const [type, setType] = useState<"call" | "put">("call"), [style, setStyle] = useState<"eu" | "us">("eu"), [mkt, setMkt] = useState(NaN);
  const [mode, setMode] = useState<"manual" | "market">("manual");
  useEffect(() => {
    setS(f("S", 100)); setK(f("K", f("S", 100))); setT(f("T", 0.5)); setVol(f("vol", 25)); setType(sp.get("type") === "put" ? "put" : "call"); setMkt(f("px", NaN));
    setMode(sp.get("mkt") === "1" && sp.get("s") ? "market" : "manual");
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── stratégie (déclarée avant la requête de marché : ses strikes en font partie)
  const [legs, setLegs] = useState<LegIn[]>([]);
  const [strat, setStrat] = useState("Straddle");

  // ── données de marché : spot, portage implicite et vol du smile pour chaque strike utilisé (surface VOL)
  const strikes = useMemo(() => [...new Set([K, ...legs.filter((l) => l.kind !== "underlying" && l.K! > 0).map((l) => l.K!)].filter((k) => k > 0).map(key))], [K, legs]);
  const ivq = useApi<Market>(mode === "market" && sym && T > 0 && strikes.length ? `/api/vol/iv?symbol=${encodeURIComponent(sym)}&T=${T.toFixed(4)}&strikes=${strikes.join(",")}` : null);
  const m = mode === "market" && ivq.data?.symbol === sym ? ivq.data : null;
  const ivMap = useMemo(() => new Map(m ? m.strikes.map((k, i) => [key(k), m.iv[i]]) : []), [m]);
  const Se = m ? m.spot : S;
  const qe = m ? r / 100 - m.carry : q / 100; // r − q = portage implicite de la parité call-put
  const sigOf = (k: number) => (m ? ivMap.get(key(k)) ?? m.iv[0] : vol / 100);
  const sig = sigOf(K);
  const toManual = () => { if (m) { setS(+m.spot.toFixed(2)); setQ(+(qe * 100).toFixed(3)); setVol(+(sig * 100).toFixed(2)); } setMode("manual"); };

  const o: Q.OptIn = { S: Se, K, T, r: r / 100, q: qe, sigma: sig, type };
  const bs = Q.blackScholes(o);
  const bin = useMemo(() => Q.binomial(o, 400, style === "us"), [Se, K, T, r, qe, sig, type, style]); // eslint-disable-line react-hooks/exhaustive-deps
  const binEu = useMemo(() => (style === "us" ? Q.binomial(o, 400, false) : bin), [bin]); // eslint-disable-line react-hooks/exhaustive-deps
  const mc = useMemo(() => Q.monteCarlo(o, 100_000), [Se, K, T, r, qe, sig, type]); // eslint-disable-line react-hooks/exhaustive-deps
  const iv = Number.isFinite(mkt) ? Q.impliedVol(mkt, { S: Se, K, T, r: r / 100, q: qe, type }) : null;
  const grid = [-20, -10, -5, 0, 5, 10, 20].map((dS) => ({ dS, v: [-10, -5, 0, 5, 10].map((dv) => Q.blackScholes({ ...o, S: Se * (1 + dS / 100), sigma: Math.max(0.01, sig + dv / 100) }).price) }));

  // ── stratégie : réinitialisée au changement de modèle, de sous-jacent ou à l'arrivée du spot de marché
  const anchor = m ? Math.round(m.spot / tick(m.spot)) : 0;
  useEffect(() => { setLegs(STRATS[strat](Se).map((l, i) => ({ ...l, id: i, K: l.K ? roundK(l.K, Se) : undefined }))); }, [strat, sym, mode, anchor]); // eslint-disable-line react-hooks/exhaustive-deps
  const priced: (Q.PricedLeg & { id: number })[] = legs.map((l) => {
    if (l.kind === "underlying") return { ...l, premium: 0 };
    const s = sigOf(l.K!);
    return { ...l, sigma: s, premium: Q.blackScholes({ S: Se, K: l.K!, T, r: r / 100, q: qe, sigma: s, type: l.kind }).price };
  });
  const greeks = priced.reduce((a, l) => {
    if (l.kind === "underlying") return { ...a, delta: a.delta + l.side * l.qty };
    const g = Q.blackScholes({ S: Se, K: l.K!, T, r: r / 100, q: qe, sigma: l.sigma!, type: l.kind });
    return { delta: a.delta + l.side * l.qty * g.delta, gamma: a.gamma + l.side * l.qty * g.gamma, vega: a.vega + l.side * l.qty * g.vega, theta: a.theta + l.side * l.qty * g.theta };
  }, { delta: 0, gamma: 0, vega: 0, theta: 0 });
  const cost = priced.reduce((a, l) => a + l.side * l.qty * (l.premium ?? 0), 0);
  const pnl = (x: number, tau: number, dv = 0) => Q.strategyPnl(priced, x, tau, r / 100, qe, Se, sig, dv);
  const xs = Array.from({ length: 81 }, (_, i) => Se * (0.6 + i * 0.01));
  const pay = xs.map((x) => pnl(x, 0));
  const half = xs.map((x) => pnl(x, T / 2));
  const be = xs.filter((_, i) => i > 0 && Math.sign(pay[i]) !== Math.sign(pay[i - 1])).map((x) => num(x, 2));
  const sig1 = Se * sig * Math.sqrt(T); // un écart-type de cours à l'échéance
  const pk = JSON.stringify(priced);
  const opt = useMemo(() => ({
    ...lineOption([{ name: "À l'échéance", data: xs.map((x, i) => [num(x, 1), pay[i]]) }, { name: "À mi-parcours (modèle)", data: xs.map((x, i) => [num(x, 1), half[i]]), dashed: true }],
      { category: xs.map((x) => num(x, 1)) }),
  }), [pk, Se, T]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── carte de P&L instantanée : choc de cours × choc de vol (points), vol de chaque jambe décalée en parallèle
  const [horizon, setHorizon] = useState<"now" | "1w" | "1m">("now");
  const tauH = Math.max(0, T - ({ now: 0, "1w": 7, "1m": 30 }[horizon]) / 365);
  const heat = useMemo(() => {
    const cells = VOL_SHOCKS.flatMap((dv, y) => SPOT_SHOCKS.map((ds, x) => [x, y, pnl(Se * (1 + ds / 100), tauH, dv / 100)]));
    const ext = Math.max(1e-9, ...cells.map((c) => Math.abs(c[2])));
    return {
      tooltip: { formatter: (p: any) => `Cours ${pct(SPOT_SHOCKS[p.value[0]], 0)} (${num(Se * (1 + SPOT_SHOCKS[p.value[0]] / 100), 2)}) · vol ${VOL_SHOCKS[p.value[1]] >= 0 ? "+" : ""}${VOL_SHOCKS[p.value[1]]} pts<br/>P&L ${num(p.value[2], 3)}` },
      grid: { left: 64, right: 10, top: 8, bottom: 40 },
      xAxis: { type: "category", data: SPOT_SHOCKS.map((s) => `${s > 0 ? "+" : ""}${s} %`), axisLabel: { color: "#7486a0" }, name: "choc de cours", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: "#7486a0" } },
      yAxis: { type: "category", data: VOL_SHOCKS.map((v) => `${v > 0 ? "+" : ""}${v} pts`), axisLabel: { color: "#7486a0" }, name: "choc de vol", nameTextStyle: { color: "#7486a0" } },
      visualMap: { min: -ext, max: ext, show: false, inRange: { color: ["#ff4d4d", "#3a1a1a", "#0e1828", "#123a24", "#1fd15f"] } },
      series: [{ type: "heatmap", data: cells, label: { show: true, color: "#d4dbe6", fontSize: 9, formatter: (p: any) => num(p.value[2], Math.abs(p.value[2]) >= 100 ? 0 : 2) } }],
    };
  }, [pk, Se, tauH, r, qe, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── surface 3D : P&L selon le cours et le temps restant jusqu'à l'échéance
  const surf3d = useMemo(() => {
    const sx = Array.from({ length: 49 }, (_, i) => Se * (0.7 + i * 0.0125));
    const days = Math.max(1, Math.round(T * 365));
    const ty = Array.from({ length: 25 }, (_, j) => Math.round(days * (1 - j / 24)));
    const z = ty.map((d) => sx.map((x) => pnl(x, d / 365)));
    return {
      data: [{ type: "surface", x: sx, y: ty, z, colorscale: [[0, "#ff4d4d"], [0.5, "#0e1828"], [1, "#1fd15f"]], cmid: 0, showscale: false,
        contours: { z: { show: true, usecolormap: true, width: 1, project: { z: true } } },
        hovertemplate: "Cours %{x:.2f}<br>%{y} j restants<br>P&L %{z:.3f}<extra></extra>", lighting: { ambient: 0.75, diffuse: 0.5, specular: 0.1, roughness: 0.9 } }],
      layout: {
        margin: { l: 0, r: 0, t: 0, b: 0 }, showlegend: false,
        scene: { xaxis: { title: { text: "Cours" } }, yaxis: { title: { text: "Jours restants" }, autorange: "reversed" }, zaxis: { title: { text: "P&L" } },
          camera: { eye: { x: -1.5, y: -1.35, z: 0.75 } }, aspectmode: "manual", aspectratio: { x: 1.5, y: 1.2, z: 0.75 } },
      },
    };
  }, [pk, Se, T, r, qe, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLeg = (id: number, p: Partial<LegIn>) => setLegs(legs.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const t = symIn.trim().toUpperCase();
    router.push(t ? `/ovme?s=${encodeURIComponent(t)}&K=${K}&T=${T}&type=${type}&mkt=1` : "/ovme");
  };

  return (
    <div className="grid h-full auto-rows-max grid-cols-12 content-start gap-1 overflow-auto">
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title={<span className="normal-case tracking-normal">OVME · <form className="inline" onSubmit={go}>
        <input value={symIn} onChange={(e) => setSymIn(e.target.value)} placeholder="Sous-jacent (SPY…)" className="w-32 uppercase" /></form></span>}
        right={<>{sym && <Seg value={mode} options={[["market", "Marché"], ["manual", "Manuel"]]} onChange={(v) => (v === "manual" ? toManual() : setMode("market"))} />}{m && <SourceTag env={ivq.env} />}</>}>
        <div className="px-2 py-1">
          {mode === "market" && <>
            <State loading={ivq.loading && !m} error={ivq.error} />
            {ivq.error && <div className="py-1 text-[10px] text-dim">Surface indisponible pour {sym} : repasser en mode manuel, ou choisir un sous-jacent avec options cotées aux États-Unis.</div>}
          </>}
          <div className="flex justify-between py-0.5"><span className="text-dim">Type</span><Seg value={type} options={[["call", "Call"], ["put", "Put"]]} onChange={setType} /></div>
          <div className="flex justify-between py-0.5"><span className="text-dim">Exercice (binomial)</span><Seg value={style} options={[["eu", "Européen"], ["us", "Américain"]]} onChange={setStyle} /></div>
          {m ? <Out label="Sous-jacent S (marché)" value={num(m.spot, 2)} cls="text-amber" /> : <Num label="Sous-jacent S" value={S} onChange={setS} step={0.5} />}
          <Num label="Prix d'exercice K" value={K} onChange={setK} step={tick(Se)} />
          <Num label="Maturité" value={T} onChange={setT} step={0.01} suffix="ans" />
          <Num label="Taux sans risque" value={r} onChange={setR} step={0.05} suffix="%" />
          {m ? <Out label="Dividende implicite q = r − portage" value={`${num(qe * 100, 3)} %`} title="Portage ln(F/S)/T tiré du forward implicite (parité call-put) de la surface. Peut s'écarter du vrai rendement du dividende (spot et options différés à des instants différents, exercice américain) ; il garantit en revanche que les prix sont cohérents avec la surface (équivalent Black-76 sur le forward)." />
            : <Num label="Dividende continu (ou taux étranger)" value={q} onChange={setQ} step={0.05} suffix="%" />}
          {m ? <Out label="Volatilité (surface, strike K)" value={`${num(sig * 100, 2)} %`} cls="text-amber" title="Interpolée sur la surface VOL : linéaire en ln(K/F), en variance totale entre échéances" />
            : <Num label="Volatilité" value={vol} onChange={setVol} step={0.5} suffix="%" />}
          <Num label="Prix de marché (pour la vol. implicite)" value={mkt} onChange={setMkt} step={0.01} />
          {m && <div className="pt-1 text-[10px] text-dim">
            Forward {num(m.forward, 2)} · échéances utilisées {m.expiries_used.map((t) => `${Math.round(t * 365)} j`).join(" et ")}{m.extrapolated ? " · hors de la surface : vol extrapolée à plat" : ""}.
            {" "}<Link href={`/vol?s=${encodeURIComponent(sym)}`} className="text-info">Voir la surface (VOL) →</Link>
          </div>}
          {!sym && <div className="pt-1 text-[10px] text-dim">Saisir un sous-jacent pour valoriser au marché (spot, smile de volatilité, dividende implicite), ou cliquer une option dans OMON ou un point du smile dans VOL.</div>}
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Prix et grecques">
        <div className="px-2 py-1">
          <Out label="Black-Scholes-Merton" value={num(bs.price, 4)} cls="text-amber" />
          <Out label={`Binomial CRR 400 pas (${style === "us" ? "américain" : "européen"})`} value={num(bin, 4)} />
          {style === "us" && <Out label="Prime d'exercice anticipé" value={num(bin - binEu, 4)} />}
          <Out label="Monte Carlo 100 000 trajectoires" value={`${num(mc.price, 4)} ± ${num(1.96 * mc.stderr, 4)}`} title="Intervalle de confiance à 95 %, variables antithétiques" />
          <Out label="Volatilité implicite du prix saisi" value={iv == null ? (Number.isFinite(mkt) ? "hors bornes" : "–") : `${num(iv * 100, 2)} %`} cls="text-amber" />
          {iv != null && m && <Out label="Écart vs surface" value={`${iv - sig >= 0 ? "+" : ""}${num((iv - sig) * 100, 2)} pts`} cls={tone(iv - sig)} title="Positif : l'option cote plus cher que la surface lissée" />}
          <Out label="Delta" value={num(bs.delta, 4)} /><Out label="Gamma" value={num(bs.gamma, 5)} /><Out label="Vega (pour 1 point de vol.)" value={num(bs.vega, 4)} />
          <Out label="Theta (par jour)" value={num(bs.theta, 4)} cls={tone(bs.theta)} /><Out label="Rho (pour 1 point de taux)" value={num(bs.rho, 4)} />
          <Out label="Valeur intrinsèque / temps" value={`${num(Math.max(type === "call" ? Se - K : K - Se, 0), 4)} / ${num(bs.price - Math.max(type === "call" ? Se - K : K - Se, 0), 4)}`} />
          <Out label="Couverture : actions par option" value={`${num(-bs.delta, 4)} (delta neutre)`} />
          <Out label="Mouvement attendu à l'échéance (±1σ)" value={`± ${num(sig1, 2)} (${num(sig * Math.sqrt(T) * 100, 1)} %)`} />
        </div>
      </Panel>
      <Panel className="col-span-12 xl:col-span-4" title="Sensibilité du prix (Black-Scholes)">
        <table><thead><tr><th>Cours \ vol.</th>{[-10, -5, 0, 5, 10].map((dv) => <th key={dv} className="num">{num(sig * 100 + dv, 0)} %</th>)}</tr></thead>
          <tbody>{grid.map((g) => <tr key={g.dS} className={g.dS === 0 ? "bg-raised" : ""}><td>{pct(g.dS, 0)} ({num(Se * (1 + g.dS / 100), 1)})</td>{g.v.map((v, i) => <td key={i} className={`num ${i === 2 && g.dS === 0 ? "text-amber" : ""}`}>{num(v, 2)}</td>)}</tr>)}</tbody></table>
      </Panel>
      <Panel className="col-span-12 lg:col-span-6" title="Scénarios : P&L selon le cours et la volatilité"
        right={<Seg value={horizon} options={[["now", "Immédiat"], ["1w", "+1 semaine"], ["1m", "+1 mois"]]} onChange={setHorizon} />}>
        <div className="h-72"><EChart option={heat} /></div>
        <div className="px-2 pb-1 text-[10px] text-dim">
          P&amp;L de la stratégie face à sa prime d&apos;entrée, pour un choc instantané du cours et un décalage parallèle de la vol de toutes les jambes (sticky-strike).
          {horizon !== "now" && ` Temps écoulé déduit de la maturité (reste ${Math.round(tauH * 365)} j).`}
        </div>
      </Panel>
      <Panel className="col-span-12 h-[380px] lg:col-span-6" title="P&L 3D : cours × temps restant" right={<span title="Glisser : rotation · molette : zoom · double-clic : vue initiale">3D interactive</span>}>
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1"><Plot data={surf3d.data} layout={surf3d.layout} /></div>
          <div className="shrink-0 px-2 pb-1 text-[10px] text-dim">Valeur de la stratégie moins sa prime, du jour de l&apos;entrée (arrière) à l&apos;échéance (avant) ; lignes de niveau projetées au sol. Vols et taux constants.</div>
        </div>
      </Panel>
      <Panel className="col-span-12" title="Stratégies : diagramme de gains et pertes" right={<select value={strat} onChange={(e) => setStrat(e.target.value)}>{Object.keys(STRATS).map((k) => <option key={k}>{k}</option>)}</select>}>
        <div className="grid grid-cols-12">
          <div className="col-span-12 lg:col-span-5">
            <table><thead><tr><th>Jambe</th><th>Sens</th><th className="num">Qté</th><th className="num">Strike</th><th className="num">Vol</th><th className="num">Prime (modèle)</th><th /></tr></thead>
              <tbody>{priced.map((l) => <tr key={l.id}>
                <td><select value={l.kind} onChange={(e) => setLeg(l.id, { kind: e.target.value as Q.Leg["kind"], K: l.K ?? roundK(Se, Se) })}><option value="call">Call</option><option value="put">Put</option><option value="underlying">Sous-jacent</option></select></td>
                <td><select value={l.side} onChange={(e) => setLeg(l.id, { side: +e.target.value as 1 | -1 })}><option value={1}>Achat</option><option value={-1}>Vente</option></select></td>
                <td className="num"><input type="number" value={l.qty} onChange={(e) => setLeg(l.id, { qty: +e.target.value })} className="w-14 text-right" /></td>
                <td className="num">{l.kind === "underlying" ? "–" : <input type="number" step={tick(Se)} value={l.K} onChange={(e) => setLeg(l.id, { K: +e.target.value })} className="w-20 text-right" />}</td>
                <td className="num">{l.kind === "underlying" ? "–" : `${num(l.sigma! * 100, 1)} %`}</td>
                <td className="num">{l.kind === "underlying" ? num(Se, 2) : num(l.premium, 3)}</td>
                <td><button onClick={() => setLegs(legs.filter((x) => x.id !== l.id))} className="text-down">×</button></td></tr>)}</tbody></table>
            <button onClick={() => setLegs([...legs, { id: Date.now(), kind: "call", side: 1, qty: 1, K: roundK(Se, Se) }])} className="m-2 border border-line px-2 text-info">+ jambe</button>
            <div className="px-2">
              <Out label={cost >= 0 ? "Coût net (débit)" : "Prime nette reçue (crédit)"} value={num(Math.abs(cost), 3)} />
              <Out label="Gain maximal / perte maximale (sur la plage)" value={`${num(Math.max(...pay), 2)} / ${num(Math.min(...pay), 2)}`} />
              <Out label="Points morts" value={be.join(" · ") || "–"} />
              <Out label="Delta · Gamma · Vega · Theta" value={`${num(greeks.delta, 3)} · ${num(greeks.gamma, 4)} · ${num(greeks.vega, 3)} · ${num(greeks.theta, 3)}`} />
              <Out label="Delta en équivalent sous-jacent" value={`${num(greeks.delta * Se, 2)}`} title="Delta × cours : montant de sous-jacent à vendre (positif) ou acheter (négatif) pour neutraliser le delta" />
            </div>
          </div>
          <div className="col-span-12 h-80 lg:col-span-7"><EChart option={opt} /></div>
        </div>
        <div className="px-2 pb-1 text-[10px] text-dim">
          {m ? "Chaque jambe est valorisée à la vol de marché de son strike (smile de la surface VOL), au spot et au dividende implicite de marché."
            : "Primes calculées avec les paramètres ci-dessus (même volatilité pour toutes les jambes). Mode Marché : chaque jambe prend la vol de son strike."}
        </div>
      </Panel>
    </div>
  );
}
