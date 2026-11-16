"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import EChart from "@/components/EChart";
import { Panel, Seg, SourceTag, State, Toggle } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, dateOnly, num, pct, price, tone } from "@/lib/format";

type Coin = { id: string; symbol: string; name: string; current_price: number | null; market_cap: number | null; market_cap_rank: number | null; fully_diluted_valuation: number | null;
  total_volume: number | null; high_24h: number | null; low_24h: number | null; circulating_supply: number | null; max_supply: number | null; ath: number | null; ath_change_percentage: number | null; ath_date: string | null;
  h1: number | null; h24: number | null; d7: number | null; d30: number | null; y1: number | null; spark: number[]; stable: boolean };
type Data = { currency: string; coins: Coin[]; stable_known: boolean; fear_greed: { value: number; label: string; time: number }[] | null;
  global: { market_cap: number; volume: number; change_24h: number; btc: number; eth: number; stable: number; coins: number } | null };
type PerfKey = "h1" | "h24" | "d7" | "d30" | "y1";
const PERIODS: [PerfKey, string, number][] = [["h1", "1H", 2], ["h24", "24H", 6], ["d7", "7J", 15], ["d30", "30J", 30], ["y1", "1A", 80]];
const FNG: Record<string, string> = { "Extreme Fear": "Peur extrême", Fear: "Peur", Neutral: "Neutre", Greed: "Avidité", "Extreme Greed": "Avidité extrême" };
type SortKey = keyof Coin | "vol_cap" | "supply_pct";
const WIDE = "hidden min-[1560px]:table-cell"; // colonnes secondaires, affichées seulement sur grand écran

