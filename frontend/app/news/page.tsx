"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";

type Item = { id: string; title: string; link: string; source: string; published: string; summary: string; theme: string; country: string; lang: string };
const COUNTRIES: [string, string][] = [["", "Tous"], ["US", "États-Unis"], ["EU", "Zone euro"], ["FR", "France"], ["UK", "Royaume-Uni"]];
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const dm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} j`;
}

export default function News() {
  const [theme, setTheme] = useState("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState(""); const [dq, setDq] = useState("");
  const [sym, setSym] = useState(""); const [symbol, setSymbol] = useState("");
  const urlSymbol = (useSearchParams().get("s") ?? "").toUpperCase();
  useEffect(() => { setSymbol(urlSymbol); setSym(urlSymbol); }, [urlSymbol]); // NEWS <instrument>
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ ...(theme && { theme }), ...(country && { country }), ...(dq && { q: dq }), ...(symbol && { symbol }) }).toString();
  const { data, env, error, loading } = useApi<{ items: Item[]; themes: string[] }>(`/api/news?${qs}`, 2 * 60_000);
  return (
    <Panel title={symbol ? `News · ${symbol}` : "News économiques et marchés"} right={<SourceTag env={env} />} className="h-full">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-panel px-2 py-1">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans les titres…" className="w-64" />
        <form onSubmit={(e) => { e.preventDefault(); setSymbol(sym.trim().toUpperCase()); }} className="flex gap-1">
          <input value={sym} onChange={(e) => setSym(e.target.value)} placeholder="Symbole (ex. NVDA)" className="w-36 uppercase" />
          {symbol && <button type="button" onClick={() => { setSymbol(""); setSym(""); }} className="border border-line px-1 text-info hover:text-down">{symbol} ×</button>}
        </form>
        {!symbol && <>
          <Seg value={country} options={COUNTRIES} onChange={setCountry} />
          <Seg value={theme} options={[["", "Tous thèmes"], ...(data?.themes ?? []).map((t) => [t, t] as [string, string])]} onChange={setTheme} />
        </>}
        <span className="ml-auto text-dim">{data?.items.length ?? 0} articles</span>
      </div>
      {env?.error && <div className="border-b border-down/60 px-2 py-1 text-down">{env.error}</div>}
      <State loading={loading && !data} error={error} empty={data?.items.length === 0 && "Aucun article pour ces filtres."} />
      <table>
        <tbody>{data?.items.map((n) => (
          <tr key={n.id} className="align-top">
            <td className="w-24 text-dim" title={n.published}>{dm.format(new Date(n.published))} {hm.format(new Date(n.published))}</td>
            <td className="w-12 text-dim">{ago(n.published)}</td>
            <td className="w-40 text-info">{n.source}</td>
            <td className="w-36 text-dim">{n.theme}</td>
            <td className="!whitespace-normal"><a href={n.link} target="_blank" rel="noreferrer" className="text-fg hover:text-amber">{n.title}</a>{n.summary && <div className="max-w-5xl text-[11px] text-dim">{n.summary}</div>}</td>
          </tr>))}</tbody>
      </table>
    </Panel>
  );
}
