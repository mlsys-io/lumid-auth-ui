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

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
	Play, Pause, Loader2, Save, Clock, AlertCircle, Target,
	ChevronLeft, ChevronRight, ChevronDown, Trash2,
	Database, Sparkles, Pencil, Activity, Check,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { me, MeApiError, type MeWorkflowRow, type MeCycleDetail, type LoopDefinition } from "@/api/me";
import WorkflowCanvas, { type CanvasStepRef } from "@/components/workflow/WorkflowCanvas";
import StepInspectorPanel from "@/components/workflow/StepInspectorPanel";
import { type LoopStageKey } from "@/components/workflow/LoopOrbit";
import SchedulePicker from "@/components/workflow/SchedulePicker";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { describeSchedule, parseSchedule } from "@/lib/schedule";
import { loopLabel } from "@/lib/workflow-names";
import FailureCard from "@/components/workflow/FailureCard";
import RunSparkline from "@/components/RunSparkline";
import ErrorBoundary from "@/components/ErrorBoundary";
import CompareRuns from "@/components/workflow/CompareRuns";
// Datasets the workflow works on — heavy (table/preview), so lazy-load it and
// only mount when the Data tab is opened.
const DatasetExplorer = lazy(() => import("@/components/workflow/DatasetExplorer"));
import {
	ReviewQueue, OffersPanel,
	type CycleSummary,
} from "@/pages/studio/inspector";
import { cn } from "@/lib/utils";

