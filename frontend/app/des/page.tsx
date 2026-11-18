"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Panel, RangeBar, SourceTag, Spark, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { resolveSecurity } from "@/lib/commands";
import { big, dateOnly, num, pct, price, tone } from "@/lib/format";

type Des = {
  symbol: string; name: string; currency?: string; exchange?: string; type?: string; tz?: string; time?: number;
  day_high?: number; day_low?: number; last?: number; prev_close?: number | null; d1?: number | null; w1?: number | null; m1?: number | null; ytd?: number | null;
  hi52?: number; lo52?: number; from_hi52?: number | null; range_pos?: number | null; vol20?: number | null; volume?: number | null; avg_volume20?: number | null;
  closes: { time: number; close: number }[];
};
type NewsItem = { id: string; title: string; link: string; source: string; published: string };

const TYPES: Record<string, string> = { EQUITY: "Action", ETF: "ETF", INDEX: "Indice", CURRENCY: "Devise", FUTURE: "Contrat à terme", CRYPTOCURRENCY: "Crypto-actif", MUTUALFUND: "Fonds" };

function Line({ k, v, cls = "" }: { k: string; v: React.ReactNode; cls?: string }) {
  return <tr><td className="text-dim">{k}</td><td className={`num ${cls}`}>{v}</td></tr>;
}

export default function DES() {
  const s = useSearchParams().get("s");
  const sec = useMemo(() => (s ? resolveSecurity(s) : null), [s]);
  const d = useApi<Des>(s ? `/api/overview/describe?symbol=${encodeURIComponent(s)}` : null, 120_000);
  const news = useApi<{ items: NewsItem[] }>(s ? `/api/news?symbol=${encodeURIComponent(s)}&limit=15` : null, 5 * 60_000);
  if (!s) return <Panel className="h-full" title="DES · description d'instrument"><div className="p-2 text-dim">Tape un instrument suivi de DES dans la barre de commandes, par exemple <span className="text-amber">AAPL US Equity DES</span>, <span className="text-amber">EURUSD Curncy DES</span> ou <span className="text-amber">BRENT DES</span>.</div></Panel>;
  const x = d.data;
  const local = x?.time && x.tz ? new Intl.DateTimeFormat("fr-FR", { timeZone: x.tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(x.time * 1000)) : null;
  const yearly = x?.closes.map((c) => c.close);
  return (
    <div className="grid h-full grid-cols-12 grid-rows-[auto_minmax(0,1fr)] gap-1 overflow-auto">
      <Panel className="col-span-12" title={<span className="normal-case tracking-normal">DES · <span className="font-bold">{x?.symbol ?? s}</span> <span className="text-fg">{x?.name ?? sec?.name}</span></span>}
        right={<><SourceTag env={d.env} />
          <Link href={`/graphique?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info hover:border-amber">GP</Link>
          <Link href={`/news?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info hover:border-amber">NEWS</Link></>}>
        <State loading={d.loading && !x} error={d.error} />
        {x && (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-2 py-1.5">
            <span className="text-2xl text-fg">{price(x.last)} <span className="text-sm text-dim">{x.currency}</span></span>
            <span className={`text-lg ${tone(x.d1)}`}>{x.last != null && x.prev_close ? (x.last - x.prev_close > 0 ? "+" : "") + num(x.last - x.prev_close, 2) : ""} ({pct(x.d1)})</span>
            <span className="text-dim">{TYPES[x.type ?? ""] ?? x.type} · {x.exchange} · {sec?.display ?? x.symbol}</span>
            {local && <span className="text-dim">dernier cours {local} heure locale ({x.tz})</span>}
            {sec?.note && <span className="text-amber">Note : {sec.note}</span>}
          </div>
        )}
      </Panel>

      <Panel className="col-span-12 md:col-span-4 xl:col-span-3" title="Cotation et performance">
        {x && <table><tbody>
          <Line k="Clôture précédente" v={price(x.prev_close)} />
          <Line k="Plus bas / haut du jour" v={`${price(x.day_low)} – ${price(x.day_high)}`} />
          <Line k="Variation 1 séance" v={pct(x.d1)} cls={tone(x.d1)} />
          <Line k="Variation 5 séances" v={pct(x.w1)} cls={tone(x.w1)} />
          <Line k="Variation 21 séances" v={pct(x.m1)} cls={tone(x.m1)} />
          <Line k="Depuis le 1er janvier" v={pct(x.ytd)} cls={tone(x.ytd)} />
          <Line k="Plus bas 52 semaines" v={price(x.lo52)} />
          <Line k="Plus haut 52 semaines" v={price(x.hi52)} />
          <Line k="Position dans la fourchette" v={<RangeBar pos={x.range_pos} />} />
          <Line k="Écart au plus haut" v={pct(x.from_hi52)} cls={tone(x.from_hi52)} />
          <Line k="Volatilité réalisée 20 j (ann.)" v={x.vol20 == null ? "–" : `${num(x.vol20, 1)} %`} />
          {x.type !== "INDEX" && <><Line k="Volume dernière séance" v={big(x.volume)} /><Line k="Volume moyen 20 séances" v={big(x.avg_volume20)} /></>}
        </tbody></table>}
        <div className="px-2 py-1 text-[10px] text-dim">Statistiques calculées sur les cours quotidiens d&apos;un an. Volatilité : écart-type des rendements logarithmiques × √252.</div>
      </Panel>

      <Panel className="col-span-12 md:col-span-8 xl:col-span-5" title="Cours sur un an" right={<Link href={`/graphique?s=${encodeURIComponent(s)}`} className="text-info hover:text-amber">graphique complet (GP) →</Link>}>
        {x && yearly && <div className="flex h-full flex-col p-2">
          <div className="text-[10px] text-dim">plus haute clôture {price(Math.max(...yearly))}</div>
          <div className="min-h-[160px] flex-1"><Spark values={yearly} width={600} height={240} fluid /></div>
          <div className="text-[10px] text-dim">plus basse clôture {price(Math.min(...yearly))}</div>
          <div className="flex justify-between border-t border-line text-[10px] text-dim"><span>{dateOnly(x.closes[0].time * 1000)}</span><span>{dateOnly(x.closes.at(-1)!.time * 1000)}</span></div>
        </div>}
      </Panel>

      <Panel className="col-span-12 xl:col-span-4" title={`Actualités · ${s}`} right={<SourceTag env={news.env} />}>
        <State loading={news.loading && !news.data} error={news.error} empty={news.data?.items.length === 0 && "Aucun article récent pour cet instrument."} />
        <table><tbody>{news.data?.items.map((n) => (
          <tr key={n.id} className="align-top"><td className="w-20 text-dim">{dateOnly(n.published)}</td>
            <td className="!whitespace-normal"><a href={n.link} target="_blank" rel="noreferrer" className="hover:text-amber">{n.title}</a> <span className="text-[10px] text-info">{n.source}</span></td></tr>))}</tbody></table>
      </Panel>
    </div>
  );
}
