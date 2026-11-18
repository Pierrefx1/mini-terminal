"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Panel, RangeBar, SourceTag, Spark, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, num, pct, price, tone } from "@/lib/format";

type Row = {
  region: string; symbol: string; label: string; note: string; type?: string; currency?: string; time?: number; error?: string;
  last?: number; prev_close?: number | null; d1?: number | null; w1?: number | null; m1?: number | null; ytd?: number | null;
  hi52?: number; lo52?: number; range_pos?: number | null; vol20?: number | null; volume?: number | null; spark?: number[];
};
type Tile = { symbol: string; label: string; price?: number; change_pct?: number; time?: number; error?: string };
type Vol = { symbol: string; label: string; price?: number; change?: number; change_pct?: number; error?: string };
type B = { up: number; down: number; flat: number; total: number; ad_ratio: number | null; median: number | null };
type Breadth = { d1: B; w1: B; m1: B; ytd: B; sectors: ({ sector: string } & B)[] };
type Ev = { id: string; title: string; country: string; time: string; impact: string; forecast: string; previous: string };
type NewsItem = { id: string; title: string; link: string; source: string; published: string };

const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const dm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });
const dt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" });
const ZONES: Record<string, string> = { USD: "US", EUR: "EUR", GBP: "UK", JPY: "JP", CNY: "CN", CAD: "CA", AUD: "AU", NZD: "NZ", CHF: "CH" };

/** Heure du dernier cours (Paris) ; la date s'affiche si ce n'est pas aujourd'hui. */
function lastTime(t?: number) {
  if (!t) return "–";
  const d = new Date(t * 1000);
  return dm.format(d) === dm.format(new Date()) ? hm.format(d) : dm.format(d);
}

/** Couleur d'une tuile : intensité proportionnelle à la variation, saturée à ±2,5 %. */
function heat(p?: number | null) {
  if (p == null) return { background: "var(--color-raised)" };
  const a = 0.15 + Math.min(1, Math.abs(p) / 2.5) * 0.6;
  return { background: p >= 0 ? `rgba(31,209,95,${a})` : `rgba(255,77,77,${a})` };
}

function Indices() {
  const router = useRouter();
  const { data, env, error, loading } = useApi<Row[]>("/api/overview/indices", 120_000);
  const regions = useMemo(() => [...new Set((data ?? []).map((r) => r.region))], [data]);
  return (
    <Panel className="h-full" title="Indices mondiaux" right={<SourceTag env={env} />}>
      <State loading={loading && !data} error={error} />
      {data && (
        <table>
          <thead><tr>
            <th>Indice</th><th className="num">Dernier</th><th className="num">Var.</th><th className="num">1J</th><th className="num" title="5 séances">5S</th>
            <th className="num" title="21 séances">21S</th><th className="num">YTD</th><th className="num">Bas 52s</th><th className="text-center">Fourchette</th><th className="num">Haut 52s</th>
            <th className="num" title="Volatilité réalisée 20 séances, annualisée">Vol 20j</th><th className="num" title="Volume de la dernière séance (ETF et actions ; non publié de façon fiable pour les indices)">Volume</th>
            <th className="num" title="Heure du dernier cours, heure de Paris">Heure</th><th>60 séances</th>
          </tr></thead>
          <tbody>{regions.map((reg) => [
            <tr key={reg}><td colSpan={14} className="bg-raised text-[10px] uppercase text-dim">{reg}</td></tr>,
            ...data.filter((r) => r.region === reg).map((r) => r.error ? (
              <tr key={r.symbol}><td>{r.label}</td><td colSpan={13} className="text-down">{r.error}</td></tr>
            ) : (
              <tr key={r.symbol} className="cursor-pointer" onClick={() => router.push(`/des?s=${encodeURIComponent(r.symbol)}`)} title={r.note || `${r.symbol} · ${r.currency ?? ""}`}>
                <td className="text-amber">{r.label}{r.note && <span className="ml-1 text-dim">*</span>}</td>
                <td className="num text-fg">{price(r.last)}</td>
                <td className={`num ${tone(r.d1)}`}>{r.last != null && r.prev_close ? num(r.last - r.prev_close, 2) : "–"}</td>
                <td className={`num ${tone(r.d1)}`}>{pct(r.d1)}</td><td className={`num ${tone(r.w1)}`}>{pct(r.w1)}</td>
                <td className={`num ${tone(r.m1)}`}>{pct(r.m1)}</td><td className={`num ${tone(r.ytd)}`}>{pct(r.ytd)}</td>
                <td className="num text-dim">{price(r.lo52)}</td><td className="text-center"><RangeBar pos={r.range_pos} /></td><td className="num text-dim">{price(r.hi52)}</td>
                <td className="num">{num(r.vol20, 1)}</td>
                <td className="num text-dim">{r.type === "INDEX" ? "–" : big(r.volume)}</td>
                <td className="num text-dim">{lastTime(r.time)}</td>
                <td><Spark values={r.spark} /></td>
              </tr>
            ))])}</tbody>
        </table>
      )}
      {data?.some((r) => r.note) && <div className="px-2 py-1 text-[10px] text-dim">* {data.find((r) => r.note)!.note}</div>}
      <div className="px-2 pb-1 text-[10px] text-dim">5S et 21S : variation sur 5 et 21 séances. Fourchette : position du dernier cours entre le plus bas et le plus haut sur un an. Clic : fiche DES.</div>
    </Panel>
  );
}

