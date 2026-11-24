// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
// Fixtures are trimmed copies of real lum.id cycles (2026-11-24).
import type { MeCycleDetail } from "@/api/me";
import { humanMetric, fmtMetricValue, primaryMetricKey, runMetrics, stepFailed, stepLabel, stepLine, runAnswer, vsUsual } from "./run-answer";

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
check("vs usual", () => {
	eq(vsUsual(22.4, [20, 20, 20]), { text: "+12% vs usual", better: true });
	eq(vsUsual(700, [800, 800, 800], false), { text: "-12% vs usual", better: true });
	eq(vsUsual(1, [1, 2]), null);
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
