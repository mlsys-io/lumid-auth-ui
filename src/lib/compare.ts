// compare — A/B in plain words. The graph's Compare view (2026-11-25) puts two
// workflows, variants or versions side by side per metric and says who is
// ahead and whether it can be told yet. Honest by construction: too few runs
// says so, and a gap inside the noise is "can't tell apart yet", never a win.

export interface SideStats { n: number; mean: number; sd: number; min: number; max: number; latest: number }

export function sideStats(values: number[]): SideStats | null {
	const v = values.filter((x) => Number.isFinite(x));
	if (!v.length) return null;
	const n = v.length;
	const mean = v.reduce((a, x) => a + x, 0) / n;
	const sd = n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
	return { n, mean, sd, min: Math.min(...v), max: Math.max(...v), latest: v[v.length - 1] };
}

export interface Verdict { tone: "ok" | "attention" | "idle"; text: string; ahead?: "a" | "b" }

const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
const fmt = (x: number) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString() : trim(x.toFixed(Math.abs(x) >= 10 ? 1 : 3)));

/**
 * Can two sides be told apart on one metric? The same rule `compareVerdict`
 * uses, without its minimum-runs gate, so a tie can be called on a few runs:
 *   "equal" — the same number (to 1e-9 of its size);
 *   "noise" — both sides have a spread and the gap is within twice its
 *             standard error (≈95%);
 *   "near"  — a side has a single result, so its spread is unknown, and the
 *             gap is under `nearRel` of the value (default 2%): one GPU
 *             measurement each can't separate 0.8% (MLSys 9.2, 2026-11-28);
 *   null    — they differ.
 * A deterministic side (several results, sd 0 — a simulator) is never "near":
 * its number is exact, so any gap is real.
 */
export function noiseTie(a: SideStats | null, b: SideStats | null, nearRel = 0.02): "equal" | "noise" | "near" | null {
	if (!a || !b) return null;
	const gap = b.mean - a.mean;
	const size = Math.max(Math.abs(a.mean), Math.abs(b.mean));
	if (Math.abs(gap) <= 1e-9 * Math.max(1, size)) return "equal";
	const se = Math.sqrt((a.sd ** 2) / a.n + (b.sd ** 2) / b.n);
	if (a.n >= 2 && b.n >= 2) return se > 0 && Math.abs(gap) <= 2 * se ? "noise" : null;
	return size > 0 && Math.abs(gap) / size < nearRel ? "near" : null;
}

/**
 * Who is ahead on one metric. `better` says which way is good. Needs `minN`
 * runs a side; a deterministic side (sd 0, e.g. a simulator) still needs the
 * other side's spread to call it. Ahead = the gap is more than twice its
 * standard error (≈95%).
 */
export function compareVerdict(metric: string, a: SideStats | null, b: SideStats | null, better: "higher" | "lower", names: { a: string; b: string }, minN = 3): Verdict {
	if (!a && !b) return { tone: "idle", text: `Neither has a ${metric} result yet` };
	if (!a || !b) return { tone: "idle", text: `${!a ? names.a : names.b} has no ${metric} result yet` };
	if (a.n < minN || b.n < minN) return { tone: "idle", text: `Too few runs to tell yet (${a.n} vs ${b.n}; ${minN} each needed)` };
	const gap = b.mean - a.mean;
	const se = Math.sqrt((a.sd ** 2) / a.n + (b.sd ** 2) / b.n);
	if (gap === 0 || (se > 0 && Math.abs(gap) <= 2 * se)) {
		return { tone: "attention", text: `Can't tell apart yet — the gap (${fmt(Math.abs(gap))}) is within the noise (${a.n} vs ${b.n} runs)` };
	}
	const bWins = better === "higher" ? gap > 0 : gap < 0;
	const who = bWins ? names.b : names.a;
	const pct = a.mean !== 0 ? Math.abs(gap / a.mean) * 100 : null;
	return { tone: "ok", ahead: bWins ? "b" : "a", text: `${who} ahead on ${metric} by ${fmt(Math.abs(gap))}${pct != null && pct < 1000 ? ` (${pct.toFixed(pct < 10 ? 1 : 0)}%)` : ""} — ${a.n} vs ${b.n} runs` };
}

/**
 * Every numeric metric across runs, oldest first: `{metric: [values]}`. A
 * true/false metric counts as 1/0 ("meets constraints" is comparable too).
 * With `arm`, only runs of that version (`metrics.arm`) count — how a setup's
 * runs are told apart from its workflow's other runs.
 */
export function runMetricValues(runs: Array<Record<string, unknown> | null | undefined>, arm?: string): Map<string, number[]> {
	const by = new Map<string, number[]>();
	for (const m of runs) {
		if (!m || (arm != null && m.arm !== arm)) continue;
		for (const [k, v] of Object.entries(m)) {
			const x = typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : NaN;
			if (Number.isFinite(x)) by.set(k, [...(by.get(k) ?? []), x]);
		}
	}
	return by;
}

