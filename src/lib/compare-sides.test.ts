// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeCycleDetail, MeExperimentDetail } from "@/api/me";
import { compareHref } from "./run-routes";
import { compareSides } from "./compare";
import {
	parseCompareQuery, runSide, versionSide, metricsToCompare, settingDiffs, sameSettingsWords, measuredDifferently,
	deltaWords, deltaIsBetter, meanWords, chartScale, versionName, mVal, sideLabel, distinctNames, sameMetricsWords, settingWords,
} from "./compare-sides";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("compare addresses round-trip; 2–5 sides", () => {
	const href = compareHref("quant-research", { runs: [{ loop: "backtest", ts: "20261127T124434Z" }, { loop: "stock_backtests", ts: "1795788785" }] });
	eq(href, "/studio/apps/quant-research/compare?runs=backtest:20261127T124434Z,stock_backtests:20261127T141305Z");
	const p = parseCompareQuery(href.split("?")[1]);
	eq(p.refs, [{ kind: "run", loop: "backtest", ts: "20261127T124434Z" }, { kind: "run", loop: "stock_backtests", ts: "20261127T141305Z" }]);
	eq(p.note, null);
	const v = compareHref("mlsys-research", { versions: [{ exp: "edge_memory_budget", version: "util_0_8" }, { exp: "edge_memory_budget", version: "util_0_9" }] });
	eq(parseCompareQuery(new URL(`https://x${v}`).search).refs[1], { kind: "version", exp: "edge_memory_budget", version: "util_0_9" });
	eq(parseCompareQuery("runs=a:1").note, "Pick at least two runs or versions to compare.");
	eq(parseCompareQuery("runs=a:20261101T000000Z,a:20261101T000000Z").refs.length, 1, "duplicates collapse");
	const six = parseCompareQuery(`runs=${[1, 2, 3, 4, 5, 6].map((i) => `w:2026110${i}T000000Z`).join(",")}`);
	eq([six.refs.length, six.note], [5, "Showing the first 5 of 6 — compare up to 5 at a time."]);
});

const cyc = (metrics: Record<string, unknown>, extra: Partial<MeCycleDetail> = {}): MeCycleDetail => ({
	app: "mlsys-research", loop: "simulate", ts: "20261125T092430Z", ok: true, steps: [], ...extra,
	summary: { metrics, mode: "paper", assets_used: { app: { version: "0.3.1" }, dataset: { id: "exercise_protocol_v1_20", version: "v0.1.2" }, metric: { name: "goodput_tok_s", higher_is_better: true } }, ...(extra.summary || {}) },
});

check("a run side: findings only, settings in words", () => {
	const s = runSide({ loop: "simulate", ts: "20261125T092430Z" }, cyc({
		arm: "util_0_8", goodput_tok_s: 22.4, ttft_ms_p99: 245, meets_constraints: true, seed: 42, config_hash: "abc",
		measured_on: "Simulated RTX 5080", gpu: "RTX 5080", fleet_job: "office:fm:wfl-1", design_id: "baseline",
	}), 1, "Simulate");
	eq(s.letter, "B");
	eq(Object.keys(s.values).sort(), ["goodput_tok_s", "meets_constraints", "ttft_ms_p99"]);
	eq(s.values.meets_constraints, [1]);
	eq(s.primary, "goodput_tok_s");
	if (!/ · succeeded$/.test(s.sub)) throw new Error(s.sub);
	eq(s.name, "Simulate · Util 0 8");
	eq(s.label, "B (Simulate · Util 0 8)");
	const st = Object.fromEntries(s.settings);
	eq([st.Workflow, st.Version, st["Measured on"], st.Data, st.Compute, st.Mode, st["Design ID"]],
		["Simulate", "Util 0 8", "Simulated RTX 5080", "Exercise protocol v1 20 (version v0.1.2)", "RTX 5080 at office", "Paper", "baseline"]);
	eq(runSide({ loop: "kol_poll", ts: "x" }, null, 0).sub, "x · couldn't read this run");
	eq(runSide({ loop: "kol_poll", ts: "x" }, null, 0).settings, [["Workflow", "KOL poll"]]);
});

