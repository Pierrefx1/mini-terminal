"use client";
import { useMemo, useState } from "react";
import EChart from "@/components/EChart";
import Export from "@/components/Export";
import { Out, Panel, Seg, SourceTag, State, Toggle } from "@/components/ui";
import { big, num, pct, tone } from "@/lib/format";
import { CenterBar, COT_LABEL, type CotMarket, FLAG, IndexBar, pairLabel, useCot } from "./shared";

const TT = { backgroundColor: "#0e1828", borderColor: "#1c2b42", textStyle: { color: "#d4dbe6", fontSize: 11 } };
const AX = { axisLabel: { color: "#7486a0", fontSize: 10 }, axisLine: { lineStyle: { color: "#1c2b42" } }, splitLine: { lineStyle: { color: "#0e1828" } } };
const COLORS = { lev: "#ffa028", am: "#4aa8ff", dealer: "#c77dff", spec: "#9aa0a6" };
type Cat = keyof typeof COT_LABEL;

function signal(m: CotMarket): [string, string] | null {
  const i = m.lev.index;
  if (m.flip) return [m.lev.net > 0 ? "Passage acheteur" : "Passage vendeur", "text-info"];
  if (i != null && i >= 90) return ["Extrême acheteur", "text-amber"];
  if (i != null && i <= 10) return ["Extrême vendeur", "text-amber"];
  if (i != null && (i >= 80 || i <= 20)) return [i >= 80 ? "Proche extrême haut" : "Proche extrême bas", "text-dim"];
  return null;
}
const ccyName = (c: string) => (c === "USD" ? "USD (DXY)" : c);

