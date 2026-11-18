"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Export from "@/components/Export";
import { Num, Out, Panel, Seg, SourceTag, State, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { big, num, pct, price, tone } from "@/lib/format";
import * as P from "@/lib/paper";
import { uid, useLocal } from "@/lib/store";

type Q = { symbol: string; price?: number; time?: number; error?: string };
type Des = { last: number; avg_volume20?: number; vol20?: number; currency?: string; name?: string };
type BA = { bid: number; ask: number; bid_size: number; ask_size: number };
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function Trade() {
  const sp = useSearchParams();
  const [acc, setAcc, ready] = useLocal<P.Account>("mt.paper", P.newAccount());
  const [costs, setCosts] = useLocal<P.CostModel>("mt.paper.costs", P.DEFAULT_COSTS);
  const [sym, setSym] = useState(sp.get("s")?.toUpperCase() || "AAPL");
  const [side, setSide] = useState<P.Side>("BUY"), [type, setType] = useState<P.OrderType>("MARKET");
  const [qty, setQty] = useState(100), [limit, setLimit] = useState(NaN), [stop, setStop] = useState(NaN);
  const [bracket, setBracket] = useState(false), [tp, setTp] = useState(NaN), [sl, setSl] = useState(NaN);
  const [condOn, setCondOn] = useState(false), [condSym, setCondSym] = useState("^VIX"), [condDir, setCondDir] = useState<"above" | "below">("above"), [condPx, setCondPx] = useState(25);
  const [msg, setMsg] = useState<string | null>(null);

  const symbols = useMemo(() => [...new Set([sym, ...Object.keys(acc.positions), ...acc.orders.filter((o) => o.status === "WORKING").flatMap((o) => [o.symbol, o.cond?.symbol ?? ""])].filter(Boolean))], [sym, acc]);
  const quotes = useApi<Q[]>(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, 30_000);
  const des = useApi<Des>(`/api/overview/describe?symbol=${encodeURIComponent(sym)}`, 120_000);
  const ba = useApi<BA>(`/api/market/bidask?symbol=${encodeURIComponent(sym)}`, 30_000);
  const qmap: Record<string, P.Quote> = useMemo(() => {
    const m: Record<string, P.Quote> = {};
    for (const q of quotes.data ?? []) if (q.price != null) m[q.symbol] = { last: q.price, time: q.time };
    if (m[sym]) m[sym] = { ...m[sym], bid: ba.data?.bid, ask: ba.data?.ask, adv: des.data?.avg_volume20, vol: des.data?.vol20 != null ? des.data.vol20 / 100 : null };
    return m;
  }, [quotes.data, ba.data, des.data, sym]);

  // réévaluation des ordres en attente à chaque nouvelle cotation
  const accRef = useRef(acc); accRef.current = acc;
  useEffect(() => { if (!ready || !Object.keys(qmap).length) return; const next = P.evaluate(accRef.current, qmap, Date.now(), costs); if (next !== accRef.current && JSON.stringify(next) !== JSON.stringify(accRef.current)) setAcc(next); }, [qmap, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = qmap[sym];
  const t = q ? P.touch(q, costs) : null;
  const book = q ? P.syntheticBook(q, 5, costs) : null;
  const imp = q ? P.impact(q, qty, costs) : 0;
  const est = q && t ? (side === "BUY" ? t.ask + imp : t.bid - imp) : NaN;
  const v = P.valuation(acc, qmap);

  const send = () => {
    if (!q) { setMsg(`Pas de cotation pour ${sym}`); return; }
    const group = bracket ? uid() : undefined;
    let a = P.submit(acc, { id: uid(), symbol: sym, side, type, qty, limit: Number.isNaN(limit) ? undefined : limit, stop: Number.isNaN(stop) ? undefined : stop,
      cond: condOn ? { symbol: condSym.toUpperCase(), dir: condDir, price: condPx } : undefined }, qmap, Date.now(), costs);
    if (bracket) {
      const exit: P.Side = side === "BUY" ? "SELL" : "BUY";
      if (!Number.isNaN(tp)) a = P.submit(a, { id: uid(), symbol: sym, side: exit, type: "LIMIT", qty, limit: tp, ocoGroup: group }, qmap, Date.now(), costs);
      if (!Number.isNaN(sl)) a = P.submit(a, { id: uid(), symbol: sym, side: exit, type: "STOP", qty, stop: sl, ocoGroup: group }, qmap, Date.now(), costs);
    }
    setAcc(a);
    const o = a.orders.find((x) => !acc.orders.some((y) => y.id === x.id) && !x.ocoGroup) ?? a.orders[0];
    setMsg(o.status === "FILLED" ? `Exécuté : ${o.side === "BUY" ? "achat" : "vente"} ${o.qty} ${o.symbol} à ${price(a.fills[0].price)}` : o.status === "REJECTED" ? `Rejeté : ${o.reason}` : "Ordre en attente");
  };
  const working = acc.orders.filter((o) => o.status === "WORKING");
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12" title={<span>TRADE · paper trading <StatusBadge status="SIMULATED" /></span>} right={<><SourceTag env={quotes.env} />
        <button onClick={() => { if (confirm("Réinitialiser le compte simulé (positions, ordres et historique effacés) ?")) setAcc(P.newAccount(acc.initialCash)); }} className="border border-line px-1 text-down">réinitialiser</button></>}>
        <div className="grid grid-cols-2 gap-x-6 px-2 py-1 md:grid-cols-4 xl:grid-cols-8">
          <Out label="Valeur du compte" value={big(v.equity)} cls="text-fg" /><Out label="Liquidités" value={big(v.cash)} />
          <Out label="P&L total" value={big(v.pnl)} cls={tone(v.pnl)} /><Out label="Réalisé (net de frais)" value={big(v.realized)} cls={tone(v.realized)} />
          <Out label="Latent" value={big(v.unrealized)} cls={tone(v.unrealized)} /><Out label="Exposition nette" value={big(v.net)} />
          <Out label="Exposition brute" value={big(v.gross)} /><Out label="Levier" value={`${num(v.leverage, 2)}x`} cls={v.leverage > 2 ? "text-amber" : ""} />
        </div>
        <div className="px-2 pb-1 text-[10px] text-dim">Aucune transaction réelle. Exécution sur le cours différé de la source ; écart, glissement et impact de marché modélisés. Compte stocké dans ce navigateur. Devise : celle de chaque instrument (pas de conversion).</div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-3" title="Ticket d'ordre">
        <div className="px-2 py-1">
          <label className="flex justify-between py-0.5"><span className="text-dim">Instrument</span><input value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} className="w-28 uppercase" /></label>
          <div className="text-[11px] text-dim">{des.data?.name} {des.data?.currency}</div>
          <div className="flex justify-between py-0.5"><span className="text-dim">Sens</span><Seg value={side} options={[["BUY", "Achat"], ["SELL", "Vente"]]} onChange={setSide} /></div>
          <div className="flex justify-between py-0.5"><span className="text-dim">Type</span><Seg value={type} options={[["MARKET", "Marché"], ["LIMIT", "Limite"], ["STOP", "Stop"], ["STOP_LIMIT", "Stop lim."]]} onChange={setType} /></div>
          <Num label="Quantité" value={qty} onChange={setQty} step={1} />
          {(type === "LIMIT" || type === "STOP_LIMIT") && <Num label="Prix limite" value={limit} onChange={setLimit} step={0.01} />}
          {(type === "STOP" || type === "STOP_LIMIT") && <Num label="Prix de déclenchement" value={stop} onChange={setStop} step={0.01} />}
          <label className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={bracket} onChange={(e) => setBracket(e.target.checked)} /><span>Sortie automatique (OCO : objectif + stop)</span></label>
          {bracket && <><Num label="Objectif (limite)" value={tp} onChange={setTp} step={0.01} /><Num label="Stop de protection" value={sl} onChange={setSl} step={0.01} /></>}
          <label className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={condOn} onChange={(e) => setCondOn(e.target.checked)} /><span>Ordre conditionnel</span></label>
          {condOn && <div className="flex items-center gap-1 py-0.5 text-[11px]">si <input value={condSym} onChange={(e) => setCondSym(e.target.value)} className="w-16 uppercase" />
            <select value={condDir} onChange={(e) => setCondDir(e.target.value as "above" | "below")}><option value="above">≥</option><option value="below">≤</option></select>
            <input type="number" value={condPx} onChange={(e) => setCondPx(+e.target.value)} className="w-16" /></div>}
          <Out label="Prix estimé d'exécution" value={Number.isFinite(est) ? price(est) : "–"} cls="text-amber" />
          <Out label="dont impact de marché estimé" value={num(imp, 4)} />
          <Out label="Montant estimé" value={Number.isFinite(est) ? big(est * qty) : "–"} />
          {/* on attend la fourchette réelle (ou la réponse « indisponible ») avant d'exécuter, pour ne pas exécuter sur un écart modélisé par erreur */}
          <button onClick={send} disabled={!q || (!ba.data && !ba.error)} className={`mt-1 w-full py-1 font-bold text-black disabled:opacity-40 ${side === "BUY" ? "bg-up" : "bg-down"}`}>
            {!q || (!ba.data && !ba.error) ? "cotation en cours…" : `${side === "BUY" ? "ACHETER" : "VENDRE"} ${qty} ${sym}`}</button>
          {msg && <div className="mt-1 text-amber">{msg}</div>}
        </div>
      </Panel>
      <Panel className="col-span-12 md:col-span-6 xl:col-span-3" title={<span>Carnet d&apos;ordres {sym} <StatusBadge status="SIMULATED" /></span>} right={<SourceTag env={ba.data ? ba.env : quotes.env} />}>
        {t && <div className="px-2 py-1">Meilleure demande <span className="text-up">{price(t.bid)}</span> · offre <span className="text-down">{price(t.ask)}</span> · écart {num((t.ask - t.bid) / ((t.ask + t.bid) / 2) * 10_000, 1)} pb
          <div className="text-[10px] text-dim">{t.stale ? `Fourchette CBOE (${price(ba.data?.bid)} / ${price(ba.data?.ask)}) écartée : trop éloignée du dernier cours (cotation d'une autre séance ou retard de la source). Fourchette modélisée (${costs.spreadBps} pb).`
            : t.modelled ? `Fourchette modélisée (${costs.spreadBps} pb) : aucune cotation bid/ask gratuite pour cet instrument.` : "Meilleure limite réelle (CBOE, différée) ; profondeur au-delà simulée."}</div></div>}
        {book && <table><thead><tr><th className="num">Qté</th><th className="num">Demande</th><th className="num">Offre</th><th className="num">Qté</th></tr></thead>
          <tbody>{book.bids.map((b, i) => <tr key={i}><td className="num text-dim">{big(b.size)}</td><td className="num text-up">{price(b.price)}</td><td className="num text-down">{price(book.asks[i].price)}</td><td className="num text-dim">{big(book.asks[i].size)}</td></tr>)}</tbody></table>}
        <div className="mt-2 px-2 text-[10px] uppercase text-amber">Modèle de coûts</div>
        <div className="px-2">
          <Num label="Écart si pas de bid/ask" value={costs.spreadBps} onChange={(x) => setCosts({ ...costs, spreadBps: x })} step={0.5} suffix="pb" />
          <Num label="Coefficient d'impact" value={costs.impactCoef} onChange={(x) => setCosts({ ...costs, impactCoef: x })} step={0.05} title="impact = coef × σ quotidienne × √(quantité / volume moyen 20 j) × prix" />
          <Num label="Frais" value={costs.feeBps} onChange={(x) => setCosts({ ...costs, feeBps: x })} step={0.5} suffix="pb" /><Num label="Frais minimum" value={costs.minFee} onChange={(x) => setCosts({ ...costs, minFee: x })} step={0.5} />
        </div>
      </Panel>
      <Panel className="col-span-12 xl:col-span-6" title="Positions ouvertes" right={<Export name="positions-simulees" columns={["Symbole", "Quantité", "Prix moyen", "Dernier", "Valeur", "Latent", "Réalisé"]} rows={v.rows.map((r) => [r.symbol, r.qty, r.avgPrice, r.last, r.marketValue, r.unrealized, r.realized])} source="paper trading (simulé)" />}>
        <State empty={ready && v.rows.length === 0 && "Aucune position. Passer un ordre depuis le ticket."} />
        {v.rows.length > 0 && <table><thead><tr><th>Instrument</th><th className="num">Qté</th><th className="num">Prix moyen</th><th className="num">Dernier</th><th className="num">Valeur</th><th className="num">Poids</th><th className="num">Latent</th><th className="num">Latent %</th><th className="num">Réalisé</th><th /></tr></thead>
          <tbody>{v.rows.map((r) => <tr key={r.symbol}><td><Link href={`/des?s=${encodeURIComponent(r.symbol)}`} className="text-amber">{r.symbol}</Link></td><td className={`num ${tone(r.qty)}`}>{num(r.qty, 0)}</td><td className="num">{price(r.avgPrice)}</td>
            <td className="num">{price(r.last)}</td><td className="num">{big(r.marketValue)}</td><td className="num">{v.equity ? pct((r.marketValue ?? 0) / v.equity * 100).replace("+", "") : "–"}</td>
            <td className={`num ${tone(r.unrealized)}`}>{big(r.unrealized)}</td><td className={`num ${tone(r.unrealized)}`}>{r.qty && r.avgPrice ? pct((r.last! / r.avgPrice - 1) * 100 * Math.sign(r.qty)) : "–"}</td>
            <td className={`num ${tone(r.realized)}`}>{big(r.realized)}</td>
            <td>{r.qty !== 0 && <button onClick={() => setAcc(P.submit(acc, { id: uid(), symbol: r.symbol, side: r.qty > 0 ? "SELL" : "BUY", type: "MARKET", qty: Math.abs(r.qty) }, qmap, Date.now(), costs))} className="text-info hover:text-amber">clôturer</button>}</td></tr>)}</tbody></table>}
      </Panel>
      <Panel className="col-span-12 xl:col-span-6" title={`Ordres en attente (${working.length})`}>
        <State empty={working.length === 0 && "Aucun ordre en attente."} />
        {working.length > 0 && <table><thead><tr><th>Heure</th><th>Instrument</th><th>Sens</th><th>Type</th><th className="num">Qté</th><th className="num">Limite</th><th className="num">Stop</th><th>Condition</th><th /></tr></thead>
          <tbody>{working.map((o) => <tr key={o.id}><td className="text-dim">{hm.format(o.createdAt)}</td><td className="text-amber">{o.symbol}</td><td className={o.side === "BUY" ? "text-up" : "text-down"}>{o.side === "BUY" ? "Achat" : "Vente"}</td>
            <td>{o.type}{o.triggered ? " (déclenché)" : ""}{o.ocoGroup ? " · OCO" : ""}</td><td className="num">{o.qty}</td><td className="num">{price(o.limit)}</td><td className="num">{price(o.stop)}</td>
            <td className="text-dim">{o.cond ? `${o.cond.symbol} ${o.cond.dir === "above" ? "≥" : "≤"} ${o.cond.price}` : "–"}</td><td><button onClick={() => setAcc(P.cancel(acc, o.id))} className="text-down">annuler</button></td></tr>)}</tbody></table>}
      </Panel>
      <Panel className="col-span-12" title="Historique des exécutions" right={<Export name="executions-simulees" columns={["Heure", "Instrument", "Sens", "Quantité", "Prix", "Référence", "Glissement", "Frais"]} rows={acc.fills.map((f) => [new Date(f.time).toISOString(), f.symbol, f.side, f.qty, f.price, f.ref, f.slippage, f.fees])} source="paper trading (simulé)" />}>
        <State empty={ready && acc.fills.length === 0 && "Aucune exécution."} />
        {acc.fills.length > 0 && <table><thead><tr><th>Heure</th><th>Instrument</th><th>Sens</th><th className="num">Qté</th><th className="num">Prix</th><th className="num">Dernier cours</th><th className="num">Glissement</th><th className="num">Glissement (pb)</th><th className="num">Frais</th></tr></thead>
          <tbody>{acc.fills.slice(0, 200).map((f, i) => <tr key={i}><td className="text-dim">{hm.format(f.time)}</td><td className="text-amber">{f.symbol}</td><td className={f.side === "BUY" ? "text-up" : "text-down"}>{f.side === "BUY" ? "Achat" : "Vente"}</td>
            <td className="num">{f.qty}</td><td className="num">{price(f.price)}</td><td className="num text-dim">{price(f.ref)}</td><td className="num">{num(f.slippage, 4)}</td><td className="num">{num(f.slippage / f.ref * 10_000, 1)}</td><td className="num">{num(f.fees, 2)}</td></tr>)}</tbody></table>}
        <div className="px-2 py-1 text-[10px] text-dim">Ordres annulés ou rejetés : {acc.orders.filter((o) => o.status === "CANCELLED" || o.status === "REJECTED").length}. <Link href="/port?src=paper" className="text-info">analyser ces positions dans PORT et RISK →</Link></div>
      </Panel>
    </div>
  );
}
