// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
// Fixtures are trimmed copies of real lum.id cycles (2026-11-24).
import type { MeCycleDetail } from "@/api/me";
import { humanMetric, fmtMetricValue, primaryMetricKey, runMetrics, stepFailed, stepLabel, stepLine, runAnswer, vsUsual, runOutputs, runLimits, measuredOn, measuredLine, runFiles } from "./run-answer";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const harvest = {
	ok: false,
	steps: [{ step_id: "engine_command", ok: true, output: { module: "harvest_outbox", out: { ok: false, outcome: "backend_unavailable", error: 'HTTP 500: {"detail":"internal server error","request_id":"91a6"}' } } }],
	summary: {
		duration_s: 61.933, outcome: "backend_unavailable", ok: false,
		error: 'HTTP 500: {"detail":"internal server error","request_id":"91a6"}',
		metrics: { deployed: 0, new_results: 0, new_telemetries: 0, pending: 0, rejected: 0 },
	},
} as unknown as MeCycleDetail;

const simulate = {
	ok: true,
	steps: [{ step_id: "engine_command", ok: true, output: { module: "simulate", out: { ok: true, summary: "meets every performance constraint" } } }],
	summary: {
		duration_s: 4.199, outcome: "ran", ok: true,
		assets_used: { metric: { name: "goodput_tok_s", higher_is_better: true } },
		primary_metric: { name: "objective", value: 22.4 },
		metrics: {
			completion_rate: 1, config_hash: "6c78", decode_tok_s: 41.81, e2e_ms_p99: 5849, goodput_tok_s: 22.4,
			objective: 22.4, objective_metric: "goodput_tok_s", seed: 42, throughput_tok_s: 22.4, ttft_ms_p99: 709.7,
			vram_peak_gib: 12.49, summary: "meets every performance constraint", task: "9.2",
		},
	},
} as unknown as MeCycleDetail;

// A trimmed real simulate run's output shape (mlsys-research, 2026-11-25).
const limited = { ok: true, summary: {}, steps: [{ id: "simulate", output: { ok: true, out: {
	constraints: [
		{ metric: "ttft_ms_p99", op: "<=", value: 2000, observed: 1830.4, met: true },
		{ metric: "completion_rate", op: ">=", value: 0.99, observed: 0.97, met: false },
		{ metric: "tpot_ms_p99", op: "<=", observed: 41 },
	],
	holdouts_text: "1 of 2 met",
	fleet_job: "office:fm:wfl-1b318383-cd9c-4f7d-8d77-b6a3c59a1821",
	measured_on: "Simulator (RTX 5080 profile v1.21)",
} } }] } as unknown as MeCycleDetail;
check("limits: what the run was held to, in words, met or missed", () => {
	const L = runLimits(limited);
	eq(L.map((l) => [l.label, l.rule, l.met]), [["TTFT p99", "≤ 2,000 ms", true], ["Completion rate", "≥ 99%", false], ["TPOT p99", "no limit set", null]]);
	eq(runLimits(null), []);
});
check("a quant backtest: the P&L and the verdict sentence reach the answer, counters come after", () => {
	const poll = {
		ok: true,
		steps: [{ step_id: "engine_command", ok: true, output: { module: "backtest", out: { ok: true } } }],
		summary: {
			ok: true, duration_s: 34.5, primary_metric: { name: "real_tape", value: 1 },
			metrics: {
				all_axes_real: 1, backtests_open: 0, backtests_resolved: 1, experiment_rows: 2, prints_replayed: 1783,
				real_tape: 1, realized_pnl_ticks_per_lot: 3819.565, results_count: 1, results_real_tape: 1, tape_window_secs: 604800,
				replay_note: "replay=pg_tape, signals=recorded, settlement=resolved: recorded prices, recorded signals, realised payoff",
				result_summary: "Real on all three axes: traded 9,200 lots and made 35,140,000 ticks (+3,820 per lot) on KXHIGHDEN-26SEP28-T73.",
			},
		},
	} as unknown as MeCycleDetail;
	const tiles = runMetrics(poll, 6).map((m) => m.key);
	eq(tiles[0], "real_tape", "the declared primary leads");
	eq(tiles.includes("realized_pnl_ticks_per_lot"), true, "the P&L is not crowded out by counters");
	eq(tiles.indexOf("realized_pnl_ticks_per_lot") < tiles.indexOf("backtests_open") || !tiles.includes("backtests_open"), true);
	eq(runAnswer(poll).sentence.startsWith("Real on all three axes"), true, "the verdict sentence is the answer");
	eq(runOutputs(poll).text?.startsWith("replay=pg_tape"), true, "provenance goes to what it produced, not the answer");
});

