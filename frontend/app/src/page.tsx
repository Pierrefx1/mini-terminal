"use client";
import useSWR from "swr";
import { Panel, State } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { dateTime, num } from "@/lib/format";
import { ago, DOWN_STREAK, down, failing, impact, type SourcesResp as Resp } from "@/lib/sources";

export default function SRC() {
  const { data, error, isLoading } = useSWR<Resp>("/api/status/sources", fetcher, { refreshInterval: 30_000, revalidateOnFocus: true });
  const rows = data ? [...data.sources].sort((a, b) => Number(down(b, data.now)) - Number(down(a, data.now)) || Number(failing(b)) - Number(failing(a)) || a.source.localeCompare(b.source)) : [];
  const nDown = data ? rows.filter((r) => down(r, data.now)).length : 0, nKo = rows.filter(failing).length;
  return (
    <div className="grid h-full auto-rows-max grid-cols-12 content-start gap-1 overflow-auto">
      <Panel className="col-span-12" title={<span className="normal-case tracking-normal">SRC · état des sources de données</span>}
        right={data && <span className={nDown ? "text-down" : nKo ? "text-amber" : "text-up"}>{nDown ? `${nDown} en panne · ` : ""}{nKo ? `${nKo} source${nKo > 1 ? "s" : ""} en échec` : "toutes les sources répondent"} · {rows.length} suivies</span>}>
        <State loading={isLoading && !data} error={error} empty={data && !rows.length && "Aucun appel enregistré pour l'instant : ouvrir quelques modules."} />
        {rows.length > 0 && <table>
          <thead><tr><th>État</th><th>Source</th><th>Dernier succès</th><th>Dernier échec</th><th className="num">Succès</th><th className="num">Échecs</th><th className="num">Taux d&apos;échec</th><th className="num">Durée</th><th>Modules touchés</th><th>Dernière erreur</th></tr></thead>
          <tbody>{rows.map((r) => {
            const ko = failing(r), dn = down(r, data!.now);
            const rate = r.ok_count + r.err_count ? (r.err_count / (r.ok_count + r.err_count)) * 100 : 0;
            return <tr key={r.source}>
              <td><span className={`border px-1 text-[9px] ${dn ? "border-down bg-down text-black" : ko ? "border-down text-down" : "border-up text-up"}`}
                title={dn ? `${r.streak} échecs d'affilée${r.down_since ? ` depuis le ${dateTime(r.down_since)}` : ""}` : undefined}>{dn ? `PANNE ×${r.streak}` : ko ? "ÉCHEC" : "OK"}</span></td>
              <td className="text-fg">{r.source}</td>
              <td title={r.last_ok ? dateTime(r.last_ok) : undefined}>{ago(r.last_ok, data!.now)}</td>
              <td title={r.last_error_at ? dateTime(r.last_error_at) : undefined} className={ko ? "text-down" : "text-dim"}>{r.last_error_at ? ago(r.last_error_at, data!.now) : "–"}</td>
              <td className="num">{r.ok_count}</td><td className="num">{r.err_count}</td>
              <td className={`num ${rate > 20 ? "text-down" : rate > 5 ? "text-amber" : ""}`}>{num(rate, 0)} %</td>
              <td className="num">{r.last_ms == null ? "–" : r.last_ms >= 1000 ? `${num(r.last_ms / 1000, 1)} s` : `${r.last_ms} ms`}</td>
              <td className={`max-w-[34ch] truncate ${ko ? "text-fg/80" : "text-dim"}`} title={impact(r.source).modules}>{impact(r.source).modules}</td>
              <td className="max-w-[40ch] truncate text-dim" title={r.last_error ?? undefined}>{ko ? r.last_error : ""}</td>
            </tr>;
          })}</tbody>
        </table>}
        <div className="px-2 py-1 text-[10px] text-dim">
          Chaque appel réel à une source (hors lecture du cache) est compté. ÉCHEC : le dernier appel a échoué ; les modules affichent alors la dernière valeur connue marquée PÉRIMÉ.
          PANNE : au moins {DOWN_STREAK} échecs d&apos;affilée, le dernier datant de moins de 24 h ; un bandeau le signale alors sur tous les modules.
          Une réponse explicite de la source (ticker sans options, clé manquante) compte comme un succès. Rafraîchi toutes les 30 s.
        </div>
      </Panel>
    </div>
  );
}
