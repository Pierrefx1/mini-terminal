"use client";
import useSWR from "swr";
import { Panel, State } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { dateTime, num } from "@/lib/format";

type Row = { source: string; last_ok: string | null; last_error_at: string | null; last_error: string | null; ok_count: number; err_count: number; last_ms: number | null };
type Resp = { sources: Row[]; now: string };

/** Dernier appel en échec (erreur plus récente que le dernier succès) -> la source est considérée en panne. */
const failing = (r: Row) => !!r.last_error_at && (!r.last_ok || r.last_error_at > r.last_ok);

function ago(iso: string | null, now: string) {
  if (!iso) return "jamais";
  const s = Math.max(0, (Date.parse(now) - Date.parse(iso)) / 1000);
  return s < 90 ? `il y a ${Math.round(s)} s` : s < 5400 ? `il y a ${Math.round(s / 60)} min` : s < 172800 ? `il y a ${Math.round(s / 3600)} h` : `il y a ${Math.round(s / 86400)} j`;
}

export default function SRC() {
  const { data, error, isLoading } = useSWR<Resp>("/api/status/sources", fetcher, { refreshInterval: 30_000, revalidateOnFocus: true });
  const rows = data ? [...data.sources].sort((a, b) => Number(failing(b)) - Number(failing(a)) || a.source.localeCompare(b.source)) : [];
  const down = rows.filter(failing).length;
  return (
    <div className="grid h-full auto-rows-max grid-cols-12 content-start gap-1 overflow-auto">
      <Panel className="col-span-12" title={<span className="normal-case tracking-normal">SRC · état des sources de données</span>}
        right={data && <span className={down ? "text-down" : "text-up"}>{down ? `${down} source${down > 1 ? "s" : ""} en échec` : "toutes les sources répondent"} · {rows.length} suivies</span>}>
        <State loading={isLoading && !data} error={error} empty={data && !rows.length && "Aucun appel enregistré pour l'instant : ouvrir quelques modules."} />
        {rows.length > 0 && <table>
          <thead><tr><th>État</th><th>Source</th><th>Dernier succès</th><th>Dernier échec</th><th className="num">Succès</th><th className="num">Échecs</th><th className="num">Taux d&apos;échec</th><th className="num">Durée</th><th>Dernière erreur</th></tr></thead>
          <tbody>{rows.map((r) => {
            const ko = failing(r);
            const rate = r.ok_count + r.err_count ? (r.err_count / (r.ok_count + r.err_count)) * 100 : 0;
            return <tr key={r.source}>
              <td><span className={`border px-1 text-[9px] ${ko ? "border-down text-down" : "border-up text-up"}`}>{ko ? "ÉCHEC" : "OK"}</span></td>
              <td className="text-fg">{r.source}</td>
              <td title={r.last_ok ? dateTime(r.last_ok) : undefined}>{ago(r.last_ok, data!.now)}</td>
              <td title={r.last_error_at ? dateTime(r.last_error_at) : undefined} className={ko ? "text-down" : "text-dim"}>{r.last_error_at ? ago(r.last_error_at, data!.now) : "–"}</td>
              <td className="num">{r.ok_count}</td><td className="num">{r.err_count}</td>
              <td className={`num ${rate > 20 ? "text-down" : rate > 5 ? "text-amber" : ""}`}>{num(rate, 0)} %</td>
              <td className="num">{r.last_ms == null ? "–" : r.last_ms >= 1000 ? `${num(r.last_ms / 1000, 1)} s` : `${r.last_ms} ms`}</td>
              <td className="max-w-[40ch] truncate text-dim" title={r.last_error ?? undefined}>{ko ? r.last_error : ""}</td>
            </tr>;
          })}</tbody>
        </table>}
        <div className="px-2 py-1 text-[10px] text-dim">
          Chaque appel réel à une source (hors lecture du cache) est compté. ÉCHEC : le dernier appel a échoué ; les modules affichent alors la dernière valeur connue marquée PÉRIMÉ.
          Une réponse explicite de la source (ticker sans options, clé manquante) compte comme un succès. Rafraîchi toutes les 30 s.
        </div>
      </Panel>
    </div>
  );
}
