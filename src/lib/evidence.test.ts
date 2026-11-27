// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperiment, MeExperimentRow } from "@/api/me";
import { readAppSpec } from "./app-spec";
import { bestWords, cellWords, evidenceOf, experimentSteps, gatesFromText, nextWords, ruleInWords, runningVersions, stepFootWords, stepPassWords, usd, type EvidenceStepSpec } from "./evidence";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

let t = 0;
const row = (v: string, stage: string, i: number, passed: boolean, metrics: Record<string, number>, reason = ""): MeExperimentRow => ({
	ts: new Date(Date.UTC(2026, 10, 20, 0, t++)).toISOString(), variant_id: v,
	metrics: { ...metrics, stage_passed: passed ? 1 : 0 },
	dims: { stage: stage, stage_index: String(i), passed: passed ? "1" : "0", reason, chain: "screen" },
});

// Three gated steps (a screening chain).
const THREE: EvidenceStepSpec[] = [
	{ step: "quick_check", gate: "coverage_ok >= 1", metrics: [{ name: "coverage_ok" }] },
	{ step: "full_run", gate: "score >= 0.5 and trades >= 30", metrics: [{ name: "score" }, { name: "trades" }] },
	{ step: "stress_test", gate: "p_value < 0.05 and held_out_score > 0", metrics: [{ name: "held_out_score" }, { name: "p_value", better: "lower" }] },
];
const threeRows = (): MeExperimentRow[] => [
	row("a", "quick_check", 1, true, { coverage_ok: 1, cost_usd: 0.01, duration_s: 4 }),
	row("b", "quick_check", 1, true, { coverage_ok: 1, cost_usd: 0.01, duration_s: 4 }),
	row("c", "quick_check", 1, true, { coverage_ok: 1, cost_usd: 0.01 }),
	row("d", "quick_check", 1, false, { coverage_ok: 0, cost_usd: 0.01 }, "coverage_ok 0 < 1"),
	row("a", "full_run", 2, true, { score: 1.1, trades: 80, cost_usd: 0.2 }),
	row("b", "full_run", 2, false, { score: 0.21, trades: 64, cost_usd: 0.2 }, "score 0.21 < 0.5"),
	row("c", "full_run", 2, true, { score: 0.9, trades: 40, cost_usd: 0.2 }),
	row("a", "stress_test", 3, true, { held_out_score: 0.7, p_value: 0.01, cost_usd: 1.5 }),
];

