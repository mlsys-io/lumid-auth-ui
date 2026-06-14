// WorkflowObservabilityPanel — the per-workflow DETAIL CARD of the
// master–detail workflows page (AppOverview renders the list; this is the
// right-hand card for the selected workflow).
//
// Reads top-down: header (title + health + Run now / Pause / Delete) →
// runs (clickable, newest first; click opens the per-run stage inspector)
// → goal trends → schedule (preset picker, cron only under Advanced) →
// insights (one sentence + deltas) → suggested improvements.
//
// HONESTY RULE: run state comes from the TENANT cycles list only. The
// wf.last_run_* fields can carry operator-scoped scheduler state for
// shared apps ("Healthy · ran 2d ago" next to an empty runs list) — when
// the cycles list is empty this card says "Not run yet", full stop.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
	Play, Pause, Loader2, Save, Lightbulb, Clock, AlertCircle, Target,
	ChevronLeft, ChevronRight, ChevronDown, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { me, MeApiError, type MeWorkflowRow, type MeCycleDetail, type MeMetricSeries, type LoopDefinition } from "@/api/me";
import WorkflowCanvas, { type CanvasStepRef } from "@/components/workflow/WorkflowCanvas";
import StepInspectorPanel from "@/components/workflow/StepInspectorPanel";
import { TrendRow } from "@/components/workflow/MetricTrend";
import WorkflowInsights from "@/components/workflow/WorkflowInsights";
import { type LoopStageKey } from "@/components/workflow/LoopOrbit";
import SchedulePicker from "@/components/workflow/SchedulePicker";
import { describeSchedule, parseSchedule } from "@/lib/schedule";
import { loopLabel } from "@/lib/workflow-names";
import FailureCard from "@/components/workflow/FailureCard";
import AskAbout from "@/components/AskAbout";
import {
	ObserveGatePanel, ReviewQueue, OffersPanel,
	type CycleSummary,
} from "@/pages/studio/inspector";
import { cn } from "@/lib/utils";

export interface LoopHealth {
	app: string;
	loop: string;
	schedule?: string;
	enabled?: boolean;
	last_run_ts?: number;
	consecutive_failures?: number;
	status?: string; // never | ok | failing | stale | manual
	// Per-step errors from the last failed run (server sends these in
	// /me/loops/health already; the type lagged the payload).
	last_errors?: Array<{ step?: string; skill?: string; error: string }>;
}