check("measured line: the instrument in words, or why it was not measured", () => {
	eq(measuredLine({ measured_on: "NVIDIA GeForce RTX 5080 at office", status: "measured" }), { measured: true, text: "Measured on NVIDIA GeForce RTX 5080 at office" });
	eq(measuredLine({ status: "not_measured", measured_on: null, summary: "Not measured on a GPU: every RTX 5080 was busy." }), { measured: false, text: "Not measured on a GPU: every RTX 5080 was busy." });
	eq(measuredLine({ status: "not_measured", summary: "queued" }), { measured: false, text: "Not measured" });
	eq(measuredLine({ objective: 22.4 }), null);
	eq(measuredLine(null), null);
});
check("measured on, and outputs drop embedded ids and _text suffixes", () => {
	eq(measuredOn(limited), "Simulator (RTX 5080 profile v1.21)");
	const f = runOutputs(limited).fields;
	if (f.some((x) => /wfl-|1b318383/.test(x.value))) throw new Error("fleet job id leaked: " + JSON.stringify(f));
	eq(f.find((x) => x.label === "Holdouts")?.value, "1 of 2 met");
});
check("metric names: units and acronyms", () => {
	eq(humanMetric("goodput_tok_s"), { label: "Goodput", unit: "tok/s" });
	eq(humanMetric("ttft_ms_p99"), { label: "TTFT p99", unit: "ms" });
	eq(humanMetric("vram_peak_gib"), { label: "VRAM peak", unit: "GiB" });
	eq(humanMetric("backtests_resolved"), { label: "Backtests resolved", unit: "" });
	eq(humanMetric("realized_pnl_ticks"), { label: "Realized PnL", unit: "ticks" });
	eq(humanMetric("e2e_ms_p50"), { label: "E2E p50", unit: "ms" });
});
check("metric values read naturally", () => {
	eq(fmtMetricValue(22.4, "tok/s"), "22.4 tok/s");
	eq(fmtMetricValue(709.7, "ms"), "709.7 ms");
	eq(fmtMetricValue(1, "", "completion_rate"), "100%");
	eq(fmtMetricValue(0.853, "", "accuracy"), "85.3%");
	eq(fmtMetricValue(5849, "ms"), "5,849 ms");
});
check("primary metric: the declared one, not 'objective'", () => eq(primaryMetricKey(simulate), "goodput_tok_s"));
check("run metrics: primary first, no bookkeeping, no duplicate values", () => {
	const ks = runMetrics(simulate).map((m) => m.key);
	eq(ks[0], "goodput_tok_s");
	for (const bad of ["seed", "config_hash", "objective", "task", "throughput_tok_s"]) if (ks.includes(bad)) throw new Error(`kept ${bad}: ${ks}`);
	if (!ks.includes("ttft_ms_p99")) throw new Error(String(ks));
});
check("a clean exit with out.ok=false is a FAILED step", () => {
	eq(stepFailed(harvest.steps![0]), true);
	eq(stepFailed(simulate.steps![0]), false);
});
check("engine_command gets a human name", () => {
	eq(stepLabel(harvest.steps![0]), "Ran harvest outbox");
	eq(stepLabel({ step_id: "score_docs", ok: true } as never), "Score docs");
	eq(stepLabel({ step_id: "engine_command", ok: true } as never), "Ran the app's command");
});
check("step line: the reason, in words", () => {
	eq(stepLine(harvest.steps![0]), "Server error (HTTP 500)");
	eq(stepLine(simulate.steps![0]), "Meets every performance constraint");
});
check("answer: failed", () => eq(runAnswer(harvest), { tone: "failed", headline: "Failed after 1m 02s", sentence: "Server error (HTTP 500)", raw: 'HTTP 500: {"detail":"internal server error","request_id":"91a6"}' }));
check("answer: succeeded with its finding", () => eq(runAnswer(simulate), { tone: "ok", headline: "Succeeded in 4s", sentence: "Meets every performance constraint" }));
check("answer: a fast failure with no reason says so", () =>
	eq(runAnswer({ ok: false, steps: [], summary: {} } as unknown as MeCycleDetail, { durationS: 0.723 }).sentence, "No reason was recorded"));
