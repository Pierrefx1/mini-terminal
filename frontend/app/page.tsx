"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Panel, SourceTag, State } from "@/components/ui";
import { send, useApi } from "@/lib/api";
import { dateOnly, num, pct, price, tone } from "@/lib/format";

type Quote = { symbol: string; name?: string; price?: number; change?: number; change_pct?: number; error?: string };
type Row = { date: string } & Record<string, number | null>;
type Bank = { area: string; bank: string; rate: number; previous: number | null; last_change: string };
type Ev = { id: string; title: string; country: string; time: string; impact: string; forecast: string; previous: string };
type NewsItem = { id: string; title: string; link: string; source: string; published: string; theme: string };
type Stock = { symbol: string; name: string; sector: string; price: number | null; d1?: number | null };
type Recap = { headline: string; mood: "risk-on" | "neutre" | "risk-off"; sections: { title: string; points: string[] }[]; watch: string[]; model: string; news_count: number };
type Rates = { path: { month: string; implied: number }[]; current: { rate: number } | null };

const GROUPS: [string, [string, string][]][] = [
  ["Indices", [["^GSPC", "S&P 500"], ["^NDX", "Nasdaq 100"], ["^STOXX50E", "Euro Stoxx 50"], ["^FCHI", "CAC 40"], ["^GDAXI", "DAX"], ["^N225", "Nikkei 225"], ["^VIX", "VIX"]]],
  ["Devises, matières, crypto", [["EURUSD=X", "EUR/USD"], ["USDJPY=X", "USD/JPY"], ["DX-Y.NYB", "Dollar index"], ["GC=F", "Or"], ["CL=F", "Pétrole WTI"], ["BZ=F", "Brent"], ["BTC-USD", "Bitcoin"]]],
];
const ZONES: Record<string, string> = { USD: "US", EUR: "EUR", GBP: "UK", JPY: "JP", CNY: "CN", CAD: "CA", AUD: "AU", NZD: "NZ", CHF: "CH" };
const dt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit" });
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const sym = (s: string) => `/graphique?s=${encodeURIComponent(s)}`;
const More = ({ href }: { href: string }) => <Link href={href} className="text-info hover:text-amber">ouvrir →</Link>;

export default function Accueil() {
  const tick = useApi<Quote[]>("/api/market/ticker", 60_000);
  const recap = useApi<Recap>("/api/recap", 15 * 60_000);
  const [busy, setBusy] = useState(false);
  const y = useApi<{ nominal: Row[] }>("/api/macro/yields");
  const pol = useApi<{ banks: Bank[] }>("/api/macro/policy");
  const cal = useApi<{ events: Ev[] }>("/api/calendar", 10 * 60_000);
  const news = useApi<{ items: NewsItem[] }>("/api/news?limit=14", 2 * 60_000);
  const scr = useApi<{ rows: Stock[] }>("/api/screener?universe_id=sp500", 5 * 60_000);
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
  const regen = async () => {
    setBusy(true);
    try { await recap.reload(await send("POST", "/api/recap/refresh"), { revalidate: false }); } catch { recap.reload(); } finally { setBusy(false); }
  };

  return (
    <div className="grid h-full grid-cols-12 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-1 overflow-auto">
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

      <Panel className="col-span-3" title="Récap du matin · IA" right={<><SourceTag env={recap.env} />
        <button onClick={regen} disabled={busy} className="text-info hover:text-amber disabled:text-dim" title="Rédiger un nouveau récap avec les données actuelles">{busy ? "rédaction…" : "↻"}</button></>}>
        <State loading={(recap.loading && !recap.data) || (busy && !recap.data)} error={recap.data ? null : recap.error} />
        {recap.data && (() => { const r = recap.data; return (
          <div className="space-y-1.5 px-2 py-1.5 leading-snug">
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 px-1 text-[10px] uppercase text-black ${r.mood === "risk-on" ? "bg-up" : r.mood === "risk-off" ? "bg-down" : "bg-amber"}`}>{r.mood}</span>
              <span className="text-fg">{r.headline}</span>
            </div>
            {r.sections.map((sec) => (
              <div key={sec.title}>
                <div className="text-[10px] uppercase text-amber">{sec.title}</div>
                <ul className="list-none">{sec.points.map((p, i) => <li key={i} className="pl-2 -indent-2 text-dim"><span className="text-line">· </span><span className="text-fg/90">{p}</span></li>)}</ul>
              </div>))}
            {r.watch.length > 0 && <div>
              <div className="text-[10px] uppercase text-amber">À surveiller aujourd&apos;hui</div>
              <ul>{r.watch.map((w, i) => <li key={i} className="pl-2 -indent-2"><span className="text-info">▸ </span>{w}</li>)}</ul>
            </div>}
            {recap.env?.stale && recap.env.error && <div className="text-[10px] text-down">Dernier essai en échec : {recap.env.error}</div>}
            <div className="text-[10px] text-dim">Rédigé par IA à partir des cours, taux, calendrier et de {r.news_count} news des dernières 24 h. Peut contenir des erreurs ; pas un conseil.</div>
          </div>); })()}
      </Panel>
    </div>
  );
}
