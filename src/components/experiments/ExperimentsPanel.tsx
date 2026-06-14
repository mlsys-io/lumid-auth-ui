// ExperimentsPanel — observability for the xpio Experiments opinion:
// a hypothesis tested by rolling out variants over a dataset/casebook,
// measured by a metric.
//
// Card per experiment (hypothesis, metric, verdict, per-arm aggregates);
// expanding a card loads the detail: per-variant series chart, the
// CASEBOOK view (per-case score history from dims.case_id rows — the
// operator's "observability into the casebooks/metrics, not just run
// logs"), and a per-case drill of per-question latest scores.
// Honest empty states; no synthetic data, ever.

import { useCallback, useEffect, useState } from "react";
import {
	FlaskConical, ChevronDown, ChevronRight, Loader2, TrendingUp, TrendingDown,
} from "lucide-react";
import { me, type MeExperiment, type MeExperimentDetail, type MeExperimentCase } from "@/api/me";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
	regression: "regression",
	explore: "exploration",
	arms: "A/B arms",
};

function fmtV(v: number | null | undefined): string {
	if (v == null || Number.isNaN(v)) return "—";
	if (Number.isInteger(v)) return String(v);
	return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
}

function VerdictChip({ e }: { e: MeExperiment }) {
	if (e.status === "concluded" || e.status === "archived")
		return <span className="px-2 py-0.5 rounded-full text-[10px] border bg-slate-50 text-slate-500 border-slate-200">{e.status}</span>;
	if (e.criteria_met)
		return <span className="px-2 py-0.5 rounded-full text-[10px] border bg-amber-50 text-amber-700 border-amber-200 font-medium">criteria met</span>;
	return <span className="px-2 py-0.5 rounded-full text-[10px] border bg-violet-50 text-violet-700 border-violet-200">running</span>;
}

