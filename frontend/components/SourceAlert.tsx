"use client";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { ago, down, impact, type SourcesResp } from "@/lib/sources";
import { useLocal } from "@/lib/store";

/**
 * Bandeau affiché sur tous les modules quand une source est en panne durable (plusieurs échecs d'affilée).
 * Rouge si une source majeure est touchée, orange si ce ne sont que des sources secondaires (un flux RSS…).
 * « Masquer » vaut pour l'ensemble de sources en panne du moment : une nouvelle panne le fait réapparaître.
 */
export default function SourceAlert() {
  const { data } = useSWR<SourcesResp>("/api/status/sources", fetcher, { refreshInterval: 60_000 });
  const [dismissed, setDismissed] = useLocal<string>("mt.src.dismissed", "");
  if (!data) return null;
  const rows = data.sources.filter((r) => down(r, data.now)).map((r) => ({ ...r, ...impact(r.source) }));
  if (!rows.length) return null;
  const key = rows.map((r) => r.source).sort().join("|");
  if (dismissed === key) return null;
  const major = rows.filter((r) => !r.minor), minor = rows.filter((r) => r.minor);
  const tone = major.length ? "border-down/70 bg-down/10 text-down" : "border-amber/60 bg-amber/10 text-amber";
  return (
    <div role="alert" className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-2 py-1 text-[11px] ${tone}`}>
      <span className="font-bold">⚠ {rows.length} source{rows.length > 1 ? "s" : ""} en panne</span>
      {major.map((r) => (
        <span key={r.source} className="text-fg" title={r.last_error ?? undefined}>
          <span className="text-down">{r.source}</span> · {r.streak} échecs d&apos;affilée{r.down_since ? ` depuis ${ago(r.down_since, data.now).replace("il y a ", "")}` : ""}
          <span className="text-dim"> → {r.modules}</span>
        </span>
      ))}
      {minor.length > 0 && <span className="text-dim" title={minor.map((r) => `${r.source} : ${r.modules}`).join("\n")}>
        {major.length ? "+ " : ""}{minor.length} source{minor.length > 1 ? "s" : ""} secondaire{minor.length > 1 ? "s" : ""} ({minor.map((r) => r.source).join(", ")})</span>}
      <span className="ml-auto flex gap-3">
        <Link href="/src" className="text-info hover:underline">détails (SRC) →</Link>
        <button onClick={() => setDismissed(key)} className="text-dim hover:text-fg" title="Masquer jusqu'à ce qu'une autre source tombe en panne">masquer</button>
      </span>
    </div>
  );
}
