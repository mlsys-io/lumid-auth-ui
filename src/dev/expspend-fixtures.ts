// Fixtures for the design gallery (2026-11-28): ties in the version chain,
// spend in dollars (an LLM app on a $ budget), and Manage app's workflow list
// for a simple-scheme app. Fixed data, no requests.
import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { buildEvolution } from "@/lib/evolution";
import { pressWords, type MeUsage } from "@/lib/spend";
import type { LoopDef } from "@/components/app-surface/AppManagePanel";

const ts = (m: number) => new Date(Date.UTC(2026, 10, 28, 1, m)).toISOString();
const pts = (vals: Record<string, number[]>) => Object.entries(vals).map(([id, vs], k) => ({ id, points: vs.map((v, i) => ({ ts: ts(k * 3 + i), v })) }));

/** MLSys 9.2: nine designs saturate at the trace's goodput ceiling. */
export const TIE_EQUAL = buildEvolution(pts({
	llm_1_7b_c32: [22.4], llm_1_7b_c8: [22.4], llm_1_7b_c16: [22.4], llm_0_6b_c4: [22.4], llm_0_6b_c8: [22.4],
	llm_0_6b_c16: [22.4], llm_0_6b_c32: [22.4], llm_0_6b_c8_util095: [22.4], llm_1_7b_c4b: [22.4], llm_1_7b_c4: [19.2], llm_4b_c4: [9.6],
}), {})!;

/** The same tie, decided by the step's next declared metric (TTFT p99). */
export const TIE_DECIDED = buildEvolution(pts({ llm_0_6b_c4: [22.4], llm_0_6b_c8: [22.4], llm_0_6b_c16: [22.4], llm_1_7b_c4: [19.2] }), {
	tieBreakers: [{ name: "ttft_ms_p99", label: "TTFT p99", unit: "ms", higherIsBetter: false, values: { llm_0_6b_c4: 1398, llm_0_6b_c8: 1120, llm_0_6b_c16: 1410 } }],
})!;

/** MLSys 9.2 energy: the experiment decided on a 0.8% gap, one GPU measurement each. */
export const TIE_WINNER_NEAR = buildEvolution(pts({ llm_0_6b_c12: [0.3659], llm_0_6b_c16: [0.3688], llm_0_6b_c4: [0.3802], llm_1_7b_c8: [0.5571] }), {
	higherIsBetter: false, decided: true, winner: "llm_0_6b_c12",
})!;

const TIE_LABELS: Record<string, string> = {
	llm_1_7b_c32: "1.7B · concurrency 32", llm_1_7b_c8: "1.7B · concurrency 8", llm_1_7b_c16: "1.7B · concurrency 16", llm_1_7b_c4: "1.7B · concurrency 4",
	llm_1_7b_c4b: "1.7B · c4 chunk 512", llm_0_6b_c4: "0.6B · concurrency 4", llm_0_6b_c8: "0.6B · concurrency 8", llm_0_6b_c12: "0.6B · concurrency 12",
	llm_0_6b_c16: "0.6B · concurrency 16", llm_0_6b_c32: "0.6B · concurrency 32", llm_0_6b_c8_util095: "0.6B · 95% memory", llm_4b_c4: "4B · concurrency 4",
};
export const tieLabel = (v: string) => TIE_LABELS[v] ?? v;

// ── spend in dollars: an MBB-shaped harness, Claude on its paid step ─────

export const USD_STEPS: EvidenceStepSpec[] = [
	{ step: "quick", gate: "paired_ci_high >= 0", metrics: [{ name: "paired_delta", better: "higher" }] },
	{ step: "dev_eval", gate: "paired_delta >= 2 and paired_ci_low > 0", metrics: [{ name: "paired_delta", better: "higher" }] },
];
const q = (v: string, d: number, m: number): MeExperimentRow => ({ ts: ts(m), variant_id: v, metrics: { paired_delta: d, cpu_s: 1.2, cost_usd: 0.000007, duration_s: 800 }, dims: { stage: "quick", metered: "measured", passed: "1" } });
const dev = (v: string, d: number, m: number, usd: number): MeExperimentRow => ({ ts: ts(m), variant_id: v, metrics: { paired_delta: d, cpu_s: 2, cost_usd: usd, duration_s: 1900 }, dims: { stage: "dev_eval", metered: "measured", passed: d >= 2 ? "1" : "0" } });
export const USD_ROWS: MeExperimentRow[] = [
	q("current_cards", 0, 1), q("fix_issue_tree", 0.96, 2), q("fix_top_line", -7.76, 3), q("self_review", 0.58, 4),
	dev("current_cards", 0, 10, 2.81), dev("fix_issue_tree", 2.4, 14, 3.12), dev("self_review", 0.6, 18, 2.95),
];
export const USD_USAGE: MeUsage = {
	app: "mbb-consultant",
	used: { gpu_s: 0, cpu_s: 10, cost_usd: 9.8, runs: 49, by_instrument: { "pooled-llm": { gpu_s: 0, cpu_s: 0, cost_usd: 0.92, runs: 46 } },
		llm: { calls: 60, tokens_in: 2_400_000, tokens_out: 120_000, cost_usd: 8.88, notional_usd: 0.02 } },
	budget: { usd: 40, per: "total", parallel: 2 },
	estimates: { "mlsys-sandbox": { gpu_s: 235, cost_usd: 0.016, from_runs: 14 } },
	rates: { notional: true },
};
const USD_LABELS: Record<string, string> = { current_cards: "Current version", fix_issue_tree: "Issue tree: resolve to the objective", fix_top_line: "Communication: top line first", self_review: "Self-review, one pass" };
export const usdLabel = (v: string) => USD_LABELS[v] ?? v;
/** The press before a paid step, in the words every press uses. */
export const USD_PRESS = pressWords({ runs: 2, estimate: { cpu_s: 2, cost_usd: 3.0, notional_usd: 0 }, usage: USD_USAGE, through: "Quick and Dev eval" }).text;
export const GPU_PRESS = pressWords({ runs: 1, estimate: { gpu_s: 241, cpu_s: 3, cost_usd: 0.017 }, what: "Run Screen once", gpuToday: { used: 14 },
	usage: { used: { gpu_s: 3384, cpu_s: 144, cost_usd: 0.24, runs: 55, by_instrument: { "mlsys-sandbox": { gpu_s: 3384, cost_usd: 0.235, runs: 14 } } }, budget: { gpu_minutes: 168 } } }).text;

// ── Manage app → Workflows, simple scheme (was "loop-0 … loop-5") ────────

export const MANAGE_LOOPS: LoopDef[] = [
	{ id: "simulate", title: "Simulate", run: "manual", steps: { python: "simulate" } },
	{ id: "screen", title: "Screen, then confirm on a GPU", run: "manual", steps: { workflows: ["simulate", "sandbox"] } },
	{ id: "calibrate", title: "Calibrate the simulator", run: "manual" },
	{ id: "sandbox", title: "Sandbox", run: "manual" },
	{ id: "coach", title: "Ask the teacher", run: "manual", model: "sonnet" },
	{ name: "morning_brief", schedule: "0 8 * * 1-5", skills: ["news", "summarise"] },
];
