"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AlertWatcher from "@/components/AlertWatcher";
import CommandBar from "@/components/CommandBar";
import Icon from "@/components/Icon";
import { StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { pct, price, tone } from "@/lib/format";
import { currentItem, FLAT, NAV, type NavItem } from "@/lib/nav";
import { EXCHANGES, sessionState, type SessionState } from "@/lib/sessions";
import { useLocal } from "@/lib/store";

const SHORT: Record<string, string> = {
  "^GSPC": "S&P 500", "^NDX": "NASDAQ 100", "^STOXX50E": "STOXX 50", "^FCHI": "CAC 40", "^GDAXI": "DAX", "^N225": "NIKKEI",
  "^VIX": "VIX", "^TNX": "US 10A", "EURUSD=X": "EUR/USD", "USDJPY=X": "USD/JPY", "DX-Y.NYB": "DXY", "GC=F": "OR", "CL=F": "WTI", "BZ=F": "BRENT", "BTC-USD": "BTC",
};
type Quote = { symbol: string; name?: string; price?: number; change_pct?: number; error?: string };

function Ticker() {
  const { data, env, error } = useApi<Quote[]>("/api/market/ticker", 60_000);
  if (error) return <div className="border-t border-line px-2 py-1 text-down">Bandeau indisponible : {error.message}</div>;
  const items = (data ?? []).filter((q) => !q.error);
  const row = items.map((q) => (
    <Link key={q.symbol} href={`/des?s=${encodeURIComponent(q.symbol)}`} className="mx-3 inline-flex gap-2 hover:bg-raised">
      <span className="text-amber">{SHORT[q.symbol] ?? q.symbol}</span>
      <span>{price(q.price)}</span>
      <span className={tone(q.change_pct)}>{pct(q.change_pct)}</span>
    </Link>
  ));
  return (
    <div className="flex h-6 shrink-0 items-center overflow-hidden border-t border-line bg-panel" title={env ? `${env.source} · ${env.fetched_at}` : ""}>
      <span className="relative z-10 flex h-full shrink-0 items-center gap-1 border-r border-line bg-panel pl-1">
        <StatusBadge status={env?.status} />
        {env?.stale && <span className="mr-1 bg-down px-1 text-[10px] text-black">PÉRIMÉ</span>}
      </span>
      <div className="whitespace-nowrap hover:[animation-play-state:paused]" style={{ animation: items.length ? "marquee 90s linear infinite" : undefined }}>
        {row}{row}
      </div>
    </div>
  );
}

const DOT: Record<SessionState, string> = { OPEN: "bg-up", BREAK: "bg-amber", CLOSED: "bg-line" };

function MarketStatus() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  if (!now) return null;
  return (
    <div className="hidden shrink-0 items-center gap-3 border-l border-line px-2 min-[1100px]:flex" title="Horaires de séance réguliers ; jours fériés et séances écourtées non pris en compte.">
      {EXCHANGES.map((ex) => {
        const { state, local } = sessionState(ex, now);
        return (
          <span key={ex.code} className="flex items-center gap-1" title={`${ex.city} · ${local} heure locale · ${state === "OPEN" ? "séance en cours" : state === "BREAK" ? "pause de mi-séance" : "fermé"}`}>
            <span className={`inline-block h-2 w-2 ${DOT[state]}`} />
            <span className={state === "OPEN" ? "text-fg" : "text-dim"}>{ex.code}</span>
          </span>
        );
      })}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const f = () => setNow(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    f(); const t = setInterval(f, 1000); return () => clearInterval(t);
  }, []);
  return <span className="text-dim">{now} Paris</span>;
}

