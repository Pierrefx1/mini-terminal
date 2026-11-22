"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateOnly } from "@/lib/format";
import { useLocal } from "@/lib/store";

type Ev = { id: string; title: string; country: string; time: string; impact: string; forecast: string; previous: string; actual: string; actual_src: "nasdaq" | "derived" | ""; surprise: number | null };
const ZONES: Record<string, { name: string; flag: string }> = {
  USD: { name: "États-Unis", flag: "🇺🇸" }, EUR: { name: "Zone euro", flag: "🇪🇺" }, GBP: { name: "Royaume-Uni", flag: "🇬🇧" }, JPY: { name: "Japon", flag: "🇯🇵" },
  CNY: { name: "Chine", flag: "🇨🇳" }, CAD: { name: "Canada", flag: "🇨🇦" }, AUD: { name: "Australie", flag: "🇦🇺" }, NZD: { name: "Nlle-Zélande", flag: "🇳🇿" }, CHF: { name: "Suisse", flag: "🇨🇭" },
};
const IMPACT: Record<string, { label: string; color: string; rank: number }> = {
  High: { label: "Forte", color: "#ff4d4d", rank: 3 }, Medium: { label: "Moyenne", color: "#ffa028", rank: 2 },
  Low: { label: "Faible", color: "#3a4a62", rank: 1 }, Holiday: { label: "Férié", color: "#4aa8ff", rank: 0 },
};
const tz = "Europe/Paris";
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
const dayLong = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
const dayShort = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "short", day: "numeric" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); // AAAA-MM-JJ
const key = (t: number | string | Date) => dayKey.format(new Date(t));

