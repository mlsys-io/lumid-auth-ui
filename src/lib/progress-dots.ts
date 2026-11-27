// progress-dots — the words and windows behind ProgressDots. Dots have exactly
// two meanings (round 9, principle 5), and the caller always says which:
//
//   a dot is a RUN    "Last 20 runs"   ●●●○●●   gold done · brick failed · lagoon running
//   a dot is a STEP   "Steps"          ■■■□□    the same colours, plus waiting (outline)
//                                                and skipped (faint)
//
// Every dot says its state in words (tooltip + accessible name), so colour is
// never the only signal. Pure — tested in progress-dots.test.ts.

import type { MeCycleDetail, MeRunStepEvent } from "@/api/me";
import { fmtDuration, plainCause, dirIdToSec } from "@/lib/activity";
import { fmtOffset, stepName, estimateSteps } from "@/lib/run-timeline";

export type StepState = "done" | "failed" | "running" | "waiting" | "skipped";

/** A dot that is a run. `ts` is epoch seconds or a cycle-dir id. */
export interface RunDot {
	id: string;
	ok: boolean;
	running?: boolean;
	ts: number | string;
	label?: string;
}

/** A dot that is a step. `startedAt` is epoch seconds. */
export interface StepDot {
	id: string;
	label: string;
	state: StepState;
	startedAt?: number;
	durationS?: number;
	/** A failure's cause or the step's own note, in plain words. */
	note?: string;
	/** Placed from the last run's timing, not reported by this run. */
	estimated?: boolean;
}

const STATE_WORD: Record<StepState, string> = {
	done: "done", failed: "failed", running: "running", waiting: "not started yet", skipped: "skipped",
};