/** Barre latérale : modules groupés par classe d'actifs, icône + code + nom ; réductible aux icônes. */
function Sidebar({ collapsed, active }: { collapsed: boolean; active: NavItem | null }) {
  return (
    <nav className={`flex shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-line bg-panel ${collapsed ? "w-11" : "w-52"}`} aria-label="Modules">
      {NAV.map((g) => (
        <div key={g.title} className="border-b border-line/60 py-1">
          {collapsed ? <div className="mx-auto my-1 h-0.5 w-5" style={{ background: g.color }} title={g.title} />
            : <div className="flex items-center gap-1.5 px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wider text-dim"><span className="h-2 w-2" style={{ background: g.color }} />{g.title}</div>}
          {g.items.map((it) => {
            const on = active?.code === it.code;
            const n = FLAT.indexOf(it) + 1;
            return (
              <Link key={it.code} href={it.href} title={`${it.label} : ${it.desc}${n <= 9 ? ` · ⌥${n}` : ""}`}
                className={`flex items-center gap-2 border-l-2 py-[3px] ${collapsed ? "justify-center px-0" : "px-2"} ${on ? "border-amber bg-raised text-amber" : "border-transparent text-fg hover:bg-raised hover:text-amber"}`}>
                <span style={{ color: on ? undefined : g.color }}><Icon name={it.icon} /></span>
                {!collapsed && <><span className="min-w-0 flex-1 truncate">{it.label}</span><span className={`text-[10px] ${on ? "text-amber" : "text-dim"}`}>{it.code}</span></>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Menu de tous les modules : description, exemple de commande, accès direct. */
function Launcher({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const k = q.trim().toLowerCase();
  const match = (i: NavItem) => !k || `${i.code} ${i.label} ${i.desc}`.toLowerCase().includes(k);
  const go = (href: string) => { router.push(href); onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 pt-12" onClick={onClose}>
      <div className="max-h-[85vh] w-[1100px] max-w-[96vw] overflow-auto border border-amber bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center gap-3 border-b border-line bg-panel px-3 py-2">
          <span className="font-bold tracking-wider text-amber">MODULES</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer : options, pétrole, risque, valorisation…" className="flex-1"
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter") { const f = FLAT.find(match); if (f) go(f.href); } }} />
          <span className="text-[10px] text-dim">Entrée : premier résultat · Échap : fermer</span>
        </div>
        <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-2 xl:grid-cols-3">
          {NAV.map((g) => {
            const items = g.items.filter(match);
            if (!items.length) return null;
            return (
              <div key={g.title} className="bg-panel p-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider" style={{ color: g.color }}><span className="h-2 w-2" style={{ background: g.color }} />{g.title}</div>
                {items.map((it) => (
                  <button key={it.code} onClick={() => go(it.href)} className="flex w-full items-start gap-2 px-1 py-1 text-left hover:bg-raised">
                    <span className="mt-0.5" style={{ color: g.color }}><Icon name={it.icon} size={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2"><span className="text-fg">{it.label}</span><span className="text-[10px] text-amber">{it.code}</span></span>
                      <span className="block text-[11px] leading-snug text-dim">{it.desc}</span>
                      {it.example && <span className="block text-[10px] text-info">› {it.example}</span>}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const routerRef = useRef(router); routerRef.current = router;
  const [collapsed, setCollapsed] = useLocal<boolean>("mt.nav.collapsed", false);
  const [menu, setMenu] = useState(false);
  const cur = currentItem(path, search);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const m = /^Digit([1-9])$/.exec(e.code);
      if (e.altKey && m && FLAT[+m[1] - 1]) { e.preventDefault(); routerRef.current.push(FLAT[+m[1] - 1].href); }
      if (e.altKey && e.code === "KeyM") { e.preventDefault(); setMenu((x) => !x); }
    };
    const open = () => setMenu(true);
    window.addEventListener("keydown", h); window.addEventListener("mt-open-menu", open);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("mt-open-menu", open); };
  }, []);
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-black pr-2">
        <button onClick={() => setCollapsed(!collapsed)} className="flex h-full w-11 shrink-0 items-center justify-center border-r border-line text-dim hover:text-amber" title={collapsed ? "Déplier le menu latéral" : "Réduire le menu latéral"}>
          <Icon name={collapsed ? "expand" : "collapse"} />
        </button>
        <Link href="/wei" className="flex h-full shrink-0 items-center bg-amber px-2 font-bold tracking-wider text-black">MARKET TERMINAL</Link>
        <button onClick={() => setMenu(true)} className="flex shrink-0 items-center gap-1.5 border border-amber px-2 py-0.5 text-amber hover:bg-amber hover:text-black" title="Tous les modules (⌥M)">
          <Icon name="menu" size={14} />Modules
        </button>
        <CommandBar />
        <MarketStatus />
        <span className="hidden shrink-0 border-l border-line pl-2 min-[800px]:inline"><Clock /></span>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} active={cur?.item ?? null} />
        <div className="flex min-w-0 flex-1 flex-col">
          {cur && (
            <div className="flex h-6 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-line bg-panel px-2 text-[11px]">
              <span className="h-2 w-2 shrink-0" style={{ background: cur.group.color }} />
              <span className="text-dim">{cur.group.title}</span><span className="text-line">›</span>
              <span style={{ color: cur.group.color }}><Icon name={cur.item.icon} size={14} /></span>
              <span className="text-fg">{cur.item.label}</span>
              <span className="text-[10px] text-amber">{cur.item.code}</span>
              <span className="truncate text-dim">· {cur.item.desc}</span>
              {cur.item.example && <span className="ml-auto hidden shrink-0 text-[10px] text-dim lg:inline">commande : <span className="text-info">{cur.item.example}</span></span>}
            </div>
          )}
          <main className="min-h-0 flex-1 overflow-hidden p-1">{children}</main>
        </div>
      </div>
      <Ticker />
      <AlertWatcher />
      {menu && <Launcher onClose={() => setMenu(false)} />}
    </div>
  );
}
