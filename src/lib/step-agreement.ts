// step-agreement — does a cheap step predict the expensive one?
//
// Round 10 (2026-11-28), generic. Research apps screen with a cheap step and
// confirm with an expensive one: a simulator, then a real GPU; an in-sample
// backtest, then an out-of-sample one. Spending only on what the cheap step
// picks is wise only as far as it predicts the expensive step, so the
// platform measures that instead of assuming it: for every metric two steps of
// one experiment both report (same name, or a declared `same_as`), over the
// versions measured at both —
//   - does the ranking agree? (Spearman ρ, and whether the top pick is the same)
//   - by how much does the cheap step read high or low? (typical ratio)
//   - which pass/fail answers flipped? (a 0/1 metric that disagrees)
// Nothing here knows what a step measures. Pure functions; the words live here.

import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { rowStep } from "@/lib/evolution";
import { humanId } from "@/lib/research-map";
import { fmtMetricValue, humanMetric, isFindingKey } from "@/lib/run-answer";

/** Bookkeeping and usage numbers are never compared. */
const NOT_A_RESULT = /^(cost_usd|duration_s|stage_passed|cpu_s|gpu_s|wall_s|saved_cpu_s|saved_gpu_s|n|.*_n)$/;

export interface MetricAgreement {
	metric: string;
	label: string;
	unit: string;
	/** Versions measured at both steps. */
	n: number;
	/** Spearman rank correlation, −1…1 (null with fewer than 3 versions). */
	rho: number | null;
	/** Whether the best version by the cheap step is the best by the expensive one. */
	topAgrees: boolean | null;
	/** Typical expensive ÷ cheap (geometric mean over positive pairs); null if not defined. */
	ratio: number | null;
	/** 0/1 metrics: versions where the steps disagree. */
	flips: Array<{ version: string; cheap: number; expensive: number }>;
	binary: boolean;
	higherIsBetter: boolean;
	pairs: Array<{ version: string; cheap: number; expensive: number }>;
}

export interface StepAgreement {
	cheap: { step: string; label: string };
	expensive: { step: string; label: string };
	metrics: MetricAgreement[];
}

/** Per version, the mean of each numeric metric at one step. */
function meansAt(rows: MeExperimentRow[], step: string, steps: EvidenceStepSpec[]): Map<string, Record<string, number>> {
	const acc = new Map<string, Record<string, { s: number; n: number }>>();
	const staged = rows.some((r) => !!r.dims?.stage);
	for (const r of rows) {
		if (!r.variant_id || r.dims?.discarded === "1") continue;
		// A row that names no stage among rows that do sits at the step whose
		// metrics it reports (MLSys GPU rows → Sandbox), never at none.
		const at = staged ? rowStep(r, steps) : steps[0].step;
		if (at !== step) continue;
		const slot = acc.get(r.variant_id) ?? {};
		for (const [k, v] of Object.entries(r.metrics ?? {})) {
			// Bookkeeping (recorded, holdouts_run, seeds) is no finding to agree on.
			if (typeof v !== "number" || !Number.isFinite(v) || NOT_A_RESULT.test(k) || !isFindingKey(k)) continue;
			const c = (slot[k] ??= { s: 0, n: 0 });
			c.s += v; c.n += 1;
		}
		acc.set(r.variant_id, slot);
	}
	const out = new Map<string, Record<string, number>>();
	for (const [v, slot] of acc) out.set(v, Object.fromEntries(Object.entries(slot).map(([k, c]) => [k, c.s / c.n])));
	return out;
}

/** Ranks with ties averaged (1-based). */
export function ranks(xs: number[]): number[] {
	const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
	const r = new Array<number>(xs.length);
	for (let i = 0; i < idx.length; ) {
		let j = i;
		while (j + 1 < idx.length && idx[j + 1].x === idx[i].x) j++;
		const avg = (i + j) / 2 + 1;
		for (let k = i; k <= j; k++) r[idx[k].i] = avg;
		i = j + 1;
	}
	return r;
}

/** Spearman ρ (Pearson on ranks). null when undefined (n < 3 or no spread). */
export function spearman(a: number[], b: number[]): number | null {
	if (a.length !== b.length || a.length < 3) return null;
	const ra = ranks(a), rb = ranks(b);
	const n = ra.length;
	const ma = ra.reduce((s, x) => s + x, 0) / n, mb = rb.reduce((s, x) => s + x, 0) / n;
	let num = 0, da = 0, db = 0;
	for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
	if (da === 0 || db === 0) return null;
	return num / Math.sqrt(da * db);
}

