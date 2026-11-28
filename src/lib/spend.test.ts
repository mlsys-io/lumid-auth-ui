// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperimentRow } from "@/api/me";
import { budgetLeftWords, budgetMeter, deviceTime, dollarWords, gpuMeasurementsToday, gpuToday, notionalPart, pressWords, specServices, usageLine, usageNotionalUsd, spendWords, stepSpend, sumUsage, usageOf, usageOfRow, usageWords, weekSpend, weekSpendWords, workflowRunEstimate, type MeUsage } from "./spend";
import { progressPerSpend, progressWords, spendAt } from "./progress-per-spend";
import { agreementBasis, agreementHeadline, agreementLines, agreementRows, biasWords, flipWords, rankWords, spearman, stepAgreements } from "./step-agreement";

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
	eq(budgetMeter(usage168)!.words, "38 of 168 GPU-min used · 130 GPU-min left", "no history, no declared instrument: no estimate");
	const m = budgetMeter(usage168, (n) => (n === "mlsys-sandbox" ? "GPU sandbox" : n), { instruments: ["mlsys-sandbox", "mlsys-simulator"] })!;
	eq(m.words, "38 of 168 GPU-min used · 130 GPU-min left (about 18 more GPU sandbox runs)");
	eq([m.low, m.over], [false, false]);
	const spent = budgetMeter({ ...usage168, used: { ...usage168.used, gpu_s: 170 * 60 } })!;
	ok(spent.over && spent.words.endsWith("none left"), spent.words);
	eq(budgetMeter({ used: usage168.used }), null);
});

check("press words say the cost before it happens, and block when over", () => {
	const p = pressWords({ runs: 3, estimate: usage168.estimates!["mlsys-sandbox"], usage: usage168, through: "GPU sandbox" });
	eq(p, { text: "Run 3 versions through GPU sandbox: about 21 GPU-min · 130 GPU-min left", blocked: false, spends: true });
	const tight = { ...usage168, used: { ...usage168.used, gpu_s: 160 * 60 } };
	eq(pressWords({ runs: 2, estimate: usage168.estimates!["mlsys-sandbox"], usage: tight, through: "GPU sandbox" }).blocked, true);
	eq(pressWords({ runs: 1 }).text, "Run 1 version");
});