export default function CotView({ ccy, setCcy }: { ccy: string; setCcy: (c: string) => void }) {
  const { data, env, error, loading } = useCot();
  const [detail, setDetail] = useState(false);
  const m = data?.markets.find((x) => x.ccy === ccy) ?? data?.markets[0];
  const maxUsd = Math.max(1, ...(data?.markets ?? []).filter((x) => x.ccy !== "USD").map((x) => Math.abs(x.lev_usd ?? 0)));
  return (
    <div className="grid grid-cols-12 gap-1">
      {data && <Highlights markets={data.markets} onPick={setCcy} />}
      <Panel className="col-span-12" title="Positionnement CFTC sur les devises · Traders in Financial Futures"
        right={<><Toggle on={detail} onChange={setDetail}>Toutes les catégories</Toggle>
          {data && <Export name="cot-devises" columns={["Devise", "Date", "Fonds levier net", "Δ", "Notionnel $", "Indice 3a", "z", "Gérants net", "Δ", "Indice 3a", "Dealers net", "Non comm. net", "Intérêt ouvert"]}
            rows={data.markets.map((x) => [x.ccy, x.date, x.lev.net, x.lev.chg, x.lev_usd, x.lev.index, x.lev.z, x.am.net, x.am.chg, x.am.index, x.dealer.net, x.spec?.net ?? null, x.oi])} source={env?.source} />}<SourceTag env={env} /></>}>
        <State loading={loading && !data} error={error} />
        {data && <table>
          <thead>
            <tr className="text-[10px]"><th></th><th colSpan={detail ? 5 : 4} className="border-l border-line text-center text-amber">Fonds à levier (hedge funds, CTA)</th>
              <th colSpan={detail ? 3 : 2} className="border-l border-line text-center text-info">Gérants d&apos;actifs</th>
              {detail && <><th colSpan={2} className="border-l border-line text-center">Autres</th><th colSpan={2} className="border-l border-line text-center">Marché</th></>}
              <th className="border-l border-line"></th></tr>
            <tr>
              <th>Devise</th>
              <th className="num border-l border-line">Net (contrats)</th><th className="num">Δ sem.</th><th className="num" title="Position nette convertie en dollars">Notionnel $</th>
              <th title="Position nette dans sa fourchette des 3 dernières années : 0 = plus vendeur, 100 = plus acheteur">Indice 3 ans</th>
              {detail && <th className="num" title="Écart à la moyenne de 3 ans, en écarts-types">z</th>}
              <th className="num border-l border-line">Net</th>{detail && <th className="num">Δ sem.</th>}<th>Indice 3 ans</th>
              {detail && <><th className="num border-l border-line" title="Courtiers et banques, contrepartie habituelle des fonds">Dealers</th><th className="num" title="Non commerciaux, rapport legacy">Non comm.</th>
                <th className="num border-l border-line">Intérêt ouvert</th><th className="num">Δ</th></>}
              <th className="border-l border-line">Signal</th>
            </tr>
          </thead>
          <tbody>{data.markets.map((x) => {
            const sg = signal(x);
            return (
              <tr key={x.ccy} className={`cursor-pointer hover:bg-raised ${x.ccy === m?.ccy ? "bg-raised" : ""}`} onClick={() => setCcy(x.ccy)}>
                <td className={x.ccy === m?.ccy ? "text-amber" : "text-fg"}>{FLAG[x.ccy]} {ccyName(x.ccy)}</td>
                <td className={`num border-l border-line ${tone(x.lev.net)}`}>{num(x.lev.net, 0)}</td><td className={`num ${tone(x.lev.chg)}`}>{num(x.lev.chg, 0)}</td>
                <td className="num"><span className="inline-flex items-center gap-1">{x.ccy !== "USD" && <CenterBar v={x.lev_usd} max={maxUsd} width={50} />}<span className={`w-16 ${tone(x.lev_usd)}`}>{big(x.lev_usd)}</span></span></td>
                <td><IndexBar v={x.lev.index} /></td>
                {detail && <td className={`num ${Math.abs(x.lev.z ?? 0) >= 2 ? "text-amber" : ""}`}>{num(x.lev.z, 1)}</td>}
                <td className={`num border-l border-line ${tone(x.am.net)}`}>{num(x.am.net, 0)}</td>{detail && <td className={`num ${tone(x.am.chg)}`}>{num(x.am.chg, 0)}</td>}<td><IndexBar v={x.am.index} /></td>
                {detail && <><td className={`num border-l border-line ${tone(x.dealer.net)}`}>{num(x.dealer.net, 0)}</td><td className={`num ${tone(x.spec?.net)}`}>{num(x.spec?.net, 0)}</td>
                  <td className="num border-l border-line">{num(x.oi, 0)}</td><td className={`num ${tone(x.oi_chg)}`}>{num(x.oi_chg, 0)}</td></>}
                <td className={`border-l border-line text-[11px] ${sg?.[1] ?? ""}`}>{sg?.[0] ?? ""}</td>
              </tr>);
          })}</tbody>
        </table>}
        {data && <div className="px-2 py-1 text-[10px] text-dim">Positions au mardi {m?.date.slice(8)}/{m?.date.slice(5, 7)}, publiées le vendredi suivant. Acheteur du contrat d&apos;une devise = pari sur sa hausse contre le dollar (DXY : acheteur = dollar). Cliquer sur une ligne pour le détail.</div>}
      </Panel>
      {m && <Detail m={m} />}
      {data && <UsdAggregate rows={data.usd_aggregate} />}
      <Guide />
    </div>
  );
}