function DeltaChip({ e }: { e: MeExperiment }) {
	if (e.delta_pp == null || !e.best_variant) return null;
	const up = e.delta_pp >= 0;
	return (
		<span className={cn(
			"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border font-medium",
			up ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-rose-50 text-rose-700 border-rose-200",
		)}>
			{up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
			best vs baseline {e.delta_pp >= 0 ? "+" : ""}{e.delta_pp.toFixed(1)}pp
		</span>
	);
}

// Minimal inline sparkline (no deps): polyline over the points.
function Spark({ points, className }: { points: Array<{ ts: string; v: number }>; className?: string }) {
	if (!points || points.length < 2) return null;
	const vs = points.map((p) => p.v);
	const min = Math.min(...vs), max = Math.max(...vs);
	const span = max - min || 1;
	const W = 72, H = 18;
	const pts = points.map((p, i) =>
		`${(i / (points.length - 1)) * W},${H - ((p.v - min) / span) * (H - 2) - 1}`,
	).join(" ");
	return (
		<svg width={W} height={H} className={cn("flex-shrink-0", className)}>
			<polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500" />
		</svg>
	);
}

// Multi-variant line chart over result timestamps.
const SERIES_COLORS = ["#f59e0b", "#6366f1", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7"];
function SeriesChart({ series }: { series: MeExperimentDetail["series"] }) {
	const all = series.flatMap((s) => s.points.map((p) => p.v));
	if (all.length < 2) return null;
	const min = Math.min(...all), max = Math.max(...all);
	const span = max - min || 1;
	const W = 560, H = 120;
	return (
		<div className="overflow-x-auto">
			<svg width={W} height={H + 18} className="max-w-full">
				{series.map((s, si) => {
					if (s.points.length < 2) return null;
					const pts = s.points.map((p, i) =>
						`${(i / (s.points.length - 1)) * W},${H - ((p.v - min) / span) * (H - 8) - 4}`,
					).join(" ");
					return <polyline key={s.variant_id} points={pts} fill="none"
						stroke={SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth="1.5" />;
				})}
			</svg>
			<div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
				{series.map((s, si) => (
					<span key={s.variant_id} className="inline-flex items-center gap-1">
						<span className="w-2 h-2 rounded-full" style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }} />
						{s.variant_id}
					</span>
				))}
			</div>
		</div>
	);
}

// Casebook view — per-case score history + drill to per-question latest.
function CasesTable({ app, expId, cases }: { app: string; expId: string; cases: MeExperimentCase[] }) {
	const [open, setOpen] = useState<string | null>(null);
	const [drill, setDrill] = useState<Record<string, { ts: string; metrics: Record<string, number> }> | null>(null);
	const [loading, setLoading] = useState(false);
	const openCase = async (cid: string) => {
		if (open === cid) { setOpen(null); return; }
		setOpen(cid); setLoading(true); setDrill(null);
		try {
			const r = await me.experimentCase(app, expId, cid);
			setDrill(r.latest_by_question || {});
		} catch { setDrill({}); }
		setLoading(false);
	};
	return (
		<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
			{cases.map((c) => {
				const reg = (c.delta_vs_prev ?? 0) < 0;
				return (
					<div key={c.case_id}>
						<button type="button" onClick={() => openCase(c.case_id)}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 transition-colors">
							{open === c.case_id ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
							<span className="text-xs font-medium text-slate-700 flex-1 truncate">{c.case_id}</span>
							{reg && <span className="text-[9px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-1.5">regressed</span>}
							<span className="text-[11px] text-slate-500 tabular-nums">latest {fmtV(c.latest)}</span>
							<span className="text-[10px] text-slate-400 tabular-nums">·&nbsp;{c.n} runs</span>
							<Spark points={c.points} className={reg ? "text-rose-500" : undefined} />
						</button>
						{open === c.case_id && (
							<div className="px-9 pb-2.5 pt-0.5">
								{loading ? (
									<div className="text-[11px] text-slate-400 flex items-center gap-1.5 py-1"><Loader2 className="w-3 h-3 animate-spin" />reading case…</div>
								) : drill && Object.keys(drill).length > 0 ? (
									<table className="text-[11px] w-full">
										<tbody>
											{Object.entries(drill).sort(([a], [b]) => a.localeCompare(b)).map(([q, d]) => (
												<tr key={q} className="border-t border-slate-100 first:border-0">
													<td className="py-1 pr-3 text-slate-500 font-mono">{q}</td>
													<td className="py-1 text-slate-700 tabular-nums">
														{Object.entries(d.metrics).map(([k, v]) => `${k.replace(/_/g, " ")} ${fmtV(v)}`).join(" · ")}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								) : (
									<div className="text-[11px] text-slate-400 italic py-1">No per-question rows for this case yet.</div>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

export function ExperimentCard({ app, e, showApp = false }: { app: string; e: MeExperiment; showApp?: boolean }) {
	const [open, setOpen] = useState(false);
	const [detail, setDetail] = useState<MeExperimentDetail | null>(null);
	const [loading, setLoading] = useState(false);
	const toggle = useCallback(async () => {
		const next = !open;
		setOpen(next);
		if (next && !detail) {
			setLoading(true);
			try { setDetail(await me.experiment(app, e.id)); } catch { /* keep card */ }
			setLoading(false);
		}
	}, [open, detail, app, e.id]);

	const metricName = e.metric_name || e.metric?.name || "";
	const dir = (e.higher_is_better ?? e.metric?.higher_is_better ?? true) ? "higher is better" : "lower is better";
	const variants = Object.entries(e.variants || {});

	return (
		<div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
			<button type="button" onClick={toggle} className="w-full text-left px-4 py-3 hover:bg-slate-50/60 transition-colors">
				<div className="flex items-center gap-2 flex-wrap">
					<FlaskConical className="w-4 h-4 text-violet-500 flex-shrink-0" />
					<span className="text-sm font-semibold text-slate-900">{e.id.replace(/_/g, " ")}</span>
					{showApp && <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200/60">{app}</span>}
					<span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide bg-slate-100 text-slate-500">{KIND_LABEL[e.kind] || e.kind}</span>
					<VerdictChip e={e} />
					<DeltaChip e={e} />
					<span className="ml-auto text-[11px] text-slate-400 tabular-nums">{e.n_results} result{e.n_results === 1 ? "" : "s"}</span>
				</div>
				<div className="text-xs text-slate-600 mt-1">{e.hypothesis}</div>
				<div className="text-[10px] text-slate-400 mt-0.5">
					measures <span className="font-medium text-slate-500">{metricName.replace(/_/g, " ") || "?"}</span> ({dir})
					{e.dataset_id ? <> · over <span className="font-medium text-slate-500">{e.dataset_id}</span></> : null}
					{e.loops?.length ? <> · fed by {e.loops.join(", ")}</> : null}
				</div>
				{e.criteria_met && e.verdict && (
					<div className="mt-1.5 text-[11px] text-amber-700 bg-amber-50/70 border border-amber-200 rounded-lg px-2 py-1">✓ {e.verdict}</div>
				)}
			</button>

			{open && (
				<div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/40">
					{e.n_results === 0 ? (
						<div className="text-xs text-slate-500">
							Declared, no results yet — they land here when {e.loops?.length ? <span className="font-medium">{e.loops.join(", ")}</span> : "an attached workflow"} next runs.
						</div>
					) : loading ? (
						<div className="text-[11px] text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />loading results…</div>
					) : detail ? (
						<>
							{variants.length > 0 && (
								<div>
									<div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">Variants</div>
									<div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
										<table className="w-full text-[11px]">
											<thead>
												<tr className="text-left text-slate-400 border-b border-slate-100">
													<th className="px-3 py-1.5 font-medium">variant</th>
													<th className="px-2 py-1.5 font-medium text-right">mean</th>
													<th className="px-2 py-1.5 font-medium text-right">n</th>
													<th className="px-2 py-1.5 font-medium text-right">stdev</th>
													<th className="px-3 py-1.5 font-medium text-right">last</th>
												</tr>
											</thead>
											<tbody>
												{variants.sort((a, b) => (b[1].mean ?? 0) - (a[1].mean ?? 0)).map(([vid, agg]) => (
													<tr key={vid} className={cn("border-b border-slate-50 last:border-0", vid === e.best_variant && "bg-amber-50/50")}>
														<td className="px-3 py-1.5 text-slate-700 font-mono truncate max-w-[180px]">
															{vid}{vid === e.best_variant && <span className="ml-1.5 text-[9px] text-amber-600 font-sans font-medium">best</span>}
															{e.baseline === vid && <span className="ml-1.5 text-[9px] text-slate-400 font-sans">baseline</span>}
														</td>
														<td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">{fmtV(agg.mean)}</td>
														<td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{agg.n}</td>
														<td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{agg.stdev != null ? fmtV(agg.stdev) : "—"}</td>
														<td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{fmtV(agg.last)}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}
							{detail.series?.length > 0 && (
								<div>
									<div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">{metricName.replace(/_/g, " ")} over time</div>
									<SeriesChart series={detail.series} />
								</div>
							)}
							{detail.cases?.length > 0 && (
								<div>
									<div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">Casebook — per-case score history</div>
									<CasesTable app={app} expId={e.id} cases={detail.cases} />
								</div>
							)}
						</>
					) : (
						<div className="text-[11px] text-slate-400 italic">Couldn't load detail.</div>
					)}
				</div>
			)}
		</div>
	);
}

export default function ExperimentsPanel({ app }: { app: string }) {
	const [exps, setExps] = useState<MeExperiment[] | null>(null);
	useEffect(() => {
		let live = true;
		const load = () => me.experiments(app)
			.then((r) => { if (live) setExps(r.experiments || []); })
			.catch(() => { if (live) setExps([]); });
		load();
		const id = window.setInterval(load, 30_000);
		return () => { live = false; window.clearInterval(id); };
	}, [app]);

	if (exps === null) return <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />;
	if (exps.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-sm text-slate-500">
				No experiments declared. An experiment tests a hypothesis by running
				variants over a dataset or casebook, measured by one metric — declare
				one under <code className="text-[11px]">experiments:</code> in the app's config.
			</div>
		);
	}
	return (
		<div className="space-y-2.5">
			{exps.map((e) => <ExperimentCard key={e.id} app={app} e={e} />)}
		</div>
	);
}