// Health chip — one honest read of "how's this workflow doing". hasRuns
// is the TENANT cycles truth: without any tenant run, operator-scoped
// wf.last_run_* must not paint a state ("Healthy · ran 2d ago" lie).
function health(wf: MeWorkflowRow, hasRuns: boolean): { label: string; cls: string; dot: string } {
	if (wf.enabled === false) return { label: "Paused", cls: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-300" };
	if (!hasRuns) return { label: "Not run yet", cls: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-300" };
	// Failing = last run failed (fresh journal truth). consecutive_failures
	// (scheduler-state) can lag a recovered run, so it must not drive red —
	// keep counts and dots/health on the same single predicate.
	if (wf.last_run_ok === false)
		return { label: "Needs attention", cls: "text-rose-700 bg-rose-50 border-rose-200", dot: "bg-rose-500" };
	if (wf.last_run_recovered)
		return { label: "Recovered", cls: "text-gold-700 bg-gold-50 border-gold-200", dot: "bg-gold-500" };
	if (wf.last_run_ok === true) return { label: "Healthy", cls: "text-gold-700 bg-gold-50 border-gold-200", dot: "bg-gold-500" };
	return { label: "Idle", cls: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-300" };
}

// "ran 5m ago" from the newest tenant cycle DIR id (the single source of
// run-state truth) — never from operator-scoped wf.last_run_ts.
function whenLastFromCycle(ts?: string): string {
	if (!ts) return "";
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return "";
	const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
	const s = (Date.now() - t) / 1000;
	if (s < 60) return "ran just now";
	if (s < 3600) return `ran ${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `ran ${Math.floor(s / 3600)}h ago`;
	return `ran ${Math.floor(s / 86400)}d ago`;
}

// Cache the latest-cycle summary per (app:loop) for instant re-open.
const cycleCache = new Map<string, { ts: string | null; summary: CycleSummary | null }>();

export default function WorkflowObservabilityPanel({
	app, loop, wf, loopHealth, onChanged, initialCycle, canDelete, onDelete,
}: {
	app: string;
	loop: string;
	wf: MeWorkflowRow;
	loopHealth?: LoopHealth;
	onChanged?: () => void;
	// Deep-link anchor (?cycle=<ts>) — when set (e.g. CycleCard "Open full
	// cycle"), auto-open a stage on that run instead of waiting for a click.
	initialCycle?: string | null;
	// Per-loop delete (tenant apps, >1 loop) — lives in the card header now
	// that the master list rows are minimal.
	canDelete?: boolean;
	onDelete?: () => void;
}) {

	// ── Controls (run-now / pause-resume / edit cron) ──────────────
	const [busy, setBusy] = useState<null | "run" | "toggle" | "save">(null);
	// wf.trigger is the loop's cron, read from the *tenant* app (me_workflows
	// reads tenantAppsDir); loopsHealth is operator-scoped so it's only a
	// fallback. Seed from the tenant-correct value first.
	const schedSeed = wf.trigger || loopHealth?.schedule || "";
	const [sched, setSched] = useState(schedSeed);
	const [schedDirty, setSchedDirty] = useState(false);
	useEffect(() => { setSched(schedSeed); setSchedDirty(false); }, [schedSeed]);

	const runNow = async () => {
		setBusy("run");
		try {
			await me.runLoopNow(app, loop);
			// Show the loop running now; cleared when the new cycle lands
			// (or after a safety window if it produced no new cycle dir).
			setOptimisticRun(true);
			window.setTimeout(() => setOptimisticRun(false), 120_000);
			toast.success("Running — the results will land here shortly.");
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally { setBusy(null); }
	};
	const toggle = async () => {
		const target = !(wf.enabled !== false);
		setBusy("toggle");
		try {
			await me.patchLoop(app, loop, { enabled: target });
			toast.success(target ? "Resumed" : "Paused");
			onChanged?.();
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally { setBusy(null); }
	};
	const saveSchedule = async () => {
		setBusy("save");
		try {
			await me.patchLoop(app, loop, { schedule: sched });
			toast.success("Schedule updated");
			setSchedDirty(false);
			onChanged?.();
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally { setBusy(null); }
	};

	// ── Latest cycle (for observe gate + review queue + offers) ────
	// Seed from cache so re-opening a workflow shows its cycle instantly.
	const cacheKey = `${app}:${loop}`;
	const cached0 = cycleCache.get(cacheKey);
	const [cycleTs, setCycleTs] = useState<string | null>(cached0?.ts ?? null);
	// null = still loading; [] = confirmed zero tenant runs.
	const [cycleList, setCycleList] = useState<Array<{ ts: string; ok?: boolean; running?: boolean; duration_s?: number }> | null>(null);
	const [anchorTs, setAnchorTs] = useState<string | null>(initialCycle || null);
	const [summary, setSummary] = useState<CycleSummary | null>(cached0?.summary ?? null);
	const [cycleFiles, setCycleFiles] = useState<Record<string, unknown>>({});
	const [metricSeries, setMetricSeries] = useState<MeMetricSeries[]>([]);
	const [metricEvents, setMetricEvents] = useState<Record<string, string>>({});
	const [lastError, setLastError] = useState<string | null>(null);
	// Live running/event state — distinct from one-shot load motion.
	const [optimisticRun, setOptimisticRun] = useState(false);
	const [justRan, setJustRan] = useState(false);
	// Arriving with a ?cycle anchor opens the Learn stage (the run's outcome)
	// on that cycle, so "Open full cycle" lands on real content immediately.
	const [selectedStage, setSelectedStage] = useState<LoopStageKey | null>(initialCycle ? "learn" : null);
	const [stageQ, setStageQ] = useState("");
	const prevTsRef = useRef<string | null>(null);
	// Canvas (n8n-style node view): the loop's declared structure +
	// the selected run's per-step overlay + the click-a-node inspector.
	const [definition, setDefinition] = useState<LoopDefinition | null>(null);
	const [canvasCycle, setCanvasCycle] = useState<MeCycleDetail | null>(null);
	const [canvasStep, setCanvasStep] = useState<CanvasStepRef | null>(null);
	const [canvasOpen, setCanvasOpen] = useState(true);

	const loadLatestCycle = useCallback(async () => {
		try {
			// Use the cycle DIR ids (compact, e.g. 20260601T190000Z) from
			// /me/cycles — NOT me.today()'s journal-event ts, which is logged
			// minutes after the cycle and doesn't match the dir MeCycleDetail
			// looks up. Mismatch was the "cycle not found" + empty offers bug.
			const list = await apiClient.get(
				`/api/v1/me/cycles?app=${encodeURIComponent(app)}&loop=${encodeURIComponent(loop)}&limit=20`,
			);
			const cycles = (list.data?.data?.cycles ?? []) as Array<{ ts: string; ok?: boolean; running?: boolean; duration_s?: number }>;
			cycles.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
			setCycleList(cycles.slice(0, 8));
			const ts = cycles[0]?.ts;
			if (!ts) { setCycleTs(null); setSummary(null); cycleCache.set(cacheKey, { ts: null, summary: null }); return; }
			// A newer cycle than last poll → a run just landed: flash it.
			if (prevTsRef.current !== null && ts !== prevTsRef.current) {
				setOptimisticRun(false);
				setJustRan(true);
				window.setTimeout(() => setJustRan(false), 2600);
			}
			prevTsRef.current = ts;
			setCycleTs(ts);
			const r = await apiClient.get(
				`/api/v1/me/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(ts)}`,
			);
			const sum = (r.data?.data?.summary ?? {}) as CycleSummary;
			setSummary(sum);
			setCycleFiles((r.data?.data?.files ?? {}) as Record<string, unknown>);
			cycleCache.set(cacheKey, { ts, summary: sum });
			// #4 — surface "why red": the first failing step's error.
			const steps = (r.data?.data?.steps ?? []) as Array<{ skill?: string; step_id?: string; error?: string }>;
			const firstErr = steps.find((s) => s.error);
			setLastError(firstErr ? `${firstErr.skill || firstErr.step_id || "step"}: ${String(firstErr.error)}` : null);
		} catch {
			/* keep any cached summary on transient error */
		}
	}, [app, loop, cacheKey]);

	// Poll while the panel is open so the loop visibly advances — new runs,
	// fresh offers, resolved approvals appear without a manual refresh.
	useEffect(() => {
		loadLatestCycle();
		const id = window.setInterval(loadLatestCycle, 20_000);
		return () => window.clearInterval(id);
	}, [loadLatestCycle]);

	// Goal-metric trajectory across cycles (improvement over iterations).
	useEffect(() => {
		let live = true;
		me.loopMetricSeries(app, loop)
			.then((r) => { if (live) { setMetricSeries(r.series || []); setMetricEvents(r.events || {}); } })
			.catch(() => { /* no trends → goal header falls back to latest KPIs */ });
		return () => { live = false; };
	}, [app, loop]);

	// Canvas structure — the loop declaration verbatim (steps[] or
	// engine + skills_invoked[]). One fetch per loop.
	useEffect(() => {
		let live = true;
		setDefinition(null);
		setCanvasStep(null);
		me.workflowDetail(`${app}:${loop}`)
			.then((r) => { if (live) setDefinition((r.definition || null) as LoopDefinition | null); })
			.catch(() => { /* no declaration → canvas hides itself */ });
		return () => { live = false; };
	}, [app, loop]);

	// Canvas overlay — the SELECTED run's per-step data (n8n's replay:
	// clicking a dot in the runs strip re-paints the graph with that
	// run's statuses). Falls back to the latest run.
	const overlayTs = anchorTs || cycleTs;
	useEffect(() => {
		let live = true;
		if (!overlayTs) { setCanvasCycle(null); return; }
		apiClient.get(`/api/v1/me/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(overlayTs)}`)
			.then((r: any) => { if (live) setCanvasCycle((r.data?.data ?? null) as MeCycleDetail | null); })
			.catch(() => { if (live) setCanvasCycle(null); });
		return () => { live = false; };
	}, [app, loop, overlayTs]);

	const gate = summary?.observe_gate;
	const reviewQueue = Array.isArray(summary?.review_queue) ? summary!.review_queue! : [];
	const offers = Array.isArray(summary?.offers) ? summary!.offers! : [];

	const enabled = wf.enabled !== false;
	const cyclesKnown = cycleList !== null;
	const tenantHasRuns = (cycleList?.length ?? 0) > 0;
	const liveRunning = (cycleList ?? []).some((c) => c.running);
	const running = optimisticRun || liveRunning;
	const h = health(wf, tenantHasRuns || !cyclesKnown);
	const lastRan = whenLastFromCycle(cycleList?.[0]?.ts);
	const onDemand = parseSchedule(wf.trigger).kind === "trigger";

	const openRun = (ts: string) => { setAnchorTs(ts); setSelectedStage("learn"); };

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 animate-in fade-in duration-300">
			{/* ── HEADER — title + health + schedule + the controls ── */}
			<div className="flex flex-wrap items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<h3 className="text-sm font-semibold text-slate-900 truncate">{loopLabel(wf.name, loop)}</h3>
						<span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium", h.cls, justRan && "value-pop")}>
							<span className={cn("w-1.5 h-1.5 rounded-full", h.dot, running && "running-glow")} />
							{running ? "Running…" : h.label}
						</span>
					</div>
					{/* De-noised: just when it last ran (the status badge above already
					    says failing/healthy; the experiment chip was redundant noise). */}
					<div className="text-[11px] text-slate-400 mt-0.5">
						<span>{lastRan ? `ran ${lastRan}` : describeSchedule(wf.trigger)}</span>
					</div>
				</div>
				<div className="flex items-center gap-1.5 flex-shrink-0">
					{/* Schedule as a compact top-right control (like a config selector),
					    Save appears only when changed. */}
					<SchedulePicker value={sched} disabled={!!busy} onChange={(c) => { setSched(c); setSchedDirty(true); }} />
					{schedDirty && (
						<button onClick={saveSchedule} disabled={!!busy}
							className="inline-flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50">
							{busy === "save" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
						</button>
					)}
					<button onClick={runNow} disabled={!!busy}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 active:scale-95 disabled:opacity-50 transition-all shadow-sm shadow-gold-100">
						{busy === "run" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
						Run now
					</button>
					<AskAbout
						prompt={`Suggest improvements for the ${loop} workflow in ${app} — look at its recent runs and propose concrete changes (schedule, steps, prompts).`}
						context={{ app, loop }}
						label="Improve"
					/>
					<button onClick={toggle} disabled={!!busy}
						className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50">
						{busy === "toggle" ? <Loader2 className="w-3 h-3 animate-spin" /> : enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
						{enabled ? "Pause" : "Resume"}
					</button>
					{canDelete && (
						<button onClick={onDelete} title="Delete this workflow"
							className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors">
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					)}
				</div>
			</div>

			{/* ── GOAL — what this loop is chasing + how its metrics trend. Pinned
			    to the TOP (was buried below runs) so the "why" leads. ── */}
			{tenantHasRuns && (wf.goal?.primary || metricSeries.length > 0) && (
				<GoalHeader goal={wf.goal} kpis={buildGoalKpis(summary, cycleFiles)} series={metricSeries} events={metricEvents} app={app} loop={loop} />
			)}

			{/* ── NOT RUN YET — the one empty state (replaces every section) ── */}
			{cyclesKnown && !tenantHasRuns && !running && !definition && (
				<div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-5 text-center space-y-1">
					<div className="text-sm text-slate-600">Not run yet.</div>
					<div className="text-xs text-slate-400">
						{onDemand ? "It runs when you click Run now." : `It runs ${describeSchedule(wf.trigger).toLowerCase()} — or run it now to try it.`}
					</div>
				</div>
			)}
			{!running && wf.last_run_ok === false && lastError && tenantHasRuns && (
				<FailureCard error={lastError} app={app} loop={loop} />
			)}

			{/* ── PIPELINE — n8n-style node canvas. Structure from the loop's
			    declaration; statuses from the selected run (dot click = replay). ── */}
			{definition && (definition.steps?.length || definition.skills_invoked?.length || definition.engine?.type || definition.engine?.module) ? (
				<div className="space-y-2">
					<button
						type="button"
						onClick={() => setCanvasOpen((v) => !v)}
						className="inline-flex items-center gap-1 text-[11px] tracking-[0.08em] font-medium text-slate-400 uppercase hover:text-slate-600 transition-colors"
					>
						{canvasOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
						Pipeline
						{overlayTs && tenantHasRuns && <span className="normal-case tracking-normal text-slate-400 font-normal">· showing run {cycleDate(overlayTs)}</span>}
						{!tenantHasRuns && <span className="normal-case tracking-normal text-slate-400 font-normal">· runs when you click Run now</span>}
					</button>
					{canvasOpen && (
						<>
							<WorkflowCanvas
								definition={definition}
								cycle={canvasCycle}
								running={running}
								onStepSelect={(ref) => setCanvasStep(ref)}
							/>
							{canvasStep && (
								<StepInspectorPanel
									step={canvasStep}
									app={app}
									loop={loop}
									ts={overlayTs || undefined}
									onClose={() => setCanvasStep(null)}
								/>
							)}
						</>
					)}
				</div>
			) : null}

			{/* ── RUNS — what happened, newest first; click to inspect ── */}
			{tenantHasRuns && (
				<Section icon={Clock} title="Runs">
					<ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
						{(cycleList ?? []).map((c) => {
							const cdot = c.running ? "bg-sky-500 running-pulse" : c.ok === false ? "bg-rose-500" : "bg-gold-500";
							return (
								<li key={c.ts}>
									<button type="button" onClick={() => openRun(c.ts)}
										className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 transition-colors">
										<span className={cn("w-2 h-2 rounded-full flex-shrink-0", cdot)} />
										<span className="text-xs text-slate-700 tabular-nums">{cycleDate(c.ts)}</span>
										<span className="text-[11px] text-slate-400">
											{c.running ? "running…" : c.ok === false ? "failed" : "ok"}
											{typeof c.duration_s === "number" && c.duration_s > 0 ? ` · ${c.duration_s >= 90 ? Math.round(c.duration_s / 60) + "m" : Math.round(c.duration_s) + "s"}` : ""}
										</span>
										<ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto flex-shrink-0" />
									</button>
								</li>
							);
						})}
					</ul>
				</Section>
			)}
			{/* Per-run stage inspector — opened by clicking a run above. */}
			{selectedStage && tenantHasRuns && (
				<StageDetail
					app={app} loop={loop} stage={selectedStage} initialTs={anchorTs || undefined}
					onStageChange={(k) => setSelectedStage(k)}
					q={stageQ} setQ={setStageQ} onClose={() => setSelectedStage(null)}
				/>
			)}

			{/* GOAL moved to the top; SCHEDULE moved into the header control cluster. */}

			{/* ── INSIGHTS — hidden until there are runs to speak about ── */}
			{tenantHasRuns && (
				<Section icon={Lightbulb} title="Insights" delay={120}>
					<WorkflowInsights slug={wf.slug} />
					{gate && <div className="mt-2"><ObserveGatePanel gate={gate} /></div>}
				</Section>
			)}

			{/* ── SUGGESTED IMPROVEMENTS ───────────────────────────── */}
			{(reviewQueue.length > 0 || offers.length > 0) && (
				<Section icon={Clock} title="Suggested improvements" delay={240}>
					{offers.length > 0 && <OffersPanel offers={offers} app={app} loop={loop} ts={cycleTs ?? undefined} />}
					{reviewQueue.length > 0 && cycleTs && (
						<div className={offers.length > 0 ? "mt-2" : ""}>
							<ReviewQueue app={app} loop={loop} ts={cycleTs} items={reviewQueue} onActed={loadLatestCycle} />
						</div>
					)}
				</Section>
			)}

		</div>
	);
}

// Per-stage one-liners for the clickable orbit drill-down.
const STAGE_INFO: Record<LoopStageKey, { label: string; role: string }> = {
	observe: { label: "Observe", role: "what the workflow sensed at the start of this run" },
	hypothesize: { label: "Hypothesize", role: "the plan it formed from what it observed" },
	act: { label: "Act", role: "what it did — and what it held for your approval" },
	analyze: { label: "Analyze", role: "how it's performing over time" },
	learn: { label: "Learn", role: "what it banked to do better next run" },
};

// Stage drill-down + free-text query, opened by clicking an orbit node.
// snake_case goal slugs ("maximize_paper_realized_alpha") → readable prose.
function humanizeGoal(s: string): string {
	const t = s.replace(/_/g, " ").trim();
	return t ? t[0].toUpperCase() + t.slice(1) : t;
}

type GoalKpi = { label: string; value: string };

// Build the loop's LIVE progress KPIs from the latest cycle — real numbers
// beat a list of metric names. Pulls numeric metrics from cycle.json and the
// well-known sysresearch observations (best accuracy, variants tried).
function buildGoalKpis(summary: CycleSummary | null, files: Record<string, unknown>): GoalKpi[] {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const out: GoalKpi[] = [];
	const seen = new Set<string>();
	const push = (label: string, value: string) => { if (!seen.has(label)) { seen.add(label); out.push({ label, value }); } };
	const num = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));

	const obs = files?.observations as any;
	if (obs && typeof obs === "object") {
		if (typeof obs.best_accuracy_so_far === "number") push("best accuracy", `${Math.round(obs.best_accuracy_so_far * 100)}%`);
		if (typeof obs.history_size === "number") push("variants tried", num(obs.history_size));
	}
	const m = (summary as any)?.metrics;
	if (m && typeof m === "object") {
		for (const [k, v] of Object.entries(m)) {
			if (typeof v !== "number" || v === 0) continue;
			if (/^(xpio_ingested|auto_reflect)/.test(k)) continue;
			push(k.replace(/_/g, " "), num(v as number));
		}
	}
	return out.slice(0, 5);
}

function GoalHeader({ goal, kpis, series, events, app, loop }: { goal?: { primary: string; tracked?: string[] }; kpis: GoalKpi[]; series: MeMetricSeries[]; events: Record<string, string>; app?: string; loop?: string }) {
	// Best: trajectories (how metrics move over runs). Then latest static
	// values. Then just the tracked-metric names, terse. The goal line is
	// optional — the trend curve renders regardless.
	const hasTrends = series.length > 0;
	return (
		<div className="rounded-xl border border-gold-200/70 bg-gradient-to-br from-gold-50/80 to-white p-3">
			<div className="flex items-start gap-2">
				<Target className="w-4 h-4 text-gold-600 mt-0.5 flex-shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="text-[10px] uppercase tracking-wide text-gold-700/70 font-semibold" title={(goal?.tracked || []).join(" · ")}>{goal?.primary ? "Goal · how it's trending" : "How it's trending"}</div>
					{goal?.primary && <div className="text-[13px] text-slate-800 font-medium leading-snug">{humanizeGoal(goal.primary)}</div>}
					{hasTrends ? (
						<TrendRow series={series} events={events} tracked={goal?.tracked} app={app} loop={loop} />
					) : kpis.length > 0 ? (
						<div className="mt-2 flex flex-wrap gap-3">
							{kpis.map((k) => (
								<div key={k.label} className="leading-none">
									<div className="text-[15px] font-semibold text-slate-900 tabular-nums">{k.value}</div>
									<div className="text-[10px] text-slate-400 mt-0.5">{k.label}</div>
								</div>
							))}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

// dir-id "20260603T060039Z" → readable local time
function cycleDate(ts?: string): string {
	if (!ts) return "";
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return ts;
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtVal(v: unknown): string {
	if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
	if (typeof v === "boolean") return v ? "yes" : "no";
	if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
	if (v && typeof v === "object") return JSON.stringify(v).slice(0, 80);
	return String(v).slice(0, 100);
}

// Compact key:value card for a plain object (one level; nested → JSON snippet).
function KVCard({ title, obj }: { title: string; obj: unknown }) {
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
	const entries = Object.entries(obj as Record<string, unknown>)
		.filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
		.slice(0, 10);
	if (!entries.length) return null;
	return (
		<div className="rounded-lg bg-white border border-slate-200/70 p-2">
			<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">{title}</div>
			<div className="space-y-0.5">
				{entries.map(([k, v]) => (
					<div key={k} className="flex gap-2 text-[11px]">
						<span className="text-slate-400 flex-shrink-0">{k.replace(/_/g, " ")}</span>
						<span className="text-slate-700 font-mono truncate ml-auto text-right" title={typeof v === "object" ? JSON.stringify(v) : String(v)}>{fmtVal(v)}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function StageNote({ tone, children }: { tone: "ok" | "hold"; children: React.ReactNode }) {
	return <div className={cn("text-[11px] leading-snug", tone === "ok" ? "text-gold-700" : "text-gold-700")}>{children}</div>;
}

function StageProse({ label, text }: { label: string; text: string }) {
	return (
		<div>
			<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">{label}</div>
			<div className="text-[11px] text-slate-700 leading-snug whitespace-pre-wrap">{text.slice(0, 600)}</div>
		</div>
	);
}

// StageBody — the real artifact for one stage of one cycle. Pulls from the
// cycle summary (cycle.json), the sidecar files (observations/proposal/…),
// and any per-stage steps.
function StageBody({ stage, detail }: { stage: LoopStageKey; detail: MeCycleDetail }) {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const s: any = detail.summary || {};
	const files: any = detail.files || {};
	const steps = (detail.steps || []).filter((st) => st.stage === stage);
	const blocks: React.ReactNode[] = [];

	switch (stage) {
		case "observe":
			if (files.observations) blocks.push(<KVCard key="o" title="What it sensed" obj={files.observations} />);
			if (s.observe_gate) blocks.push(<StageNote key="g" tone={s.observe_gate.passed ? "ok" : "hold"}>{s.observe_gate.passed ? "Proceeded" : "Held"} — {s.observe_gate.reason || "evaluated the latest signals"}</StageNote>);
			if (Array.isArray(s.observe_keys) && s.observe_keys.length)
				blocks.push(<div key="k" className="flex flex-wrap gap-1">{s.observe_keys.slice(0, 12).map((it: unknown, i: number) => <span key={i} className="text-[10px] text-slate-600 bg-white border border-slate-200 rounded-full px-1.5 py-0.5">{String(it)}</span>)}</div>);
			break;
		case "hypothesize": {
			if (files.proposal) {
				const p = files.proposal;
				if (p.config) blocks.push(<KVCard key="c" title="Proposed configuration" obj={p.config} />);
				if (p.reasoning) blocks.push(<StageProse key="r" label="Reasoning" text={String(p.reasoning)} />);
				if (!p.config && !p.reasoning) blocks.push(<KVCard key="p" title="Proposal" obj={p} />);
			}
			const decs: any[] = Array.isArray(s.decisions) ? s.decisions : [];
			const prop = decs.map((d) => d?.proposal).find((p) => p?.symbol);
			if (prop) {
				blocks.push(<KVCard key="d" title="Proposed trade" obj={prop} />);
				if (prop.reasoning) blocks.push(<StageProse key="dr" label="Reasoning" text={String(prop.reasoning)} />);
			}
			break;
		}
		case "act": {
			const rq: any[] = Array.isArray(s.review_queue) ? s.review_queue : [];
			if (rq.length) blocks.push(<StageNote key="rq" tone="hold">{rq.length} action{rq.length === 1 ? "" : "s"} held for your approval — see Suggested improvements below.</StageNote>);
			if (files.result || files.results) blocks.push(<KVCard key="res" title="Result" obj={files.result || files.results} />);
			break;
		}
		case "analyze":
			if (s.metrics) blocks.push(<KVCard key="m" title="Metrics" obj={s.metrics} />);
			if (files.patterns) blocks.push(<KVCard key="pat" title="Patterns" obj={files.patterns} />);
			if (files.analysis) blocks.push(<KVCard key="an" title="Analysis" obj={files.analysis} />);
			break;
		case "learn": {
			const offers: any[] = Array.isArray(s.offers) ? s.offers : [];
			if (offers.length) blocks.push(<div key="of" className="space-y-0.5">{offers.slice(0, 4).map((o, i) => <div key={i} className="text-[11px] text-slate-700 flex gap-1"><span className="text-indigo-400">•</span><span title={o.detail}>{o.title}</span></div>)}</div>);
			const pushed = s.auto_publish?.memories ? Object.values(s.auto_publish.memories as Record<string, { pushed?: number }>).reduce((n, v) => n + (v?.pushed || 0), 0) : 0;
			if (pushed > 0) blocks.push(<StageNote key="mp" tone="ok">Compounded {pushed} new memor{pushed === 1 ? "y" : "ies"} into your knowledge graph.</StageNote>);
			if (files.improvement?.mutations_proposed) blocks.push(<StageNote key="imp" tone="ok">Proposed a self-improvement{Array.isArray(files.improvement.mutates) ? ` to its ${files.improvement.mutates.join(", ")} logic` : ""} — queued as a PR.</StageNote>);
			if (!offers.length && !pushed && !files.improvement?.mutations_proposed)
				blocks.push(<div key="lk" className="text-[11px] text-slate-500">Nothing new to bank this run. It compounds into your <Link to="/studio/knowledge" className="text-gold-700 hover:underline">knowledge</Link> as it learns.</div>);
			break;
		}
	}

	if (steps.length) blocks.push(
		<ul key="steps" className="space-y-1 pt-0.5">
			{steps.map((st) => (
				<li key={st.step_id} className="text-[11px] flex items-start gap-1.5">
					<span className={cn("mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0", st.ok === false ? "bg-rose-500" : "bg-gold-400")} />
					<span className="text-slate-600"><span className="font-medium text-slate-700">{st.skill || st.step_id}</span>{st.output_summary ? ` — ${st.output_summary}` : ""}{st.error ? ` · ${st.error.split("\n")[0]}` : ""}</span>
				</li>
			))}
		</ul>,
	);

	if (!blocks.length) return <div className="text-[11px] text-slate-400 italic">{STAGE_INFO[stage].role} — nothing recorded for this stage in this cycle.</div>;
	return <div className="space-y-2">{blocks}</div>;
}

// RunFlow — n8n-style read-only node chain of the run's ACTUAL steps.
// Each node = one executed step (skill), colored by outcome, connected
// left-to-right; clicking a node jumps the inspector to that step's stage.
// Runs without step records (some Pattern-B verbs) fall back to the
// 5-stage chip switcher rendered by the caller.
function RunFlow({ steps, active, onPick }: {
	steps: Array<{ step_id?: string; skill?: string; stage?: string; ok?: boolean; duration_s?: number }>;
	active: LoopStageKey;
	onPick?: (k: LoopStageKey) => void;
}) {
	if (!steps.length) return null;
	return (
		<div className="overflow-x-auto pb-1 -mx-1 px-1">
			<div className="flex items-center w-max min-w-full py-1.5">
				{steps.map((st, i) => {
					const stg = (st.stage || "") as LoopStageKey;
					const isActive = stg === active;
					const tone = st.ok === false
						? "border-rose-300 bg-rose-50 text-rose-700"
						: "border-gold-200 bg-white text-slate-700";
					return (
						<div key={`${st.step_id || st.skill || i}`} className="flex items-center">
							{i > 0 && <span className={cn("h-px w-5 flex-shrink-0", st.ok === false ? "bg-rose-200" : "bg-slate-200")} />}
							<button
								type="button"
								onClick={() => stg && onPick?.(stg)}
								title={`${st.skill || st.step_id}${typeof st.duration_s === "number" ? ` · ${Math.round(st.duration_s)}s` : ""}${st.ok === false ? " · failed" : ""}`}
								className={cn(
									"flex-shrink-0 rounded-lg border px-2 py-1 text-[10px] leading-tight max-w-[110px] truncate transition-colors",
									tone,
									isActive && "ring-2 ring-gold-400/60",
									!stg && "cursor-default",
								)}
							>
								<span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle", st.ok === false ? "bg-rose-500" : "bg-gold-400")} />
								{st.skill || st.step_id || `step ${i + 1}`}
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function StageDetail({
	app, loop, stage, q, setQ, onClose, initialTs, onStageChange,
}: {
	app: string; loop: string; stage: LoopStageKey;
	q: string; setQ: (v: string) => void; onClose: () => void;
	initialTs?: string;
	onStageChange?: (k: LoopStageKey) => void;
}) {
	const info = STAGE_INFO[stage];
	const [cycles, setCycles] = useState<Array<{ ts: string }> | null>(null);
	const [idx, setIdx] = useState(0);
	const [detail, setDetail] = useState<MeCycleDetail | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		let live = true;
		apiClient.get(`/api/v1/me/cycles?app=${encodeURIComponent(app)}&loop=${encodeURIComponent(loop)}&limit=20`)
			.then((r) => {
				const cs = ((r.data?.data?.cycles ?? []) as Array<{ ts: string }>)
					.filter((c) => c.ts).sort((a, b) => b.ts.localeCompare(a.ts));
				if (live) {
					setCycles(cs);
					// Honor a deep-link cycle anchor; else default to newest.
					const at = initialTs ? cs.findIndex((c) => c.ts === initialTs) : -1;
					setIdx(at >= 0 ? at : 0);
				}
			})
			.catch(() => { if (live) setCycles([]); });
		return () => { live = false; };
	}, [app, loop, initialTs]);

	const ts = cycles?.[idx]?.ts;
	useEffect(() => {
		if (!ts) { setDetail(null); return; }
		let live = true; setLoading(true);
		me.cycleDetail(app, loop, ts)
			.then((d) => { if (live) { setDetail(d); setLoading(false); } })
			.catch(() => { if (live) setLoading(false); });
		return () => { live = false; };
	}, [app, loop, ts]);

	const total = cycles?.length ?? 0;
	const ask = (e: React.FormEvent) => {
		e.preventDefault();
		const t = q.trim();
		if (!t) return;
		window.dispatchEvent(new CustomEvent("studio:ask", {
			detail: {
				prompt: `On ${app} / ${loop} — the ${info.label} stage${ts ? ` (run ${cycleDate(ts)})` : ""}: ${t}`,
				autosend: true,
				context: { app, loop, ...(ts ? { cycle: { app, loop, ts } } : {}) },
			},
		}));
		setQ("");
	};

	return (
		<div className="rounded-xl border border-gold-200/70 bg-gold-50/30 p-3 animate-in fade-in slide-in-from-top-1 duration-300">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="text-[13px] font-medium text-gold-900">{info.label}</div>
					<div className="text-[11px] text-slate-500">{info.role}</div>
				</div>
				<div className="flex items-center gap-1.5 flex-shrink-0">
					{total > 0 && (
						<div className="flex items-center gap-1">
							<button type="button" disabled={idx >= total - 1} onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
								className="p-0.5 rounded disabled:opacity-30 enabled:hover:bg-gold-100 text-gold-700" title="older run"><ChevronLeft className="w-3.5 h-3.5" /></button>
							<span className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap" title={ts}>{cycleDate(ts)} · {idx + 1}/{total}</span>
							<button type="button" disabled={idx <= 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}
								className="p-0.5 rounded disabled:opacity-30 enabled:hover:bg-gold-100 text-gold-700" title="newer run"><ChevronRight className="w-3.5 h-3.5" /></button>
						</div>
					)}
					<button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-700 ml-1">close</button>
				</div>
			</div>

			{/* The run as a node chain (n8n-style) — real executed steps when
			    recorded; else a 5-stage chip switcher so stages stay navigable. */}
			{detail?.steps?.length ? (
				<div className="mt-1.5">
					<RunFlow steps={detail.steps} active={stage} onPick={(k) => onStageChange?.(k)} />
				</div>
			) : (
				<div className="mt-1.5 flex flex-wrap gap-1">
					{(Object.keys(STAGE_INFO) as LoopStageKey[]).map((k) => (
						<button key={k} type="button" onClick={() => onStageChange?.(k)}
							className={cn(
								"px-2 py-0.5 rounded-full text-[10px] border transition-colors",
								k === stage
									? "bg-gold-600 text-white border-gold-600"
									: "bg-white text-slate-500 border-slate-200 hover:border-gold-300 hover:text-gold-700",
							)}>
							{STAGE_INFO[k].label}
						</button>
					))}
				</div>
			)}

			<div className="mt-2 min-h-[36px]">
				{loading && !detail ? (
					<div className="flex items-center gap-2 text-[11px] text-slate-400 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />reading the run…</div>
				) : !detail ? (
					<div className="text-xs text-slate-400 italic py-1">No run recorded yet for this loop.</div>
				) : (
					<StageBody stage={stage} detail={detail} />
				)}
			</div>

			<form onSubmit={ask} className="mt-2.5 flex items-center gap-2">
				<input
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder={`Ask the AI about the ${info.label.toLowerCase()} stage…`}
					className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/40"
				/>
				<button type="submit" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-gold-500 text-white hover:bg-gold-600">Ask</button>
			</form>
		</div>
	);
}

function Section({
	icon: Icon, title, children, delay = 0,
}: {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	children: React.ReactNode;
	delay?: number;
}) {
	return (
		<section className="animate-in fade-in slide-in-from-top-1 duration-300" style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}>
			<div className="flex items-center gap-1.5 mb-2">
				<Icon className="w-3.5 h-3.5 text-slate-400" />
				<h4 className="text-[11px] font-semibold tracking-[0.08em] uppercase text-slate-400">{title}</h4>
			</div>
			{children}
		</section>
	);
}