check("the summary tile's spend line", () => {
	eq(usageLine(usage168, undefined, { instruments: ["mlsys-sandbox"] }), "Budget: 38 of 168 GPU-min used · 130 GPU-min left (about 18 more runs)");
	eq(usageLine({ used: { gpu_s: 1462, cpu_s: 44, cost_usd: 0.1, runs: 6, by_device: { "RTX 5080": 1462, CPU: 44 } } }), "24 GPU-min on RTX 5080 · 44 CPU-s used · $0.10 notional");
	eq(usageLine({ used: { gpu_s: 0, cpu_s: 0, cost_usd: 0, runs: 0 } }), null);
	eq(usageLine(null), null);
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


// ── round 11: this app's own instruments, notional parts, $ presses ─────

// MBB-shaped: a $40 budget, Claude through pooled-llm (list price), and
// platform estimates that only know MLSys instruments.
const mbb: MeUsage = {
	app: "mbb-consultant",
	used: { gpu_s: 0, cpu_s: 0, cost_usd: 0.92, runs: 46, by_instrument: { "pooled-llm": { gpu_s: 0, cpu_s: 0, cost_usd: 0.92, runs: 46 } } },
	budget: { usd: 40, per: "total" },
	estimates: { "mlsys-sandbox": { gpu_s: 235, cpu_s: 1, cost_usd: 0.016345, from_runs: 14 } },
	rates: { notional: true },
};

check("budget: ≈ N more runs only from THIS app's instruments", () => {
	// pooled-llm history: $0.92 / 46 = $0.02 a run → 1954 more; never MLSys's sandbox.
	eq(budgetMeter(mbb, (n) => (n === "pooled-llm" ? "Claude" : n))!.words, "$0.92 of $40.00 used · $39.08 left (about 1954 more Claude runs)");
	// no own history and the spec doesn't use the estimated instrument: omitted
	const fresh: MeUsage = { ...mbb, used: { gpu_s: 0, cpu_s: 0, cost_usd: 0, runs: 0 } };
	eq(budgetMeter(fresh)!.words, "$0 of $40.00 used · $40.00 left");
	// the spec uses it: the platform estimate may price it
	ok(budgetMeter(fresh, undefined, { instruments: ["mlsys-sandbox"] })!.words.includes("more runs"), "declared instrument estimate");
});

check("budget: 'notional' only on the notional part", () => {
	// pooled-llm and Claude are list price → no "notional"
	ok(!budgetMeter(mbb)!.words.includes("notional"), budgetMeter(mbb)!.words);
	// all device time → notional
	const cpu: MeUsage = { used: { gpu_s: 0, cpu_s: 3600, cost_usd: 0.02, runs: 3, by_instrument: { sim: { cpu_s: 3600, cost_usd: 0.02, runs: 3 } } }, budget: { usd: 5 } };
	eq(budgetMeter(cpu)!.words.split(" · ")[0], "$0.02 of $5.00 notional used");
	// mixed: Claude dollars + a self-hosted model's notional share
	const mixed: MeUsage = { used: { gpu_s: 0, cpu_s: 0, cost_usd: 1.95, runs: 0, llm: { calls: 4, tokens_in: 3_050_000, tokens_out: 1_010_000, cost_usd: 1.95, notional_usd: 1.7 } }, budget: { usd: 40 } };
	eq(usageNotionalUsd(mixed), 1.7);
	eq(budgetMeter(mixed)!.words.split(" · ")[0], "$1.95 of $40.00 used ($1.70 of it notional)");
	// rates.notional false: device time is a real bill too
	eq(usageNotionalUsd({ ...cpu, rates: { notional: false } }), 0);
});

check("dollars say notional only where they are", () => {
	eq(dollarWords(0.03, 0.03), "$0.03 notional");
	eq(dollarWords(1.49, 0), "$1.49");
	eq(dollarWords(1.52, 0.03), "$1.52 ($0.03 of it notional)");
	eq(dollarWords(0, 0), "$0");
	// a row's notional part is its device time at platform rates, capped at its cost
	eq(Math.round(notionalPart({ gpu_s: 3600, gpu_type: "RTX 5080", cost_usd: 1 }) * 100) / 100, 0.25);
	eq(notionalPart({ cost_usd: 0.18 }), 0);
	eq(spendWords(sumUsage([{ usage: { cpu_s: 2, cost_usd: 0.18, metered: "measured" } }])), "2 CPU-s · $0.18");
});

check("press: a paid step leads with dollars, per version", () => {
	const p = pressWords({ runs: 2, estimate: { cpu_s: 1, cost_usd: 3 }, usage: mbb, through: "Quick and Dev eval" });
	eq(p, { text: "Run 2 versions through Quick and Dev eval: about $3.00 a version, $6.00 in all · $39.08 left", blocked: false, spends: true });
	eq(pressWords({ runs: 1, estimate: { cost_usd: 3 }, usage: mbb }).text, "Run 1 version: about $3.00 · $39.08 left");
	// a CPU step's fractions of a cent: device time, not dollars
	eq(pressWords({ runs: 2, estimate: { cpu_s: 1, cost_usd: 0.00001 }, usage: mbb, through: "Quick" }), { text: "Run 2 versions through Quick: about 2 CPU-s · $39.08 left", blocked: false, spends: false });
	// over the $ budget
	eq(pressWords({ runs: 20, estimate: { cost_usd: 3 }, usage: mbb }).blocked, true);
});

check("press: a GPU press says where the day's GPU measurements stand", () => {
	const est = usage168.estimates!["mlsys-sandbox"];
	// identity doesn't expose the cap: the count only
	eq(pressWords({ runs: 2, estimate: est, usage: usage168, gpuToday: { used: 14 } }).text, "Run 2 versions: about 14 GPU-min · 130 GPU-min left · 14 GPU measurements in the last 24 h (a daily cap applies)");
	// when the cap is known
	eq(pressWords({ runs: 2, estimate: est, usage: usage168, gpuToday: { used: 10, limit: 24 } }).text.endsWith("· 14 of today's 24 GPU measurements left"), true);
	ok(pressWords({ runs: 5, estimate: est, usage: usage168, gpuToday: { used: 21, limit: 24 } }).text.includes("only 3 of today's 24"), "partial");
	eq(pressWords({ runs: 1, estimate: est, usage: usage168, gpuToday: { used: 24, limit: 24 } }).blocked, true);
	// a CPU press says nothing about GPU measurements
	ok(!pressWords({ runs: 1, estimate: { cpu_s: 5 }, gpuToday: { used: 3 } }).text.includes("GPU"), "cpu press");
	// the header's own words
	eq(pressWords({ runs: 1, estimate: est, what: "Run Screen once" }).text, "Run Screen once: about 7 GPU-min");
	eq(gpuMeasurementsToday({ used: { gpu_s: 3384, cpu_s: 144, cost_usd: 0.2, runs: 55, by_instrument: { "mlsys-sandbox": { gpu_s: 3384, runs: 14 }, "mlsys-simulator": { cpu_s: 133, gpu_s: 0, runs: 41 } } } }), 14);
	eq(gpuMeasurementsToday(null), null);
});

check("a workflow run's estimate: its history, else its instruments", () => {
	const u: MeUsage = { ...usage168, used: { ...usage168.used, by_workflow: { screen: { gpu_s: 480, cpu_s: 6, cost_usd: 0.04, runs: 2 } }, by_instrument: { "mlsys-simulator": { cpu_s: 30, runs: 10 } } } };
	eq(workflowRunEstimate(u, "screen"), { gpu_s: 240, cpu_s: 3, cost_usd: 0.02 });
	eq(workflowRunEstimate(u, "sandbox", ["mlsys-simulator", "mlsys-sandbox"]), { gpu_s: 420, cpu_s: 3, cost_usd: 0 });
	eq(workflowRunEstimate(u, "coach", []), null);
	eq(specServices({ workflows: [{ id: "screen", feedback: [{ service: "mlsys-simulator" }, { service: "mlsys-sandbox" }] }, { id: "coach", feedback: [{}] }] }), ["mlsys-simulator", "mlsys-sandbox"]);
	eq(specServices({ workflows: [{ id: "screen", feedback: [{ service: "a" }] }, { id: "x", feedback: [{ service: "b" }] }] }, "x"), ["b"]);
	eq(budgetLeftWords(budgetMeter(usage168)), "130 GPU-min left");
	eq(budgetLeftWords(budgetMeter(mbb)), "$39.08 left");
	eq(budgetLeftWords(null), null);
});

check("this week: what the week's step rows used", () => {
	const now = Date.parse("2026-11-28T12:00:00Z") / 1000;
	const iso = (daysAgo: number) => new Date((now - daysAgo * 86400) * 1000).toISOString();
	const rows = [
		row("a", "data_check", { cpu_s: 6 * 3600, cost_usd: 0.03 }, { metered: "measured" }, iso(1)),
		row("b", "bar_backtest", { cpu_s: 3 * 3600, cost_usd: 0.015 }, { metered: "measured" }, iso(3)),
		row("c", "bar_backtest", { cpu_s: 99 * 3600, cost_usd: 9 }, { metered: "measured" }, iso(9)),   // last week
		row("d", "bar_backtest", { sharpe: 1 }, {}, iso(2)),                                            // unmetered
	];
	eq(weekSpendWords(weekSpend(rows, now)), "9 CPU-h · $0.04 notional this week");
	eq(weekSpendWords(weekSpend([row("e", "dev_eval", { cost_usd: 0.92, cpu_s: 1 }, { metered: "measured" }, iso(0.5))], now)), "1 CPU-s · $0.92 this week");
	eq(weekSpendWords(weekSpend([rows[3]], now)), null);
});

check("progress per spend: the axis follows what is metered — $, then GPU, then CPU", () => {
	// Claude dollars on the rows: $ axis, not the harness's CPU-seconds
	const llm = [
		row("cur", "quick", { paired_delta: 0, cpu_s: 1, cost_usd: 0.00001 }, {}, "1"),
		row("fix", "dev_eval", { paired_delta: 1.2, cpu_s: 1, cost_usd: 0.31 }, {}, "2"),
	];
	const qsteps = [{ step: "quick", metrics: [{ name: "paired_delta" }] }, { step: "dev_eval", metrics: [{ name: "paired_delta" }] }];
	const a = progressPerSpend({ steps: qsteps, rows: llm, metric: "paired_delta" })!;
	eq([a.unit, a.usdNotional, a.unitLabel], ["usd", false, "dollars"]);
	eq(spendAt(a, 0.31), "$0.31");
	// only cheap rows so far, but the app's usage shows a bill: still dollars
	const quick = progressPerSpend({ steps: qsteps, rows: [llm[0]], metric: "paired_delta", usage: mbb })!;
	eq(quick.unit, "usd");
	eq(progressPerSpend({ steps: qsteps, rows: [llm[0]], metric: "paired_delta" })!.unit, "cpu");
	// notional GPU dollars don't make a $ axis
	const gpu = progressPerSpend({ steps, rows: [row("c4", "sandbox", { goodput_tok_s: 24, gpu_s: 420, cost_usd: 0.03 }, { gpu_type: "RTX 5080" }, "1")], metric: "goodput_tok_s" })!;
	eq(gpu.unit, "gpu");
	// only cost_usd that is no bill (no device time either): notional $
	eq(spendAt({ unit: "usd", usdNotional: true }, 0.4), "$0.40 notional");
});

check("progress per spend: a GPU row that names no stage counts at the GPU step", () => {
	const esteps = [
		{ step: "simulate", metrics: [{ name: "goodput_tok_s" }, { name: "estimated_energy_j_per_req" }] },
		{ step: "sandbox", metrics: [{ name: "goodput_tok_s" }, { name: "estimated_energy_j_per_req" }, { name: "energy_j_per_req" }] },
	];
	const rows = [
		row("llm_0_6b", "simulate", { estimated_energy_j_per_req: 86.49, cpu_s: 2 }, {}, "1"),
		{ ts: "2", variant_id: "llm_0_6b", metrics: { estimated_energy_j_per_req: 75.31, energy_j_per_req: 75.31, goodput_tok_s: 20 }, dims: { measured_on: "NVIDIA GeForce RTX 5080 at office" } } as MeExperimentRow,
	];
	const p = progressPerSpend({ steps: esteps, rows, metric: "estimated_energy_j_per_req", higherIsBetter: false })!;
	eq([p.countingStep, p.best?.value], ["sandbox", 75.31]);
});

check("step agreement: either the readings or the ask, and the basis said", () => {
	const two = stepAgreements({ steps, rows: mlsysRows.filter((r) => r.variant_id === "c4" || r.variant_id === "c8") })[0];
	eq(agreementBasis(two), "from 2 versions measured at both steps");
	const { lines, asking } = agreementLines(two);
	eq(asking, true);
	ok(!lines.some((l) => /reads|ranks/.test(l)), `no ratio beside the ask: ${lines.join(" | ")}`);
	const all = stepAgreements({ steps, rows: mlsysRows })[0];
	eq(agreementBasis(all), "from 4 versions measured at both steps");
	const full = agreementLines(all);
	eq(full.asking, false);
	ok(full.lines.some((l) => l.includes("1.7× high")), full.lines.join(" | "));
	// a GPU row with no stage is placed at the step whose metrics it reports
	const unstaged = [
		row("a", "simulator", { goodput_tok_s: 10 }), row("b", "simulator", { goodput_tok_s: 12 }), row("c", "simulator", { goodput_tok_s: 14 }),
		...["a", "b", "c"].map((v, i) => ({ ts: "2", variant_id: v, metrics: { goodput_tok_s: 11 + i * 2, ttft_ms_p99: 900 }, dims: { measured_on: "RTX 5080" } }) as MeExperimentRow),
	];
	eq(stepAgreements({ steps, rows: unstaged })[0].metrics.find((m) => m.metric === "goodput_tok_s")!.n, 3);
});

check("the day's GPU measurements: identity's limits when sent, else the 24 h count", () => {
	const base = { used: { gpu_s: 3384, cpu_s: 0, cost_usd: 0.2, runs: 14, by_instrument: { "mlsys-sandbox": { gpu_s: 3384, runs: 14 } } } };
	// identity sends the cap it enforces: exact, and it blocks at 0
	eq(gpuToday({ ...base, limits: { gpu_measurements_per_day: 24, gpu_measurements_today: 10 } }), { used: 10, limit: 24 });
	const est = usage168.estimates!["mlsys-sandbox"];
	const sent = gpuToday({ ...base, limits: { gpu_measurements_per_day: 24, gpu_measurements_today: 10 } });
	eq(pressWords({ runs: 2, estimate: est, usage: usage168, gpuToday: sent }).text, "Run 2 versions: about 14 GPU-min · 130 GPU-min left · 14 of today's 24 GPU measurements left");
	const used = gpuToday({ ...base, limits: { gpu_measurements_per_day: 24, gpu_measurements_today: 24 } });
	eq(pressWords({ runs: 1, estimate: est, usage: usage168, gpuToday: used }).blocked, true);
	// older identity: no limits → the 24 h count, said as a count, never blocking
	eq(gpuToday(base), { used: 14 });
	const old = pressWords({ runs: 1, estimate: est, usage: usage168, gpuToday: gpuToday(base) });
	eq([old.blocked, old.text.endsWith("· 14 GPU measurements in the last 24 h (a daily cap applies)")], [false, true]);
	// a half-sent block (no cap) falls back too
	eq(gpuToday({ ...base, limits: { gpu_measurements_today: 3 } }), { used: 14 });
	eq(gpuToday(null), null);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ spend: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
