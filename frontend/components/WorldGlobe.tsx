"use client";
/**
 * Globe de WORLD MONITOR (react-globe.gl / Three.js), chargé côté navigateur uniquement.
 *
 * Rendu : texture équirectangulaire générée à partir des contours Natural Earth (océans noirs, terres anthracite,
 * relief issu de la carte topographique, graticule discret), carte de relief en bump map, frontières en polygones
 * sélectionnables, atmosphère discrète. Aucune ressource externe : tout est servi depuis /public/world.
 * Performances : densité de pixels plafonnée, rendu suspendu quand l'onglet est masqué, polygones 1:110 m.
 */
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { Color, DirectionalLight, MeshPhongMaterial } from "three";

export type Cat = "risk" | "econ" | "event" | "center";
export type ArcCat = "finance" | "energy" | "trade";
export type Marker = {
  id: string; cat: Cat; kind: string; title: string; critical: boolean; iso: string | null; country: string | null; place: string | null;
  lat: number; lon: number; time?: string | number | null; source?: string; summary?: string; link?: string; symbol?: string; index?: string;
  price?: number | null; change_pct?: number | null; impact?: string; forecast?: string; previous?: string;
};
export type Arc = { cat: ArcCat; label: string; weight: number; corr?: number; n?: number; from: { lat: number; lon: number; name?: string }; to: { lat: number; lon: number; name?: string } };
export type Feature = { type: "Feature"; properties: { ADM0_A3: string; ADMIN: string; NAME: string; CONTINENT: string }; geometry: any };
export type GlobeHandle = { focus: (lat: number, lon: number, altitude?: number) => void; zoom: (factor: number) => void; reset: () => void };

