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
import { isVirtualScope } from "@/lib/chat-scopes";

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
	/** Runs that finished without doing the work (refused, not measured): not
	 *  successes, not failures — counted apart ("2 didn't run"). */
	didntRun: number;
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

// The words a run row's `reason` carries when the run was refused or could not
// be measured (a daily GPU cap, no free worker). Identity copies the run's
// outcome into `reason`; an app reports these as its status/outcome.
const DIDNT_RUN = /^(not[_ ]measured|not[_ ]run|didn'?t[_ ]run|refused|over[_ ]budget|daily[_ ]cap|no[_ ]worker)\b/i;

/** A finished run that didn't do the work: it neither succeeded nor failed. */
export function didntRun(r: Pick<MeRunRow, "state" | "reason">): boolean {
	return (r.state === "succeeded" || r.state === "skipped") && DIDNT_RUN.test((r.reason || "").trim());
}

/** "67 runs" · "67 runs · 2 didn't run". */
export function runCountWords(wf: Pick<WorkflowActivity, "runs" | "didntRun">): string {
	const n = wf.runs.length;
	return `${n} run${n === 1 ? "" : "s"}${wf.didntRun ? ` · ${wf.didntRun} didn't run` : ""}`;
}

/** "1 result" / "3 results" — a count and its noun, singular when it is one. */
export function plural(n: number, noun: string, many = `${noun}s`): string {
	return `${n.toLocaleString()} ${n === 1 ? noun : many}`;
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
	// A run that didn't run is not a gold success on the strip: it draws as a skip.
	const charOf = (r: MeRunRow) => (didntRun(r) ? "_" : sparkChar(r.state));
	const spark = stripRuns.map(charOf).join("");
	const sparkRuns: SparkRun[] = stripRuns.map((r) => ({
		ts: parseScheduledRunId(r.run_id)?.runId || "",
		st: charOf(r),
	}));

	// "Usually takes": successful runs first (a failure often dies early);
	// fall back to every finished run when there are too few successes.
	const okDur = finished.filter((r) => r.state === "succeeded" && !didntRun(r) && (r.duration_s || 0) > 0).map((r) => r.duration_s as number);
	const anyDur = finished.filter((r) => !didntRun(r) && (r.duration_s || 0) > 0).map((r) => r.duration_s as number);
	const typicalS = median(okDur.length >= 2 ? okDur : anyDur);

	// A failing streak = consecutive failures ending at the latest finished run.
	// Skipped runs don't break it (a skip is "nothing to do", not a recovery),
	// and neither does a run that didn't run: it proves nothing works.
	let failing: FailingStreak | undefined;
	const latestDecisive = finished.find((r) => !didntRun(r) && r.state !== "skipped" && r.state !== "canceled");
	if (latestDecisive?.state === "failed") {
		let count = 0;
		let oldest = latestDecisive;
		let brokeOnSuccess = false;
		for (const r of finished) {
			if (r.state === "failed") { count++; oldest = r; continue; }
			if (r.state === "skipped" || r.state === "canceled" || didntRun(r)) continue;
			brokeOnSuccess = true;
			break;
		}
		failing = {
			count,
			sinceSec: oldest.started_at,
			coversWindow: !brokeOnSuccess,
			cause: plainCause(latestDecisive.reason),
			rawReason: latestDecisive.reason || "",
			latestRunId: latestDecisive.run_id,
		};
	}

	return {
		key, app, loop,
		name: runs[0]?.name || loop,
		runs, latestFinished, running, spark, sparkRuns, typicalS,
		costCents: runs.reduce((s, r) => s + (r.cost_cents || 0), 0),
		failing,
		didntRun: finished.filter(didntRun).length,
	};
}

/** A run its owner stopped by hand reads as cancelled, not failed: /me/runs
 *  reports it `failed` with reason "user_stopped", which counted toward
 *  "34 failed", the failing streak and the Failed filter (2026-11-28). */
export function normalizeRun<T extends { state: string; reason?: string | null }>(r: T): T {
	return r.state === "failed" && /^\s*(user[_ ]stopped|stopped by (the )?user|interrupted)\s*$/i.test(r.reason || "")
		? { ...r, state: "canceled" } : r;
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

// ── The run list (Activity → Timeline → List) ──────────────────────────────
// 2026-11-28 audit: at ?state=failed the list showed "Unknown case id(s): …"
// three times and "Nothing to answer: …" several times as separate rows, and
// runs of apps the user had since removed filled it. Repeats collapse into one
// row ("Case eval · 3× Unknown case id …", expand to see each run), and runs of
// removed apps sit behind a toggle, labelled as such.

/** The App column's tag for a run whose app is no longer installed. */
export const REMOVED_APP = "removed app";

type ListRun = Pick<MeRunRow, "run_id" | "app" | "workflow_slug" | "state" | "reason">;

/** True when the run's app is not installed any more. Unknown (`installed`
 *  missing or empty — still loading, or the read failed) is never "removed",
 *  and neither is a run with no app or a first-party surface's virtual scope. */
export function isRemovedApp(app: string | null | undefined, installed?: ReadonlySet<string> | null): boolean {
	if (!app || !installed || installed.size === 0 || isVirtualScope(app)) return false;
	return !installed.has(app);
}

export interface RunListGroup<T extends ListRun = MeRunRow> {
	/** The first (newest) run's id. */
	key: string;
	/** One or more runs, in list order (newest first). */
	runs: T[];
	app: string;
	workflow: string;
	state: string;
	/** The shared Detail text ("" when the runs say nothing). */
	detail: string;
	removed: boolean;
}

/** The run list as rows: consecutive runs of the same workflow, state and
 *  (non-empty) detail collapse into one group; runs of removed apps are left
 *  out unless `showRemoved`, and then come after the rest. `removed` is how
 *  many runs belong to removed apps (shown or not). */
export function runListGroups<T extends ListRun>(runs: T[], opts: {
	installed?: ReadonlySet<string> | null;
	showRemoved?: boolean;
	/** The Detail column's words for a run (default: plainCause for a failure, else the reason). */
	detail?: (r: T) => string;
} = {}): { groups: RunListGroup<T>[]; removed: number } {
	const detailOf = opts.detail ?? ((r: T) => (r.state === "failed" ? plainCause(r.reason) : (r.reason || "").trim()));
	const kept: T[] = [];
	const gone: T[] = [];
	for (const r of runs) (isRemovedApp(r.app, opts.installed) ? gone : kept).push(r);
	const ordered = opts.showRemoved ? [...kept, ...gone] : kept;
	const groups: RunListGroup<T>[] = [];
	for (const r of ordered) {
		const app = r.app || "";
		const workflow = r.workflow_slug || "";
		const detail = detailOf(r) || "";
		const removed = isRemovedApp(app, opts.installed);
		const last = groups[groups.length - 1];
		if (last && detail && last.detail === detail && last.app === app && last.workflow === workflow && last.state === r.state && last.removed === removed) {
			last.runs.push(r);
			continue;
		}
		groups.push({ key: r.run_id, runs: [r], app, workflow, state: r.state, detail, removed });
	}
	return { groups, removed: gone.length };
}

/** The Detail column for a group: "3× Unknown case id …" (or the detail alone for one run). */
export function runGroupDetail(g: Pick<RunListGroup<ListRun>, "runs" | "detail">): string {
	if (g.runs.length < 2) return g.detail;
	return g.detail ? `${g.runs.length}× ${g.detail}` : `${g.runs.length} runs`;
}

/** A group in one line, for its title and screen readers: "Case eval · 3× Unknown case id …". */
export function runGroupLabel(name: string, g: Pick<RunListGroup<ListRun>, "runs" | "detail">): string {
	const d = runGroupDetail(g);
	return d ? `${name} · ${d}` : name;
}

/** What an empty list says when every run in it belongs to a removed app. */
export function onlyRemovedAppsWords(n: number): string {
	return n === 1 ? "The one run here is from an app you removed." : `All ${n.toLocaleString()} runs here are from apps you removed.`;
}

/** The toggle beside the list: "Show runs of removed apps (12)". */
export function removedAppsToggleLabel(n: number): string {
	return `Show runs of removed apps (${n.toLocaleString()})`;
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

	// "Stage 2 (dev_eval) failed: <why>" (the chain engine): name the step,
	// then the cause in the same words — the step was the half people lost
	// (2026-11-28, consulting student: "Screen is failing" said neither).
	const stage = s.match(/^Stage \d+ \(([^)]+)\) failed:?\s*([\s\S]*)$/i);
	if (stage) {
		const step = sentence(stage[1].replace(/[_-]+/g, " "));
		return stage[2].trim() ? clip(`At ${step}: ${plainCause(stage[2])}`) : `At ${step}`;
	}

	// "sandbox:None failed: no error text" — a step that failed and said nothing.
	const silent = s.match(/^([\w-]+)(?::[\w-]+)? failed: no error text\.?$/i);
	if (silent) {
		const w = silent[1].replace(/[_-]+/g, " ").trim();
		return `${w.charAt(0).toUpperCase()}${w.slice(1)} failed without an error message`;
	}

	// "every arm failed: {...}" — every version of an experiment failed.
	let prefix = "";
	const every = s.match(/^every arm failed:\s*(.*)$/i);
	if (every) { prefix = "Every version failed: "; s = every[1].replace(/^\{\s*['"][^'"]+['"]\s*:\s*['"]?/, ""); }

	// "commands/x.py exited with status 2: <usage>; x: error: <msg> — <hint>"
	// (argparse and friends): the part after "error:" is the reason.
	const exited = s.match(/exited with (?:status|code) (\d+)/i);
	if (exited) {
		const msg = s.match(/\berror:\s*([^—\n]+)/i)?.[1]?.trim().replace(/[.;]$/, "");
		return clip(withPrefix(prefix, msg ? `App error: ${msg}` : `The app's command stopped (exit ${exited[1]})`));
	}

	// "<context>: HTTP Error 503: Service Unavailable" / "HTTP 500: {json}"
	// The paren form only as "(500):" — a bare "(404 duplicate keys)" is a count.
	const http = s.match(/^(.*?)(?:HTTP(?: Error)?\s*(\d{3})\b|\((\d{3})\)\s*:)/i);
	const code = http ? (http[2] || http[3]) : "";
	if (http && HTTP_WORDS[code]) {
		const ctx = http[1].replace(/[:\s(]+$/, "").replace(/^\w+(Error|Exception):\s*/, "");
		const words = `${HTTP_WORDS[code].toLowerCase()} (HTTP ${code})`;
		return clip(withPrefix(prefix, ctx ? `${sentence(ctx)}: ${words}` : sentence(words)));
	}

	if (/(?<![-\w])(timed? ?out|TimeoutError|deadline exceeded)/i.test(s)) return prefix + "Timed out";


	// A bare snake_case outcome ("backend_unavailable").
	if (/^[a-z]+(_[a-z]+)+$/.test(s)) return withPrefix(prefix, sentence(s.replace(/_/g, " ")));

	// "SomeError: message" → "App error: message" (the class name is noise).
	const exc = s.match(/^(\w+(?:Error|Exception)):\s*(.*)$/);
	if (exc) return clip(prefix + (exc[2] ? `App error: ${exc[2]}` : `App error (${exc[1]})`));

	return clip(withPrefix(prefix, sentence(plurals(s))));
}

/** "723ms", "51s", "1m 40s", "2h 05m". */
export function fmtDuration(sec?: number | null): string {
	if (sec == null || !isFinite(sec) || sec < 0) return "";
	if (sec < 1) return `${Math.round(sec * 1000)}ms`;
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

/** "22 Nov" / "13:05 today" — the date a streak began. */
export function fmtSince(sec: number, now = Date.now()): string {
	const d = new Date(sec * 1000);
	const today = new Date(now);
	if (d.toDateString() === today.toDateString()) {
		// "since 10:56" alone read as a time with no day (first-glance test).
		return `${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} today`;
	}
	return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "just now", "12m ago", "3h ago", "2d ago". */
export function fmtAgo(sec: number, now = Date.now() / 1000): string {
	const d = Math.max(0, now - sec);
	if (d < 60) return "just now";
	if (d < 3600) return `${Math.floor(d / 60)}m ago`;
	if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
	return `${Math.floor(d / 86400)}d ago`;
}

/** Cycle dir-id "20261124T141039Z" → epoch seconds (null if it isn't one). */
export function dirIdToSec(id?: string | null): number | null {
	const m = (id || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return null;
	return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}

/** The workflow page's one-line answer to "is it working?", from its run list
 *  (newest first). `tone` picks the icon and colour; the text stands alone. */
export interface WorkflowStatusLine {
	tone: "failing" | "ok" | "none";
	text: string;
	/** The run to open for the failing case (the newest failed one). */
	runId?: string;
}

export function workflowStatusLine(
	cycles: Array<{ ts: string; ok?: boolean; running?: boolean; duration_s?: number }>,
	now = Date.now() / 1000,
): WorkflowStatusLine {
	const done = cycles.filter((c) => !c.running && c.ok !== undefined);
	if (done.length === 0) return { tone: "none", text: cycles.length ? "First run in progress" : "Hasn't run yet" };
	const last = done[0];
	const lastSec = dirIdToSec(last.ts);
	if (last.ok) {
		const dur = fmtDuration(last.duration_s);
		return { tone: "ok", text: `Latest run succeeded${lastSec ? ` ${fmtAgo(lastSec, now)}` : ""}${dur ? ` · took ${dur}` : ""}` };
	}
	let n = 0;
	while (n < done.length && done[n].ok === false) n++;
	const oldest = dirIdToSec(done[n - 1].ts);
	const since = oldest ? fmtSince(oldest, now * 1000) : "";
	if (n === 1) return { tone: "failing", text: `Latest run failed${lastSec ? ` ${fmtAgo(lastSec, now)}` : ""}`, runId: last.ts };
	// The streak reaches the end of what was LOADED (the page asks for the
	// newest 50): its true start is unknown, so no "since" date — Activity
	// (which reads further back) would otherwise disagree with this page.
	if (n === done.length) return { tone: "failing", text: `The last ${n} runs all failed`, runId: last.ts };
	return { tone: "failing", text: `Failing${since ? ` since ${since}` : ""} · ${n} runs in a row`, runId: last.ts };
}

/** When a cron next fires, in epoch seconds — ONLY for schedules whose next
 *  time does not depend on the scheduler's timezone (America/Los_Angeles,
 *  never the viewer's): "M * * * *" and "*\/N * * * *" with N dividing 60.
 *  Anything else returns null and the UI says no time rather than a wrong one. */
export function nextFireSec(cron: string | undefined, now = Date.now() / 1000): number | null {
	const raw = (cron || "").trim().replace(/\s+/g, " ");
	let m = raw.match(/^(\d{1,2}) \* \* \* \*$/);
	if (raw === "@hourly") m = ["", "0"] as unknown as RegExpMatchArray;
	if (m) {
		const minute = +m[1];
		if (minute > 59) return null;
		const hourStart = Math.floor(now / 3600) * 3600;
		const t = hourStart + minute * 60;
		return t > now ? t : t + 3600;
	}
	m = raw.match(/^\*\/(\d{1,2}) \* \* \* \*$/) || raw.match(/^\*\/(\d{1,2})m$/i);
	if (m) {
		const n = +m[1];
		if (!n || 60 % n !== 0) return null;
		const step = n * 60;
		return (Math.floor(now / step) + 1) * step;
	}
	return null;
}

/** One sentence for a failing streak — used by Activity AND the workflow page,
 *  so the two can never disagree about the same workflow. `span` is "since
 *  18 Nov" / "in the last 7 days" for a streak that covers the whole window. */
export function failingSentence(f: FailingStreak, span: string): string {
	return f.coversWindow
		? `Every run ${span} failed (${f.count})`
		: `Failing since ${fmtSince(f.sinceSec)} · ${f.count} run${f.count === 1 ? "" : "s"} in a row`;
}