/** Epoch seconds from either form a run's time comes in (null when neither). */
export function dotSeconds(ts: number | string): number | null {
	if (typeof ts === "number") return isFinite(ts) ? ts : null;
	const n = Number(ts);
	if (ts.trim() && isFinite(n)) return n;
	return dirIdToSec(ts);
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function agoWords(sec: number, now = Date.now() / 1000): string {
	const d = Math.max(0, now - sec);
	if (d < 60) return "just now";
	if (d < 3600) return `${Math.floor(d / 60)} min ago`;
	if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
	const days = Math.floor(d / 86400);
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "Run 3 h ago — failed", "Backtest 12 min ago — running". */
export function runDotWords(d: RunDot, now = Date.now() / 1000): string {
	const sec = dotSeconds(d.ts);
	const when = sec != null ? ` ${agoWords(sec, now)}` : "";
	const state = d.running ? "running" : d.ok ? "succeeded" : "failed";
	return `${d.label || "Run"}${when} — ${state}`;
}

/** "Backtest — done in 44s", "Submit — failed after 3s: Server error (HTTP 500)",
 *  "Score — running", "Report — not started yet". An estimate says so. */
export function stepDotWords(s: StepDot): string {
	const took = s.durationS != null && s.durationS >= 0 ? fmtDuration(s.durationS) : "";
	let w: string;
	if (s.state === "done") w = took ? `done in ${took}` : "done";
	else if (s.state === "failed") w = took ? `failed after ${took}` : "failed";
	else w = STATE_WORD[s.state];
	const note = s.state === "failed" && s.note ? `: ${s.note}` : "";
	return `${s.label} — ${w}${note}${s.estimated ? " (estimated from the last run)" : ""}`;
}

/** The newest `max` items and how many earlier ones were left out. Items are
 *  oldest first; the window keeps the END (the newest). */
export function windowDots<T>(items: readonly T[], max: number): { shown: T[]; earlier: number; earlierText: string } {
	const m = Math.max(1, Math.floor(max));
	const earlier = Math.max(0, items.length - m);
	return { shown: items.slice(earlier), earlier, earlierText: earlier ? `+${earlier.toLocaleString()} earlier` : "" };
}

/** "Last 20 runs" / "Last run" / "3 runs" — the label a run-dot line carries. */
export function runDotsLabel(total: number, max: number): string {
	if (total <= 0) return "No runs yet";
	if (total === 1) return "Last run";
	return total > max ? `Last ${max} runs` : `Last ${total} runs`;
}

/** "3 of 5 steps done · 1 failed" — the steps line in words. */
export function stepsSummary(steps: readonly StepDot[]): string {
	if (!steps.length) return "No steps reported";
	const n = (st: StepState) => steps.filter((s) => s.state === st).length;
	const done = n("done"), failed = n("failed"), running = n("running"), skipped = n("skipped");
	const parts = [`${done} of ${steps.length} step${steps.length === 1 ? "" : "s"} done`];
	if (running) parts.push(`${running} running`);
	if (failed) parts.push(`${failed} failed`);
	if (skipped) parts.push(`${skipped} skipped`);
	return parts.join(" · ");
}

/** The span a run's steps cover, so the size is clear without counting:
 *  "+0:00 — +35:52" while it runs or across many steps, "took 44s" when done. */
export function stepsSpan(steps: readonly StepDot[], now = Date.now() / 1000): string {
	const timed = steps.filter((s) => s.startedAt != null);
	if (!timed.length) {
		const total = steps.reduce((a, s) => a + (s.durationS ?? 0), 0);
		return total > 0 ? `took ${fmtDuration(total)}` : "";
	}
	const t0 = Math.min(...timed.map((s) => s.startedAt!));
	const running = steps.some((s) => s.state === "running");
	const end = Math.max(...timed.map((s) => (s.state === "running" ? now : s.startedAt! + (s.durationS ?? 0))));
	if (running) return `${fmtOffset(0)} — ${fmtOffset(end - t0)}`;
	return `took ${fmtDuration(end - t0)}`;
}

export interface StepRow {
	id: string;
	label: string;
	state: StepState;
	/** "+m:ss" from the first step's start; "" when the step has no time. */
	offset: string;
	/** "44s"; "running" for the running step; "" when unknown. */
	took: string;
	/** Plain words; a failure's cause. */
	note: string;
	/** Shown in full by default (failures); other notes fold behind a toggle. */
	open: boolean;
	/** 0 = newest/loudest … 2 = old and quiet (Novix: older rows fade). */
	quiet: 0 | 1 | 2;
	words: string;
}

/** The timestamped list under the dots. Rows that have not started have no
 *  offset; the newest three reported rows are loud, older ones quieter. */
export function stepRows(steps: readonly StepDot[]): StepRow[] {
	const timed = steps.filter((s) => s.startedAt != null);
	const t0 = timed.length ? Math.min(...timed.map((s) => s.startedAt!)) : null;
	// "Newest" = the last step that has started (running, done or failed).
	let last = -1;
	steps.forEach((s, i) => { if (s.state !== "waiting") last = i; });
	return steps.map((s, i) => {
		const dist = last < 0 || s.state === "waiting" ? 0 : last - i;
		return {
			id: s.id,
			label: s.label,
			state: s.state,
			offset: t0 != null && s.startedAt != null ? fmtOffset(s.startedAt - t0) : "",
			took: s.state === "running" ? "running" : s.state !== "skipped" && s.durationS != null && s.durationS >= 0 ? fmtDuration(s.durationS) : "",
			note: s.note || "",
			open: s.state === "failed",
			quiet: s.state === "running" || s.state === "failed" ? 0 : dist < 3 ? 0 : dist < 8 ? 1 : 2,
			words: stepDotWords(s),
		};
	});
}

const SKIP_RE = /^(skipped|skip|nothing to do)\b/i;

function stepFromEvent(e: MeRunStepEvent, i: number, n: number, app: string, running: boolean): StepDot {
	const isRunning = running && e.ended_at == null && i === n - 1;
	const dur = e.started_at != null && e.ended_at != null ? Math.max(0, e.ended_at - e.started_at) : undefined;
	const summary = (e.summary || "").trim();
	const state: StepState = isRunning ? "running" : e.ok === false ? "failed" : SKIP_RE.test(summary) ? "skipped" : "done";
	return {
		id: `${i}:${e.step_id}`,
		label: stepName(e.step_id, app),
		state,
		startedAt: e.started_at ?? undefined,
		durationS: dur,
		note: state === "failed" ? plainCause(summary) : summary,
	};
}

/**
 * The steps of one run, from its cycle detail: the runner's own timeline
 * (`events`) when it reported one, else the cycle's `steps`. A running run
 * that has not reported steps yet is placed on the LAST run's steps
 * (`template`, its events) by elapsed time — marked `estimated` — so how much
 * is left shows as waiting dots. Never invents steps without a template.
 */
export function stepsFromCycle(
	detail: MeCycleDetail | null | undefined,
	opts: { app?: string; running?: boolean; template?: MeRunStepEvent[] | null; elapsedS?: number } = {},
): StepDot[] {
	if (!detail) return [];
	const running = opts.running ?? !!detail.running;
	const app = opts.app ?? detail.loop ?? "";
	const events = detail.events || [];
	if (events.length) {
		const out = events.map((e, i) => stepFromEvent(e, i, events.length, app, running));
		// A running run with a longer template: the steps it has not reached yet.
		const tpl = opts.template || [];
		if (running && tpl.length > out.length) {
			for (let i = out.length; i < tpl.length; i++) {
				out.push({ id: `${i}:${tpl[i].step_id}`, label: stepName(tpl[i].step_id, app), state: "waiting", estimated: true });
			}
		}
		return out;
	}
	const steps = detail.steps || [];
	if (steps.length) {
		return steps.map((s, i) => {
			const failed = s.ok === false || !!s.error;
			const note = failed ? plainCause(s.error || s.output_summary || "") : (s.output_summary || "");
			return {
				id: `${i}:${s.step_id}`,
				label: stepName(s.step_id || s.skill || "step", app),
				state: failed ? "failed" : SKIP_RE.test(note) ? "skipped" : "done",
				durationS: s.duration_s ?? undefined,
				note,
			};
		});
	}
	if (running && opts.template && opts.elapsedS != null) {
		const est = estimateSteps(opts.template, opts.elapsedS, app);
		if (!est) return [];
		return est.steps.map((s, i) => ({
			id: `${i}:${opts.template![i].step_id}`,
			label: s.name,
			state: s.state === "done" ? "done" : s.state === "now" ? "running" : "waiting",
			estimated: true,
		}));
	}
	return [];
}