/** Every pair of steps (earlier → later) and what they both report. */
export function stepAgreements(input: {
	steps: EvidenceStepSpec[];
	rows: MeExperimentRow[];
	/** Declared pairings: `{ "<later step>.<metric>": "<earlier step>.<metric>" }`. */
	sameAs?: Record<string, string>;
}): StepAgreement[] {
	const { steps, rows } = input;
	if (steps.length < 2) return [];
	const at = new Map(steps.map((s) => [s.step, meansAt(rows, s.step, steps)]));
	const out: StepAgreement[] = [];
	for (let i = 0; i < steps.length - 1; i++) {
		for (let j = i + 1; j < steps.length; j++) {
			const A = steps[i], B = steps[j];
			const ma = at.get(A.step)!, mb = at.get(B.step)!;
			const both = [...ma.keys()].filter((v) => mb.has(v));
			if (!both.length) continue;
			// Metric pairs: same name in both, plus declared same_as.
			const pairsOf = new Map<string, { a: string; b: string }>();
			const namesB = new Set(both.flatMap((v) => Object.keys(mb.get(v)!)));
			for (const v of both) for (const k of Object.keys(ma.get(v)!)) if (namesB.has(k)) pairsOf.set(k, { a: k, b: k });
			for (const [later, earlier] of Object.entries(input.sameAs ?? {})) {
				const [ls, lm] = later.split("."), [es, em] = earlier.split(".");
				if (ls === B.step && es === A.step && lm && em) pairsOf.set(lm, { a: em, b: lm });
			}
			const metrics: MetricAgreement[] = [];
			for (const [name, p] of pairsOf) {
				const pairs = both
					.map((v) => ({ version: v, cheap: ma.get(v)![p.a], expensive: mb.get(v)![p.b] }))
					.filter((x) => typeof x.cheap === "number" && typeof x.expensive === "number");
				if (!pairs.length) continue;
				const declared = [...B.metrics, ...A.metrics].find((m) => m.name === name);
				const higher = declared?.better ? declared.better !== "lower" : !/(^|_)(ttft|tpot|latency|makespan|loss|error|drawdown|cost|ms|p_?value|dsr_p)(_|$)/.test(name);
				const binary = pairs.every((x) => (x.cheap === 0 || x.cheap === 1) && (x.expensive === 0 || x.expensive === 1));
				const rho = binary ? null : spearman(pairs.map((x) => x.cheap), pairs.map((x) => x.expensive));
				const best = (k: "cheap" | "expensive") => pairs.reduce((a, x) => (higher ? (x[k] > a[k] ? x : a) : x[k] < a[k] ? x : a));
				const topAgrees = binary || pairs.length < 2 ? null : best("cheap").version === best("expensive").version;
				const pos = pairs.filter((x) => x.cheap > 0 && x.expensive > 0);
				const ratio = binary || !pos.length ? null : Math.exp(pos.reduce((s, x) => s + Math.log(x.expensive / x.cheap), 0) / pos.length);
				const flips = binary ? pairs.filter((x) => x.cheap !== x.expensive) : [];
				const h = humanMetric(name);
				metrics.push({ metric: name, label: h.label, unit: h.unit, n: pairs.length, rho, topAgrees, ratio, flips, binary, higherIsBetter: higher, pairs });
			}
			if (!metrics.length) continue;
			// The steps' declared metrics first (in declared order), then the rest;
			// ranked ones before 0/1. Live MLSys led with Decode / E2E p50 over the
			// experiment's own goodput and TTFT (2026-11-28).
			const declaredOrder = [...B.metrics, ...A.metrics].map((m) => m.name);
			const rank = (m: MetricAgreement) => { const i = declaredOrder.indexOf(m.metric); return i < 0 ? 1e3 : i; };
			metrics.sort((a, b) => Number(a.binary) - Number(b.binary) || rank(a) - rank(b) || b.n - a.n || a.metric.localeCompare(b.metric));
			out.push({ cheap: { step: A.step, label: humanId(A.step) }, expensive: { step: B.step, label: humanId(B.step) }, metrics });
		}
	}
	return out;
}

// ── in words ─────────────────────────────────────────────────────────────

const pct = (x: number) => `${Math.round(Math.abs(x - 1) * 100)}%`;

/** "Ranks 6 versions the same way as GPU sandbox (ρ 0.83)", etc. */
export function rankWords(m: MetricAgreement, expensiveLabel: string): string {
	if (m.binary) return "";
	if (m.rho == null) return m.n < 3 ? `Too few versions measured at both steps to compare rankings (${m.n} of 3 needed)` : "Every version scored the same — no ranking to compare";
	const r = Math.round(m.rho * 100) / 100;
	const how = m.rho >= 0.8 ? "the same way as" : m.rho >= 0.5 ? "roughly like" : m.rho > 0 ? "only loosely like" : "differently from";
	const top = m.topAgrees === true ? "; same top pick" : m.topAgrees === false ? "; a different top pick" : "";
	return `Ranks ${m.n} versions ${how} ${expensiveLabel} (ρ ${r})${top}`;
}