function color(v: number | null | undefined, lim: number) {
  if (v == null) return "#2a2a2a";
  const x = Math.max(-1, Math.min(1, v / lim)), a = Math.abs(x);
  const mix = (from: number, to: number) => Math.round(from + (to - from) * a);
  return x >= 0 ? `rgb(${mix(38, 18)},${mix(42, 168)},${mix(40, 72)})` : `rgb(${mix(42, 214)},${mix(38, 48)},${mix(40, 48)})`;
}
function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), w = 90, h = 18, up = data.at(-1)! >= data[0];
  return <svg width={w} height={h} className="inline-block"><polyline points={data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ")} fill="none" stroke={up ? "#1fd15f" : "#ff4d4d"} strokeWidth="1" /></svg>;
}
function Kpi({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return <div className="border-r border-line px-3 py-1"><div className="text-[10px] uppercase text-dim">{label}</div><div className={`text-base ${cls}`}>{value}</div>{sub && <div className="text-[10px] text-dim">{sub}</div>}</div>;
}

export default function Crypto({ universe }: { universe: React.ReactNode }) {
  const router = useRouter();
  const [cur, setCur] = useState("usd");
  const [view, setView] = useState<"heatmap" | "screener">(useSearchParams().get("v") === "heatmap" ? "heatmap" : "screener");
  const [per, setPer] = useState<PerfKey>("h24");
  const [noStable, setNoStable] = useState(true);
  const [q, setQ] = useState(""); const [minCap, setMinCap] = useState(""); const [minPerf, setMinPerf] = useState(""); const [top, setTop] = useState("250");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "market_cap", dir: -1 });
  const { data, env, error, loading } = useApi<Data>(`/api/crypto?currency=${cur}`, 3 * 60_000);
  const C = cur.toUpperCase(), lim = PERIODS.find((p) => p[0] === per)![2];
  const coins = useMemo(() => (data?.coins ?? []).filter((c) => !noStable || !c.stable), [data, noStable]);
  const get = (c: Coin, k: SortKey): any => k === "vol_cap" ? (c.total_volume && c.market_cap ? c.total_volume / c.market_cap : null) : k === "supply_pct" ? (c.max_supply && c.circulating_supply ? c.circulating_supply / c.max_supply : null) : c[k];

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase(), mc = minCap === "" ? null : +minCap * 1e9, mp = minPerf === "" ? null : +minPerf;
    return coins.filter((c) => (c.market_cap_rank ?? 9999) <= +top && (!k || c.symbol.includes(k) || c.name.toLowerCase().includes(k)) && (mc == null || (c.market_cap ?? 0) >= mc) && (mp == null || (c[per] != null && c[per]! >= mp)))
      .sort((a, b) => { const x = get(a, sort.k), y = get(b, sort.k); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [coins, q, minCap, minPerf, top, per, sort]);
  const breadth = useMemo(() => { const r = coins.filter((c) => c[per] != null); return { up: r.filter((c) => c[per]! > 0).length, n: r.length }; }, [coins, per]);
  const movers = useMemo(() => { const r = coins.filter((c) => c[per] != null && (c.market_cap_rank ?? 999) <= 100).sort((a, b) => b[per]! - a[per]!); return { top: r.slice(0, 5), flop: r.slice(-5).reverse() }; }, [coins, per]);

  const tree = useMemo(() => ({
    tooltip: { backgroundColor: "#161616", borderColor: "#262626", textStyle: { color: "#d6d6d6", fontSize: 11 },
      formatter: (p: any) => { const c: Coin = p.data.coin; return `<b>${c.symbol.toUpperCase()}</b> ${c.name} · rang ${c.market_cap_rank}<br/>Cours ${price(c.current_price)} ${C}<br/>Capitalisation ${big(c.market_cap)} ${C}<br/>${PERIODS.map(([k, l]) => `${l} ${pct(c[k])}`).join(" · ")}`; } },
    series: [{ type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false }, left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%",
      label: { show: true, color: "#fff", fontSize: 11, formatter: (p: any) => `${p.name}\n${pct(p.data.coin[per], 1)}` }, itemStyle: { borderColor: "#050505", borderWidth: 1, gapWidth: 1 },
      data: filtered.filter((c) => c.market_cap).slice(0, 150).map((c) => ({ name: c.symbol.toUpperCase(), value: Math.sqrt(c.market_cap!), coin: c, itemStyle: { color: color(c[per], lim) } })) }],
  }), [filtered, per, lim, C]);

  const Th = ({ k, children, numeric = true, wide = false }: { k: SortKey; children: React.ReactNode; numeric?: boolean; wide?: boolean }) => (
    <th className={`${numeric ? "num" : ""} ${wide ? WIDE : ""} cursor-pointer hover:text-fg`} onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : numeric ? -1 : 1 }))}>{children}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>);
  const g = data?.global, fg = data?.fear_greed;
  const open = (c: Coin) => router.push(`/graphique?s=${encodeURIComponent(`${c.symbol.toUpperCase()}-${C}`)}`);

  return (
    <Panel className="h-full" title={<Seg value={view} options={[["screener", "Screener"], ["heatmap", "Heatmap"]]} onChange={(v) => setView(v as any)} />} right={<SourceTag env={env} />}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1">
          {universe}
          <Seg value={cur} options={[["usd", "USD"], ["eur", "EUR"]]} onChange={setCur} />
          <span className="text-dim">Performance</span><Seg value={per} options={PERIODS.map(([k, l]) => [k, l] as [PerfKey, string])} onChange={setPer} />
          <Seg value={top} options={[["20", "Top 20"], ["50", "Top 50"], ["100", "Top 100"], ["250", "Top 250"]]} onChange={setTop} />
          <Toggle on={noStable} onChange={setNoStable}>Sans stablecoins</Toggle>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbole ou nom" className="w-36" />
          <input value={minCap} onChange={(e) => setMinCap(e.target.value)} placeholder={`Capi. min (Md ${C})`} type="number" className="w-36" />
          <input value={minPerf} onChange={(e) => setMinPerf(e.target.value)} placeholder="Perf. min %" type="number" className="w-28" />
          <span className="text-dim">{filtered.length} cryptos</span>
        </div>
        {env?.error && <div className="shrink-0 border-b border-down/60 px-2 py-1 text-down">{env.error}</div>}
        <State loading={loading && !data} error={error} />
        {data && (<>
          <div className="flex shrink-0 flex-wrap gap-x-3 border-b border-line px-2 py-0.5 min-[1560px]:hidden">
            <span className="text-[10px] uppercase text-dim">Top 100 ({PERIODS.find((p) => p[0] === per)![1]})</span>
            {movers.top.map((c) => <button key={c.id} onClick={() => open(c)} className="text-up hover:underline">{c.symbol.toUpperCase()} {pct(c[per], 1)}</button>)}
            {movers.flop.map((c) => <button key={c.id} onClick={() => open(c)} className="text-down hover:underline">{c.symbol.toUpperCase()} {pct(c[per], 1)}</button>)}
          </div>
          <div className="flex shrink-0 items-stretch overflow-x-auto whitespace-nowrap border-b border-line">
            {g ? (<>
              <Kpi label="Capitalisation totale" value={`${big(g.market_cap)} ${C}`} sub={`${pct(g.change_24h)} sur 24 h`} cls={tone(g.change_24h)} />
              <Kpi label="Volume 24 h" value={`${big(g.volume)} ${C}`} sub={`${num((g.volume / g.market_cap) * 100, 1)} % de la capitalisation`} />
              <Kpi label="Dominance BTC" value={`${num(g.btc, 1)} %`} sub={`ETH ${num(g.eth, 1)} %`} />
              <Kpi label="Part des stablecoins" value={`${num(g.stable, 1)} %`} sub="USDT, USDC, DAI, USDe, USDS" />
              <Kpi label="Altcoins (hors BTC, ETH, stables)" value={`${num(100 - g.btc - g.eth - g.stable, 1)} %`} sub={`${g.coins.toLocaleString("fr-FR")} cryptos suivies`} />
            </>) : <Kpi label="Marché global" value="indisponible" />}
            {fg?.length ? <Kpi label="Peur et avidité (0-100)" value={`${fg[0].value} · ${FNG[fg[0].label] ?? fg[0].label}`} sub={`hier ${fg[1]?.value ?? "–"} · il y a 7 j ${fg[7]?.value ?? "–"} · il y a 30 j ${fg[30]?.value ?? "–"}`} cls={fg[0].value < 45 ? "text-down" : fg[0].value > 55 ? "text-up" : ""} /> : <Kpi label="Peur et avidité" value="indisponible" />}
            <Kpi label={`Largeur du marché (${PERIODS.find((p) => p[0] === per)![1]})`} value={`${breadth.up} ↑ / ${breadth.n - breadth.up} ↓`} sub={breadth.n ? `${num((breadth.up / breadth.n) * 100, 0)} % en hausse` : undefined} cls={breadth.up * 2 >= breadth.n ? "text-up" : "text-down"} />
            <div className="hidden flex-1 px-3 py-1 min-[1560px]:block"><div className="text-[10px] uppercase text-dim">Top 100 · plus fortes variations ({PERIODS.find((p) => p[0] === per)![1]})</div>
              <div className="flex flex-wrap gap-x-3">{movers.top.map((c) => <button key={c.id} onClick={() => open(c)} className="text-up hover:underline">{c.symbol.toUpperCase()} {pct(c[per], 1)}</button>)}</div>
              <div className="flex flex-wrap gap-x-3">{movers.flop.map((c) => <button key={c.id} onClick={() => open(c)} className="text-down hover:underline">{c.symbol.toUpperCase()} {pct(c[per], 1)}</button>)}</div></div>
          </div>
          {view === "heatmap" ? (<>
            <div className="shrink-0 px-2 py-0.5 text-[10px] text-dim">150 premières cryptos du filtre · surface = racine carrée de la capitalisation (sinon le bitcoin occuperait plus de la moitié de la carte) · couleur saturée à ±{lim} %.</div>
            <div className="min-h-0 flex-1"><EChart option={tree} onClick={(p) => p.data?.coin && open(p.data.coin)} /></div>
          </>) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table>
                <thead><tr><Th k="market_cap_rank">#</Th><Th k="symbol" numeric={false}>Symbole</Th><Th k="name" numeric={false}>Nom</Th><Th k="current_price">Cours ({C})</Th>
                  {PERIODS.map(([k, l]) => <Th key={k} k={k}>{l}</Th>)}<Th k="market_cap">Capitalisation</Th><Th k="fully_diluted_valuation" wide>Capi. diluée</Th><Th k="total_volume">Volume 24 h</Th><Th k="vol_cap" wide>Vol. / capi.</Th>
                  <Th k="supply_pct">Offre émise</Th><Th k="ath_change_percentage">Écart au record</Th><th className={WIDE}>Record</th><th>7 jours</th></tr></thead>
                <tbody>{filtered.map((c) => { const vc = get(c, "vol_cap"), sp = get(c, "supply_pct"); return (
                  <tr key={c.id} className="cursor-pointer" onClick={() => open(c)}>
                    <td className="num text-dim">{c.market_cap_rank ?? "–"}</td><td className="text-amber">{c.symbol.toUpperCase()}{c.stable && <span className="ml-1 text-[10px] text-dim">stable</span>}</td><td className="max-w-36 truncate" title={c.name}>{c.name}</td>
                    <td className="num" title={`24 h : ${price(c.low_24h)} – ${price(c.high_24h)}`}>{price(c.current_price)}</td>
                    {PERIODS.map(([k]) => <td key={k} className={`num ${tone(c[k])}`}>{pct(c[k])}</td>)}
                    <td className="num">{big(c.market_cap)}</td><td className={`num text-dim ${WIDE}`}>{big(c.fully_diluted_valuation)}</td><td className="num">{big(c.total_volume)}</td><td className={`num ${WIDE}`}>{vc == null ? "–" : num(vc * 100, 1) + " %"}</td>
                    <td className="num" title={c.max_supply ? `${big(c.circulating_supply)} sur ${big(c.max_supply)}` : "Pas de plafond d'émission"}>{sp == null ? "∞" : num(sp * 100, 0) + " %"}</td>
                    <td className={`num ${tone(c.ath_change_percentage)}`}>{pct(c.ath_change_percentage, 0)}</td><td className={`text-dim ${WIDE}`}>{c.ath_date ? dateOnly(c.ath_date) : "–"}</td><td><Spark data={c.spark} /></td>
                  </tr>); })}</tbody>
              </table>
              <div className="p-2 text-[10px] leading-snug text-dim">Prix agrégés sur plusieurs plateformes par CoinGecko, rafraîchis toutes les 3 minutes. Capi. diluée : cours × offre maximale. Vol. / capi. : rotation sur 24 h. Offre émise : part de l'offre maximale déjà en circulation (∞ : pas de plafond d'émission). Sur écran étroit, capi. diluée, vol. / capi. et date du record sont masqués.
                Peur et avidité : indice d'alternative.me, calculé sur le bitcoin. Un clic ouvre le graphique Yahoo de la paire (toutes les cryptos n'y sont pas cotées).</div>
            </div>)}
        </>)}
      </div>
    </Panel>
  );
}
