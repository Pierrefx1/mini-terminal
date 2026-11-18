"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Panel, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, dateTime, num, pct, price, tone } from "@/lib/format";
import { uid, useLocal } from "@/lib/store";

type Note = { id: string; symbol: string; title: string; body: string; tags: string; kind: "fondamentale" | "quantitative" | "sectorielle" | "macro" | "idée de trade"; updated: number; archived?: boolean };
type Des = { name: string; type: string; exchange: string; currency: string; last: number; d1: number; m1: number; ytd: number; vol20: number; hi52: number; lo52: number };
type FA = { ratios: Record<string, number | null>; valuation: Record<string, number | null>; sector?: string };
const KINDS: Note["kind"][] = ["fondamentale", "quantitative", "sectorielle", "macro", "idée de trade"];

/** Rendu Markdown minimal et sûr (titres, listes, gras) : aucun HTML injecté. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <strong key={i} className="text-fg">{p.slice(2, -2)}</strong> : p));
  return <div className="space-y-1 leading-relaxed">{text.split("\n").map((l, i) => {
    if (/^#{1,3} /.test(l)) return <div key={i} className="pt-2 text-[11px] uppercase text-amber">{l.replace(/^#+ /, "")}</div>;
    if (/^\s*[-*] /.test(l)) return <div key={i} className="pl-3 -indent-2">· {inline(l.replace(/^\s*[-*] /, ""))}</div>;
    return l.trim() ? <p key={i}>{inline(l)}</p> : null;
  })}</div>;
}

export default function Research() {
  const router = useRouter();
  const s = useSearchParams().get("s")?.toUpperCase() ?? "";
  const [input, setInput] = useState(s);
  useEffect(() => setInput(s), [s]);
  const [notes, setNotes] = useLocal<Note[]>("mt.notes", []);
  const [favs, setFavs] = useLocal<string[]>("mt.favorites", []);
  const [editing, setEditing] = useState<Note | null>(null);
  const [filter, setFilter] = useState(""), [showArchived, setShowArchived] = useState(false);
  const [aiOn, setAiOn] = useState(false), [force, setForce] = useState(0);
  useEffect(() => setAiOn(false), [s]);
  const des = useApi<Des>(s ? `/api/overview/describe?symbol=${encodeURIComponent(s)}` : null);
  const fa = useApi<FA>(s ? `/api/equities/fa?symbol=${encodeURIComponent(s)}` : null);
  const brief = useApi<{ markdown: string; model: string }>(s && aiOn ? `/api/research/brief?symbol=${encodeURIComponent(s)}${force ? `&force=true&n=${force}` : ""}` : null);
  const mine = notes.filter((n) => (!s || n.symbol === s) && (showArchived || !n.archived) && (!filter || (n.title + n.body + n.tags).toLowerCase().includes(filter.toLowerCase()))).sort((a, b) => b.updated - a.updated);
  const isFav = s && favs.includes(s);
  const saveNote = (n: Note) => { setNotes((l) => (l.some((x) => x.id === n.id) ? l.map((x) => (x.id === n.id ? n : x)) : [n, ...l])); setEditing(null); };
  const x = des.data;
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12" title={<span className="normal-case tracking-normal">RES · recherche <form className="ml-2 inline" onSubmit={(e) => { e.preventDefault(); router.push(`/research${input.trim() ? `?s=${encodeURIComponent(input.trim().toUpperCase())}` : ""}`); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Actif (vide : toutes les notes)" className="w-56 uppercase" /></form>
        {s && <button onClick={() => setFavs(isFav ? favs.filter((f) => f !== s) : [...favs, s])} className={`ml-2 ${isFav ? "text-amber" : "text-dim"}`}>{isFav ? "★ favori" : "☆ ajouter aux favoris"}</button>}</span>}
        right={s && <><Link href={`/des?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info">DES</Link><Link href={`/fa?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info">FA</Link><Link href={`/dcf?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info">DCF</Link><Link href={`/news?s=${encodeURIComponent(s)}`} className="border border-line px-1 text-info">NEWS</Link></>}>
        <div className="flex flex-wrap gap-2 px-2 py-1"><span className="text-dim">Favoris :</span>{favs.length ? favs.map((f) => <Link key={f} href={`/research?s=${encodeURIComponent(f)}`} className={f === s ? "text-amber" : "text-info"}>{f}</Link>) : <span className="text-dim">aucun</span>}</div>
      </Panel>
      {s && <Panel className="col-span-12 md:col-span-4 xl:col-span-3" title={`Fiche · ${s}`} right={<SourceTag env={des.env} />}>
        <State loading={des.loading && !x} error={des.error} />
        {x && <table><tbody>
          <tr><td className="text-dim">Nom</td><td className="num">{x.name}</td></tr><tr><td className="text-dim">Type · place</td><td className="num">{x.type} · {x.exchange}</td></tr>
          {fa.data?.sector && <tr><td className="text-dim">Secteur</td><td className="num">{fa.data.sector}</td></tr>}
          <tr><td className="text-dim">Cours</td><td className="num text-fg">{price(x.last)} {x.currency}</td></tr>
          <tr><td className="text-dim">1 séance · 21 séances · YTD</td><td className="num"><span className={tone(x.d1)}>{pct(x.d1)}</span> · <span className={tone(x.m1)}>{pct(x.m1)}</span> · <span className={tone(x.ytd)}>{pct(x.ytd)}</span></td></tr>
          <tr><td className="text-dim">52 semaines</td><td className="num">{price(x.lo52)} – {price(x.hi52)}</td></tr><tr><td className="text-dim">Volatilité 20 j</td><td className="num">{num(x.vol20, 1)} %</td></tr>
          {fa.data && <><tr><td className="text-dim">Capitalisation</td><td className="num">{big(fa.data.valuation.MarketCap)}</td></tr><tr><td className="text-dim">PER · EV/EBITDA</td><td className="num">{num(fa.data.valuation.PeRatio, 1)} · {num(fa.data.valuation.EnterprisesValueEBITDARatio, 1)}</td></tr>
            <tr><td className="text-dim">Marge nette · ROIC</td><td className="num">{num(fa.data.ratios.net_margin, 1)} % · {num(fa.data.ratios.roic, 1)} %</td></tr></>}
        </tbody></table>}
      </Panel>}
      {s && <Panel className="col-span-12 md:col-span-8 xl:col-span-5" title="Note de synthèse rédigée par IA" right={<>{brief.env && <SourceTag env={brief.env} />}{aiOn && <button onClick={() => setForce((n) => n + 1)} className="text-info">↻</button>}</>}>
        {!aiOn ? <div className="p-2"><button onClick={() => setAiOn(true)} className="border border-amber px-2 py-0.5 text-amber">Rédiger la note</button>
          <div className="mt-1 text-[10px] text-dim">Gemini rédige à partir des seules données du terminal (cours, statistiques, états financiers, news récentes). Texte généré : peut contenir des erreurs, pas un conseil en investissement.</div></div> : <>
          <State loading={brief.loading && !brief.data} error={brief.error} />
          {brief.data && <div className="p-2"><Markdown text={brief.data.markdown} />
            <div className="mt-2 flex gap-2 text-[10px] text-dim"><span>Généré par {brief.data.model}.</span><button onClick={() => saveNote({ id: uid(), symbol: s, title: `Note IA ${new Date().toLocaleDateString("fr-FR")}`, body: brief.data!.markdown, tags: "ia", kind: "fondamentale", updated: Date.now() })} className="text-info">enregistrer dans mes notes</button></div></div>}
        </>}
      </Panel>}
      <Panel className={`col-span-12 ${s ? "xl:col-span-4" : ""}`} title={`Notes personnelles${s ? ` · ${s}` : " · toutes"} (${mine.length})`} right={<>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="rechercher" className="w-28" />
        <label className="flex items-center gap-1"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />archives</label>
        <button onClick={() => setEditing({ id: uid(), symbol: s, title: "", body: "", tags: "", kind: "fondamentale", updated: Date.now() })} className="border border-line px-1 text-info">+ note</button></>}>
        {editing && <div className="space-y-1 border-b border-amber p-2">
          <div className="flex gap-1"><input value={editing.symbol} onChange={(e) => setEditing({ ...editing, symbol: e.target.value.toUpperCase() })} placeholder="Actif" className="w-24 uppercase" />
            <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Titre" className="flex-1" />
            <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Note["kind"] })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
          <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={8} placeholder="Thèse, catalyseurs, risques, niveaux… (Markdown : # titre, - liste, **gras**)" className="w-full border border-line bg-raised p-1" />
          <div className="flex gap-1"><input value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} placeholder="étiquettes" className="flex-1" />
            <button onClick={() => saveNote({ ...editing, updated: Date.now() })} disabled={!editing.title.trim()} className="bg-amber px-2 text-black disabled:opacity-50">enregistrer</button><button onClick={() => setEditing(null)} className="border border-line px-2">annuler</button></div>
        </div>}
        <State empty={!mine.length && !editing && "Aucune note. Les notes sont gardées dans ce navigateur."} />
        {mine.map((n) => <div key={n.id} className={`border-b border-line p-2 ${n.archived ? "opacity-60" : ""}`}>
          <div className="flex items-baseline gap-2"><Link href={`/research?s=${encodeURIComponent(n.symbol)}`} className="text-amber">{n.symbol || "—"}</Link><span className="font-bold text-fg">{n.title}</span>
            <span className="text-[10px] text-info">{n.kind}</span>{n.tags && <span className="text-[10px] text-dim">#{n.tags.split(/[ ,]+/).filter(Boolean).join(" #")}</span>}
            <span className="ml-auto text-[10px] text-dim">{dateTime(n.updated)}</span>
            <button onClick={() => setEditing(n)} className="text-info">modifier</button>
            <button onClick={() => setNotes(notes.map((x) => (x.id === n.id ? { ...x, archived: !x.archived } : x)))} className="text-dim">{n.archived ? "désarchiver" : "archiver"}</button>
            <button onClick={() => { if (confirm("Supprimer cette note ?")) setNotes(notes.filter((x) => x.id !== n.id)); }} className="text-down">×</button></div>
          <div className="mt-1 max-h-48 overflow-auto"><Markdown text={n.body} /></div>
        </div>)}
      </Panel>
    </div>
  );
}
