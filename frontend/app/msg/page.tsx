"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Panel, State } from "@/components/ui";
import { price, pct, tone } from "@/lib/format";
import { useLocal } from "@/lib/store";

type Me = { id: number; handle: string; token: string };
type User = { id: number; handle: string; status: string; online: boolean; last_seen: string };
type Room = { id: number; name: string; kind: string; others: string | null; unread: number; last_id: number | null };
type Att = { kind: "instrument" | "quote"; symbol: string; price?: number; change_pct?: number; source?: string; time?: string };
type Msg = { id: number; body: string; attachment: Att | null; sent_at: string; handle: string };
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function call<T>(token: string, url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { "X-Chat-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : `HTTP ${r.status}`);
  return j as T;
}

function Register({ onDone }: { onDone: (m: Me) => void }) {
  const [h, setH] = useState(""), [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try {
      const r = await fetch("/api/chat/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: h.trim() }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.detail); onDone(j);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Panel className="mx-auto mt-10 w-[520px]" title="MSG · messagerie">
      <div className="space-y-2 p-3">
        <div>Choisir un pseudo pour échanger avec les autres utilisateurs de ce serveur. Aucun mot de passe ni e-mail : l&apos;identifiant reste dans ce navigateur.</div>
        <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex gap-2"><input value={h} onChange={(e) => setH(e.target.value)} placeholder="pseudo (3 à 24 caractères)" className="flex-1" autoFocus /><button className="bg-amber px-3 text-black">Rejoindre</button></form>
        {err && <div className="text-down">{err}</div>}
        <div className="text-[10px] text-dim">Les messages sont stockés sur le serveur qui exécute le terminal : en local, seuls les navigateurs connectés à cette machine peuvent échanger ; une fois le terminal déployé, tous ses utilisateurs.</div>
      </div>
    </Panel>
  );
}

export default function Messaging() {
  const [me, setMe, ready] = useLocal<Me | null>("mt.chat", null);
  const [room, setRoom] = useState<number | null>(null);
  const [text, setText] = useState(""), [share, setShare] = useState(""), [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<number[]>([]), [groupName, setGroupName] = useState("");
  const [status, setStatus] = useState("disponible");
  const token = me?.token ?? "";
  const users = useSWR(me ? ["users", token] : null, () => call<User[]>(token, "/api/chat/users"), { refreshInterval: 15_000 });
  const rooms = useSWR(me ? ["rooms", token] : null, () => call<Room[]>(token, "/api/chat/rooms"), { refreshInterval: 4_000 });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const lastId = useRef(0);
  useEffect(() => { setMsgs([]); lastId.current = 0; }, [room]);
  useEffect(() => {
    if (!me || room == null) return;
    let stop = false;
    const poll = async () => {
      try {
        const m = await call<Msg[]>(token, `/api/chat/rooms/${room}/messages?after=${lastId.current}`);
        if (!stop && m.length) { lastId.current = m.at(-1)!.id; setMsgs((x) => [...x, ...m]); }
      } catch (e) { if ((e as Error).message.includes("inconnu")) setMe(null); }
    };
    poll(); const t = setInterval(poll, 3000); return () => { stop = true; clearInterval(t); };
  }, [room, me, token, setMe]);
  // notification des nouveaux messages dans les autres conversations
  const prevUnread = useRef(0);
  useEffect(() => {
    const u = (rooms.data ?? []).filter((r) => r.id !== room).reduce((s, r) => s + r.unread, 0);
    if (u > prevUnread.current && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("MARKET TERMINAL", { body: `${u} message(s) non lu(s)` });
    prevUnread.current = u;
  }, [rooms.data, room]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [msgs]);
  if (!ready) return <State loading />;
  if (!me) return <Register onDone={setMe} />;

  const send = async (attachment?: Att) => {
    if (room == null) return;
    try { await call(token, `/api/chat/rooms/${room}/messages`, "POST", { body: attachment ? text : text, attachment }); setText(""); setShare(""); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  };
  const shareQuote = async (kind: Att["kind"]) => {
    const s = share.trim().toUpperCase(); if (!s) return;
    try {
      const j = await (await fetch(`/api/market/quotes?symbols=${encodeURIComponent(s)}`)).json();
      const q = j.data?.[0];
      if (!q || q.error) throw new Error(q?.error ?? "cotation indisponible");
      await send(kind === "quote" ? { kind, symbol: q.symbol, price: q.price, change_pct: q.change_pct, source: `${j.source} (${j.status ?? ""})`, time: j.fetched_at } : { kind, symbol: q.symbol });
    } catch (e) { setErr((e as Error).message); }
  };
  const open = async (members: number[], name = "") => {
    try { const r = await call<{ id: number }>(token, "/api/chat/rooms", "POST", { members, name }); setRoom(r.id); setPick([]); setGroupName(""); rooms.mutate(); }
    catch (e) { setErr((e as Error).message); }
  };
  const cur = rooms.data?.find((r) => r.id === room);
  return (
    <div className="grid h-full grid-cols-12 gap-1">
      <Panel className="col-span-12 md:col-span-4 xl:col-span-3" title={`MSG · ${me.handle}`} right={<button onClick={() => { if (confirm("Se déconnecter de la messagerie dans ce navigateur ?")) setMe(null); }} className="text-dim">quitter</button>}>
        <div className="flex items-center gap-1 px-2 py-1"><span className="text-dim">Statut</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); call(token, "/api/chat/status", "POST", { status: e.target.value }); }}>{["disponible", "occupé", "en réunion", "absent"].map((x) => <option key={x}>{x}</option>)}</select>
          {typeof Notification !== "undefined" && Notification.permission !== "granted" && <button onClick={() => Notification.requestPermission()} className="ml-auto text-info">activer les notifications</button>}</div>
        <div className="bg-raised px-2 text-[10px] uppercase text-dim">Conversations</div>
        {(rooms.data ?? []).map((r) => <button key={r.id} onClick={() => setRoom(r.id)} className={`flex w-full justify-between px-2 py-0.5 text-left ${r.id === room ? "bg-amber text-black" : "hover:bg-raised"}`}>
          <span className="truncate">{r.kind === "group" ? `# ${r.name || r.others}` : r.others ?? "(seul)"}</span>{r.unread > 0 && <span className="bg-down px-1 text-black">{r.unread}</span>}</button>)}
        {rooms.data?.length === 0 && <div className="px-2 text-dim">Aucune conversation.</div>}
        <div className="mt-2 bg-raised px-2 text-[10px] uppercase text-dim">Contacts ({users.data?.filter((u) => u.id !== me.id).length ?? 0})</div>
        {(users.data ?? []).filter((u) => u.id !== me.id).map((u) => <div key={u.id} className="flex items-center gap-1 px-2 py-0.5">
          <input type="checkbox" checked={pick.includes(u.id)} onChange={(e) => setPick(e.target.checked ? [...pick, u.id] : pick.filter((x) => x !== u.id))} />
          <span className={`inline-block h-2 w-2 ${u.online ? "bg-up" : "bg-line"}`} title={u.online ? "en ligne" : `vu ${hm.format(new Date(u.last_seen))}`} />
          <button onClick={() => open([u.id])} className="hover:text-amber">{u.handle}</button><span className="text-[10px] text-dim">{u.status}</span></div>)}
        {users.data && users.data.length <= 1 && <div className="px-2 text-[10px] text-dim">Aucun autre utilisateur sur ce serveur pour l&apos;instant.</div>}
        {pick.length > 1 && <div className="flex gap-1 px-2 py-1"><input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="nom du groupe" className="flex-1" /><button onClick={() => open(pick, groupName || "groupe")} className="border border-amber px-1 text-amber">créer</button></div>}
      </Panel>
      <Panel className="col-span-12 md:col-span-8 xl:col-span-9" title={cur ? (cur.kind === "group" ? `# ${cur.name}` : cur.others ?? "") : "Sélectionner ou ouvrir une conversation"}>
        <div className="flex h-full flex-col">
          <div ref={box} className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
            {msgs.map((m) => <div key={m.id} className={m.handle === me.handle ? "text-right" : ""}>
              <div className="text-[10px] text-dim">{m.handle} · {hm.format(new Date(m.sent_at))}</div>
              {m.body && <div className={`inline-block max-w-[80%] whitespace-pre-wrap border px-2 py-0.5 text-left ${m.handle === me.handle ? "border-amber/50" : "border-line"}`}>{m.body}</div>}
              {m.attachment && <div className="mt-0.5"><Link href={`/des?s=${encodeURIComponent(m.attachment.symbol)}`} className="inline-block border border-info px-2 py-0.5 text-left hover:bg-raised">
                <span className="text-amber">{m.attachment.symbol}</span>
                {m.attachment.kind === "quote" && <> {price(m.attachment.price)} <span className={tone(m.attachment.change_pct)}>{pct(m.attachment.change_pct)}</span><span className="ml-1 text-[10px] text-dim">{m.attachment.source} · {m.attachment.time && hm.format(new Date(m.attachment.time))}</span></>}
                {m.attachment.kind === "instrument" && <span className="text-dim"> · ouvrir la fiche</span>}</Link></div>}
            </div>)}
            {room != null && !msgs.length && <div className="text-dim">Aucun message.</div>}
          </div>
          {room != null && <div className="border-t border-line p-1">
            {err && <div className="text-down">{err}</div>}
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(); }} className="flex gap-1">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" className="flex-1" /><button className="bg-amber px-3 text-black">Envoyer</button></form>
            <div className="mt-1 flex items-center gap-1 text-[11px]"><span className="text-dim">Partager</span><input value={share} onChange={(e) => setShare(e.target.value)} placeholder="symbole" className="w-24 uppercase" />
              <button onClick={() => shareQuote("quote")} className="border border-line px-1 text-info">la cotation</button><button onClick={() => shareQuote("instrument")} className="border border-line px-1 text-info">l&apos;instrument</button></div>
          </div>}
        </div>
      </Panel>
    </div>
  );
}
