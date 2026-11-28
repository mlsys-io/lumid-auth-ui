// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { humanValue, runTables, tableTitle, visibleRows } from "./run-tables";
import { runOutputs } from "./run-answer";
import { RUN_GPU_ENERGY, RUN_CALIBRATE_TOO_FEW, RUN_NOT_MEASURED } from "@/dev/run-page-fixtures";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("ids in the key/value column read as words, decimals kept", () => {
	eq(humanValue("llm_1_7b_c32"), "LLM 1.7B c32");
	eq(humanValue("baseline_model-llm-0_6b_max_concurrency-12"), "Baseline model LLM 0.6B max concurrency 12");
	eq(humanValue("nvml_counter"), "Nvml counter");
	// Already words, or a version string: left alone.
	eq(humanValue("RTX 5080"), "RTX 5080");
	eq(humanValue("protocol-v1.21"), "protocol-v1.21");
	eq(humanValue("office"), "office");
	eq(humanValue("run_2026_11_28").includes("2026.11"), false);
});
check("the run's own outputs keep raw ids for the page to word", () => {
	const f = runOutputs(RUN_GPU_ENERGY).fields;
	eq(f.find((x) => x.label === "Design ID")?.value, "baseline_model-llm-0_6b_max_concurrency-12");
});
check("per-item rows become tables with humanised headers", () => {
	const t = runTables(RUN_GPU_ENERGY);
	eq(t.map((x) => x.key), ["workload_rows"]); // resample_rows is empty: no table
	const w = t[0];
	eq(w.title, "Workloads");
	// Empty, hash and repeated columns dropped; nested objects left out.
	eq(w.columns.map((c) => c.label), ["Workload", "Kind", "Outcome", "Predicted", "Same trace", "Measured goodput (tok/s)", "Simulated goodput (tok/s)", "Measured TTFT p99 (ms)", "Simulated TTFT p99 (ms)", "TTFT gap"]);
	eq(w.rows[0], ["development", "development", "met", "met", "yes", "22.4", "22.4", "364.5", "560.1", "-35%"]);
});
check("a calibrate run's arrays are tables, not a wall of text", () => {
	const t = runTables(RUN_CALIBRATE_TOO_FEW);
	eq(t.map((x) => [x.key, x.title, x.rows.length]), [["energy_models", "Energy models", 3], ["factors", "Factors", 10]]);
	// The model names each row, so it leads; an all-dash column is dropped.
	eq(t[0].columns.map((c) => c.label), ["Model", "Power", "Runs", "Task", "Used"]);
	eq(t[0].rows[2], ["llm-4b", "—", "0", "9.1", "no: no GPU run with an energy reading"]);
	eq(t[1].columns[0].label, "Key");
	eq(t[1].rows[1][0], "Decode");
	// With many rows, a column repeating another in every row is dropped
	// (designs == points here).
	eq(t[1].columns.some((c) => c.key === "points"), false);
	eq(runTables(RUN_NOT_MEASURED).length, 0);
	eq(runTables(null), []);
});
check("show all N instead of a silent cut", () => {
	const xs = Array.from({ length: 12 }, (_, i) => i);
	eq(visibleRows(xs, false), { rows: xs.slice(0, 8), hidden: 4 });
	eq(visibleRows(xs, true).hidden, 0);
	// One past the cap shows everything rather than "Show all 9" for one row.
	eq(visibleRows(xs.slice(0, 9), false).hidden, 0);
});
check("two lists about the same items are one table", () => {
	const d = { ok: true, summary: { metrics: {
		workload_rows: [{ kind: "development", outcome: "missed", workload: "development" }],
		workloads: [{ meets_constraints: false, objective: 21.33, status: "succeeded", workload: "development" }],
	} }, steps: [] } as never;
	const t = runTables(d);
	eq(t.length, 1);
	eq(t[0].columns.map((c) => c.label), ["Workload", "Kind", "Outcome", "Meets constraints", "Objective", "Status"]);
	eq(t[0].rows[0], ["development", "development", "missed", "no", "21.33", "succeeded"]);
});
check("table titles", () => {
	eq(tableTitle("resample_rows"), "Resamples");
	eq(tableTitle("factors"), "Factors");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ run-tables: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