// ── Many sides (round 9): the Compare page ───────────────────────────────
// 2–5 sides (runs or versions) against one baseline column. Per metric: each
// side's mean ± SD, its change vs the baseline, the best side, and the
// pairwise verdict vs the baseline (compareVerdict, so the same noise rule).
// The headline is one sentence about the first (primary) metric.

export type Better = "higher" | "lower";

/** Which way is good for a metric: the app's own word when it says, else
 *  the name (latency, cost, errors, loss, memory are better low). */
export function metricBetter(name: string, higherIsBetter?: boolean | null): Better {
	if (higherIsBetter === true) return "higher";
	if (higherIsBetter === false) return "lower";
	return /(loss|error|regress|drawdown|latency|cost|fail|ttft|tpot|e2e|makespan|(^|_)ms(_|$)|vram|peak_gib|duration|wait)/i.test(name) ? "lower" : "higher";
}

export interface SideInput {
	label: string;
	/** Every value per metric, oldest first (one per run). */
	values: Record<string, number[]>;
	/** Aggregates when the per-run values are not available (an experiment's
	 *  served means). Used only for metrics with no `values`. */
	stats?: Record<string, SideStats | null>;
}
export interface MetricSpec { name: string; label?: string; better?: Better }
export interface SideCell {
	stats: SideStats | null;
	/** side mean − baseline mean (null on the baseline or when either is missing). */
	delta: number | null;
	deltaPct: number | null;
	best: boolean;
	/** This side vs the baseline; null on the baseline column. */
	verdict: Verdict | null;
}
export interface MetricRow { metric: string; label: string; better: Better; cells: SideCell[]; best: number | null }
export interface SidesComparison { baseline: number; rows: MetricRow[]; headline: Verdict }

function statsFor(s: SideInput, m: string): SideStats | null {
	const v = s.values[m];
	if (v && v.length) return sideStats(v);
	return s.stats?.[m] ?? null;
}

export function compareSides(
	sides: SideInput[],
	metrics: Array<MetricSpec | string>,
	baselineIdx = 0,
	opts: { minN?: number; fmt?: (metric: string, v: number) => string } = {},
): SidesComparison {
	const minN = opts.minN ?? 3;
	const base = Math.max(0, Math.min(sides.length - 1, baselineIdx));
	const specs: MetricSpec[] = metrics.map((m) => (typeof m === "string" ? { name: m } : m));
	const rows: MetricRow[] = specs.map((spec) => {
		const better = spec.better ?? metricBetter(spec.name);
		const label = spec.label ?? spec.name;
		const stats = sides.map((s) => statsFor(s, spec.name));
		const b = stats[base];
		const have = stats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
		let best: number | null = null;
		if (have.length >= 2) {
			const means = have.map((i) => stats[i]!.mean);
			const top = better === "higher" ? Math.max(...means) : Math.min(...means);
			const allSame = means.every((x) => x === means[0]);
			if (!allSame) best = have.find((i) => stats[i]!.mean === top) ?? null;
		}
		const cells: SideCell[] = stats.map((s, i) => {
			const delta = i !== base && s && b ? s.mean - b.mean : null;
			return {
				stats: s,
				delta,
				deltaPct: delta != null && b && b.mean !== 0 ? (delta / Math.abs(b.mean)) * 100 : null,
				best: best != null && s != null && s.mean === stats[best]!.mean,
				verdict: i === base ? null : compareVerdict(label, b, s, better, { a: sides[base].label, b: sides[i].label }, minN),
			};
		});
		return { metric: spec.name, label, better, cells, best };
	});
	return { baseline: base, rows, headline: compareHeadline(rows[0] ?? null, sides.map((s) => s.label), base, { minN, fmt: opts.fmt }) };
}

const runsWord = (a: number, b: number) => (a === b ? `${a} run${a === 1 ? "" : "s"} each` : `${a} vs ${b} runs`);

/**
 * The verdict sentence the Compare page opens with, about one metric:
 *   "B is ahead of A on Sharpe by 0.31 (8 runs each)"
 *   "Can't tell apart yet on Sharpe: need about 6 more runs each"
 *   "B has the best Goodput (130 tok/s vs 120 tok/s for A) — too few runs to tell yet: 1 run each, 3 each needed"
 */