check("answer: nothing loaded yet, list row says running", () => eq(runAnswer(null, { running: true }).tone, "running"));
check("answer: list says failed, detail not loaded — no invented reason", () => eq(runAnswer(null, { ok: false, durationS: 62 }), { tone: "failed", headline: "Failed after 1m 02s", sentence: "" }));
check("counts that contain 'rate' are not rates", () => eq(fmtMetricValue(1, "", "proposals_generated"), "1"));
check("equal counts without a unit both stay", () => {
	const d = { ok: true, summary: { metrics: { cases_total: 12, cases_passed: 12 } } } as unknown as MeCycleDetail;
	eq(runMetrics(d).map((m) => m.key), ["cases_total", "cases_passed"]);
});
check("a step-only error is the raw text triage sees", () => {
	const d = { ok: false, steps: [{ step_id: "analyst", ok: false, error: "ModuleNotFoundError: No module named 'skills.analyst'" }], summary: {} } as unknown as MeCycleDetail;
	const a = runAnswer(d);
	eq(a.raw, "ModuleNotFoundError: No module named 'skills.analyst'");
	eq(a.sentence, "App error: No module named 'skills.analyst'");
});
check("summary.step_errors is a reason too", () =>
	eq(runAnswer({ ok: false, steps: [], summary: { step_errors: [{ step: "x", error: "HTTP Error 503: Service Unavailable" }] } } as unknown as MeCycleDetail).sentence, "Service unavailable (HTTP 503)"));
check("outputs: the command's sentence and short results, not noise or shown metrics", () => {
	const d = { ok: true, steps: [{ step_id: "engine_command", ok: true, output: { module: "kol_poll", out: { ok: true,
		result_summary: "Real on all three axes: traded 9,200 lots and made 35,140,000 ticks (+3,820 per lot) on KXHIGHDEN-26SEP28-T73.",
		symbol: "KXHIGHDEN-26SEP28-T73", replay_verdict: "real", settlement: "resolved", presentable_as_performance: true,
		claim_id: "a44e5d46-c85a-40b8-a69f-5dc6358cd70f", backtests_resolved: 3 } } }],
		summary: { metrics: { backtests_resolved: 3 } }, memories_learned: [{ title: "Tape-covered symbols resolve real" }] } as unknown as MeCycleDetail;
	const o = runOutputs(d);
	if (!o.text?.startsWith("Real on all three axes")) throw new Error(String(o.text));
	eq(o.fields.map((f) => f.label), ["Symbol", "Replay verdict", "Settlement", "Presentable as performance"]);
	eq(o.memories, ["Tape-covered symbols resolve real"]);
});
check("vs usual", () => {
	eq(vsUsual(22.4, [20, 20, 20]), { text: "+12% vs usual", better: true });
	eq(vsUsual(700, [800, 800, 800], false), { text: "-12% vs usual", better: true });
	eq(vsUsual(1, [1, 2]), null);
});
check("files: inlined documents and sidecars become files; results.json always", () => {
	const design = '{\n "schema": "mlab.v1",\n "id": "baseline",\n "infra": "rtx5080_x1",\n "rationale": "Explicit Qwen3/BF16 baseline on one card, nothing tuned yet."\n}';
	const d = { ok: true, files: { proposal: { try: "C16" } }, steps: [{ step_id: "engine_command", ok: true, output: { module: "simulate", out: { ok: true,
		metrics: { design_text: design, gpu: "rtx_5080", holdouts_text: "2 of 2 met" } } } }], summary: {} } as unknown as MeCycleDetail;
	const f = runFiles(d);
	eq(f.map((x) => x.name), ["proposal.json", "design.json", "results.json"]);
	eq(f[1].label, "Design");
	if (!f[1].content.includes('"schema": "mlab.v1"')) throw new Error("design not pretty JSON");
	eq(runFiles({ ok: true, steps: [], summary: {} } as unknown as MeCycleDetail), []);
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
