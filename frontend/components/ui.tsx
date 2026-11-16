"use client";
import type { Envelope, ApiError } from "@/lib/api";
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

/** Source + horodatage de la donnée, avec signalement d'une donnée périmée. */
export function SourceTag({ env }: { env?: Envelope<unknown> }) {
  if (!env) return null;
  return (
    <span className="text-[10px] text-dim" title={env.error ?? undefined}>
      {env.stale && <span className="mr-1 bg-down px-1 text-black">PÉRIMÉ</span>}
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

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <button onClick={() => onChange(!on)} className={`border px-2 py-0.5 ${on ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}>{children}</button>;
}
