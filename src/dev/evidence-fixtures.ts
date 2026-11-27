// Fixture results for the design gallery's "Each version, step by step"
// section: a three-step workflow whose steps carry gates, a two-step one with a
// gate on the first only, and a one-step scoreboard. Fixed data, no requests.
import type { MeExperimentRow } from "@/api/me";
import { evidenceOf, type Evidence, type EvidenceStepSpec } from "@/lib/evidence";

let t = 0;
const row = (v: string, stage: string, passed: boolean, metrics: Record<string, number>, reason = ""): MeExperimentRow => ({
	ts: new Date(Date.UTC(2026, 10, 20, 0, t++)).toISOString(), variant_id: v,
	metrics, dims: { stage, passed: passed ? "1" : "0", reason },
});

const GATED: EvidenceStepSpec[] = [
	{ step: "quick_check", gate: "coverage_pct >= 90", metrics: [{ name: "coverage_pct" }] },
	{ step: "full_run", gate: "score >= 0.5 and samples >= 30", metrics: [{ name: "score" }, { name: "samples" }] },
	{ step: "stress_test", gate: "held_out_score > 0", metrics: [{ name: "held_out_score" }] },
];
const gatedRows: MeExperimentRow[] = [
	...["baseline", "wider_window", "short_horizon", "two_signals", "volume_filter", "half_size", "late_entry", "no_cap"].map((v, i) =>
		row(v, "quick_check", i !== 6, { coverage_pct: i === 6 ? 71 : 96 + (i % 3), cost_usd: 0.004 }, i === 6 ? "coverage_pct 71 < 90" : "")),
	row("baseline", "full_run", true, { score: 0.82, samples: 120, cost_usd: 0.11 }),
	row("wider_window", "full_run", false, { score: 0.21, samples: 64, cost_usd: 0.11 }, "score 0.21 < 0.5"),
	row("short_horizon", "full_run", true, { score: 1.14, samples: 88, cost_usd: 0.12 }),
	row("two_signals", "full_run", false, { score: 0.61, samples: 12, cost_usd: 0.1 }, "samples 12 < 30"),
	row("volume_filter", "full_run", true, { score: 0.66, samples: 41, cost_usd: 0.11 }),
	row("baseline", "stress_test", true, { held_out_score: 0.34, cost_usd: 0.92 }),
	row("short_horizon", "stress_test", false, { held_out_score: -0.12, cost_usd: 0.95 }, "held_out_score -0.12 <= 0"),
];

const TWO: EvidenceStepSpec[] = [
	{ step: "simulate", gate: "goodput_tok_s >= 900", metrics: [{ name: "goodput_tok_s" }] },
	{ step: "sandbox", metrics: [{ name: "ttft_ms_p99", better: "lower" }] },
];
const twoRows: MeExperimentRow[] = [
	row("tp2_batch_32", "simulate", true, { goodput_tok_s: 1210 }),
	row("tp2_batch_64", "simulate", true, { goodput_tok_s: 1388 }),
	row("tp1_batch_32", "simulate", false, { goodput_tok_s: 702 }, "goodput_tok_s 702 < 900"),
	row("tp2_batch_32", "sandbox", true, { ttft_ms_p99: 812, cost_usd: 0.42 }),
];

const boardRows: MeExperimentRow[] = [
	{ ts: "2026-11-20T00:00:00Z", variant_id: "short_answers", metrics: { judge_score: 0.62 } },
	{ ts: "2026-11-21T00:00:00Z", variant_id: "short_answers", metrics: { judge_score: 0.7 } },
	{ ts: "2026-11-21T00:00:00Z", variant_id: "cite_sources", metrics: { judge_score: 0.81 } },
	{ ts: "2026-11-22T00:00:00Z", variant_id: "current", metrics: { judge_score: 0.58 } },
];

export const DEMO_EVIDENCE: Array<{ title: string; ev: Evidence }> = [
	{
		title: "Three steps, each with a pass rule",
		ev: evidenceOf({ steps: GATED, rows: gatedRows, running: new Set(["half_size"]), versions: ["baseline", "wider_window", "short_horizon", "two_signals", "volume_filter", "half_size", "late_entry", "no_cap"].map((id) => ({ id })) }),
	},
	{ title: "Two steps, a rule on the first", ev: evidenceOf({ steps: TWO, rows: twoRows, versions: [{ id: "tp2_batch_32" }, { id: "tp2_batch_64" }, { id: "tp1_batch_32" }] }) },
	{ title: "One step, no rule (a scoreboard)", ev: evidenceOf({ steps: [], rows: boardRows, metric: "judge_score", versions: [{ id: "current", label: "Current version" }, { id: "short_answers" }, { id: "cite_sources" }, { id: "longer_context" }] }) },
];
