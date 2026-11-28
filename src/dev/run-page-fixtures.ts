// Run-page fixtures: trimmed copies of real MLSys Research runs on lum.id
// (2026-11-28, the student's install). Used by the run-page tests and the
// design gallery's "Run page" section. Fixed data, no requests.
import type { MeCycleDetail, MeCycleListItem } from "@/api/me";
import type { RunContext } from "@/hooks/useRunContext";

const step = (module: string, endedAt: number, metrics: Record<string, unknown>) =>
	({ step_id: "engine_command", ok: true, output_summary: "ok", output: { module, ended_at: endedAt, ok: true, out: { ok: true, metrics } } });

const variant = (study: string, arm: string) => ({
	lineage: { branch_label: arm, variant: { arm, study, base: "baseline", task: "9.2" } },
	branch_label: arm, experiment: arm,
});

// sandbox 20261128T112403Z — refused by the daily GPU cap (retry_after added:
// the app will emit it; the live run predates it).
const notMeasuredMetrics = {
	status: "not_measured", verdict: "not measured", objective_metric: "goodput_tok_s", study: "serve_9_2_energy",
	summary: "Not measured on a GPU: your daily budget of 12 GPU measurements is used; it resets over the next 24 hours.",
	retry_after: 5 * 3600,
	comparison: [
		{ metric: "Time to the first word, typical request", simulated: "15.48 ms", measured: "not measured", gap: "—" },
		{ metric: "Time to the first word, slowest 1% of requests", simulated: "560.1 ms", measured: "not measured", gap: "—" },
	],
	resamples_asked: 0, resamples_met: 0, resamples_run: 0, seed: 42, task: "9.2",
	energy_text: "Not measured yet.", gpu_requested: "RTX 5080", design_id: "baseline_model-llm-0_6b_max_concurrency-12",
	goodput_tok_s: null, estimated_energy_j_per_tok: null,
};
export const RUN_NOT_MEASURED = {
	app: "mlsys-research", loop: "sandbox", ts: "20261128T112403Z", ok: true,
	summary: { duration_s: 3.8, outcome: "ran", ...variant("serve_9_2_energy", "r4_e_06b_c12"), usage: { cpu_s: 0.8, metered: "measured" }, metrics: notMeasuredMetrics },
	steps: [step("sandbox", 1795865046.765, notMeasuredMetrics)],
} as unknown as MeCycleDetail;

