// "How has this experiment evolved?" — Novix's best-score story, from Lumid's
// own data, honestly:
//
//   • every result point: a version's average so far at that moment; solid when
//     the version has enough results to count (n ≥ min_samples — Novix's "full
//     set"), faint while it is still collecting ("quick set");
//   • the BEST-SO-FAR step line: at each moment, the best average among the
//     versions with enough results. It moves only when a counted version takes
//     the lead or its average moves — like Novix's line that moves only on a
//     full evaluation;
//   • the dashed FRONTIER: the best average among all versions, counted or not
//     ("leading, not confirmed");
//   • the VERSION CHAIN: versions in the order they first produced a result,
//     each with a state in words.
//
// ONE NUMBER PER VERSION PER STEP (2026-11-28). A version measured by the
// simulator AND on a real GPU has two numbers that answer different questions;
// averaging them gave 0.6B "80.9" here, "86.49" in the table and "75.31" on the
// tile. Means are keyed by (version, step) and the story is told at ONE step —
// the last step with data, unless the caller names one — with the other steps'
// numbers kept beside it, named ("75.3 J per request on the RTX 5080 · 86.5
// simulated"). A row's step is `dims.stage`, else its producing workflow, else
// the declared step whose metrics it reports (`rowStep`).
//
// TIES (2026-11-28). Versions the noise can't separate from the best (compare.ts
// `noiseTie`: the same number, inside twice the standard error, or one result
// each under 2% apart) are "tied", never one "best so far" and the rest
// "trying"; a declared secondary metric decides when it separates them. After
// a decision, a version inside the noise of the winner "can't tell apart yet"
// before it is ever "dropped".
//
// Only meaningful when the versions are comparable; the caller draws small
// multiples otherwise. Pure — tested in evolution.test.ts.

import type { MeExperimentRow } from "@/api/me";
import { noiseTie, sideStats, type SideStats } from "@/lib/compare";
import { humanId } from "@/lib/research-map";

export interface SeriesIn {
	id: string;
	/** `step`: the feedback step the result came from (see `seriesFromRows`). */
	points: Array<{ ts: string; v: number; n?: number; step?: string }>;
}

export interface EvoPoint { t: number; arm: string; mean: number; n: number; counted: boolean }
export interface StepPoint { t: number; arm: string; value: number }
export type ChainState = "winning" | "best so far" | "tied" | "can't tell apart yet" | "collecting" | "trying" | "dropped" | "not run yet";
export interface ChainLink {
	arm: string; index: number; state: ChainState; mean: number | null; n: number;
	/** The version's numbers at the OTHER steps (never averaged in). */
	atSteps?: Array<{ step: string; label: string; mean: number; n: number }>;
	/** On the winning / best-so-far version: how far ahead of the next one. */
	margin?: Margin;
	/** On every version tied for best: the tie (so the chain alone can say it). */
	tie?: Tie;
}
export interface Margin { over: string; gap: number; pct: number | null; n: number; overN: number; tie: "equal" | "noise" | "near" | null }

/** A secondary metric that decides a tie (the step's next declared metric). */
export interface TieBreaker { name: string; label: string; unit: string; higherIsBetter: boolean; values: Record<string, number> }

export interface Tie {
	arms: string[];
	value: number;
	how: "equal" | "noise" | "near";
	decidedBy?: { name: string; label: string; unit: string; arm: string; value: number };
}

export interface Evolution {
	points: EvoPoint[];
	best: StepPoint[];      // best counted version over time (step line)
	frontier: StepPoint[];  // best of all versions over time (dashed)
	hero: { arm: string; value: number } | null;    // best counted, now
	leader: { arm: string; value: number } | null;  // best of all, now
	chain: ChainLink[];
	/** The step the story is told at (null when results name no step). */
	step: string | null;
	/** That step in words: "on the RTX 5080", "simulated", "at Dev eval". */
	stepLabel: string | null;
	/** Versions tied for best, when more than one is. */
	tie: Tie | null;
	t0: number; t1: number;
}

// ── steps ────────────────────────────────────────────────────────────────

type StepLike = { step: string; metrics?: Array<{ name: string }> };

/**
 * The feedback step a ledger row belongs to: `dims.stage`; else the workflow
 * that produced it (`dims.loop` / `dims.workflow`) when that is a declared
 * step; else `dims.stage_index`; else the declared step whose metrics the row
 * reports most of (a later step wins a draw — MLSys's GPU rows name no stage
 * but report the sandbox's energy metrics). "" when nothing places it.
 */
