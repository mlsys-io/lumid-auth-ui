// The Research tab's top: one sentence on what changed, then three tiles —
// Best results · Needs you · This week. Pure functions only; the words live
// here, tested, never inline (round 9, 2026-11-27: "simple but informative,
// control and inspiring" — show progress, not inventory).

import type { MeExperiment, MeRunRow, MeWorkflowRow } from "@/api/me";
import { experimentStatus, humanId, versionLabel, type Tone, experimentLabel} from "@/lib/research-map";
import { fmtMetricValue, humanMetric, isCountKey, isFlagKey } from "@/lib/run-answer";

const WEEK_S = 7 * 86400;

/** A metric value with its unit, the way the run page writes it. */
export function metricText(name: string, v: number): string {
	const h = humanMetric(name);
	const t = fmtMetricValue(v, h.unit, name);
	return h.unit && !t.endsWith("%") ? `${t} ${h.unit}` : t;
}

// ── yes/no metrics ────────────────────────────────────────────────────────
// "Util 0.85 wins with Meets constraints yes" (2026-11-28 audit): a 0/1 metric
// is a fact about the version, not a number, so it reads as words.

const YES_NO_NAME = /^(?:(?:calibrated|robust|simulated|measured)_)?(?:meets|passes|passed|is|has|ok)(?:_|$)/;

/** A metric that is a yes/no fact: a flag name (meets_*, passes_*, is_*, ok …),
 *  or — with no unit and not a count or a share — values that are only 0 and 1
 *  (at least two of them, so one lucky round number isn't taken for a flag). */
export function isYesNoMetric(name: string, values: number[] = []): boolean {
	const k = name.trim().replace(/\./g, "_");
	if (!k) return false;
	if (YES_NO_NAME.test(k) || isFlagKey(k)) return true;
	if (humanMetric(k).unit || /(^|_)(rate|ratio|share|accuracy|precision|recall|score)(_|$)/.test(k)) return false;
	if (isCountKey(k)) return false;
	return values.length >= 2 && values.every((v) => v === 0 || v === 1);
}

const NEGATE: Record<string, string> = { meets: "doesn't meet", passes: "doesn't pass", passed: "didn't pass", is: "isn't", has: "doesn't have" };

/** A yes/no metric in words. `tile` is the short form ("meets constraints" /
 *  "doesn't meet constraints"); `sentence` is the headline's ("meets every
 *  constraint"). A mean between 0 and 1 is a share of runs. */
