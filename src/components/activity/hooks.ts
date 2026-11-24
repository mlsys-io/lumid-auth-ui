// Hooks behind Activity: the runs feed (load + live SSE), a ticking clock for
// elapsed times, and "first view this session" for the one entrance animation.

import { useCallback, useEffect, useRef, useState } from "react";
import { me, streamRuns, MeApiError, type MeRunRow } from "@/api/me";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";

/** /me/runs returns at most this many rows and no cursor past them. */
export const RUNS_CAP = 500;

const cacheKey = (days: number) => `studio_runs_feed_v1:${days}`;
function readCache(days: number): { runs: MeRunRow[]; asOf: number } | null {
	try { return JSON.parse(sessionStorage.getItem(cacheKey(days)) || "null"); } catch { return null; }
}

/** /me/runs for the last `days`, kept live by the /me/runs/stream SSE.
 *
 *  /me/runs takes ~6 s (measured 2026-11-24, any window size), so the last
 *  answer this session is shown at once and refreshed behind it — a 6-second
 *  skeleton on every visit read as "broken". `truncated` is true when the
 *  window held more runs than the API returns (it caps at 500, no cursor). */
export function useRunsFeed(days: number) {
	const [runs, setRuns] = useState<MeRunRow[] | null>(() => readCache(days)?.runs ?? null);
	const [err, setErr] = useState<string | null>(null);
	const [asOf, setAsOf] = useState<number>(() => readCache(days)?.asOf ?? 0);

	const load = useCallback(async () => {
		try {
			const since = new Date(Date.now() - days * 86_400_000).toISOString();
			const r = await me.listRuns({ since, limit: RUNS_CAP });
			const rows = r.runs || [];
			setRuns(rows);
			setErr(null);
			const t = Date.now();
			setAsOf(t);
			try { sessionStorage.setItem(cacheKey(days), JSON.stringify({ runs: rows, asOf: t })); } catch { /* quota / private mode */ }
		} catch (e) {
			setErr(e instanceof MeApiError ? e.message : String(e));
		}
	}, [days]);

	// A different window: show its cached answer (or the skeleton) at once.
	const shownDays = useRef(days);
	useEffect(() => {
		if (shownDays.current === days) return;
		shownDays.current = days;
		const c = readCache(days);
		setRuns(c?.runs ?? null);
		setAsOf(c?.asOf ?? 0);
	}, [days]);

	useEffect(() => { void load(); }, [load]);
	// A run fired from chat shows before the next SSE tick.
	useStudioRefetch(["runs", "cycles"], load);

	useEffect(() => {
		const stop = streamRuns(
			(evt) => {
				setAsOf(Date.now());
				setRuns((prev) => {
					if (!prev) return [evt.run];
					const i = prev.findIndex((r) => r.run_id === evt.run.run_id);
					if (i === -1) return [evt.run, ...prev].slice(0, 500);
					const next = [...prev];
					next[i] = evt.run;
					return next;
				});
			},
			() => { /* the stream reconnects itself; the list stays as loaded */ },
		);
		return () => stop();
	}, []);

	return { runs, err, asOf, reload: load, truncated: (runs?.length ?? 0) >= RUNS_CAP };
}

/** Seconds since epoch, re-rendered every `ms` while the tab is visible. Off
 *  when `active` is false, so a page with nothing running doesn't tick. */
export function useNowSec(active: boolean, ms = 1000): number {
	const [now, setNow] = useState(() => Date.now() / 1000);
	useEffect(() => {
		if (!active) return;
		const id = window.setInterval(() => {
			if (document.visibilityState !== "hidden") setNow(Date.now() / 1000);
		}, ms);
		return () => window.clearInterval(id);
	}, [active, ms]);
	return now;
}

/** True only on the first mount of `key` in this browser session — for the one
 *  entrance animation a page gets. Later visits render settled. */
export function useOncePerSession(key: string): boolean {
	const first = useRef<boolean | null>(null);
	if (first.current === null) {
		let seen = false;
		try { seen = sessionStorage.getItem(`lumen_once_${key}`) === "1"; } catch { /* private mode */ }
		first.current = !seen;
		try { sessionStorage.setItem(`lumen_once_${key}`, "1"); } catch { /* private mode */ }
	}
	return first.current;
}
