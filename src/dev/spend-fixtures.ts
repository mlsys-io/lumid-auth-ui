// Fixture results for the design gallery's "What it cost" section: an
// MLSys-shaped experiment (simulator → GPU sandbox, usage on every row) and a
// budget. Fixed data, no requests.
import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import type { MeUsage } from "@/lib/spend";

let t = 0;
const at = () => new Date(Date.UTC(2026, 10, 28, 1, t++ * 7)).toISOString();
const sim = (v: string, good: number, ttft: number, meets: 0 | 1, reused = false): MeExperimentRow => ({
	ts: at(), variant_id: v,
	metrics: { goodput_tok_s: good, ttft_ms_p99: ttft, meets_constraints: meets, calibrated_meets_constraints: meets, cpu_s: reused ? 0 : 6, ...(reused ? { saved_cpu_s: 6 } : {}), cost_usd: reused ? 0 : 0.00003, duration_s: 9 },
	dims: { stage: "simulate", passed: String(meets), metered: reused ? "reused" : "measured" },
});
const gpu = (v: string, good: number, ttft: number, meets: 0 | 1, gpuS: number): MeExperimentRow => ({
	ts: at(), variant_id: v,
	metrics: { goodput_tok_s: good, ttft_ms_p99: ttft, meets_constraints: meets, gpu_s: gpuS, cpu_s: 14, cost_usd: (gpuS / 3600) * 0.25, duration_s: gpuS + 30 },
	dims: { stage: "sandbox", passed: "1", gpu_type: "RTX 5080", metered: "measured" },
});

export const SPEND_STEPS: EvidenceStepSpec[] = [
	{ step: "simulate", gate: "calibrated_meets_constraints >= 1", metrics: [{ name: "goodput_tok_s", better: "higher" }, { name: "ttft_ms_p99", better: "lower" }, { name: "meets_constraints" }] },
	{ step: "sandbox", metrics: [{ name: "goodput_tok_s", better: "higher" }, { name: "ttft_ms_p99", better: "lower" }, { name: "meets_constraints" }] },
];

export const SPEND_ROWS: MeExperimentRow[] = [
	sim("llm_1_7b_c32", 15.1, 2310, 0), gpu("llm_1_7b_c32", 16.2, 1380, 1, 412),
	sim("llm_0_6b_c4", 22.4, 1398, 1), gpu("llm_0_6b_c4", 24.0, 820, 1, 168),
	sim("llm_0_6b_c8", 20.1, 1900, 1, true), gpu("llm_0_6b_c8", 21.0, 1120, 1, 151),
	sim("llm_0_6b_c16", 18.0, 2400, 0), sim("llm_4b_c4", 12.0, 3800, 0),
	sim("llm_0_6b_c4_chunk512", 22.9, 1290, 1), gpu("llm_0_6b_c4_chunk512", 25.3, 760, 1, 158),
	sim("llm_0_6b_c6", 21.6, 1610, 1), gpu("llm_0_6b_c6", 24.8, 900, 1, 149),
];

export const SPEND_USAGE: MeUsage = {
	app: "mlsys-research",
	used: { gpu_s: 412 + 168 + 151 + 158 + 149, cpu_s: 120, cost_usd: 0.08, runs: 11, running: 0, unmetered_runs: 0, by_device: { "RTX 5080": 1038, CPU: 120 } },
	saved: { gpu_s: 0, cpu_s: 6, reused_runs: 1 },
	budget: { gpu_minutes: 168, per: "total", parallel: 2 },
	remaining: { gpu_s: 168 * 60 - 1038 },
	estimates: { "mlsys-sandbox": { gpu_s: 158, gpu_type: "RTX 5080", from_runs: 5 }, "mlsys-simulator": { cpu_s: 6, from_runs: 9 } },
};

const LABELS: Record<string, string> = {
	llm_1_7b_c32: "Baseline (1.7B, c32)", llm_0_6b_c4: "0.6B c4", llm_0_6b_c8: "0.6B c8", llm_0_6b_c16: "0.6B c16",
	llm_4b_c4: "4B c4", llm_0_6b_c4_chunk512: "0.6B c4 chunk 512", llm_0_6b_c6: "0.6B c6",
};
export const spendLabel = (v: string) => LABELS[v] ?? v;
