// progress-per-spend — is spending more still buying improvement?
//
// Round 10 (2026-11-28), generic. The goal of a research app is the best
// result for the least real resource. This plots the best result so far
// against cumulative spend: every ledger row adds what it used (x), and a row
// at the step that counts — the last step of the workflow, the expensive and
// trusted one, or the furthest step anything reached — may move the best (y).
// Cheap-step rows add their (small) spend and show as light dots; reused rows
// add nothing. The x unit is the scarcest one the rows carry: GPU-minutes,
// else CPU-minutes, else notional dollars, else run time — said on the axis.
//
// Pure functions only; the words live here.

import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { humanId } from "@/lib/research-map";
import { fmtMetricValue, humanMetric } from "@/lib/run-answer";
import { deviceTime, dollars, usageOfRow } from "@/lib/spend";

export type SpendUnit = "gpu" | "cpu" | "usd" | "time";

export interface SpendPoint {
	/** Cumulative spend after this row, in the chart's unit (minutes or $). */
	x: number;
	/** This row's own value of the metric, when it reports one. */
	value: number | null;
	/** Best so far at the counting step after this row. */
	best: number | null;
	step: string;
	/** The step that counts (the last reached) — a solid dot; others light. */
	counts: boolean;
	version: string;
	reused: boolean;
	passed: boolean;
	ts: string;
}

export interface ProgressPerSpend {
	unit: SpendUnit;
	unitLabel: string;
	metric: string;
	metricLabel: string;
	metricUnit: string;
	higherIsBetter: boolean;
	countingStep: string;
	countingLabel: string;
	points: SpendPoint[];
	total: number;
	best: { value: number; version: string; at: number } | null;
}

const tsNum = (ts?: string): number => {
	if (!ts) return 0;
	const n = Number(ts);
	if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
	const d = Date.parse(ts);
	return Number.isFinite(d) ? d / 1000 : 0;
};

const passedOf = (r: MeExperimentRow): boolean => {
	const d = String(r.dims?.passed ?? "").toLowerCase();
	if (d) return /^(1|true|yes|pass|passed)$/.test(d);
	const m = r.metrics?.stage_passed;
	return typeof m === "number" ? m >= 1 : true;
};

export function progressPerSpend(input: {
	steps: EvidenceStepSpec[];
	rows: MeExperimentRow[];
	metric: string;
	higherIsBetter?: boolean;
}): ProgressPerSpend | null {
	const { rows, metric } = input;
	if (!metric || !rows.length) return null;
	const stepIds = input.steps.length ? input.steps.map((s) => s.step) : [""];
	const staged = rows.some((r) => !!r.dims?.stage);
	const stepOf = (r: MeExperimentRow) => (r.dims?.stage ?? (staged ? "" : stepIds[0]));
	// The counting step: the last declared step that has a row reporting the metric.
	let ck = -1;
	for (let k = stepIds.length - 1; k >= 0 && ck < 0; k--)
		if (rows.some((r) => stepOf(r) === stepIds[k] && typeof r.metrics?.[metric] === "number")) ck = k;
	if (ck < 0 && !staged) ck = 0;
	if (ck < 0) return null;
	const counting = stepIds[ck];

	const usages = rows.map(usageOfRow);
	const unit: SpendUnit = usages.some((u) => (u?.gpu_s ?? 0) > 0)
		? "gpu"
		: usages.some((u) => (u?.cpu_s ?? 0) > 0)
			? "cpu"
			: usages.some((u) => (u?.cost_usd ?? 0) > 0)
				? "usd"
				: "time";
	const add = (r: MeExperimentRow, i: number): number => {
		const u = usages[i];
		if (unit === "gpu") return (u?.gpu_s ?? 0) / 60;
		if (unit === "cpu") return (u?.cpu_s ?? 0) / 60;
		if (unit === "usd") return u?.cost_usd ?? 0;
		return u?.metered === "reused" ? 0 : Math.max(0, Number(r.metrics?.duration_s) || 0) / 60;
	};
	const declared = input.steps.flatMap((s) => s.metrics).find((m) => m.name === metric);
	const higher = input.higherIsBetter ?? (declared?.better ? declared.better !== "lower" : true);

	const order = rows.map((r, i) => ({ r, i })).sort((a, b) => tsNum(a.r.ts) - tsNum(b.r.ts));
	let x = 0;
	let best: ProgressPerSpend["best"] = null;
	const points: SpendPoint[] = [];
	for (const { r, i } of order) {
		x += add(r, i);
		const step = stepOf(r);
		const v = r.metrics?.[metric];
		const value = typeof v === "number" && Number.isFinite(v) ? v : null;
		const counts = step === counting;
		const passed = passedOf(r);
		if (counts && value != null && passed && (!best || (higher ? value > best.value : value < best.value)))
			best = { value, version: r.variant_id, at: x };
		points.push({ x, value, best: best?.value ?? null, step, counts, version: r.variant_id, reused: usages[i]?.metered === "reused", passed, ts: r.ts });
	}
	const h = humanMetric(metric);
	const unitLabel = unit === "gpu" ? "GPU-minutes" : unit === "cpu" ? "CPU-minutes" : unit === "usd" ? "notional $" : "run minutes";
	return {
		unit, unitLabel, metric, metricLabel: h.label, metricUnit: h.unit, higherIsBetter: higher,
		countingStep: counting, countingLabel: counting ? humanId(counting) : "the result", points, total: x, best,
	};
}

/** x in the chart's unit, in words: "38 GPU-min" · "$0.40 notional". */
export function spendAt(p: Pick<ProgressPerSpend, "unit">, x: number): string {
	if (p.unit === "usd") return `${dollars(x)} notional`;
	const t = deviceTime(x * 60);
	if (p.unit === "gpu") return t.replace(/ (min|s|h)$/, " GPU-$1");
	if (p.unit === "cpu") return t.replace(/ (min|s|h)$/, " CPU-$1");
	return `${t} of run time`;
}

/** The chart's sentence: where the best stands, what it cost, and what the
 *  most recent spending bought. */
export function progressWords(p: ProgressPerSpend, label: (v: string) => string = humanId): string {
	if (!p.best) {
		return p.total > 0
			? `${spendAt(p, p.total)} spent; nothing has passed ${p.countingLabel} yet`
			: `Nothing measured at ${p.countingLabel} yet`;
	}
	const fmt = (v: number) => fmtMetricValue(v, p.metricUnit, p.metric);
	const head = `Best ${p.metricLabel}: ${fmt(p.best.value)} (${label(p.best.version)}), reached after ${spendAt(p, p.best.at)}`;
	// Spending since the best was reached: still paying off, or flat?
	const since = p.total - p.best.at;
	if (p.total <= 0 || since <= p.total * 0.05) return `${head} — the latest spending is still paying off`;
	return `${head}. The ${spendAt(p, since)} since then bought no improvement`;
}
