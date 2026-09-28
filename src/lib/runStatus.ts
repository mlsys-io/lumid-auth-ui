// runStatus — ONE status vocabulary for a run, whatever surface reported it.
//
// Measured 2026-09-28: a reader met runs in four places with five different
// vocabularies — /me/runs (succeeded/failed/running/skipped/recovered/canceled),
// a cycle (ok: true|false, running), FlowMesh (DONE/FAILED/CANCELLED/PENDING/
// DISPATCHED), experiments (decided/running/pending) and the run queue
// ("Queued"). The same run could read "DONE" on one page and "ok" on another.
//
// Every surface now maps its raw state through `runStatus()` onto six words —
// queued · running · succeeded · failed · skipped · cancelled — and keeps the
// raw value for a tooltip, so nothing the source said is thrown away.

import type { ToneKey } from "@/lib/tones";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export const RUN_STATUSES: RunStatus[] = ["queued", "running", "succeeded", "failed", "skipped", "cancelled"];

export interface RunStatusInfo {
	status: RunStatus;
	/** What the source actually said, verbatim (for the tooltip). */
	raw: string;
	/** Succeeded only via retry / fallback (me/runs `recovered`, spark `r`). */
	recovered?: boolean;
}

// Lower-cased raw state → unified status. One table, so a new source is a new
// row here rather than a new switch somewhere else.
const TABLE: Record<string, RunStatus> = {
	// me/runs + generic
	succeeded: "succeeded", success: "succeeded", ok: "succeeded", done: "succeeded",
	completed: "succeeded", complete: "succeeded", recovered: "succeeded", passed: "succeeded",
	decided: "succeeded", concluded: "succeeded",
	failed: "failed", failure: "failed", error: "failed", errored: "failed", failing: "failed",
	running: "running", "in_progress": "running", started: "running", active: "running",
	dispatched: "running", collecting: "running",
	skipped: "skipped", "no_change": "skipped", "no_setup": "skipped", noop: "skipped",
	canceled: "cancelled", cancelled: "cancelled", aborted: "cancelled", stopped: "cancelled",
	queued: "queued", pending: "queued", scheduled: "queued", waiting: "queued", created: "queued",
	// RunSparkline state chars (MeWorkflowRow.run_spark)
	o: "succeeded", r: "succeeded", x: "failed", _: "skipped", ".": "running",
};

/** Map any raw run state (string) onto the unified vocabulary. Unknown → queued
 *  only when empty; otherwise the raw word is kept and treated as skipped, so an
 *  unrecognised state never paints as success or failure. */
export function runStatus(raw: string | null | undefined): RunStatusInfo {
	const s = String(raw ?? "").trim();
	if (!s) return { status: "queued", raw: "" };
	// Spark chars are case-sensitive single characters; everything else is not.
	const key = s.length === 1 ? s : s.toLowerCase();
	const status = TABLE[key] ?? "skipped";
	return { status, raw: s, recovered: key === "recovered" || key === "r" || undefined };
}

/** A cycle row / cycle detail: `ok` true|false plus an optional `running`. */
export function cycleStatus(c: { ok?: boolean | null; running?: boolean | null } | null | undefined): RunStatusInfo {
	if (!c) return { status: "queued", raw: "" };
	if (c.running) return { status: "running", raw: "running" };
	if (c.ok === true) return { status: "succeeded", raw: "ok: true" };
	if (c.ok === false) return { status: "failed", raw: "ok: false" };
	return { status: "skipped", raw: "ok: (not recorded)" };
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
	queued: "Queued",
	running: "Running",
	succeeded: "Succeeded",
	failed: "Failed",
	skipped: "Skipped",
	cancelled: "Cancelled",
};

export const RUN_STATUS_TONE: Record<RunStatus, ToneKey> = {
	queued: "idle",
	running: "running",
	succeeded: "ok",
	failed: "failing",
	skipped: "idle",
	cancelled: "idle",
};

/** Tooltip text: the unified word plus what the source said. */
export function runStatusTitle(info: RunStatusInfo): string {
	const base = RUN_STATUS_LABEL[info.status] + (info.recovered ? " (recovered via retry)" : "");
	return info.raw ? `${base} — source said "${info.raw}"` : base;
}