export function rowStep(r: Pick<MeExperimentRow, "metrics" | "dims">, steps: StepLike[] = []): string {
	const d = r.dims ?? {};
	if (d.stage) return d.stage;
	const loop = d.loop || d.workflow;
	if (loop && steps.some((s) => s.step === loop)) return loop;
	const k = Number(d.stage_index);
	if (Number.isInteger(k) && k >= 1 && k <= steps.length) return steps[k - 1].step;
	if (steps.length === 1) return steps[0].step;
	const keys = new Set(Object.keys(r.metrics ?? {}));
	let at = "", most = 0;
	for (const s of steps) {
		const hit = (s.metrics ?? []).filter((m) => keys.has(m.name)).length;
		if (hit > 0 && hit >= most) { most = hit; at = s.step; }
	}
	return at;
}

/** The steps rows sit at, in order: the declared order, then undeclared ones
 *  by their `stage_index`, and the unnamed step ("") last. */
export function stepOrder(rows: Array<Pick<MeExperimentRow, "metrics" | "dims">>, steps: StepLike[] = []): string[] {
	const idx = new Map<string, number>();
	for (const r of rows) {
		const s = rowStep(r, steps);
		const k = Number(r.dims?.stage_index);
		const cur = idx.get(s);
		idx.set(s, Number.isFinite(k) && (cur === undefined || k < cur) ? k : cur ?? 1e6);
	}
	const declared = steps.map((s) => s.step).filter((s) => idx.has(s));
	const rest = [...idx.keys()].filter((s) => s && !declared.includes(s)).sort((a, b) => (idx.get(a)! - idx.get(b)!) || a.localeCompare(b));
	return [...declared, ...rest, ...(idx.has("") ? [""] : [])];
}

/** "NVIDIA GeForce RTX 5080 at office" → "RTX 5080". */
export function shortDevice(name: string): string {
	return name.replace(/\s+at\s+\S+$/i, "").replace(/^NVIDIA\s+/i, "").replace(/^GeForce\s+/i, "").trim();
}

/** A step in words, for a number shown beside it: "on the RTX 5080" (its rows
 *  say what they were measured on), "simulated", "at Dev eval". */
export function stepPhrase(step: string, rows: Array<Pick<MeExperimentRow, "dims">> = []): string {
	const on = rows.map((r) => r.dims?.measured_on || r.dims?.gpu).find((x) => typeof x === "string" && x.trim());
	if (on) return `on the ${shortDevice(on)}`;
	if (/^simulat/i.test(step)) return "simulated";
	return step ? `at ${humanId(step)}` : "";
}

/** An experiment's rows → one series per version, each point tagged with its
 *  step, plus the steps in order and each step in words. Discarded results and
 *  rows without the metric are left out. */
export function seriesFromRows(rows: MeExperimentRow[], metric: string, steps: StepLike[] = []): { series: SeriesIn[]; steps: string[]; stepLabels: Record<string, string> } {
	const by = new Map<string, SeriesIn>();
	const rowsAt = new Map<string, MeExperimentRow[]>();
	const kept: MeExperimentRow[] = [];
	for (const r of rows) {
		const v = r.metrics?.[metric];
		if (!r.variant_id || typeof v !== "number" || !Number.isFinite(v) || r.dims?.discarded === "1") continue;
		const step = rowStep(r, steps);
		kept.push(r);
		rowsAt.set(step, [...(rowsAt.get(step) ?? []), r]);
		const s = by.get(r.variant_id) ?? { id: r.variant_id, points: [] };
		s.points.push({ ts: r.ts, v, step });
		by.set(r.variant_id, s);
	}
	const order = stepOrder(kept, steps);
	return { series: [...by.values()], steps: order, stepLabels: Object.fromEntries(order.map((s) => [s, stepPhrase(s, rowsAt.get(s))])) };
}

/** Per version, the mean of the metric at each step (never across steps). */
export function meansByStep(rows: MeExperimentRow[], metric: string, steps: StepLike[] = []): Map<string, Map<string, { mean: number; n: number; values: number[] }>> {
	const out = new Map<string, Map<string, { mean: number; n: number; values: number[] }>>();
	for (const r of rows) {
		const v = r.metrics?.[metric];
		if (!r.variant_id || typeof v !== "number" || !Number.isFinite(v) || r.dims?.discarded === "1") continue;
		const step = rowStep(r, steps);
		const m = out.get(r.variant_id) ?? new Map();
		const c = m.get(step) ?? { mean: 0, n: 0, values: [] };
		c.values.push(v); c.n = c.values.length; c.mean = c.values.reduce((a: number, x: number) => a + x, 0) / c.n;
		m.set(step, c);
		out.set(r.variant_id, m);
	}
	return out;
}

