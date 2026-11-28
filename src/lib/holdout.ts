// holdout — keep held-out data honest (round 10, 2026-11-28; generic).
//
// A research app keeps some data back to check its final pick: a holdout
// year of prices, held-out prompt sets. Reading it while still choosing
// turns it into training data, and every extra version tried raises the
// chance that the best one is luck. The spec marks the ONE feedback step
// allowed to read held-out data (`feedback[].holdout: true`); the platform
// passes it LUMID_HOLDOUT=1 and that step's rows carry dims.read_holdout = "1".
// This says, in words: which step reads it, how many versions have read it,
// how many trials were made (what deflated metrics need), and when a version
// read it more than once. Pure functions.

import { parseDocument } from "yaml";
import type { MeExperimentRow } from "@/api/me";
import { humanId } from "@/lib/research-map";

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** `{workflow id → holdout step}` from the spec's text; every step marked
 *  `holdout: true` is listed (more than one is a spec error, said in words). */
export function holdoutStepsFromText(text: string): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	let d: unknown;
	try { d = parseDocument(text || "").toJS(); } catch { return out; }
	const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
	for (const w of [...arr(o.workflows), ...arr(o.loops)]) {
		const wo = (w && typeof w === "object" ? w : {}) as Record<string, unknown>;
		const id = String(wo.id ?? wo.name ?? "");
		for (const f of arr(wo.feedback)) {
			const fo = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
			if (id && typeof fo.step === "string" && fo.holdout === true) (out[id] ??= []).push(fo.step);
		}
	}
	return out;
}

export interface HoldoutState {
	step: string | null;
	stepLabel: string;
	problems: string[];
	/** Versions with at least one result at any step. */
	versionsTried: number;
	/** Results recorded at any step (every one is a trial). */
	trials: number;
	/** Versions whose rows say they read the held-out data. */
	readBy: string[];
	/** Versions that read it more than once. */
	reread: string[];
}

export function holdoutState(input: { steps: string[]; holdoutSteps: string[]; rows: MeExperimentRow[] }): HoldoutState {
	const { steps, holdoutSteps, rows } = input;
	const problems: string[] = [];
	const step = holdoutSteps[0] ?? null;
	if (holdoutSteps.length > 1) problems.push(`More than one step reads held-out data (${holdoutSteps.map(humanId).join(", ")}); only the last check should`);
	if (step && steps.length && steps[steps.length - 1] !== step) problems.push(`${humanId(step)} reads held-out data but is not the last step; later steps would choose with it`);
	const versions = new Set<string>(); const reads = new Map<string, number>();
	let trials = 0;
	for (const r of rows) {
		if (!r.variant_id || r.dims?.discarded === "1") continue;
		versions.add(r.variant_id); trials++;
		if (r.dims?.read_holdout === "1") reads.set(r.variant_id, (reads.get(r.variant_id) ?? 0) + 1);
	}
	return {
		step, stepLabel: step ? humanId(step) : "", problems, versionsTried: versions.size, trials,
		readBy: [...reads.keys()], reread: [...reads].filter(([, n]) => n > 1).map(([v]) => v),
	};
}

/** The one line, plus a warning when there is one. */
export function holdoutWords(h: HoldoutState, label: (v: string) => string = humanId): { text: string; warn: string | null } {
	if (!h.step) return { text: "", warn: h.problems[0] ?? null };
	const read = h.readBy.length;
	const text = `Held-out data: read only at ${h.stepLabel} · ${read} of ${h.versionsTried} ${h.versionsTried === 1 ? "version has" : "versions have"} read it · ${h.trials} ${h.trials === 1 ? "trial" : "trials"} so far`;
	const warn = h.problems[0]
		?? (h.reread.length ? `${h.reread.map(label).join(", ")} read the held-out data more than once — each re-read wears it out as a test` : null);
	return { text, warn };
}