function Volatility() {
  const { data, env, error, loading } = useApi<Vol[]>("/api/overview/volatility", 120_000);
  const v = Object.fromEntries((data ?? []).map((x) => [x.symbol, x.price]));
  const curve = ["^VIX9D", "^VIX", "^VIX3M", "^VIX6M"].map((s) => v[s]);
  const shape = curve.every((x) => x != null)
    ? curve.every((x, i) => i === 0 || x! >= curve[i - 1]!) ? ["Contango", "structure croissante : pas de stress particulier à court terme", "text-up"]
      : v["^VIX"]! > v["^VIX3M"]! ? ["Backwardation", "volatilité court terme au-dessus du 3 mois : stress immédiat", "text-down"]
        : ["Structure mixte", "courbe non monotone", "text-amber"]
    : null;
  return (
    <Panel title="Volatilité implicite S&P 500" right={<SourceTag env={env} />}>
      <State loading={loading && !data} error={error} />
      <table><tbody>{(data ?? []).map((x) => (
        <tr key={x.symbol}><td><Link href={`/des?s=${encodeURIComponent(x.symbol)}`} className="hover:text-amber">{x.label}</Link></td>
          <td className="num text-fg">{x.error ? <span className="text-down" title={x.error}>erreur</span> : num(x.price, 2)}</td>
          <td className={`num ${tone(x.change)}`}>{x.change == null ? "–" : (x.change > 0 ? "+" : "") + num(x.change, 2)}</td>
          <td className={`num ${tone(x.change_pct)}`}>{pct(x.change_pct)}</td></tr>))}</tbody></table>
      {shape && <div className="px-2 py-1"><span className={shape[2]}>{shape[0]}</span> <span className="text-dim">· {shape[1]} · VIX / VIX 3M = {num(v["^VIX"]! / v["^VIX3M"]!, 2)}</span></div>}
    </Panel>
  );
}

function BreadthBar({ b }: { b: B }) {
  const w = (n: number) => `${b.total ? (n / b.total) * 100 : 0}%`;
  return (
    <span className="flex h-2 w-full bg-line">
      <span className="bg-up" style={{ width: w(b.up) }} /><span className="bg-dim" style={{ width: w(b.flat) }} /><span className="bg-down" style={{ width: w(b.down) }} />
    </span>
  );
}

function MarketBreadth() {
  const { data, env, error, loading } = useApi<Breadth>("/api/overview/breadth", 5 * 60_000);
  return (
    <Panel className="h-full" title="Largeur de marché · S&P 500" right={<SourceTag env={env} />}>
      <State loading={loading && !data} error={error} />
      {data && <>
        <table>
          <thead><tr><th>Horizon</th><th className="num">Hausses</th><th className="num">Baisses</th><th className="w-1/3">Répartition</th><th className="num" title="Hausses / baisses">A/D</th><th className="num">Médiane</th></tr></thead>
          <tbody>{([["d1", "1 séance"], ["w1", "5 séances"], ["m1", "21 séances"], ["ytd", "Depuis le 1er janv."]] as const).map(([k, l]) => {
            const b = data[k];
            return <tr key={k}><td>{l}</td><td className="num text-up">{b.up}</td><td className="num text-down">{b.down}</td><td><BreadthBar b={b} /></td>
              <td className="num">{num(b.ad_ratio, 2)}</td><td className={`num ${tone(b.median)}`}>{pct(b.median)}</td></tr>;
          })}</tbody>
        </table>
        <table>
          <thead><tr><th>Secteur (séance)</th><th className="num">Hausses</th><th className="num">Baisses</th><th className="w-1/3">Répartition</th><th className="num">Médiane</th></tr></thead>
          <tbody>{data.sectors.map((s) => <tr key={s.sector}><td className="max-w-0 truncate">{s.sector}</td><td className="num text-up">{s.up}</td><td className="num text-down">{s.down}</td>
            <td><BreadthBar b={s} /></td><td className={`num ${tone(s.median)}`}>{pct(s.median)}</td></tr>)}</tbody>
        </table>
      </>}
    </Panel>
  );
}

