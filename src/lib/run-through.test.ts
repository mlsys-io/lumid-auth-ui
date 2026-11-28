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

check("through: the default never runs a paid step unasked", () => {
	const S3 = [{ step: "quick", metrics: [] }, { step: "dev_eval", metrics: [] }, { step: "holdout_eval", metrics: [] }];
	const paidMid = [
		row("quick", { cpu_s: 5, cost_usd: 0.0001 }, { metered: "measured" }),
		row("dev_eval", { cost_usd: 0.18 }, { metered: "measured" }),
		row("dev_eval", { cost_usd: 0.22 }, { metered: "measured" }),
	];
	eq(throughChoices(S3, paidMid).preferred, 0);                 // Quick only — holds the paid Dev eval
	eq(throughChoices(S3).preferred, 1);                          // no history: as before, holds the last
	// CPU-metered fractions of a cent are not "paid": quant keeps its default
	const cheap = [row("data_check", { cpu_s: 100, cost_usd: 0.0009 }, { metered: "measured" }),
		row("robustness", { cpu_s: 60, cost_usd: 0.0003 }, { metered: "measured" })];
	eq(throughChoices(STEPS, cheap).preferred, 1);
	// the FIRST step paid: the least the press can run is that step
	eq(throughChoices(S3, [row("quick", { cost_usd: 0.5 }, { metered: "measured" })]).preferred, 0);
	// a paid LAST step is already held by default
	eq(throughChoices(STEPS, [row("robustness", { gpu_s: 120, cost_usd: 0.5 }, { metered: "measured" })]).preferred, 1);
});

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

check("through: dollars are the step's MEDIAN cost; an unmetered step is priced from its instrument", () => {
	const S = [{ step: "quick", metrics: [] }, { step: "dev_eval", metrics: [], service: "pooled-llm" }];
	const rows = [
		row("quick", { cpu_s: 2, cost_usd: 0.00001 }, { metered: "measured" }),
		row("dev_eval", { cost_usd: 2.5 }, { metered: "measured" }),
		row("dev_eval", { cost_usd: 3 }, { metered: "measured" }),
		row("dev_eval", { cost_usd: 30 }, { metered: "measured" }),   // one long answer doesn't price every version
	];
	const e = estimateThrough(rows, S, null)!;
	eq([e.cpu_s, Math.round(e.cost_usd * 100) / 100, e.notional_usd < 0.001], [2, 3, true]);
	// no dev_eval rows yet: this app's pooled-llm history prices it
	const usage = { used: { gpu_s: 0, cpu_s: 0, cost_usd: 0.92, runs: 46, by_instrument: { "pooled-llm": { cost_usd: 0.92, runs: 46 } } } };
	eq(Math.round(estimateThrough(rows.slice(0, 1), S, null, { usage })!.cost_usd * 100) / 100, 0.02);
	// …else the platform estimate's cost_usd
	const est = { used: { gpu_s: 0, cpu_s: 0, cost_usd: 0, runs: 0 }, estimates: { "pooled-llm": { cost_usd: 0.4, from_runs: 9 } } };
	eq(Math.round(estimateThrough(rows.slice(0, 1), S, null, { usage: est })!.cost_usd * 100) / 100, 0.4);
	eq(estimateThrough([], S, null, { usage: est })!.cost_usd, 0.4);
	eq(estimateThrough([], S, null), null);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ run-through: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
