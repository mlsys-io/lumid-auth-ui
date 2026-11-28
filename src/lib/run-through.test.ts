// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { estimateThrough, throughChoices } from "./run-through";
import type { MeExperimentRow } from "@/api/me";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const STEPS = [{ step: "data_check", metrics: [] }, { step: "bar_backtest", metrics: [] }, { step: "robustness", metrics: [] }];

check("through: every step but the last, or all the way; holds the last by default", () => {
	const { choices, preferred } = throughChoices(STEPS);
	eq(choices.map((c) => c.until), ["data_check", "bar_backtest", null]);
	eq(choices[1].through, "Data check and Bar backtest");
	eq(choices[1].holds, "holds Robustness");
	eq(choices[0].holds, "holds Bar backtest and Robustness");
	eq(choices[2].holds, "");
	eq(preferred, 1);
	eq(throughChoices([{ step: "simulate", metrics: [] }]).choices, []);
	eq(throughChoices([{ step: "simulate", metrics: [] }, { step: "sandbox", metrics: [] }]).preferred, 0);
});

const row = (stage: string, m: Record<string, number>, dims: Record<string, string> = {}) =>
	({ ts: "", variant_id: "v", metrics: m, dims: { stage, ...dims } }) as unknown as MeExperimentRow;

check("through: priced from the experiment's own metered steps, per run", () => {
	const rows = [
		row("data_check", { cpu_s: 10, cost_usd: 0.001 }, { metered: "measured" }),
		row("data_check", { cpu_s: 30, cost_usd: 0.003 }, { metered: "measured" }),
		row("robustness", { gpu_s: 120, cost_usd: 0.5 }, { metered: "measured" }),
		row("bar_backtest", { sharpe_is: 0.7 }),
	];
	const one = estimateThrough(rows, STEPS, "data_check");
	eq([one?.cpu_s, one?.gpu_s], [20, 0]);
	const all = estimateThrough(rows, STEPS, null);
	eq([all?.cpu_s, all?.gpu_s], [20, 120]);
	eq(estimateThrough([row("bar_backtest", { sharpe_is: 1 })], STEPS, null), null);
	eq(estimateThrough(rows, STEPS, "nope"), null);
	eq(estimateThrough([], STEPS, null), null);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ run-through: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