check("three gated steps: pass, fail with a reason in words, not run", () => {
	const ev = evidenceOf({ steps: THREE, versions: ["a", "b", "c", "d", "e"].map((id) => ({ id })), rows: threeRows() });
	const st = (v: string, s: string) => ev.cells.get(v)!.get(s)!.state;
	eq(["a", "b", "c", "d", "e"].map((v) => THREE.map((s) => st(v, s.step))), [
		["passed", "passed", "passed"],
		["passed", "failed", "not run"],
		["passed", "passed", "not run"],
		["failed", "not run", "not run"],
		["not run", "not run", "not run"],
	]);
	eq(ev.cells.get("b")!.get("full_run")!.reason, "Score 0.21 < 0.5");
	eq(ev.steps.map((s) => [s.label, s.runs, s.n_passed, s.n_failed]), [["Quick check", 4, 3, 1], ["Full run", 3, 2, 1], ["Stress test", 1, 1, 0]]);
	eq(ev.steps.map(stepPassWords), ["3 of 4 passed", "2 of 3 passed", "1 of 1 passed"]);
	eq(usd(ev.cost_usd), "$2.14");
	eq(stepFootWords(ev.steps[2]), "1 run · $1.50");
	eq(ev.steps[1].gateText, "Passes when score ≥ 0.5 and trades ≥ 30");
});
check("ready for the next step: passed k, nothing at k+1; failed never", () => {
	const ev = evidenceOf({ steps: THREE, versions: ["a", "b", "c", "d"].map((id) => ({ id })), rows: threeRows() });
	eq(ev.next.map((n) => [n.step, n.versions]), [["stress_test", ["c"]]]);
	eq(nextWords(ev.next[0]), "Run C through Stress test (about 1 run)");
	eq(nextWords({ ...ev.next[0], runs: 3, labels: ["A", "B", "C"] }), "Run the 3 ready versions through Stress test (about 3 runs)");
});
check("best is taken at the furthest step reached, never from a failed cell", () => {
	const ev = evidenceOf({ steps: THREE, versions: [{ id: "a" }, { id: "c" }], rows: threeRows() });
	eq(ev.best, { version: "a", step: "stress_test", metric: "held_out_score", value: 0.7 });
	eq(bestWords(ev), "Best so far: A — Held out score 0.7 at Stress test");
});
check("a rerun that passes replaces the earlier failure", () => {
	const rows = [...threeRows(), row("b", "full_run", 2, true, { score: 0.6, trades: 64, cost_usd: 0.2 })];
	const ev = evidenceOf({ steps: THREE, versions: [{ id: "b" }], rows });
	const c = ev.cells.get("b")!.get("full_run")!;
	eq([c.state, c.n, Math.round(c.value! * 1000) / 1000], ["passed", 2, 0.405]);
	eq(ev.next.map((n) => n.versions), [["b", "c"]]); // c: seen only in results, still listed
});
check("running marks the first step a version hasn't reached", () => {
	const ev = evidenceOf({ steps: THREE, versions: [{ id: "c" }, { id: "e" }], rows: threeRows(), running: new Set(["c", "e"]) });
	eq(THREE.map((s) => ev.cells.get("c")!.get(s.step)!.state), ["passed", "passed", "running"]);
	eq(THREE.map((s) => ev.cells.get("e")!.get(s.step)!.state), ["running", "not run", "not run"]);
	eq(cellWords(ev.cells.get("e")!.get("quick_check")!, ev.steps[0]), "Quick check: running now");
});
check("simulate → sandbox (gate on the first only): measured, then ready", () => {
	const steps: EvidenceStepSpec[] = [
		{ step: "simulate", gate: "goodput_tok_s >= 900", metrics: [{ name: "goodput_tok_s" }] },
		{ step: "sandbox", metrics: [{ name: "ttft_ms_p99", better: "lower" }] },
	];
	const rows = [
		row("x", "simulate", 1, true, { goodput_tok_s: 1200 }),
		row("y", "simulate", 1, false, { goodput_tok_s: 700 }, "goodput_tok_s 700 < 900"),
		row("z", "simulate", 1, true, { goodput_tok_s: 1000 }),
		row("x", "sandbox", 2, true, { ttft_ms_p99: 812 }),
	];
	const ev = evidenceOf({ steps, versions: [{ id: "x" }, { id: "y" }, { id: "z" }], rows });
	eq(["x", "y", "z"].map((v) => steps.map((s) => ev.cells.get(v)!.get(s.step)!.state)), [["passed", "measured"], ["failed", "not run"], ["passed", "not run"]]);
	eq(ev.cells.get("y")!.get("simulate")!.reason, "Goodput 700 < 900");
	eq(ev.steps.map((s) => [s.gated, s.metric, s.higherIsBetter]), [[true, "goodput_tok_s", true], [false, "ttft_ms_p99", false]]);
	eq(cellWords(ev.cells.get("x")!.get("sandbox")!, ev.steps[1]), "Sandbox: TTFT p99 812 ms");
	eq(ev.best, { version: "x", step: "sandbox", metric: "ttft_ms_p99", value: 812 });
	eq(ev.next.map((n) => [n.label, n.versions]), [["Sandbox", ["z"]]]);
});
check("no gates, one step, results naming no step: a scoreboard", () => {
	const rows: MeExperimentRow[] = [
		{ ts: "2026-11-20T00:00:00Z", variant_id: "small", metrics: { score: 0.6 } },
		{ ts: "2026-11-21T00:00:00Z", variant_id: "small", metrics: { score: 0.8 } },
		{ ts: "2026-11-21T00:00:00Z", variant_id: "large", metrics: { score: 0.9 } },
	];
	const ev = evidenceOf({ steps: [{ step: "judge", metrics: [{ name: "score" }] }], versions: [{ id: "small" }, { id: "large" }, { id: "tiny" }], rows, metric: "score" });
	eq(ev.steps.map((s) => [s.label, s.gated, s.runs]), [["Judge", false, 3]]);
	eq(["small", "large", "tiny"].map((v) => ev.cells.get(v)!.get("judge")!.state), ["measured", "measured", "not run"]);
	eq(Math.round(ev.cells.get("small")!.get("judge")!.value! * 100) / 100, 0.7);
	eq(ev.best?.version, "large");
	eq(bestWords(ev), "Best so far: Large — Score 0.9");
	eq(ev.next, []);
	// No feedback declared at all: the experiment's metric is the one column.
	const bare = evidenceOf({ steps: [], versions: [{ id: "small" }], rows, metric: "score", higherIsBetter: true });
	eq([bare.steps.length, bare.steps[0].label, bare.cells.get("large")!.get("score")!.state], [1, "Score", "measured"]);
	// No rows served, only the state's means: the same scoreboard, never a pass.
	const agg = evidenceOf({ steps: [{ step: "judge", gate: "score >= 0.75", metrics: [{ name: "score" }] }], versions: [{ id: "small" }, { id: "large" }, { id: "tiny" }], rows: [], metric: "score",
		aggregates: { small: { n: 2, mean: 0.7 }, large: { n: 1, mean: 0.9 }, tiny: { n: 0, mean: NaN } } });
	eq(["small", "large", "tiny"].map((v) => [agg.cells.get(v)!.get("judge")!.state, agg.cells.get(v)!.get("judge")!.value]), [["measured", 0.7], ["measured", 0.9], ["not run", null]]);
	eq([agg.steps[0].runs, agg.steps[0].n_passed, agg.best?.version, agg.fromState, stepFootWords(agg.steps[0], agg.fromState)], [3, 0, "large", true, "3 results"]);
});
check("once results name steps, an unnamed one isn't guessed", () => {
	const rows = [...threeRows(), { ts: "2026-11-22T00:00:00Z", variant_id: "a", metrics: { score: 9 } }, row("a", "elsewhere", 4, true, {})];
	const ev = evidenceOf({ steps: THREE, versions: [{ id: "a" }], rows });
	eq([ev.unplaced, ev.cells.get("a")!.get("quick_check")!.n], [2, 1]);
});
check("gates from the spec (read defensively) and from its text", () => {
	const text = `workflows:
- id: screen
  steps: {workflows: [quick_check, full_run]}
  feedback:
  - {step: quick_check, metrics: [{name: coverage_ok}], gate: "coverage_ok >= 1"}
  - {step: full_run, metrics: [{name: score}]}
- id: quick_check
- id: full_run
`;
	eq(gatesFromText(text), { screen: { quick_check: "coverage_ok >= 1" } });
	const e = { id: "search", loops: ["screen"], dispatch: { loop: "screen" } } as unknown as MeExperiment;
	eq(experimentSteps(readAppSpec(text), e, text).map((s) => [s.step, s.gate ?? null]), [["quick_check", "coverage_ok >= 1"], ["full_run", null]]);
	eq(experimentSteps(readAppSpec(text), { ...e, loops: ["quick_check"], dispatch: {} } as MeExperiment), []);
});
check("words: rules, money, the queue", () => {
	eq(ruleInWords("p_value < 0.05 and held_out_score > 0"), "P value < 0.05 and held out score > 0");
	eq(ruleInWords("sla_ok == 1"), "SLA ok = 1");
	eq([usd(0), usd(0.004), usd(3.2), usd(1204.4)], ["$0", "<$0.01", "$3.20", "$1,204"]);
	const q = [
		{ experiment_id: "s", state: "running", variant_id: "a" },
		{ experiment_id: "s", state: "queued", branch_label: "b" },
		{ experiment_id: "s", state: "done", variant_id: "c" },
		{ experiment_id: "other", state: "running", variant_id: "d" },
	];
	eq([...runningVersions(q, "s")], ["a", "b"]);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ evidence: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
