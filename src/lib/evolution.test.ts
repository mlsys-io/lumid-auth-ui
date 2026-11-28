// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperimentRow } from "@/api/me";
import { buildEvolution, chainHeadline, lastStepPoints, linkValueWords, marginWords, meansByStep, rowStep, seriesFromRows, shortDevice, stepOrder, stepPhrase, versionStepWords } from "./evolution";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }
const ts = (d: number) => new Date(Date.UTC(2026, 10, d)).toISOString();

// Raw results: "a" collects 3 results, "b" 2; min_samples 2.
const raw = [
	{ id: "a", points: [{ ts: ts(1), v: 1 }, { ts: ts(3), v: 3 }, { ts: ts(5), v: 5 }] },
	{ id: "b", points: [{ ts: ts(2), v: 10 }, { ts: ts(4), v: 6 }] },
];

check("points are running means, counted once n ≥ min_samples", () => {
	const e = buildEvolution(raw, { minSamples: 2 })!;
	eq(e.points.map((p) => [p.arm, p.mean, p.n, p.counted]), [["a", 1, 1, false], ["b", 10, 1, false], ["a", 2, 2, true], ["b", 8, 2, true], ["a", 3, 3, true]]);
});
check("the frontier counts everyone; the best line only counted versions", () => {
	const e = buildEvolution(raw, { minSamples: 2 })!;
	eq(e.frontier.map((s) => [s.arm, s.value]), [["a", 1], ["b", 10], ["b", 8]]);
	eq(e.best.map((s) => [s.arm, s.value]), [["a", 2], ["b", 8]]);
	eq(e.hero, { arm: "b", value: 8 });
});
check("lower is better flips the best", () => {
	const e = buildEvolution(raw, { minSamples: 2, higherIsBetter: false })!;
	eq(e.hero, { arm: "a", value: 3 });
});
check("running-mean input is taken as is (state.history)", () => {
	const e = buildEvolution([{ id: "a", points: [{ ts: ts(1), v: 0.5, n: 10 }, { ts: ts(2), v: 0.6, n: 20 }] }], { runningMean: true, minSamples: 12 })!;
	eq(e.points.map((p) => [p.mean, p.n, p.counted]), [[0.5, 10, false], [0.6, 20, true]]);
	eq(e.best.map((s) => s.value), [0.6]);
});
check("chain: order of first result, states in words", () => {
	const e = buildEvolution(raw, { minSamples: 3, declaredArms: ["a", "b", "c"] })!;
	eq(e.chain.map((c) => [c.arm, c.state]), [["a", "best so far"], ["b", "collecting"], ["c", "not run yet"]]);
	const d = buildEvolution(raw, { minSamples: 2, decided: true, winner: "b" })!;
	eq(d.chain.map((c) => c.state), ["dropped", "winning"]);
});
check("no points, no chart", () => eq(buildEvolution([{ id: "a", points: [] }], {}), null));

// ── one number per version per step (2026-11-28) ─────────────────────────

const STEPS = [
	{ step: "simulate", metrics: [{ name: "goodput_tok_s" }, { name: "estimated_energy_j_per_req" }] },
	{ step: "sandbox", metrics: [{ name: "goodput_tok_s" }, { name: "estimated_energy_j_per_req" }, { name: "energy_j_per_req" }] },
];
const GPU = { measured_on: "NVIDIA GeForce RTX 5080 at office" };
const r = (v: string, d: number, m: Record<string, number>, dims: Record<string, string> = {}) =>
	({ ts: ts(d), variant_id: v, metrics: m, dims }) as MeExperimentRow;
// MLSys 9.1: 0.6B simulated 86.49, measured 75.31 on the card — once "80.9".
const A91 = [
	r("llm_0_6b", 1, { estimated_energy_j_per_req: 86.49 }, { stage: "simulate", stage_index: "1" }),
	r("llm_1_7b", 1, { estimated_energy_j_per_req: 276.9 }, { stage: "simulate", stage_index: "1" }),
	r("llm_0_6b", 2, { estimated_energy_j_per_req: 75.31, energy_j_per_req: 75.31 }, GPU),
	r("llm_1_7b", 3, { estimated_energy_j_per_req: 185.72, energy_j_per_req: 185.72 }, GPU),
	r("llm_4b", 2, { estimated_energy_j_per_req: 400 }, { stage: "simulate", stage_index: "1" }),
];