function Highlights({ markets, onPick }: { markets: CotMarket[]; onPick: (c: string) => void }) {
  const moves = markets.filter((x) => x.ccy !== "USD" && x.lev_chg_usd != null).sort((a, b) => Math.abs(b.lev_chg_usd!) - Math.abs(a.lev_chg_usd!)).slice(0, 3);
  const ext = markets.filter((x) => x.lev.index != null && (x.lev.index >= 90 || x.lev.index <= 10));
  const flips = markets.filter((x) => x.flip);
  const crowded = [...markets].filter((x) => x.lev.z != null).sort((a, b) => Math.abs(b.lev.z!) - Math.abs(a.lev.z!))[0];
  const Item = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="min-w-0 border border-line bg-panel px-2 py-1"><div className="text-[10px] uppercase tracking-wider text-dim">{title}</div><div className="text-[12px]">{children}</div></div>
  );
  const link = (x: CotMarket, txt: React.ReactNode) => <button key={x.ccy} onClick={() => onPick(x.ccy)} className="mr-2 hover:text-amber">{FLAG[x.ccy]} {txt}</button>;
  return (
    <div className="col-span-12 grid grid-cols-1 gap-1 md:grid-cols-2 xl:grid-cols-4">
      <Item title="Plus gros mouvements de la semaine · fonds à levier">{moves.map((x) => link(x, <>{x.ccy} <span className={tone(x.lev_chg_usd)}>{x.lev_chg_usd! > 0 ? "+" : ""}{big(x.lev_chg_usd)} $</span></>))}</Item>
      <Item title="Positionnement extrême (3 ans)">{ext.length ? ext.map((x) => link(x, <>{ccyName(x.ccy)} <span className="text-amber">{Math.round(x.lev.index!)}</span></>)) : <span className="text-dim">aucun</span>}</Item>
      <Item title="Changement de camp cette semaine">{flips.length ? flips.map((x) => link(x, <>{ccyName(x.ccy)} <span className={tone(x.lev.net)}>{x.lev.net > 0 ? "acheteurs" : "vendeurs"}</span></>)) : <span className="text-dim">aucun</span>}</Item>
      <Item title="Position la plus tendue (z-score)">{crowded ? link(crowded, <>{ccyName(crowded.ccy)} <span className="text-amber">z {num(crowded.lev.z, 1)}</span> <span className="text-dim">{crowded.lev.net > 0 ? "acheteurs" : "vendeurs"}</span></>) : "–"}</Item>
    </div>
  );
}

