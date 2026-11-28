// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperimentRow } from "@/api/me";
import { budgetMeter, deviceTime, pressWords, spendWords, stepSpend, sumUsage, usageOf, usageOfRow, usageWords, type MeUsage } from "./spend";
import { progressPerSpend, progressWords } from "./progress-per-spend";
import { agreementHeadline, agreementRows, biasWords, flipWords, rankWords, spearman, stepAgreements } from "./step-agreement";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }

const row = (v: string, stage: string, metrics: Record<string, number>, dims: Record<string, string> = {}, ts = "1"): MeExperimentRow =>
	({ ts, variant_id: v, metrics, dims: { stage, ...dims } }) as MeExperimentRow;

// ── spend ────────────────────────────────────────────────────────────────

check("unmetered is null, never zero", () => {
	eq(usageOf({ goodput_tok_s: 22 }), null);
	eq(usageOfRow({ metrics: { duration_s: 4 }, dims: {} } as unknown as MeExperimentRow), null);
	eq(usageOf({ usage: { gpu_s: 412, gpu_type: "RTX 5080", metered: "measured" } }), { gpu_s: 412, gpu_type: "RTX 5080", metered: "measured" });
	eq(usageOf({ result: 1, metered: "reused", saved_gpu_s: 400 }), { saved_gpu_s: 400, metered: "reused" });
});

check("device time reads in minutes", () => {
	eq(deviceTime(0), "0 min"); eq(deviceTime(12), "12 s"); eq(deviceTime(270), "4.5 min"); eq(deviceTime(2280), "38 min"); eq(deviceTime(9000), "2.5 h");
});

check("a step's spend: GPU first, dollars notional, reuse saved, unmetered said", () => {
	const rows = [
		row("a", "sandbox", { gpu_s: 412, cpu_s: 8, cost_usd: 0.03 }, { gpu_type: "RTX 5080", metered: "measured" }),
		row("b", "sandbox", { gpu_s: 0, saved_gpu_s: 400, cost_usd: 0 }, { metered: "reused", gpu_type: "RTX 5080" }),
		row("c", "sandbox", { duration_s: 30 }),
		row("a", "simulator", { cpu_s: 3 }, { metered: "measured" }),
	];
	const s = stepSpend(rows, "sandbox");
	eq([s.runs, s.metered, s.reused, s.gpu_s], [3, 2, 1, 412]);
	eq(spendWords(s), "6.9 GPU-min on RTX 5080 · 8 CPU-s · $0.03 notional · reuse saved 6.7 GPU-min · 1 run not metered");
	eq(spendWords(stepSpend([row("c", "x", { duration_s: 90 })])), "Not metered · 1.5 min of run time");
	eq(spendWords(sumUsage([])), "Nothing has run yet");
});

check("one run in words", () => {
	eq(usageWords(null), "Not metered");
	eq(usageWords({ metered: "reused", saved_gpu_s: 414 }), "Free — reused (saved 6.9 GPU-min)");
	eq(usageWords({ gpu_s: 414, gpu_type: "RTX 5080", cost_usd: 0.03, metered: "estimated" }), "About 6.9 GPU-min on RTX 5080 · $0.03 notional (estimated)");
});

const usage168: MeUsage = {
	used: { gpu_s: 38 * 60, cpu_s: 100, cost_usd: 0.2, runs: 6 },
	budget: { gpu_minutes: 168, per: "total", parallel: 2 },
	estimates: { "mlsys-sandbox": { gpu_s: 7 * 60, from_runs: 5 }, "mlsys-simulator": { cpu_s: 5, from_runs: 20 } },
};

check("budget meter: used, left, and how many more runs", () => {
	const m = budgetMeter(usage168, (n) => (n === "mlsys-sandbox" ? "GPU sandbox" : n))!;
	eq(m.words, "38 of 168 GPU-min used · 130 GPU-min left (about 18 more GPU sandbox runs)");
	eq([m.low, m.over], [false, false]);
	const spent = budgetMeter({ ...usage168, used: { ...usage168.used, gpu_s: 170 * 60 } })!;
	ok(spent.over && spent.words.endsWith("none left"), spent.words);
	eq(budgetMeter({ used: usage168.used }), null);
});

