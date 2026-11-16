"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/api";
import { pct, price, tone } from "@/lib/format";

export const MODULES = [
  { href: "/", label: "Accueil", code: "HOME" },
  { href: "/graphique", label: "Graphique", code: "GP" },
  { href: "/calendrier", label: "Calendrier", code: "ECO" },
  { href: "/news", label: "News", code: "N" },
  { href: "/actions", label: "Screener", code: "SCR" },
  { href: "/macro", label: "Macro", code: "MAC" },
  { href: "/forecasts", label: "Forecasts", code: "FCST" },
  { href: "/data", label: "Data", code: "DATA" },
  { href: "/portefeuille", label: "Portefeuille", code: "PORT" },
] as const;

const SHORT: Record<string, string> = {
  "^GSPC": "S&P 500", "^NDX": "NASDAQ 100", "^STOXX50E": "STOXX 50", "^FCHI": "CAC 40", "^GDAXI": "DAX", "^N225": "NIKKEI",
  "^VIX": "VIX", "^TNX": "US 10A", "EURUSD=X": "EUR/USD", "USDJPY=X": "USD/JPY", "DX-Y.NYB": "DXY", "GC=F": "OR", "CL=F": "WTI", "BZ=F": "BRENT", "BTC-USD": "BTC",
};
type Quote = { symbol: string; name?: string; price?: number; change_pct?: number; error?: string };

function Ticker() {
  const { data, env, error } = useApi<Quote[]>("/api/market/ticker", 60_000);
  if (error) return <div className="border-b border-line px-2 py-1 text-down">Bandeau indisponible : {error.message}</div>;
  const items = (data ?? []).filter((q) => !q.error);
  const row = items.map((q) => (
    <Link key={q.symbol} href={`/graphique?s=${encodeURIComponent(q.symbol)}`} className="mx-3 inline-flex gap-2 hover:bg-raised">
      <span className="text-amber">{SHORT[q.symbol] ?? q.symbol}</span>
      <span>{price(q.price)}</span>
      <span className={tone(q.change_pct)}>{pct(q.change_pct)}</span>
    </Link>
  ));
  return (
    <div className="flex h-6 shrink-0 items-center overflow-hidden border-b border-line bg-panel" title={env ? `${env.source} · ${env.fetched_at}` : ""}>
      {env?.stale && <span className="ml-1 shrink-0 bg-down px-1 text-[10px] text-black">PÉRIMÉ</span>}
      <div className="whitespace-nowrap hover:[animation-play-state:paused]" style={{ animation: items.length ? "marquee 90s linear infinite" : undefined }}>
        {row}{row}
      </div>
    </div>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data: found, error } = useApi<{ symbol: string; name: string; type: string; exchange: string }[]>(dq.length >= 1 ? `/api/market/search?q=${encodeURIComponent(dq)}` : null);
  const items = useMemo(() => {
    const k = q.trim().toLowerCase();
    const mods = MODULES.filter((m) => !k || m.label.toLowerCase().includes(k) || m.code.toLowerCase().startsWith(k))
      .map((m) => ({ key: m.href, left: m.code, main: m.label, right: "module", href: m.href as string }));
    const syms = (k ? found ?? [] : []).map((s) => ({ key: "s" + s.symbol, left: s.symbol, main: s.name, right: `${s.type ?? ""} ${s.exchange ?? ""}`, href: `/graphique?s=${encodeURIComponent(s.symbol)}` }));
    return [...mods, ...syms];
  }, [q, found]);
  useEffect(() => setSel(0), [q, found]);
  const go = (href: string) => { router.push(href); onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-24" onClick={onClose}>
      <div className="w-[640px] border border-amber bg-panel" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Symbole, société ou module…  (Entrée pour ouvrir, Échap pour fermer)"
          className="w-full !border-0 !border-b !border-line !bg-black px-3 !py-2 text-sm text-amber"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter") { if (items[sel]) go(items[sel].href); else if (q.trim()) go(`/graphique?s=${encodeURIComponent(q.trim().toUpperCase())}`); }
          }} />
        <div className="max-h-96 overflow-auto">
          {items.map((it, i) => (
            <button key={it.key} onMouseEnter={() => setSel(i)} onClick={() => go(it.href)} className={`flex w-full gap-3 px-3 py-1 text-left ${i === sel ? "bg-amber text-black" : ""}`}>
              <span className="w-24 shrink-0 font-bold">{it.left}</span>
              <span className="flex-1 truncate">{it.main}</span>
              <span className="shrink-0 opacity-60">{it.right}</span>
            </button>
          ))}
          {error && <div className="px-3 py-1 text-down">Recherche indisponible : {error.message}</div>}
        </div>
      </div>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const f = () => setNow(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    f(); const t = setInterval(f, 1000); return () => clearInterval(t);
  }, []);
  return <span className="text-dim">{now} · Paris</span>;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const routerRef = useRef(router); routerRef.current = router;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      const m = /^Digit([1-9])$/.exec(e.code);
      if (e.altKey && m) { e.preventDefault(); routerRef.current.push(MODULES[+m[1] - 1].href); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="flex h-full flex-col">
      <nav className="flex h-7 shrink-0 items-stretch overflow-hidden whitespace-nowrap border-b border-line bg-black">
        <span className="flex shrink-0 items-center bg-amber px-2 font-bold text-black">MINI-TERMINAL</span>
        {MODULES.map((m, i) => {
          const active = m.href === "/" ? path === "/" : path.startsWith(m.href);
          return (
            <Link key={m.href} href={m.href} title={`⌥${i + 1}`} className={`flex shrink-0 items-center gap-1 border-r border-line px-2 xl:px-3 ${active ? "bg-raised text-amber" : "text-fg hover:bg-raised"}`}>
              <span className="text-[10px] text-dim">{i + 1}</span>{m.label}
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} className="ml-auto flex shrink-0 items-center gap-2 border-l border-line px-3 text-dim hover:text-amber"><span className="hidden min-[1400px]:inline">Rechercher</span> <kbd className="border border-line px-1">⌘K</kbd></button>
        <span className="hidden shrink-0 items-center border-l border-line px-3 min-[1180px]:flex"><Clock /></span>
      </nav>
      <Ticker />
      <main className="min-h-0 flex-1 overflow-hidden p-1">{children}</main>
      {open && <Palette onClose={() => setOpen(false)} />}
    </div>
  );
}
