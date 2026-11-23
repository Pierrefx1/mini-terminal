"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import EChart from "@/components/EChart";
import Export from "@/components/Export";
import { Num, Out, Panel, SourceTag, State } from "@/components/ui";
import { usePostApi } from "@/lib/api";
import { big, num, pct, tone } from "@/lib/format";
import { analysisBody, type Analysis, usePortfolios } from "@/lib/portfolios";

/** Chocs prédéfinis du scénario personnalisé, en % par facteur (proxys : SPY, TLT, UUP, GLD, USO). */
const PRESETS: Record<string, Record<string, number>> = {
  "Aucun": {},
  "Correction actions": { SPY: -10 },
  "Krach (type mars 2020)": { SPY: -34, TLT: 10, UUP: 4, GLD: -3, USO: -60 },
  "Choc de taux (type 2022)": { SPY: -20, TLT: -30, UUP: 15, GLD: -5, USO: 30 },
  "Désinflation douce": { SPY: 8, TLT: 8, UUP: -3, GLD: 4, USO: -10 },
  "Choc pétrolier": { SPY: -8, TLT: -4, UUP: 2, GLD: 6, USO: 40 },
};
const TLT_DURATION = 16; // duration modifiée approximative de TLT : +100 pb ≈ −16 %
const EQ_SHOCKS = [-30, -20, -10, -5, 0, 5, 10];
const RATE_SHOCKS_BP = [-150, -100, -50, 0, 50, 100, 150];

function CustomScenario({ factors, cap, base }: { factors: Analysis["factors"]; cap: number; base: string }) {
  const [shock, setShock] = useState<Record<string, number>>({});
  const [preset, setPreset] = useState("Aucun");
  const beta = (k: string) => factors.find((f) => f.symbol === k)?.beta ?? 0;
  const contrib = factors.map((f) => ({ ...f, shock: shock[f.symbol] ?? 0, pnl: (f.beta ?? 0) * (shock[f.symbol] ?? 0) }));
  const total = contrib.reduce((s, c) => s + c.pnl, 0);
  // carte : choc actions × choc de taux (via TLT), les autres facteurs restant au scénario saisi
  const others = contrib.filter((c) => c.symbol !== "SPY" && c.symbol !== "TLT").reduce((s, c) => s + c.pnl, 0);
  const cells = RATE_SHOCKS_BP.flatMap((bp, y) => EQ_SHOCKS.map((eq, x) => [x, y, beta("SPY") * eq + beta("TLT") * (-bp / 100 * TLT_DURATION) + others]));
  const ext = Math.max(0.01, ...cells.map((c) => Math.abs(c[2])));
  const heat = {
    tooltip: { formatter: (p: any) => `Actions ${EQ_SHOCKS[p.value[0]]} % · taux ${RATE_SHOCKS_BP[p.value[1]] > 0 ? "+" : ""}${RATE_SHOCKS_BP[p.value[1]]} pb<br/>Portefeuille ${pct(p.value[2])} · ${big(p.value[2] / 100 * cap)} ${base}` },
    grid: { left: 64, right: 10, top: 8, bottom: 40 },
    xAxis: { type: "category", data: EQ_SHOCKS.map((e) => `${e > 0 ? "+" : ""}${e} %`), axisLabel: { color: "#7486a0" }, name: "actions (SPY)", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: "#7486a0" } },
    yAxis: { type: "category", data: RATE_SHOCKS_BP.map((b) => `${b > 0 ? "+" : ""}${b} pb`), axisLabel: { color: "#7486a0" }, name: "taux longs", nameTextStyle: { color: "#7486a0" } },
    visualMap: { min: -ext, max: ext, show: false, inRange: { color: ["#ff4d4d", "#3a1a1a", "#0e1828", "#123a24", "#1fd15f"] } },
    series: [{ type: "heatmap", data: cells, label: { show: true, color: "#d4dbe6", fontSize: 9, formatter: (p: any) => num(p.value[2], 1) } }],
  };
  return (
    <div className="grid grid-cols-12">
      <div className="col-span-12 px-2 py-1 md:col-span-5">
        <div className="flex items-center justify-between py-0.5"><span className="text-dim">Scénario type</span>
          <select value={preset} onChange={(e) => { setPreset(e.target.value); setShock(PRESETS[e.target.value]); }}>{Object.keys(PRESETS).map((k) => <option key={k}>{k}</option>)}</select></div>
        {factors.map((f) => <Num key={f.symbol} label={`${f.name} (${f.symbol})`} value={shock[f.symbol] ?? 0} step={1} suffix="%" onChange={(v) => { setPreset("Aucun"); setShock({ ...shock, [f.symbol]: Number.isFinite(v) ? v : 0 }); }} />)}
        <div className="py-0.5 text-[10px] text-dim">Taux : +100 pb sur le long terme ≈ TLT −{TLT_DURATION} % (duration).</div>
        <table className="mt-1"><thead><tr><th>Facteur</th><th className="num">Bêta</th><th className="num">Choc</th><th className="num">Contribution</th></tr></thead>
          <tbody>{contrib.map((c) => <tr key={c.symbol}><td>{c.symbol}</td><td className="num">{num(c.beta, 2)}</td><td className="num">{pct(c.shock, 0)}</td><td className={`num ${tone(c.pnl)}`}>{pct(c.pnl)}</td></tr>)}
            <tr className="border-t border-amber"><td className="text-amber">Total</td><td /><td /><td className={`num ${tone(total)}`}>{pct(total)}</td></tr></tbody></table>
        <Out label={`Impact estimé en ${base}`} value={big(total / 100 * cap)} cls={tone(total)} />
      </div>
      <div className="col-span-12 md:col-span-7">
        <div className="h-72"><EChart option={heat} /></div>
        <div className="px-2 text-[10px] text-dim">Impact en % selon le choc actions et le choc de taux longs ; les autres facteurs restent au niveau saisi.</div>
      </div>
    </div>
  );
}

