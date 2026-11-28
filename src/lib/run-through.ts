// run-through — how far a press runs an experiment's chain, and what that costs.
//
// "Run the untried versions" queued the WHOLE chain, so every version that
// passed the cheap step went straight on to the expensive one (MLSys: GPU
// minutes per version; quant: robustness, which reads the held-out year). The
// engine now stops a chain after a named step (`until_step`, LumidOS #172) and
// holds the rest for a later press. These pure functions pick the choices and
// price them from the experiment's OWN history — the average usage of each step
// per run — so no app has to declare a cost. Round 10, 2026-11-28. A step's
// dollars are the MEDIAN of its rows' cost_usd, else its instrument's estimate.

import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { humanId } from "@/lib/research-map";
import { notionalPart, stepSpend, usageOfRow, workflowRunEstimate, type MeUsage } from "@/lib/spend";

export interface ThroughChoice {
	/** The step to stop after; null = run every step. */
	until: string | null;
	/** "Data check and Bar backtest" — what the press runs, in words. */
	through: string;
	/** "holds Robustness" — what waits for a later press. */
	holds: string;
}

const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** A step costs money when its runs so far averaged at least this much each
 *  (a CPU-metered step costs fractions of a cent and stays "free"). */
export const PAID_STEP_USD = 0.01;

/** The first step whose own past runs averaged a real cost, or -1. */
export function firstPaidStep(steps: EvidenceStepSpec[], rows?: MeExperimentRow[] | null): number {
	if (!rows?.length) return -1;
	return steps.findIndex((s) => {
		const sp = stepSpend(rows, s.step);
		return sp.metered > 0 && sp.cost_usd / sp.metered >= PAID_STEP_USD;
	});
}

/**
 * The ways a press can run a chain of steps: through each step but the last
 * (holding the rest), or all the way. None for a single step. The default holds
 * the LAST step — in a gated chain it is the expensive or the final one (real
 * hardware, the held-out data) — and never runs a PAID step unasked: when the
 * experiment's own rows show a step costing money, the default stops before it.
 * (2026-11-28: MBB's default ran its paid Claude step, $0.92 nobody chose.)
 */
export function throughChoices(steps: EvidenceStepSpec[], rows?: MeExperimentRow[] | null): { choices: ThroughChoice[]; preferred: number } {
	if (steps.length < 2) return { choices: [], preferred: 0 };
	const names = steps.map((s) => humanId(s.step));
	const choices: ThroughChoice[] = names.slice(0, -1).map((_, k) => ({
		until: steps[k].step,
		through: joinWords(names.slice(0, k + 1)),
		holds: `holds ${joinWords(names.slice(k + 1))}`,
	}));
	choices.push({ until: null, through: joinWords(names), holds: "" });
	let preferred = choices.length - 2;
	const paid = firstPaidStep(steps, rows);
	if (paid >= 0) preferred = Math.max(0, Math.min(preferred, paid - 1));
	return { choices, preferred };
}

const median = (xs: number[]): number => {
	const v = [...xs].sort((a, b) => a - b);
	return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/**
 * What one version costs through `until` (or every step), from the experiment's
 * own rows: each step's average device time per metered run and its MEDIAN
 * cost_usd (one long Claude answer shouldn't price every version), summed. A
 * step with no metered row of its own is priced from its instrument (`service`
 * on the step — this app's history on /me/usage first, then the platform
 * estimate's cost_usd) when `usage` is given. `notional_usd` is the part that
 * is device time at platform rates. Null when nothing on the way says — then
 * the press says nothing about cost rather than guessing.
 */
export function estimateThrough(
	rows: MeExperimentRow[] | null | undefined,
	steps: Array<EvidenceStepSpec & { service?: string }>,
	until: string | null,
	opts: { usage?: MeUsage | null } = {},
): { gpu_s: number; cpu_s: number; cost_usd: number; notional_usd: number } | null {
	if (!steps.length) return null;
	const stop = until === null ? steps.length - 1 : steps.findIndex((s) => s.step === until);
	if (stop < 0) return null;
	const out = { gpu_s: 0, cpu_s: 0, cost_usd: 0, notional_usd: 0 };
	let metered = false;
	for (const s of steps.slice(0, stop + 1)) {
		const here = (rows ?? []).filter((r) => (r.dims?.stage ?? "") === s.step);
		const sp = stepSpend(here);
		if (sp.metered) {
			metered = true;
			const costs = here.map((r) => usageOfRow(r)).filter((u) => u && u.metered !== "reused" && typeof u.cost_usd === "number").map((u) => u!.cost_usd!);
			const cost = costs.length ? median(costs) : 0;
			const gpu = sp.gpu_s / sp.metered, cpu = sp.cpu_s / sp.metered;
			out.gpu_s += gpu; out.cpu_s += cpu; out.cost_usd += cost;
			out.notional_usd += Math.min(cost, sp.cost_usd > 0 ? (sp.notional_usd / sp.cost_usd) * cost : 0);
			continue;
		}
		const svc = (s as { service?: string }).service;
		const u = opts.usage;
		if (!svc || !u) continue;
		const est = workflowRunEstimate({ ...u, used: { ...u.used, by_workflow: {} } }, "", [svc]);
		if (!est) continue;
		metered = true;
		out.gpu_s += est.gpu_s; out.cpu_s += est.cpu_s; out.cost_usd += est.cost_usd;
		out.notional_usd += notionalPart(est);
	}
	return metered ? out : null;
}
