"use client";
import { useEffect, useMemo, useState } from "react";
import { Panel, Seg, SourceTag, State, Toggle } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateOnly } from "@/lib/format";

type Ev = { id: string; title: string; country: string; time: string; impact: string; forecast: string; previous: string; actual: string; surprise: number | null };
const ZONES: Record<string, string> = { USD: "États-Unis", EUR: "Zone euro", GBP: "Royaume-Uni", JPY: "Japon", CNY: "Chine", CAD: "Canada", AUD: "Australie", NZD: "Nlle-Zélande", CHF: "Suisse" };
const IMPACT: Record<string, { label: string; cls: string; rank: number }> = {
  High: { label: "Forte", cls: "bg-down", rank: 3 }, Medium: { label: "Moyenne", cls: "bg-amber", rank: 2 }, Low: { label: "Faible", cls: "bg-dim", rank: 1 }, Holiday: { label: "Férié", cls: "bg-info", rank: 0 },
};
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" });

export default function Calendrier() {
  const { data, env, error, loading } = useApi<{ events: Ev[]; history_from: string | null }>("/api/calendar", 10 * 60_000);
  const [min, setMin] = useState("1");
  const [zones, setZones] = useState<string[]>([]);
  const [when, setWhen] = useState<"semaine" | "tout">("semaine");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const groups = useMemo(() => {
    const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const out = new Map<string, Ev[]>();
    for (const e of data?.events ?? []) {
      if ((IMPACT[e.impact]?.rank ?? 1) < +min && e.impact !== "Holiday") continue;
      if (zones.length && !zones.includes(e.country)) continue;
      if (when === "semaine" && new Date(e.time) < monday) continue;
      const k = dayKey.format(new Date(e.time));
      (out.get(k) ?? out.set(k, []).get(k)!).push(e);
    }
    return [...out.entries()];
  }, [data, min, zones, when]);
  const next = useMemo(() => (data?.events ?? []).find((e) => new Date(e.time).getTime() > now && (IMPACT[e.impact]?.rank ?? 0) >= +min && (!zones.length || zones.includes(e.country)))?.id, [data, now, min, zones]);
  const toggle = (z: string) => setZones((s) => (s.includes(z) ? s.filter((x) => x !== z) : [...s, z]));

  return (
    <Panel title="Calendrier économique" right={<><span>heures de Paris</span><SourceTag env={env} /></>} className="h-full">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-panel px-2 py-1">
        <Seg value={when} options={[["semaine", "Cette semaine"], ["tout", "Tout l'historique"]]} onChange={(v) => setWhen(v as any)} />
        <span className="text-dim">Importance</span>
        <Seg value={min} options={[["1", "Toutes"], ["2", "Moyenne +"], ["3", "Forte"]]} onChange={setMin} />
        <span className="text-dim">Zones</span>
        {Object.entries(ZONES).map(([k, v]) => <Toggle key={k} on={zones.includes(k)} onChange={() => toggle(k)}>{v}</Toggle>)}
        {zones.length > 0 && <button onClick={() => setZones([])} className="text-dim hover:text-fg">tout afficher</button>}
      </div>
      <State loading={loading} error={error} empty={!loading && !error && groups.length === 0 && "Aucun événement pour ces filtres."} />
      <div className="border-b border-line px-2 py-1 text-[10px] text-dim">
        La source gratuite ne couvre que la semaine en cours et ne publie pas le chiffre réel. Les semaines passées sont conservées localement{data?.history_from ? ` depuis le ${dateOnly(data.history_from)}` : ""} ;
        la colonne « Réel » est déduite du « Précédent » de la publication suivante (donc éventuellement révisée) et reste vide tant que celle-ci n'est pas parue.
      </div>
      {groups.map(([k, evs]) => (
        <div key={k}>
          <div className="bg-raised px-2 py-1 capitalize text-amber">{day.format(new Date(evs[0].time))}</div>
          <table>
            <thead><tr><th className="w-16">Heure</th><th className="w-32">Zone</th><th className="w-24">Importance</th><th>Événement</th><th className="num w-24">Réel</th><th className="num w-24">Consensus</th><th className="num w-24">Précédent</th><th className="num w-24">Écart</th></tr></thead>
            <tbody>{evs.map((e) => {
              const past = new Date(e.time).getTime() < now, im = IMPACT[e.impact] ?? IMPACT.Low;
              return (
                <tr key={e.id} className={`${past ? "text-dim" : ""} ${e.id === next ? "outline outline-1 -outline-offset-1 outline-amber" : ""}`}>
                  <td>{hm.format(new Date(e.time))}</td><td>{ZONES[e.country] ?? e.country}</td>
                  <td><span className={`mr-1 inline-block h-2 w-2 ${im.cls}`} />{im.label}</td>
                  <td className={past ? "" : "text-fg"}>{e.title}{e.id === next && <span className="ml-2 bg-amber px-1 text-[10px] text-black">PROCHAIN</span>}</td>
                  <td className="num">{e.actual || (past ? <span title="Non fourni par la source">n.d.</span> : "")}</td><td className="num">{e.forecast || "–"}</td><td className="num">{e.previous || "–"}</td>
                  <td className={`num ${e.surprise == null || e.surprise === 0 ? "" : e.surprise > 0 ? "text-up" : "text-down"}`}>{e.surprise == null ? "" : (e.surprise > 0 ? "+" : "") + e.surprise.toLocaleString("fr-FR")}</td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      ))}
    </Panel>
  );
}
