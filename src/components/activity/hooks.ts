// Hooks behind Activity: the runs feed (load + live SSE), a ticking clock for
// elapsed times, and "first view this session" for the one entrance animation.

import { useCallback, useEffect, useRef, useState } from "react";
import { me, streamRuns, MeApiError, type MeRunRow } from "@/api/me";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";

/** One /me/runs page. Since identity v0.5.477 the response carries a
 *  keyset `next_cursor` + `has_more`, so a window can be read past it. */
export const RUNS_CAP = 500;
/** How many rows the feed reads at most (4 pages): enough for a 30-day
 *  window on today's busiest tenant; past it the page says "the newest N". */
export const FEED_MAX = 2000;

const cacheKey = (days: number, state = "") => `studio_runs_feed_v1:${days}${state ? `:${state}` : ""}`;
/** The Activity feed this session already loaded, if any (no request). */
export function readRunsCache(days: number, state = ""): { runs: MeRunRow[]; asOf: number } | null {
	return readCache(days, state);
}
function readCache(days: number, state = ""): { runs: MeRunRow[]; asOf: number } | null {
	try { return JSON.parse(sessionStorage.getItem(cacheKey(days, state)) || "null"); } catch { return null; }
}

/** /me/runs for the last `days`, kept live by the /me/runs/stream SSE.
 *
 *  The last answer this session is shown at once and refreshed behind it
 *  (until identity v0.5.477 the endpoint took ~6 s on every call, waiting on
 *  a decommissioned n8n; now ~0.15 s). The window is read page by page with
 *  the keyset cursor, up to FEED_MAX rows; `truncated` is true when the
 *  window still held more. */
export function useRunsFeed(days: number, state = "", workflow = "") {
	// The cache is keyed by every server-side filter (state, then workflow).
	const fkey = workflow ? `${state}|wf=${workflow}` : state;
	const [runs, setRuns] = useState<MeRunRow[] | null>(() => readCache(days, fkey)?.runs ?? null);
	const [err, setErr] = useState<string | null>(null);
	const [asOf, setAsOf] = useState<number>(() => readCache(days, fkey)?.asOf ?? 0);
	// The window held more runs than the feed read (FEED_MAX). Before
	// v0.5.477 there was no cursor, so a full first page meant "capped".
	const [truncated, setTruncated] = useState<boolean>(() => (readCache(days, fkey)?.runs.length ?? 0) >= RUNS_CAP);
	// identity's per-source outcome for lum.id/data jobs (`sources.jobs`).
	const [jobsSource, setJobsSource] = useState<string | null>(null);

	// /me/runs takes ~6 s, so switching the window mid-load leaves two requests
	// in flight; only the newest may land, or 30 days of runs show under "24h".
	const reqId = useRef(0);
	const load = useCallback(async () => {
		const mine = ++reqId.current;
		try {
			const since = new Date(Date.now() - days * 86_400_000).toISOString();
			// A state filter goes to the SERVER: filtering the newest 500 runs of
			// every state in the browser drops older matches past the cap.
			let r = await me.listRuns({ since, limit: RUNS_CAP, ...(state ? { state } : {}), ...(workflow ? { workflow } : {}) });
			if (mine !== reqId.current) return;
			const rows = [...(r.runs || [])];
			setJobsSource(r.sources?.jobs ?? null);
			// The first page shows at once — with its time — and older pages are
			// appended behind it.
			setRuns(rows.slice());
			setErr(null);
			setAsOf(Date.now());
			let more = !!r.has_more && !!r.next_cursor;
			while (more && rows.length < FEED_MAX) {
				r = await me.listRuns({ since, limit: RUNS_CAP, cursor: r.next_cursor, ...(state ? { state } : {}), ...(workflow ? { workflow } : {}) });
				if (mine !== reqId.current) return;
				const page = r.runs || [];
				// An empty page ends the window, whatever has_more said.
				if (page.length === 0) { more = false; break; }
				// Keyset pages should not overlap; if a row ever shows up twice
				// (a run that moved while we paged), keep the first sighting.
				const seen = new Set(rows.map((x) => x.run_id));
				const fresh = page.filter((x) => !seen.has(x.run_id));
				// A page of rows already read (a filtered read can say has_more
				// when nothing new follows) ends it too, rather than looping.
				if (!fresh.length) { more = false; break; }
				rows.push(...fresh);
				setRuns(rows.slice());
				more = !!r.has_more && !!r.next_cursor;
			}
			setTruncated(more);
			setErr(null);
			const t = Date.now();
			setAsOf(t);
			try { sessionStorage.setItem(cacheKey(days, fkey), JSON.stringify({ runs: rows, asOf: t })); } catch { /* quota / private mode */ }
		} catch (e) {
			if (mine !== reqId.current) return;
			setErr(e instanceof MeApiError ? e.message : String(e));
		}
	}, [days, state, workflow]);

	// A different window or filter: show its cached answer (or the skeleton) at once.
	const shownKey = useRef(cacheKey(days, fkey));
	useEffect(() => {
		const k = cacheKey(days, fkey);
		if (shownKey.current === k) return;
		shownKey.current = k;
		const c = readCache(days, fkey);
		setRuns(c?.runs ?? null);
		setAsOf(c?.asOf ?? 0);
	}, [days, fkey]);

	useEffect(() => { void load(); }, [load]);
	// A run fired from chat shows before the next SSE tick.
	useStudioRefetch(["runs", "cycles"], load);

	const stateRef = useRef(state);
	stateRef.current = state;
	useEffect(() => {
		const stop = streamRuns(
			(evt) => {
				setAsOf(Date.now());
				setRuns((prev) => {
					if (!prev) return [evt.run];
					const i = prev.findIndex((r) => r.run_id === evt.run.run_id);
					if (i === -1) return [evt.run, ...prev].slice(0, FEED_MAX);
					const next = [...prev];
					next[i] = evt.run;
					return next;
				});
			},
			() => { /* the stream reconnects itself; the list stays as loaded */ },
		);
		return () => stop();
	}, []);

	return { runs, err, asOf, reload: load, truncated, jobsSource };
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