check("a row's step: its stage, its workflow, its index, else the step whose metrics it reports", () => {
	eq(rowStep(A91[0], STEPS), "simulate");
	eq(rowStep(A91[2], STEPS), "sandbox");
	eq(rowStep(r("x", 1, { goodput_tok_s: 1 }, { loop: "sandbox" }), STEPS), "sandbox");
	eq(rowStep(r("x", 1, { goodput_tok_s: 1 }, { stage_index: "1" }), STEPS), "simulate");
	eq(rowStep(r("x", 1, { other: 1 }), STEPS), "");
	eq(rowStep(r("x", 1, { other: 1 }), [{ step: "only" }]), "only");
	eq(stepOrder(A91, STEPS), ["simulate", "sandbox"]);
	eq(stepOrder(A91), ["simulate", ""], "no spec: the unnamed step last");
});

check("steps in words", () => {
	eq(shortDevice("NVIDIA GeForce RTX 5080 at office"), "RTX 5080");
	eq(stepPhrase("sandbox", [A91[2]]), "on the RTX 5080");
	eq(stepPhrase("simulate"), "simulated");
	eq(stepPhrase("dev_eval"), "at Dev eval");
	eq(stepPhrase(""), "");
});

check("means are keyed by (version, step), never averaged across steps", () => {
	const m = meansByStep(A91, "estimated_energy_j_per_req", STEPS);
	eq([m.get("llm_0_6b")!.get("simulate")!.mean, m.get("llm_0_6b")!.get("sandbox")!.mean], [86.49, 75.31]);
	const v = (x: number) => `${Math.round(x * 10) / 10} J per request`;
	eq(versionStepWords(A91, "llm_0_6b", "estimated_energy_j_per_req", v, (x) => String(Math.round(x * 10) / 10), STEPS), "75.3 J per request on the RTX 5080 · 86.5 simulated");
	eq(versionStepWords(A91, "llm_4b", "estimated_energy_j_per_req", v, undefined, STEPS), "400 J per request simulated");
	eq(versionStepWords(A91, "nope", "estimated_energy_j_per_req", v), "");
	const two: Array<{ step?: string; v: number }> = [{ step: "a", v: 1 }, { step: "b", v: 2 }];
	eq(lastStepPoints(two, ["a", "b"]), { points: [{ step: "b", v: 2 }], step: "b" });
	const none: Array<{ step?: string; v: number }> = [{ v: 1 }];
	eq(lastStepPoints(none), { points: [{ v: 1 }], step: null });
});

check("the story is told at the LAST step with data, and names it", () => {
	const { series, steps, stepLabels } = seriesFromRows(A91, "estimated_energy_j_per_req", STEPS);
	const e = buildEvolution(series, { higherIsBetter: false, steps, stepLabels, declaredArms: ["llm_1_7b", "llm_0_6b", "llm_4b"] })!;
	eq([e.step, e.stepLabel], ["sandbox", "on the RTX 5080"]);
	eq(e.hero, { arm: "llm_0_6b", value: 75.31 });
	const c06 = e.chain.find((c) => c.arm === "llm_0_6b")!;
	eq([c06.mean, c06.atSteps], [75.31, [{ step: "simulate", label: "simulated", mean: 86.49, n: 1 }]]);
	// a version only simulated has no number at the GPU step — its simulated one is shown, named
	const c4 = e.chain.find((c) => c.arm === "llm_4b")!;
	eq([c4.state, linkValueWords(c4, (x) => String(x))], ["not run yet", "400 simulated"]);
	// asked for the earlier step
	eq(buildEvolution(series, { higherIsBetter: false, steps, stepLabels, step: "simulate" })!.hero, { arm: "llm_0_6b", value: 86.49 });
});

// ── ties ─────────────────────────────────────────────────────────────────

