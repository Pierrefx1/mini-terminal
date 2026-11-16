"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Panel, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateOnly, num, pct, price, tone } from "@/lib/format";

type Quote = { symbol: string; name?: string; price?: number; change?: number; change_pct?: number; error?: string };
type Row = { date: string } & Record<string, number | null>;
type Bank = { area: string; bank: string; rate: number; previous: number | null; last_change: string };
type Ev = { id: string; title: string; country: string; time: string; impact: string; forecast: string; previous: string };
type NewsItem = { id: string; title: string; link: string; source: string; published: string; theme: string };
type Stock = { symbol: string; name: string; sector: string; price: number | null; d1?: number | null };
type Period = { label: string; available: boolean; twr?: number; benchmark?: number | null; excess?: number | null };
type Summary = { empty: boolean; base: string; as_of: string; benchmark: { symbol: string }; totals: Record<string, number | null>; periods: Period[]; risk: Record<string, any>; warnings: string[];
  positions: { symbol: string; qty: number; day_pct: number | null; weight: number; value: number }[] };
type Rates = { path: { month: string; implied: number }[]; current: { rate: number } | null };

const GROUPS: [string, [string, string][]][] = [
  ["Indices", [["^GSPC", "S&P 500"], ["^NDX", "Nasdaq 100"], ["^STOXX50E", "Euro Stoxx 50"], ["^FCHI", "CAC 40"], ["^GDAXI", "DAX"], ["^N225", "Nikkei 225"], ["^VIX", "VIX"]]],
  ["Devises, matières, crypto", [["EURUSD=X", "EUR/USD"], ["USDJPY=X", "USD/JPY"], ["DX-Y.NYB", "Dollar index"], ["GC=F", "Or"], ["CL=F", "Pétrole WTI"], ["BZ=F", "Brent"], ["BTC-USD", "Bitcoin"]]],
];
const ZONES: Record<string, string> = { USD: "US", EUR: "EUR", GBP: "UK", JPY: "JP", CNY: "CN", CAD: "CA", AUD: "AU", NZD: "NZ", CHF: "CH" };
const dt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" });
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const P = (v: number | null | undefined) => pct(v == null ? null : v * 100);
const sym = (s: string) => `/graphique?s=${encodeURIComponent(s)}`;
const More = ({ href }: { href: string }) => <Link href={href} className="text-info hover:text-amber">ouvrir →</Link>;

