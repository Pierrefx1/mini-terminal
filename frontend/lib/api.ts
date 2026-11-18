"use client";
import useSWR from "swr";

export type DataStatus = "LIVE" | "DELAYED" | "HISTORICAL" | "SIMULATED";
export type Envelope<T> = { data: T; source: string; status?: DataStatus | null; fetched_at: string | null; stale: boolean; error: string | null };

export class ApiError extends Error {
  source?: string;
}

export async function fetcher(url: string) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    const err = new ApiError(msg);
    try {
      const j = await r.json();
      const d = j.detail;
      if (typeof d === "string") msg = d;
      else if (d?.error) { msg = d.error; err.source = d.source; }
    } catch {}
    err.message = msg;
    throw err;
  }
  return r.json();
}

/** Lecture d'un point d'API renvoyant une enveloppe {data, source, fetched_at, stale, error}. */
export function useApi<T>(url: string | null, refreshMs = 0) {
  const { data, error, isLoading, mutate } = useSWR<Envelope<T>, ApiError>(url, fetcher, {
    refreshInterval: refreshMs, revalidateOnFocus: false, keepPreviousData: true, shouldRetryOnError: false,
  });
  return { env: data, data: data?.data, error, loading: isLoading, reload: mutate };
}

export async function send(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : j.detail?.error ?? JSON.stringify(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

/** Lecture d'un point d'API local sans enveloppe (journal, configuration). */
export function useRaw<T>(url: string | null) {
  const { data, error, isLoading, mutate } = useSWR<T, ApiError>(url, fetcher, { revalidateOnFocus: false, shouldRetryOnError: false });
  return { data, error, loading: isLoading, reload: mutate };
}

/** Lecture d'un point d'API en POST (corps JSON), mise en cache par corps de requête. */
export function usePostApi<T>(url: string | null, body: unknown) {
  const key = url ? [url, JSON.stringify(body)] : null;
  const { data, error, isLoading, mutate } = useSWR<Envelope<T>, ApiError>(key, async ([u, b]: [string, string]) => {
    const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: b });
    if (!r.ok) {
      const err = new ApiError(`HTTP ${r.status}`);
      try { const j = await r.json(); const d = j.detail; err.message = typeof d === "string" ? d : d?.error ?? (Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join(" ; ") : err.message); err.source = d?.source; } catch {}
      throw err;
    }
    return r.json();
  }, { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true });
  return { env: data, data: data?.data, error, loading: isLoading, reload: mutate };
}
