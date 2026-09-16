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
import { me, waitForIntent, MeApiError, type MeExperiment, type MeExperimentArm, type MeExperimentDetail, type MeExperimentCase } from "@/api/me";
import { askOrStash } from "@/components/chat/askBus";
import { fetchCasebook } from "@/api/casebook";
import { cn } from "@/lib/utils";
import NewExperiment from "./NewExperiment";

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

/** "4d" / "3h" / "just now" — how old the SERVED state is.
 *
 * evaluate() runs once per loop RUN, so a quiet experiment serves a number that
 * is arbitrarily old and nothing said so. Measured 2026-09-09: a panel and a
 * chat both quoted a four-day-old figure as current. */
function ageOf(iso: string): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return "";
	const s = (Date.now() - t) / 1000;
	if (s < 120) return "just now";
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
}

/** One arm's difference from the best arm, with its interval.
 *
 * Greyed when the interval crosses zero — that arm is NOT separable from the
 * winner, and the doc had to say so in prose because the card could not. The
 * tooltip carries what the number is made of: paired or not, how many units,
 * and how many pairs it would take to resolve a difference this size (usually
 * the number that argues against running more).
 */
function DeltaVsBest({ e, vid }: { e: MeExperiment; vid: string }) {
	const best = e.best_variant;
	if (!best || !e.pairwise?.length) return <td className="px-2 py-1.5 text-right text-slate-400">—</td>;
	if (vid === best) return <td className="px-2 py-1.5 text-right text-slate-400">—</td>;
	const direct = e.pairwise.find((p) => p.a === vid && p.b === best);
	const flip = e.pairwise.find((p) => p.a === best && p.b === vid);
	const p = direct ?? flip;
	if (!p) return <td className="px-2 py-1.5 text-right text-slate-400">—</td>;
	const sign = direct ? 1 : -1;
	const d = p.delta * sign;
	const ci = p.ci95 ? ([p.ci95[0] * sign, p.ci95[1] * sign].sort((x, y) => x - y) as [number, number]) : null;
	const tip = [
		ci ? `95% CI [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]` : null,
		p.paired ? `paired over ${p.n_pairs} shared units` : "unpaired" + (p.pairs_available ? ` (${p.pairs_available} shared units, but the unpaired estimate is tighter)` : ""),
		p.separated ? null : "not separable from the best arm",
		p.n_for_80pct_power && !p.separated ? `~${p.n_for_80pct_power} pairs would be needed to resolve a difference this size` : null,
	].filter(Boolean).join(" · ");
	return (
		<td className={cn("px-2 py-1.5 text-right tabular-nums", p.separated ? "text-slate-700" : "text-slate-400")} title={tip}>
			{d >= 0 ? "+" : ""}{fmtV(d)}
			{!p.separated && <span className="ml-1 text-[10px]">ns</span>}
		</td>
	);
}

/** The lifecycle controls, as one menu.
 *
 * conclude / checkpoint / fork / revert existed only in chat: the card could
 * READ `status: concluded|archived` and nothing could write it, so an
 * experiment that was finished stayed "collecting" forever — while the cycle
 * hook emitted an offer saying "Consider promoting the winning variant or
 * concluding the experiment", naming an action no button could reach.
 *
 * One overflow, not a row of buttons: these are rare, deliberate acts and a
 * card is not a toolbar.
 */