function Detail({ m }: { m: CotMarket }) {
  const [unit, setUnit] = useState<"ct" | "usd">("ct");
  const [cats, setCats] = useState<Cat[]>(["lev"]);
  const [lower, setLower] = useState<"idx" | "chg">("idx");
  const h = m.history;
  const opt = useMemo(() => ({
    grid: [{ left: 8, right: 60, top: 26, height: "56%", containLabel: true }, { left: 8, right: 60, top: "70%", bottom: 6, containLabel: true }],
    legend: { top: 0, left: 0, textStyle: { color: "#d4dbe6", fontSize: 10 }, itemWidth: 12, itemHeight: 2, icon: "rect" },
    tooltip: { trigger: "axis", ...TT, valueFormatter: (v: number) => (v == null ? "–" : Math.abs(v) >= 1e5 ? big(v) : num(v, Math.abs(v) < 10 ? 4 : 0)) },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    xAxis: [{ type: "category", data: h.map((r) => r.date), ...AX, axisLabel: { show: false } },
      { type: "category", gridIndex: 1, data: h.map((r) => r.date), ...AX, axisLabel: { ...AX.axisLabel, formatter: (d: string) => `${d.slice(5, 7)}/${d.slice(2, 4)}` } }],
    yAxis: [{ type: "value", ...AX, axisLabel: { ...AX.axisLabel, formatter: (v: number) => big(v) } },
      { type: "value", scale: true, inverse: m.inverted, position: "right", ...AX, splitLine: { show: false }, name: m.inverted ? `${pairLabel(m.pair)} (inversé)` : pairLabel(m.pair), nameTextStyle: { color: "#7486a0", fontSize: 10 } },
      lower === "idx" ? { type: "value", gridIndex: 1, min: 0, max: 100, interval: 50, ...AX } : { type: "value", gridIndex: 1, ...AX, axisLabel: { ...AX.axisLabel, formatter: (v: number) => big(v) } }],
    series: [
      ...cats.map((k) => ({ name: COT_LABEL[k], type: "line", showSymbol: false, color: COLORS[k], lineStyle: { width: k === "lev" ? 2 : 1.3 },
        areaStyle: cats.length === 1 ? { color: k === "lev" ? "rgba(255,160,40,.10)" : "rgba(74,168,255,.10)", origin: 0 } : undefined,
        data: h.map((r) => unit === "usd" ? (k === "lev" ? r.lev_usd : k === "am" ? r.am_usd : null) : r[k]) })),
      { name: m.ccy === "USD" ? "DXY" : pairLabel(m.pair), type: "line", yAxisIndex: 1, showSymbol: false, color: "#d4dbe6", lineStyle: { width: 1, type: "dashed" }, data: h.map((r) => r.price) },
      ...(lower === "idx" ? [
        { name: "Indice COT fonds à levier", type: "line", xAxisIndex: 1, yAxisIndex: 2, showSymbol: false, color: "#ffa028", data: h.map((r) => r.lev_idx),
          markArea: { silent: true, itemStyle: { color: "rgba(255,160,40,.08)" }, data: [[{ yAxis: 80 }, { yAxis: 100 }], [{ yAxis: 0 }, { yAxis: 20 }]] } },
        { name: "Indice COT gérants", type: "line", xAxisIndex: 1, yAxisIndex: 2, showSymbol: false, color: "#4aa8ff", lineStyle: { width: 1 }, data: h.map((r) => r.am_idx) },
      ] : [{ name: "Variation hebdo. fonds à levier", type: "bar", xAxisIndex: 1, yAxisIndex: 2, data: h.map((r, i) => i ? { value: r.lev - h[i - 1].lev, itemStyle: { color: r.lev - h[i - 1].lev >= 0 ? "#1fd15f" : "#ff4d4d" } } : null) }]),
    ],
  }), [h, cats, unit, m, lower]);
  const toggle = (k: Cat) => setCats(cats.includes(k) ? (cats.length > 1 ? cats.filter((x) => x !== k) : cats) : [...cats, k]);
  const usdOk = unit === "usd";
  return (
    <>
      <Panel className="col-span-12 xl:col-span-8" title={`${FLAG[m.ccy]} ${m.market}`}
        right={<span className="flex flex-wrap items-center gap-1">
          {(Object.keys(COT_LABEL) as Cat[]).filter((k) => !usdOk || k === "lev" || k === "am").map((k) => <button key={k} onClick={() => toggle(k)}
            className={`border px-1.5 ${cats.includes(k) ? "text-fg" : "border-line text-dim hover:text-fg"}`} style={cats.includes(k) ? { borderColor: COLORS[k] } : undefined}>{COT_LABEL[k]}</button>)}
          <Seg value={unit} options={[["ct", "Contrats"], ["usd", "Notionnel $"]]} onChange={setUnit} />
          <Seg value={lower} options={[["idx", "Indice COT"], ["chg", "Variations"]]} onChange={setLower} /></span>}>
        <div className="h-[440px]"><EChart option={opt} /></div>
      </Panel>
      <Panel className="col-span-12 xl:col-span-4" title="Lecture du rapport">
        <div className="px-2 py-1">
          {(["lev", "am", "dealer"] as const).map((k) => (
            <div key={k} className="mb-1 border-b border-line/60 pb-1">
              <div className="flex justify-between"><span style={{ color: COLORS[k] }}>{COT_LABEL[k]}</span><IndexBar v={m[k].index} width={90} /></div>
              <div className="grid grid-cols-3 text-[11px]">
                <span><span className="text-dim">net </span><span className={tone(m[k].net)}>{num(m[k].net, 0)}</span></span>
                <span><span className="text-dim">Δ </span><span className={tone(m[k].chg)}>{num(m[k].chg, 0)}</span></span>
                <span><span className="text-dim">% OI </span>{pct(m[k].pct_oi, 1)}</span>
              </div>
              <div className="text-[10px] text-dim">Fourchette 3 ans : {num(m[k].min, 0)} à {num(m[k].max, 0)} · z {num(m[k].z, 2)}</div>
            </div>
          ))}
          <Out label="Fonds à levier : part acheteuse" value={pct(m.lev_long_pct, 0).replace("+", "")} title="Positions longues / (longues + courtes)" />
          <Out label="Nombre de fonds à levier long · court" value={`${m.traders_lev[0]} · ${m.traders_lev[1]}`} />
          <Out label="Nombre de gérants d'actifs long · court" value={`${m.traders_am[0]} · ${m.traders_am[1]}`} />
          <Out label="Notionnel net fonds à levier" value={`${big(m.lev_usd)} $`} cls={tone(m.lev_usd)} />
          <Out label="Notionnel net gérants d'actifs" value={`${big(m.am_usd)} $`} cls={tone(m.am_usd)} />
          <Out label="Petits porteurs (non déclarés), net" value={num(m.small.net, 0)} cls={tone(m.small.net)} />
          <Out label="Taille du contrat" value={m.ccy === "USD" ? "1 000 $ × indice" : `${num(m.contract_size, 0)} ${m.ccy}`} />
          <div className="pt-1 text-[10px] text-dim">{m.inverted ? `Le contrat ${m.ccy} est coté en dollars par ${m.ccy} : une position acheteuse ${m.ccy} est un pari sur la baisse de ${pairLabel(m.pair)}. L'axe du cours est inversé pour aligner les deux.` : m.ccy === "USD" ? "Acheteur DXY = acheteur de dollar contre un panier dominé par l'euro." : `Une position acheteuse ${m.ccy} est un pari sur la hausse de ${pairLabel(m.pair)}.`}</div>
        </div>
      </Panel>
    </>
  );
}