export default function Risk() {
  const { list, current, setCurrentId } = usePortfolios();
  const a = usePostApi<Analysis>(current ? "/api/portfolio/analyze" : null, current ? analysisBody(current) : null);
  const d = a.data;
  const cap = d ? d.capital * (1 + (d.performance.total_pct ?? 0) / 100) : 0;
  const v = d?.var ?? {};
  const rows: [string, string, string][] = [["1 jour, 95 %", "hist_95_1", "param_95_1"], ["1 jour, 99 %", "hist_99_1", "param_99_1"], ["10 jours, 95 %", "hist_95_10", "param_95_10"], ["10 jours, 99 %", "hist_99_10", "param_99_10"]];
  const hist = useMemo(() => d && {
    grid: { left: 8, right: 8, top: 10, bottom: 6, containLabel: true }, tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: d.mc_edges.slice(0, -1).map((e, i) => num((e + d.mc_edges[i + 1]) / 2, 1)), axisLabel: { color: "#7486a0" }, name: "rendement à 10 jours (%)", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: "#7486a0" } },
    yAxis: { type: "value", axisLabel: { color: "#7486a0" }, splitLine: { lineStyle: { color: "#0e1828" } } },
    series: [{ type: "bar", data: d.mc_hist.map((h, i) => ({ value: h, itemStyle: { color: d.mc_edges[i + 1] <= -v.mc_99_10 * 100 ? "#ff4d4d" : d.mc_edges[i + 1] <= -v.mc_95_10 * 100 ? "#ffa028" : "#4aa8ff" } })), barCategoryGap: "5%" }],
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const corr = useMemo(() => d && {
    tooltip: { formatter: (p: any) => `${d.correlation.symbols[p.value[0]]} / ${d.correlation.symbols[p.value[1]]} : ${num(p.value[2], 2)}` },
    grid: { left: 70, right: 10, top: 10, bottom: 60 },
    xAxis: { type: "category", data: d.correlation.symbols, axisLabel: { color: "#7486a0", rotate: 45 } }, yAxis: { type: "category", data: d.correlation.symbols, axisLabel: { color: "#7486a0" } },
    visualMap: { min: -1, max: 1, show: false, inRange: { color: ["#ff4d4d", "#0e1828", "#1fd15f"] } },
    series: [{ type: "heatmap", data: d.correlation.matrix.flatMap((r, i) => r.map((x, j) => [j, i, x])), label: { show: d.correlation.symbols.length <= 10, color: "#fff", fontSize: 9, formatter: (p: any) => num(p.value[2], 2) } }],
  }, [d]);
  const hhi = d ? d.lines.reduce((s, l) => s + l.current ** 2, 0) : 0;
  return (
    <div className="grid h-full auto-rows-max grid-cols-12 content-start gap-1 overflow-auto">
      <Panel className="col-span-12" title="RISK · gestion des risques" right={<><select value={current?.id} onChange={(e) => setCurrentId(e.target.value)}>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Link href="/port" className="text-info">PORT →</Link><SourceTag env={a.env} /></>}>
        <State loading={a.loading && !d} error={a.error} />
        {d && <div className="grid grid-cols-2 gap-x-6 px-2 py-1 md:grid-cols-4">
          <Out label="Valeur estimée" value={`${big(cap)} ${d.base}`} /><Out label="Volatilité annualisée" value={pct((d.performance.ann_vol ?? 0) * 100).replace("+", "")} />
          <Out label="Perte maximale historique" value={pct((d.performance.max_drawdown ?? 0) * 100)} cls="text-down" /><Out label="Sharpe · Sortino" value={`${num(d.performance.sharpe, 2)} · ${num(d.performance.sortino, 2)}`} />
          <Out label="Bêta à la référence" value={num(d.performance.beta, 2)} /><Out label="Concentration (Herfindahl)" value={`${num(hhi, 3)} · ${num(1 / hhi, 1)} lignes équivalentes`} />
          <Out label="Première ligne" value={`${d.lines.slice().sort((x, y) => y.current - x.current)[0]?.symbol} ${num(Math.max(...d.lines.map((l) => l.current)) * 100, 1)} %`} />
          <Out label="Trois premières lignes" value={`${num(d.lines.map((l) => l.current).sort((x, y) => y - x).slice(0, 3).reduce((s, x) => s + x, 0) * 100, 1)} %`} />
        </div>}
      </Panel>
      {d && <>
        <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Value at Risk et Expected Shortfall" right={<Export name="var" columns={["Mesure", "Valeur (%)"]} rows={Object.entries(v).map(([k, x]) => [k, x * 100])} source={a.env?.source} />}>
          <table><thead><tr><th>Horizon, confiance</th><th className="num">Historique</th><th className="num">Paramétrique</th><th className="num">en {d.base}</th></tr></thead>
            <tbody>{rows.map(([l, h, p]) => <tr key={l}><td>{l}</td><td className="num text-down">{num(v[h] * 100, 2)} %</td><td className="num">{num(v[p] * 100, 2)} %</td><td className="num">{big(v[h] * cap)}</td></tr>)}
              <tr className="border-t border-line"><td>Monte Carlo 10 j, 95 %</td><td className="num text-down" colSpan={2}>{num(v.mc_95_10 * 100, 2)} %</td><td className="num">{big(v.mc_95_10 * cap)}</td></tr>
              <tr><td>Monte Carlo 10 j, 99 %</td><td className="num text-down" colSpan={2}>{num(v.mc_99_10 * 100, 2)} %</td><td className="num">{big(v.mc_99_10 * cap)}</td></tr>
              <tr className="border-t border-line"><td>ES 1 jour, 99 %</td><td className="num text-down">{num(v.es_hist_99_1 * 100, 2)} %</td><td className="num">{num(v.es_param_99_1 * 100, 2)} %</td><td className="num">{big(v.es_hist_99_1 * cap)}</td></tr>
              <tr><td>ES 1 j, 95 %</td><td className="num text-down">{num(v.es_hist_95_1 * 100, 2)} %</td><td className="num">{num(v.es_param_95_1 * 100, 2)} %</td><td className="num">{big(v.es_hist_95_1 * cap)}</td></tr></tbody></table>
          <div className="px-2 py-1 text-[10px] text-dim">Pertes exprimées en positif, sur les rendements des deux dernières années. 10 jours : règle de la racine du temps (historique et paramétrique), simulation directe (Monte Carlo, loi normale multivariée, 10 000 trajectoires). ES : perte moyenne au-delà de la VaR.</div>
        </Panel>
        <Panel className="col-span-12 md:col-span-6 xl:col-span-4" title="Simulation Monte Carlo · distribution à 10 jours">
          <div className="h-64">{hist && <EChart option={hist} />}</div>
          <div className="px-2 text-[10px] text-dim">Orange : au-delà de la VaR 95 % ; rouge : au-delà de la VaR 99 %.</div>
        </Panel>
        <Panel className="col-span-12 xl:col-span-4" title="Corrélations des lignes (un an)">
          <div className="h-full min-h-72">{corr && <EChart option={corr} />}</div>
        </Panel>
        <Panel className="col-span-12 lg:col-span-5" title="Stress tests" right={<Export name="stress-tests" columns={["Scénario", "Impact %"]} rows={[...d.historical_scenarios.map((s) => [s.name, s.pnl_pct]), ...d.factor_scenarios.map((s) => [s.name, s.pnl_pct])]} source={a.env?.source} />}>
          <table><thead><tr><th>Scénario historique</th><th className="num">Portefeuille</th><th className="num">Référence</th><th className="num">en {d.base}</th></tr></thead>
            <tbody>{d.historical_scenarios.map((s) => <tr key={s.name}><td className="whitespace-normal">{s.name}<div className="text-[10px] text-dim">{s.start} → {s.end}</div></td>
              {s.pnl_pct == null ? <td colSpan={3} className="text-dim">{s.note}</td> : <><td className={`num ${tone(s.pnl_pct)}`}>{pct(s.pnl_pct)}</td><td className={`num ${tone(s.bench_pct)}`}>{pct(s.bench_pct)}</td><td className={`num ${tone(s.pnl_pct)}`}>{big(s.pnl_pct / 100 * cap)}</td></>}</tr>)}</tbody></table>
          <table><thead><tr><th>Scénario hypothétique (factoriel)</th><th className="num">Impact</th><th className="num">en {d.base}</th></tr></thead>
            <tbody>{d.factor_scenarios.map((s) => <tr key={s.name}><td className="whitespace-normal">{s.name}</td><td className={`num ${tone(s.pnl_pct)}`}>{pct(s.pnl_pct)}</td><td className={`num ${tone(s.pnl_pct)}`}>{s.pnl_pct == null ? "–" : big(s.pnl_pct / 100 * cap)}</td></tr>)}</tbody></table>
          <div className="px-2 py-1 text-[10px] text-dim">Historiques : portefeuille actuel rejoué sur la période (poids cibles). Hypothétiques : bêtas factoriels × choc ; approximation linéaire.</div>
        </Panel>
        <div className="col-span-12 flex flex-col gap-1 lg:col-span-7">
          <Panel className="flex-auto" title="Attribution du risque (un an)">
            <table><thead><tr><th>Ligne</th><th className="num">Poids</th><th className="num">Volatilité</th><th className="num">Part du risque</th><th className="num">Risque / poids</th></tr></thead>
              <tbody>{d.lines.slice().sort((x, y) => y.risk_contribution_pct - x.risk_contribution_pct).map((l) => <tr key={l.symbol}><td className="text-amber">{l.symbol}</td><td className="num">{num(l.current * 100, 1)} %</td><td className="num">{num(l.vol_pct, 1)} %</td>
                <td className="num">{num(l.risk_contribution_pct, 1)} %</td><td className={`num ${l.risk_contribution_pct / (l.current * 100) > 1.5 ? "text-amber" : ""}`}>{num(l.risk_contribution_pct / (l.current * 100), 2)}x</td></tr>)}</tbody></table>
            <div className="px-2 py-1 text-[10px] text-dim">Part du risque : contribution de la ligne à la variance du portefeuille. Risque / poids au-dessus de 1,5x (en orange) : ligne qui pèse plus dans le risque que dans l&apos;allocation.</div>
          </Panel>
          <Panel className="flex-auto" title="Sensibilités factorielles (taux, devises, matières)">
            <table><thead><tr><th>Facteur (proxy)</th><th className="num">Bêta</th><th>Lecture</th></tr></thead>
              <tbody>{d.factors.map((f) => <tr key={f.symbol}><td>{f.name} <span className="text-dim">{f.symbol}</span></td><td className={`num ${tone(f.beta)}`}>{num(f.beta, 2)}</td>
                <td className="text-dim">{f.beta == null ? "–" : `${f.beta > 0 ? "gagne" : "perd"} ${num(Math.abs(f.beta), 2)} % pour +1 % du facteur`}</td></tr>)}</tbody></table>
            <div className="px-2 py-1 text-[10px] text-dim">Régression multiple des rendements quotidiens du portefeuille (en {d.base}) sur les cinq facteurs, deux dernières années. Sensibilité aux taux : via les obligations longues (TLT) ; aux devises : via l&apos;indice dollar (UUP).</div>
          </Panel>
        </div>
        <Panel className="col-span-12" title="Scénario personnalisé : chocs de facteurs">
          <CustomScenario factors={d.factors} cap={cap} base={d.base} />
          <div className="px-2 pb-1 text-[10px] text-dim">Approximation linéaire : impact = Σ bêta × choc, avec les bêtas de la régression multiple sur deux ans. Ne capture ni la convexité (options), ni les changements de corrélation en crise : à compléter par les scénarios historiques.</div>
        </Panel>

      </>}
    </div>
  );
}