function Kpi({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return <div className="border-b border-r border-line px-2 py-1"><div className="text-[10px] uppercase text-dim">{label}</div><div className={`text-base ${cls}`}>{value}</div>{sub && <div className="text-[10px] text-dim">{sub}</div>}</div>;
}

export default function Accueil() {
  const tick = useApi<Quote[]>("/api/market/ticker", 60_000);
  const wl = useApi<Quote[]>("/api/market/watchlist", 60_000);
  const y = useApi<{ nominal: Row[] }>("/api/macro/yields");
  const pol = useApi<{ banks: Bank[] }>("/api/macro/policy");
  const cal = useApi<{ events: Ev[] }>("/api/calendar", 10 * 60_000);
  const news = useApi<{ items: NewsItem[] }>("/api/news?limit=14", 2 * 60_000);
  const scr = useApi<{ rows: Stock[] }>("/api/screener?universe_id=sp500", 5 * 60_000);
  const port = useApi<Summary>("/api/portfolio/summary", 5 * 60_000);
  const ffr = useApi<Rates>("/api/forecasts/rates", 30 * 60_000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const q = useMemo(() => new Map((tick.data ?? []).map((x) => [x.symbol, x])), [tick.data]);
  const rates = useMemo(() => {
    const n = y.data?.nominal ?? []; const last = n.at(-1), prev = n.at(-2);
    if (!last || !prev) return [];
    const bp = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 100));
    const sp = (r: Row, a: string, b: string) => (r[a] != null && r[b] != null ? r[b]! - r[a]! : null);
    return [["Taux US 3 mois", last["3M"], bp(last["3M"], prev["3M"])], ["Taux US 2 ans", last["2A"], bp(last["2A"], prev["2A"])], ["Taux US 10 ans", last["10A"], bp(last["10A"], prev["10A"])],
      ["Taux US 30 ans", last["30A"], bp(last["30A"], prev["30A"])], ["Écart 2-10 ans", sp(last, "2A", "10A"), bp(sp(last, "2A", "10A"), sp(prev, "2A", "10A"))]] as [string, number | null, number | null][];
  }, [y.data]);
  const upcoming = useMemo(() => (cal.data?.events ?? []).filter((e) => new Date(e.time).getTime() > now && (e.impact === "High" || e.impact === "Medium")).slice(0, 12), [cal.data, now]);
  const movers = useMemo(() => {
    const r = (scr.data?.rows ?? []).filter((x) => x.d1 != null).sort((a, b) => b.d1! - a.d1!);
    const up = r.filter((x) => x.d1! > 0).length;
    return { top: r.slice(0, 6), flop: r.slice(-6).reverse(), up, total: r.length };
  }, [scr.data]);
  const fedEnd = ffr.data?.path.at(-1), fedNow = ffr.data?.current?.rate;
  const d = port.data, t = d?.totals;
  const per = (l: string) => d?.periods.find((p) => p.label === l && p.available);

  return (
    <div className="grid h-full grid-cols-12 grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-1 overflow-auto">
      <Panel className="col-span-12" title="Portefeuille" right={<><SourceTag env={port.env} /><More href="/portefeuille" /></>}>
        {port.error ? <State error={port.error} /> : !d ? <State loading /> : d.empty ? (
          <div className="p-2 text-dim">Journal vide. <Link href="/portefeuille" className="text-info underline">Saisir ou importer mes transactions</Link> pour voir ici valeur, performance et alpha.</div>
        ) : (<>
          <div className="grid grid-cols-8">
            <Kpi label={`Valeur au ${dateOnly(d.as_of)}`} value={`${num(t!.value, 2)} ${d.base}`} />
            <Kpi label="Jour" value={P(t!.day_pct)} sub={`${num(t!.day_change, 2)} ${d.base}`} cls={tone(t!.day_pct)} />
            <Kpi label="Performance totale" value={P(t!.total_pct)} sub={`${num(t!.total_pnl, 2)} ${d.base} · latent ${num(t!.unrealized, 0)} · réalisé ${num(t!.realized, 0)}`} cls={tone(t!.total_pnl)} />
            <Kpi label="YTD (TWR)" value={P(per("YTD")?.twr)} sub={`${d.benchmark.symbol} ${P(per("YTD")?.benchmark)}`} cls={tone(per("YTD")?.twr)} />
            <Kpi label="1 an (TWR)" value={P(per("1A")?.twr)} sub={`${d.benchmark.symbol} ${P(per("1A")?.benchmark)}`} cls={tone(per("1A")?.twr)} />
            <Kpi label="Alpha annualisé" value={d.risk.alpha == null ? "–" : P(d.risk.alpha)} sub={`bêta ${num(d.risk.beta, 2)} · depuis l'origine`} cls={tone(d.risk.alpha)} />
            <Kpi label="Volatilité · Sharpe" value={d.risk.volatility == null ? "–" : `${num(d.risk.volatility * 100, 1)} % · ${num(d.risk.sharpe, 2)}`} sub={`drawdown max ${P(d.risk.max_drawdown)}`} />
            <div className="border-b border-line px-2 py-1"><div className="text-[10px] uppercase text-dim">Lignes du jour</div>
              {d.positions.filter((p) => p.qty).slice(0, 3).map((p) => <div key={p.symbol} className="flex justify-between"><Link href={sym(p.symbol)} className="text-amber">{p.symbol}</Link><span className={tone(p.day_pct)}>{P(p.day_pct)}</span></div>)}</div>
          </div>
          {d.warnings.map((w) => <div key={w} className="px-2 py-0.5 text-down">⚠ {w}</div>)}
        </>)}
      </Panel>

      <Panel className="col-span-3" title="Marchés" right={<SourceTag env={tick.env} />}>
        <State loading={tick.loading && !tick.data} error={tick.error} />
        <table><tbody>{GROUPS.map(([g, list]) => [
          <tr key={g}><td colSpan={3} className="bg-raised text-[10px] uppercase text-dim">{g}</td></tr>,
          ...list.map(([s, label]) => { const x = q.get(s); return (
            <tr key={s}><td><Link href={sym(s)} className="hover:text-amber">{label}</Link></td><td className="num">{x?.error ? <span className="text-down">erreur</span> : price(x?.price)}</td><td className={`num ${tone(x?.change_pct)}`}>{pct(x?.change_pct)}</td></tr>); })])}</tbody></table>
      </Panel>

      <Panel className="col-span-3" title="Taux et banques centrales" right={<><SourceTag env={y.env} /><More href="/macro" /></>}>
        <State loading={y.loading && !y.data} error={y.error} />
        <table>
          <thead><tr><th>Taux</th><th className="num">%</th><th className="num">1J (pb)</th></tr></thead>
          <tbody>{rates.map(([l, v, c]) => <tr key={l}><td>{l}</td><td className="num">{num(v, 2)}</td><td className={`num ${tone(c)}`}>{c == null ? "–" : (c > 0 ? "+" : "") + c}</td></tr>)}
            <tr><td colSpan={3} className="bg-raised text-[10px] uppercase text-dim">Taux directeurs</td></tr>
            {pol.data?.banks.slice(0, 4).map((b) => <tr key={b.area}><td>{b.bank}</td><td className="num">{num(b.rate, 3)}</td><td className="num text-dim" title="dernier mouvement">{dateOnly(b.last_change)}</td></tr>)}
            {fedEnd && fedNow != null && <tr><td>Fed anticipée {fedEnd.month}</td><td className="num text-info">{num(fedEnd.implied, 2)}</td><td className={`num ${tone(fedEnd.implied - fedNow)}`}>{(fedEnd.implied > fedNow ? "+" : "") + Math.round((fedEnd.implied - fedNow) * 100)}</td></tr>}
          </tbody>
        </table>
        {pol.error && <State error={pol.error} />}
        <div className="px-2 py-1 text-[10px] text-dim">Fed anticipée : taux implicite des contrats à terme, écart en pb avec le taux actuel.</div>
      </Panel>

      <Panel className="col-span-6" title="Prochaines publications" right={<><span>importance moyenne ou forte · heures de Paris</span><SourceTag env={cal.env} /><More href="/calendrier" /></>}>
        <State loading={cal.loading && !cal.data} error={cal.error} empty={cal.data && upcoming.length === 0 && "Plus de publication importante cette semaine."} />
        <table>
          <thead><tr><th>Quand</th><th>Zone</th><th>Publication</th><th className="num">Consensus</th><th className="num">Précédent</th></tr></thead>
          <tbody>{upcoming.map((e) => (
            <tr key={e.id}><td className="capitalize">{dt.format(new Date(e.time))}</td><td>{ZONES[e.country] ?? e.country}</td>
              <td><span className={`mr-1 inline-block h-2 w-2 ${e.impact === "High" ? "bg-down" : "bg-amber"}`} />{e.title}</td><td className="num text-info">{e.forecast || "–"}</td><td className="num">{e.previous || "–"}</td></tr>))}</tbody>
        </table>
      </Panel>

      <Panel className="col-span-6" title="Dernières news" right={<><SourceTag env={news.env} /><More href="/news" /></>}>
        <State loading={news.loading && !news.data} error={news.error} />
        <table><tbody>{news.data?.items.map((n) => (
          <tr key={n.id}><td className="w-12 text-dim">{hm.format(new Date(n.published))}</td><td className="w-36 truncate text-info">{n.source}</td>
            <td className="max-w-0 truncate"><a href={n.link} target="_blank" rel="noreferrer" className="hover:text-amber" title={n.title}>{n.title}</a></td></tr>))}</tbody></table>
      </Panel>

      <Panel className="col-span-3" title="S&P 500 · séance" right={<><span>{movers.total ? `${movers.up} en hausse / ${movers.total - movers.up} en baisse` : ""}</span><More href="/actions" /></>}>
        <State loading={scr.loading && !scr.data} error={scr.error} />
        <table><tbody>
          <tr><td colSpan={3} className="bg-raised text-[10px] uppercase text-dim">Plus fortes hausses</td></tr>
          {movers.top.map((s) => <tr key={s.symbol}><td><Link href={sym(s.symbol)} className="text-amber">{s.symbol}</Link></td><td className="max-w-0 truncate text-dim">{s.name}</td><td className="num text-up">{pct(s.d1)}</td></tr>)}
          <tr><td colSpan={3} className="bg-raised text-[10px] uppercase text-dim">Plus fortes baisses</td></tr>
          {movers.flop.map((s) => <tr key={s.symbol}><td><Link href={sym(s.symbol)} className="text-amber">{s.symbol}</Link></td><td className="max-w-0 truncate text-dim">{s.name}</td><td className="num text-down">{pct(s.d1)}</td></tr>)}
        </tbody></table>
      </Panel>

      <Panel className="col-span-3" title="Watchlist" right={<More href="/graphique" />}>
        <State loading={wl.loading && !wl.data} error={wl.error} empty={wl.data?.length === 0 && "Vide. Ouvre un symbole (⌘K) puis « + Watchlist »."} />
        <table><tbody>{(wl.data ?? []).map((w) => (
          <tr key={w.symbol}><td><Link href={sym(w.symbol)} className="text-amber" title={w.name}>{w.symbol}</Link></td><td className="num">{w.error ? <span className="text-down">erreur</span> : price(w.price)}</td><td className={`num ${tone(w.change_pct)}`}>{pct(w.change_pct)}</td></tr>))}</tbody></table>
      </Panel>
    </div>
  );
}
