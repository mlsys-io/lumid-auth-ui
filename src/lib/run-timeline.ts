// The run page's step timeline, as data: the runner's self-reported events
// (identity v0.5.476+) grouped under stage labels, with offsets from the run's
// start and the first failure in words. Pure — tested in run-timeline.test.ts.

import type { MeRunStepEvent } from "@/api/me";
import { fmtDuration, plainCause } from "@/lib/activity";
import { gateReasonWords } from "@/lib/run-answer";

export const STAGES = ["observe", "hypothesize", "act", "analyze", "learn"] as const;
const STAGE_LABEL: Record<string, string> = {
	observe: "Observe", hypothesize: "Hypothesize", act: "Act", analyze: "Analyze", learn: "Learn",
};
const KIND_WORD: Record<string, string> = { llm: "model call", tool: "tool", command: "command", stage: "stage" };

export interface TimelineRow {
	i: number;
	name: string;
	stage: string;      // label ("Act"), "" when the run named none
	kind: string;       // in words
	ok: boolean;
	/** A gate held this step back: it didn't run, and it didn't fail. */
	held: boolean;
	running: boolean;
	offset: string;     // "+0:19"
	duration: string;   // "33s", "" when unknown
	summary: string;
}
export interface TimelineGroup { stage: string; rows: TimelineRow[] }
export interface Timeline {
	groups: TimelineGroup[]; rows: TimelineRow[]; failure: string | null; total: string;
	/** "Sandbox held (not run)" when a gate held steps back; null otherwise. */
	held: string | null;
}

/** A step a gate held back (a chain records `{ok: false, summary: "held"}`). */
export function eventHeld(e: Pick<MeRunStepEvent, "ok" | "summary">): boolean {
	return e.ok === false && (e.summary || "").trim().toLowerCase() === "held";
}

/** "engine_command" → "Ran the app's command"; "score_docs" → "Score docs". */
export function stepName(id: string, app = ""): string {
	if (id === "engine_command") return app ? `Ran ${app.replace(/[-_]+/g, " ")}` : "Ran the app's command";
	if (id === "engine_compute") return "Ran on the compute fleet";
	const w = id.replace(/[-_]+/g, " ").trim();
	return w.charAt(0).toUpperCase() + w.slice(1);
}

/** "+0:19", "+12:05", "+1:02:07". */
export function fmtOffset(sec: number): string {
	const s = Math.max(0, Math.round(sec));
	const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
	return h ? `+${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `+${m}:${String(r).padStart(2, "0")}`;
}

export function buildTimeline(events: MeRunStepEvent[], opts: { app?: string; running?: boolean } = {}): Timeline {
	const t0 = Math.min(...events.map((e) => e.started_at ?? Infinity));
	const start = isFinite(t0) ? t0 : null;
	const rows: TimelineRow[] = events.map((e, i) => {
		const running = !!opts.running && e.ended_at == null && i === events.length - 1;
		const d = e.started_at != null && e.ended_at != null ? e.ended_at - e.started_at : null;
		const held = eventHeld(e);
		return {
			i,
			name: stepName(e.step_id, opts.app),
			stage: e.stage ? STAGE_LABEL[e.stage] ?? "" : "",
			kind: KIND_WORD[e.kind ?? ""] ?? "",
			ok: e.ok !== false || held,
			held,
			running,
			offset: start != null && e.started_at != null ? fmtOffset(e.started_at - start) : "",
			duration: d != null && d >= 0 ? fmtDuration(d) : "",
			summary: held ? "held (not run)" : e.ok === false ? plainCause(e.summary || "") : /^filtered:/i.test(e.summary || "") ? `didn't pass its gate: ${gateReasonWords(e.summary || "")}` : (e.summary || ""),
		};
	});
	// Groups follow the run's own order; consecutive steps of one stage share
	// a label (a loop can return to a stage, which then gets a second group).
	const groups: TimelineGroup[] = [];
	for (const r of rows) {
		const last = groups[groups.length - 1];
		if (last && last.stage === r.stage) last.rows.push(r);
		else groups.push({ stage: r.stage, rows: [r] });
	}
	const bad = rows.find((r) => !r.ok);
	const failure = bad ? `Failed at ${bad.stage ? `${bad.stage} — ` : ""}${bad.name}: ${bad.summary}` : null;
	const heldRows = rows.filter((r) => r.held);
	const held = heldRows.length ? `${heldRows.map((r) => r.name).join(", ")} held (not run)` : null;
	const ends = events.map((e) => e.ended_at ?? e.started_at ?? NaN).filter((x) => isFinite(x));
	const total = start != null && ends.length ? fmtDuration(Math.max(...ends) - start) : "";
	return { groups, rows, failure, total, held };
}

/** Worth a timeline? One unstaged command step says nothing the answer card
 *  and step list do not already say. */
export function timelineWorthShowing(events?: MeRunStepEvent[] | null): boolean {
	if (!events?.length) return false;
	return events.length > 1 || !!events[0].stage;
}

/** Where a running run probably is, estimated from the steps the workflow's
 *  LAST run took: each step's share of that run's time, laid against how long
 *  this run has been going. Runs do not report steps until they finish, so
 *  this is an estimate and is always labelled as one. */
export interface StepEstimate {
	steps: Array<{ name: string; stage: string; state: "done" | "now" | "next" }>;
	now: { name: string; stage: string } | null;
	/** Past the last run's total time: every step shown done, still running. */
	beyond: boolean;
}

export function estimateSteps(template: MeRunStepEvent[], elapsedS: number, app = ""): StepEstimate | null {
	if (template.length < 2) return null;
	const durs = template.map((e) => (e.started_at != null && e.ended_at != null ? Math.max(0, e.ended_at - e.started_at) : 0));
	const total = durs.reduce((a, b) => a + b, 0);
	if (total <= 0) return null;
	let acc = 0, nowIdx = -1;
	for (let i = 0; i < durs.length; i++) {
		if (elapsedS < acc + durs[i]) { nowIdx = i; break; }
		acc += durs[i];
	}
	const beyond = nowIdx === -1;
	const label = (e: MeRunStepEvent) => (e.stage ? e.stage.charAt(0).toUpperCase() + e.stage.slice(1) : "");
	const steps = template.map((e, i) => ({
		name: stepName(e.step_id, app),
		stage: label(e),
		state: (beyond || i < nowIdx ? "done" : i === nowIdx ? "now" : "next") as "done" | "now" | "next",
	}));
	const cur = beyond ? template[template.length - 1] : template[nowIdx];
	return { steps, now: { name: stepName(cur.step_id, app), stage: label(cur) }, beyond };
}
