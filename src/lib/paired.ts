// paired — "is this version really better than the one it is compared against?"
//
// Round 11 (2026-11-28), generic. A research step that measures a version AND
// its baseline on the same items (questions, workloads, windows) can report the
// comparison itself on its step row, under fixed names:
//
//   paired_delta     mean change per item, in the metric's own units
//   paired_ci_low / paired_ci_high   the interval around it (an app may widen
//                    it for every version tried at the step: `trials`)
//   paired_wins / paired_losses / paired_ties   items better / worse / unchanged
//   paired_n         items paired; paired_cases: clusters (optional)
//   trials           versions tried at this step so far (optional)
//
// This turns those rows into one verdict per version per step, in words:
//   "Better on 9, worse on 3, same on 41: +2.4 (interval +0.6 to +4.1). A real gain."
// A version whose interval straddles 0 is "not distinguishable" — the null result
// a single mean would have hidden. Nothing here knows what an item is.

import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";

export type PairedVerdict = "gain" | "loss" | "unclear";

export interface PairedResult {
	version: string;
	step: string;
	delta: number;
	low: number | null;
	high: number | null;
	wins: number | null;
	losses: number | null;
	ties: number | null;
	n: number | null;
	trials: number | null;
	verdict: PairedVerdict;
	ts: string;
}

export interface PairedStep {
	step: string;
	label: string;
	results: PairedResult[];
	/** The widest interval end across versions, for a shared axis. */
	span: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function verdictOf(low: number | null, high: number | null): PairedVerdict {
	if (low != null && low > 0) return "gain";
	if (high != null && high < 0) return "loss";
	return "unclear";
}

/** One result per version per step: the LATEST row at that step that carries paired_delta. */
export function pairedSteps(input: {
	steps: EvidenceStepSpec[];
	rows: MeExperimentRow[];
	/** The version everything is compared against; never shown as its own row. */
	baseline?: string | null;
	stepLabel?: (step: string) => string;
}): PairedStep[] {
	const latest = new Map<string, MeExperimentRow>();
	for (const r of input.rows) {
		const step = r.dims?.stage;
		if (!r.variant_id || !step || r.dims?.discarded === "1" || r.variant_id === input.baseline) continue;
		if (num(r.metrics?.paired_delta) == null) continue;
		const k = `${step}\u0000${r.variant_id}`;
		const prev = latest.get(k);
		if (!prev || String(r.ts) >= String(prev.ts)) latest.set(k, r);
	}
	const order = input.steps.map((s) => s.step);
	const out: PairedStep[] = [];
	for (const step of [...order, ...[...new Set([...latest.keys()].map((k) => k.split("\u0000")[0]))].filter((s) => !order.includes(s))]) {
		const results: PairedResult[] = [];
		for (const [k, r] of latest) {
			if (k.split("\u0000")[0] !== step) continue;
			const m = r.metrics ?? {};
			const low = num(m.paired_ci_low), high = num(m.paired_ci_high);
			results.push({
				version: r.variant_id!, step, delta: m.paired_delta as number, low, high,
				wins: num(m.paired_wins), losses: num(m.paired_losses), ties: num(m.paired_ties),
				n: num(m.paired_n), trials: num(m.trials), verdict: verdictOf(low, high), ts: String(r.ts ?? ""),
			});
		}
		if (!results.length) continue;
		results.sort((a, b) => b.delta - a.delta || a.version.localeCompare(b.version));
		const span = Math.max(1e-9, ...results.flatMap((x) => [Math.abs(x.delta), Math.abs(x.low ?? x.delta), Math.abs(x.high ?? x.delta)]));
		out.push({ step, label: input.stepLabel?.(step) ?? step, results, span });
	}
	return out;
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.abs(v).toFixed(0)}`;

/** "Better on 9, worse on 3, same on 41: +2.4 (interval +0.6 to +4.1, 7 versions tried). A real gain." */
export function pairedWords(r: PairedResult, against = "the baseline"): string {
	const counts = r.wins != null && r.losses != null
		? `Better on ${r.wins}, worse on ${r.losses}${r.ties != null ? `, same on ${r.ties}` : ""}: `
		: "";
	const interval = r.low != null && r.high != null
		? ` (interval ${signed(r.low)} to ${signed(r.high)}${r.trials && r.trials > 1 ? `, widened for ${r.trials} versions tried` : ""})`
		: "";
	const verdict = r.verdict === "gain" ? `A real gain over ${against}.`
		: r.verdict === "loss" ? `Worse than ${against}.`
			: r.low != null ? `Not distinguishable from ${against} yet.` : "";
	return `${counts}${signed(r.delta)}${interval}. ${verdict}`.replace(/\.\s*\.$/, ".").trim();
}

/** The step headline: how many versions are real gains, and the best of them. */
export function pairedHeadline(s: PairedStep, label: (v: string) => string, against = "the baseline"): { text: string; tone: "ok" | "attention" | "idle" } {
	const gains = s.results.filter((r) => r.verdict === "gain");
	const losses = s.results.filter((r) => r.verdict === "loss");
	const n = s.results.length;
	if (gains.length) {
		const best = gains[0];
		return { text: `${gains.length} of ${n} ${n === 1 ? "version is" : "versions are"} a real gain at ${s.label}; best ${label(best.version)}, ${signed(best.delta)}`, tone: "ok" };
	}
	if (losses.length === n) return { text: `Every version measured at ${s.label} is worse than ${against}`, tone: "attention" };
	return { text: `No version at ${s.label} is a clear gain yet${losses.length ? ` (${losses.length} worse)` : ""}`, tone: "idle" };
}
