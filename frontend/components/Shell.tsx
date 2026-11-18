"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CommandBar from "@/components/CommandBar";
import { StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { pct, price, tone } from "@/lib/format";
import { EXCHANGES, sessionState, type SessionState } from "@/lib/sessions";

/** Navigation par classe d'actifs : uniquement les modules déjà opérationnels. */
const NAV: [group: string, items: [code: string, href: string, label: string][]][] = [
  ["Marchés", [["WEI", "/wei", "Monde"], ["HOME", "/", "Accueil"]]],
  ["Actions", [["SCR", "/actions", "Screener"], ["GP", "/graphique", "Graphique"]]],
  ["Taux & macro", [["MAC", "/macro", "Macro"], ["FCST", "/forecasts", "Prévisions"], ["DATA", "/data", "Pays"]]],
  ["Infos", [["TOP", "/news", "News"], ["ECO", "/calendrier", "Calendrier"]]],
  ["", [["HELP", "/help", "Aide"]]],
];
const FLAT = NAV.flatMap(([, items]) => items);

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

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const routerRef = useRef(router); routerRef.current = router;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const m = /^Digit([1-9])$/.exec(e.code);
      if (e.altKey && m && FLAT[+m[1] - 1]) { e.preventDefault(); routerRef.current.push(FLAT[+m[1] - 1][1]); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  let n = 0;
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-black pr-2">
        <Link href="/wei" className="flex h-full shrink-0 items-center bg-amber px-2 font-bold tracking-wider text-black">MARKET TERMINAL</Link>
        <CommandBar />
        <MarketStatus />
        <span className="hidden shrink-0 border-l border-line pl-2 min-[800px]:inline"><Clock /></span>
      </header>
      <nav className="flex h-6 shrink-0 items-stretch overflow-x-auto whitespace-nowrap border-b border-line bg-panel">
        {NAV.map(([group, items]) => (
          <div key={group || "aide"} className="flex items-stretch border-r border-line">
            {group && <span className="flex items-center px-2 text-[10px] uppercase text-dim">{group}</span>}
            {items.map(([code, href, label]) => {
              const i = ++n;
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link key={code} href={href} title={`${label} · ⌥${i}`} className={`flex items-center gap-1 px-2 ${active ? "bg-raised text-amber" : "hover:bg-raised"}`}>
                  <span className={active ? "text-amber" : "text-fg"}>{code}</span><span className="hidden text-dim xl:inline">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <main className="min-h-0 flex-1 overflow-hidden p-1">{children}</main>
      <Ticker />
    </div>
  );
}
