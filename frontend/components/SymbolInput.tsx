"use client";
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/api";

type Hit = { symbol: string; name: string; type?: string; exchange?: string };

/**
 * Champ de saisie d'un symbole avec suggestions de la source de cotation (« LVMH » → MC.PA, LVMUY…).
 * ↑/↓ pour choisir, Entrée pour valider la suggestion surlignée ; sans suggestion surlignée, Entrée garde le texte tapé.
 * La liste est positionnée en `fixed` pour ne pas être coupée par le défilement des panneaux.
 */
export default function SymbolInput({ value, onChange, onPick, placeholder, className = "", title, ariaLabel }: {
  value: string; onChange: (v: string) => void; onPick: (symbol: string) => void;
  placeholder?: string; className?: string; title?: string; ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(-1);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(value.trim().length >= 2 ? value.trim() : ""), 250);
    return () => clearTimeout(t);
  }, [value]);
  const r = useApi<Hit[]>(open && q ? `/api/market/search?q=${encodeURIComponent(q)}` : null);
  const hits = open && q ? (r.data ?? []).slice(0, 8) : [];
  useEffect(() => setSel(-1), [q]);

  const place = () => { const b = ref.current?.getBoundingClientRect(); if (b) setBox({ left: b.left, top: b.bottom + 1, width: b.width }); };
  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: Event) => { if (e.target !== ref.current) setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open, value]);

  const pick = (s: string) => { onPick(s); setOpen(false); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); setSel((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); setSel((i) => Math.max(-1, i - 1)); }
    else if (e.key === "Enter") {
      if (sel >= 0 && hits[sel]) { e.preventDefault(); pick(hits[sel].symbol); } else setOpen(false);
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <>
      <input ref={ref} value={value} placeholder={placeholder} title={title} aria-label={ariaLabel} className={className}
        autoComplete="off" spellCheck={false} role="combobox" aria-expanded={hits.length > 0} aria-autocomplete="list"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey} />
      {hits.length > 0 && box && (
        <ul role="listbox" className="fixed z-50 max-h-72 overflow-auto border border-amber bg-raised text-[11px] shadow-lg"
          style={{ left: box.left, top: box.top, minWidth: Math.max(box.width, 340) }}>
          {hits.map((h, i) => (
            <li key={h.symbol} role="option" aria-selected={i === sel}
              onMouseDown={(e) => { e.preventDefault(); pick(h.symbol); }} onMouseEnter={() => setSel(i)}
              className={`flex cursor-pointer gap-2 px-2 py-0.5 ${i === sel ? "bg-amber text-black" : "text-fg"}`}>
              <span className="w-20 shrink-0 font-bold">{h.symbol}</span>
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              <span className={`shrink-0 ${i === sel ? "text-black" : "text-dim"}`}>{h.exchange}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