// sandbox 20261128T113513Z — measured on the GPU, energy experiment.
const energyMetrics = {
	status: "measured", study: "serve_9_2_energy", arm: "e_06b_c12", objective_metric: "goodput_tok_s",
	measured_on: "NVIDIA GeForce RTX 5080 at office",
	summary: "Measured on NVIDIA GeForce RTX 5080 at office: meets every performance constraint",
	goodput_tok_s: 22.4, throughput_tok_s: 22.4, ttft_ms_p99: 364.5, completion_rate: 1, makespan_s: 2.66,
	energy_j_per_tok: 0.3659, estimated_energy_j_per_tok: 0.3659, energy_j_per_req: 40.98, estimated_energy_j_per_req: 40.98,
	power_w_avg: 184.7, power_w_idle: 40.68, meets_constraints: true, same_gpu_as_simulated: true, meets_all_workloads: 1,
	constraints: [{ metric: "ttft_ms.p99", op: "<", value: 2000, observed: 364.47, met: true }, { metric: "completion_rate", op: ">=", value: 0.99, observed: 1, met: true }],
	comparison: [
		{ metric: "Time to the first word, typical request", simulated: "15.48 ms", measured: "50.79 ms", gap: "+228%" },
		{ metric: "Time to the first word, slowest 1% of requests", simulated: "560.1 ms", measured: "364.5 ms", gap: "-35%" },
		{ metric: "Time between words, slowest 1%", simulated: "17.58 ms", measured: "10.64 ms", gap: "-39%" },
		{ metric: "Useful words per second", simulated: "22.4 tokens/s", measured: "22.4 tokens/s", gap: "+0%" },
		{ metric: "Total words produced per second", simulated: "22.4 tokens/s", measured: "22.4 tokens/s", gap: "+0%" },
		{ metric: "Share of requests that finished", simulated: "1 fraction", measured: "1 fraction", gap: "+0%" },
		{ metric: "Time to finish the whole workload", simulated: "3.598 s", measured: "2.66 s", gap: "-26%" },
		{ metric: "Memory used on the GPU", simulated: "12.49 GiB", measured: "12.17 GiB", gap: "-3%" },
		{ metric: "How fast words are generated", simulated: "116.3 tokens/s", measured: "195.1 tokens/s", gap: "+68%" },
		{ metric: "Energy per request", simulated: "—", measured: "40.98 J", gap: "—" },
	],
	workload_rows: [
		{ kind: "development", workload: "development", outcome: "met", predicted: "met", misses: "", same_trace: true,
			measured_goodput_tok_s: 22.4, simulated_goodput_tok_s: 22.4, measured_ttft_ms_p99: 364.5, simulated_ttft_ms_p99: 560.1, ttft_gap: "-35%",
			measured_trace_sha256: "sha256:b65174341b89c1afec09c09f47a6a15ab0cac1e315d37e3a4722094b02a1e964", measured: { goodput_tok_s: 22.4 } },
	],
	resample_rows: [],
	design_id: "baseline_model-llm-0_6b_max_concurrency-12", energy_source: "nvml_counter", seed: 42, task: "9.2",
};
export const RUN_GPU_ENERGY = {
	app: "mlsys-research", loop: "sandbox", ts: "20261128T113513Z", ok: true,
	summary: { duration_s: 288.4, outcome: "ran", ...variant("serve_9_2_energy", "r4_e_06b_c12_b"),
		usage: { cost_usd: 0.019486, cpu_s: 0.803, gpu_s: 280.533, gpu_type: "RTX 5080", metered: "measured" }, metrics: energyMetrics },
	steps: [step("sandbox", 1795866001.44, energyMetrics)],
} as unknown as MeCycleDetail;

// screen 20261128T040036Z — the simulate gate held the GPU step back.
const stoppedMetrics = {
	status: "simulated", arm: "llm_0_6b_c8_chunk2048", objective_metric: "goodput_tok_s",
	goodput_tok_s: 21.33, ttft_ms_p99: 2173.09, completion_rate: 1, meets_constraints: false,
	calibrated: true, calibrated_goodput_tok_s: 22.45, calibrated_ttft_ms_p99: 1281, calibrated_completion_rate: 1, calibrated_meets_constraints: 1,
	constraints: [{ metric: "ttft_ms.p99", op: "<", value: 2000, observed: 2173.09, met: false }, { metric: "completion_rate", op: ">=", value: 0.99, observed: 1, met: true }],
	summary: "misses ttft_ms.p99 (2173 vs < 2000)",
	measured_on: "Simulated RTX 5080 (mlsys-simulator v0.1.3)", reused: true,
	design_id: "baseline_model-llm-0_6b_chunked_prefill-8c494c45",
};
export const RUN_GATE_STOPPED = {
	app: "mlsys-research", loop: "screen", ts: "20261128T040036Z", ok: true,
	summary: {
		duration_s: 1.762, outcome: "ran", engine: "chain", held_at: "simulate", ...variant("serve_9_2", "llm_0_6b_c8_chunk2048"),
		primary_metric: { name: "goodput_tok_s", value: 21.33 },
		assets_used: { metric: { name: "goodput_tok_s", higher_is_better: true } },
		usage: { cost_usd: 0, cpu_s: 0, gpu_s: 0, metered: "reused", saved_cpu_s: 1.067 },
		stages: [
			{ loop: "simulate", status: "done", ok: true, gate: "calibrated_meets_constraints >= 1", ts: "20261128T040035Z", metrics: { meets_constraints: false, objective: 21.33 } },
			{ loop: "sandbox", status: "held", ok: false, ts: null, metrics: {} },
		],
		metrics: stoppedMetrics,
	},
	steps: [{ step_id: "simulate", ok: true, output_summary: "done", duration_s: 0.42 }, { step_id: "sandbox", ok: false, error: "held" }],
	events: [
		{ step_id: "simulate", stage: null, kind: "stage", started_at: 1795838435.57, ended_at: 1795838435.99, ok: true, summary: "done" },
		{ step_id: "sandbox", stage: null, kind: "stage", started_at: null, ended_at: null, ok: false, summary: "held" },
	],
} as unknown as MeCycleDetail;

