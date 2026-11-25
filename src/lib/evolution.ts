// "How has this experiment evolved?" — Novix's best-score story, from Lumid's
// own data, honestly:
//
//   • every result point: a version's average so far at that moment; solid when
//     the version has enough results to count (n ≥ min_samples — Novix's "full
//     set"), faint while it is still collecting ("quick set");
//   • the BEST-SO-FAR step line: at each moment, the best average among the
//     versions with enough results. It moves only when a counted version takes
//     the lead or its average moves — like Novix's line that moves only on a
//     full evaluation;
//   • the dashed FRONTIER: the best average among all versions, counted or not
//     ("leading, not confirmed");
//   • the VERSION CHAIN: versions in the order they first produced a result,
//     each with a state in words.
//
// Only meaningful when the versions are comparable; the caller draws small
// multiples otherwise. Pure — tested in evolution.test.ts.

export interface SeriesIn {
	id: string;
	points: Array<{ ts: string; v: number; n?: number }>;
}

export interface EvoPoint { t: number; arm: string; mean: number; n: number; counted: boolean }
export interface StepPoint { t: number; arm: string; value: number }
export type ChainState = "winning" | "best so far" | "collecting" | "trying" | "dropped" | "not run yet";
export interface ChainLink { arm: string; index: number; state: ChainState; mean: number | null; n: number }

export interface Evolution {
	points: EvoPoint[];
	best: StepPoint[];      // best counted version over time (step line)
	frontier: StepPoint[];  // best of all versions over time (dashed)
	hero: { arm: string; value: number } | null;    // best counted, now
	leader: { arm: string; value: number } | null;  // best of all, now
	chain: ChainLink[];
	t0: number; t1: number;
}

/** Each arm's running mean over time. `runningMean` = the points already are
 *  means (series_kind "running_mean"); otherwise raw results are averaged. */
function toRunning(s: SeriesIn, runningMean: boolean): EvoPoint[] {
	const pts = s.points
		.map((p) => ({ t: Date.parse(p.ts), v: p.v, n: p.n }))
		.filter((p) => isFinite(p.t) && isFinite(p.v))
		.sort((a, b) => a.t - b.t);
	if (runningMean) return pts.map((p, i) => ({ t: p.t, arm: s.id, mean: p.v, n: p.n ?? i + 1, counted: false }));
	let sum = 0;
	return pts.map((p, i) => { sum += p.v; return { t: p.t, arm: s.id, mean: sum / (i + 1), n: i + 1, counted: false }; });
}

export function buildEvolution(series: SeriesIn[], opts: {
	runningMean?: boolean;
	minSamples?: number;
	higherIsBetter?: boolean;
	declaredArms?: string[];
	winner?: string | null;        // best_variant when criteria_met
	decided?: boolean;             // criteria_met
}): Evolution | null {
	const min = Math.max(1, opts.minSamples || 1);
	const better = (a: number, b: number) => (opts.higherIsBetter === false ? a < b : a > b);
	const all = series.flatMap((s) => toRunning(s, !!opts.runningMean)).sort((a, b) => a.t - b.t || a.arm.localeCompare(b.arm));
	if (all.length === 0) return null;
	for (const p of all) p.counted = p.n >= min;

	// Walk time; keep each arm's latest state; emit step points when the best
	// counted (or best overall) value changes.
	const latest = new Map<string, EvoPoint>();
	const best: StepPoint[] = [], frontier: StepPoint[] = [];
	const pick = (counted: boolean) => {
		let top: EvoPoint | null = null;
		for (const p of latest.values()) {
			if (counted && !p.counted) continue;
			if (!top || better(p.mean, top.mean)) top = p;
		}
		return top;
	};
	for (const p of all) {
		latest.set(p.arm, p);
		const b = pick(true), f = pick(false);
		if (b) {
			const last = best[best.length - 1];
			if (!last || last.arm !== b.arm || last.value !== b.mean) best.push({ t: p.t, arm: b.arm, value: b.mean });
		}
		if (f) {
			const last = frontier[frontier.length - 1];
			if (!last || last.arm !== f.arm || last.value !== f.mean) frontier.push({ t: p.t, arm: f.arm, value: f.mean });
		}
	}
	const hero = best.length ? { arm: best[best.length - 1].arm, value: best[best.length - 1].value } : null;
	const leader = frontier.length ? { arm: frontier[frontier.length - 1].arm, value: frontier[frontier.length - 1].value } : null;

	// Chain: order of first result; declared-but-silent versions at the end.
	const order: string[] = [];
	for (const p of all) if (!order.includes(p.arm)) order.push(p.arm);
	for (const a of opts.declaredArms || []) if (!order.includes(a)) order.push(a);
	const chain: ChainLink[] = order.map((arm, index) => {
		const l = latest.get(arm);
		let state: ChainState;
		if (!l) state = "not run yet";
		else if (opts.decided && opts.winner === arm) state = "winning";
		else if (opts.decided && opts.winner) state = "dropped";
		else if (!l.counted) state = "collecting";
		else if (hero?.arm === arm) state = "best so far";
		else state = "trying";
		return { arm, index, state, mean: l ? l.mean : null, n: l ? l.n : 0 };
	});
	return { points: all, best, frontier, hero, leader, chain, t0: all[0].t, t1: all[all.length - 1].t };
}
