"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/api";
import { FUNCTIONS, parseCommand, resolveSecurity, suggest, type Suggestion } from "@/lib/commands";

const HISTORY_KEY = "mt.history";
const FN_CODES = new Set(FUNCTIONS.map((f) => f.code));

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
}
function saveHistory(h: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* stockage indisponible : l'historique reste en mémoire */ }
}

/** Barre de commandes centrale : saisie, autocomplétion, historique, exécution. */
export default function CommandBar() {
  const router = useRouter();
  const s = useSearchParams().get("s");
  const current = useMemo(() => (s ? resolveSecurity(s) : null), [s]);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState(-1);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [dq, setDq] = useState("");
  useEffect(() => setHistory(loadHistory()), []);

  // recherche d'instruments chez la source de cotation, sur le texte hors code de fonction
  useEffect(() => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length && FN_CODES.has(words.at(-1)!.toUpperCase())) words.pop();
    if (words.length && FN_CODES.has(words[0].toUpperCase())) words.shift();
    const qy = words.length === 1 && words[0].length >= 2 ? words[0] : "";
    const t = setTimeout(() => setDq(qy), 250);
    return () => clearTimeout(t);
  }, [value]);
  const remote = useApi<{ symbol: string; name: string; type: string; exchange: string }[]>(dq ? `/api/market/search?q=${encodeURIComponent(dq)}` : null);

  const items: Suggestion[] = useMemo(() => {
    if (!value.trim()) return history.slice(0, 12).map((h) => ({ value: h, label: h, detail: "historique" }));
    const local = suggest(value);
    const found = (dq ? remote.data ?? [] : []).slice(0, 8).map((r) => ({ value: `${r.symbol} DES`, label: r.symbol, detail: `${r.name} · ${r.type ?? ""} ${r.exchange ?? ""}` }));
    return [...local, ...found.filter((f) => !local.some((l) => l.value === f.value))];
  }, [value, history, dq, remote.data]);
  useEffect(() => setSel(-1), [value]);

  // ⌘K ou « / » : focus ; toute frappe hors champ de saisie commence une commande
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); input.current?.select(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); input.current?.focus(); return; }
      if (e.key.length === 1 && /[\p{L}\p{N}^]/u.test(e.key)) input.current?.focus();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(null), 6000); return () => clearTimeout(t); }, [err]);

  const run = (cmd: string) => {
    const r = parseCommand(cmd, current);
    if (r.kind === "error") { setErr(r.message); return; }
    const h = [r.command, ...history.filter((x) => x !== r.command)].slice(0, 50);
    setHistory(h); saveHistory(h);
    setErr(null); setValue(""); input.current?.blur();
    router.push(r.href);
  };

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <span className="pointer-events-none absolute left-2 text-amber">&gt;</span>
      <input ref={input} value={value} spellCheck={false} autoComplete="off"
        onChange={(e) => { setValue(e.target.value); setErr(null); }}
        onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 120)}
        placeholder={current ? `${current.display} chargé · tape une fonction (GP, NEWS…) ou une commande` : "Commande : AAPL US Equity DES · BRENT GP · EURUSD Curncy DES · WEI · HELP"}
        className="h-6 w-full !border-line !bg-black pl-5 uppercase text-amber placeholder:normal-case placeholder:text-dim"
        onKeyDown={(e) => {
          if (e.key === "Escape") { setValue(""); input.current?.blur(); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, -1)); }
          else if (e.key === "Tab" && items.length) { e.preventDefault(); setValue(items[Math.max(sel, 0)].value + " "); }
          else if (e.key === "Enter") { e.preventDefault(); run(sel >= 0 && items[sel] ? items[sel].value : value); }
        }} />
      {focus && (items.length > 0 || err) && (
        <div className="absolute left-0 right-0 top-7 z-50 max-h-96 overflow-auto border border-amber bg-panel shadow-lg">
          {err && <div className="border-b border-line px-2 py-1 text-down">{err}</div>}
          {items.map((it, i) => (
            <button key={it.value + i} onMouseDown={(e) => { e.preventDefault(); run(it.value); }} onMouseEnter={() => setSel(i)}
              className={`flex w-full gap-3 px-2 py-0.5 text-left ${i === sel ? "bg-amber text-black" : ""}`}>
              <span className="w-56 shrink-0 truncate font-bold">{it.label}</span>
              <span className={`flex-1 truncate ${i === sel ? "" : "text-dim"}`}>{it.detail}</span>
            </button>
          ))}
          <div className="border-t border-line px-2 py-0.5 text-[10px] text-dim">Entrée exécuter · ↑↓ choisir · Tab compléter · Échap fermer · HELP pour l&apos;aide</div>
        </div>
      )}
      {!focus && err && <div className="absolute left-0 right-0 top-7 z-50 border border-down bg-panel px-2 py-1 text-down">{err}</div>}
    </div>
  );
}