const EXP = {
	id: "edge_memory_budget", hypothesis: "", kind: "arms", status: "active", n_results: 4, criteria_met: false,
	metric: { name: "meets_constraints", higher_is_better: true }, dataset_id: "exercise_protocol_v1_20",
	dispatch: { loop: "simulate" }, loops: ["simulate"],
	arms: [{ id: "util_0_95", description: "Reserve 95%.", overrides: { "serving.gpu_memory_utilization": 0.95 } }, { id: "util_0_8", description: "The baseline (80%)." }],
	state: { variants: { util_0_8: { n: 1, mean: 1, stdev: null, last: 1 }, util_0_95: { n: 1, mean: 0, stdev: null, last: 0 } }, comparable: true },
	results: null, series: [], cases: [],
} as unknown as MeExperimentDetail;

check("a version side: ledger rows when there are some, served averages when not", () => {
	const a = versionSide(EXP, "util_0_95", 0, { workflowTitle: (l) => (l === "simulate" ? "Simulate" : l) });
	eq(a.stats!.meets_constraints, { n: 1, mean: 0, sd: 0, min: 0, max: 0, latest: 0 });
	eq(a.sub, "1 result (averages only)");
	const st = Object.fromEntries(a.settings);
	eq([st.Experiment, st.Version, st.Workflow, st["What it changes"], st["Changes: Serving GPU memory utilization"], st["Judged on"]],
		["Edge memory budget", "Util 0 95", "Simulate", "Reserve 95%.", "0.95", "Meets constraints"]);
	const withRows = { ...EXP, results: [{ ts: "1", variant_id: "util_0_8", metrics: { meets_constraints: 1, goodput_tok_s: 20 } }, { ts: "2", variant_id: "util_0_8", metrics: { meets_constraints: 1, goodput_tok_s: 21 } }] } as unknown as MeExperimentDetail;
	const b = versionSide(withRows, "util_0_8", 1);
	eq([b.values.goodput_tok_s, b.sub, b.stats], [[20, 21], "2 results", {}]);
	eq(versionSide(EXP, "never_ran", 2).sub, "no results yet");
	eq(versionName("current"), "Current version");
	const odd = versionSide({ ...EXP, state: { ...(EXP.state as object), comparable: false, instruments: 3 } } as MeExperimentDetail, "util_0_8", 0);
	eq(odd.incomparable, "The experiment says its versions were measured 3 different ways, so it does not rank them");
});

check("metrics to compare: primary first, then shared ones; one-sided ones are left out", () => {
	const sides = [
		{ ...runSide({ loop: "simulate", ts: "1" }, cyc({ goodput_tok_s: 20, ttft_ms_p99: 200, only_a: 1 }), 0) },
		{ ...runSide({ loop: "simulate", ts: "2" }, cyc({ goodput_tok_s: 22, ttft_ms_p99: 180 }), 1) },
	];
	const m = metricsToCompare(sides);
	eq(m.map((x) => [x.name, x.label, x.better]), [["goodput_tok_s", "Goodput", "higher"], ["ttft_ms_p99", "TTFT p99", "lower"]]);
	const c = compareSides(sides, m);
	eq(c.rows[1].best, 1);
});

check("differences only; identical settings fold", () => {
	const d = settingDiffs([
		{ settings: [["Workflow", "Simulate"], ["Version", "A"], ["Mode", "Paper"]] },
		{ settings: [["Workflow", "Simulate"], ["Version", "B"]] },
	]);
	eq(d.differ, [{ key: "Version", values: ["A", "B"] }, { key: "Mode", values: ["Paper", "not reported"] }]);
	eq(d.same, [{ key: "Workflow", value: "Simulate" }]);
	eq(settingDiffs([{ settings: [["Changes: GPU memory", "0.9"]] }, { settings: [] }]).differ[0].values, ["0.9", "unchanged"]);
	eq(sameSettingsWords(4), "4 settings the same");
	eq(sameSettingsWords(1), "1 setting the same");
	eq([settingWords("pg_tape"), settingWords("KXETHD-26SEP2817-T2699.99"), settingWords("baseline"), settingWords("baseline_gpu_memory_utilization-0_85")], ["Pg tape", "KXETHD-26SEP2817-T2699.99", "baseline", "baseline_gpu_memory_utilization-0_85"]);
	eq(sameMetricsWords(12), "12 metrics the same on every side");
});

