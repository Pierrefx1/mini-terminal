"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type Alert, checkPrice, newArticles } from "@/lib/alerts";
import { price } from "@/lib/format";
import { useLocal } from "@/lib/store";

type Toast = { id: string; text: string; href: string };

/** Surveille les alertes actives toutes les 60 secondes et affiche les déclenchements (bandeau + notification du navigateur). */
export default function AlertWatcher() {
  const [alerts, setAlerts, ready] = useLocal<Alert[]>("mt.alerts", []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ref = useRef(alerts); ref.current = alerts;
  const activeKey = alerts.filter((a) => a.active).map((a) => a.id).join(",");
  useEffect(() => {
    if (!ready) return;
    const notify = (t: Toast) => {
      setToasts((x) => [t, ...x].slice(0, 4));
      try { if (Notification.permission === "granted") new Notification("Alerte MARKET TERMINAL", { body: t.text }); } catch { /* notifications indisponibles */ }
    };
    const tick = async () => {
      const act = ref.current.filter((a) => a.active);
      if (!act.length) return;
      const syms = [...new Set(act.filter((a) => a.kind === "price").map((a) => a.symbol!))];
      const updates: Record<string, Partial<Alert>> = {};
      if (syms.length) {
        try {
          const j = await (await fetch(`/api/market/quotes?symbols=${encodeURIComponent(syms.join(","))}`)).json();
          const q: Record<string, number | undefined> = Object.fromEntries((j.data ?? []).map((x: { symbol: string; price?: number }) => [x.symbol, x.price]));
          for (const a of checkPrice(act, q)) {
            updates[a.id] = { active: false, triggeredAt: Date.now(), triggeredValue: price(q[a.symbol!]) };
            notify({ id: a.id, text: `${a.symbol} ${a.op} ${price(a.price)} : dernier cours ${price(q[a.symbol!])} (différé)${a.note ? ` · ${a.note}` : ""}`, href: `/des?s=${encodeURIComponent(a.symbol!)}` });
          }
        } catch { /* source indisponible : nouvel essai au prochain passage */ }
      }
      for (const a of act.filter((x) => x.kind === "news")) {
        try {
          const j = await (await fetch(`/api/news?q=${encodeURIComponent(a.keyword!)}&limit=10`)).json();
          const items: { title: string; published: string }[] = j.data?.items ?? [];
          if (!items.length) continue;
          const fresh = newArticles(a, items);
          if (a.lastSeen && fresh.length) notify({ id: a.id + fresh[0].published, text: `« ${a.keyword} » : ${fresh[0].title}`, href: `/news` });
          updates[a.id] = { ...(updates[a.id] ?? {}), lastSeen: items[0].published, ...(a.lastSeen && fresh.length ? { triggeredAt: Date.now(), triggeredValue: `${fresh.length} article(s)` } : {}) };
        } catch { /* idem */ }
      }
      if (Object.keys(updates).length) setAlerts((l) => l.map((a) => (updates[a.id] ? { ...a, ...updates[a.id] } : a)));
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [ready, setAlerts, activeKey]); // nouvelle alerte : vérification immédiate
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-8 right-2 z-50 w-96 space-y-1">
      {toasts.map((t) => (
        <div key={t.id} className="flex items-start gap-2 border border-amber bg-panel p-2 shadow-lg">
          <span className="text-amber">▲</span>
          <Link href={t.href} className="flex-1 hover:underline">{t.text}</Link>
          <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-dim">×</button>
        </div>
      ))}
    </div>
  );
}
