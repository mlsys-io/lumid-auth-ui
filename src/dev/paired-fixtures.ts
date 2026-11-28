// Fixtures for PairedDelta in the design gallery: a consulting harness screen
// (quick on a free analyst, then dev on Claude), paired against the current harness.
import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";

export const PAIRED_STEPS: EvidenceStepSpec[] = [{ step: "quick", metrics: [{ name: "paired_delta" }] }, { step: "dev_eval", metrics: [{ name: "paired_delta" }] }];

const r = (v: string, stage: string, m: Record<string, number>, ts: string): MeExperimentRow =>
	({ ts, variant_id: v, metrics: m, dims: { stage } }) as MeExperimentRow;

export const PAIRED_ROWS: MeExperimentRow[] = [
	r("current_cards", "quick", { paired_delta: 0, paired_ci_low: 0, paired_ci_high: 0 }, "1"),
	r("fix_communication_top_line", "quick", { paired_delta: 4.2, paired_ci_low: 1.1, paired_ci_high: 7.6, paired_wins: 14, paired_losses: 4, paired_ties: 19, trials: 4 }, "2"),
	r("fix_issue_tree_objective", "quick", { paired_delta: 1.3, paired_ci_low: -1.8, paired_ci_high: 4.4, paired_wins: 9, paired_losses: 7, paired_ties: 21, trials: 4 }, "3"),
	r("quant_compute_first", "quick", { paired_delta: 0.4, paired_ci_low: -2.9, paired_ci_high: 3.6, paired_wins: 6, paired_losses: 5, paired_ties: 26, trials: 4 }, "4"),
	r("self_review_one_pass", "quick", { paired_delta: -2.6, paired_ci_low: -5.0, paired_ci_high: -0.3, paired_wins: 3, paired_losses: 12, paired_ties: 22, trials: 4 }, "5"),
	r("fix_communication_top_line", "dev_eval", { paired_delta: 3.1, paired_ci_low: 0.4, paired_ci_high: 5.9, paired_wins: 21, paired_losses: 6, paired_ties: 72, trials: 2 }, "6"),
	r("fix_issue_tree_objective", "dev_eval", { paired_delta: 0.8, paired_ci_low: -2.0, paired_ci_high: 3.7, paired_wins: 15, paired_losses: 11, paired_ties: 73, trials: 2 }, "7"),
];

const LABELS: Record<string, string> = {
	current_cards: "Current harness",
	fix_communication_top_line: "Communication: claim first",
	fix_issue_tree_objective: "Issue tree: the objective",
	quant_compute_first: "Quant: number, then steps",
	self_review_one_pass: "Self-review once",
};
export const pairedLabel = (v: string) => LABELS[v] ?? v;
export const pairedStepLabel = (s: string) => (s === "quick" ? "Quick (free)" : s === "dev_eval" ? "Dev (Claude)" : s);
