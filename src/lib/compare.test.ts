// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { sideStats, compareVerdict, runMetricValues, compareSides, metricBetter, rowIsSame, type SideInput } from "./compare";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const names = { a: "c16", b: "c32" };

check("stats", () => {
	const s = sideStats([1, 2, 3, NaN])!;
	eq([s.n, s.mean, s.min, s.max, s.latest, Number(s.sd.toFixed(3))], [3, 2, 1, 3, 3, 1]);
	eq(sideStats([]), null);
});
check("missing and too few say so", () => {
	eq(compareVerdict("goodput", null, null, "higher", names).text, "Neither has a goodput result yet");
	eq(compareVerdict("goodput", sideStats([1, 2, 3]), null, "higher", names).text, "c32 has no goodput result yet");
	eq(compareVerdict("goodput", sideStats([1, 2]), sideStats([5, 6, 7]), "higher", names).text, "Too few runs to tell yet (2 vs 3; 3 each needed)");
});
check("a gap inside the noise is not a win", () => {
	const v = compareVerdict("goodput", sideStats([10, 12, 9, 11]), sideStats([11, 9, 12, 10.5]), "higher", names);
	eq(v.tone, "attention");
	if (!v.text.startsWith("Can't tell apart yet")) throw new Error(v.text);
});
check("a clear gap names the side, the size and the runs; lower can be better", () => {
	const v = compareVerdict("goodput", sideStats([100, 101, 99]), sideStats([80, 81, 79]), "higher", names);
	eq([v.ahead, v.text], ["a", "c16 ahead on goodput by 20 (20%) — 3 vs 3 runs"]);
	const w = compareVerdict("TTFT p99", sideStats([1900, 1950, 1980]), sideStats([2600, 2700, 2650]), "lower", names);
	eq(w.ahead, "a");
	const sim = compareVerdict("objective", sideStats([5, 5, 5]), sideStats([7, 7, 7]), "higher", names); // deterministic simulator
	eq(sim.ahead, "b");
});

check("run metrics: every number per metric, true/false as 1/0, one version by arm", () => {
	const runs = [
		{ arm: "c8", goodput_tok_s: 22.4, ttft_ms_p99: 1374, meets_constraints: true, design_id: "baseline" },
		{ arm: "c32", goodput_tok_s: 22.4, ttft_ms_p99: 1158, meets_constraints: false },
		null,
		{ goodput_tok_s: 20, objective: 20 },
	];
	const all = runMetricValues(runs);
	eq(all.get("goodput_tok_s"), [22.4, 22.4, 20]);
	eq(all.get("meets_constraints"), [1, 0]);
	eq(all.has("design_id"), false, "strings are not metrics");
	const c8 = runMetricValues(runs, "c8");
	eq([...c8.keys()].sort(), ["goodput_tok_s", "meets_constraints", "ttft_ms_p99"]);
	eq(c8.get("ttft_ms_p99"), [1374]);
});

