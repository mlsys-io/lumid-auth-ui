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
import { SpiralOverlay } from "@/components/BrandLoader";
import {
	FlaskConical, ChevronDown, ChevronRight, Loader2, TrendingUp, TrendingDown,
} from "lucide-react";
import { me, waitForIntent, type MeExperiment, type MeExperimentArm, type MeExperimentDetail, type MeExperimentCase } from "@/api/me";
import { askOrStash } from "@/components/chat/askBus";
import { fetchCasebook } from "@/api/casebook";
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
		return <span className="px-2 py-0.5 rounded-full text-[10px] border bg-gold-50 text-gold-700 border-gold-200 font-medium">criteria met</span>;
	// "running" on an experiment with zero results claimed activity where
	// there was none — an active declaration with no rows is collecting,
	// not running.
	if (!e.n_results)
		return <span className="px-2 py-0.5 rounded-full text-[10px] border bg-slate-50 text-slate-500 border-slate-200">no results yet</span>;
	return <span className="px-2 py-0.5 rounded-full text-[10px] border bg-violet-50 text-violet-700 border-violet-200">collecting</span>;
}

function DeltaChip({ e }: { e: MeExperiment }) {
	if (e.delta_pp == null || !e.best_variant) return null;
	const up = e.delta_pp >= 0;
	return (
		<span className={cn(
			"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border font-medium",
			up ? "bg-gold-50 text-gold-700 border-gold-200" : "bg-rose-50 text-rose-700 border-rose-200",
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
			<polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gold-500" />
		</svg>
	);
}

// Multi-variant line chart over result timestamps.
const SERIES_COLORS = ["#B08F45", "#6366f1", "#B08F45", "#ef4444", "#0ea5e9", "#a855f7"];
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
// `loop` lets us look up the full casebook size (the denominator) so a partial
// run reads as "N of <total>" rather than just the scored rows.
function CasesTable({ app, expId, loop, cases }: { app: string; expId: string; loop?: string; cases: MeExperimentCase[] }) {
	const [open, setOpen] = useState<string | null>(null);
	const [drill, setDrill] = useState<Record<string, { ts: string; metrics: Record<string, number> }> | null>(null);
	const [loading, setLoading] = useState(false);
	// Casebook total (denominator). Generic: the casebook endpoint returns the
	// full cases[] for this app+loop; its length is the casebook size. null until
	// loaded / when no loop is known — then we fall back to distinct case_ids seen.
	const [bookTotal, setBookTotal] = useState<number | null>(null);
	useEffect(() => {
		if (!loop) { setBookTotal(null); return; }
		let live = true;
		fetchCasebook(app, loop)
			.then((b) => { if (live) setBookTotal((b.cases ?? []).length); })
			.catch(() => { if (live) setBookTotal(null); });
		return () => { live = false; };
	}, [app, loop]);
	// scored = cases with ≥1 result (a recorded run). total = casebook size when
	// known, else the distinct case_ids that have results (so the header is never
	// a lie about a denominator we couldn't read).
	const scored = cases.filter((c) => c.n > 0).length;
	const total = bookTotal != null && bookTotal >= scored ? bookTotal : cases.length;
	const totalKnown = bookTotal != null && bookTotal >= scored;
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
		<>
		<div className="text-[11px] text-slate-400 mb-1.5">
			{scored} of {total} case{total === 1 ? "" : "s"} scored{!totalKnown ? " so far" : ""}
		</div>
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
		</>
	);
}

// ── declared arms + dispatch ────────────────────────────────────────────────
//
// `e.variants` is what has been OBSERVED; `e.arms` is what the app DECLARED. An
// arm in the second and not the first has never run — and until identity
// started emitting `arms`, it was invisible: nothing could show it, let alone
// offer to run it.
//
// Dispatch goes through the SAME path as everything else (enqueue_runs intent →
// the app's own run queue → the scheduler's drain), so the queue's back-pressure
// applies and a chat dispatch and a click land identically.
function ArmsBlock({ app, e }: { app: string; e: MeExperiment }) {
	const [busy, setBusy] = useState<string | null>(null);
	const [sent, setSent] = useState<Record<string, string>>({});
	const [err, setErr] = useState<string | null>(null);
	const arms = e.arms || [];
	// An experiment attached to no loop has nowhere to dispatch to. Say so
	// rather than offering a button that can only 400. When several loops feed
	// one experiment, the declaration's dispatch.loop picks the one that is
	// self-sufficient for a button (it must still be ATTACHED — a hint naming
	// a foreign loop is ignored, matching resolveExperimentArm server-side).
	const hinted = e.dispatch?.loop;
	const loop = (hinted && e.loops?.includes(hinted) ? hinted : e.loops?.[0]) || "";
	// dispatch.ask means the run needs a SUBJECT this button cannot know
	// (which strategy, which case). The surface shows; the chat acts — hand
	// the dispatch to the rail with the app's own question instead of firing
	// a run that returns "strategy is empty" and measures nothing.
	const needsSubject = !!e.dispatch?.ask;

	const run = useCallback(async (armId: string, cfg: MeExperimentArm) => {
		if (!loop) return;
		if (needsSubject) {
			askOrStash({
				prompt: `Dispatch arm "${armId}" of experiment "${e.id}" on ${app} `
					+ `(loop ${loop}) with dispatch_experiment_arm. ${e.dispatch?.ask} `
					+ `Ask me for anything you don't know, then queue it and tell me the intent id.`,
				context: { page: "experiments", app, loop },
			});
			setSent((p) => ({ ...p, [armId]: "chat" }));
			return;
		}
		setBusy(armId); setErr(null);
		try {
			const { id: _id, description: _d, ...overrides } = cfg;
			// `{...overrides, arm: id}` is the shape _variant.resolve() consumes:
			// the arm's config plus the NAME, which is what evaluate() aggregates
			// on and what `baseline: {arm: <id>}` matches.
			const r = await me.enqueueRuns(app, loop, {
				variants: [{ ...overrides, arm: armId }],
				branch_label: armId,
				priority: 50,
			});
			setSent((p) => ({ ...p, [armId]: r.intent_id }));
			// Report what the runner did, not what we asked for — identity
			// accepts the batch, the scheduler performs it.
			waitForIntent(r.intent_id, { timeoutMs: 90_000 })
				.then((res) => {
					const out = (res.result || {}) as Record<string, unknown>;
					if (out.ok === false) setErr(String(out.error || "dispatch failed"));
				})
				.catch(() => { /* still queued; the ledger will show it */ });
		} catch (ex) {
			setErr(ex instanceof Error ? ex.message : String(ex));
		} finally {
			setBusy(null);
		}
	}, [app, loop, needsSubject, e.id, e.dispatch?.ask]);

	if (arms.length === 0) return null;
	return (
		<div>
			<div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">Declared arms</div>
			<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-50">
				{arms.map((a) => {
					const id = String(a.id);
					const seen = (e.variants || {})[id];
					const isBaseline = e.baseline === id;
					// An arm with no config beyond its own name is a LABEL for
					// "whatever the app does by default", not a runnable
					// configuration — dispatching it just runs the loop with no
					// arguments. quant-research's `current` arm is exactly this:
					// firing it produced "strategy is empty", a button that could
					// never succeed. Such experiments are measured PASSIVELY, from
					// the runs users already make (record_result on the loop's own
					// path), so show the arm and withhold the button.
					const runnable = Object.keys(a).some((k) => k !== "id" && k !== "description");
					return (
						<div key={id} className="flex items-center gap-2 px-3 py-2">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="text-[11px] font-mono text-slate-700 truncate">{id}</span>
									{isBaseline && <span className="text-[9px] text-slate-400">baseline</span>}
									{seen
										? <span className="text-[9px] text-slate-400 tabular-nums">· {seen.n} run{seen.n === 1 ? "" : "s"}</span>
										: <span className="text-[9px] text-violet-600">· never run</span>}
								</div>
								{a.description && <div className="text-[10px] text-slate-400 truncate">{String(a.description)}</div>}
							</div>
							{!runnable ? (
								<span className="text-[10px] text-slate-400 whitespace-nowrap"
									title="This arm declares no configuration to apply, so there is nothing to dispatch — it is measured from the runs you already make.">
									measured passively
								</span>
							) : sent[id] ? (
								<span className="text-[10px] text-emerald-600 whitespace-nowrap">
									{sent[id] === "chat" ? "in the chat →" : "queued ✓"}
								</span>
							) : (
								<button
									type="button"
									disabled={!loop || busy === id}
									onClick={() => run(id, a)}
									title={!loop
										? "This experiment is attached to no workflow, so there is nowhere to dispatch it"
										: needsSubject
											? "This run needs a subject the button cannot know — the chat asks, then dispatches"
											: `Runs one cycle of ${loop} with this arm applied`}
									className={cn(
										"px-2 py-1 rounded-md text-[10px] font-medium border whitespace-nowrap transition-colors",
										loop
											? "border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100"
											: "border-slate-200 text-slate-300 bg-slate-50 cursor-not-allowed",
									)}
								>
									{busy === id ? "queueing…" : needsSubject ? "Run via chat" : seen ? "Run 1 more" : "Run this arm"}
								</button>
							)}
						</div>
					);
				})}
			</div>
			{!loop && (
				<div className="mt-1 text-[10px] text-amber-700">
					Attached to no workflow — declare it under a loop's <span className="font-mono">engine.experiment</span> before it can be dispatched.
				</div>
			)}
			{err && <div className="mt-1 text-[10px] text-rose-600">{err}</div>}
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
					{/* Arms live in the EXPANDED body; without this chip a collapsed
					    card gives no sign runnable arms are inside — the dispatch
					    affordance was invisible until a speculative click. */}
					{(e.arms?.length ?? 0) > 0 && (() => {
						const neverRun = (e.arms || []).filter((a) => !(e.variants || {})[String(a.id)]).length;
						return (
							<span className="px-1.5 py-0.5 rounded-full text-[10px] border bg-violet-50/60 text-violet-700 border-violet-200/60 tabular-nums">
								{e.arms!.length} arm{e.arms!.length === 1 ? "" : "s"}{neverRun > 0 ? ` · ${neverRun} never run` : ""}
							</span>
						);
					})()}
					<span className="ml-auto text-[11px] text-slate-400 tabular-nums">{e.n_results} result{e.n_results === 1 ? "" : "s"}</span>
				</div>
				<div className="text-xs text-slate-600 mt-1">{e.hypothesis}</div>
				<div className="text-[10px] text-slate-400 mt-0.5">
					measures <span className="font-medium text-slate-500">{metricName.replace(/_/g, " ") || "?"}</span> ({dir})
					{e.dataset_id ? <> · over <span className="font-medium text-slate-500">{e.dataset_id}</span></> : null}
					{e.loops?.length ? <> · fed by {e.loops.join(", ")}</> : null}
				</div>
				{e.criteria_met && e.verdict && (
					<div className="mt-1.5 text-[11px] text-gold-700 bg-gold-50/70 border border-gold-200 rounded-lg px-2 py-1">✓ {e.verdict}</div>
				)}
			</button>

			{open && (
				<div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/40">
					{/* Not-comparable is a fact about the INSTRUMENT and outranks
					    any per-arm number below it, so it goes first. */}
					{e.comparable === false && (
						<div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
							<span className="font-medium">Not a verdict.</span> These arms were measured under{" "}
							{e.instruments ?? "several"} different instruments
							{e.compare_within?.length ? <> (<span className="font-mono">{e.compare_within.join(", ")}</span>)</> : null}
							, so a ranking would measure the instrument as much as the arm. The per-arm means below still hold.
						</div>
					)}
					{/* Arms render whether or not anything has run — a never-run arm
					    is exactly the one worth offering to dispatch. */}
					<ArmsBlock app={app} e={e} />
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
									<div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 mb-1.5">Experiments</div>
									<div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
										<table className="w-full text-[11px]">
											<thead>
												<tr className="text-left text-slate-400 border-b border-slate-100">
													<th className="px-3 py-1.5 font-medium">experiment</th>
													<th className="px-2 py-1.5 font-medium text-right">mean</th>
													<th className="px-2 py-1.5 font-medium text-right">n</th>
													<th className="px-2 py-1.5 font-medium text-right">stdev</th>
													<th className="px-3 py-1.5 font-medium text-right">last</th>
												</tr>
											</thead>
											<tbody>
												{variants.sort((a, b) => (b[1].mean ?? 0) - (a[1].mean ?? 0)).map(([vid, agg]) => (
													<tr key={vid} className={cn("border-b border-slate-50 last:border-0", vid === e.best_variant && "bg-gold-50/50")}>
														<td className="px-3 py-1.5 text-slate-700 font-mono truncate max-w-[180px]">
															{vid}{vid === e.best_variant && <span className="ml-1.5 text-[9px] text-gold-600 font-sans font-medium">best</span>}
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
									<CasesTable app={app} expId={e.id} loop={e.loops?.[0]} cases={detail.cases} />
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

// `loop` narrows to the experiments a single workflow feeds — how the
// workflow observability panel renders "Metric & arms" IN PLACE on the loop
// that owns them, instead of a separate Experiments page. When the filter
// leaves nothing, render nothing: on a loop page an empty state would just be
// noise under the runs (`quiet` skips the declare-one hint for the same
// reason).
export default function ExperimentsPanel({ app, loop, quiet = false }: {
	app: string; loop?: string; quiet?: boolean;
}) {
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

	if (exps === null) {
		if (quiet) return null;
		return <div className="relative"><div className="h-20 rounded-xl bg-slate-100 animate-pulse" /><SpiralOverlay /></div>;
	}
	const shown = loop ? exps.filter((e) => e.loops?.includes(loop)) : exps;
	if (shown.length === 0) {
		if (quiet || loop) return null;
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
			{shown.map((e) => <ExperimentCard key={e.id} app={app} e={e} />)}
		</div>
	);
}