/** "Reads TTFT p99 1.7× high" / "within 5%" / "38% low". */
export function biasWords(m: MetricAgreement, cheapLabel: string): string {
	if (m.binary || m.ratio == null) return "";
	const r = m.ratio; // expensive ÷ cheap
	if (Math.abs(r - 1) < 0.05) return `${cheapLabel} reads ${m.label} within 5%`;
	if (r < 1) {
		const k = 1 / r;
		return k >= 1.5 ? `${cheapLabel} reads ${m.label} ${Math.round(k * 10) / 10}× high` : `${cheapLabel} reads ${m.label} ${pct(r)} high`;
	}
	return r >= 1.5 ? `${cheapLabel} reads ${m.label} ${Math.round(r * 10) / 10}× low` : `${cheapLabel} reads ${m.label} ${pct(r)} low`;
}

/** "1 version passed Simulator but missed on GPU sandbox: LLM 4b". */
export function flipWords(m: MetricAgreement, cheapLabel: string, expensiveLabel: string, label: (v: string) => string = humanId): string {
	if (!m.binary) return "";
	if (!m.flips.length) return `${m.label}: the same answer at both steps for all ${m.n} ${m.n === 1 ? "version" : "versions"}`;
	const yesNo = m.flips.filter((f) => f.cheap === 1);
	const noYes = m.flips.filter((f) => f.cheap === 0);
	const parts: string[] = [];
	if (yesNo.length) parts.push(`${yesNo.length} said yes at ${cheapLabel} but no at ${expensiveLabel} (${yesNo.map((f) => label(f.version)).join(", ")})`);
	if (noYes.length) parts.push(`${noYes.length} said no at ${cheapLabel} but yes at ${expensiveLabel} (${noYes.map((f) => label(f.version)).join(", ")})`);
	return `${m.label}: ${parts.join("; ")}`;
}

/** The one-line verdict for a pair of steps: can the cheap step be trusted
 *  to pick what to spend on? */
export function agreementHeadline(a: StepAgreement): { text: string; tone: "ok" | "attention" | "idle" } {
	const ranked = a.metrics.find((m) => !m.binary && m.rho != null);
	const flips = a.metrics.filter((m) => m.binary).reduce((s, m) => s + m.flips.length, 0);
	if (!ranked) {
		const n = Math.max(0, ...a.metrics.map((m) => m.n));
		if (flips) return { text: `${a.cheap.label} and ${a.expensive.label} disagree on ${flips} pass/fail ${flips === 1 ? "answer" : "answers"}`, tone: "attention" };
		return { text: n < 3 ? `Measure ${3 - n} more ${3 - n === 1 ? "version" : "versions"} at both steps to see whether ${a.cheap.label} predicts ${a.expensive.label}` : `${a.cheap.label} and ${a.expensive.label} agree so far`, tone: "idle" };
	}
	const good = (ranked.rho ?? 0) >= 0.8 && ranked.topAgrees !== false && !flips;
	const text = good
		? `${a.cheap.label} predicts ${a.expensive.label} well — safe to screen with it`
		: (ranked.rho ?? 0) >= 0.5
			? `${a.cheap.label} roughly predicts ${a.expensive.label} — confirm its top picks at ${a.expensive.label}`
			: `${a.cheap.label} does not predict ${a.expensive.label} well — don't screen on it alone`;
	return { text, tone: good ? "ok" : "attention" };
}

/** A pair's numbers as table rows (version, cheap, expensive, gap). */
export function agreementRows(m: MetricAgreement, label: (v: string) => string = humanId): Array<{ version: string; cheap: string; expensive: string; gap: string }> {
	return m.pairs.map((p) => ({
		version: label(p.version),
		cheap: fmtMetricValue(p.cheap, m.unit, m.metric),
		expensive: fmtMetricValue(p.expensive, m.unit, m.metric),
		gap: m.binary ? (p.cheap === p.expensive ? "same" : "flipped") : p.cheap === 0 ? "—" : `${p.expensive >= p.cheap ? "+" : "−"}${Math.round(Math.abs(p.expensive / p.cheap - 1) * 100)}%`,
	}));
}

/** How many versions a pair's numbers rest on: "from 2 versions measured at both steps". */
export function agreementBasis(a: StepAgreement): string {
	const n = Math.max(0, ...a.metrics.map((m) => m.n));
	return `from ${n} ${n === 1 ? "version" : "versions"} measured at both steps`;
}

/**
 * What a pair of steps shows under its headline — EITHER the readings OR the
 * ask, never both. Until 3 versions reached both steps the headline asks for
 * more ("Measure 1 more version …") and no ratio is listed: two pairs would
 * read as a finding. Pass/fail flips are listed either way (they are facts,
 * not estimates). `scatter`: a metric has enough versions to plot.
 */
export function agreementLines(a: StepAgreement, label: (v: string) => string = humanId): { lines: string[]; asking: boolean } {
	const asking = !a.metrics.some((m) => !m.binary && m.rho != null);
	const lines = a.metrics.flatMap((m) => [
		!asking && m.rho != null ? `${m.label}: ${rankWords(m, a.expensive.label).replace(/^Ranks/, "ranks")}` : "",
		asking ? "" : biasWords(m, a.cheap.label),
		flipWords(m, a.cheap.label, a.expensive.label, label),
	]).filter(Boolean).slice(0, 5);
	return { lines, asking };
}
