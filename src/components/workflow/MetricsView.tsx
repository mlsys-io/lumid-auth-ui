// MetricsView — the right-canvas detail for the "Metrics" data entry: each
// goal metric the workflow tracks, drawn as a curve over runs, with the
// current value + delta. The point at the pinned version is highlighted.
// Loop-scoped (metrics are workflow-bound). Back returns to the trajectory.

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, TrendingUp } from "lucide-react";
import { fetchCasebook, type CasebookMetricEvolution } from "@/api/casebook";
import { cn } from "@/lib/utils";

const tsDigits = (s?: string) => (s || "").replace(/\D/g, "");
const betterDown = (m: string) => /loss|error|regress|drawdown|latency|cost/i.test(m);
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(3)));

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

export default function MetricsView({ app, loop, atTs, onBack }: {
	app: string; loop: string; atTs?: string; onBack: () => void;
}) {
	const [series, setSeries] = useState<CasebookMetricEvolution[] | null>(null);
	useEffect(() => {
		let live = true;
		setSeries(null);
		fetchCasebook(app, loop).then((b) => { if (live) setSeries(b.metrics_evolution ?? []); }).catch(() => { if (live) setSeries([]); });
		return () => { live = false; };
	}, [app, loop]);

	return (
		<div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden animate-in fade-in duration-200">
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Trajectory</button>
				<div className="flex items-center gap-1.5 min-w-0">
					<TrendingUp className="w-3.5 h-3.5 text-gold-500 flex-shrink-0" />
					<span className="text-sm font-medium text-slate-900">Metrics</span>
					<span className="text-[11px] text-slate-400 truncate">· scored on the data each run</span>
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto p-3">
				{series === null ? (
					<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading metrics…</div>
				) : series.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400"><TrendingUp className="w-6 h-6 text-slate-300" /><div className="text-sm text-slate-500">No metric history yet.</div></div>
				) : (
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
						{series.map((s) => {
							const vs = s.points.map((p) => p.v);
							const last = vs[vs.length - 1];
							const delta = vs.length >= 2 ? last - vs[0] : 0;
							const good = betterDown(s.metric) ? delta < 0 : delta > 0;
							return (
								<div key={s.metric} className="rounded-xl border border-slate-200 bg-white p-3">
									<div className="flex items-baseline gap-2 mb-1">
										<span className="text-[12px] font-medium text-slate-700 flex-1 truncate" title={s.metric}>{s.metric}</span>
										<span className="text-[15px] font-semibold tabular-nums text-slate-900">{num(last)}</span>
										{Math.abs(delta) > 1e-6 && (
											<span className={cn("text-[11px] tabular-nums", good ? "text-gold-600" : "text-rose-500")}>{delta > 0 ? "+" : ""}{num(delta)}</span>
										)}
									</div>
									<Curve points={s.points} atTs={atTs} />
									<div className="mt-1 text-[10px] text-slate-400 tabular-nums">{s.points.length} run{s.points.length === 1 ? "" : "s"}</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
