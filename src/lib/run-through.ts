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

/**
 * The ways a press can run a chain of steps: through each step but the last
 * (holding the rest), or all the way. None for a single step. The default is
 * the one that holds only the LAST step — in a gated chain the last step is the
 * expensive or the final one (real hardware, the held-out data), so it waits
 * for the reader to look at what came before.
 */
export function throughChoices(steps: EvidenceStepSpec[]): { choices: ThroughChoice[]; preferred: number } {
	if (steps.length < 2) return { choices: [], preferred: 0 };
	const names = steps.map((s) => humanId(s.step));
	const choices: ThroughChoice[] = names.slice(0, -1).map((_, k) => ({
		until: steps[k].step,
		through: joinWords(names.slice(0, k + 1)),
		holds: `holds ${joinWords(names.slice(k + 1))}`,
	}));
	choices.push({ until: null, through: joinWords(names), holds: "" });
	return { choices, preferred: choices.length - 2 };
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