function Heatmap() {
  const { data, env, error, loading } = useApi<{ region: string; tiles: Tile[] }[]>("/api/overview/heatmap", 120_000);
  return (
    <Panel className="h-full" title="Carte des places mondiales · séance" right={<SourceTag env={env} />}>
      <State loading={loading && !data} error={error} />
      <div className="space-y-1 p-1">
        {data?.map((g) => (
          <div key={g.region}>
            <div className="mb-0.5 text-[10px] uppercase text-dim">{g.region}</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-0.5">
              {g.tiles.map((t) => (
                <Link key={t.symbol} href={`/des?s=${encodeURIComponent(t.symbol)}`} style={heat(t.error ? null : t.change_pct)}
                  className="flex h-11 flex-col justify-center px-1.5 leading-tight text-white hover:outline hover:outline-1 hover:outline-amber"
                  title={t.error ?? `${t.symbol} · ${price(t.price)} · dernier cours ${lastTime(t.time)}`}>
                  <span className="truncate text-[11px]">{t.label}</span>
                  <span className="text-[12px] font-bold">{t.error ? "erreur" : pct(t.change_pct)}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Calendar() {
  const cal = useApi<{ events: Ev[] }>("/api/calendar", 10 * 60_000);
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const up = (cal.data?.events ?? []).filter((e) => new Date(e.time).getTime() > now && (e.impact === "High" || e.impact === "Medium")).slice(0, 10);
  return (
    <Panel className="min-h-0 flex-1" title="Prochaines publications" right={<><SourceTag env={cal.env} /><Link href="/calendrier" className="text-info hover:text-amber">ECO →</Link></>}>
      <State loading={cal.loading && !cal.data} error={cal.error} empty={cal.data && now > 0 && up.length === 0 && "Plus de publication importante cette semaine."} />
      <table className="table-fixed"><tbody>{up.map((e) => (
        <tr key={e.id}><td className="w-24 capitalize text-dim">{dt.format(new Date(e.time))}</td><td className="w-12">{ZONES[e.country] ?? e.country}</td>
          <td className="truncate" title={e.title}><span className={`mr-1 inline-block h-2 w-2 ${e.impact === "High" ? "bg-down" : "bg-amber"}`} />{e.title}</td>
          <td className="num w-16 text-info" title="Consensus">{e.forecast || "–"}</td></tr>))}</tbody></table>
    </Panel>
  );
}

function News() {
  const news = useApi<{ items: NewsItem[] }>("/api/news?limit=20", 2 * 60_000);
  return (
    <Panel className="h-full" title="Fil d'actualités" right={<><SourceTag env={news.env} /><Link href="/news" className="text-info hover:text-amber">TOP →</Link></>}>
      <State loading={news.loading && !news.data} error={news.error} />
      <table><tbody>{news.data?.items.map((n) => (
        <tr key={n.id} className="align-top"><td className="w-10 text-dim">{hm.format(new Date(n.published))}</td>
          <td className="!whitespace-normal"><a href={n.link} target="_blank" rel="noreferrer" className="hover:text-amber">{n.title}</a> <span className="text-[10px] text-info">{n.source}</span></td></tr>))}</tbody></table>
    </Panel>
  );
}

export default function WEI() {
  return (
    <div className="grid h-full grid-cols-12 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-1 overflow-auto">
      <div className="col-span-12 min-h-0 xl:col-span-8"><Indices /></div>
      <div className="col-span-12 flex min-h-0 flex-col gap-1 xl:col-span-4"><Volatility /><Calendar /></div>
      <div className="col-span-12 min-h-0 lg:col-span-6 xl:col-span-5"><Heatmap /></div>
      <div className="col-span-12 min-h-0 lg:col-span-6 xl:col-span-4"><MarketBreadth /></div>
      <div className="col-span-12 min-h-0 xl:col-span-3"><News /></div>
    </div>
  );
}
