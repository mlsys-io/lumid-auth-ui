// MetricsView — the right-canvas detail for the "Metrics" data entry: a chart
// PER METRIC the workflow tracks, drawn as a curve over runs, with the current
// value + delta. The point at the pinned version is highlighted. Back returns to
// the trajectory.
//
// Metric DISCOVERY is generic + multi-source (no hardcoded metric names):
//   • casebook.metrics_evolution  — the casebook's own metric trends
//   • experiment.series           — each attached experiment's metric over time
//     (one curve per experiment, keyed by the experiment's metric name)
//   • recent cycles' summary.metrics — numeric KPIs the runner wrote into
//     cycle.json (so apps without experiments/casebooks still get charts)
// All three are merged by metric label into one small-multiples grid.

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, TrendingUp } from "lucide-react";
import { fetchCasebook, type CasebookMetricEvolution } from "@/api/casebook";
import { me } from "@/api/me";
import apiClient from "@/api/client";
import { cn } from "@/lib/utils";

const tsDigits = (s?: string) => (s || "").replace(/\D/g, "");
const betterDown = (m: string) => /loss|error|regress|drawdown|latency|cost|fail/i.test(m);
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(3)));

type Series = { metric: string; source: string; points: { ts: string; v: number }[] };

function Curve({ points, atTs }: { points: { ts: string; v: number }[]; atTs?: string }) {
	const W = 280, H = 60, PAD = 6;
	if (points.length === 0) return null;
	const vs = points.map((p) => p.v);
	const min = Math.min(...vs), max = Math.max(...vs);
	const span = max - min || 1;
	const n = points.length;
	const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
	const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
	const cut = atTs ? tsDigits(atTs) : "";
	const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
	return (
		<svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
			<path d={path} fill="none" stroke="rgb(176 143 69)" strokeWidth={1.75} />
			{points.map((p, i) => {
				const on = cut && tsDigits(p.ts) === cut;
				return <circle key={i} cx={x(i)} cy={y(p.v)} r={on ? 4 : 2.5} fill={on ? "rgb(150 119 58)" : "rgb(176 143 69)"} stroke={on ? "white" : "none"} strokeWidth={on ? 1.5 : 0} />;
			})}
		</svg>
	);
}

// Merge candidate series into one map by metric label, keeping the longest
// (richest) series when the same metric arrives from multiple sources.
function mergeSeries(parts: Series[]): Series[] {
	const by = new Map<string, Series>();
	for (const s of parts) {
		if (!s.points.length) continue;
		const key = s.metric.toLowerCase();
		const cur = by.get(key);
		if (!cur || s.points.length > cur.points.length) by.set(key, s);
	}
	return [...by.values()].sort((a, b) => a.metric.localeCompare(b.metric));
}