/**
 * One version's numbers, one per step, the last step first and named:
 * "75.3 J per request on the RTX 5080 · 86.5 simulated". The first number
 * carries the unit (`valueOf`), the rest only the value (`bareOf`). "" when the
 * version has no result.
 */
export function versionStepWords(rows: MeExperimentRow[], version: string, metric: string, valueOf: (v: number) => string, bareOf: (v: number) => string = valueOf, steps: StepLike[] = []): string {
	const at = meansByStep(rows.filter((r) => r.variant_id === version), metric, steps).get(version);
	if (!at) return "";
	const all = seriesFromRows(rows, metric, steps);
	const order = all.steps.filter((s) => at.has(s)).reverse();
	return order.map((s, i) => {
		const phrase = all.stepLabels[s];
		const num = i === 0 ? valueOf(at.get(s)!.mean) : bareOf(at.get(s)!.mean);
		return phrase ? `${num} ${phrase}` : num;
	}).join(" · ");
}

/** One version's points at ONE step — the last of `order` it has (else the
 *  last it reached) — never averaged across steps. Points naming no step are
 *  returned as they are. Also says which step: null when none is named. */
export function lastStepPoints<P extends { step?: string }>(points: P[], order: string[] = []): { points: P[]; step: string | null } {
	if (!points.some((p) => p.step !== undefined)) return { points, step: null };
	const have = [...new Set(points.map((p) => p.step ?? ""))];
	const known = order.filter((s) => have.includes(s));
	const rest = have.filter((s) => !order.includes(s)).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : 0));
	const all = [...known, ...rest];
	const step = all[all.length - 1];
	return { points: points.filter((p) => (p.step ?? "") === step), step };
}

// ── the story ────────────────────────────────────────────────────────────

/** Each arm's running mean over time. `runningMean` = the points already are
 *  means (series_kind "running_mean"); otherwise raw results are averaged. */
function toRunning(s: SeriesIn, runningMean: boolean): EvoPoint[] {
	const pts = s.points
		.map((p) => ({ t: Date.parse(p.ts), v: p.v, n: p.n }))
		.filter((p) => isFinite(p.t) && isFinite(p.v))
		.sort((a, b) => a.t - b.t);
	if (runningMean) return pts.map((p, i) => ({ t: p.t, arm: s.id, mean: p.v, n: p.n ?? i + 1, counted: false }));
	let sum = 0;
	return pts.map((p, i) => { sum += p.v; return { t: p.t, arm: s.id, mean: sum / (i + 1), n: i + 1, counted: false }; });
}