check("many sides: baseline column, deltas, the best side, verdicts vs the baseline", () => {
	const sides: SideInput[] = [
		{ label: "A", values: { sharpe: [1.0, 1.1, 0.9, 1.0], ttft_ms_p99: [200, 210, 190] } },
		{ label: "B", values: { sharpe: [1.3, 1.35, 1.25, 1.3], ttft_ms_p99: [150, 160, 155] } },
		{ label: "C", values: { sharpe: [1.0, 1.2, 0.8, 1.0] } },
	];
	const c = compareSides(sides, [{ name: "sharpe", label: "Sharpe" }, { name: "ttft_ms_p99", label: "TTFT p99" }]);
	eq(c.baseline, 0);
	const sh = c.rows[0];
	eq([sh.best, sh.cells.map((x) => x.best)], [1, [false, true, false]]);
	eq(sh.cells[0].verdict, null, "no verdict on the baseline");
	eq(Number(sh.cells[1].delta!.toFixed(2)), 0.3);
	eq(Number(sh.cells[1].deltaPct!.toFixed(0)), 30);
	eq(sh.cells[1].verdict!.ahead, "b");
	eq(sh.cells[2].verdict!.tone, "attention");
	eq(c.rows[1].better, "lower");
	eq(c.rows[1].best, 1, "lower latency is best");
	eq(c.rows[1].cells[2].stats, null, "C never measured it");
	eq(c.headline.text, "B is ahead of A on Sharpe by 0.3 (4 runs each)");
});
check("pinning another baseline turns the sentence around", () => {
	const sides = [{ label: "A", values: { x: [1, 1.1, 0.9] } }, { label: "B", values: { x: [2, 2.1, 1.9] } }];
	const c = compareSides(sides, ["x"], 1);
	eq(c.baseline, 1);
	eq(c.rows[0].cells[0].delta, -1);
	eq(c.headline.text, "B is ahead of A on x by 1 (3 runs each)");
});
check("too few runs names the best so far and says it can't be called", () => {
	const c = compareSides([{ label: "A", values: { goodput: [120] } }, { label: "B", values: { goodput: [130] } }], [{ name: "goodput", label: "Goodput" }]);
	eq(c.headline.text, "B has the best Goodput (130 vs 120 for A) — too few runs to tell yet: 1 run each, 3 each needed");
	eq(c.headline.tone, "idle");
	const same = compareSides([{ label: "A", values: { m: [1] } }, { label: "B", values: { m: [1] } }], ["m"]);
	eq(same.headline.text, "m is the same on every side so far — too few runs to tell yet: 1 run each, 3 each needed");
});
check("inside the noise says how many more runs each", () => {
	const c = compareSides([{ label: "A", values: { s: [10, 12, 9, 11] } }, { label: "B", values: { s: [11, 9, 12, 10.5] } }], [{ name: "s", label: "Score" }]);
	if (!/^Can't tell apart yet on Score/.test(c.headline.text)) throw new Error(c.headline.text);
	const d = compareSides([{ label: "A", values: { s: [1.0, 1.4, 0.6] } }, { label: "B", values: { s: [1.2, 1.6, 0.8] } }], [{ name: "s", label: "Score" }]);
	eq(d.headline.text, "Can't tell apart yet on Score: need about 29 more runs each");
});
check("served aggregates stand in when per-run values are missing", () => {
	const agg = (n: number, mean: number, sd: number) => ({ n, mean, sd, min: mean, max: mean, latest: mean });
	const c = compareSides([{ label: "A", values: {}, stats: { m: agg(10, 1, 0.1) } }, { label: "B", values: {}, stats: { m: agg(10, 2, 0.1) } }], ["m"]);
	eq(c.rows[0].best, 1);
	eq(c.headline.ahead, "b");
	eq(compareSides([{ label: "A", values: {} }, { label: "B", values: {} }], ["m"]).headline.text, "No m results to compare yet");
	eq(compareSides([{ label: "A", values: {} }, { label: "B", values: { m: [1, 2, 3] } }], ["m"]).headline.text, "A has no m result yet — pin another side as the baseline");
	eq(compareSides([], []).headline.text, "No numbers to compare yet");
});
check("which way is good", () => {
	eq(metricBetter("goodput_tok_s"), "higher");
	eq(metricBetter("ttft_ms_p99"), "lower");
	eq(metricBetter("cost_usd"), "lower");
	eq(metricBetter("max_drawdown"), "lower");
	eq(metricBetter("cost_usd", true), "higher", "the app's word wins");
});
check("a tie for the best is said as a tie, against the best of the rest", () => {
	const c = compareSides(["A", "B", "C", "D"].map((label, i) => ({ label, values: { m: [[1, 1, 0, 0.5][i]] } })), [{ name: "m", label: "Meets constraints" }]);
	eq(c.headline.text, "A and B share the best Meets constraints (1 vs 0.5 for D and lower) — too few runs to tell yet: 1 run each, 3 each needed");
});
check("rows that read the same everywhere fold", () => {
	const c = compareSides([{ label: "A", values: { x: [1], y: [1] } }, { label: "B", values: { x: [1], y: [2] } }, { label: "C", values: { x: [1] } }], ["x", "y"]);
	eq([rowIsSame(c.rows[0]), rowIsSame(c.rows[1])], [true, false]);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ compare: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
