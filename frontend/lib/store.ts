"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Stockage dans ce navigateur (aucun compte) : portefeuilles, notes, alertes, espaces de travail.
 * Toute lecture ou écriture est protégée : navigation privée ou stockage bloqué => l'état reste en mémoire.
 */
export function readLocal<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function writeLocal<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new CustomEvent("mt-store", { detail: key })); } catch { /* stockage indisponible */ }
}

/** État persistant synchronisé entre composants (et entre onglets via l'événement storage). */
export function useLocal<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setValue(readLocal(key, initial)); setReady(true);
    const sync = (e: Event) => {
      const k = e instanceof StorageEvent ? e.key : (e as CustomEvent).detail;
      if (k === key) setValue(readLocal(key, initial));
    };
    window.addEventListener("storage", sync); window.addEventListener("mt-store", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("mt-store", sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback((v: T | ((p: T) => T)) => {
    setValue((prev) => { const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v; writeLocal(key, next); return next; });
  }, [key]);
  return [value, set, ready];
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
