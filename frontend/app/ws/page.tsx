"use client";
import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { FUNCTIONS, resolveSecurity } from "@/lib/commands";
import { NAV } from "@/lib/nav";
import { uid, useLocal } from "@/lib/store";

/**
 * Espace de travail : plusieurs modules côte à côte, en grille (aucun chevauchement).
 * Un instrument « lié » pilote toutes les fenêtres liées à la fois (graphique, fiche, options…).
 */
type Pane = { code: string; symbol?: string; linked: boolean } | null;
type Layout = { id: string; name: string; template: string; panes: Pane[]; symbol: string };

const TEMPLATES: Record<string, { label: string; cols: string; rows: string; areas: string[] }> = {
  "1": { label: "1 zone", cols: "1fr", rows: "1fr", areas: ["1 / 1 / 2 / 2"] },
  "2": { label: "2 colonnes", cols: "1fr 1fr", rows: "1fr", areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3"] },
  "1+2": { label: "1 grande + 2", cols: "3fr 2fr", rows: "1fr 1fr", areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3"] },
  "2x2": { label: "4 zones", cols: "1fr 1fr", rows: "1fr 1fr", areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3", "2 / 1 / 3 / 2", "2 / 2 / 3 / 3"] },
  "1+3": { label: "1 large + 3", cols: "1fr 1fr 1fr", rows: "3fr 2fr", areas: ["1 / 1 / 2 / 4", "2 / 1 / 3 / 2", "2 / 2 / 3 / 3", "2 / 3 / 3 / 4"] },
  "3x2": { label: "6 zones", cols: "1fr 1fr 1fr", rows: "1fr 1fr", areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3", "1 / 3 / 2 / 4", "2 / 1 / 3 / 2", "2 / 2 / 3 / 3", "2 / 3 / 3 / 4"] },
};
// Miniature du modèle, dessinée avec les mêmes zones
function TemplateIcon({ t }: { t: string }) {
  const T = TEMPLATES[t];
  return <span className="inline-grid h-4 w-6 gap-px" style={{ gridTemplateColumns: T.cols, gridTemplateRows: T.rows }}>{T.areas.map((a, i) => <span key={i} className="bg-current" style={{ gridArea: a }} />)}</span>;
}

const P = (code: string, linked = true, symbol?: string): Pane => ({ code, linked, symbol });
const PROFILES: Record<string, Omit<Layout, "id">> = {
  Trader: { name: "Trader", template: "2x2", symbol: "AAPL", panes: [P("WEI", false), P("GP"), P("TRADE"), P("NEWS")] },
  Analyste: { name: "Analyste", template: "1+3", symbol: "AAPL", panes: [P("FA"), P("DES"), P("DCF"), P("RES")] },
  "Portfolio Manager": { name: "Portfolio Manager", template: "2x2", symbol: "AAPL", panes: [P("PORT", false), P("RISK", false), P("WEI", false), P("ECO", false)] },
  Quant: { name: "Quant", template: "2x2", symbol: "^GSPC", panes: [P("OMON"), P("OVME"), P("YAS", false), P("FX", false, "EURUSD=X")] },
  "Matières premières": { name: "Matières premières", template: "3x2", symbol: "CL=F", panes: [P("CMDTY"), P("COT"), P("GP"), P("EIA", false), P("DESK", false), P("NEWS", false)] },
};

const FN = new Map(FUNCTIONS.map((f) => [f.code, f]));
const META = new Map(NAV.flatMap((g) => g.items.map((i) => [i.code === "TOP" ? "NEWS" : i.code, { ...i, color: g.color }])));
// Modules proposés dans une case : tous ceux de la navigation, sauf l'espace lui-même
const CATALOG = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.code !== "WS").map((i) => ({ ...i, code: i.code === "TOP" ? "NEWS" : i.code })) }));
const takesSymbol = (code: string) => (FN.get(code)?.security ?? "none") !== "none";

function href(p: NonNullable<Pane>, linkedSymbol: string): string {
  const f = FN.get(p.code);
  const sym = p.linked ? linkedSymbol : p.symbol;
  const sec = takesSymbol(p.code) && sym ? resolveSecurity(sym) ?? undefined : undefined;
  const h = f?.route ? f.route(sec) : META.get(p.code)?.href ?? "/";
  return h + (h.includes("?") ? "&" : "?") + "embed=1";
}

