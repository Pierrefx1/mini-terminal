"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useLocal } from "@/lib/store";
import { type NewsItem as Item, Card, color, dayLabel, Hero, hm, Meta, Reader, Thumb } from "@/components/News";

type Channel = { key: string; label: string; lang: string; desc: string; video_id: string | null; url: string };

const COUNTRIES: [string, string][] = [["", "Tous"], ["US", "États-Unis"], ["EU", "Zone euro"], ["FR", "France"], ["UK", "Royaume-Uni"]];

function LivePlayer() {
  const live = useApi<Channel[]>("/api/news/live", 10 * 60_000);
  const [pref, setPref] = useLocal<string>("mt.news.channel", "yahoo");
  const chans = live.data ?? [];
  const cur = chans.find((c) => c.key === pref && c.video_id) ?? chans.find((c) => c.video_id);
  return (
    <section className="flex shrink-0 flex-col border border-line bg-panel">
      <header className="flex items-center gap-2 border-b border-line bg-raised px-2 py-1">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-amber"><span className="h-2 w-2 animate-pulse rounded-full bg-down" />Direct</span>
        <span className="truncate text-[11px] text-fg">{cur?.label}</span>
        <span className="ml-auto"><SourceTag env={live.env} /></span>
      </header>
      <div className="aspect-video w-full bg-black">
        {cur ? <iframe key={cur.video_id} className="h-full w-full" title={`Direct ${cur.label}`}
          src={`https://www.youtube-nocookie.com/embed/${cur.video_id}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          : <div className="flex h-full items-center justify-center p-4 text-center text-dim"><State loading={live.loading} error={live.error} empty={!live.loading && !live.error && "Aucune chaîne en direct pour le moment."} /></div>}
      </div>
      <div className="flex flex-wrap gap-1 border-t border-line p-1.5">
        {chans.map((c) => (
          <button key={c.key} disabled={!c.video_id} onClick={() => setPref(c.key)} title={c.video_id ? c.desc : "Hors antenne sur YouTube en ce moment"}
            className={`border px-1.5 py-0.5 text-[10px] ${cur?.key === c.key ? "border-amber bg-amber text-black" : c.video_id ? "border-line text-dim hover:text-fg" : "border-line/50 text-dim/40 line-through"}`}>
            {c.label}{c.lang === "fr" ? " · FR" : ""}
          </button>
        ))}
      </div>
      <div className="px-2 pb-1 text-[10px] text-dim">Démarre en muet (règle des navigateurs) : cliquer sur le lecteur pour le son. {cur && <a href={cur.url} target="_blank" rel="noreferrer" className="text-info">Ouvrir sur YouTube ↗</a>}</div>
    </section>
  );
}

export default function News() {
  const [theme, setTheme] = useState("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState(""); const [dq, setDq] = useState("");
  const [sym, setSym] = useState(""); const [symbol, setSymbol] = useState("");
  const [view, setView] = useLocal<"cards" | "list">("mt.news.view", "cards");
  const [lastSeen, setLastSeen, seenReady] = useLocal<string>("mt.news.seen", "");
  const [seenAtOpen, setSeenAtOpen] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const urlSymbol = (useSearchParams().get("s") ?? "").toUpperCase();
  useEffect(() => { setSymbol(urlSymbol); setSym(urlSymbol); }, [urlSymbol]); // NEWS <instrument>
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ ...(theme && { theme }), ...(country && { country }), ...(dq && { q: dq }), ...(symbol && { symbol }) }).toString();
  const { data, env, error, loading } = useApi<{ items: Item[]; themes: string[] }>(`/api/news?${qs}`, 2 * 60_000);
  const items = useMemo(() => data?.items ?? [], [data]);

  // « nouveau » : publié depuis la dernière visite (mémorisée à la visite précédente, figée pendant celle-ci)
  useEffect(() => { if (seenReady && seenAtOpen === null) setSeenAtOpen(lastSeen); }, [seenReady, lastSeen, seenAtOpen]);
  useEffect(() => { if (seenAtOpen !== null && items.length && items[0].published > lastSeen) setLastSeen(items[0].published); }, [items, seenAtOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const isNew = useCallback((n: Item) => !!seenAtOpen && n.published > seenAtOpen, [seenAtOpen]);
  const nNew = items.filter(isNew).length;

  const hero = view === "cards" && !dq ? items.find((n) => n.image) ?? items[0] : undefined;
  const rest = items.filter((n) => n !== hero);
  const groups = useMemo(() => {
    const g: { label: string; items: Item[] }[] = [];
    for (const n of rest) { const l = dayLabel(n.published); if (g.at(-1)?.label === l) g.at(-1)!.items.push(n); else g.push({ label: l, items: [n] }); }
    return g;
  }, [rest]);
  const idx = (n: Item) => items.indexOf(n);
  const cur = open != null ? items[open] : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1 xl:flex-row">
      {/* Colonne principale : articles */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col border border-line bg-panel">
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-raised px-2 py-1.5">
          <span className="text-[11px] uppercase tracking-wider text-amber">{symbol ? `News · ${symbol}` : "News"}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (titre, résumé)…" className="w-56" />
          <form onSubmit={(e) => { e.preventDefault(); setSymbol(sym.trim().toUpperCase()); }} className="flex gap-1">
            <input value={sym} onChange={(e) => setSym(e.target.value)} placeholder="Société (ex. NVDA)" className="w-40 uppercase" />
            {symbol && <button type="button" onClick={() => { setSymbol(""); setSym(""); }} className="border border-line px-1 text-info hover:text-down">{symbol} ×</button>}
          </form>
          {!symbol && <Seg value={country} options={COUNTRIES} onChange={setCountry} />}
          <span className="ml-auto flex items-center gap-2 text-[10px] text-dim">
            {nNew > 0 && <span className="text-amber">{nNew} nouveau{nNew > 1 ? "x" : ""}</span>}
            <span>{items.length} articles</span>
            <Seg value={view} options={[["cards", "Cartes"], ["list", "Liste"]]} onChange={setView} />
            <SourceTag env={env} />
          </span>
        </header>
        {!symbol && (data?.themes.length ?? 0) > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-2 py-1">
            {["", ...data!.themes].map((t) => (
              <button key={t || "all"} onClick={() => setTheme(t)}
                className={`border px-2 py-0.5 text-[10px] ${theme === t ? "bg-raised text-fg" : "text-dim hover:text-fg"}`}
                style={{ borderColor: theme === t ? (t ? color(t) : "#ffa028") : "#1c2b42" }}>
                {t && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: color(t) }} />}{t || "Tous les thèmes"}
              </button>
            ))}
          </div>
        )}
        {env?.error && <div className="shrink-0 border-b border-down/60 px-2 py-1 text-[10px] text-down">{env.error}</div>}
        <div className="min-h-0 flex-1 overflow-auto">
          <State loading={loading && !data} error={error} empty={data?.items.length === 0 && "Aucun article pour ces filtres."} />
          {view === "cards" ? (
            <div className="flex flex-col gap-3 p-2">
              {hero && <Hero n={hero} isNew={isNew(hero)} onOpen={() => setOpen(idx(hero))} />}
              {groups.map((g) => (
                <div key={g.label}>
                  <h3 className="sticky top-0 z-[1] mb-1.5 border-b border-line bg-panel/95 py-1 text-[11px] uppercase tracking-wider text-dim backdrop-blur">{g.label} <span className="text-dim/60">· {g.items.length}</span></h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                    {g.items.map((n) => <Card key={n.id} n={n} isNew={isNew(n)} onOpen={() => setOpen(idx(n))} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n, i) => (
                <li key={n.id}>
                  <button onClick={() => setOpen(i)} className="flex w-full gap-3 px-2 py-2 text-left hover:bg-raised">
                    <div className="h-14 w-24 shrink-0 overflow-hidden bg-raised"><Thumb n={n} /></div>
                    <div className="min-w-0 flex-1">
                      <Meta n={n} isNew={isNew(n)} />
                      <div className="mt-0.5 text-[13px] font-semibold leading-snug text-fg hover:text-amber">{n.title}</div>
                      {n.summary && <div className="line-clamp-1 text-[11px] text-dim">{n.summary}</div>}
                    </div>
                    <span className="shrink-0 text-[10px] text-dim">{hm.format(new Date(n.published))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Colonne latérale : direct vidéo et fil des dépêches */}
      <aside className="flex min-h-0 w-full shrink-0 flex-col gap-1 xl:w-[460px]">
        <LivePlayer />
        <section className="flex min-h-64 flex-1 flex-col border border-line bg-panel">
          <header className="flex items-center justify-between border-b border-line bg-raised px-2 py-1">
            <span className="text-[11px] uppercase tracking-wider text-amber">Fil des dépêches</span>
            <span className="text-[10px] text-dim">actualisé toutes les 2 min</span>
          </header>
          <ol className="min-h-0 flex-1 overflow-auto">
            {items.slice(0, 60).map((n, i) => (
              <li key={n.id}>
                <button onClick={() => setOpen(i)} className="flex w-full gap-2 border-l-2 px-2 py-1.5 text-left hover:bg-raised" style={{ borderLeftColor: color(n.theme) }}>
                  <span className="w-10 shrink-0 text-[10px] text-dim">{hm.format(new Date(n.published))}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[11px] leading-snug ${isNew(n) ? "text-amber" : "text-fg"}`}>{n.title}</span>
                    <span className="text-[10px] text-info">{n.source}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </aside>

      {cur && <Reader n={cur} pos={`${open! + 1} / ${items.length}`} onClose={() => setOpen(null)}
        onPrev={open! > 0 ? () => setOpen(open! - 1) : undefined} onNext={open! < items.length - 1 ? () => setOpen(open! + 1) : undefined} />}
    </div>
  );
}
