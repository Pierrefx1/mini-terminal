"use client";
import { useEffect, useState } from "react";

/** Article de news et composants d'affichage communs à l'onglet News et à l'accueil. */
export type NewsItem = { id: string; title: string; link: string; source: string; published: string; summary: string; theme: string; country: string; lang: string; image: string };
export const THEME_COLOR: Record<string, string> = {
  "Banques centrales": "#c77dff", Inflation: "#ff4d4d", Emploi: "#4aa8ff", "Énergie": "#ffa028", Crypto: "#e6e600",
  "Marchés": "#1fd15f", Commerce: "#00d1c1", Macro: "#9aa0a6", Entreprises: "#ff4d9a",
};
export const tz = "Europe/Paris";
export const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
export const dayKey = new Intl.DateTimeFormat("fr-CA", { timeZone: tz }); // AAAA-MM-JJ
export const dayLong = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
export const full = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`;
}
export function dayLabel(iso: string) {
  const d = dayKey.format(new Date(iso)), today = dayKey.format(new Date()), yest = dayKey.format(new Date(Date.now() - 86_400_000));
  return d === today ? "Aujourd'hui" : d === yest ? "Hier" : dayLong.format(new Date(iso));
}
export const imgSrc = (u: string) => `/api/news/img?u=${encodeURIComponent(u)}`;
export const color = (t: string) => THEME_COLOR[t] ?? "#7486a0";

/** Illustration de l'article, ou vignette générée (source + thème) si le flux n'en fournit pas ou si elle ne charge pas. */
export function Thumb({ n, className = "" }: { n: NewsItem; className?: string }) {
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

export function Meta({ n, isNew }: { n: NewsItem; isNew: boolean }) {
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

export function Card({ n, isNew, onOpen }: { n: NewsItem; isNew: boolean; onOpen: () => void }) {
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

export function Hero({ n, isNew, onOpen }: { n: NewsItem; isNew: boolean; onOpen: () => void }) {
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
export function Reader({ n, onClose, onPrev, onNext, pos }: { n: NewsItem; onClose: () => void; onPrev?: () => void; onNext?: () => void; pos: string }) {
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
