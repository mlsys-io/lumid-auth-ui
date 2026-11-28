// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperimentRow } from "@/api/me";
import { pairedHeadline, pairedSteps, pairedWords, verdictOf } from "./paired";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const row = (v: string, stage: string, metrics: Record<string, number>, ts = "1", dims: Record<string, string> = {}): MeExperimentRow =>
	({ ts, variant_id: v, metrics, dims: { stage, ...dims } }) as MeExperimentRow;
const steps = [{ step: "quick", metrics: [] }, { step: "dev_eval", metrics: [] }];

check("verdict: the interval decides, not the mean", () => {
	eq([verdictOf(0.4, 3), verdictOf(-3, -0.2), verdictOf(-1, 4), verdictOf(null, null)], ["gain", "loss", "unclear", "unclear"]);
});

check("one result per version per step, latest row wins, baseline and plain rows skipped", () => {
	const rows = [
		row("base", "quick", { paired_delta: 0, paired_ci_low: 0, paired_ci_high: 0 }),
		row("a", "quick", { paired_delta: 1, paired_ci_low: -2, paired_ci_high: 4 }, "1"),
		row("a", "quick", { paired_delta: 3, paired_ci_low: 0.5, paired_ci_high: 5, paired_wins: 9, paired_losses: 3, paired_ties: 25, trials: 2 }, "2"),
		row("b", "quick", { paired_delta: -2, paired_ci_low: -4, paired_ci_high: -0.5 }, "3"),
		row("c", "quick", { score: 50 }, "4"),
		row("a", "dev_eval", { paired_delta: 2.4, paired_ci_low: -0.3, paired_ci_high: 5.1, trials: 7 }, "5"),
		row("d", "quick", { paired_delta: 9 }, "6", { discarded: "1" }),
	];
	const out = pairedSteps({ steps, rows, baseline: "base" });
	eq(out.map((s) => s.step), ["quick", "dev_eval"]);
	eq(out[0].results.map((r) => [r.version, r.delta, r.verdict]), [["a", 3, "gain"], ["b", -2, "loss"]]);
	eq(out[0].span, 5);
	eq(pairedWords(out[0].results[0], "the current harness"),
		"Better on 9, worse on 3, same on 25: +3.0 (interval +0.5 to +5.0, widened for 2 versions tried). A real gain over the current harness.");
	eq(pairedWords(out[1].results[0]), "+2.4 (interval −0.3 to +5.1, widened for 7 versions tried). Not distinguishable from the baseline yet.");
	eq(pairedWords(out[0].results[1]), "−2.0 (interval −4.0 to −0.5). Worse than the baseline.");
});

check("headline in words", () => {
	const s = pairedSteps({ steps, rows: [row("a", "quick", { paired_delta: 3, paired_ci_low: 1, paired_ci_high: 5 }), row("b", "quick", { paired_delta: 1, paired_ci_low: -1, paired_ci_high: 3 })], stepLabel: () => "Quick" })[0];
	eq(pairedHeadline(s, (v) => v.toUpperCase()), { text: "1 of 2 versions are a real gain at Quick; best A, +3.0", tone: "ok" });
	const none = pairedSteps({ steps, rows: [row("b", "quick", { paired_delta: -1, paired_ci_low: -2, paired_ci_high: -0.1 })], stepLabel: () => "Quick" })[0];
	eq(pairedHeadline(none, (v) => v).text, "Every version measured at Quick is worse than the baseline");
	eq(pairedHeadline(none, (v) => v, "the current harness").text, "Every version measured at Quick is worse than the current harness");
});

check("a withheld interval is said in words, never a bare number", () => {
	const s = pairedSteps({ steps, rows: [row("a", "quick", { paired_delta: 4, paired_wins: 3, paired_losses: 0, paired_ties: 9, paired_ci_withheld: 1 })] })[0];
	eq([s.results[0].withheld, s.results[0].verdict], [true, "unclear"]);
	eq(pairedWords(s.results[0]), "Better on 3, worse on 0, same on 9: +4.0. No interval yet: too few cases to tell. Measure it on the full set.");
});

check("nothing paired renders nothing", () => {
	eq(pairedSteps({ steps, rows: [row("a", "quick", { score: 1 })] }), []);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ paired: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