function Picker({ onPick }: { onPick: (code: string) => void }) {
  return (
    <div className="h-full overflow-auto p-2">
      <div className="mb-2 text-dim">Choisir le module à afficher dans cette zone :</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1">
        {CATALOG.flatMap((g) => g.items.map((i) => (
          <button key={i.code} onClick={() => onPick(i.code)} className="flex items-center gap-2 border border-line px-2 py-1.5 text-left hover:border-amber hover:bg-raised" title={i.desc}>
            <span style={{ color: g.color }}><Icon name={i.icon} /></span>
            <span className="min-w-0 flex-1 truncate">{i.label}</span><span className="text-[10px] text-dim">{i.code}</span>
          </button>)))}
      </div>
    </div>
  );
}

export default function Workspace() {
  const [layouts, setLayouts, ready] = useLocal<Layout[]>("mt.ws2", [{ id: "trader", ...PROFILES.Trader }]);
  const [active, setActive] = useLocal<string>("mt.ws2.active", "trader");
  const [help, setHelp] = useLocal<boolean>("mt.ws2.help", true);
  const [max, setMax] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [symInput, setSymInput] = useState<string | null>(null);
  const lay = layouts.find((l) => l.id === active) ?? layouts[0];
  const T = lay ? TEMPLATES[lay.template] : TEMPLATES["2x2"];
  const panes = useMemo(() => (lay ? Array.from({ length: T.areas.length }, (_, i) => lay.panes[i] ?? null) : []), [lay, T]);
  if (!ready || !lay) return null;

  const save = (p: Partial<Layout>) => setLayouts(layouts.map((l) => (l.id === lay.id ? { ...l, ...p } : l)));
  const setPane = (i: number, p: Pane) => save({ panes: panes.map((x, j) => (j === i ? p : x)) });
  const swap = (a: number, b: number) => { const n = [...panes]; [n[a], n[b]] = [n[b], n[a]]; save({ panes: n }); };
  const applySymbol = (txt: string) => { const s = resolveSecurity(txt); if (s) save({ symbol: s.symbol }); setSymInput(null); };
  const addProfile = (name: string) => { const id = uid(); setLayouts([...layouts, { id, ...PROFILES[name] }]); setActive(id); setMax(null); };
  const linkedCount = panes.filter((p) => p && p.linked && takesSymbol(p.code)).length;

  return (
    <div className="flex h-full flex-col gap-1">
      {help && (
        <div className="flex shrink-0 items-start gap-3 border border-amber/60 bg-panel px-3 py-2">
          <span className="text-amber"><Icon name="windows" size={20} /></span>
          <div className="flex-1 leading-relaxed">
            <span className="text-fg">Plusieurs modules sur un seul écran.</span> <span className="text-dim">
              Choisis une <span className="text-fg">disposition</span>, puis un module par zone (une zone vide affiche le catalogue).
              L&apos;<span className="text-fg">instrument lié</span> pilote toutes les fenêtres marquées <span className="text-amber">⛓</span> : tape MSFT et le graphique, la fiche, les options et les news passent sur MSFT.
              Glisse une barre de titre sur une autre pour échanger deux fenêtres ; double-clic pour agrandir. Tout est enregistré automatiquement.</span>
          </div>
          <button onClick={() => setHelp(false)} className="text-dim hover:text-fg" title="Masquer">×</button>
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-line bg-panel px-2 py-1">
        <span className="text-[10px] uppercase text-dim">Espaces</span>
        {layouts.map((l) => (
          <span key={l.id} className={`flex items-center border ${l.id === lay.id ? "border-amber text-amber" : "border-line"}`}>
            <button onClick={() => { setActive(l.id); setMax(null); }} onDoubleClick={() => { const n = prompt("Renommer l'espace", l.name); if (n) setLayouts(layouts.map((x) => (x.id === l.id ? { ...x, name: n } : x))); }} className="px-2" title="Double-clic pour renommer">{l.name}</button>
            {layouts.length > 1 && l.id === lay.id && <button onClick={() => { if (confirm(`Supprimer l'espace « ${l.name} » ?`)) { const rest = layouts.filter((x) => x.id !== l.id); setLayouts(rest); setActive(rest[0].id); } }} className="border-l border-line px-1 text-dim hover:text-down" title="Supprimer cet espace">×</button>}
          </span>
        ))}
        <select value="" onChange={(e) => e.target.value && (e.target.value === "__vide" ? (() => { const id = uid(); setLayouts([...layouts, { id, name: "Nouvel espace", template: "2", panes: [], symbol: lay.symbol }]); setActive(id); })() : addProfile(e.target.value))} className="text-info">
          <option value="">+ nouvel espace…</option><option value="__vide">Vide</option>{Object.keys(PROFILES).map((p) => <option key={p} value={p}>Profil {p}</option>)}
        </select>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="text-[10px] uppercase text-dim">Disposition</span>
        {Object.entries(TEMPLATES).map(([k, t]) => (
          <button key={k} onClick={() => { save({ template: k }); setMax(null); }} title={t.label} className={`border px-1.5 py-0.5 ${lay.template === k ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}><TemplateIcon t={k} /></button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="text-[10px] uppercase text-dim">Instrument lié ⛓</span>
        <form onSubmit={(e) => { e.preventDefault(); if (symInput != null) applySymbol(symInput); }}>
          <input value={symInput ?? lay.symbol} onChange={(e) => setSymInput(e.target.value)} onBlur={() => symInput != null && applySymbol(symInput)} className="w-32 uppercase text-amber" title="AAPL, MC FP Equity, BRENT, EURUSD…, puis Entrée" />
        </form>
        <span className="text-[10px] text-dim">{linkedCount} fenêtre{linkedCount > 1 ? "s" : ""} liée{linkedCount > 1 ? "s" : ""}</span>
        {!help && <button onClick={() => setHelp(true)} className="ml-auto text-dim hover:text-fg">mode d&apos;emploi</button>}
      </div>

      <div className="grid min-h-0 flex-1 gap-1" style={max == null ? { gridTemplateColumns: T.cols, gridTemplateRows: T.rows } : { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }}>
        {panes.map((p, i) => {
          if (max != null && max !== i) return null;
          const meta = p ? META.get(p.code) : null;
          const sym = p && (p.linked ? lay.symbol : p.symbol);
          return (
            <section key={i} style={{ gridArea: max == null ? T.areas[i] : "1 / 1 / 2 / 2" }}
              className={`flex min-h-0 min-w-0 flex-col border bg-panel ${dragFrom != null && dragFrom !== i ? "border-dashed border-amber" : "border-line"}`}
              onDragOver={(e) => { if (dragFrom != null) e.preventDefault(); }} onDrop={() => { if (dragFrom != null && dragFrom !== i) swap(dragFrom, i); setDragFrom(null); }}>
              <header draggable onDragStart={() => setDragFrom(i)} onDragEnd={() => setDragFrom(null)} onDoubleClick={() => p && setMax(max == null ? i : null)}
                className="flex h-7 shrink-0 cursor-grab items-center gap-2 border-b border-line bg-raised px-2 active:cursor-grabbing" title="Glisser pour échanger avec une autre zone · double-clic pour agrandir">
                {p && meta ? <>
                  <span style={{ color: meta.color }}><Icon name={meta.icon} size={14} /></span>
                  <select value={p.code} onChange={(e) => setPane(i, { ...p, code: e.target.value })} className="!border-0 !bg-transparent !p-0 text-[11px] uppercase tracking-wider text-amber">
                    {CATALOG.map((g) => <optgroup key={g.title} label={g.title}>{g.items.map((it) => <option key={it.code} value={it.code}>{it.label} ({it.code})</option>)}</optgroup>)}
                  </select>
                  {takesSymbol(p.code) && <>
                    <button onClick={() => setPane(i, { ...p, linked: !p.linked, symbol: p.symbol ?? lay.symbol })} className={p.linked ? "text-amber" : "text-dim"} title={p.linked ? "Liée à l'instrument commun : cliquer pour la délier" : "Instrument propre : cliquer pour la lier à l'instrument commun"}>⛓</button>
                    {p.linked ? <span className="text-[11px] text-fg">{sym}</span>
                      : <input defaultValue={p.symbol ?? ""} key={p.symbol} onKeyDown={(e) => { if (e.key === "Enter") { const s = resolveSecurity((e.target as HTMLInputElement).value); if (s) setPane(i, { ...p, symbol: s.symbol }); } }} placeholder="instrument" className="w-24 !py-0 text-[11px] uppercase" title="Entrée pour valider" />}
                  </>}
                  <span className="ml-auto flex items-center gap-2 text-dim">
                    <button onClick={() => setMax(max == null ? i : null)} className="hover:text-fg" title={max == null ? "Agrandir dans l'espace" : "Revenir à la disposition"}>{max == null ? "⤢" : "⤡"}</button>
                    <a href={href(p, lay.symbol).replace(/[?&]embed=1/, "")} className="hover:text-fg" title="Ouvrir en pleine page">↗</a>
                    <button onClick={() => { setPane(i, null); setMax(null); }} className="hover:text-down" title="Vider cette zone">×</button>
                  </span>
                </> : <span className="text-[11px] uppercase tracking-wider text-dim">Zone {i + 1} · vide</span>}
              </header>
              <div className={`min-h-0 flex-1 ${dragFrom != null ? "pointer-events-none" : ""}`}>
                {p ? <iframe key={href(p, lay.symbol)} src={href(p, lay.symbol)} title={meta?.label ?? p.code} className="h-full w-full bg-bg" />
                  : <Picker onPick={(code) => setPane(i, { code, linked: true })} />}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