export const CAT_COLOR: Record<Cat, string> = { risk: "#ff4d4d", econ: "#4aa8ff", event: "#ffa028", center: "#ece8df" };
export const ARC_COLOR: Record<ArcCat, string> = { finance: "#ece8df", energy: "#ffa028", trade: "#4aa8ff" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const TIP = "font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:11px;line-height:1.35;background:#05080dee;border:1px solid #2a3442;padding:6px 8px;max-width:320px;color:#d4dbe6";

/** Texture équirectangulaire : océan noir, graticule, terres anthracite éclairées par la topographie. */
async function buildTexture(features: Feature[]): Promise<string> {
  const W = 4096, H = 2048;
  const px = (lon: number) => ((lon + 180) / 360) * W, py = (lat: number) => ((90 - lat) / 180) * H;
  const land = document.createElement("canvas"); land.width = W; land.height = H;
  const l = land.getContext("2d")!;
  l.fillStyle = "#353b44";
  for (const f of features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      l.beginPath();
      for (const ring of poly) {
        ring.forEach(([lon, lat]: number[], i: number) => (i ? l.lineTo(px(lon), py(lat)) : l.moveTo(px(lon), py(lat))));
        l.closePath();
      }
      l.fill("evenodd");
    }
  }
  // relief : la topographie éclaircit les reliefs, uniquement sur les terres
  const topo = new Image();
  topo.src = "/world/topology.png";
  await topo.decode().catch(() => undefined);
  if (topo.complete && topo.naturalWidth) {
    l.globalCompositeOperation = "source-atop";
    l.globalAlpha = 0.28;
    l.drawImage(topo, 0, 0, W, H);
    l.globalAlpha = 1;
  }
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const o = out.getContext("2d")!;
  o.fillStyle = "#020304"; o.fillRect(0, 0, W, H);
  o.strokeStyle = "rgba(120,140,170,0.07)"; o.lineWidth = 1.2;
  for (let lon = -180; lon <= 180; lon += 15) { o.beginPath(); o.moveTo(px(lon), 0); o.lineTo(px(lon), H); o.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { o.beginPath(); o.moveTo(0, py(lat)); o.lineTo(W, py(lat)); o.stroke(); }
  o.drawImage(land, 0, 0);
  return out.toDataURL("image/jpeg", 0.9);
}

/** Décale les marqueurs superposés (même lieu) en spirale, de façon déterministe. */
function spread(markers: Marker[]): (Marker & { plat: number; plon: number })[] {
  const groups = new Map<string, number>();
  return markers.map((m) => {
    const key = `${m.lat.toFixed(2)},${m.lon.toFixed(2)}`;
    const i = groups.get(key) ?? 0;
    groups.set(key, i + 1);
    if (!i) return { ...m, plat: m.lat, plon: m.lon };
    const r = 0.55 * Math.sqrt(i), a = i * 2.39996;
    return { ...m, plat: m.lat + r * Math.sin(a), plon: m.lon + (r * Math.cos(a)) / Math.max(0.3, Math.cos((m.lat * Math.PI) / 180)) };
  });
}

type Props = {
  width: number; height: number; features: Feature[]; markers: Marker[]; arcs: Arc[];
  selectedIso: string | null; selectedId: string | null; riskByIso: Record<string, number>; rotate: boolean;
  onMarker: (m: Marker) => void; onCountry: (iso: string, name: string) => void; onHover?: (text: string | null) => void;
  /** poignée de commande (centrer, zoomer) : objet ref passé en propriété, compatible avec next/dynamic */
  api: React.RefObject<GlobeHandle | null>;
};

export default function WorldGlobe(p: Props) {
  const g = useRef<any>(null);
  const [texture, setTexture] = useState<string | null>(null);
  const [hoverIso, setHoverIso] = useState<string | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotate = useRef(p.rotate); rotate.current = p.rotate;

  useEffect(() => { if (p.features.length) buildTexture(p.features).then(setTexture); }, [p.features]);

  const material = useMemo(() => new MeshPhongMaterial({ bumpScale: 4, shininess: 6, specular: new Color("#1a1f26"), emissive: new Color("#000000") }), []);

  useImperativeHandle(p.api, () => ({
    focus: (lat, lon, altitude = 1.55) => g.current?.pointOfView({ lat, lng: lon, altitude }, 1200),
    zoom: (factor) => { const pov = g.current?.pointOfView(); if (pov) g.current.pointOfView({ ...pov, altitude: Math.min(4.5, Math.max(0.35, pov.altitude * factor)) }, 400); },
    reset: () => g.current?.pointOfView({ lat: 22, lng: 10, altitude: 1.95 }, 1200),
  }), []);

  // Réglages une fois le globe prêt : caméra, rotation lente, lumière, densité de pixels, pause en arrière-plan
  // Appelé au montage (dès que l'instance existe) et à onGlobeReady : ne s'applique qu'une fois.
  const setup = useRef(false);
  const ready = () => {
    const G = g.current;
    if (!G || setup.current) return;
    setup.current = true;
    G.pointOfView({ lat: 22, lng: 10, altitude: 1.95 }, 0);
    G.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    const c = G.controls();
    c.autoRotate = rotate.current; c.autoRotateSpeed = 0.28; c.enableDamping = true; c.dampingFactor = 0.08;
    c.minDistance = 130; c.maxDistance = 650; c.zoomSpeed = 0.8; c.rotateSpeed = 0.55;
    c.addEventListener("start", () => { c.autoRotate = false; if (idle.current) clearTimeout(idle.current); });
    c.addEventListener("end", () => { if (idle.current) clearTimeout(idle.current); idle.current = setTimeout(() => { c.autoRotate = rotate.current; }, 9000); });
    // éclairage : lumière principale attachée à la caméra (la face visible reste éclairée pendant la rotation),
    // venant du haut à gauche pour faire ressortir le relief ; lumière ambiante faible pour garder le volume
    const scene = G.scene(), cam = G.camera();
    (G.lights?.() as any[] | undefined)?.forEach((li: any) => {
      if (li.isAmbientLight) li.intensity = 2.3; // défaut globe.gl : π
      if (li.isDirectionalLight) li.intensity = 0;
    });
    if (!cam.userData.wmLight) {
      const key = new DirectionalLight(0xf2efe8, 1.5);
      key.position.set(-180, 140, 260);
      const fill = new DirectionalLight(0x8fa3bf, 0.4);
      fill.position.set(300, -120, 60);
      cam.add(key, fill);
      cam.userData.wmLight = true;
      if (!cam.parent) scene.add(cam);
    }
  };
  useEffect(() => {
    let raf = 0;
    const tryReady = () => { if (g.current?.controls) ready(); else raf = requestAnimationFrame(tryReady); };
    tryReady();
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const c = g.current?.controls?.(); if (c) c.autoRotate = p.rotate; }, [p.rotate]);
  useEffect(() => {
    const vis = () => (document.hidden ? g.current?.pauseAnimation() : g.current?.resumeAnimation());
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); if (idle.current) clearTimeout(idle.current); };
  }, []);

  const pts = useMemo(() => spread(p.markers), [p.markers]);
  const rings = useMemo(() => pts.filter((m) => (m.cat === "risk" && m.critical) || m.id === p.selectedId), [pts, p.selectedId]);
  const labels = useMemo(() => pts.filter((m) => m.cat === "center"), [pts]);
  const polygons = useMemo(() => p.features.filter((f) => f.properties.ADM0_A3 !== "ATA"), [p.features]);

  const capColor = (f: any) => {
    const iso = f.properties.ADM0_A3;
    if (iso === p.selectedIso) return "rgba(255,160,40,0.22)";
    if (iso === hoverIso) return "rgba(236,232,223,0.10)";
    const r = p.riskByIso[iso] ?? 0;
    return r ? `rgba(255,77,77,${Math.min(0.05 + r * 0.025, 0.16)})` : "rgba(0,0,0,0)";
  };

  return (
    <Globe
      ref={g}
      width={p.width}
      height={p.height}
      backgroundColor="rgba(0,0,0,0)"
      rendererConfig={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      globeImageUrl={texture ?? undefined}
      bumpImageUrl="/world/topology.png"
      globeMaterial={material}
      showAtmosphere
      atmosphereColor="#7f93ad"
      atmosphereAltitude={0.11}
      showGraticules={false}
      onGlobeReady={ready}
      animateIn={false}
      // Frontières et pays
      polygonsData={polygons}
      polygonGeoJsonGeometry="geometry"
      polygonCapColor={capColor}
      polygonSideColor={() => "rgba(0,0,0,0)"}
      polygonStrokeColor={(f: any) => (f.properties.ADM0_A3 === p.selectedIso ? "#ffa028" : "rgba(150,160,175,0.42)")}
      polygonAltitude={(f: any) => (f.properties.ADM0_A3 === p.selectedIso ? 0.012 : 0.004)}
      polygonsTransitionDuration={250}
      polygonLabel={(f: any) => {
        const r = p.riskByIso[f.properties.ADM0_A3];
        return `<div style="${TIP}"><b>${esc(f.properties.ADMIN)}</b>${r ? `<br/><span style="color:#ff4d4d">${r} risque${r > 1 ? "s" : ""} signalé${r > 1 ? "s" : ""}</span>` : ""}<br/><span style="color:#7486a0">clic : fiche pays</span></div>`;
      }}
      onPolygonHover={(f: any) => { setHoverIso(f ? f.properties.ADM0_A3 : null); p.onHover?.(f ? f.properties.ADMIN : null); }}
      onPolygonClick={(f: any) => p.onCountry(f.properties.ADM0_A3, f.properties.ADMIN)}
      // Marqueurs
      pointsData={pts}
      pointLat="plat"
      pointLng="plon"
      pointColor={(m: any) => CAT_COLOR[m.cat as Cat]}
      pointAltitude={(m: any) => (m.id === p.selectedId ? 0.06 : m.cat === "center" ? 0.012 : m.critical ? 0.035 : 0.018)}
      pointRadius={(m: any) => (m.cat === "center" ? 0.32 : m.critical ? 0.3 : 0.22)}
      pointResolution={8}
      pointsMerge={false}
      pointsTransitionDuration={300}
      pointLabel={(m: any) => `<div style="${TIP}"><span style="color:${CAT_COLOR[m.cat as Cat]}">■</span> <span style="color:#7486a0">${esc(m.place)}${m.country && m.country !== m.place ? ` · ${esc(m.country)}` : ""}</span><br/><b>${esc(m.title)}</b>${m.change_pct != null ? `<br/>${esc(m.index ?? "")} <span style="color:${m.change_pct >= 0 ? "#1fd15f" : "#ff4d4d"}">${m.change_pct >= 0 ? "+" : ""}${m.change_pct.toFixed(2)} %</span>` : ""}</div>`}
      onPointClick={(m: any) => p.onMarker(m)}
      // Impulsions : risques critiques et marqueur sélectionné
      ringsData={rings}
      ringLat="plat"
      ringLng="plon"
      ringColor={(m: any) => (t: number) => (m.id === p.selectedId ? `rgba(255,160,40,${1 - t})` : `rgba(255,77,77,${0.9 * (1 - t)})`)}
      ringMaxRadius={(m: any) => (m.id === p.selectedId ? 4 : 2.6)}
      ringPropagationSpeed={1.6}
      ringRepeatPeriod={1400}
      // Codes des places financières
      labelsData={labels}
      labelLat="plat"
      labelLng="plon"
      labelText={(m: any) => (m.id as string).slice(4)}
      labelSize={0.42}
      labelDotRadius={0}
      labelColor={() => "rgba(236,232,223,0.72)"}
      labelAltitude={0.014}
      labelResolution={2}
      labelLabel={(m: any) => `<div style="${TIP}"><b>${esc(m.title)}</b><br/>${esc(m.index)}${m.change_pct != null ? ` <span style="color:${m.change_pct >= 0 ? "#1fd15f" : "#ff4d4d"}">${m.change_pct >= 0 ? "+" : ""}${m.change_pct.toFixed(2)} %</span>` : ""}</div>`}
      onLabelClick={(m: any) => p.onMarker(m)}
      // Flux
      arcsData={p.arcs}
      arcStartLat={(a: any) => a.from.lat}
      arcStartLng={(a: any) => a.from.lon}
      arcEndLat={(a: any) => a.to.lat}
      arcEndLng={(a: any) => a.to.lon}
      arcColor={(a: any) => {
        const c = ARC_COLOR[a.cat as ArcCat];
        const alpha = a.cat === "finance" ? Math.max(0.25, (a.corr ?? 0.6) - 0.15) : 0.55;
        const hex = Math.round(alpha * 255).toString(16).padStart(2, "0");
        return [`${c}${hex}`, `${c}22`, `${c}${hex}`];
      }}
      arcStroke={(a: any) => (a.cat === "finance" ? 0.18 + 0.35 * Math.max(0, (a.corr ?? 0.6) - 0.5) : 0.32)}
      arcAltitudeAutoScale={0.38}
      arcDashLength={0.42}
      arcDashGap={0.5}
      arcDashInitialGap={(a: any) => (a.label.length % 10) / 10}
      arcDashAnimateTime={(a: any) => (a.cat === "finance" ? 5200 : a.cat === "energy" ? 7000 : 8500)}
      arcsTransitionDuration={0}
      arcLabel={(a: any) => `<div style="${TIP}"><span style="color:${ARC_COLOR[a.cat as ArcCat]}">━</span> <b>${esc(a.label)}</b>${a.corr != null ? `<br/>corrélation 60 séances : ${a.corr.toFixed(2)} (${a.n} obs.)` : `<br/><span style="color:#7486a0">corridor de référence, sans volume mesuré</span>`}</div>`}
    />
  );
}