export function yesNoWords(name: string, v: number): { tile: string; sentence: string } {
	const label = humanMetric(name).label.replace(/ \((?:estimated|average)\)$/, "");
	// Lower-case the first letter unless it starts an acronym ("GPU …").
	const phrase0 = /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
	// A flag name says itself ("meets constraints", "same GPU as simulated");
	// one found by its 0/1 values with no verb ("constraint check") reads as passed.
	const k = name.trim().replace(/\./g, "_");
	const phrase = YES_NO_NAME.test(k) || isFlagKey(k) ? phrase0 : `passes ${phrase0}`;
	const [v0, ...rest] = phrase.split(" ");
	const no = NEGATE[v0] ? [NEGATE[v0], ...rest].join(" ") : `not ${phrase}`;
	const every = (p: string) => p.replace(/^(meets|doesn't meet) constraints$/, "$1 every constraint");
	if (v === 1) return { tile: phrase, sentence: every(phrase) };
	if (v === 0) return { tile: no, sentence: every(no) };
	const share = `${phrase} in ${Math.round(v * 100)}% of runs`;
	return { tile: share, sentence: share };
}

export interface BestResult {
	/** Graph id to select ("exp:<id>"). */
	select: string;
	experiment: string;
	/** The leading version's id (the experiment detail read doesn't carry it). */
	version: string;
	leader: string;
	metric: string;
	value: number;
	/** The number with its unit — or, for a yes/no metric, the words
	 *  ("meets constraints"), never "yes". */
	valueText: string;
	/** Set for a yes/no metric: the headline's phrase ("meets every constraint"). */
	yesNo?: string;
	/** "winning" (criteria met) · "leads" · "can't tell apart yet". */
	standing: "winning" | "leads" | "can't tell apart yet" | "didn't pass a step";
	/** The step that stopped the top number (with "didn't pass a step"). */
	stoppedAt?: string;
	n: number;
	higherIsBetter: boolean;
	updatedAt?: string;
}

/** An experiment's leader and its number — only where a ranking is honest
 *  (results exist, the versions were measured alike). */
export function bestResult(e: MeExperiment): BestResult | null {
	if (!e.best_variant || !e.n_results || e.comparable === false || e.state_stale) return null;
	const v = e.variants?.[e.best_variant];
	const metric = e.metric?.name || e.metric_name || "";
	if (!v || !metric || !Number.isFinite(v.mean)) return null;
	// A top number a gate stopped is not a lead: it says where it stopped and
	// sorts last (2026-11-28: "Strategy search (Lowvol top)" headed Best results
	// after every version failed Robustness).
	const failed = !!e.best_failed_gate;
	const standing = failed ? "didn't pass a step" : e.criteria_met ? "winning" : e.not_separable_from?.length ? "can't tell apart yet" : "leads";
	const means = Object.values(e.variants ?? {}).map((x) => x.mean).filter(Number.isFinite);
	const yn = isYesNoMetric(metric, means) ? yesNoWords(metric, v.mean) : null;
	return {
		// The version's own title, as the panel names it (versionLabel, one label everywhere).
		select: `exp:${e.id}`, experiment: experimentLabel(e), version: e.best_variant, leader: versionLabel(e, e.best_variant), metric: humanMetric(metric).label,
		value: v.mean, valueText: yn ? yn.tile : metricText(metric, v.mean), standing, n: e.n_results,
		...(yn ? { yesNo: yn.sentence } : {}),
		higherIsBetter: e.higher_is_better ?? e.metric?.higher_is_better ?? true, updatedAt: e.updated_at,
		...(failed && e.best_stopped_at ? { stoppedAt: humanId(e.best_stopped_at) } : {}),
	};
}

/** A best result as one phrase after its leader: "Sharpe 1.42", or for a
 *  yes/no metric just the words ("meets constraints"). */
export function bestResultValue(b: Pick<BestResult, "metric" | "valueText" | "yesNo">): string {
	return b.yesNo ? b.valueText : `${b.metric} ${b.valueText}`;
}

/** The Best results tile's two lines under the leader: the metric's name (left
 *  out for a yes/no metric — the words already say it) and the value, per step
 *  when the run page's per-step words are known. */
export function bestTileLines(b: Pick<BestResult, "metric" | "valueText" | "yesNo">, stepWords?: string | null): { metric?: string; value: string } {
	if (b.yesNo) return { value: b.valueText };
	return { metric: b.metric, value: stepWords || b.valueText };
}

/** The experiments worth showing first: settled winners, then leaders with
 *  the most results; newest first among equals. */
export function bestResults(exps: MeExperiment[]): BestResult[] {
	const rank = (b: BestResult) => (b.standing === "winning" ? 0 : b.standing === "leads" ? 1 : b.standing === "can't tell apart yet" ? 2 : 3);
	return exps.map(bestResult).filter((b): b is BestResult => !!b)
		.sort((a, b) => rank(a) - rank(b) || b.n - a.n || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export interface FailingWorkflow { id: string; label: string; select: string;
	/** Why its latest run failed, in words (plainCause of the run feed's reason) — with the step, for a chain. */
	cause?: string }

/** Workflows whose latest run failed (and aren't running again right now). */
export function failingWorkflows(rows: Map<string, MeWorkflowRow>, label: (id: string) => string,
	/** workflow id → why its latest run failed (groupActivity's failing.cause). */
	causes?: Map<string, string>): FailingWorkflow[] {
	return [...rows.entries()].filter(([, r]) => r.last_run_ok === false && !r.running)
		.map(([id]) => {
			const cause = causes?.get(id);
			return { id, label: label(id), select: `wf:${id}`, ...(cause && cause !== "No reason recorded" ? { cause } : {}) };
		});
}

export interface Headline { text: string; tone: Tone; select?: string }

/** One sentence on what matters most right now, in this order: a new best
 *  this week · something failing · ideas waiting · results coming in. */
export function researchHeadline(input: {
	exps: MeExperiment[]; failing: FailingWorkflow[]; ideas: number;
	/** The first idea's graph id, so the sentence can open it. */
	firstIdea?: string;
	/** experiment id → the leader last seen by this viewer (to say "new"). */
	seen?: Record<string, string>; now?: number;
}): Headline | null {
	const now = input.now ?? Date.now() / 1000;
	const ideas = input.ideas ? `${input.ideas} idea${input.ideas === 1 ? "" : "s"} to try` : "";
	const tail = (s: string) => (ideas && s ? `${s} · ${ideas}` : s || ideas);
	const fresh = bestResults(input.exps).find((b) => {
		const at = b.updatedAt ? Date.parse(b.updatedAt) / 1000 : NaN;
		const recent = Number.isFinite(at) && now - at < WEEK_S;
		const id = b.select.slice(4);
		const changed = input.seen ? input.seen[id] !== undefined && input.seen[id] !== b.leader : false;
		return b.standing !== "can't tell apart yet" && b.standing !== "didn't pass a step" && (changed || (recent && b.standing === "winning"));
	});
	if (fresh) {
		const verb = fresh.standing === "winning" ? "wins" : "now leads";
		return { tone: "ok", select: fresh.select, text: tail(`New best on ${fresh.experiment}: ${fresh.leader} ${verb}${fresh.yesNo ? `: ${fresh.yesNo}` : ` with ${fresh.metric} ${fresh.valueText}`}`) };
	}
	// A failure says where and why (the run feed's cause), not only which.
	const [f0] = input.failing;
	if (input.failing.length === 1) return { tone: "failing", select: f0.select, text: tail(`${f0.label} is failing — ${f0.cause ?? "its latest run didn't finish"}`) };
	if (input.failing.length > 1) {
		const n = input.failing.length;
		const same = f0.cause && input.failing.every((f) => f.cause === f0.cause);
		const text = same ? `${n} workflows are failing, all the same way: ${f0.cause}`
			: f0.cause ? `${n} workflows are failing · ${f0.label} — ${f0.cause}`
			: `${n} workflows are failing: ${input.failing.slice(0, 2).map((f) => f.label).join(", ")}${n > 2 ? "…" : ""}`;
		return { tone: "failing", select: f0.select, text: tail(text) };
	}
	if (ideas) return { tone: "attention", select: input.firstIdea, text: `${ideas[0].toUpperCase()}${ideas.slice(1)} — open one to decide` };
	for (const e of input.exps) {
		const st = experimentStatus(e);
		if (st.text.startsWith("Collecting results")) return { tone: "running", select: `exp:${e.id}`, text: `${experimentLabel(e)}: ${st.text[0].toLowerCase()}${st.text.slice(1)}` };
	}
	return null;
}

export interface WeekSummary {
	runs: number; failed: number; running: number;
	/** Newest last, at most 20 — "a dot is a run". */
	dots: Array<{ id: string; state: "done" | "failed" | "running" | "skipped" }>;
	spendCents: number;
}

/** The app's last seven days of runs, and its spend this month. */
export function weekSummary(app: string, runs: MeRunRow[] | null, rows: Map<string, MeWorkflowRow>, now = Date.now() / 1000): WeekSummary {
	const mine = (runs || []).filter((r) => (r.app === app || r.workflow_slug.startsWith(`${app}:`)) && now - r.started_at < WEEK_S)
		.sort((a, b) => a.started_at - b.started_at);
	const state = (r: MeRunRow) => (r.state === "running" || r.state === "queued" ? "running" : r.state === "failed" ? "failed" : r.state === "succeeded" ? "done" : "skipped") as WeekSummary["dots"][number]["state"];
	return {
		runs: mine.length,
		failed: mine.filter((r) => r.state === "failed").length,
		running: mine.filter((r) => r.state === "running").length,
		dots: mine.slice(-20).map((r) => ({ id: r.run_id, state: state(r) })),
		spendCents: [...rows.values()].reduce((s, r) => s + (r.cost_cents_mtd || 0), 0),
	};
}

/** "$4.10" (cents in, plain dollars out). */
export function dollars(cents: number): string {
	return `$${(cents / 100).toFixed(cents >= 100000 ? 0 : 2)}`;
}

/** The best value so far, run by run (what the Best results line draws):
 *  climbs (or falls, for lower-is-better) and never goes back. */
export function bestSoFar(values: number[], higherIsBetter: boolean): number[] {
	const out: number[] = [];
	for (const v of values) {
		if (!Number.isFinite(v)) continue;
		const prev = out.length ? out[out.length - 1] : v;
		out.push(higherIsBetter ? Math.max(prev, v) : Math.min(prev, v));
	}
	return out;
}

/**
 * The phone's one line in place of the three tiles (below 640 px):
 * "112 GPU-min left · 2 need you · 1 failing". The budget part only when the
 * app has a budget; "Nothing needs you" when nothing does.
 */
export function phoneSummary(input: { left?: string | null; needs: number; failing: number }): string {
	const parts: string[] = [];
	if (input.left) parts.push(input.left);
	if (input.needs > 0) parts.push(`${input.needs} ${input.needs === 1 ? "needs" : "need"} you`);
	if (input.failing > 0) parts.push(`${input.failing} failing`);
	if (!input.needs && !input.failing) parts.push("Nothing needs you");
	return parts.join(" · ");
}