function ControlMenu({ app, e, onDone }: { app: string; e: MeExperiment; onDone: () => void }) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState("");
	const [err, setErr] = useState("");

	const run = useCallback(async (op: Parameters<typeof me.experimentControl>[2]["op"], extra?: Record<string, string>) => {
		setErr(""); setBusy(op);
		try {
			// A checkpoint FENCES every row measured so far out of the
			// comparison — rows stay on disk, they stop counting. Asking for the
			// reason here is not politeness: the two apps doing this by hand had
			// to write paragraphs of YAML comments to make it readable later.
			if (op === "checkpoint") {
				const reason = window.prompt(
					"Why? A checkpoint stops everything measured so far from counting toward the " +
					"comparison (the rows stay). The reason is recorded beside them.");
				if (!reason?.trim()) { setBusy(""); return; }
				extra = { ...extra, reason: reason.trim() };
			}
			if (op === "fork") {
				const id = window.prompt("New experiment id — the original is left untouched.");
				if (!id?.trim()) { setBusy(""); return; }
				extra = { ...extra, new_id: id.trim() };
			}
			const r = await me.experimentControl(app, e.id, { op, ...extra });
			if (r.intent_id) await waitForIntent(r.intent_id, { timeoutMs: 60_000 });
			setOpen(false); onDone();
		} catch (ex) {
			setErr(ex instanceof MeApiError ? ex.message : String(ex));
		} finally { setBusy(""); }
	}, [app, e.id, onDone]);

	const terminal = e.status === "concluded" || e.status === "archived";
	const items: Array<[string, string, () => void]> = terminal
		? [["Reopen", "back to collecting", () => run("reopen")]]
		: [
			["Conclude", "done — record the verdict", () => run("conclude")],
			["Archive", "done and out of the way", () => run("archive")],
			["Checkpoint…", "fence the rows so far; they stay on disk", () => run("checkpoint")],
			["Fork…", "same metric and scope, new arms, original untouched", () => run("fork")],
		];
	items.push(["Revert", "restore the definition before the last change", () => run("revert")]);

	return (
		<div className="relative">
			<button type="button" aria-label="experiment controls"
				onClick={(ev) => { ev.stopPropagation(); setOpen((o) => !o); }}
				className="px-1.5 py-0.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 leading-none">⋯</button>
			{open && (
				<div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white shadow-lg py-1"
					onClick={(ev) => ev.stopPropagation()}>
					{items.map(([label, hint, fn]) => (
						<button key={label} type="button" disabled={!!busy} onClick={fn}
							className="w-full text-left px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50">
							<div className="text-[12px] text-slate-800">{busy === label.toLowerCase().replace("…", "") ? "working…" : label}</div>
							<div className="text-[11px] text-slate-500">{hint}</div>
						</button>
					))}
					{err && <div className="px-3 py-1.5 text-[11px] text-rose-600">{err}</div>}
				</div>
			)}
		</div>
	);
}

function VerdictChip({ e }: { e: MeExperiment }) {
	if (e.status === "concluded" || e.status === "archived")
		return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-slate-50 text-slate-700 border-slate-200">{e.status}</span>;
	if (e.criteria_met)
		return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-gold-50 text-gold-700 border-gold-200 font-medium">criteria met</span>;
	// "running" on an experiment with zero results claimed activity where
	// there was none — an active declaration with no rows is collecting,
	// not running.
	// A metric that matches nothing is not "no results yet" — that phrasing
	// reads as patience being the fix, and it is not.
	if (!e.n_results && e.n_zero_reason)
		return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-amber-50 text-amber-800 border-amber-200 font-medium" title={e.n_zero_reason}>metric mismatch</span>;
	if (!e.n_results)
		return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-slate-50 text-slate-700 border-slate-200">no results yet</span>;
	return <span className="px-2 py-0.5 rounded-full text-[11px] border bg-violet-50 text-violet-700 border-violet-200">collecting</span>;
}

