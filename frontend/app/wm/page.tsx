"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Arc, ArcCat, Cat, Feature, GlobeHandle, Marker } from "@/components/WorldGlobe";
import { SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { num } from "@/lib/format";

const WorldGlobe = dynamic(() => import("@/components/WorldGlobe"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-dim">Initialisation du globe…</div> });

type Bar = { symbol: string; label: string; price: number | null; change: number | null; change_pct: number | null };
type News = Omit<Marker, "kind" | "cat"> & { cat: Cat | null; lat: number | null; lon: number | null; sources: number; others: { source: string; title: string; link: string }[] };
type Asset = { symbol: string; label: string; why: string; price: number | null; change_pct: number | null };
type Zone = { key: string; name: string; isos: string[]; lat: number; lon: number; alt: number; conflict24: number; base: number; ratio: number | null;
  countries: { iso: string; name: string; conflict24: number; ratio: number | null }[]; stories: number; assets: Asset[] };
type GdCountry = { iso: string; name: string; conflict24: number; material24: number; articles24: number; events24: number; tone: number | null; base: number | null; ratio: number | null; anomaly: boolean };
type Gdelt = { countries: GdCountry[]; coverage: { last24: number; base_days: number; last_slot: string | null }; anomaly: number; anomaly_min: number };
type Monitor = { markers: Marker[]; news: News[]; markets: Bar[]; zones: Zone[]; gdelt: Gdelt; generated_at: string };
type Links = { arcs: Arc[]; notes: Record<ArcCat, string> };

// Mêmes valeurs que CAT_COLOR / ARC_COLOR du composant (dupliquées ici pour ne pas charger Three.js avant le globe)
const COLOR: Record<Cat, string> = { risk: "#ff4d4d", econ: "#4aa8ff", event: "#ffa028", center: "#ece8df" };
const ACOLOR: Record<ArcCat, string> = { finance: "#ece8df", energy: "#ffa028", trade: "#4aa8ff" };
const CAT_LABEL: Record<Cat, string> = { risk: "Risques géopolitiques", econ: "Information économique", event: "Événements majeurs", center: "Places financières" };
const CAT_SHORT: Record<Cat, string> = { risk: "RISQUE", econ: "ÉCO", event: "ÉVÉNEMENT", center: "PLACE" };
const ARC_LABEL: Record<ArcCat, string> = { finance: "Liens financiers (corrélation)", energy: "Corridors énergétiques", trade: "Corridors commerciaux" };
const REGIONS: [string, number, number, number][] = [
  ["Monde", 22, 10, 1.95], ["Amériques", 15, -80, 1.75], ["Europe", 50, 12, 1.25], ["Moyen-Orient", 28, 45, 1.3],
  ["Afrique", 3, 20, 1.6], ["Asie", 30, 105, 1.55], ["Océanie", -25, 140, 1.6],
];
const CLOCKS: [string, string][] = [["NY", "America/New_York"], ["LDN", "Europe/London"], ["PAR", "Europe/Paris"], ["DXB", "Asia/Dubai"], ["HKG", "Asia/Hong_Kong"], ["TYO", "Asia/Tokyo"]];
const HOURS = [6, 24, 72] as const;

const ts = (t: string | number | null | undefined) => (t == null ? NaN : typeof t === "number" ? t * 1000 : Date.parse(t));
function ago(t: string | number | null | undefined, now: number) {
  const s = (now - ts(t)) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 0) { const m = -s / 60; return m < 90 ? `dans ${Math.round(m)} min` : m < 2880 ? `dans ${Math.round(m / 60)} h` : `dans ${Math.round(m / 1440)} j`; }
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} j`;
}
const hm = (t: string | null | undefined) => (t ? new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "–");
/** Rapport à la normale : ×1,8 en orange au-delà du seuil d'anomalie. */
function Ratio({ r, hot }: { r: number | null | undefined; hot?: boolean }) {
  if (r == null) return null;
  return <span className={`num ${hot ? "text-amber" : r < 0.8 ? "text-dim" : "text-fg/70"}`} title="Présence du pays dans les conflits recensés par GDELT sur 24 h, rapportée à sa présence habituelle (7 jours précédents)">×{num(r, 1)}</span>;
}
function Chip({ a }: { a: Asset }) {
  return <Link href={`/graphique?s=${encodeURIComponent(a.symbol)}`} title={`${a.why} · clic : graphique`} className="inline-flex items-center gap-1 border border-line px-1 hover:border-amber">
    <span className="text-dim">{a.label}</span><span className={`num ${tone(a.change_pct)}`}>{pct(a.change_pct, 1)}</span></Link>;
}
const pct = (v: number | null | undefined, d = 2) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${num(v, d)} %`);
const tone = (v: number | null | undefined) => (v == null ? "text-dim" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-fg");

function Dot({ c, ring }: { c: string; ring?: boolean }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: c, boxShadow: ring ? `0 0 0 2px ${c}44` : undefined }} />;
}
function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line">
      <header className="flex items-center justify-between px-2 pb-1 pt-2 text-[10px] uppercase tracking-[0.14em] text-dim"><span>{title}</span>{right}</header>
      <div className="px-2 pb-2">{children}</div>
    </section>
  );
}

