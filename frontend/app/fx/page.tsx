"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Seg } from "@/components/ui";
import CotView from "./cot";
import CorrView from "./corr";
import Overview from "./overview";
import PairView from "./pair";
import { GROUPS, pairLabel, useBoard } from "./shared";
import Tools from "./tools";

const TABS = [["overview", "Vue d'ensemble"], ["pair", "Analyse de paire"], ["cot", "Positionnement COT"], ["corr", "Moteurs et corrélations"], ["tools", "Terme, options, calculateurs"]] as const;
type Tab = (typeof TABS)[number][0];
const QUICK = ["EURUSD", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "EURGBP", "DXY"];

export default function FX() {
  const sp = useSearchParams(), router = useRouter();
  const raw = sp.get("s")?.replace("=X", "").replace("/", "").toUpperCase();
  const pair = raw === "DX-Y.NYB" ? "DXY" : raw && (raw.length === 6 || raw === "DXY") ? raw : "EURUSD";
  const tab = ((sp.get("tab") as Tab) || (raw ? "pair" : "overview"));
  const ccy = sp.get("c") || (pair === "DXY" ? "USD" : pair.startsWith("USD") ? pair.slice(3) : pair.slice(0, 3));
  const go = (t: Tab, p = pair, c?: string) => router.replace(`/fx?tab=${t}&s=${encodeURIComponent(p)}${c ? `&c=${c}` : ""}`, { scroll: false });
  const board = useBoard();
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border border-line bg-panel px-2 py-1">
        <span className="text-[11px] uppercase tracking-wider text-amber">FX · change</span>
        <Seg value={tab} options={TABS as unknown as [Tab, string][]} onChange={(t) => go(t)} />
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {QUICK.map((p) => <button key={p} onClick={() => go(tab === "overview" ? "pair" : tab, p)}
            className={`border px-1.5 text-[11px] ${p === pair ? "border-amber text-amber" : "border-line text-dim hover:text-fg"}`}>{pairLabel(p)}</button>)}
          <select value={pair} onChange={(e) => go(tab === "overview" ? "pair" : tab, e.target.value)} title="Choisir une paire">
            {GROUPS.map((g) => <optgroup key={g} label={g}>{(board.data ?? []).filter((p) => p.group === g).map((p) => <option key={p.pair} value={p.pair}>{pairLabel(p.pair)}</option>)}</optgroup>)}
            <option value="DXY">DXY (indice dollar)</option>
            {!board.data && <option value={pair}>{pairLabel(pair)}</option>}
          </select>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "overview" && <Overview pair={pair} open={(p) => go("pair", p)} />}
        {tab === "pair" && <PairView pair={pair} goCot={(c) => go("cot", pair, c)} goDrivers={() => go("corr")} />}
        {tab === "cot" && <CotView ccy={ccy} setCcy={(c) => go("cot", pair, c)} />}
        {tab === "corr" && <CorrView pair={pair} open={(p) => go("pair", p)} />}
        {tab === "tools" && <Tools pair={pair} />}
      </div>
    </div>
  );
}