function DeltaChip({ e }: { e: MeExperiment }) {
	if (e.delta_pp == null || !e.best_variant) return null;
	const up = e.delta_pp >= 0;
	return (
		<span className={cn(
			"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border font-medium",
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
			<div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
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
		<div className="text-[11px] text-slate-600 mb-1.5">
			{scored} of {total} case{total === 1 ? "" : "s"} scored{!totalKnown ? " so far" : ""}
		</div>
		<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
			{cases.map((c) => {
				const reg = (c.delta_vs_prev ?? 0) < 0;
				return (
					<div key={c.case_id}>
						<button type="button" onClick={() => openCase(c.case_id)}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 transition-colors">
							{open === c.case_id ? <ChevronDown className="w-3.5 h-3.5 text-slate-600" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
							<span className="text-xs font-medium text-slate-700 flex-1 truncate">{c.case_id}</span>
							{reg && <span className="text-[11px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-1.5">regressed</span>}
							<span className="text-[11px] text-slate-600 tabular-nums">latest {fmtV(c.latest)}</span>
							<span className="text-[11px] text-slate-600 tabular-nums">·&nbsp;{c.n} runs</span>
							<Spark points={c.points} className={reg ? "text-rose-500" : undefined} />
						</button>
						{open === c.case_id && (
							<div className="px-9 pb-2.5 pt-0.5">
								{loading ? (
									<div className="text-[11px] text-slate-600 flex items-center gap-1.5 py-1"><Loader2 className="w-3 h-3 animate-spin" />reading case…</div>
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
									<div className="text-[11px] text-slate-600 italic py-1">No per-question rows for this case yet.</div>
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
				// Attribute the run to THIS experiment, exactly as the chat's
				// dispatch_experiment_arm does. Without it identity queues
				// `experiment: null` and the arm's run is orphaned from the
				// study — measured 2026-09-09 dispatching panel_median3.
				experiment_id: e.id,
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
			<div className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 mb-1.5">Declared arms</div>
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
									{isBaseline && <span className="text-[11px] text-slate-600">baseline</span>}
									{seen
										? <span className="text-[11px] text-slate-600 tabular-nums">· {seen.n} run{seen.n === 1 ? "" : "s"}</span>
										: <span className="text-[11px] text-violet-600">· never run</span>}
								</div>
								{a.description && <div className="text-[11px] text-slate-600 truncate">{String(a.description)}</div>}
							</div>
							{!runnable ? (
								<span className="text-[11px] text-slate-600 whitespace-nowrap"
									title="This arm declares no configuration to apply, so there is nothing to dispatch — it is measured from the runs you already make.">
									measured passively
								</span>
							) : sent[id] ? (
								<span className="text-[11px] text-emerald-600 whitespace-nowrap">
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
										"px-2 py-1 rounded-md text-[11px] font-medium border whitespace-nowrap transition-colors",
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
				<div className="mt-1 text-[11px] text-amber-700">
					Attached to no workflow — declare it under a loop's <span className="font-mono">engine.experiment</span> before it can be dispatched.
				</div>
			)}
			{err && <div className="mt-1 text-[11px] text-rose-600">{err}</div>}
		</div>
	);
}

export function ExperimentCard({ app, e, showApp = false, onChanged }: { app: string; e: MeExperiment; showApp?: boolean; onChanged?: () => void }) {
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
					{showApp && <span className="px-1.5 py-0.5 rounded text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200/60">{app}</span>}
					<span className="px-1.5 py-0.5 rounded text-[11px] uppercase tracking-wide bg-slate-100 text-slate-700">{KIND_LABEL[e.kind] || e.kind}</span>
					<VerdictChip e={e} />
					<DeltaChip e={e} />
					{/* Arms live in the EXPANDED body; without this chip a collapsed
					    card gives no sign runnable arms are inside — the dispatch
					    affordance was invisible until a speculative click. */}
					{(e.arms?.length ?? 0) > 0 && (() => {
						const neverRun = (e.arms || []).filter((a) => !(e.variants || {})[String(a.id)]).length;
						return (
							<span className="px-1.5 py-0.5 rounded-full text-[11px] border bg-violet-50/60 text-violet-700 border-violet-200/60 tabular-nums">
								{e.arms!.length} arm{e.arms!.length === 1 ? "" : "s"}{neverRun > 0 ? ` · ${neverRun} never run` : ""}
							</span>
						);
					})()}
					{/* "266 of 285 rows" when some carried no declared metric. The
					    drop was invisible: n_zero_reason only ever fired when EVERY
					    row was dropped, and across the estate 364 of 1,558 rows do
					    not count. Same chip, one more fact — not a new element. */}
					<span
						className="ml-auto text-[11px] text-slate-600 tabular-nums"
						title={(e.rows_dropped && e.metric_keys_seen?.length)
							? `${e.rows_dropped} row(s) carry no "${metricName}". Keys emitted: ${e.metric_keys_seen.join(", ")}`
							: undefined}
					>
						{e.rows_dropped
							? <>{e.n_results} of {e.n_rows_total} rows</>
							: <>{e.n_results} result{e.n_results === 1 ? "" : "s"}</>}
					</span>
					<ControlMenu app={app} e={e} onDone={onChanged ?? (() => {})} />
				</div>
				<div className="text-xs text-slate-600 mt-1">{e.hypothesis}</div>
				<div className="text-[11px] text-slate-600 mt-0.5">
					measures <span className="font-medium text-slate-500">{metricName.replace(/_/g, " ") || "?"}</span> ({dir})
					{e.dataset_id ? <> · over <span className="font-medium text-slate-500">{e.dataset_id}</span></> : null}
					{e.loops?.length ? <> · fed by {e.loops.join(", ")}</> : null}
				</div>
				{e.criteria_met && e.verdict && (
					<div className="mt-1.5 text-[11px] text-gold-700 bg-gold-50/70 border border-gold-200 rounded-lg px-2 py-1">✓ {e.verdict}</div>
				)}
				{/* WHY IT IS NOT CONCLUDING — the sentence the backend already
				    computes and the card threw away. "below min_samples (3/10)",
				    "criteria expression unevaluable", "not separable — X leads Y
				    by … but the interval crosses zero". Without it the card shows
				    a state and no reason, and the reason is the only actionable
				    half. One line, no new section; success_criteria rides in the
				    tooltip rather than taking a row of its own. */}
				{!e.criteria_met && e.criteria_reason && e.n_results > 0 && (
					<div className="mt-1 text-[11px] text-slate-600 flex items-baseline gap-1.5">
						<span className="text-slate-400 flex-shrink-0">why</span>
						<span className="truncate" title={e.success_criteria ? `success_criteria: ${e.success_criteria}` : undefined}>
							{e.criteria_reason}
						</span>
						{e.state_updated_at && (
							<span className="ml-auto flex-shrink-0 text-slate-400 tabular-nums" title={`state computed ${e.state_updated_at}`}>
								{ageOf(e.state_updated_at)}
							</span>
						)}
					</div>
				)}
				{(e.not_separable_from?.length ?? 0) > 0 && e.best_variant && (
					<div className="mt-1 text-[11px] text-amber-700">
						leading, but not separable from {e.not_separable_from!.join(", ")}
					</div>
				)}
			</button>

			{open && (
				<div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/40">
					{(e.undeclared_variants?.length ?? 0) > 0 && (
						<div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900">
							<span className="font-semibold">Rows from arms this experiment does not declare:</span>{" "}
							{e.undeclared_variants!.map((v) => <code key={v} className="px-1 rounded bg-white/70 border border-amber-200 mx-0.5">{v}</code>)}
							<div className="mt-0.5">
								Their means are facts and stay below. They cannot win — "best" is a
								claim about the arms the experiment declared.
							</div>
						</div>
					)}
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
						/* Two different zeroes. "Never ran" is a waiting message;
						   "rows exist but carry other keys" is a BUG that no amount
						   of waiting fixes, and telling them apart used to require
						   reading results.jsonl by hand. */
						e.n_zero_reason ? (
							<div className="text-xs rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
								<div className="font-medium">No results, and waiting will not help.</div>
								<div className="mt-0.5">{e.n_zero_reason}</div>
								{e.metric_keys_seen?.length ? (
									<div className="mt-1.5 flex flex-wrap items-center gap-1">
										<span className="text-[11px] text-amber-800">keys actually emitted:</span>
										{e.metric_keys_seen.map((k) => (
											<code key={k} className="px-1.5 py-0.5 rounded bg-white/70 border border-amber-200 text-[11px]">{k}</code>
										))}
									</div>
								) : null}
							</div>
						) : (
							<div className="text-xs text-slate-500">
								Declared, no results yet — they land here when {e.loops?.length ? <span className="font-medium">{e.loops.join(", ")}</span> : "an attached workflow"} next runs.
							</div>
						)
					) : loading ? (
						<div className="text-[11px] text-slate-600 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />loading results…</div>
					) : detail ? (
						<>
							{variants.length > 0 && (
								<div>
									<div className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 mb-1.5">Experiments</div>
									<div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
										<table className="w-full text-[11px]">
											<thead>
												<tr className="text-left text-slate-600 border-b border-slate-100">
													<th className="px-3 py-1.5 font-medium">experiment</th>
													<th className="px-2 py-1.5 font-medium text-right">mean</th>
													<th className="px-2 py-1.5 font-medium text-right">n</th>
													<th className="px-2 py-1.5 font-medium text-right">stdev</th>
													{/* THE PAIRWISE VIEW, as one column. best_variant is an
													    argmax of means and said nothing about whether the
													    winner is separable from the arm it beat — two arms
													    0.001 apart with a stdev of 0.4 produced a confident
													    verdict. No second table: the comparison belongs on
													    the row it is about. */}
													<th className="px-2 py-1.5 font-medium text-right" title="difference from the best arm, with a 95% interval">Δ vs best</th>
													<th className="px-3 py-1.5 font-medium text-right">last</th>
												</tr>
											</thead>
											<tbody>
												{variants.sort((a, b) => (b[1].mean ?? 0) - (a[1].mean ?? 0)).map(([vid, agg]) => (
													<tr key={vid} className={cn("border-b border-slate-50 last:border-0", vid === e.best_variant && "bg-gold-50/50")}>
														<td className="px-3 py-1.5 text-slate-700 font-mono truncate max-w-[180px]">
															{vid}{vid === e.best_variant && <span className="ml-1.5 text-[11px] text-gold-600 font-sans font-medium">best</span>}
															{e.baseline === vid && <span className="ml-1.5 text-[11px] text-slate-600 font-sans">baseline</span>}
														</td>
														<td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">{fmtV(agg.mean)}</td>
														<td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{agg.n}</td>
														<td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{agg.stdev != null ? fmtV(agg.stdev) : "—"}</td>
														<DeltaVsBest e={e} vid={vid} />
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
									<div className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 mb-1.5">{metricName.replace(/_/g, " ")} over time</div>
									<SeriesChart series={detail.series} />
								</div>
							)}
							{detail.cases?.length > 0 ? (
								<div>
									<div className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 mb-1.5">Casebook — per-case score history</div>
									<CasesTable app={app} expId={e.id} loop={e.loops?.[0]} cases={detail.cases} />
								</div>
							) : (e.n_results ?? 0) > 0 ? (
								// WHY THERE IS NO CASE BREAKDOWN, rather than nothing at all.
								//
								// The per-case view needs rows carrying dims.case_id. record_result()
								// takes that from the caller, so a loop recording only a metric
								// produces rows with no subject — and this block simply vanished,
								// leaving the per-arm means as the only thing on screen. A user who
								// had just run six samples asked, reasonably, which six cases they
								// were (2026-09-15). The honest answer is that the rows do not say.
								<div className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-[11px] text-slate-500">
									No per-case breakdown: {e.n_results} result{e.n_results === 1 ? " row was" : " rows were"} recorded
									without a case id, so which cases ran is not stored. A loop records one by passing
									<code className="text-[10.5px]">dims.case_id</code> to record_result.
								</div>
							) : null}
						</>
					) : (
						<div className="text-[11px] text-slate-600 italic">Couldn't load detail.</div>
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
	const [nonce, setNonce] = useState(0);
	useEffect(() => {
		let live = true;
		const load = () => me.experiments(app)
			.then((r) => { if (live) setExps(r.experiments || []); })
			.catch(() => { if (live) setExps([]); });
		load();
		const id = window.setInterval(load, 30_000);
		return () => { live = false; window.clearInterval(id); };
	}, [app, nonce]);

	if (exps === null) {
		if (quiet) return null;
		return <div className="relative"><div className="h-20 rounded-xl bg-slate-100 animate-pulse" /><SpiralOverlay /></div>;
	}
	const shown = loop ? exps.filter((e) => e.loops?.includes(loop)) : exps;
	// On a LOOP page the create affordance is PromoteToExperiment, which
	// already sits there and knows its own loop. This is for the app-wide
	// surface, which offered no way to create an experiment at all.
	const canCreate = !loop && !quiet;
	if (shown.length === 0) {
		// ON A LOOP, SAY SO — do not vanish.
		//
		// This returned null for a loop, reasoning that an empty state under the
		// runs would be noise. But the workflow panel renders a "Metric & arms"
		// HEADER above it unconditionally, so the real result was a titled EMPTY
		// box. A user hit exactly that after deleting three experiments the loop
		// still referenced (2026-09-16), with no way to tell a broken attachment
		// from a loop that simply has no experiment.
		//
		// `quiet` still means silent — it is for the callers that render no
		// header to leave stranded.
		if (loop && !quiet) {
			return (
				<div className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-[11px] text-slate-500">
					This workflow is attached to an experiment, but none of the app's
					experiments resolve to it — the attachment may still name one that was
					deleted. Check <code className="text-[10.5px]">engine.experiment</code> in
					the app config.
				</div>
			);
		}
		if (quiet || loop) return null;
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-8 text-center">
				<div className="text-sm text-slate-500">
					No experiments declared. An experiment tests a hypothesis by running
					variants over a dataset or casebook, measured by one metric.
				</div>
				{/* The old copy ended "declare one under `experiments:` in the app's
				    config" — hand-edit YAML, app_push, propagate to every tenant.
				    That instruction WAS this surface's only create path, and it is
				    how a metric name nothing emits ships unnoticed. */}
				<div className="mt-3 flex justify-center">
					<NewExperiment app={app} onCreated={() => setNonce((n) => n + 1)} />
				</div>
			</div>
		);
	}
	return (
		<div className="space-y-2.5">
			{canCreate && (
				<div className="flex justify-end">
					<NewExperiment app={app} onCreated={() => setNonce((n) => n + 1)} />
				</div>
			)}
			{shown.map((e) => (
				<ExperimentCard key={e.id} app={app} e={e} onChanged={() => setNonce((n) => n + 1)} />
			))}
		</div>
	);
}