export default function MetricsView({ app, loop, atTs, onBack }: {
	app: string; loop: string; atTs?: string; onBack: () => void;
}) {
	const [series, setSeries] = useState<Series[] | null>(null);

	useEffect(() => {
		let live = true;
		setSeries(null);

		const fromCasebook = fetchCasebook(app, loop)
			.then((b): Series[] => (b.metrics_evolution ?? []).map((m: CasebookMetricEvolution) => ({ metric: m.metric, source: "casebook", points: m.points })))
			.catch(() => [] as Series[]);

		// Each attached experiment's metric series → one curve per experiment.
		const fromExperiments = me.experiments(app)
			.then(async ({ experiments }): Promise<Series[]> => {
				const attached = (experiments || []).filter((e) => !e.loops || e.loops.length === 0 || e.loops.includes(loop));
				const out: Series[] = [];
				for (const e of attached.slice(0, 8)) {
					const label = e.metric_name || e.metric?.name || e.id;
					try {
						const d = await me.experiment(app, e.id);
						// Collapse the per-variant series into one mean-per-ts curve so a
						// metric reads as a single trend (variant breakdown lives in the
						// Experiments surface).
						const byTs = new Map<string, { sum: number; n: number }>();
						for (const s of d.series || []) for (const p of s.points) {
							const cur = byTs.get(p.ts) || { sum: 0, n: 0 };
							cur.sum += p.v; cur.n += 1; byTs.set(p.ts, cur);
						}
						const points = [...byTs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ts, v]) => ({ ts, v: v.sum / v.n }));
						if (points.length) out.push({ metric: label, source: "experiment", points });
					} catch { /* skip this experiment */ }
				}
				return out;
			})
			.catch(() => [] as Series[]);

		// Recent cycles' numeric summary.metrics → per-key curve.
		const fromCycles = apiClient.get(`/api/v1/me/cycles?app=${encodeURIComponent(app)}&loop=${encodeURIComponent(loop)}&limit=20`)
			.then(async (list): Promise<Series[]> => {
				const cycles = ((list.data?.data?.cycles ?? []) as Array<{ ts: string }>)
					.filter((c) => c.ts).sort((a, b) => a.ts.localeCompare(b.ts)).slice(-12);
				const acc = new Map<string, { ts: string; v: number }[]>();
				for (const c of cycles) {
					try {
						const d = await me.cycleDetail(app, loop, c.ts);
						const m = (d.summary?.metrics ?? {}) as Record<string, unknown>;
						for (const [k, v] of Object.entries(m)) {
							if (typeof v !== "number" || !Number.isFinite(v)) continue;
							if (/^(xpio_ingested|auto_reflect)/.test(k)) continue; // bookkeeping noise
							const arr = acc.get(k) || [];
							arr.push({ ts: c.ts, v });
							acc.set(k, arr);
						}
					} catch { /* skip cycle */ }
				}
				return [...acc.entries()].filter(([, pts]) => pts.length >= 1).map(([k, points]) => ({ metric: k.replace(/_/g, " "), source: "cycle", points }));
			})
			.catch(() => [] as Series[]);

		Promise.all([fromCasebook, fromExperiments, fromCycles])
			.then((parts) => { if (live) setSeries(mergeSeries(parts.flat())); })
			.catch(() => { if (live) setSeries([]); });
		return () => { live = false; };
	}, [app, loop]);

	return (
		<div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden animate-in fade-in duration-200">
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Trajectory</button>
				<div className="flex items-center gap-1.5 min-w-0">
					<TrendingUp className="w-3.5 h-3.5 text-gold-500 flex-shrink-0" />
					<span className="text-sm font-medium text-slate-900">Metrics</span>
					<span className="text-[11px] text-slate-400 truncate">· every metric this workflow tracks, over its runs</span>
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto p-3">
				{series === null ? (
					<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Discovering metrics…</div>
				) : series.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400"><TrendingUp className="w-6 h-6 text-slate-300" /><div className="text-sm text-slate-500">No metric history yet.</div><div className="text-xs max-w-xs">Metrics appear here once this workflow logs numeric scores in its cycles or experiments.</div></div>
				) : (
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
						{series.map((s) => {
							const vs = s.points.map((p) => p.v);
							const last = vs[vs.length - 1];
							const delta = vs.length >= 2 ? last - vs[0] : 0;
							const good = betterDown(s.metric) ? delta < 0 : delta > 0;
							return (
								<div key={`${s.source}:${s.metric}`} className="rounded-xl border border-slate-200 bg-white p-3">
									<div className="flex items-baseline gap-2 mb-1">
										<span className="text-[12px] font-medium text-slate-700 flex-1 truncate" title={`${s.metric} · ${s.source}`}>{s.metric}</span>
										<span className="text-[15px] font-semibold tabular-nums text-slate-900">{num(last)}</span>
										{Math.abs(delta) > 1e-6 && (
											<span className={cn("text-[11px] tabular-nums", good ? "text-gold-600" : "text-rose-500")}>{delta > 0 ? "+" : ""}{num(delta)}</span>
										)}
									</div>
									<Curve points={s.points} atTs={atTs} />
									<div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
										<span>{s.points.length} run{s.points.length === 1 ? "" : "s"}</span>
										<span className="uppercase tracking-wide">{s.source}</span>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
