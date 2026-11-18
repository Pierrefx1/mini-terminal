"use client";
import type { Envelope, ApiError, DataStatus } from "@/lib/api";
import { dateTime } from "@/lib/format";

export function Panel({ title, right, children, className = "" }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-h-0 flex-col border border-line bg-panel ${className}`}>
      {(title || right) && (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-raised px-2 py-1">
          <span className="text-[11px] uppercase tracking-wider text-amber">{title}</span>
          <span className="flex items-center gap-2 text-[10px] text-dim">{right}</span>
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

const STATUS: Record<DataStatus, [string, string]> = {
  LIVE: ["border-up text-up", "Temps réel"],
  DELAYED: ["border-amber text-amber", "Cours différés : délai variable selon la place et la source"],
  HISTORICAL: ["border-info text-info", "Données historiques ou de fin de période, pas un cours de marché"],
  SIMULATED: ["border-sim text-sim", "Données simulées, jamais des cours réels"],
};

export function StatusBadge({ status }: { status?: DataStatus | null }) {
  if (!status) return null;
  const [cls, title] = STATUS[status];
  return <span className={`mr-1 border px-1 text-[9px] leading-[12px] ${cls}`} title={title}>{status}</span>;
}

/** Source + nature (LIVE, DELAYED…) + horodatage de la donnée, avec signalement d'une donnée périmée. */
export function SourceTag({ env }: { env?: Envelope<unknown> }) {
  if (!env) return null;
  return (
    <span className="text-[10px] text-dim" title={env.error ?? undefined}>
      {env.stale && <span className="mr-1 bg-down px-1 text-black">PÉRIMÉ</span>}
      <StatusBadge status={env.status} />
      {env.source}{env.fetched_at ? ` · ${dateTime(env.fetched_at)}` : ""}
    </span>
  );
}

export function State({ loading, error, empty }: { loading?: boolean; error?: ApiError | Error | null; empty?: string | false }) {
  if (error) return (
    <div className="m-2 border border-down/60 p-2 text-down">
      <div className="text-[10px] uppercase">Erreur{(error as ApiError).source ? ` · ${(error as ApiError).source}` : ""}</div>
      <div className="whitespace-pre-wrap break-words">{error.message}</div>
    </div>
  );
  if (loading) return <div className="p-2 text-dim">Chargement…</div>;
  if (empty) return <div className="p-2 text-dim">{empty}</div>;
  return null;
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly (T | [T, string])[]; onChange: (v: T) => void }) {
  return (
    <span className="inline-flex border border-line">
      {options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, o];
        return (
          <button key={v} onClick={() => onChange(v)} className={`px-2 py-0.5 ${v === value ? "bg-amber text-black" : "text-dim hover:text-fg"}`}>{label}</button>
        );
      })}
    </span>
  );
}

/** Mini-courbe SVG : vert si la série finit au-dessus de son premier point, rouge sinon. */
export function Spark({ values, width = 90, height = 18, fluid = false }: { values?: number[]; width?: number; height?: number; fluid?: boolean }) {
  if (!values || values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - lo) / span) * (height - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg {...(fluid ? { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", className: "block h-full w-full" } : { width, height, className: "inline-block align-middle" })} aria-hidden>
      <polyline points={pts} fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke" className={values.at(-1)! >= values[0] ? "stroke-up" : "stroke-down"} />
    </svg>
  );
}

/** Position du dernier cours dans la fourchette plus bas / plus haut (0 à 100). */
export function RangeBar({ pos, width = 70 }: { pos?: number | null; width?: number }) {
  if (pos == null) return <span className="text-dim">–</span>;
  return (
    <span className="relative inline-block h-1.5 bg-line align-middle" style={{ width }} title={`${Math.round(pos)} % de la fourchette`}>
      <span className="absolute top-[-2px] h-2.5 w-0.5 bg-amber" style={{ left: `calc(${Math.min(100, Math.max(0, pos))}% - 1px)` }} />
    </span>
  );
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <button onClick={() => onChange(!on)} className={`border px-2 py-0.5 ${on ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}>{children}</button>;
}
