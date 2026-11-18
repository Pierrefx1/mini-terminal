"use client";
import { useState } from "react";

type Cell = string | number | null | undefined;

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Boutons d'export CSV (point-virgule, décimale « . ») et Excel (.xlsx généré par le backend, source en pied de feuille). */
export default function Export({ name, columns, rows, source }: { name: string; columns: string[]; rows: Cell[][]; source?: string }) {
  const [busy, setBusy] = useState(false);
  const csv = () => {
    const esc = (v: Cell) => (v == null ? "" : typeof v === "number" ? String(v) : `"${String(v).replace(/"/g, '""')}"`);
    const body = [columns, ...rows].map((r) => r.map(esc).join(";")).join("\n") + (source ? `\n\n"Source : ${source}"` : "");
    download(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
  };
  const xlsx = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/export/xlsx", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name, source: source ?? "", sheets: [{ name: name.slice(0, 31), columns, rows }] }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      download(await r.blob(), `${name}.xlsx`);
    } catch (e) { alert(`Export Excel impossible : ${(e as Error).message}`); } finally { setBusy(false); }
  };
  if (!rows.length) return null;
  return (
    <span className="inline-flex gap-1">
      <button onClick={csv} className="border border-line px-1 text-info hover:border-amber" title="Exporter en CSV">CSV</button>
      <button onClick={xlsx} disabled={busy} className="border border-line px-1 text-info hover:border-amber disabled:text-dim" title="Exporter en Excel">{busy ? "…" : "XLSX"}</button>
    </span>
  );
}