export function buildEvolution(series: SeriesIn[], opts: {
	runningMean?: boolean;
	minSamples?: number;
	higherIsBetter?: boolean;
	declaredArms?: string[];
	winner?: string | null;        // best_variant when criteria_met
	decided?: boolean;             // criteria_met
	/** The steps in order (`seriesFromRows().steps`); the story defaults to the last with data. */
	steps?: string[];
	/** Tell the story at this step instead. */
	step?: string;
	stepLabels?: Record<string, string>;
	/** Secondary metrics, in order; the first that separates a tie decides it. */
	tieBreakers?: TieBreaker[];
}): Evolution | null {
	const min = Math.max(1, opts.minSamples || 1);
	const better = (a: number, b: number) => (opts.higherIsBetter === false ? a < b : a > b);

	// One step only. Points that name no step all sit at "" (older callers).
	const stepped = series.some((s) => s.points.some((p) => p.step !== undefined));
	const present = new Set(series.flatMap((s) => s.points.map((p) => p.step ?? "")));
	const order = [...(opts.steps ?? []).filter((s) => present.has(s)), ...[...present].filter((s) => !(opts.steps ?? []).includes(s))];
	const step = !stepped ? null : opts.step !== undefined && present.has(opts.step) ? opts.step : order[order.length - 1] ?? null;
	const labelOfStep = (s: string) => opts.stepLabels?.[s] ?? (s ? `at ${humanId(s)}` : "");
	const atStep = series.map((s) => ({ id: s.id, points: stepped ? s.points.filter((p) => (p.step ?? "") === step) : s.points })).filter((s) => s.points.length);

	const all = atStep.flatMap((s) => toRunning(s, !!opts.runningMean)).sort((a, b) => a.t - b.t || a.arm.localeCompare(b.arm));
	if (all.length === 0) return null;
	for (const p of all) p.counted = p.n >= min;

	// Walk time; keep each arm's latest state; emit step points when the best
	// counted (or best overall) value changes.
	const latest = new Map<string, EvoPoint>();
	const best: StepPoint[] = [], frontier: StepPoint[] = [];
	const pick = (counted: boolean) => {
		let top: EvoPoint | null = null;
		for (const p of latest.values()) {
			if (counted && !p.counted) continue;
			if (!top || better(p.mean, top.mean)) top = p;
		}
		return top;
	};
	for (const p of all) {
		latest.set(p.arm, p);
		const b = pick(true), f = pick(false);
		if (b) {
			const last = best[best.length - 1];
			if (!last || last.arm !== b.arm || last.value !== b.mean) best.push({ t: p.t, arm: b.arm, value: b.mean });
		}
		if (f) {
			const last = frontier[frontier.length - 1];
			if (!last || last.arm !== f.arm || last.value !== f.mean) frontier.push({ t: p.t, arm: f.arm, value: f.mean });
		}
	}
	let hero = best.length ? { arm: best[best.length - 1].arm, value: best[best.length - 1].value } : null;
	const leader = frontier.length ? { arm: frontier[frontier.length - 1].arm, value: frontier[frontier.length - 1].value } : null;

	// Each arm's spread at the step, for the noise rule. Served running means
	// carry no spread: n results at sd 0 (only an equal number ties).
	const statsOf = (arm: string): SideStats | null => {
		const l = latest.get(arm);
		if (!l) return null;
		if (opts.runningMean) return { n: l.n, mean: l.mean, sd: 0, min: l.mean, max: l.mean, latest: l.mean };
		return sideStats(atStep.find((s) => s.id === arm)?.points.map((p) => p.v) ?? []);
	};

	// Tied for best: every counted version the noise can't separate from the
	// best. Not once the experiment decided — then the winner stands, and the
	// versions in its noise "can't tell apart yet" (the chain, below).
	let tie: Tie | null = null;
	if (hero && !(opts.decided && opts.winner)) {
		const top = statsOf(hero.arm);
		const kinds = [...latest.values()].filter((p) => p.counted).map((p) => ({ arm: p.arm, how: p.arm === hero!.arm ? "equal" as const : noiseTie(top, statsOf(p.arm)) }))
			.filter((x): x is { arm: string; how: "equal" | "noise" | "near" } => x.how !== null);
		if (kinds.length > 1) {
			const how = kinds.some((k) => k.how === "noise") ? "noise" : kinds.some((k) => k.how === "near") ? "near" : "equal";
			tie = { arms: kinds.map((k) => k.arm), value: hero.value, how };
			for (const tb of opts.tieBreakers ?? []) {
				const vals = tie.arms.map((arm) => ({ arm, x: tb.values[arm] })).filter((o) => typeof o.x === "number" && Number.isFinite(o.x));
				if (vals.length < 2) continue;
				const top2 = vals.reduce((a, o) => (tb.higherIsBetter ? (o.x > a.x ? o : a) : (o.x < a.x ? o : a)));
				if (vals.filter((o) => o.x === top2.x).length > 1) continue;
				tie.decidedBy = { name: tb.name, label: tb.label, unit: tb.unit, arm: top2.arm, value: top2.x };
				hero = { arm: top2.arm, value: latest.get(top2.arm)!.mean };
				break;
			}
		}
	}

	// How far the winning (or best) version is ahead of the next counted one.
	const marginOf = (arm: string): Margin | undefined => {
		const me = latest.get(arm);
		if (!me) return undefined;
		let next: EvoPoint | null = null;
		for (const p of latest.values()) if (p.arm !== arm && p.counted && (!next || better(p.mean, next.mean))) next = p;
		if (!next) return undefined;
		const gap = Math.abs(me.mean - next.mean);
		return { over: next.arm, gap, pct: next.mean !== 0 ? (gap / Math.abs(next.mean)) * 100 : null, n: me.n, overN: next.n, tie: noiseTie(statsOf(arm), statsOf(next.arm)) };
	};

	// Every other step's number per version, named.
	const otherSteps = new Map<string, ChainLink["atSteps"]>();
	if (stepped) {
		for (const s of series) {
			const by = new Map<string, number[]>();
			for (const p of s.points) if ((p.step ?? "") !== step && Number.isFinite(p.v)) by.set(p.step ?? "", [...(by.get(p.step ?? "") ?? []), p.v]);
			const list = order.filter((st) => by.has(st)).reverse().map((st) => {
				const v = by.get(st)!;
				return { step: st, label: labelOfStep(st), mean: v.reduce((a, x) => a + x, 0) / v.length, n: v.length };
			});
			if (list.length) otherSteps.set(s.id, list);
		}
	}

	// Chain: order of first result; declared-but-silent versions at the end.
	const order2: string[] = [];
	for (const p of all) if (!order2.includes(p.arm)) order2.push(p.arm);
	for (const s of series) if (!order2.includes(s.id) && otherSteps.has(s.id)) order2.push(s.id);
	for (const a of opts.declaredArms || []) if (!order2.includes(a)) order2.push(a);
	const winner = opts.decided && opts.winner ? opts.winner : null;
	const chain: ChainLink[] = order2.map((arm, index) => {
		const l = latest.get(arm);
		let state: ChainState;
		if (!l) state = "not run yet";
		else if (winner === arm) state = "winning";
		else if (winner && noiseTie(statsOf(winner), statsOf(arm))) state = "can't tell apart yet";
		else if (winner) state = "dropped";
		else if (!l.counted) state = "collecting";
		else if (tie?.arms.includes(arm)) state = tie.decidedBy && hero?.arm === arm ? "best so far" : "tied";
		else if (hero?.arm === arm) state = "best so far";
		else state = "trying";
		const link: ChainLink = { arm, index, state, mean: l ? l.mean : null, n: l ? l.n : 0 };
		const at = otherSteps.get(arm);
		if (at) link.atSteps = at;
		if (state === "winning" || (state === "best so far" && !tie)) { const m = marginOf(arm); if (m) link.margin = m; }
		if (tie?.arms.includes(arm)) link.tie = tie;
		return link;
	});
	return {
		points: all, best, frontier, hero, leader, chain, tie,
		step, stepLabel: step === null ? null : labelOfStep(step) || null,
		t0: all[0].t, t1: all[all.length - 1].t,
	};
}

