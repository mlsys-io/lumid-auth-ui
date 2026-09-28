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