// The goal always shows full-width at the top; Runs and Data switch via the
// left tab rail. "Pipeline" is NOT a tab — it's how a selected run is drawn
// inside Runs (Pipeline = the representation of a run).
type DetailTab = "runs" | "dataset";
const TABS: Array<{ key: DetailTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
	{ key: "runs", label: "Runs", icon: Activity },
	{ key: "dataset", label: "Data", icon: Database },
];

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
	// Deep-link anchor (?cycle=…) — the run the pipeline/inspector overlays.
	const [anchorTs] = useState<string | null>(initialCycle || null);
	const [summary, setSummary] = useState<CycleSummary | null>(cached0?.summary ?? null);
	const [cycleFiles, setCycleFiles] = useState<Record<string, unknown>>({});
	const [lastError, setLastError] = useState<string | null>(null);
	// Live running/event state — distinct from one-shot load motion.
	const [optimisticRun, setOptimisticRun] = useState(false);
	const [justRan, setJustRan] = useState(false);
	// Arriving with a ?cycle anchor opens the Learn stage (the run's outcome)
	// on that cycle, so "Open full cycle" lands on real content immediately.
	const [selectedStage, setSelectedStage] = useState<LoopStageKey | null>(initialCycle ? "learn" : null);
	const [stageQ, setStageQ] = useState("");
	const prevTsRef = useRef<string | null>(null);
	// Run inspector lives full-width below the Runs/Data grid; scroll it into
	// view when a run is opened so the click doesn't feel like nothing happened.
	const inspectorRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (selectedStage) inspectorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}, [selectedStage, anchorTs]);
	// Canvas (n8n-style node view): the loop's declared structure +
	// the selected run's per-step overlay + the click-a-node inspector.
	const [definition, setDefinition] = useState<LoopDefinition | null>(null);
	const [canvasCycle, setCanvasCycle] = useState<MeCycleDetail | null>(null);
	const [canvasStep, setCanvasStep] = useState<CanvasStepRef | null>(null);
	// Which tab the detail pane shows. Runs is the spine, so it opens by default.
	const [tab, setTab] = useState<DetailTab>("runs");
	// Which run the Runs tab draws as a pipeline. null = follow the latest run;
	// clicking an older run in the list pins it here.
	const [selectedRunTs, setSelectedRunTs] = useState<string | null>(null);
	// Runs picked for side-by-side comparison (2-5). >=2 swaps the pipeline for the compare table.
	const [compareTs, setCompareTs] = useState<string[]>([]);
	// Size the Pipeline canvas / Data list to fill the screen: measure the
	// fill wrapper's top and stretch it to the bottom of the viewport. The
	// studio shell scrolls (flex-1 overflow-y-auto), so the wrapper is
	// fixed-height and its content scrolls inside.
	const fillRef = useRef<HTMLDivElement | null>(null);
	const [fillH, setFillH] = useState(480);
	useEffect(() => {
		const measure = () => {
			const el = fillRef.current;
			if (!el) return;
			const top = el.getBoundingClientRect().top;
			setFillH(Math.max(360, Math.round(window.innerHeight - top - 24)));
		};
		measure();
		const raf = requestAnimationFrame(measure); // re-measure after layout settles
		window.addEventListener("resize", measure);
		return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); };
	}, [tab, summary, wf.goal]);

	// force=true refetches the latest cycle's detail even when the newest ts is
	// unchanged (used after acting on a review, where the same cycle's summary
	// changed). Steady-state polls pass force=false and skip the heavy detail
	// fetch when no new run has landed.
	const loadLatestCycle = useCallback(async (force = false) => {
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
			setCycleList(cycles.slice(0, 30));
			const ts = cycles[0]?.ts;
			if (!ts) { setCycleTs(null); setSummary(null); cycleCache.set(cacheKey, { ts: null, summary: null }); return; }
			// A newer cycle than last poll → a run just landed: flash it.
			const changed = prevTsRef.current !== null && ts !== prevTsRef.current;
			if (changed) {
				setOptimisticRun(false);
				setJustRan(true);
				window.setTimeout(() => setJustRan(false), 2600);
			}
			const firstSeen = prevTsRef.current !== ts;
			prevTsRef.current = ts;
			setCycleTs(ts);
			// Steady state: latest cycle hasn't changed and nothing forced a
			// refresh → skip the large detail payload (keep the current summary).
			if (!firstSeen && !force) return;
			const r = await apiClient.get(
				`/api/v1/me/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(ts)}`,
			);
			const detail = (r.data?.data ?? null) as MeCycleDetail | null;
			const sum = (detail?.summary ?? {}) as CycleSummary;
			setSummary(sum);
			setCycleFiles((detail?.files ?? {}) as Record<string, unknown>);
			cycleCache.set(cacheKey, { ts, summary: sum });
			// canvasCycle (the run drawn as a pipeline) is owned by the overlay
			// effect below, keyed on the selected run — not set here.
			// #4 — surface "why red": the first failing step's error.
			const steps = (detail?.steps ?? []) as Array<{ skill?: string; step_id?: string; error?: string }>;
			const firstErr = steps.find((s) => s.error);
			setLastError(firstErr ? `${firstErr.skill || firstErr.step_id || "step"}: ${String(firstErr.error)}` : null);
		} catch {
			/* keep any cached summary on transient error */
		}
	}, [app, loop, cacheKey, anchorTs]);

	// Poll while the panel is open so the loop visibly advances — new runs,
	// fresh offers, resolved approvals appear without a manual refresh. Pause
	// when the tab is hidden so a backgrounded panel isn't hammering the API.
	useEffect(() => {
		loadLatestCycle();
		const id = window.setInterval(() => {
			if (document.visibilityState !== "hidden") loadLatestCycle();
		}, 20_000);
		return () => window.clearInterval(id);
	}, [loadLatestCycle]);


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

	// canvasCycle = the run currently drawn as a pipeline. The selected run is
	// the deep-link anchor, else the run pinned in the Runs list, else the
	// latest. One fetch per selection change — the overlay effect owns it.
	const overlayTs = anchorTs || selectedRunTs || cycleTs;
	useEffect(() => {
		if (!overlayTs) { setCanvasCycle(null); return; }
		let live = true;
		apiClient.get(`/api/v1/me/cycles/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(overlayTs)}`)
			.then((r: any) => { if (live) setCanvasCycle((r.data?.data ?? null) as MeCycleDetail | null); })
			.catch(() => { if (live) setCanvasCycle(null); });
		return () => { live = false; };
	}, [app, loop, overlayTs]);

	const reviewQueue = Array.isArray(summary?.review_queue) ? summary!.review_queue! : [];
	const offers = Array.isArray(summary?.offers) ? summary!.offers! : [];
	// Honesty: a run can report ok:true yet have per-step errors. Surface that
	// instead of painting a clean "Healthy".
	const stepErrs = Array.isArray(summary?.step_errors) ? summary!.step_errors!.length : 0;

	const enabled = wf.enabled !== false;
	const cyclesKnown = cycleList !== null;
	const tenantHasRuns = (cycleList?.length ?? 0) > 0;
	const liveRunning = (cycleList ?? []).some((c) => c.running);
	const running = optimisticRun || liveRunning;
	const h = health(wf, tenantHasRuns || !cyclesKnown);
	const lastRan = whenLastFromCycle(cycleList?.[0]?.ts);
	const onDemand = parseSchedule(wf.trigger).kind === "trigger";

	// Whether a pipeline is declared (drives the Pipeline column's content).
	const hasPipeline = !!(definition && (definition.steps?.length || definition.skills_invoked?.length || definition.engine?.type || definition.engine?.module));

	return (
		<ErrorBoundary resetKey={`${app}:${loop}`}>
		<div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 animate-in fade-in duration-300">
			{/* ── HEADER — title + health + schedule + the controls ── */}
			<div className="flex flex-wrap items-start gap-2">
				<div className="min-w-0 flex-1">
					{/* Top-left card: workflow name · run-state dots (recent-run history,
					    clickable → cycle preview) · last-state word with the relative time
					    folded IN (e.g. "Healthy · 10h ago", "Recovered · 3d ago"). No
					    separate "ran …" line. */}
					<div className="flex items-center gap-2 flex-wrap">
						<h3 className="text-sm font-semibold text-slate-900 truncate">{loopLabel(wf.name, loop)}</h3>
						{wf.run_spark && (
							<RunSparkline spec={wf.run_spark} runs={wf.runs_recent} app={app} loop={loop} className="flex-shrink-0" />
						)}
						<span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium", h.cls, justRan && "value-pop")}>
							<span className={cn("w-1.5 h-1.5 rounded-full", h.dot, running && "running-glow")} />
							{running ? "Running…" : h.label}
							{!running && lastRan && <span className="font-normal opacity-70">· {lastRan.replace(/^ran /, "")}</span>}
						</span>
						{!running && stepErrs > 0 && wf.last_run_ok !== false && (
							<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-[11px] font-medium" title="The last run completed but some steps errored">
								<AlertCircle className="w-3 h-3" />{stepErrs} step error{stepErrs === 1 ? "" : "s"}
							</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-1.5 flex-shrink-0">
					{/* Schedule as a compact dropdown control (like Config): a button
					    showing the current cadence; the editor + Save live in a popover. */}
					<Popover>
						<PopoverTrigger asChild>
							<button disabled={!!busy}
								className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50">
								<Clock className="w-3.5 h-3.5 text-slate-400" />
								<span className="max-w-[150px] truncate">{describeSchedule(sched)}</span>
								{schedDirty && <span className="w-1.5 h-1.5 rounded-full bg-gold-500 flex-shrink-0" />}
								<ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
							</button>
						</PopoverTrigger>
						<PopoverContent align="end" className="w-72">
							<div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Schedule</div>
							<SchedulePicker value={sched} disabled={!!busy} onChange={(c) => { setSched(c); setSchedDirty(true); }} />
							{schedDirty && (
								<button onClick={saveSchedule} disabled={!!busy}
									className="mt-3 w-full inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50">
									{busy === "save" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save schedule
								</button>
							)}
						</PopoverContent>
					</Popover>
					<button onClick={runNow} disabled={!!busy}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 active:scale-95 disabled:opacity-50 transition-all shadow-sm shadow-gold-100">
						{busy === "run" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
						Run now
					</button>
					{/* "Improve" moved to the chat opener chips (chipsForApp). */}
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

			{/* ── GOAL — the workflow's objective, always shown full-width at the
			    top (prominent + editable), independent of the tab below. ── */}
			<div className="flex items-center gap-3 flex-wrap">
				<div className="flex-1 min-w-[200px]">
					<GoalHeader goal={wf.goal} kpis={buildGoalKpis(summary, cycleFiles)} app={app} loop={loop} onSaved={onChanged} />
				</div>
				<nav className="flex gap-1 flex-shrink-0 items-center" role="tablist" aria-label="Workflow details">
					{TABS.map((t) => {
						const active = tab === t.key;
						return (
							<button
								key={`top-${t.key}`} role="tab" aria-selected={active} onClick={() => setTab(t.key)}
								className={cn(
									"flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border",
									active
										? "bg-gold-50 text-gold-800 border-gold-200 font-medium"
										: "text-slate-600 border-transparent hover:bg-slate-50",
								)}>
								<t.icon className="w-4 h-4 flex-shrink-0" />
								<span className="truncate">{t.label}</span>
							</button>
						);
					})}
				</nav>
			</div>

			{/* A failed last run is an alert — kept above the tabs so it's always
			    visible regardless of which detail tab is open. */}
			{!running && wf.last_run_ok === false && lastError && tenantHasRuns && (
				<FailureCard error={lastError} app={app} loop={loop} />
			)}

			{/* ── Pipeline · Data — a left tab rail that switches the detail
			    content on the right. ── */}
			<div className="space-y-3">
				<div className="min-w-0">
					{/* RUNS — the execution history (left); the selected run drawn as
					    a pipeline (right). Pipeline = representation of a run. */}
					{tab === "runs" && (
						<div className="space-y-2 min-w-0 animate-in fade-in duration-200">
							<div className="text-[11px] tracking-[0.08em] font-medium text-slate-400 uppercase">
								Runs
								{overlayTs && tenantHasRuns && <span className="normal-case tracking-normal text-slate-400 font-normal"> · showing {cycleDate(overlayTs)}{(!selectedRunTs || selectedRunTs === cycleTs) ? " (latest)" : ""}</span>}
								{cyclesKnown && !tenantHasRuns && <span className="normal-case tracking-normal text-slate-400 font-normal"> · runs when you click Run now</span>}
							</div>
							<div ref={fillRef} style={{ height: fillH }} className="grid grid-cols-1 sm:grid-cols-[210px_1fr] gap-3 min-h-0">
								{/* LEFT — run timeline */}
								<div className="overflow-y-auto rounded-xl border border-slate-200 bg-white">
									{!cyclesKnown ? (
										<div className="flex items-center gap-2 text-xs text-slate-400 p-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading runs…</div>
									) : !tenantHasRuns ? (
										<div className="p-3 text-xs text-slate-400">Not run yet. Click <span className="font-medium text-slate-600">Run now</span> to start a run.</div>
									) : (
										<ul className="divide-y divide-slate-100">
											{(cycleList ?? []).map((r) => {
												const sel = (selectedRunTs ?? cycleTs) === r.ts;
												const tone = r.running ? "bg-sky-400" : r.ok === false ? "bg-rose-500" : "bg-gold-400";
												return (
													<li key={r.ts} className={cn("flex items-center", sel ? "bg-gold-50" : "hover:bg-slate-50")}>
														<button type="button"
															onClick={() => { setSelectedRunTs(r.ts === cycleTs ? null : r.ts); setCanvasStep(null); }}
															className={cn("flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left")}>
															<span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", tone, r.running && "running-glow")} />
															<span className="min-w-0 flex-1">
																<span className="block text-[12px] text-slate-700 truncate">{cycleDate(r.ts)}</span>
																<span className="block text-[10px] text-slate-400">
																	{r.running ? "running…" : r.ok === false ? "failed" : "ok"}
																	{typeof r.duration_s === "number" ? ` · ${Math.round(r.duration_s)}s` : ""}
																</span>
															</span>
															{r.ts === cycleTs && <span className="text-[9px] uppercase tracking-wide text-gold-600 flex-shrink-0">latest</span>}
														</button><button type="button" title={compareTs.includes(r.ts) ? "Remove from compare" : "Add to compare"} onClick={() => setCompareTs((prev) => prev.includes(r.ts) ? prev.filter((t) => t !== r.ts) : prev.length >= 5 ? prev : [...prev, r.ts])} className={cn("flex-shrink-0 w-5 h-5 mr-2 rounded border flex items-center justify-center transition-colors", compareTs.includes(r.ts) ? "bg-gold-500 border-gold-500 text-white" : "border-slate-300 text-transparent hover:border-gold-400")}><Check className="w-3 h-3" /></button>
													</li>
												);
											})}
										</ul>
									)}
								</div>
								{/* RIGHT — the selected run drawn as a pipeline; clicking a node
								    reveals its intermediate data in-place below (stays in view). */}
								<div className="min-w-0 flex flex-col gap-2 min-h-0">
									{compareTs.length >= 2 ? (
										<div className="flex-1 min-h-0 overflow-auto">
											<CompareRuns app={app} loop={loop} runs={compareTs} onRemove={(ts) => setCompareTs((p) => p.filter((t) => t !== ts))} />
										</div>
									) : hasPipeline ? (
										<div className="flex-1 min-h-0">
											<WorkflowCanvas
												definition={definition!}
												cycle={canvasCycle}
												running={running}
												height="100%"
												onStepSelect={(ref) => setCanvasStep(ref)}
											/>
										</div>
									) : (
										<div className="flex-1 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex items-center justify-center text-xs text-slate-400 p-5 text-center">No pipeline declared for this workflow.</div>
									)}
									{compareTs.length < 2 && canvasStep && (
										<div className="shrink-0 max-h-[45%] overflow-y-auto">
											<StepInspectorPanel
												step={canvasStep} app={app} loop={loop}
												ts={overlayTs || undefined} onClose={() => setCanvasStep(null)}
											/>
										</div>
									)}
								</div>
							</div>
							{/* Stage drill-down + free-text query on the selected run. */}
							{selectedStage && tenantHasRuns && (
								<div ref={inspectorRef}>
									<StageDetail
										app={app} loop={loop} stage={selectedStage} initialTs={anchorTs || selectedRunTs || undefined}
										onStageChange={(k) => setSelectedStage(k)}
										q={stageQ} setQ={setStageQ} onClose={() => setSelectedStage(null)}
									/>
								</div>
							)}
						</div>
					)}

					{/* DATA — datasets the workflow works on (app-scoped). Fills the
					    screen height; the file list scrolls inside the box. */}
					{tab === "dataset" && (
						<div className="space-y-2 min-w-0 animate-in fade-in duration-200">
							<div className="text-[11px] tracking-[0.08em] font-medium text-slate-400 uppercase flex items-center gap-1.5">
								<Database className="w-3 h-3" /> Data the goal is scored on
							</div>
							<div ref={fillRef} style={{ height: fillH }} className="overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 space-y-3">
								{/* Declared data sources / casebook refs from xpcloud.yaml — shown
								    even when no files are bundled locally (external-data apps). */}
								{(() => {
									const sources = (definition?.datasets?.length ? definition.datasets : wf.datasets) || [];
									return sources.length > 0 ? (
										<div>
											<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Data sources</div>
											<div className="flex flex-wrap gap-1.5">
												{sources.map((d) => (
													<span key={d} className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5 font-mono">
														<Database className="w-3 h-3 text-slate-400" />{d}
													</span>
												))}
											</div>
										</div>
									) : null;
								})()}
								<Suspense fallback={<div className="flex items-center gap-2 text-xs text-slate-400 p-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading datasets…</div>}>
									<DatasetExplorer app={app} />
								</Suspense>
							</div>
						</div>
					)}
				</div>
			</div>


		</div>
		</ErrorBoundary>
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

// GoalHeader — the loop's objective as a full-width bar near the top of the
// panel (per workflow). Trends were removed per request; the goal text + live
// KPI chips show inline, editing happens in a popover (pencil). Saving PATCHes
// the goal into the tenant's .user-overrides.yaml (merged over the declared
// xpcloud.yaml goal).
function GoalHeader({ goal, kpis, app, loop, onSaved }: { goal?: { primary: string; tracked?: string[] }; kpis: GoalKpi[]; app?: string; loop?: string; onSaved?: () => void }) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(goal?.primary || "");
	const [saving, setSaving] = useState(false);
	// Optimistic value shown immediately after save, until the parent refetch
	// lands the new goal on the `goal` prop (avoids a flash of the old goal).
	const [optimistic, setOptimistic] = useState<string | null>(null);
	const shown = optimistic ?? goal?.primary;
	// Re-seed the draft + clear the optimistic value when the persisted goal
	// changes (poll/refresh) and the editor is closed.
	useEffect(() => { if (!open) { setDraft(goal?.primary || ""); setOptimistic(null); } }, [goal?.primary, open]);

	const save = async () => {
		if (!app || !loop) return;
		setSaving(true);
		try {
			const next = draft.trim();
			await me.patchLoop(app, loop, { goal: next });
			setOptimistic(next);
			toast.success(next ? "Goal updated" : "Goal cleared");
			setOpen(false);
			onSaved?.();
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally { setSaving(false); }
	};

	const editor = (
		<PopoverContent align="end" className="w-80 space-y-2">
			<div className="text-[10px] uppercase tracking-wide text-gold-700/70 font-semibold">Goal</div>
			<textarea
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				rows={3}
				autoFocus
				maxLength={280}
				placeholder="What is this workflow trying to achieve?"
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
					if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
				}}
				className="w-full text-[13px] text-slate-800 leading-snug rounded-lg border border-gold-200 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gold-300 resize-none"
			/>
			<div className="flex items-center gap-2">
				<button type="button" onClick={save} disabled={saving}
					className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50">
					{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
				</button>
				<button type="button" onClick={() => setOpen(false)} disabled={saving}
					className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50">Cancel</button>
				<span className="text-[10px] text-slate-400 hidden sm:inline">⌘↵ to save</span>
			</div>
		</PopoverContent>
	);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<div className="rounded-xl border border-gold-200/70 bg-gradient-to-br from-gold-50/80 to-white px-3 py-2.5 flex items-center gap-2 flex-wrap">
				<Target className="w-4 h-4 text-gold-600 flex-shrink-0" />
				<span className="text-[10px] uppercase tracking-wide text-gold-700/70 font-semibold flex-shrink-0" title={(goal?.tracked || []).join(" · ")}>Goal</span>
				{shown ? (
					<>
						<PopoverTrigger asChild>
							<button type="button" title="Edit goal" className="text-[13px] text-slate-800 font-medium leading-snug text-left hover:text-gold-800 transition-colors">{humanizeGoal(shown)}</button>
						</PopoverTrigger>
						<PopoverTrigger asChild>
							<button type="button" title="Edit goal" className="text-gold-700/50 hover:text-gold-700 transition-colors flex-shrink-0">
								<Pencil className="w-3 h-3" />
							</button>
						</PopoverTrigger>
						{kpis.length > 0 && (
							<div className="flex items-center gap-2 flex-wrap ml-auto">
								{kpis.slice(0, 4).map((k) => (
									<span key={k.label} className="inline-flex items-center gap-1 text-[10.5px] text-slate-500 bg-white/70 border border-gold-100 rounded-full px-2 py-0.5">
										<span className="font-semibold text-slate-800 tabular-nums">{k.value}</span> {k.label}
									</span>
								))}
							</div>
						)}
					</>
				) : (
					<PopoverTrigger asChild>
						<button type="button" className="text-[12.5px] text-gold-700/80 hover:text-gold-700 font-medium transition-colors flex-shrink-0">+ Set a goal</button>
					</PopoverTrigger>
				)}
			</div>
			{editor}
		</Popover>
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
			if (rq.length) blocks.push(<StageNote key="rq" tone="hold">{rq.length} action{rq.length === 1 ? "" : "s"} held for your approval.</StageNote>);
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