export function compareHeadline(
	row: MetricRow | null,
	labels: string[],
	baseline: number,
	opts: { minN?: number; fmt?: (metric: string, v: number) => string } = {},
): Verdict {
	const minN = opts.minN ?? 3;
	const f = (v: number) => (opts.fmt ? opts.fmt(row!.metric, v) : fmt(v));
	if (!row) return { tone: "idle", text: "No numbers to compare yet" };
	const base = row.cells[baseline]?.stats;
	const others = row.cells.map((c, i) => ({ c, i })).filter(({ c, i }) => i !== baseline && c.stats);
	if (!base && !others.length) return { tone: "idle", text: `No ${row.label} results to compare yet` };
	if (!base) return { tone: "idle", text: `${labels[baseline]} has no ${row.label} result yet — pin another side as the baseline` };
	if (!others.length) return { tone: "idle", text: `Only ${labels[baseline]} has a ${row.label} result yet` };

	// Too few runs anywhere: name the best so far, and say it can't be called.
	const fewest = Math.min(base.n, ...others.map(({ c }) => c.stats!.n));
	if (fewest < minN) {
		const each = fewest === Math.max(base.n, ...others.map(({ c }) => c.stats!.n)) ? `${fewest} run${fewest === 1 ? "" : "s"} each` : `as few as ${fewest} run${fewest === 1 ? "" : "s"}`;
		const tail = `too few runs to tell yet: ${each}, ${minN} each needed`;
		if (row.best == null) return { tone: "idle", text: `${row.label} is the same on every side so far — ${tail}` };
		const top = row.cells[row.best].stats!.mean;
		const withStats = row.cells.map((c, i) => ({ c, i })).filter(({ c }) => c.stats);
		const tied = withStats.filter(({ c }) => c.stats!.mean === top).map(({ i }) => i);
		const rest = withStats.filter(({ c }) => c.stats!.mean !== top);
		const next = rest.reduce((a, b) => ((row.better === "higher" ? b.c.stats!.mean > a.c.stats!.mean : b.c.stats!.mean < a.c.stats!.mean) ? b : a));
		const vs = `${f(next.c.stats!.mean)} for ${labels[next.i]}${rest.length > 1 ? " and lower" : ""}`.replace(" and lower", row.better === "higher" ? " and lower" : " and higher");
		if (tied.length > 1) {
			const names = `${tied.slice(0, -1).map((i) => labels[i]).join(", ")} and ${labels[tied[tied.length - 1]]}`;
			return { tone: "idle", text: `${names} share the best ${row.label} (${f(top)} vs ${vs}) — ${tail}` };
		}
		return { tone: "idle", text: `${labels[row.best]} has the best ${row.label} (${f(top)} vs ${vs}) — ${tail}` };
	}

	const winners = others.filter(({ c }) => c.verdict?.ahead === "b");
	if (winners.length) {
		const w = winners.reduce((a, b) => ((row.better === "higher" ? b.c.stats!.mean > a.c.stats!.mean : b.c.stats!.mean < a.c.stats!.mean) ? b : a));
		const s = w.c.stats!;
		return { tone: "ok", ahead: "b", text: `${labels[w.i]} is ahead of ${labels[baseline]} on ${row.label} by ${f(Math.abs(s.mean - base.mean))} (${runsWord(s.n, base.n)})` };
	}
	if (others.every(({ c }) => c.verdict?.ahead === "a")) {
		const near = others.reduce((a, b) => (Math.abs(b.c.stats!.mean - base.mean) < Math.abs(a.c.stats!.mean - base.mean) ? b : a));
		const who = others.length === 1 ? labels[near.i] : `every other side (closest: ${labels[near.i]})`;
		return { tone: "ok", ahead: "a", text: `${labels[baseline]} is ahead of ${who} on ${row.label} by ${f(Math.abs(near.c.stats!.mean - base.mean))} (${runsWord(base.n, near.c.stats!.n)})` };
	}
	// Inside the noise: how many more runs each would separate the widest gap.
	const wide = others.reduce((a, b) => (Math.abs(b.c.stats!.mean - base.mean) > Math.abs(a.c.stats!.mean - base.mean) ? b : a));
	const s = wide.c.stats!;
	const gap = Math.abs(s.mean - base.mean);
	const pooled = (s.sd ** 2 + base.sd ** 2) / 2;
	if (gap > 0 && pooled > 0) {
		const need = Math.ceil((8 * pooled) / gap ** 2 - 1e-9);
		const more = need - Math.min(s.n, base.n);
		if (more > 0 && more <= 500) return { tone: "attention", text: `Can't tell apart yet on ${row.label}: need about ${more} more run${more === 1 ? "" : "s"} each` };
	}
	return { tone: "attention", text: `Can't tell apart yet on ${row.label} — the gap is within the noise (${runsWord(s.n, base.n)})` };
}

/** Every side reports the metric and they all read the same (same mean, same
 *  count) — a row that says nothing about the difference, folded on the page. */
export function rowIsSame(row: MetricRow): boolean {
	const st = row.cells.map((c) => c.stats);
	if (st.some((x) => !x)) return false;
	return st.every((x) => x!.mean === st[0]!.mean && x!.n === st[0]!.n && x!.sd === st[0]!.sd);
}