check("measured differently is said before the numbers", () => {
	const a = runSide({ loop: "backtest", ts: "1" }, cyc({ measured_on: "LQT replay · reused from an identical run" }), 0, "Backtest");
	const b = runSide({ loop: "backtest", ts: "2" }, cyc({ measured_on: "LQT replay" }), 1, "Backtest");
	eq(measuredDifferently([a, b]), null, "a reused result is the same instrument");
	const c = runSide({ loop: "forward_test", ts: "3" }, cyc({ measured_on: "Live paper trading" }), 2, "Forward test");
	eq(measuredDifferently([a, b, c]), "These were measured differently (workflow Backtest vs Forward test; measured on LQT replay vs Live paper trading). Read each number on its own terms, not as a race.");
});

check("numbers in words: mean ± SD, deltas with sign and share, which way is better", () => {
	eq(meanWords("goodput_tok_s", { n: 3, mean: 22.4, sd: 1.2, min: 21, max: 23, latest: 23 }), "22.4 tok/s ± 1.2 tok/s");
	eq(meanWords("goodput_tok_s", { n: 1, mean: 22.4, sd: 0, min: 22.4, max: 22.4, latest: 22.4 }), "22.4 tok/s");
	eq(meanWords("x", null), "");
	const cell = { stats: null, delta: -12, deltaPct: -8, best: false, verdict: null };
	eq(deltaWords("ttft_ms_p99", cell), "−12 ms (−8.0%)");
	eq(deltaIsBetter(cell, "lower"), true);
	eq(deltaWords("x", { ...cell, delta: null }), "");
	eq(mVal("completion_rate", 0.5), "50%");
});

check("chart scale starts at zero unless values cross it", () => {
	eq(chartScale([3, 5]), { lo: 0, hi: 5, fromZero: true });
	eq(chartScale([-3, -1]), { lo: -3, hi: 0, fromZero: true });
	eq(chartScale([-1, 2]), { lo: -1, hi: 2, fromZero: false });
	eq(chartScale([0, 0]), { lo: 0, hi: 1, fromZero: true });
});
check("names: short ones ride in sentences; two alike get their time", () => {
	eq(sideLabel("A", "Util 0 8"), "A (Util 0 8)");
	eq(sideLabel("A", "Stock backtests · Tape covered, 27 Nov 12:44"), "A");
	const a = runSide({ loop: "simulate", ts: "20261125T092430Z" }, cyc({ arm: "util_0_8" }), 0, "Simulate");
	const b = runSide({ loop: "simulate", ts: "20261125T092423Z" }, cyc({ arm: "util_0_8" }), 1, "Simulate");
	const c = runSide({ loop: "simulate", ts: "20261125T092419Z" }, cyc({ arm: "util_0_9" }), 2, "Simulate");
	const n = distinctNames([a, b, c]);
	if (n[0].name === n[1].name || !n[0].name.startsWith("Simulate · Util 0 8, ")) throw new Error(JSON.stringify(n.map((x) => x.name)));
	eq(n[2].name, "Simulate · Util 0 9");
});
check("metrics that differ come before ones that read the same", () => {
	const a = runSide({ loop: "s", ts: "1" }, cyc({ alpha: 1, beta: 2 }), 0);
	const b = runSide({ loop: "s", ts: "2" }, cyc({ alpha: 1, beta: 3 }), 1);
	eq(metricsToCompare([a, b]).map((m) => m.name), ["beta", "alpha"]);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ compare-sides: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
