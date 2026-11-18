"use client";
import Link from "next/link";
import { useState } from "react";
import { Panel, Seg, State } from "@/components/ui";
import type { Alert } from "@/lib/alerts";
import { dateTime, price } from "@/lib/format";
import { uid, useLocal } from "@/lib/store";

export default function Alerts() {
  const [alerts, setAlerts] = useLocal<Alert[]>("mt.alerts", []);
  const [kind, setKind] = useState<"price" | "news">("price");
  const [symbol, setSymbol] = useState(""), [op, setOp] = useState<">=" | "<=">(">="), [px, setPx] = useState(""), [kw, setKw] = useState(""), [note, setNote] = useState("");
  const add = () => {
    if (kind === "price" && (!symbol.trim() || !(Number(px) > 0))) return;
    if (kind === "news" && !kw.trim()) return;
    setAlerts([{ id: uid(), kind, active: true, created: Date.now(), note, ...(kind === "price" ? { symbol: symbol.trim().toUpperCase(), op, price: Number(px) } : { keyword: kw.trim() }) }, ...alerts]);
    setSymbol(""); setPx(""); setKw(""); setNote("");
  };
  const perm = typeof Notification !== "undefined" ? Notification.permission : "denied";
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 lg:col-span-4" title="ALRT · nouvelle alerte">
        <div className="space-y-1 px-2 py-1">
          <Seg value={kind} options={[["price", "Prix"], ["news", "Actualité (mot-clé)"]]} onChange={setKind} />
          {kind === "price" ? <div className="flex gap-1"><input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbole (AAPL, BZ=F…)" className="w-36 uppercase" />
            <select value={op} onChange={(e) => setOp(e.target.value as ">=" | "<=")}><option value=">=">monte à ≥</option><option value="<=">baisse à ≤</option></select>
            <input type="number" value={px} onChange={(e) => setPx(e.target.value)} placeholder="prix" className="w-24" /></div>
            : <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="mot-clé ou nom (OPEC, Nvidia, Lagarde…)" className="w-full" />}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (facultatif)" className="w-full" />
          <button onClick={add} className="bg-amber px-3 text-black">Créer l&apos;alerte</button>
          <div className="text-[10px] text-dim">Vérification toutes les 60 secondes tant qu&apos;un onglet du terminal est ouvert, sur des cours différés. Alertes gardées dans ce navigateur.</div>
          {perm !== "granted" && typeof Notification !== "undefined" && <button onClick={() => Notification.requestPermission()} className="text-info">Activer les notifications du navigateur</button>}
        </div>
      </Panel>
      <Panel className="col-span-12 lg:col-span-8" title={`Alertes (${alerts.filter((a) => a.active).length} actives)`}>
        <State empty={!alerts.length && "Aucune alerte."} />
        {alerts.length > 0 && <table><thead><tr><th>État</th><th>Condition</th><th>Note</th><th>Créée</th><th>Déclenchée</th><th /></tr></thead>
          <tbody>{alerts.map((a) => <tr key={a.id}>
            <td className={a.active ? "text-up" : a.triggeredAt ? "text-amber" : "text-dim"}>{a.active ? "active" : a.triggeredAt ? "déclenchée" : "inactive"}</td>
            <td>{a.kind === "price" ? <><Link href={`/des?s=${encodeURIComponent(a.symbol!)}`} className="text-amber">{a.symbol}</Link> {a.op} {price(a.price)}</> : <>actualité contenant « <span className="text-amber">{a.keyword}</span> »</>}</td>
            <td className="text-dim">{a.note}</td><td className="text-dim">{dateTime(a.created)}</td>
            <td>{a.triggeredAt ? `${dateTime(a.triggeredAt)} · ${a.triggeredValue}` : "–"}</td>
            <td className="space-x-2"><button onClick={() => setAlerts(alerts.map((x) => (x.id === a.id ? { ...x, active: !x.active, triggeredAt: x.active ? x.triggeredAt : undefined } : x)))} className="text-info">{a.active ? "suspendre" : "réactiver"}</button>
              <button onClick={() => setAlerts(alerts.filter((x) => x.id !== a.id))} className="text-down">supprimer</button></td></tr>)}</tbody></table>}
      </Panel>
    </div>
  );
}
