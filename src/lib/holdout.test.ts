// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperimentRow } from "@/api/me";
import { holdoutState, holdoutStepsFromText, holdoutWords } from "./holdout";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const row = (v: string, stage: string, read = false) => ({ ts: "1", variant_id: v, metrics: {}, dims: { stage, ...(read ? { read_holdout: "1" } : {}) } }) as MeExperimentRow;

check("reads the holdout step from the spec", () => {
	eq(holdoutStepsFromText("workflows:\n- id: screen\n  feedback:\n  - {step: backtest}\n  - {step: robustness, holdout: true}\n"), { screen: ["robustness"] });
});

check("counts trials and who read the held-out data", () => {
	const h = holdoutState({ steps: ["backtest", "robustness"], holdoutSteps: ["robustness"], rows: [
		row("a", "backtest"), row("b", "backtest"), row("c", "backtest"), row("a", "robustness", true), row("a", "robustness", true),
	] });
	eq([h.versionsTried, h.trials, h.readBy, h.reread], [3, 5, ["a"], ["a"]]);
	const w = holdoutWords(h, (v) => v.toUpperCase());
	eq(w.text, "Held-out data: read only at Robustness · 1 of 3 versions have read it · 5 trials so far");
	eq(w.warn, "A read the held-out data more than once — each re-read wears it out as a test");
});

check("a holdout step that isn't last, or two of them, is said", () => {
	eq(holdoutState({ steps: ["a", "b"], holdoutSteps: ["a"], rows: [] }).problems, ["A reads held-out data but is not the last step; later steps would choose with it"]);
	eq(holdoutState({ steps: ["a", "b"], holdoutSteps: ["a", "b"], rows: [] }).problems.length, 2);
	eq(holdoutWords(holdoutState({ steps: ["a"], holdoutSteps: [], rows: [] })), { text: "", warn: null });
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ holdout: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