check("press words say the cost before it happens, and block when over", () => {
	const p = pressWords({ runs: 3, estimate: usage168.estimates!["mlsys-sandbox"], usage: usage168, through: "GPU sandbox" });
	eq(p, { text: "Run 3 versions through GPU sandbox: about 21 GPU-min, 130 GPU-min left", blocked: false });
	const tight = { ...usage168, used: { ...usage168.used, gpu_s: 160 * 60 } };
	eq(pressWords({ runs: 2, estimate: usage168.estimates!["mlsys-sandbox"], usage: tight, through: "GPU sandbox" }).blocked, true);
	eq(pressWords({ runs: 1 }).text, "Run 1 version");
});

// ── step agreement ───────────────────────────────────────────────────────

const steps = [
	{ step: "simulator", metrics: [{ name: "goodput_tok_s" }, { name: "ttft_ms_p99", better: "lower" as const }, { name: "meets_constraints" }] },
	{ step: "sandbox", metrics: [{ name: "goodput_tok_s" }, { name: "ttft_ms_p99", better: "lower" as const }, { name: "meets_constraints" }] },
];
// The simulator reads TTFT ~1.7× high and keeps the goodput order except one swap; one verdict flips.
const mlsysRows = [
	row("c4", "simulator", { goodput_tok_s: 22.4, ttft_ms_p99: 1398, meets_constraints: 1 }),
	row("c8", "simulator", { goodput_tok_s: 20.1, ttft_ms_p99: 1900, meets_constraints: 1 }),
	row("c16", "simulator", { goodput_tok_s: 18.0, ttft_ms_p99: 2400, meets_constraints: 0 }),
	row("llm4b", "simulator", { goodput_tok_s: 12.0, ttft_ms_p99: 3800, meets_constraints: 0 }),
	row("c4", "sandbox", { goodput_tok_s: 24.0, ttft_ms_p99: 820, meets_constraints: 1 }),
	row("c8", "sandbox", { goodput_tok_s: 21.0, ttft_ms_p99: 1120, meets_constraints: 1 }),
	row("c16", "sandbox", { goodput_tok_s: 22.0, ttft_ms_p99: 1410, meets_constraints: 1 }),
	row("llm4b", "sandbox", { goodput_tok_s: 13.0, ttft_ms_p99: 2240, meets_constraints: 0 }),
];

check("spearman: ties averaged, undefined below 3", () => {
	eq(spearman([1, 2, 3], [10, 20, 30]), 1);
	eq(spearman([1, 2, 3], [3, 2, 1]), -1);
	eq(spearman([1, 2], [1, 2]), null);
	eq(spearman([1, 1, 1], [1, 2, 3]), null);
});

check("MLSys-shaped: simulator vs GPU sandbox", () => {
	const [a] = stepAgreements({ steps, rows: mlsysRows });
	eq([a.cheap.label, a.expensive.label], ["Simulator", "Sandbox"]);
	const good = a.metrics.find((m) => m.metric === "goodput_tok_s")!;
	eq(good.n, 4); eq(good.topAgrees, true);
	eq(Math.round(good.rho! * 100) / 100, 0.8);
	const ttft = a.metrics.find((m) => m.metric === "ttft_ms_p99")!;
	eq(biasWords(ttft, "Simulator"), "Simulator reads TTFT p99 1.7× high");
	eq(rankWords(ttft, "Sandbox"), "Ranks 4 versions the same way as Sandbox (ρ 1); same top pick");
	const meets = a.metrics.find((m) => m.metric === "meets_constraints")!;
	eq(flipWords(meets, "Simulator", "Sandbox"), "Meets constraints: 1 said no at Simulator but yes at Sandbox (C16)");
	eq(agreementHeadline(a).tone, "attention");
	eq(agreementRows(ttft)[0], { version: "C4", cheap: "1,398 ms", expensive: "820 ms", gap: "−41%" });
});