function UsdAggregate({ rows }: { rows: { date: string; lev: number; am: number }[] }) {
  const opt = useMemo(() => ({
    grid: { left: 8, right: 12, top: 26, bottom: 6, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color: "#d4dbe6", fontSize: 10 }, itemWidth: 12, itemHeight: 2, icon: "rect" },
    tooltip: { trigger: "axis", ...TT, valueFormatter: (v: number) => `${big(v)} $` },
    xAxis: { type: "category", data: rows.map((r) => r.date), ...AX, axisLabel: { ...AX.axisLabel, formatter: (d: string) => `${d.slice(5, 7)}/${d.slice(2, 4)}` } },
    yAxis: { type: "value", ...AX, axisLabel: { ...AX.axisLabel, formatter: (v: number) => big(v) } },
    series: [
      { name: "Fonds à levier", type: "bar", data: rows.map((r) => r.lev), itemStyle: { color: "#ffa028" }, barMaxWidth: 6 },
      { name: "Gérants d'actifs", type: "line", data: rows.map((r) => r.am), showSymbol: false, lineStyle: { color: "#4aa8ff", width: 1.5 }, itemStyle: { color: "#4aa8ff" } },
    ],
  }), [rows]);
  const last = rows.at(-1), prev = rows.at(-2);
  return (
    <Panel className="col-span-12 xl:col-span-8" title="Position implicite sur le dollar · contre 10 devises">
      <div className="flex gap-4 px-2 py-1 text-[11px]">
        <span><span className="text-dim">Fonds à levier </span><span className={tone(last?.lev)}>{big(last?.lev)} $</span> <span className="text-dim">(Δ {big(last && prev ? last.lev - prev.lev : null)})</span></span>
        <span><span className="text-dim">Gérants d&apos;actifs </span><span className={tone(last?.am)}>{big(last?.am)} $</span> <span className="text-dim">(Δ {big(last && prev ? last.am - prev.am : null)})</span></span>
      </div>
      <div className="h-64"><EChart option={opt} /></div>
      <div className="px-2 py-1 text-[10px] text-dim">Somme, changée de signe, des positions nettes en notionnel dollar sur EUR, JPY, GBP, CHF, CAD, AUD, NZD, MXN, BRL et ZAR : positif = acheteurs nets de dollar. Mesure proche de l&apos;« IMM USD aggregate » suivi par les desks.</div>
    </Panel>
  );
}

function Guide() {
  return (
    <Panel className="col-span-12 xl:col-span-4" title="Comment lire le COT">
      <div className="space-y-1 px-2 py-1 text-[11px] text-dim">
        <p><span className="text-amber">Fonds à levier</span> : hedge funds et CTA, horizon court, suiveurs de tendance. La catégorie la plus regardée pour le sentiment spéculatif.</p>
        <p><span className="text-info">Gérants d&apos;actifs</span> : fonds de pension, assureurs, gérants. Positions plus lentes, souvent liées à la couverture de portefeuilles.</p>
        <p><span className="text-sim">Courtiers</span> : banques teneuses de marché, généralement en contrepartie des clients.</p>
        <p><span className="text-fg">Indice COT</span> : position nette dans sa fourchette des 3 dernières années. Au-delà de 80 ou en deçà de 20 (en ambre), le positionnement est encombré : le risque de débouclage augmente si le cours se retourne. Ce n&apos;est pas un signal d&apos;entrée en soi.</p>
        <p><span className="text-fg">Limites</span> : contrats à terme seuls (le marché de gré à gré, bien plus large, n&apos;est pas couvert), données du mardi publiées le vendredi.</p>
      </div>
    </Panel>
  );
}
