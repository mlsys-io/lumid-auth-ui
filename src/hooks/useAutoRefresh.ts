import { useEffect, useRef, useState } from "react";

/**
 * Re-fire `load()` when the tab becomes visible again after being hidden
 * for at least `staleAfterMs`. Also tracks the last-loaded timestamp so
 * callers can render a "loaded Nm ago" hint.
 *
 * Usage:
 *   const { loadedAt, refresh } = useAutoRefresh(load, { staleAfterMs: 60_000 });
 *
 * - `load`     — the async loader the caller already runs on mount; we
 *                only invoke it on visibility transitions, not initially.
 * - `staleAfterMs` — minimum hidden-duration before a focus-return triggers
 *                a refresh. Defaults to 60s so quick alt-tabs don't thrash
 *                the network.
 * - `loadedAt` — set by the caller via `refresh()`, exposed so the UI can
 *                render `Nm ago` next to the refresh button.
 */
export function useAutoRefresh(
  load: () => unknown | Promise<unknown>,
  opts: { staleAfterMs?: number } = {},
) {
  const { staleAfterMs = 60_000 } = opts;
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const hiddenSince = useRef<number | null>(null);
  // Keep the latest `load` callback so the visibility listener doesn't
  // capture a stale closure (otherwise refetch would call the original
  // mount-time loader instead of any later replacement).
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  useEffect(() => {
    const handle = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince.current = Date.now();
      } else if (document.visibilityState === "visible") {
        const since = hiddenSince.current;
        hiddenSince.current = null;
        if (since !== null && Date.now() - since >= staleAfterMs) {
          Promise.resolve(loadRef.current()).finally(() => setLoadedAt(Date.now()));
        }
      }
    };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, [staleAfterMs]);

  // Caller wraps their own loader through `refresh()` so we record the
  // updated timestamp even on initial mount + manual button clicks.
  const refresh = async () => {
    await Promise.resolve(loadRef.current());
    setLoadedAt(Date.now());
  };

  return { loadedAt, refresh };
}

/** Tiny formatter — "12s ago" / "3m ago" / "2h ago" / "—" */
export function fmtAgo(loadedAt: number | null): string {
  if (loadedAt == null) return "—";
  const s = Math.floor((Date.now() - loadedAt) / 1000);
  if (s < 5)     return "just now";
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/**
 * Forces a component to re-render every `intervalMs` so that time-since
 * labels (`fmtAgo`, freshness pills, "Nm ago" badges) stay live without
 * the caller having to manage state. Returns the tick counter only so
 * React knows to re-run the render.
 *
 * Default 30s — fine-grained enough that the "Nm ago" hint feels current,
 * coarse enough that it doesn't burn CPU on idle tabs.
 */
export function useNowTick(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}
