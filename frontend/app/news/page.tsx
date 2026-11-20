"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useLocal } from "@/lib/store";

type Item = { id: string; title: string; link: string; source: string; published: string; summary: string; theme: string; country: string; lang: string; image: string };
type Channel = { key: string; label: string; lang: string; desc: string; video_id: string | null; url: string };

const COUNTRIES: [string, string][] = [["", "Tous"], ["US", "États-Unis"], ["EU", "Zone euro"], ["FR", "France"], ["UK", "Royaume-Uni"]];
const THEME_COLOR: Record<string, string> = {
  "Banques centrales": "#c77dff", Inflation: "#ff4d4d", Emploi: "#4aa8ff", "Énergie": "#ffa028", Crypto: "#e6e600",
  "Marchés": "#1fd15f", Commerce: "#00d1c1", Macro: "#9aa0a6", Entreprises: "#ff4d9a",
};
const tz = "Europe/Paris";
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
const dayKey = new Intl.DateTimeFormat("fr-CA", { timeZone: tz }); // AAAA-MM-JJ
const dayLong = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
const full = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`;
}
function dayLabel(iso: string) {
  const d = dayKey.format(new Date(iso)), today = dayKey.format(new Date()), yest = dayKey.format(new Date(Date.now() - 86_400_000));
  return d === today ? "Aujourd'hui" : d === yest ? "Hier" : dayLong.format(new Date(iso));
}
const imgSrc = (u: string) => `/api/news/img?u=${encodeURIComponent(u)}`;
const color = (t: string) => THEME_COLOR[t] ?? "#7486a0";

/** Illustration de l'article, ou vignette générée (source + thème) si le flux n'en fournit pas ou si elle ne charge pas. */
function Thumb({ n, className = "" }: { n: Item; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (n.image && !failed)
    return <img src={imgSrc(n.image)} alt="" loading="lazy" onError={() => setFailed(true)} className={`h-full w-full object-cover ${className}`} />;
  const c = color(n.theme);
  return (
    <div className={`flex h-full w-full flex-col justify-between p-3 ${className}`} style={{ background: `linear-gradient(135deg, ${c}33, #08101d 70%)` }}>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: c }}>{n.theme}</span>
      <span className="text-lg font-bold leading-tight text-fg/80">{n.source}</span>
    </div>
  );
}

function Meta({ n, isNew }: { n: Item; isNew: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
      {isNew && <span className="bg-amber px-1 font-bold text-black">NOUVEAU</span>}
      <span className="text-info">{n.source}</span>
      <span className="text-dim" title={full.format(new Date(n.published))}>{ago(n.published)}</span>
      <span className="border px-1" style={{ color: color(n.theme), borderColor: `${color(n.theme)}66` }}>{n.theme}</span>
      {n.lang === "fr" && <span className="text-dim">FR</span>}
    </div>
  );
}

function Card({ n, isNew, onOpen }: { n: Item; isNew: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group flex flex-col overflow-hidden border border-line bg-panel text-left transition-colors hover:border-amber/70 hover:bg-raised">
      <div className="aspect-video w-full overflow-hidden bg-raised"><Thumb n={n} className="transition-transform duration-300 group-hover:scale-[1.03]" /></div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <Meta n={n} isNew={isNew} />
        <h3 className="line-clamp-3 text-[13px] font-semibold leading-snug text-fg group-hover:text-amber">{n.title}</h3>
        {n.summary && <p className="line-clamp-3 text-[11px] leading-relaxed text-dim">{n.summary}</p>}
      </div>
    </button>
  );
}

function Hero({ n, isNew, onOpen }: { n: Item; isNew: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group grid w-full overflow-hidden border border-line bg-panel text-left hover:border-amber/70 md:grid-cols-5">
      <div className="aspect-video overflow-hidden bg-raised md:col-span-3 md:aspect-auto md:min-h-64"><Thumb n={n} className="transition-transform duration-300 group-hover:scale-[1.02]" /></div>
      <div className="flex flex-col gap-2 p-4 md:col-span-2">
        <span className="text-[10px] uppercase tracking-widest text-amber">À la une</span>
        <Meta n={n} isNew={isNew} />
        <h2 className="text-xl font-bold leading-tight text-fg group-hover:text-amber">{n.title}</h2>
        {n.summary && <p className="line-clamp-6 text-[12px] leading-relaxed text-dim">{n.summary}</p>}
        <span className="mt-auto text-[11px] text-info">Lire →</span>
      </div>
    </button>
  );
}

/** Panneau de lecture : résumé complet, lien vers l'article ; ← → pour naviguer, Échap pour fermer. */
function Reader({ n, onClose, onPrev, onNext, pos }: { n: Item; onClose: () => void; onPrev?: () => void; onNext?: () => void; pos: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, onPrev, onNext]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <article className="flex h-full w-full max-w-2xl flex-col overflow-auto border-l border-amber/60 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-raised px-3 py-1.5 text-[11px]">
          <button onClick={onPrev} disabled={!onPrev} className="border border-line px-2 text-dim hover:text-fg disabled:opacity-30">← préc.</button>
          <button onClick={onNext} disabled={!onNext} className="border border-line px-2 text-dim hover:text-fg disabled:opacity-30">suiv. →</button>
          <span className="text-dim">{pos}</span>
          <button onClick={onClose} className="ml-auto border border-line px-2 text-dim hover:text-down" title="Échap">fermer ✕</button>
        </div>
        <div className="aspect-video w-full shrink-0 bg-raised"><Thumb n={n} /></div>
        <div className="flex flex-col gap-3 p-5">
          <Meta n={n} isNew={false} />
          <h1 className="text-2xl font-bold leading-tight text-fg">{n.title}</h1>
          <div className="text-[11px] text-dim">{full.format(new Date(n.published))} · {n.source}</div>
          {n.summary ? <p className="text-[14px] leading-relaxed text-fg/90">{n.summary}</p> : <p className="text-dim">Pas de résumé fourni par la source.</p>}
          <div className="flex flex-wrap gap-2 pt-2">
            <a href={n.link} target="_blank" rel="noreferrer" className="bg-amber px-3 py-1.5 font-bold text-black hover:bg-amber/80">Lire l&apos;article sur {n.source} ↗</a>
            <button onClick={() => { navigator.clipboard?.writeText(n.link); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="border border-line px-3 py-1.5 text-dim hover:text-fg">{copied ? "lien copié ✓" : "copier le lien"}</button>
          </div>
          <p className="text-[10px] text-dim">L&apos;article complet s&apos;ouvre sur le site de l&apos;éditeur (contenu protégé, non reproduit dans le terminal).</p>
        </div>
      </article>
    </div>
  );
}

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
