// activity — what /studio/runs ("Activity") and an app's home show about runs,
// computed from /me/runs rows alone. Pure functions, no React; unit-tested in
// activity.test.ts.
//
// Why from /me/runs and not /me/workflows: on the cloud deployment the
// per-workflow run strip, cost and `running` flag in /me/workflows are read
// from cycle files identity does not mount, so they come back empty. The run
// rows (run store) are the one source that is always there.
//
// The page answers three questions, in this order:
//   1. Is anything running?        → running[]  (with how long it usually takes)
//   2. Is anything broken?         → failing[]  (a streak, not a run count)
//   3. How is each workflow doing? → apps[].workflows[]

import type { MeRunRow, SparkRun } from "@/api/me";
import { parseScheduledRunId } from "@/lib/run-routes";

export interface FailingStreak {
	/** Consecutive failed runs, newest first, ending at the latest finished run. */
	count: number;
	/** started_at (unix s) of the OLDEST run in the streak. */
	sinceSec: number;
	/** True when every finished run in the window failed (the streak may be older). */
	coversWindow: boolean;
	/** The latest failure's reason, in plain words. */
	cause: string;
	/** The latest failure's reason, verbatim (for a tooltip / disclosure). */
	rawReason: string;
	latestRunId: string;
}

export interface WorkflowActivity {
	key: string;            // `${app}:${loop}`
	app: string;
	loop: string;
	name: string;
	runs: MeRunRow[];       // newest first
	latestFinished?: MeRunRow;
	running: MeRunRow[];
	/** Run strip, oldest → newest, ≤ 14 chars: o succeeded · x failed · _ skipped · . running */
	spark: string;
	/** One entry per spark char, same order (cycle id for the dot's popover). */
	sparkRuns: SparkRun[];
	/** Median duration of this workflow's finished runs, seconds. */
	typicalS?: number;
	costCents: number;
	failing?: FailingStreak;
}

export interface AppActivity {
	app: string;
	workflows: WorkflowActivity[];
	runningCount: number;
	failingCount: number;
	latestSec: number;
}

export interface RunningItem {
	run: MeRunRow;
	wf: WorkflowActivity;
}

export interface Activity {
	running: RunningItem[];
	failing: WorkflowActivity[];
	apps: AppActivity[];
}

const SPARK_MAX = 14;
const OTHER_APP = "";

/** The workflow (loop) a run row belongs to. */
export function loopOfRun(r: MeRunRow): string {
	const slug = r.workflow_slug || "";
	if (r.app && slug.startsWith(r.app + ":")) return slug.slice(r.app.length + 1);
	const i = slug.indexOf(":");
	return i >= 0 ? slug.slice(i + 1) : slug || r.name || "";
}

function sparkChar(state: string): string {
	switch (state) {
		case "succeeded": return "o";
		case "recovered": return "r";
		case "failed": return "x";
		case "running": return ".";
		default: return "_";
	}
}

