"use client";
import { useMemo, useState } from "react";
import EChart, { lineOption, PALETTE } from "@/components/EChart";
import { Panel, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateOnly, num } from "@/lib/format";

type ORow = { code: string; label: string; unit: string; obs: [number, number][]; last_actual: [number, number] | null; forecasts: [number, number][] };
type Outlook = { area: string; areas: { code: string; name: string }[]; first_forecast_year: number; rows: ORow[] };
type Rates = { path: { contract: string; month: string; price: number; implied: number }[]; current: { rate: number; date: string } | null };
type Sep = { id: string; label: string; obs: [string, number][]; last_updated: string }[];
type Ev = { id: string; title: string; country: string; time: string; impact: string; forecast: string; previous: string };
const ZONES: Record<string, string> = { USD: "États-Unis", EUR: "Zone euro", GBP: "Royaume-Uni", JPY: "Japon", CNY: "Chine", CAD: "Canada", AUD: "Australie", NZD: "Nlle-Zélande", CHF: "Suisse" };
const dt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function Forecasts() {
  const [area, setArea] = useState("FRA");
  const [sel, setSel] = useState("GDPV_ANNPCT");
  const out = useApi<Outlook>(`/api/forecasts/outlook?area=${area}`);
  const rates = useApi<Rates>("/api/forecasts/rates", 30 * 60_000);
  const fed = useApi<Sep>("/api/forecasts/fed");
  const cal = useApi<{ events: Ev[] }>("/api/calendar", 10 * 60_000);
  const row = out.data?.rows.find((r) => r.code === sel) ?? out.data?.rows[0];
  const y0 = out.data?.first_forecast_year ?? 0;

  const chart = useMemo(() => {
    if (!row) return null;
    const actual = row.obs.filter((o) => o[0] < y0), fc = row.obs.filter((o) => o[0] >= y0 - 1);
    return lineOption([{ name: "Réalisé", data: actual.map((o) => [String(o[0]), o[1]] as [string, number]) }, { name: "Prévision OCDE", data: fc.map((o) => [String(o[0]), o[1]] as [string, number]), dashed: true, color: PALETTE[1] }], { unit: row.unit === "%" ? " %" : "" });
  }, [row, y0]);
  const path = useMemo(() => rates.data && lineOption([{ name: "Taux Fed funds moyen anticipé", data: rates.data.path.map((p) => [p.month, p.implied] as [string, number]) },
    ...(rates.data.current ? [{ name: `Taux actuel (${num(rates.data.current.rate, 3)} %)`, data: rates.data.path.map((p) => [p.month, rates.data!.current!.rate] as [string, number]), dashed: true, color: "#7a7a7a" }] : [])],
    { category: rates.data.path.map((p) => p.month), unit: " %", decimals: 3 }), [rates.data]);
  const upcoming = useMemo(() => (cal.data?.events ?? []).filter((e) => new Date(e.time).getTime() > Date.now() && e.forecast && e.impact !== "Low"), [cal.data]);

  return (
    <div className="grid h-full grid-cols-12 grid-rows-2 gap-1">
      <Panel className="col-span-7" title={`Prévisions OCDE · ${out.data?.area ?? ""}`} right={<>
        <select value={area} onChange={(e) => setArea(e.target.value)}>{(out.data?.areas ?? [{ code: area, name: area }]).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</select><SourceTag env={out.env} /></>}>
        <State loading={out.loading && !out.data} error={out.error} />
        {out.data && (<>
          <table>
            <thead><tr><th>Indicateur</th><th>Unité</th><th className="num">Dernier réel</th>{row?.forecasts.map((f) => <th key={f[0]} className="num">{f[0]} prévu</th>)}<th className="num">Écart au réel</th></tr></thead>
            <tbody>{out.data.rows.map((r) => {
              const d = r.last_actual && r.forecasts.length ? r.forecasts.at(-1)![1] - r.last_actual[1] : null;
              return (
                <tr key={r.code} onClick={() => setSel(r.code)} className={`cursor-pointer ${row?.code === r.code ? "bg-raised" : ""}`}>
                  <td className={row?.code === r.code ? "text-amber" : ""}>{r.label}</td><td className="text-dim">{r.unit}</td>
                  <td className="num">{r.last_actual ? `${num(r.last_actual[1], 2)} (${r.last_actual[0]})` : "–"}</td>
                  {r.forecasts.map((f) => <td key={f[0]} className="num text-info">{num(f[1], 2)}</td>)}
                  <td className={`num ${d == null ? "" : d > 0 ? "text-up" : "text-down"}`}>{d == null ? "–" : (d > 0 ? "+" : "") + num(d, 2)}</td>
                </tr>);
            })}</tbody>
          </table>
          <div className="p-2 text-[10px] leading-snug text-dim">Source : Perspectives économiques de l'OCDE, dernière édition en ligne (relevée le {out.env?.fetched_at && dateOnly(out.env.fetched_at)}) ; l'API ne donne pas la date de publication de l'édition.
            Les années à partir de {y0} sont des prévisions, y compris l'année en cours. « Écart au réel » : dernière année prévue moins dernière année réalisée. Prévisions du FMI : accès automatisé refusé par le site, non intégrées.</div>
        </>)}
      </Panel>
      <Panel className="col-span-5" title={row ? `${row.label} · réalisé et prévu` : "Historique"}>{chart && <EChart option={chart} />}</Panel>
      <Panel className="col-span-4" title="Taux Fed anticipé par le marché" right={<SourceTag env={rates.env} />}>
        <div className="flex h-full flex-col">
          <State loading={rates.loading && !rates.data} error={rates.error} />
          <div className="min-h-0 flex-1">{path && <EChart option={path} />}</div>
          <div className="shrink-0 p-2 text-[10px] leading-snug text-dim">Taux moyen du mois = 100 − cours du contrat à terme Fed funds 30 jours. C'est une anticipation de marché (prime de risque incluse), pas une prévision officielle.</div>
        </div>
      </Panel>
      <Panel className="col-span-3" title="Projections de la Fed (SEP)" right={<SourceTag env={fed.env} />}>
        <State loading={fed.loading && !fed.data} error={fed.error} />
        {fed.data && (
          <table>
            <thead><tr><th>Médiane des membres</th>{fed.data[0].obs.slice(-4).map((o) => <th key={o[0]} className="num">{o[0].slice(0, 4)}</th>)}</tr></thead>
            <tbody>{fed.data.map((s) => <tr key={s.id}><td className="max-w-0 truncate" title={s.label}>{s.label.replace(" (médiane)", "")}</td>{s.obs.slice(-4).map((o) => <td key={o[0]} className="num text-info">{num(o[1], 2)}</td>)}</tr>)}</tbody>
          </table>)}
        <div className="p-2 text-[10px] text-dim">Médianes uniquement : le détail point par point du « dot plot » n'est pas diffusé par FRED.</div>
      </Panel>
      <Panel className="col-span-5" title="Consensus des prochaines publications" right={<><span>importance moyenne ou forte · heures de Paris</span><SourceTag env={cal.env} /></>}>
        <State loading={cal.loading && !cal.data} error={cal.error} empty={cal.data && upcoming.length === 0 && "Plus de publication avec consensus cette semaine."} />
        <table>
          <thead><tr><th>Date</th><th>Zone</th><th>Publication</th><th className="num">Consensus</th><th className="num">Précédent</th></tr></thead>
          <tbody>{upcoming.map((e) => (
            <tr key={e.id}><td className="capitalize">{dt.format(new Date(e.time))}</td><td>{ZONES[e.country] ?? e.country}</td>
              <td>{e.impact === "High" && <span className="mr-1 inline-block h-2 w-2 bg-down" />}{e.title}</td><td className="num text-info">{e.forecast}</td><td className="num">{e.previous || "–"}</td></tr>))}</tbody>
        </table>
      </Panel>
    </div>
  );
}
