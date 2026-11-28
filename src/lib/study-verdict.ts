// study-verdict — a decided experiment's result, in words, for the Library's
// experiment list (2026-11-28 sweep, gap #5).
//
// The server's `verdict` string is engine shorthand — "llm_0_6b_c12 by +0.3pp
// estimated_energy_j_per_tok vs llm_0_6b_c16 (n=2)": a raw id, a raw metric
// key, "pp" (percentage points) on a J/token metric, and "+0.0pp" naming a
// winner by zero. This builds the sentence from the per-version means instead,
// in the metric's own unit, and names a winner only when the top two versions
// can be told apart (compare.ts `noiseTie`, the rule the Compare view uses).

import type { MeExperiment } from "@/api/me";
import { fmtMetricValue, humanMetric } from "@/lib/run-answer";
import { inSentence, versionLabel } from "@/lib/research-map";
import { noiseTie, type SideStats } from "@/lib/compare";

export interface StudyVerdict {
	tone: "ok" | "attention" | "idle";
	/** A short word for the right-hand status slot. */
	status: string;
	/** The verdict as one sentence. */
	text: string;
}

interface Side { id: string; s: SideStats }

/** "0.368 vs 0.371 J per token": the unit once, after the numbers, when it is
 *  a plain suffix; otherwise each value carries its own ("$1.20 vs $3.40"). */
export function valuesInWords(values: number[], metric: string): string {
	const { unit } = humanMetric(metric);
	const plainSuffix = !!unit && !["$", "%", "¢"].includes(unit);
	if (plainSuffix) return `${values.map((v) => fmtMetricValue(v, "", "")).join(" vs ")} ${unit}`;
	return values.map((v) => fmtMetricValue(v, unit, metric)).join(" vs ");
}

function listWords(names: string[]): string {
	return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A decided experiment's verdict in words; null while it is not decided. */
export function studyVerdict(e: MeExperiment): StudyVerdict | null {
	if (!e.criteria_met) return null;
	if (e.comparable === false) {
		return { tone: "attention", status: "can't compare yet", text: "Can't compare yet — the versions ran under different setups" };
	}
	const metric = e.metric?.name || e.metric_name || "";
	const lowerIsBetter = (e.metric?.higher_is_better ?? e.higher_is_better) === false;
	const sides: Side[] = Object.entries(e.variants || {})
		.filter(([, v]) => v && v.n > 0 && Number.isFinite(v.mean))
		.map(([id, v]) => ({ id, s: { n: v.n, mean: v.mean, sd: v.stdev ?? 0, min: v.mean, max: v.mean, latest: v.last ?? v.mean } }))
		.sort((a, b) => (lowerIsBetter ? a.s.mean - b.s.mean : b.s.mean - a.s.mean));
	const name = (x: Side) => versionLabel(e, x.id);
	const what = metric ? inSentence(humanMetric(metric).label) : "its metric";

	if (!sides.length) {
		// No per-version numbers to say it with: name the winner, invent no number.
		return e.best_variant
			? { tone: "ok", status: "decided", text: `${versionLabel(e, e.best_variant)} is winning` }
			: { tone: "idle", status: "decided", text: "Decided — no per-version results to show" };
	}
	if (sides.length === 1) {
		return { tone: "idle", status: "one result", text: `Only ${name(sides[0])} has a result so far: ${valuesInWords([sides[0].s.mean], metric)}` };
	}

	const best = sides[0];
	const tied = sides.filter((x, i) => i === 0 || noiseTie(best.s, x.s) !== null);
	if (tied.length >= 2) {
		const rest = sides.filter((x) => !tied.includes(x));
		const ahead = rest.length
			? `; ${tied.length === 2 ? "both" : "all"} ahead of ${name(rest[0])} at ${valuesInWords([rest[0].s.mean], metric)}`
			: "";
		return {
			tone: "attention",
			status: "can't tell apart yet",
			text: `Can't tell apart yet on ${what}: ${listWords(tied.map(name))} — ${valuesInWords(tied.map((x) => x.s.mean), metric)}${ahead}`,
		};
	}
	const next = sides[1];
	return {
		tone: "ok",
		status: "decided",
		text: `${name(best)} wins on ${what}: ${valuesInWords([best.s.mean, next.s.mean], metric)} for ${name(next)}`,
	};
}