export default function WorldMonitor() {
  const mon = useApi<Monitor>("/api/world/monitor", 120_000);
  const lk = useApi<Links>("/api/world/links", 3_600_000);
  const d = mon.data;
  const [features, setFeatures] = useState<Feature[]>([]);
  useEffect(() => { fetch("/world/countries.geojson").then((r) => r.json()).then((j) => setFeatures(j.features)).catch(() => setFeatures([])); }, []);

  const [cats, setCats] = useState<Record<Cat, boolean>>({ risk: true, econ: true, event: true, center: true });
  const [arcCats, setArcCats] = useState<Record<ArcCat, boolean>>({ finance: true, energy: true, trade: false });
  const [hours, setHours] = useState<(typeof HOURS)[number]>(24);
  const [rotate, setRotate] = useState(true);
  const [showGdelt, setShowGdelt] = useState(true);
  const [colorBy, setColorBy] = useState<"anomaly" | "intensity">("anomaly");
  const [zone, setZone] = useState<Zone | null>(null);
  const [sel, setSel] = useState<Marker | null>(null);
  const [country, setCountry] = useState<{ iso: string; name: string } | null>(null);
  const [newsCat, setNewsCat] = useState<Cat | "all">("all");
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const api = useRef<GlobeHandle | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // Marqueurs visibles : catégories cochées, période (les publications à venir et les places restent affichées)
  const inWindow = (m: Marker) => m.kind === "center" || m.kind === "market" || (m.kind === "calendar" ? ts(m.time) >= now - hours * 3600e3 : now - ts(m.time) <= hours * 3600e3);
  const all = useMemo(() => (d?.markers ?? []).filter(inWindow), [d, hours, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const markers = useMemo(() => all.filter((m) => cats[m.cat] && (showGdelt || m.kind !== "gdelt")), [all, cats, showGdelt]);
  const gd = d?.gdelt;
  const gdBy = useMemo(() => new Map((gd?.countries ?? []).map((c) => [c.iso, c])), [gd]);
  const arcs = useMemo(() => (lk.data?.arcs ?? []).filter((a) => arcCats[a.cat]), [lk.data, arcCats]);
  const counts = useMemo(() => all.reduce((a, m) => ({ ...a, [m.cat]: (a[m.cat] ?? 0) + 1 }), {} as Record<Cat, number>), [all]);
  const arcCounts = useMemo(() => (lk.data?.arcs ?? []).reduce((a, x) => ({ ...a, [x.cat]: (a[x.cat] ?? 0) + 1 }), {} as Record<ArcCat, number>), [lk.data]);

  // Agrégats par pays (contours Natural Earth : codes ADM0_A3)
  const byIso = useMemo(() => {
    const m: Record<string, { iso: string; name: string; risk: number; econ: number; event: number; critical: number; center?: Marker }> = {};
    for (const x of all) {
      if (!x.iso) continue;
      const r = (m[x.iso] ??= { iso: x.iso, name: x.country ?? x.iso, risk: 0, econ: 0, event: 0, critical: 0 });
      if (x.cat === "center") { if (!r.center) r.center = x; } else r[x.cat]++;
      if (x.critical) r.critical++;
    }
    return m;
  }, [all]);
  // Aplat des pays : intensité des conflits (échelle log) ou hausse par rapport à la normale (GDELT)
  const { riskByIso, riskTip } = useMemo(() => {
    const cs = gd?.countries ?? [], max = Math.max(1, ...cs.map((c) => c.conflict24));
    const val: Record<string, number> = {}, tip: Record<string, string> = {};
    for (const c of cs) {
      const v = colorBy === "intensity" ? (4 * Math.log1p(c.conflict24)) / Math.log1p(max)
        : c.ratio != null && c.conflict24 >= (gd?.anomaly_min ?? 20) ? Math.max(0, Math.min(4, (c.ratio - 1) * 2.5)) : 0;
      if (v > 0.05) val[c.iso] = v;
      tip[c.iso] = `${c.conflict24} événements de conflit sur 24 h${c.ratio != null ? ` · ×${num(c.ratio, 1)} vs normale` : ""}`;
    }
    return { riskByIso: val, riskTip: tip };
  }, [gd, colorBy]);
  const countries = useMemo(() => {
    const isos = new Set([...Object.keys(byIso), ...gdBy.keys()]);
    return [...isos].map((iso) => {
      const b = byIso[iso], g = gdBy.get(iso);
      return { iso, name: b?.name ?? g?.name ?? iso, risk: b?.risk ?? 0, event: b?.event ?? 0, econ: b?.econ ?? 0, center: b?.center, g,
        score: (g?.anomaly ? 1e6 * (g.ratio ?? 0) : 0) + (g?.conflict24 ?? 0) + (b?.critical ?? 0) * 50 + (b?.risk ?? 0) * 20 };
    })
      .filter((c) => c.score > 0 || c.center)
      .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.iso.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.score - a.score);
  }, [byIso, gdBy, q]);

  const centroid = (iso: string): [number, number] | null => {
    const f = features.find((x) => x.properties.ADM0_A3 === iso);
    if (f) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const ring = polys.map((p: number[][][]) => p[0]).sort((a: number[][], b: number[][]) => b.length - a.length)[0];
      const lons = ring.map((c: number[]) => c[0]), lats = ring.map((c: number[]) => c[1]);
      return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
    }
    const m = all.find((x) => x.iso === iso);
    return m ? [m.lat, m.lon] : null;
  };
  const selectCountry = (iso: string, name: string, focus = true) => {
    setCountry({ iso, name }); setSel(null); setZone(null);
    const c = focus && centroid(iso);
    if (c) api.current?.focus(c[0], c[1], 1.45);
  };
  const selectMarker = (m: Marker, focus = true) => { setSel(m); if (focus) api.current?.focus(m.lat, m.lon, 1.35); };
  const selectZone = (z: Zone) => { setZone(z); setSel(null); setCountry(null); api.current?.focus(z.lat, z.lon, z.alt); };

  const news = useMemo(() => (d?.news ?? [])
    .filter((n) => newsCat === "all" || n.cat === newsCat)
    .filter((n) => !country || n.iso === country.iso), [d, newsCat, country]);
  const critical = all.filter((m) => m.critical);
  const centers = all.filter((m) => m.cat === "center" && m.change_pct != null);
  const up = centers.filter((m) => m.change_pct! > 0).length;
  const worst = [...centers].sort((a, b) => a.change_pct! - b.change_pct!)[0];
  const best = [...centers].sort((a, b) => b.change_pct! - a.change_pct!)[0];
  const cInfo = country && byIso[country.iso];
  const cGd = country ? gdBy.get(country.iso) : undefined;
  const cZones = country ? (d?.zones ?? []).filter((z) => z.isos.includes(country.iso)) : [];
  const zEvents = zone ? all.filter((m) => m.iso && zone.isos.includes(m.iso) && m.cat === "risk").sort((a, b) => Number(b.critical) - Number(a.critical) || (b.articles ?? 0) - (a.articles ?? 0) || ts(b.time) - ts(a.time)) : [];
  const anomalies = (gd?.countries ?? []).filter((c) => c.anomaly);
  const cEvents = country ? all.filter((m) => m.iso === country.iso && m.cat !== "center").sort((a, b) => Number(b.critical) - Number(a.critical) || ts(b.time) - ts(a.time)) : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#020304] text-[11px]">
      {/* Bandeau des marchés mondiaux */}
      <div className="flex shrink-0 items-stretch border-b border-line bg-[#05080d]">
        <div className="flex shrink-0 items-center gap-2 border-r border-line px-3">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-down" />
          <span className="font-bold tracking-[0.2em] text-fg">WORLD MONITOR</span>
        </div>
        <div className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          {(d?.markets ?? []).map((b) => (
            <div key={b.symbol} className="flex shrink-0 flex-col justify-center border-r border-line/60 px-2.5 py-1 leading-tight">
              <span className="text-[9px] uppercase tracking-wider text-dim">{b.label}</span>
              <span className="num text-fg">{b.price == null ? "–" : num(b.price, b.price > 1000 ? 0 : b.price < 10 ? 4 : 2)} <span className={tone(b.change_pct)}>{pct(b.change_pct)}</span></span>
            </div>
          ))}
        </div>
        <div className="hidden shrink-0 items-center gap-3 border-l border-line px-3 text-[10px] text-dim 2xl:flex">
          {CLOCKS.map(([k, tz]) => <span key={k}>{k} <span className="text-fg">{new Date(now).toLocaleTimeString("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}</span></span>)}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[250px_minmax(0,1fr)_330px]">
        {/* Panneau gauche : couches, synthèse, pays */}
        <aside className="hidden min-h-0 flex-col overflow-y-auto border-r border-line bg-[#05080d] lg:flex">
          <Section title="Points chauds" right={<span className="normal-case tracking-normal" title="Événements de conflit recensés par GDELT sur 24 h · présence rapportée à la normale">GDELT 24 h</span>}>
            <div className="space-y-1.5">
              {(d?.zones ?? []).map((z) => {
                const hot = z.ratio != null && z.ratio >= (gd?.anomaly ?? 1.5);
                return (
                  <div key={z.key} className={`border-l-2 pl-1.5 ${zone?.key === z.key ? "border-amber" : hot ? "border-down" : "border-line"}`}>
                    <button onClick={() => selectZone(z)} className="flex w-full items-baseline gap-1.5 text-left hover:text-amber">
                      <span className={`min-w-0 flex-1 truncate ${hot ? "text-fg" : "text-fg/80"}`}>{z.name}</span>
                      <span className="num text-[10px] text-down" title="événements de conflit sur 24 h">{z.conflict24}</span>
                      <Ratio r={z.ratio} hot={hot} />
                    </button>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">{z.assets.slice(0, 3).map((a) => <Chip key={a.symbol} a={a} />)}</div>
                  </div>
                );
              })}
              {!d?.zones?.length && <div className="text-dim">…</div>}
            </div>
          </Section>

          <Section title="Couches">
            {(Object.keys(CAT_LABEL) as Cat[]).map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-2 py-0.5 hover:text-fg">
                <input type="checkbox" checked={cats[c]} onChange={(e) => setCats({ ...cats, [c]: e.target.checked })} className="accent-[#ffa028]" />
                <Dot c={COLOR[c]} /><span className={cats[c] ? "text-fg" : "text-dim"}>{CAT_LABEL[c]}</span>
                <span className="num ml-auto text-dim">{counts[c] ?? 0}</span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 py-0.5 pl-5 hover:text-fg" title="Événements géolocalisés par GDELT (combats, coercition, manifestations…), taille selon le nombre d'articles">
              <input type="checkbox" checked={showGdelt} onChange={(e) => setShowGdelt(e.target.checked)} className="accent-[#ffa028]" />
              <span className={showGdelt ? "text-fg" : "text-dim"}>dont événements GDELT</span>
              <span className="num ml-auto text-dim">{all.filter((m) => m.kind === "gdelt").length}</span>
            </label>
            <div className="mt-1.5 flex items-center gap-1 border-t border-line/60 pt-1.5">
              <span className="text-dim">Pays colorés</span>
              <span className="ml-auto flex border border-line">
                {([["anomaly", "hausse"], ["intensity", "intensité"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setColorBy(k)} className={`px-1.5 ${colorBy === k ? "bg-amber text-black" : "text-dim hover:text-fg"}`}
                    title={k === "anomaly" ? "Présence dans les conflits recensés, rapportée à la normale des 7 jours précédents" : "Nombre d'événements de conflit sur 24 h (échelle logarithmique)"}>{l}</button>))}
              </span>
            </div>
            <div className="mt-1.5 border-t border-line/60 pt-1.5">
              {(Object.keys(ARC_LABEL) as ArcCat[]).map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-2 py-0.5 hover:text-fg" title={lk.data?.notes[c]}>
                  <input type="checkbox" checked={arcCats[c]} onChange={(e) => setArcCats({ ...arcCats, [c]: e.target.checked })} className="accent-[#ffa028]" />
                  <span className="inline-block h-0.5 w-3 shrink-0" style={{ background: ACOLOR[c] }} /><span className={arcCats[c] ? "text-fg" : "text-dim"}>{ARC_LABEL[c]}</span>
                  <span className="num ml-auto text-dim">{arcCounts[c] ?? 0}</span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Période">
            <div className="flex border border-line">
              {HOURS.map((h) => <button key={h} onClick={() => setHours(h)} className={`flex-1 py-0.5 ${h === hours ? "bg-amber text-black" : "text-dim hover:text-fg"}`}>{h} h</button>)}
            </div>
          </Section>

          <Section title="Régions">
            <div className="grid grid-cols-2 gap-1">
              {REGIONS.map(([n, lat, lon, alt]) => <button key={n} onClick={() => api.current?.focus(lat, lon, alt)} className="border border-line py-0.5 text-dim hover:border-amber hover:text-amber">{n}</button>)}
            </div>
          </Section>

          <Section title="Synthèse">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
              <div><div className="text-[9px] uppercase text-dim">Critiques</div><div className="num text-[16px] text-down">{critical.length}</div></div>
              <div title={`Pays au moins ${num(gd?.anomaly ?? 1.5, 1)} fois plus présents que d'habitude dans les conflits recensés (≥ ${gd?.anomaly_min ?? 20} événements sur 24 h)`}>
                <div className="text-[9px] uppercase text-dim">Pays en hausse</div><div className="num text-[16px] text-amber">{anomalies.length}</div></div>
              <div><div className="text-[9px] uppercase text-dim">Places en hausse</div><div className="num text-[16px]"><span className="text-up">{up}</span><span className="text-dim"> / {centers.length}</span></div></div>
              <div><div className="text-[9px] uppercase text-dim">Publications</div><div className="num text-[16px] text-fg">{all.filter((m) => m.kind === "calendar").length}</div></div>
            </div>
            {anomalies.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1 border-t border-line/60 pt-1.5">
              {anomalies.slice(0, 8).map((c) => <button key={c.iso} onClick={() => selectCountry(c.iso, c.name)} className="border border-amber/40 px-1 text-[10px] hover:border-amber">{c.name} <Ratio r={c.ratio} hot /></button>)}
            </div>}
            {gd && <div className="mt-1.5 text-[10px] text-dim" title="Fichiers GDELT disponibles : référence = 7 jours précédant les 24 dernières heures">
              GDELT · relevé {hm(gd.coverage.last_slot)} · référence {num(gd.coverage.base_days, 1)} j{gd.coverage.base_days < 3 ? " (en constitution)" : ""}</div>}
            {worst && best && <div className="mt-1.5 space-y-0.5 border-t border-line/60 pt-1.5">
              <button onClick={() => selectMarker(best)} className="flex w-full justify-between hover:text-fg"><span className="text-dim">Meilleure place</span><span>{best.index} <span className={tone(best.change_pct)}>{pct(best.change_pct)}</span></span></button>
              <button onClick={() => selectMarker(worst)} className="flex w-full justify-between hover:text-fg"><span className="text-dim">Plus forte baisse</span><span>{worst.index} <span className={tone(worst.change_pct)}>{pct(worst.change_pct)}</span></span></button>
            </div>}
          </Section>

          <Section title="Pays" right={<span className="normal-case tracking-normal">{countries.length}</span>}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer…" className="mb-1 w-full" />
          </Section>
          <div className="min-h-[180px] flex-1 overflow-y-auto pb-2">
            {countries.map((c) => (
              <button key={c.iso} onClick={() => selectCountry(c.iso, c.name)}
                className={`flex w-full items-center gap-1.5 border-l-2 px-2 py-[3px] text-left hover:bg-raised ${country?.iso === c.iso ? "border-amber bg-raised" : "border-transparent"}`}>
                <span className="w-8 shrink-0 text-[9px] text-dim">{c.iso}</span>
                <span className="min-w-0 flex-1 truncate text-fg">{c.name}</span>
                {c.g && <span className="num text-down/80" title="événements de conflit GDELT sur 24 h">{c.g.conflict24}</span>}
                {c.g && <Ratio r={c.g.ratio} hot={c.g.anomaly} />}
                {c.risk > 0 && <span className="num text-down" title="sujets d'actualité classés « risque »">{c.risk}</span>}
                {c.center?.change_pct != null && <span className={`num w-12 text-right ${tone(c.center.change_pct)}`}>{pct(c.center.change_pct, 1)}</span>}
              </button>
            ))}
          </div>
        </aside>

        {/* Globe */}
        <main className="relative min-h-[420px] overflow-hidden" style={{ background: "radial-gradient(ellipse at 50% 45%, #0b1119 0%, #030508 55%, #010203 100%)" }}>
          <div ref={box} className="absolute inset-0">
            {size.w > 0 && features.length > 0 && d && (
              <WorldGlobe api={api} width={size.w} height={size.h} features={features} markers={markers} arcs={arcs} rotate={rotate}
                selectedIso={country?.iso ?? null} selectedId={sel?.id ?? null} riskByIso={riskByIso} riskTip={riskTip}
                onMarker={(m) => { setZone(null); selectMarker(m, false); }} onCountry={(iso, name) => selectCountry(iso, name, false)} onHover={setHover} />
            )}
          </div>
          {!d && <div className="absolute inset-0 grid place-items-center"><div className="w-80"><State loading={mon.loading} error={mon.error} /></div></div>}

          {/* Légende et état */}
          <div className="pointer-events-none absolute left-3 top-3 space-y-0.5 text-[10px] text-dim">
            <div className="text-fg">{markers.length} marqueurs · {arcs.length} flux · {hours} h</div>
            {(Object.keys(COLOR) as Cat[]).map((c) => <div key={c} className="flex items-center gap-1.5"><Dot c={COLOR[c]} />{CAT_LABEL[c]}</div>)}
            <div className="pt-1">{hover ?? " "}</div>
          </div>
          <div className="absolute bottom-3 left-3 max-w-[60%]"><SourceTag env={mon.env} /></div>

          {/* Commandes de vue */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-1">
            {[["+", () => api.current?.zoom(0.7), "Zoom avant"], ["−", () => api.current?.zoom(1.4), "Zoom arrière"], ["⌖", () => { api.current?.reset(); setCountry(null); setSel(null); setZone(null); }, "Vue mondiale"]].map(([t, f, title]) => (
              <button key={t as string} onClick={f as () => void} title={title as string} className="h-7 w-7 border border-line bg-[#05080dcc] text-fg hover:border-amber hover:text-amber">{t as string}</button>
            ))}
            <button onClick={() => setRotate(!rotate)} title="Rotation automatique" className={`h-7 w-7 border bg-[#05080dcc] ${rotate ? "border-amber text-amber" : "border-line text-dim"}`}>⟳</button>
          </div>

          {/* Fiche détaillée : événement ou pays */}
          {(sel || country || zone) && (
            <div className="absolute right-3 top-3 max-h-[calc(100%-24px)] w-[330px] overflow-y-auto border border-line bg-[#05080df2] shadow-2xl">
              {sel ? <>
                <header className="flex items-center gap-2 border-b border-line px-2.5 py-1.5" style={{ borderTop: `2px solid ${COLOR[sel.cat]}` }}>
                  <span className="text-[10px] font-bold tracking-wider" style={{ color: COLOR[sel.cat] }}>{sel.critical ? "CRITIQUE" : CAT_SHORT[sel.cat]}</span>
                  <span className="truncate text-[10px] text-dim">{sel.place}{sel.country && sel.country !== sel.place ? ` · ${sel.country}` : ""}</span>
                  <button onClick={() => setSel(null)} className="ml-auto text-dim hover:text-fg" aria-label="Fermer">✕</button>
                </header>
                <div className="space-y-2 p-2.5">
                  <div className="text-[13px] leading-snug text-fg">{sel.title}</div>
                  {sel.change_pct != null && <div className="flex gap-4"><div><div className="text-[9px] uppercase text-dim">{sel.index}</div><div className="num text-[15px] text-fg">{num(sel.price, 2)}</div></div>
                    <div><div className="text-[9px] uppercase text-dim">Séance</div><div className={`num text-[15px] ${tone(sel.change_pct)}`}>{pct(sel.change_pct)}</div></div></div>}
                  {sel.summary && <p className="leading-relaxed text-dim">{sel.summary}</p>}
                  {(sel.forecast || sel.previous || sel.actual) && <div className="flex gap-4">
                    {sel.actual && <div><div className="text-[9px] uppercase text-dim">Publié</div><div className="text-[15px] text-fg">{sel.actual}</div></div>}
                    {sel.surprise != null && <div><div className="text-[9px] uppercase text-dim">Surprise</div><div className={`text-[15px] ${tone(sel.surprise)}`}>{sel.surprise > 0 ? "+" : ""}{sel.surprise.toLocaleString("fr-FR")}</div></div>}
                    <div><div className="text-[9px] uppercase text-dim">Consensus</div><div className="text-fg">{sel.forecast || "–"}</div></div>
                    <div><div className="text-[9px] uppercase text-dim">Précédent</div><div className="text-fg">{sel.previous || "–"}</div></div></div>}
                  {sel.kind === "gdelt" && <div className="flex gap-4">
                    <div><div className="text-[9px] uppercase text-dim">Articles</div><div className="num text-[15px] text-fg">{sel.articles}</div></div>
                    <div><div className="text-[9px] uppercase text-dim">Relevés</div><div className="num text-[15px] text-fg">{sel.reports}</div></div>
                    <div title="Tonalité moyenne des articles (GDELT) : négative = ton alarmant"><div className="text-[9px] uppercase text-dim">Tonalité</div><div className={`num text-[15px] ${tone(sel.tone)}`}>{num(sel.tone, 1)}</div></div></div>}
                  <div className="flex flex-wrap gap-x-3 text-[10px] text-dim">
                    {sel.source && <span>{sel.source}</span>}
                    {sel.time != null && <span title={new Date(ts(sel.time)).toLocaleString("fr-FR")}>{ago(sel.time, now)}</span>}
                    <span>{num(sel.lat, 2)}°, {num(sel.lon, 2)}°</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {sel.link && <a href={sel.link} target="_blank" rel="noopener noreferrer" className="border border-line px-2 py-0.5 text-info hover:border-info">{sel.kind === "gdelt" ? "Article source ↗" : "Article ↗"}</a>}
                    {sel.symbol && <Link href={`/des?s=${encodeURIComponent(sel.symbol)}`} className="border border-line px-2 py-0.5 text-amber hover:border-amber">Fiche DES</Link>}
                    {sel.symbol && <Link href={`/graphique?s=${encodeURIComponent(sel.symbol)}`} className="border border-line px-2 py-0.5 text-amber hover:border-amber">Graphique</Link>}
                    {sel.iso && <button onClick={() => selectCountry(sel.iso!, sel.country ?? sel.iso!)} className="border border-line px-2 py-0.5 text-dim hover:text-fg">Fiche pays</button>}
                    <button onClick={() => api.current?.focus(sel.lat, sel.lon, 1.0)} className="border border-line px-2 py-0.5 text-dim hover:text-fg">Centrer</button>
                  </div>
                </div>
              </> : zone ? <>
                <header className="flex items-center gap-2 border-b border-line px-2.5 py-1.5" style={{ borderTop: "2px solid #ff4d4d" }}>
                  <span className="text-[10px] font-bold tracking-wider text-down">POINT CHAUD</span>
                  <button onClick={() => setZone(null)} className="ml-auto text-dim hover:text-fg" aria-label="Fermer">✕</button>
                </header>
                <div className="space-y-2.5 p-2.5">
                  <div className="text-[14px] text-fg">{zone.name}</div>
                  <div className="grid grid-cols-3 gap-1 text-center">
                    <div className="border border-line py-1" title="Événements de conflit recensés par GDELT sur 24 h"><div className="num text-[15px] text-down">{zone.conflict24}</div><div className="text-[9px] uppercase text-dim">conflits 24 h</div></div>
                    <div className="border border-line py-1" title="Présence de la zone dans les conflits recensés, rapportée à la normale des 7 jours précédents"><div className="text-[15px]"><Ratio r={zone.ratio} hot={zone.ratio != null && zone.ratio >= (gd?.anomaly ?? 1.5)} />{zone.ratio == null && "–"}</div><div className="text-[9px] uppercase text-dim">vs normale</div></div>
                    <div className="border border-line py-1" title="Sujets d'actualité internationale classés « risque »"><div className="num text-[15px] text-fg">{zone.stories}</div><div className="text-[9px] uppercase text-dim">sujets</div></div>
                  </div>
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wider text-dim">Actifs exposés · séance</div>
                    <table className="w-full"><tbody>{zone.assets.map((a) => (
                      <tr key={a.symbol} className="border-b border-line/40">
                        <td className="py-0.5"><Link href={`/graphique?s=${encodeURIComponent(a.symbol)}`} className="text-amber hover:underline">{a.label}</Link><div className="text-[10px] text-dim">{a.why}</div></td>
                        <td className="num text-right text-fg">{a.price == null ? "–" : num(a.price, a.price > 1000 ? 0 : a.price < 10 ? 4 : 2)}</td>
                        <td className={`num w-14 text-right ${tone(a.change_pct)}`}>{pct(a.change_pct)}</td>
                      </tr>))}</tbody></table>
                  </div>
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wider text-dim">Pays</div>
                    <div className="flex flex-wrap gap-1">{zone.countries.map((c) => <button key={c.iso} onClick={() => selectCountry(c.iso, c.name)} className="border border-line px-1 text-[10px] hover:border-amber">{c.name} <span className="num text-down/80">{c.conflict24}</span> <Ratio r={c.ratio} hot={(c.ratio ?? 0) >= (gd?.anomaly ?? 1.5) && c.conflict24 >= (gd?.anomaly_min ?? 20)} /></button>)}</div>
                  </div>
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wider text-dim">Événements marquants · {hours} h</div>
                    {!zEvents.length && <div className="text-dim">Aucun événement sur la période.</div>}
                    <div className="space-y-1">{zEvents.slice(0, 10).map((m) => (
                      <button key={m.id} onClick={() => selectMarker(m)} className="flex w-full gap-2 text-left hover:text-fg">
                        <span className="mt-1"><Dot c={COLOR[m.cat]} ring={m.critical} /></span>
                        <span className="min-w-0 flex-1"><span className="text-fg">{m.title}</span><span className="block text-[10px] text-dim">{m.kind === "gdelt" ? `GDELT · ${m.articles} articles` : m.source} · {ago(m.time, now)}</span></span>
                      </button>))}</div>
                  </div>
                  <p className="text-[10px] leading-snug text-dim">Actifs choisis pour leur exposition directe à la zone (canal indiqué sous chaque nom) : une variation du jour n&apos;est pas forcément due à l&apos;actualité de la zone.</p>
                </div>
              </> : country && <>
                <header className="flex items-center gap-2 border-b border-line px-2.5 py-1.5" style={{ borderTop: "2px solid #ffa028" }}>
                  <span className="text-[10px] font-bold tracking-wider text-amber">PAYS</span><span className="text-[10px] text-dim">{country.iso}</span>
                  <button onClick={() => setCountry(null)} className="ml-auto text-dim hover:text-fg" aria-label="Fermer">✕</button>
                </header>
                <div className="space-y-2 p-2.5">
                  <div className="text-[14px] text-fg">{cInfo?.name ?? country.name}</div>
                  <div className="grid grid-cols-3 gap-1 text-center">
                    {(["risk", "event", "econ"] as Cat[]).map((c) => <div key={c} className="border border-line py-1"><div className="num text-[15px]" style={{ color: COLOR[c] }}>{(cInfo as any)?.[c] ?? 0}</div><div className="text-[9px] uppercase text-dim">{CAT_SHORT[c]}</div></div>)}
                  </div>
                  {cGd && <div className="border border-line px-2 py-1">
                    <div className="flex items-baseline justify-between"><span className="text-[9px] uppercase text-dim">Conflits recensés · 24 h (GDELT)</span><Ratio r={cGd.ratio} hot={cGd.anomaly} /></div>
                    <div className="flex items-baseline gap-3"><span className="num text-[15px] text-down">{cGd.conflict24}</span>
                      <span className="text-[10px] text-dim">dont {cGd.material24} matériels · normale {cGd.base != null ? num(cGd.base, 0) : "–"}/j · tonalité {num(cGd.tone, 1)}</span></div>
                  </div>}
                  {cZones.map((z) => <div key={z.key} className="space-y-1">
                    <button onClick={() => selectZone(z)} className="text-[10px] uppercase tracking-wider text-amber hover:underline">Actifs exposés · {z.name} →</button>
                    <div className="flex flex-wrap gap-1 text-[10px]">{z.assets.map((a) => <Chip key={a.symbol} a={a} />)}</div>
                  </div>)}
                  {cInfo?.center && <button onClick={() => selectMarker(cInfo.center!)} className="flex w-full justify-between border border-line px-2 py-1 hover:border-amber">
                    <span className="text-dim">{cInfo.center.index}</span><span className="num text-fg">{num(cInfo.center.price, 2)} <span className={tone(cInfo.center.change_pct)}>{pct(cInfo.center.change_pct)}</span></span></button>}
                  {!cEvents.length && <div className="text-dim">Aucun événement géolocalisé sur {hours} h.</div>}
                  <div className="space-y-1">{cEvents.slice(0, 12).map((m) => (
                    <button key={m.id} onClick={() => selectMarker(m)} className="flex w-full gap-2 text-left hover:text-fg">
                      <span className="mt-1"><Dot c={COLOR[m.cat]} ring={m.critical} /></span>
                      <span className="min-w-0 flex-1"><span className="text-fg">{m.title}</span><span className="block text-[10px] text-dim">{m.source} · {ago(m.time, now)}</span></span>
                    </button>))}</div>
                </div>
              </>}
            </div>
          )}
        </main>

        {/* Panneau droit : fil international */}
        <aside className="hidden min-h-0 flex-col border-l border-line bg-[#05080d] lg:flex">
          <header className="flex shrink-0 items-center justify-between border-b border-line px-2 py-1.5">
            <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Fil international</span>
            <span className="text-[10px] text-dim">{news.length}</span>
          </header>
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-2 py-1.5">
            {(["all", "risk", "event", "econ"] as const).map((c) => (
              <button key={c} onClick={() => setNewsCat(c)} className={`border px-1.5 py-px text-[10px] ${newsCat === c ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}>
                {c === "all" ? "TOUT" : CAT_SHORT[c]}
              </button>
            ))}
            {country && <button onClick={() => setCountry(null)} className="border border-amber px-1.5 py-px text-[10px] text-amber">{country.name} ✕</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {news.map((n) => (
              <article key={n.id} onClick={() => n.lat != null && n.cat && selectMarker({ ...(n as any), kind: "news" })}
                className={`group flex cursor-pointer gap-2 border-b border-line/50 px-2 py-1.5 hover:bg-raised ${sel?.id === n.id ? "bg-raised" : ""}`}>
                <span className="mt-0.5 w-0.5 shrink-0 self-stretch" style={{ background: n.cat ? COLOR[n.cat] : "#2a3442" }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-dim">
                    <span className="num w-9 shrink-0">{ago(n.time, now)}</span>
                    {n.critical && <span className="text-[9px] font-bold text-down">CRITIQUE</span>}
                    <span className="truncate">{n.source}</span>
                    {n.sources > 1 && <span className="shrink-0 border border-line px-1 text-[9px] text-fg/80" title={`Repris par : ${n.others.map((o) => o.source).join(", ")}`}>+{n.sources - 1} média{n.sources > 2 ? "s" : ""}</span>}
                    {n.place && <span className="ml-auto shrink-0 truncate text-fg/70">{n.place}</span>}
                  </div>
                  <div className="leading-snug text-fg group-hover:text-white">{n.title}</div>
                </div>
                <a href={n.link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="shrink-0 text-dim opacity-0 hover:text-info group-hover:opacity-100" title="Ouvrir l'article">↗</a>
              </article>
            ))}
            {d && !news.length && <div className="p-2 text-dim">Aucune actualité pour ce filtre.</div>}
          </div>
          <div className="shrink-0 border-t border-line px-2 py-1 text-[9px] leading-snug text-dim">
            Fil : lieu déduit des pays et villes cités dans le titre, catégorie déduite de mots-clés, articles sur un même sujet regroupés.
            GDELT : événements extraits automatiquement des médias mondiaux (doublons et erreurs de lieu possibles) ; « ×2 » = deux fois plus présent que d&apos;habitude.
            Corridors énergie et commerce : référence structurelle, sans volume.
          </div>
        </aside>
      </div>
    </div>
  );
}