// calibrate 20261128T104659Z — too few designs: the fit got worse and isn't used yet.
const calibrateMetrics = {
	status: "too_few", gpu: "RTX 5080", profile: "protocol-v1.21", n_designs: 2, n_points: 2, energy_n_models: 2, written: true,
	error_before_pct: 64.8, error_after_pct: 136.4, ratio_ttft_ms_p99: 1.8502, ratio_completion_rate: 1,
	summary: "Learned from 2 designs measured on the RTX 5080; 1 more before the correction is used (one or two can mislead).",
	energy_models: [
		{ model: "llm-0.6b", power: "156.16 W", runs: 1, task: "9.1", error: "—", used: "yes" },
		{ model: "llm-1.7b", power: "198.33 W", runs: 1, task: "9.1", error: "—", used: "yes" },
		{ model: "llm-4b", power: "—", runs: 0, task: "9.1", error: "—", used: "no: no GPU run with an energy reading" },
	],
	factors: Array.from({ length: 10 }, (_, i) => ({
		key: ["completion_rate", "decode_tok_s", "makespan_s", "throughput_tok_s", "tpot_ms_p99", "ttft_ms_p50", "ttft_ms_p99", "vram_peak_gib", "goodput_tok_s", "e2e_ms_p99"][i],
		metric: ["Share of requests that finished", "How fast words are generated", "Time to finish the whole workload", "Total words produced per second", "Time between words, slowest 1%", "Time to the first word, typical request", "Time to the first word, slowest 1% of requests", "Memory used on the GPU", "Useful words per second", "Whole request, slowest 1%"][i],
		by: ["1.00×", "1.46×", "1.31×", "1.00×", "1.48×", "2.09×", "1.85×", "1.02×", "1.02×", "1.10×"][i],
		designs: 2, points: 2, error_before: ["0.0%", "37.7%", "49.1%", "0.0%", "61.1%", "63.0%", "64.8%", "2.3%", "0.0%", "12.0%"][i],
		error_after: ["0.0%", "21.1%", "29.8%", "0.0%", "18.5%", "66.9%", "136.4%", "0.6%", "2.6%", "9.0%"][i],
		simulator_reads: i % 2 ? "high" : "low",
	})),
};
export const RUN_CALIBRATE_TOO_FEW = {
	app: "mlsys-research", loop: "calibrate", ts: "20261128T104659Z", ok: true,
	summary: { duration_s: 0.853, outcome: "ran", branch_label: "r3_calibrate", primary_metric: { name: "n_designs", value: 2 }, metrics: calibrateMetrics },
	steps: [step("calibrate", 1795862819.75, calibrateMetrics)],
} as unknown as MeCycleDetail;

export const RUN_PAGE_CONTEXT: RunContext = {
	experiments: [
		{ id: "serve_9_2", metric: { name: "goodput_tok_s", higher_is_better: true } },
		{ id: "serve_9_2_energy", metric: { name: "estimated_energy_j_per_tok", higher_is_better: false } },
	],
	gates: {},
};

export const RUN_PAGE_LIST: MeCycleListItem[] = [];
