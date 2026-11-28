// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperiment } from "@/api/me";
import { studyVerdict, valuesInWords } from "./study-verdict";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }

const base = (over: Partial<MeExperiment>): MeExperiment => ({
	id: "x", hypothesis: "", kind: "arms", status: "active", n_results: 2, criteria_met: true, ...over,
} as MeExperiment);

// The two decided MLSys experiments as /me/experiments served them on 2026-11-28.
const energyTok = base({
	id: "serve_9_2_energy", title: "Serve 9.2 at least energy",
	verdict: "llm_0_6b_c12 by +0.3pp estimated_energy_j_per_tok vs llm_0_6b_c16 (n=2)",
	best_variant: "llm_0_6b_c12", delta_pp: 0.3,
	metric: { name: "estimated_energy_j_per_tok", higher_is_better: false },
	arms: [{ id: "llm_0_6b_c12", title: "0.6B · concurrency 12" }, { id: "llm_0_6b_c16", title: "0.6B · concurrency 16 (baseline)" }],
	variants: { llm_0_6b_c12: { n: 1, mean: 0.3684, stdev: null, last: 0.3684 }, llm_0_6b_c16: { n: 1, mean: 0.3714, stdev: null, last: 0.3714 } },
});
const energyReq = base({
	id: "assistant_9_1", title: "On-device assistant 9.1",
	verdict: "llm_0_6b by +0.0pp estimated_energy_j_per_req vs llm_1_7b (n=3)",
	best_variant: "llm_0_6b",
	metric: { name: "estimated_energy_j_per_req", higher_is_better: false },
	arms: [{ id: "llm_1_7b", title: "1.7B · 80% memory (baseline)" }, { id: "llm_0_6b", title: "0.6B · 80% memory" }, { id: "llm_0_6b_util05", title: "0.6B · 50% memory" }],
	variants: {
		llm_0_6b: { n: 1, mean: 75.3149, stdev: null, last: 75.3149 },
		llm_0_6b_util05: { n: 1, mean: 76.4585, stdev: null, last: 76.4585 },
		llm_1_7b: { n: 1, mean: 185.7212, stdev: null, last: 185.7212 },
	},
});

check("a gap inside the noise names no winner, in the metric's own unit", () => {
	const v = studyVerdict(energyTok)!;
	eq(v.status, "can't tell apart yet");
	eq(v.text, "Can't tell apart yet on energy (estimated): 0.6B · concurrency 12 and 0.6B · concurrency 16 (baseline) — 0.368 vs 0.371 J per token");
	ok(!/pp\b|wins|_/.test(v.text), "no pp, no winner, no raw id");
});

check("close leaders tie; the clear loser is still named", () => {
	const v = studyVerdict(energyReq)!;
	eq(v.text, "Can't tell apart yet on energy (estimated): 0.6B · 80% memory and 0.6B · 50% memory — 75.31 vs 76.46 J per request; both ahead of 1.7B · 80% memory (baseline) at 185.7 J per request");
	ok(!v.text.includes("+0.0"), "no zero-point winner");
});

check("a clear gap names the winner against the runner-up", () => {
	const v = studyVerdict({ ...energyReq, variants: { llm_0_6b: energyReq.variants!.llm_0_6b, llm_1_7b: energyReq.variants!.llm_1_7b } })!;
	eq(v.tone, "ok");
	eq(v.text, "0.6B · 80% memory wins on energy (estimated): 75.31 vs 185.7 J per request for 1.7B · 80% memory (baseline)");
});

check("higher-is-better, ids without titles, equal means", () => {
	const e = base({ metric: { name: "goodput_tok_s" }, variants: { c4: { n: 3, mean: 22.4, stdev: 0.1 }, c8: { n: 3, mean: 22.4, stdev: 0.1 } } });
	eq(studyVerdict(e)!.status, "can't tell apart yet");
	const w = base({ metric: { name: "goodput_tok_s" }, variants: { c4: { n: 3, mean: 18, stdev: 0.1 }, c8: { n: 3, mean: 22.4, stdev: 0.1 } } });
	ok(studyVerdict(w)!.text.startsWith("C8 wins on goodput: 22.4 vs 18 tok/s"), studyVerdict(w)!.text);
});

check("not decided, not comparable, no numbers", () => {
	eq(studyVerdict(base({ criteria_met: false })), null);
	eq(studyVerdict(base({ comparable: false }))!.status, "can't compare yet");
	eq(studyVerdict(base({ best_variant: "llm_1_7b" }))!.text, "LLM 1.7b is winning");
	ok(studyVerdict(base({ variants: { a: { n: 2, mean: 3 } }, metric: { name: "score" } }))!.text.startsWith("Only A has a result"), "one side");
});

check("values say the unit once, money and shares per value", () => {
	eq(valuesInWords([0.3684, 0.3714], "estimated_energy_j_per_tok"), "0.368 vs 0.371 J per token");
	eq(valuesInWords([1.2, 3.4], "cost_usd"), "$1.2 vs $3.4");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ study-verdict: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
