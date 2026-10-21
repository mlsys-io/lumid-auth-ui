// run-routes — the addresses of a workflow and of one run, and the redirects
// from every older address into them.
//
//   /studio/apps/:app/w/:loop                     the workflow page (runs table)
//   /studio/apps/:app/w/:loop/r/:runId            one run (runId = cycle-dir id)
//        ?step=<step_id>&pane=output|log          an expanded step + its pane
//
// Before these existed nothing below the workflow was in the URL (pipeline,
// log, compare and stage were React state), so a run could not be linked,
// bookmarked or reloaded. Pure functions, no React — unit-tested in
// run-routes.test.ts.

import { toCycleId } from "@/lib/cycle-id";

const enc = encodeURIComponent;

export type RunPane = "output" | "log";

export function workflowPath(app: string, loop: string, query?: Record<string, string | undefined | null>): string {
	return `/studio/apps/${enc(app)}/w/${enc(loop)}${qs(query)}`;
}

export function runPath(
	app: string, loop: string, runId: string,
	query?: { step?: string | null; pane?: RunPane | null } & Record<string, string | undefined | null>,
): string {
	return `/studio/apps/${enc(app)}/w/${enc(loop)}/r/${enc(toCycleId(runId))}${qs(query)}`;
}

function qs(query?: Record<string, string | undefined | null>): string {
	if (!query) return "";
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) if (v != null && v !== "") sp.set(k, v);
	const s = sp.toString();
	return s ? `?${s}` : "";
}

/** The run id a /me/runs row names, when it is a scheduled cycle:
 *  "scheduled:<app>:<loop>:<ts>" → {app, loop, runId}. Other kinds → null. */
export function parseScheduledRunId(runId: string): { app: string; loop: string; runId: string } | null {
	const parts = String(runId || "").split(":");
	if (parts[0] !== "scheduled" || parts.length < 4) return null;
	const app = parts[1];
	const ts = parts[parts.length - 1];
	const loop = parts.slice(2, -1).join(":");
	if (!app || !loop || !ts) return null;
	return { app, loop, runId: toCycleId(ts) };
}

/** Where a /me/runs row opens: the run page for a scheduled cycle, the
 *  standalone run page for anything else (visual / n8n runs). */
export function runRowHref(runId: string): string {
	const s = parseScheduledRunId(runId);
	return s ? runPath(s.app, s.loop, s.runId) : `/studio/runs/${enc(runId)}`;
}

/** The old app-page query form: `/studio/apps/:app?selected=<loop>[&cycle=<ts>]`.
 *  Returns the new path (with any OTHER query params carried over), or null
 *  when the query names no workflow (the app's overview / a surface). */
export function legacyAppQueryTarget(app: string, search: string): string | null {
	const sp = new URLSearchParams(search);
	const loop = sp.get("selected");
	if (!loop || loop === "__overview__") return null;
	const cycle = sp.get("cycle");
	sp.delete("selected");
	sp.delete("cycle");
	// ?surface= names an app page; once a workflow is chosen it no longer applies.
	sp.delete("surface");
	const rest: Record<string, string> = {};
	sp.forEach((v, k) => { rest[k] = v; });
	return cycle ? runPath(app, loop, cycle, rest) : workflowPath(app, loop, rest);
}

/** /studio/intents/cycle/:app/:loop/:ts and /studio/today/cycle/... */
export function legacyCycleTarget(app: string, loop: string, ts?: string): string {
	if (!loop) return `/studio/apps/${enc(app)}`;
	return ts ? runPath(app, loop, ts) : workflowPath(app, loop);
}

/** /studio/workflows/:slug where slug = "<app>:<loop>" (or a bare app). */
export function legacyWorkflowSlugTarget(slug: string): string {
	const i = slug.indexOf(":");
	const app = i > 0 ? slug.slice(0, i) : slug;
	const loop = i > 0 ? slug.slice(i + 1) : "";
	return loop ? workflowPath(app, loop) : `/studio/apps/${enc(app)}`;
}

/** A run id in a URL may be unix seconds (the run store's form); the canonical
 *  form is the cycle-dir id. Returns the canonical id when they differ, else null. */
export function canonicalRunId(runId: string): string | null {
	const c = toCycleId(runId);
	return c && c !== runId ? c : null;
}

/** Does a /w/:loop address name a workflow this app does not have?
 *  `loops` is null while the list is still loading — never "missing" then.
 *  The app page used to fall back to the FRESHEST workflow for an unknown
 *  loop, keeping the URL while rendering another workflow's header and runs
 *  (LQ-20261006-04: …/w/qa_custom_analyze_20261006/r/… rendered Harvest
 *  outbox). An address that resolves nowhere must say so instead. */
export function routeLoopMissing(routeLoop: string | null | undefined, loops: readonly string[] | null): boolean {
	if (!routeLoop || loops === null) return false;
	return !loops.includes(routeLoop);
}

export type RunNowOutcome =
	| { state: "pending" }
	| { state: "ok"; runId: string | null; href: string | null; outcome?: string }
	| { state: "failed"; error: string };

/** What a run-now (`run_loop` intent) came to, from GET /me/intents/:id.
 *  The run id is the cycle dir's basename — the same id the run page and
 *  global Runs address it by — so the toast can link straight to the run
 *  instead of saying "watch My Jobs". */
export function runNowOutcome(
	app: string, loop: string,
	intent: { status?: string; result?: Record<string, unknown> } | null | undefined,
): RunNowOutcome {
	if (!intent || intent.status !== "completed") return { state: "pending" };
	const env = (intent.result ?? {}) as Record<string, unknown>;
	const data = (env.data && typeof env.data === "object" ? env.data : {}) as Record<string, unknown>;
	if (env.ok === false || data.ok === false) {
		const raw = String(env.error ?? data.error ?? "").trim();
		return { state: "failed", error: (raw.split(/[\r\n]/)[0] || "the run failed").slice(0, 400) };
	}
	const dir = String(data.cycle_dir ?? "").replace(/\/+$/, "");
	const base = dir ? dir.slice(dir.lastIndexOf("/") + 1) : "";
	const runId = base ? toCycleId(base) : "";
	const ranLoop = typeof data.loop === "string" && data.loop ? data.loop : loop;
	return {
		state: "ok",
		runId: runId || null,
		href: runId ? runPath(app, ranLoop, runId) : null,
		outcome: typeof data.outcome === "string" ? data.outcome : undefined,
	};
}
