"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import EChart, { lineOption } from "@/components/EChart";
import { Panel, Seg, SourceTag, State } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dateOnly, num, pct, tone } from "@/lib/format";

type Bank = { area: string; bank: string; rate: number; date: string; last_change: string; previous: number | null; history: [string, number][] };
type Impact = { label: string; count: number; dates: string[]; assets: { symbol: string; name: string; unit: string; n: number; avg_abs_release: number; avg_abs_other: number; ratio: number; up_pct: number; last: { date: string; move: number }[] }[] };
const RELEASES: [string, string][] = [["cpi", "CPI"], ["nfp", "Emploi (NFP)"], ["gdp", "PIB"], ["retail", "Ventes au détail"], ["pce", "PCE"], ["ppi", "PPI"]];

export default function Econ() {
  const cb = useApi<Bank[]>("/api/economics/central-banks", 60 * 60_000);
  const [rel, setRel] = useState("cpi");
  const imp = useApi<Impact>(`/api/economics/impact?release=${rel}`);
  const opt = useMemo(() => cb.data && lineOption(cb.data.filter((b) => ["Fed", "BCE", "BoE", "BoJ", "PBoC"].includes(b.bank)).map((b) => ({ name: b.bank, data: b.history.map(([d, v]) => [d, v] as [string, number]), step: true })), { unit: " %" }), [cb.data]);
  const fmtMove = (v: number, unit: string) => (unit === "pb" ? `${v > 0 ? "+" : ""}${num(v, 1)} pb` : pct(v));
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 xl:col-span-5" title="Banques centrales · taux directeurs" right={<SourceTag env={cb.env} />}>
        <State loading={cb.loading && !cb.data} error={cb.error} />
        <table><thead><tr><th>Banque</th><th className="num">Taux</th><th className="num">Précédent</th><th className="num">Dernier mouvement</th><th className="num">Sens</th></tr></thead>
          <tbody>{cb.data?.map((b) => <tr key={b.area}><td className="text-amber">{b.bank}</td><td className="num text-fg">{num(b.rate, 3)} %</td><td className="num">{b.previous == null ? "–" : `${num(b.previous, 3)} %`}</td>
            <td className="num">{dateOnly(b.last_change)}</td><td className={`num ${tone(b.previous == null ? null : b.rate - b.previous)}`}>{b.previous == null ? "–" : `${b.rate > b.previous ? "+" : ""}${Math.round((b.rate - b.previous) * 100)} pb`}</td></tr>)}</tbody></table>
        <div className="h-56">{opt && <EChart option={opt} />}</div>
        <div className="px-2 py-1 text-[10px] text-dim">Historique des 15 dernières décisions par banque. Anticipations de marché pour la Fed : <Link href="/forecasts" className="text-info">FCST</Link> ; courbes : <Link href="/fi" className="text-info">YAS</Link>.</div>
      </Panel>
      <Panel className="col-span-12 xl:col-span-7" title="Impact des publications sur les classes d'actifs" right={<><Seg value={rel} options={RELEASES} onChange={setRel} /><SourceTag env={imp.env} /></>}>
        <State loading={imp.loading && !imp.data} error={imp.error} />
        {imp.data && <>
          <div className="px-2 py-1">{imp.data.label} · {imp.data.count} publications sur 5 ans. Mouvement absolu moyen le jour de la publication comparé aux autres séances.</div>
          <table><thead><tr><th>Actif</th><th className="num">Jours de publication</th><th className="num">Autres jours</th><th className="num">Ratio</th><th className="num">% de hausse</th><th>8 dernières publications</th></tr></thead>
            <tbody>{imp.data.assets.map((a) => <tr key={a.symbol}><td className="text-amber">{a.name}</td><td className="num">{fmtMove(a.avg_abs_release, a.unit).replace("+", "")}</td><td className="num">{fmtMove(a.avg_abs_other, a.unit).replace("+", "")}</td>
              <td className={`num ${a.ratio > 1.2 ? "text-amber" : ""}`}>{num(a.ratio, 2)}x</td><td className="num">{num(a.up_pct, 0)} %</td>
              <td className="space-x-2 whitespace-nowrap">{a.last.map((m) => <span key={m.date} className={tone(m.move)} title={m.date}>{fmtMove(m.move, a.unit)}</span>)}</td></tr>)}</tbody></table>
          <div className="px-2 py-1 text-[10px] text-dim">Ratio &gt; 1 : la publication fait bouger l&apos;actif plus qu&apos;une séance ordinaire. Variation de clôture à clôture (les publications US tombent à 14 h 30, heure de Paris). Les surprises par rapport au consensus ne sont pas mesurées : l&apos;historique des consensus n&apos;est pas disponible gratuitement.</div>
        </>}
      </Panel>
      <Panel className="col-span-12" title="Autres outils économiques">
        <div className="flex flex-wrap gap-4 px-2 py-2">
          <Link href="/calendrier" className="text-info">ECO · calendrier, consensus et précédents →</Link>
          <Link href="/macro" className="text-info">MAC · indicateurs US (CPI, PCE, NFP, chômage, PIB, production, ventes, confiance, immobilier) →</Link>
          <Link href="/data" className="text-info">DATA · comparaisons internationales (dette, déficit, balance commerciale) →</Link>
          <Link href="/forecasts" className="text-info">FCST · prévisions OCDE et anticipations de taux →</Link>
        </div>
      </Panel>
    </div>
  );
}
