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