// ── in words ─────────────────────────────────────────────────────────────

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "by 0.0029 J per token (0.8%) · 1 result vs 1" — beside "Winning". */
export function marginWords(m: Margin, valueOf: (v: number) => string): string {
	const pct = m.pct == null ? "" : ` (${m.pct < 10 ? Math.round(m.pct * 10) / 10 : Math.round(m.pct)}%)`;
	const n = m.n === m.overN ? `${plural(m.n, "result")} each` : `${plural(m.n, "result")} vs ${m.overN}`;
	return `by ${valueOf(m.gap)}${pct} · ${n}`;
}

/**
 * The chain's one-line verdict, when it needs one:
 *   "Tied for best (9 at 22.4 tok/s) — TTFT p99 decides: C16"
 *   "Tied for best (2 at 0.37 J per token) — can't tell apart yet: one result each"
 *   "Winning: C12 by 0.0029 J per token (0.8%) · 1 result each — can't tell apart yet from C16"
 * "" when the chain says it all already.
 */
export function chainHeadline(evo: { chain: ChainLink[]; tie?: Tie | null }, labelOf: (arm: string) => string, valueOf: (v: number) => string): string {
	const tie = evo.tie ?? evo.chain.find((c) => c.tie)?.tie ?? null;
	if (tie) {
		const head = `Tied for best (${tie.arms.length} at ${valueOf(tie.value)})`;
		if (tie.decidedBy) return `${head} — ${tie.decidedBy.label} decides: ${labelOf(tie.decidedBy.arm)}`;
		if (tie.how === "near") return `${head} — can't tell apart yet: one result each can't separate a gap this small`;
		if (tie.how === "noise") return `${head} — can't tell apart yet: the gaps are within the noise`;
		return head;
	}
	const w = evo.chain.find((c) => c.state === "winning");
	if (w) {
		const close = evo.chain.filter((c) => c.state === "can't tell apart yet");
		const by = w.margin ? ` ${marginWords(w.margin, valueOf)}` : "";
		return `Winning: ${labelOf(w.arm)}${by}${close.length ? ` — can't tell apart yet from ${close.map((c) => labelOf(c.arm)).join(", ")}` : ""}`;
	}
	return "";
}

/** A chip's number line: "75.3 J per request · 1 result", or for a version
 *  with no result at the story's step, its number at another ("86.5 simulated"). */
export function linkValueWords(c: ChainLink, valueOf: (v: number) => string): string | null {
	if (c.mean != null) return `${valueOf(c.mean)} · ${plural(c.n, "result")}`;
	const o = c.atSteps?.[0];
	return o ? `${valueOf(o.mean)} ${o.label}`.trim() : null;
}
