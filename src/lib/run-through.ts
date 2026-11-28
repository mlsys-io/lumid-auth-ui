// run-through — how far a press runs an experiment's chain, and what that costs.
//
// "Run the untried versions" queued the WHOLE chain, so every version that
// passed the cheap step went straight on to the expensive one (MLSys: GPU
// minutes per version; quant: robustness, which reads the held-out year). The
// engine now stops a chain after a named step (`until_step`, LumidOS #172) and
// holds the rest for a later press. These pure functions pick the choices and
// price them from the experiment's OWN history — the average usage of each step
// per run — so no app has to declare a cost. Round 10, 2026-11-28.

import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { humanId } from "@/lib/research-map";
import { stepSpend } from "@/lib/spend";

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

/**
 * What one version costs through `until` (or every step), from the experiment's
 * own rows: each step's average metered usage per run, summed. Null when no
 * step on the way was ever metered — then the press says nothing about cost
 * rather than guessing.
 */
export function estimateThrough(rows: MeExperimentRow[] | null | undefined, steps: EvidenceStepSpec[], until: string | null): { gpu_s: number; cpu_s: number; cost_usd: number } | null {
	if (!rows?.length || !steps.length) return null;
	const stop = until === null ? steps.length - 1 : steps.findIndex((s) => s.step === until);
	if (stop < 0) return null;
	const out = { gpu_s: 0, cpu_s: 0, cost_usd: 0 };
	let metered = false;
	for (const s of steps.slice(0, stop + 1)) {
		const sp = stepSpend(rows, s.step);
		if (!sp.metered) continue;
		metered = true;
		out.gpu_s += sp.gpu_s / sp.metered;
		out.cpu_s += sp.cpu_s / sp.metered;
		out.cost_usd += sp.cost_usd / sp.metered;
	}
	return metered ? out : null;
}