const flat = (vals: Record<string, number[]>) => Object.entries(vals).map(([id, vs]) => ({ id, points: vs.map((v, i) => ({ ts: ts(i + 1), v })) }));

check("equal values are tied for best, not one best and the rest trying", () => {
	const e = buildEvolution(flat({ c4: [22.4], c8: [22.4], c16: [22.4], c4b: [19.2] }), {})!;
	eq(e.tie && [e.tie.arms.length, e.tie.value, e.tie.how], [3, 22.4, "equal"]);
	eq(Object.fromEntries(e.chain.map((c) => [c.arm, c.state])), { c16: "tied", c4: "tied", c4b: "trying", c8: "tied" });
	eq(chainHeadline(e, (a) => a.toUpperCase(), (v) => `${v} tok/s`), "Tied for best (3 at 22.4 tok/s)");
});

check("a declared secondary metric decides a tie", () => {
	const tieBreakers = [{ name: "ttft_ms_p99", label: "TTFT p99", unit: "ms", higherIsBetter: false, values: { c4: 900, c8: 700, c16: 1100 } }];
	const e = buildEvolution(flat({ c4: [22.4], c8: [22.4], c16: [22.4] }), { tieBreakers })!;
	eq(e.tie!.decidedBy && [e.tie!.decidedBy.arm, e.tie!.decidedBy.value], ["c8", 700]);
	eq(e.hero!.arm, "c8");
	eq(Object.fromEntries(e.chain.map((c) => [c.arm, c.state])), { c16: "tied", c4: "tied", c8: "best so far" });
	eq(chainHeadline({ chain: e.chain }, (a) => a.toUpperCase(), (v) => `${v} tok/s`), "Tied for best (3 at 22.4 tok/s) — TTFT p99 decides: C8");
	// a secondary that can't separate them either decides nothing
	const same = buildEvolution(flat({ c4: [22.4], c8: [22.4] }), { tieBreakers: [{ ...tieBreakers[0], values: { c4: 700, c8: 700 } }] })!;
	eq(same.tie!.decidedBy, undefined);
});

check("inside the noise is a tie; one result each under 2% can't be told apart", () => {
	const noisy = buildEvolution(flat({ a: [10, 12, 11], b: [11, 13, 12] }), {})!;
	eq([noisy.tie?.how, noisy.chain.map((c) => c.state)], ["noise", ["tied", "tied"]]);
	const near = buildEvolution(flat({ c12: [0.366], c16: [0.369] }), { higherIsBetter: false })!;
	eq(near.tie?.how, "near");
	ok(chainHeadline(near, (a) => a, (v) => String(v)).includes("can't tell apart yet"), "near words");
	const apart = buildEvolution(flat({ a: [10, 10, 10], b: [12, 12, 12] }), {})!;
	eq([apart.tie, apart.chain.map((c) => c.state)], [null, ["trying", "best so far"]]);
});

check("can't tell apart yet comes before dropped; the winner says by how much and on how many", () => {
	const e = buildEvolution(flat({ c12: [0.366], c16: [0.369], c4: [0.5] }), { higherIsBetter: false, decided: true, winner: "c12" })!;
	eq(e.chain.map((c) => c.state), ["winning", "can't tell apart yet", "dropped"]);
	const w = e.chain[0].margin!;
	eq([w.over, Math.round(w.gap * 1e4) / 1e4, Math.round(w.pct! * 10) / 10, w.n, w.overN, w.tie], ["c16", 0.003, 0.8, 1, 1, "near"]);
	eq(marginWords(w, (v) => `${Math.round(v * 1e4) / 1e4} J`), "by 0.003 J (0.8%) · 1 result each");
	eq(chainHeadline(e, (a) => a.toUpperCase(), (v) => `${Math.round(v * 1e4) / 1e4} J`), "Winning: C12 by 0.003 J (0.8%) · 1 result each — can't tell apart yet from C16");
	eq(marginWords({ over: "b", gap: 2, pct: 25, n: 3, overN: 1, tie: null }, String), "by 2 (25%) · 3 results vs 1");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;