function median(xs: number[]): number | undefined {
	if (!xs.length) return undefined;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarise(key: string, app: string, loop: string, rowsNewestFirst: MeRunRow[]): WorkflowActivity {
	const runs = rowsNewestFirst;
	const running = runs.filter((r) => r.state === "running");
	const finished = runs.filter((r) => r.state !== "running");
	const latestFinished = finished[0];

	// The strip: newest 14, drawn oldest → newest.
	const stripRuns = runs.slice(0, SPARK_MAX).reverse();
	const spark = stripRuns.map((r) => sparkChar(r.state)).join("");
	const sparkRuns: SparkRun[] = stripRuns.map((r) => ({
		ts: parseScheduledRunId(r.run_id)?.runId || "",
		st: sparkChar(r.state),
	}));

	// "Usually takes": successful runs first (a failure often dies early);
	// fall back to every finished run when there are too few successes.
	const okDur = finished.filter((r) => r.state === "succeeded" && (r.duration_s || 0) > 0).map((r) => r.duration_s as number);
	const anyDur = finished.filter((r) => (r.duration_s || 0) > 0).map((r) => r.duration_s as number);
	const typicalS = median(okDur.length >= 2 ? okDur : anyDur);

	// A failing streak = consecutive failures ending at the latest finished run.
	// Skipped runs don't break it (a skip is "nothing to do", not a recovery).
	let failing: FailingStreak | undefined;
	if (latestFinished?.state === "failed") {
		let count = 0;
		let oldest = latestFinished;
		let brokeOnSuccess = false;
		for (const r of finished) {
			if (r.state === "failed") { count++; oldest = r; continue; }
			if (r.state === "skipped" || r.state === "canceled") continue;
			brokeOnSuccess = true;
			break;
		}
		failing = {
			count,
			sinceSec: oldest.started_at,
			coversWindow: !brokeOnSuccess,
			cause: plainCause(latestFinished.reason),
			rawReason: latestFinished.reason || "",
			latestRunId: latestFinished.run_id,
		};
	}

	return {
		key, app, loop,
		name: runs[0]?.name || loop,
		runs, latestFinished, running, spark, sparkRuns, typicalS,
		costCents: runs.reduce((s, r) => s + (r.cost_cents || 0), 0),
		failing,
	};
}

/** Group /me/runs rows into the Activity view. `app` narrows to one app. */
export function groupActivity(rows: MeRunRow[], opts: { app?: string } = {}): Activity {
	const byWf = new Map<string, { app: string; loop: string; rows: MeRunRow[] }>();
	for (const r of rows) {
		const app = r.app || OTHER_APP;
		if (opts.app && app !== opts.app) continue;
		const loop = loopOfRun(r);
		const key = `${app}:${loop}`;
		let g = byWf.get(key);
		if (!g) { g = { app, loop, rows: [] }; byWf.set(key, g); }
		g.rows.push(r);
	}

	const wfs: WorkflowActivity[] = [];
	for (const [key, g] of byWf) {
		g.rows.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
		wfs.push(summarise(key, g.app, g.loop, g.rows));
	}

	const latest = (w: WorkflowActivity) => w.runs[0]?.started_at || 0;
	// Within an app: broken first, then running, then most recent.
	const rank = (w: WorkflowActivity) => (w.failing ? 0 : w.running.length ? 1 : 2);
	wfs.sort((a, b) => rank(a) - rank(b) || latest(b) - latest(a));

	const byApp = new Map<string, AppActivity>();
	for (const w of wfs) {
		let a = byApp.get(w.app);
		if (!a) { a = { app: w.app, workflows: [], runningCount: 0, failingCount: 0, latestSec: 0 }; byApp.set(w.app, a); }
		a.workflows.push(w);
		a.runningCount += w.running.length;
		if (w.failing) a.failingCount++;
		a.latestSec = Math.max(a.latestSec, latest(w));
	}
	const apps = [...byApp.values()].sort(
		(a, b) => (b.runningCount > 0 ? 1 : 0) - (a.runningCount > 0 ? 1 : 0)
			|| (b.failingCount > 0 ? 1 : 0) - (a.failingCount > 0 ? 1 : 0)
			|| b.latestSec - a.latestSec,
	);

	const running: RunningItem[] = wfs
		.flatMap((wf) => wf.running.map((run) => ({ run, wf })))
		.sort((a, b) => (b.run.started_at || 0) - (a.run.started_at || 0));
	const failing = wfs.filter((w) => w.failing).sort((a, b) => (b.failing!.count - a.failing!.count) || latest(b) - latest(a));

	return { running, failing, apps };
}

// ── Plain words ────────────────────────────────────────────────────────────

const HTTP_WORDS: Record<string, string> = {
	"400": "Bad request", "401": "Not signed in", "403": "Not allowed", "404": "Not found",
	"408": "Timed out", "409": "Conflict", "429": "Rate-limited",
	"500": "Server error", "502": "Service unavailable", "503": "Service unavailable", "504": "Timed out",
};

function sentence(s: string): string {
	const t = s.trim().replace(/\s+/g, " ");
	return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Prefix + body; after a prefix the body continues the sentence (lower-case). */
function withPrefix(prefix: string, body: string): string {
	if (!prefix || !body) return prefix + body;
	return prefix + body[0].toLowerCase() + body.slice(1);
}

function clip(s: string, n = 90): string {
	if (s.length <= n) return s;
	const cut = s.slice(0, n);
	const sp = cut.lastIndexOf(" ");
	return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.(]+$/, "") + "…";
}

/** "3 case(s), 1 question(s)" → "3 cases, 1 question". */
function plurals(s: string): string {
	return s.replace(/(\d+)\s+(\w+)\(s\)/g, (_m, n: string, w: string) => `${n} ${w}${n === "1" ? "" : "s"}`);
}

/** A run's failure reason in plain words. The raw text stays available to the
 *  caller (tooltip / disclosure); this is the one line a person reads. */
export function plainCause(reason?: string | null): string {
	let s = String(reason ?? "").trim();
	if (!s) return "No reason recorded";

	// A Python dict dumped as the reason: its `outcome` is the readable part.
	const outcome = s.match(/['"]outcome['"]\s*:\s*['"]([^'"]+)['"]/);
	if (outcome) s = outcome[1];

	// "every arm failed: {...}" — every version of an experiment failed.
	let prefix = "";
	const every = s.match(/^every arm failed:\s*(.*)$/i);
	if (every) { prefix = "Every version failed: "; s = every[1].replace(/^\{\s*['"][^'"]+['"]\s*:\s*['"]?/, ""); }

	// "<context>: HTTP Error 503: Service Unavailable" / "HTTP 500: {json}"
	const http = s.match(/^(.*?)(?:HTTP(?: Error)?\s*|\()(\d{3})\b/i);
	if (http && HTTP_WORDS[http[2]]) {
		const ctx = http[1].replace(/[:\s(]+$/, "").replace(/^\w+(Error|Exception):\s*/, "");
		const words = `${HTTP_WORDS[http[2]].toLowerCase()} (HTTP ${http[2]})`;
		return clip(withPrefix(prefix, ctx ? `${sentence(ctx)}: ${words}` : sentence(words)));
	}

	if (/timed? ?out|TimeoutError|deadline exceeded/i.test(s)) return prefix + "Timed out";

	// A bare snake_case outcome ("backend_unavailable").
	if (/^[a-z]+(_[a-z]+)+$/.test(s)) return withPrefix(prefix, sentence(s.replace(/_/g, " ")));

	// "SomeError: message" → "App error: message" (the class name is noise).
	const exc = s.match(/^(\w+(?:Error|Exception)):\s*(.*)$/);
	if (exc) return clip(prefix + (exc[2] ? `App error: ${exc[2]}` : `App error (${exc[1]})`));

	return clip(withPrefix(prefix, sentence(plurals(s))));
}

/** "51s", "1m 40s", "2h 05m". */
export function fmtDuration(sec?: number | null): string {
	if (sec == null || !isFinite(sec) || sec < 0) return "";
	const s = Math.round(sec);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "~51s", "~2 min", "~1 h" — a typical duration, rounded for reading. */
export function fmtTypical(sec?: number | null): string {
	if (sec == null || !isFinite(sec) || sec <= 0) return "";
	if (sec < 90) return `~${Math.max(1, Math.round(sec))}s`;
	if (sec < 5400) return `~${Math.round(sec / 60)} min`;
	return `~${Math.round(sec / 3600)} h`;
}

/** How far a running run is through its usual duration: 0..1, or null when
 *  there is no typical duration to compare against. */
export function progressOf(elapsedS: number, typicalS?: number): number | null {
	if (!typicalS || typicalS <= 0) return null;
	return Math.max(0, Math.min(1, elapsedS / typicalS));
}

/** Overdue = clearly past the usual time (1.5× and at least 30s over). */
export function isOverdue(elapsedS: number, typicalS?: number): boolean {
	if (!typicalS || typicalS <= 0) return false;
	return elapsedS > typicalS * 1.5 && elapsedS - typicalS > 30;
}

/** "since 22 Nov" / "since 13:05" (today). */
export function fmtSince(sec: number, now = Date.now()): string {
	const d = new Date(sec * 1000);
	const today = new Date(now);
	if (d.toDateString() === today.toDateString()) {
		return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	}
	return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