check("quant-shaped: backtest vs robustness, declared same_as pairing", () => {
	const qsteps = [{ step: "bar_backtest", metrics: [{ name: "sharpe_is" }] }, { step: "robustness", metrics: [{ name: "oos_sharpe" }] }];
	const rows = [
		row("m1", "bar_backtest", { sharpe_is: 1.8 }), row("m2", "bar_backtest", { sharpe_is: 1.2 }), row("m3", "bar_backtest", { sharpe_is: 0.9 }),
		row("m1", "robustness", { oos_sharpe: 0.2 }), row("m2", "robustness", { oos_sharpe: 0.7 }), row("m3", "robustness", { oos_sharpe: 0.5 }),
	];
	eq(stepAgreements({ steps: qsteps, rows }).length, 0, "no shared name, no pairing");
	const [a] = stepAgreements({ steps: qsteps, rows, sameAs: { "robustness.oos_sharpe": "bar_backtest.sharpe_is" } });
	const m = a.metrics[0];
	eq(m.topAgrees, false);
	ok(agreementHeadline(a).text.includes("does not predict"), agreementHeadline(a).text);
});

check("too few versions says how many more", () => {
	const [a] = stepAgreements({ steps, rows: mlsysRows.filter((r) => r.variant_id === "c4" || r.variant_id === "c8") });
	eq(agreementHeadline(a).text, "Measure 1 more version at both steps to see whether Simulator predicts Sandbox");
	const one = stepAgreements({ steps, rows: mlsysRows.filter((r) => r.variant_id === "c4") })[0];
	eq(agreementHeadline({ ...one, metrics: one.metrics.filter((m) => !m.binary) }).text, "Measure 2 more versions at both steps to see whether Simulator predicts Sandbox");
});

// ── progress per spend ───────────────────────────────────────────────────

check("best result vs GPU-minutes; cheap rows add spend but don't move the best", () => {
	const rows = [
		row("c32", "simulator", { goodput_tok_s: 15, cpu_s: 5 }, {}, "1"),
		row("c32", "sandbox", { goodput_tok_s: 16, gpu_s: 420 }, { gpu_type: "RTX 5080" }, "2"),
		row("c4", "simulator", { goodput_tok_s: 22, cpu_s: 5 }, {}, "3"),
		row("c4", "sandbox", { goodput_tok_s: 24, gpu_s: 420 }, {}, "4"),
		row("c8", "sandbox", { goodput_tok_s: 21, gpu_s: 420 }, {}, "5"),
		row("c8b", "sandbox", { goodput_tok_s: 99, gpu_s: 0, saved_gpu_s: 420 }, { metered: "reused", passed: "0" }, "6"),
	];
	const p = progressPerSpend({ steps, rows, metric: "goodput_tok_s" })!;
	eq([p.unit, p.countingStep, p.total], ["gpu", "sandbox", 21]);
	eq(p.points.map((q) => q.best), [null, 16, 16, 24, 24, 24]);
	eq(p.best, { value: 24, version: "c4", at: 14 });
	eq(progressWords(p), "Best Goodput: 24 tok/s (C4), reached after 14 GPU-min. The 7 GPU-min since then bought no improvement");
});

check("no GPU: falls back to CPU, then run time", () => {
	const p = progressPerSpend({ steps: [], rows: [row("a", "", { score: 1, duration_s: 120 }, {}, "1")].map((r) => ({ ...r, dims: {} })), metric: "score" })!;
	eq([p.unit, p.unitLabel], ["time", "run minutes"]);
	eq(progressWords(p), "Best Score: 1 (A), reached after 2 min of run time — the latest spending is still paying off");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ spend: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
