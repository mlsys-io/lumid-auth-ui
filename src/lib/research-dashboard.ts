// The Research tab's top: one sentence on what changed, then three tiles —
// Best results · Needs you · This week. Pure functions only; the words live
// here, tested, never inline (round 9, 2026-11-27: "simple but informative,
// control and inspiring" — show progress, not inventory).

import type { MeExperiment, MeRunRow, MeWorkflowRow } from "@/api/me";
import { experimentStatus, humanId, type Tone } from "@/lib/research-map";
import { fmtMetricValue, humanMetric } from "@/lib/run-answer";

const WEEK_S = 7 * 86400;

/** A metric value with its unit, the way the run page writes it. */
export function metricText(name: string, v: number): string {
	const h = humanMetric(name);
	const t = fmtMetricValue(v, h.unit, name);
	return h.unit && !t.endsWith("%") ? `${t} ${h.unit}` : t;
}

export interface BestResult {
	/** Graph id to select ("exp:<id>"). */
	select: string;
	experiment: string;
	leader: string;
	metric: string;
	value: number;
	valueText: string;
	/** "winning" (criteria met) · "leads" · "can't tell apart yet". */
	standing: "winning" | "leads" | "can't tell apart yet";
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
	const standing = e.criteria_met ? "winning" : e.not_separable_from?.length ? "can't tell apart yet" : "leads";
	return {
		select: `exp:${e.id}`, experiment: humanId(e.id), leader: humanId(e.best_variant), metric: humanMetric(metric).label,
		value: v.mean, valueText: metricText(metric, v.mean), standing, n: e.n_results,
		higherIsBetter: e.higher_is_better ?? e.metric?.higher_is_better ?? true, updatedAt: e.updated_at,
	};
}

/** The experiments worth showing first: settled winners, then leaders with
 *  the most results; newest first among equals. */
export function bestResults(exps: MeExperiment[]): BestResult[] {
	const rank = (b: BestResult) => (b.standing === "winning" ? 0 : b.standing === "leads" ? 1 : 2);
	return exps.map(bestResult).filter((b): b is BestResult => !!b)
		.sort((a, b) => rank(a) - rank(b) || b.n - a.n || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export interface FailingWorkflow { id: string; label: string; select: string }

/** Workflows whose latest run failed (and aren't running again right now). */
export function failingWorkflows(rows: Map<string, MeWorkflowRow>, label: (id: string) => string): FailingWorkflow[] {
	return [...rows.entries()].filter(([, r]) => r.last_run_ok === false && !r.running)
		.map(([id]) => ({ id, label: label(id), select: `wf:${id}` }));
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
		return b.standing !== "can't tell apart yet" && (changed || (recent && b.standing === "winning"));
	});
	if (fresh) {
		const verb = fresh.standing === "winning" ? "wins" : "now leads";
		return { tone: "ok", select: fresh.select, text: tail(`New best on ${fresh.experiment}: ${fresh.leader} ${verb} with ${fresh.metric} ${fresh.valueText}`) };
	}
	if (input.failing.length === 1) return { tone: "failing", select: input.failing[0].select, text: tail(`${input.failing[0].label} is failing — its latest run didn't finish`) };
	if (input.failing.length > 1) return { tone: "failing", select: input.failing[0].select, text: tail(`${input.failing.length} workflows are failing: ${input.failing.slice(0, 2).map((f) => f.label).join(", ")}${input.failing.length > 2 ? "…" : ""}`) };
	if (ideas) return { tone: "attention", select: input.firstIdea, text: `${ideas[0].toUpperCase()}${ideas.slice(1)} — open one to decide` };
	for (const e of input.exps) {
		const st = experimentStatus(e);
		if (st.text.startsWith("Collecting results")) return { tone: "running", select: `exp:${e.id}`, text: `${humanId(e.id)}: ${st.text[0].toLowerCase()}${st.text.slice(1)}` };
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