function relDay(k: string, now: number) {
  if (k === key(now)) return "Aujourd'hui";
  if (k === key(now + 86_400_000)) return "Demain";
  if (k === key(now - 86_400_000)) return "Hier";
  return null;
}
function countdown(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `dans ${m} min`;
  if (m < 1440) return `dans ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
  return `dans ${Math.floor(m / 1440)} j ${Math.floor((m % 1440) / 60)} h`;
}
const zone = (c: string) => ZONES[c] ?? { name: c, flag: "🏳️" };
const imp = (e: Ev) => IMPACT[e.impact] ?? IMPACT.Low;

/** Largeurs communes à tous les tableaux du jour, pour que les colonnes restent alignées sous l'en-tête unique. */
function Cols() {
  return <colgroup><col className="w-16" /><col className="w-20" /><col /><col className="w-24" /><col className="w-24" /><col className="w-24" /><col className="w-24" /></colgroup>;
}

function Row({ e, past, next }: { e: Ev; past: boolean; next: boolean }) {
  const im = imp(e), z = zone(e.country), high = e.impact === "High";
  return (
    <tr className={`${past ? "opacity-50" : ""} ${next ? "bg-amber/10" : "hover:bg-raised"}`} title={`${z.name} · importance ${im.label.toLowerCase()}`}>
      <td className="border-l-[3px] tabular-nums" style={{ borderLeftColor: im.color }}>{hm.format(new Date(e.time))}</td>
      <td className="whitespace-nowrap"><span className="mr-1">{z.flag}</span><span className="text-dim">{e.country}</span></td>
      <td className={`!whitespace-normal ${high ? "font-semibold text-fg" : past ? "" : "text-fg/90"} ${e.impact === "Holiday" ? "italic text-info" : ""}`}>
        {e.title}{next && <span className="ml-2 bg-amber px-1 text-[10px] font-bold text-black">PROCHAIN</span>}
      </td>
      <td className="num text-fg">{e.actual
        ? (e.actual_src === "derived" ? <span className="italic text-dim" title="Déduit du « précédent » de la publication suivante (chiffre éventuellement révisé)">{e.actual}*</span> : e.actual)
        : past && e.impact !== "Holiday" ? <span className="text-dim" title="Chiffre non trouvé : publication sans valeur chiffrée (discours, compte rendu…) ou absente de Nasdaq">n.d.</span> : ""}</td>
      <td className="num text-info">{e.forecast || "–"}</td>
      <td className="num">{e.previous || "–"}</td>
      <td className={`num ${e.surprise == null || e.surprise === 0 ? "" : e.surprise > 0 ? "text-up" : "text-down"}`}>{e.surprise == null ? "" : (e.surprise > 0 ? "+" : "") + e.surprise.toLocaleString("fr-FR")}</td>
    </tr>
  );
}

export default function Calendrier() {
  const { data, env, error, loading } = useApi<{ events: Ev[]; history_from: string | null }>("/api/calendar", 10 * 60_000);
  const [min, setMin] = useLocal<string>("mt.cal.min", "2");
  const [zones, setZones] = useLocal<string[]>("mt.cal.zones", []);
  const [when, setWhen] = useState<"semaine" | "tout">("semaine");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const days = useRef(new Map<string, HTMLElement>());
  const scrolled = useRef(false);

  const keep = (e: Ev) => (e.impact === "Holiday" || imp(e).rank >= +min) && (!zones.length || zones.includes(e.country));
  const counts = useMemo(() => { const c: Record<string, number> = {}; (data?.events ?? []).forEach((e) => { if (imp(e).rank >= +min) c[e.country] = (c[e.country] ?? 0) + 1; }); return c; }, [data, min]);

  const groups = useMemo(() => {
    const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const out = new Map<string, Ev[]>();
    for (const e of data?.events ?? []) {
      if (!keep(e) || (when === "semaine" && new Date(e.time) < monday)) continue;
      const k = key(e.time);
      (out.get(k) ?? out.set(k, []).get(k)!).push(e);
    }
    return [...out.entries()];
  }, [data, min, zones, when]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = useMemo(() => (data?.events ?? []).find((e) => new Date(e.time).getTime() > now && e.impact !== "Holiday" && keep(e)), [data, now, min, zones]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = key(now);

  const goTo = (k: string) => {
    const el = days.current.get(k), sc = scroller.current;
    if (el && sc) sc.scrollTo({ top: el.offsetTop, behavior: "smooth" });
  };
  // à l'ouverture : se placer sur aujourd'hui (ou le premier jour à venir)
  useEffect(() => {
    if (scrolled.current || !groups.length) return;
    const k = groups.find(([d]) => d >= today)?.[0];
    if (k) { scrolled.current = true; requestAnimationFrame(() => goTo(k)); }
  }, [groups, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (z: string) => setZones((s) => (s.includes(z) ? s.filter((x) => x !== z) : [...s, z]));

  return (
    <Panel title="ECO · Calendrier économique" right={<><span>heures de Paris</span><SourceTag env={env} /></>} className="h-full">
      <div className="flex h-full flex-col">
        {/* Filtres */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-2 py-1.5">
          <label className="flex items-center gap-1.5"><span className="text-dim">Période</span>
            <Seg value={when} options={[["semaine", "Semaine en cours"], ["tout", "Avec l'historique"]]} onChange={(v) => setWhen(v as "semaine" | "tout")} /></label>
          <label className="flex items-center gap-1.5"><span className="text-dim">Importance</span>
            <Seg value={min} options={[["3", "Forte"], ["2", "Moyenne et forte"], ["1", "Toutes"]]} onChange={setMin} /></label>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-dim">Zones</span>
            <button onClick={() => setZones([])} className={`border px-1.5 py-0.5 ${zones.length ? "border-line text-dim hover:text-fg" : "border-amber text-amber"}`}>Toutes</button>
            {Object.entries(ZONES).map(([k, z]) => (
              <button key={k} onClick={() => toggle(k)} title={z.name} disabled={!counts[k] && !zones.includes(k)}
                className={`border px-1.5 py-0.5 disabled:opacity-30 ${zones.includes(k) ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}>
                {z.flag} {k}<span className="ml-1 text-[10px] opacity-70">{counts[k] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Prochaine publication */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line bg-raised px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-amber">Prochaine publication</span>
          {next ? <>
            <span className="h-2 w-2 shrink-0" style={{ background: imp(next).color }} title={`Importance ${imp(next).label.toLowerCase()}`} />
            <button onClick={() => goTo(key(next.time))} className="font-semibold text-fg hover:text-amber">{zone(next.country).flag} {next.title}</button>
            <span className="text-dim"><span className="capitalize">{relDay(key(next.time), now) ?? dayLong.format(new Date(next.time))}</span> à {hm.format(new Date(next.time))}</span>
            <span className="bg-amber/15 px-1.5 text-amber">{countdown(new Date(next.time).getTime() - now)}</span>
            <span className="ml-auto text-dim">Consensus <span className="text-info">{next.forecast || "–"}</span> · Précédent <span className="text-fg">{next.previous || "–"}</span></span>
          </> : <span className="text-dim">{loading ? "…" : "Aucune publication à venir pour ces filtres."}</span>}
        </div>

        {/* Navigation par jour */}
        {groups.length > 1 && (
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1">
            {groups.map(([k, evs]) => {
              const h = evs.filter((e) => e.impact === "High").length, m = evs.filter((e) => e.impact === "Medium").length;
              return (
                <button key={k} onClick={() => goTo(k)}
                  className={`shrink-0 border px-2 py-0.5 text-left ${k === today ? "border-amber text-amber" : k < today ? "border-line text-dim" : "border-line text-fg hover:border-amber/60"}`}>
                  <div className="capitalize">{relDay(k, now) ?? dayShort.format(new Date(evs[0].time))}</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-dim">
                    {h > 0 && <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5" style={{ background: IMPACT.High.color }} />{h}</span>}
                    {m > 0 && <span className="flex items-center gap-0.5"><span className="h-1.5 w-1.5" style={{ background: IMPACT.Medium.color }} />{m}</span>}
                    <span>{evs.length} év.</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Liste : en-tête de colonnes fixe, jours qui défilent */}
        <table className="shrink-0 table-fixed"><Cols />
          <thead><tr><th>Heure</th><th>Zone</th><th>Publication</th><th className="num">Réel</th><th className="num">Consensus</th><th className="num">Précédent</th><th className="num" title="Réel moins consensus">Surprise</th></tr></thead>
        </table>
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
          <State loading={loading && !data} error={error} empty={!loading && !error && groups.length === 0 && "Aucun événement pour ces filtres."} />
          {groups.map(([k, evs]) => {
            const rel = relDay(k, now), cut = k === today ? evs.findIndex((e) => new Date(e.time).getTime() > now) : -1;
            return (
              <section key={k} ref={(el) => { if (el) days.current.set(k, el); else days.current.delete(k); }}>
                <h3 className={`sticky top-0 z-10 flex items-baseline gap-2 border-y border-line bg-panel px-2 py-1 ${k === today ? "text-amber" : k < today ? "text-dim" : "text-fg"}`}>
                  {rel && <span className="font-bold">{rel}</span>}
                  <span className="capitalize">{dayLong.format(new Date(evs[0].time))}</span>
                  <span className="text-[10px] text-dim">· {evs.length} publication{evs.length > 1 ? "s" : ""}</span>
                </h3>
                <table className="table-fixed"><Cols />
                  <tbody>{evs.map((e, i) => [
                    i === cut && <tr key="now"><td colSpan={7} className="!p-0"><div className="flex items-center gap-2 text-[10px] text-amber"><span className="h-px flex-1 bg-amber" />maintenant · {hm.format(new Date(now))}<span className="h-px flex-1 bg-amber" /></div></td></tr>,
                    <Row key={e.id} e={e} past={new Date(e.time).getTime() < now} next={e.id === next?.id} />,
                  ])}</tbody>
                </table>
              </section>
            );
          })}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-2 py-2 text-[10px] text-dim">
            {Object.values(IMPACT).map((i) => <span key={i.label} className="flex items-center gap-1"><span className="h-2 w-2" style={{ background: i.color }} />{i.label}</span>)}
            <span>· Surprise = réel − consensus (vert : au-dessus, rouge : en dessous).</span>
            <span className="basis-full leading-snug">
              Calendrier, consensus et précédent : ForexFactory (semaine en cours ; les semaines passées sont conservées localement{data?.history_from ? ` depuis le ${dateOnly(data.history_from)}` : ""}).
              Réel : chiffre publié, repris du calendrier de Nasdaq (deux dernières semaines, mis à jour toutes les 15 min). Quand il est introuvable, le « précédent » de la publication suivante en tient lieu (marqué *, éventuellement révisé).
              n.d. : publication sans chiffre (discours, compte rendu) ou absente de Nasdaq.
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
