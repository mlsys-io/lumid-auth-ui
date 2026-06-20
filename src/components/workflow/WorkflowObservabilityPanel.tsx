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

import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
	Play, Pause, Loader2, Save, Clock, AlertCircle, Target,
	ChevronLeft, ChevronRight, ChevronDown, Trash2,
	Database, Sparkles, Pencil, Activity, Check, Square, MessageSquare,
	Eye, FlaskConical, SlidersHorizontal, ArrowLeft,
	PanelLeftClose, PanelLeftOpen, FileText, BarChart3,
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
import TrajectoryGraph, { type TrajectoryVersion } from "@/components/workflow/TrajectoryGraph";
import CaseMapping from "@/components/workflow/CaseMapping";
import MetricsView from "@/components/workflow/MetricsView";
import CaseContentViewer from "@/components/workflow/CaseContentViewer";
import TrajectoryLogView from "@/components/workflow/TrajectoryLogView";
import { RunCompareView } from "@/components/workflow/BranchTreeView";
import RunContextMenu, { type RunMenuActions, type RunMenuTarget } from "@/components/workflow/RunContextMenu";
import BranchDialog from "@/components/workflow/BranchDialog";
import { L, MODE_LABELS, VIEW_LABELS, type WorkflowMode } from "@/components/workflow/labels";
import type { MeExperiment } from "@/api/me";
// Datasets the workflow works on — heavy (table/preview), so lazy-load it and
// only mount when the Data tab is opened.
const DatasetExplorer = lazy(() => import("@/components/workflow/DatasetExplorer"));
const CasebookPanel = lazy(() => import("@/components/workflow/CasebookPanel"));
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

// ── View-stack (WS-3) ──────────────────────────────────────────────────
// Replaces the flat focus booleans (logFocus/caseDataFocus/metricsFocus/
// caseFocus/compareSel) with ONE push/pop stack so Back returns to the
// PREVIOUS view, not always the run tree. The base view of each mode is
// implicit (empty stack); pushing opens a sub-view, popping goes back one.
type ViewKind = "log" | "metrics" | "case" | "caseData" | "compare";
interface ViewFrame {
	kind: ViewKind;
	// The version (run ts) the view is pinned to (the "as of" chip).
	version?: TrajectoryVersion | null;
	// case targets carry id + label.
	caseId?: string;
	caseLabel?: string;
	// compare carries the two selected ts.
	compareSel?: string[];
}
type NavAction =
	| { type: "push"; frame: ViewFrame }
	| { type: "pop" }
	| { type: "reset" }                       // back to the mode's base view
	| { type: "setCompare"; sel: string[] };  // toggle compare set (replaces top compare frame)

function navReducer(stack: ViewFrame[], action: NavAction): ViewFrame[] {
	switch (action.type) {
		case "push": return [...stack, action.frame];
		case "pop": return stack.slice(0, -1);
		case "reset": return [];
		case "setCompare": {
			// Keep a single compare frame at the top reflecting the selection;
			// drop it when fewer than 2 are selected.
			const base = stack.filter((f) => f.kind !== "compare");
			return action.sel.length === 2 ? [...base, { kind: "compare", compareSel: action.sel }] : base;
		}
		default: return stack;
	}
}

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

	// Per-workflow model switch — sits beside the schedule control. Writes the
	// loops[].model override via patchLoop; the scheduler maps it to the cycle's
	// LLM env. "" = the runtime default (tenant cycles → shared kv.run Gemma).
	const [model, setModel] = useState<string>((wf as { model?: string }).model || "");
	useEffect(() => { setModel((wf as { model?: string }).model || ""); }, [wf]);
	const saveModel = async (m: string) => {
		setModel(m); setBusy("save");
		try {
			await me.patchLoop(app, loop, { model: m });
			toast.success(m ? `Model → ${m}` : "Model → default (kv.run Gemma)");
			onChanged?.();
		} catch (e) { toast.error(String((e as Error)?.message ?? e)); }
		finally { setBusy(null); }
	};

	const runNow = async () => {
		setBusy("run");
		try {
			await me.runLoopNow(app, loop);
			// Show the loop running now; cleared when the new cycle lands
			// (or after a safety window if it produced no new cycle dir).
			setOptimisticRun(true);
			window.setTimeout(() => setOptimisticRun(false), 120_000);
			// Open the live session so the user immediately sees it run.
			window.dispatchEvent(new CustomEvent("studio:open-session", { detail: { app, loop, ts: "latest" } }));
			toast.success("Running — the results will land here shortly.");
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally { setBusy(null); }
	};

	const stopRun = async () => {
		setBusy("run");
		try {
			await me.stopLoop(app, loop);
			setOptimisticRun(false);
			toast.success("Stopping — the run will halt at its next step.");
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
	const [cycleList, setCycleList] = useState<Array<{ ts: string; ok?: boolean; running?: boolean; duration_s?: number; cost_usd?: number; total_tokens?: number }> | null>(null);
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
	// ── Mode + view stack (WS-1/WS-3) ─────────────────────────────────
	// The three disentangled concerns. Observe = default. Tune is a thin tab
	// that links out to the prompt + config editors (their own routes).
	const [mode, setMode] = useState<WorkflowMode>("observe");
	// The "Cases & data" rail can collapse (the fixed 30% column cramped the
	// tree on small screens). Stacks vertically below lg.
	const [railOpen, setRailOpen] = useState(true);
	// The view stack within the current mode. Empty = the mode's base view
	// (Observe: run tree + cases; Improve: run tree + compare). Back pops.
	const [stack, dispatchNav] = useReducer(navReducer, []);
	const top = stack[stack.length - 1] as ViewFrame | undefined;
	// Switching mode clears the sub-view stack so each mode opens clean.
	const switchMode = useCallback((m: WorkflowMode) => { setMode(m); dispatchNav({ type: "reset" }); }, []);

	// The version the casebook + sub-views are pinned to (the "as of" chip). It
	// lives on the top frame; the rail reads the deepest version on the stack.
	const stackVersion = (() => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].version) return stack[i].version!; return null; })();
	const [pinnedVersion, setPinnedVersion] = useState<TrajectoryVersion | null>(null);
	const version = stackVersion || pinnedVersion;

	// Derived view selectors (replace the old booleans; sub-view JSX unchanged).
	const logFocus = top?.kind === "log";
	const metricsFocus = top?.kind === "metrics";
	const caseFocus = top?.kind === "case" ? { id: top.caseId!, label: top.caseLabel! } : null;
	const caseDataFocus = top?.kind === "caseData" ? { id: top.caseId!, label: top.caseLabel! } : null;
	const compareSel = (stack.find((f) => f.kind === "compare")?.compareSel) ?? [];

	// Navigation helpers — push a sub-view, pop back one, reset to base.
	const back = useCallback(() => dispatchNav({ type: "pop" }), []);
	const openLog = useCallback((v?: TrajectoryVersion | null) => dispatchNav({ type: "push", frame: { kind: "log", version: v } }), []);
	const openMetrics = useCallback(() => dispatchNav({ type: "push", frame: { kind: "metrics", version } }), [version]);
	const openCase = useCallback((c: { id: string; label: string }) => dispatchNav({ type: "push", frame: { kind: "case", caseId: c.id, caseLabel: c.label, version } }), [version]);
	const openCaseData = useCallback((c: { id: string; label: string }) => dispatchNav({ type: "push", frame: { kind: "caseData", caseId: c.id, caseLabel: c.label, version } }), [version]);
	const pinVersion = useCallback((v: TrajectoryVersion | null) => setPinnedVersion(v), []);
	// Toggle a run into the 2-slot compare set; 2 → a compare frame renders.
	const toggleCompare = useCallback((ts: string) => {
		const cur = compareSel;
		const next = cur.includes(ts) ? cur.filter((t) => t !== ts) : [...cur, ts].slice(-2);
		setMode("improve");
		dispatchNav({ type: "setCompare", sel: next });
	}, [compareSel]);
	// State for the WS-5 branch-with-intention dialog (run ts + label).
	const [branchFor, setBranchFor] = useState<{ ts?: string; label: string } | null>(null);
	// #17 — right-click menu opened on a CASEBOOK case row (the tree owns its
	// own menu internally; this is for the Data-assets rows).
	const [caseMenu, setCaseMenu] = useState<{ x: number; y: number; target: RunMenuTarget } | null>(null);
	useEffect(() => {
		if (!caseMenu) return;
		const h = () => setCaseMenu(null);
		const k = (e: KeyboardEvent) => { if (e.key === "Escape") setCaseMenu(null); };
		window.addEventListener("click", h);
		window.addEventListener("keydown", k);
		return () => { window.removeEventListener("click", h); window.removeEventListener("keydown", k); };
	}, [caseMenu]);
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
			// Leave clearance for the scroll column's bottom padding (py-5 = 20px)
			// + a hair, so the fill region doesn't overshoot the viewport and
			// force a phantom vertical scrollbar when everything already fits.
			setFillH(Math.max(360, Math.round(window.innerHeight - top - 44)));
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

	// #15 — the experiment attached to THIS loop, for the goal metric badge.
	// Match generically: an experiment whose loops[] includes this loop; if the
	// app has exactly one experiment, use it. No app-specific names.
	const [loopExp, setLoopExp] = useState<MeExperiment | null>(null);
	useEffect(() => {
		let live = true;
		setLoopExp(null);
		me.experiments(app)
			.then(({ experiments }) => {
				if (!live) return;
				const list = experiments || [];
				const attached = list.filter((e) => e.loops?.includes(loop));
				setLoopExp(attached[0] ?? (list.length === 1 ? list[0] : null));
			})
			.catch(() => { /* no metric badge */ });
		return () => { live = false; };
	}, [app, loop]);

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
	// Tell the chat's floating session box which workflow is selected + whether
	// it's running, so an open box re-binds to its live run or closes (never
	// shows a stale workflow's run). Re-fires when `running` flips.
	useEffect(() => {
		window.dispatchEvent(new CustomEvent("studio:workflow-selected", { detail: { app, loop, running } }));
	}, [app, loop, running]);
	const h = health(wf, tenantHasRuns || !cyclesKnown);
	const lastRan = whenLastFromCycle(cycleList?.[0]?.ts);
	const onDemand = parseSchedule(wf.trigger).kind === "trigger";

	// Whether a pipeline is declared (drives the Pipeline column's content).
	const hasPipeline = !!(definition && (definition.steps?.length || definition.skills_invoked?.length || definition.engine?.type || definition.engine?.module));

	// #17 — the shared context-menu action set. Wires the items that have a
	// destination already (view data / log / explain score / annotate / compare)
	// through the existing swap-state focuses + chat bus; the runtime ops live in
	// RunContextMenu itself (me.ts). One object, reused by the lineage tree AND
	// the casebook case rows so the menu behaves identically everywhere.
	const menuActions: RunMenuActions = {
		app, loop,
		// Focus a run: pin it as the version the left casebook + right panels read.
		focusRun: (ts: string) => {
			setSelectedRunTs(ts);
			pinVersion({ runTs: ts, cycleTs: ts, label: cycleDate(ts) || ts });
		},
		// View data: a case → its raw JSON + provenance (CaseContentViewer); a run
		// → pin that run's version and show the data it's scored on (MetricsView).
		viewData: (t: RunMenuTarget) => {
			if (t.kind === "case" && t.caseId) { openCaseData({ id: t.caseId, label: t.label }); }
			else if (t.ts) { pinVersion({ runTs: t.ts, cycleTs: t.ts, label: cycleDate(t.ts) || t.ts }); openMetrics(); }
		},
		// View run log at a run ts.
		viewLog: (ts?: string) => { openLog(ts ? { runTs: ts, cycleTs: ts, label: cycleDate(ts) || ts } : undefined); },
		// Explain score: a case → its per-question provenance (CaseContentViewer);
		// a run → the metric charts (MetricsView) for context.
		explainScore: (t: RunMenuTarget) => {
			if (t.kind === "case" && t.caseId) openCaseData({ id: t.caseId, label: t.label });
			else openMetrics();
		},
		// Branch WITH INTENTION (WS-5) — opens the dialog.
		branchWithIntent: (ts: string, label: string) => setBranchFor({ ts, label }),
		// Pin / annotate: hand off to the grounded chatbox so the user can attach a
		// note / ask the agent to remember this run (generic, no per-app store).
		annotate: (t: RunMenuTarget) => {
			window.dispatchEvent(new CustomEvent("studio:ask", {
				detail: {
					prompt: `Annotate ${t.kind === "case" ? `case "${t.label}"` : `run ${t.label}`} on ${app} / ${loop}: `,
					autosend: false,
					context: { app, loop, ...(t.ts ? { cycle: { app, loop, ts: t.ts } } : {}) },
				},
			}));
		},
	};

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
						{running ? (
							// The single running indicator — also the "show logs" entry
							// point (the trajectory panel's own running chip was redundant).
							<button
								type="button"
								onClick={() => window.dispatchEvent(new CustomEvent("studio:open-session", { detail: { app, loop, ts: "latest" } }))}
								title="Open the running session conversation"
								className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium transition hover:brightness-95", h.cls, justRan && "value-pop")}
							>
								<span className={cn("w-1.5 h-1.5 rounded-full running-glow", h.dot)} />
								Running… <span className="font-normal opacity-70 underline decoration-dotted">show logs</span>
							</button>
						) : (
							<span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium", h.cls, justRan && "value-pop")}>
								<span className={cn("w-1.5 h-1.5 rounded-full", h.dot)} />
								{h.label}
								{lastRan && <span className="font-normal opacity-70">· {lastRan.replace(/^ran /, "")}</span>}
							</span>
						)}
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
					{/* Per-workflow model switch — beside the schedule control. */}
					<select
						value={model}
						onChange={(e) => saveModel(e.target.value)}
						disabled={!!busy}
						title="Which model this workflow's runtime uses. Default = the shared kv.run Gemma GPU for tenant cycles; tiers route through the Claude CLI."
						className="px-2 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 max-w-[160px]"
					>
						<option value="">Default (kv.run Gemma)</option>
						<option value="sonnet">Claude Sonnet</option>
						<option value="opus">Claude Opus</option>
						<option value="haiku">Claude Haiku</option>
					</select>
					{running ? (
						<button onClick={stopRun} disabled={busy === "run"}
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-500 text-white hover:bg-rose-600 active:scale-95 disabled:opacity-50 transition-all shadow-sm">
							{busy === "run" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
							Stop
						</button>
					) : (
						<button onClick={runNow} disabled={!!busy}
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 active:scale-95 disabled:opacity-50 transition-all shadow-sm shadow-gold-100">
							{busy === "run" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
							Run now
						</button>
					)}
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
			    top (persistent header), independent of the mode below. ── */}
			<div className="min-w-0">
				<GoalHeader goal={wf.goal} kpis={buildGoalKpis(summary, cycleFiles)} app={app} loop={loop} onSaved={onChanged}
						experiment={loopExp} onOpenMetrics={() => { switchMode("observe"); openMetrics(); }} />
			</div>

			{/* A failed last run is an alert — kept above the modes so it's always
			    visible regardless of which mode is open. */}
			{!running && wf.last_run_ok === false && lastError && tenantHasRuns && (
				<FailureCard error={lastError} app={app} loop={loop} />
			)}

			{/* ── MODE SWITCH + BREADCRUMB (WS-1/WS-3) — the disentangling move. ── */}
			<div className="flex items-center gap-2 flex-wrap">
				<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
					{(["observe", "improve", "tune"] as WorkflowMode[]).map((m) => {
						const Icon = m === "observe" ? Eye : m === "improve" ? FlaskConical : SlidersHorizontal;
						return (
							<button key={m} type="button" onClick={() => switchMode(m)} title={MODE_LABELS[m].tip}
								className={cn("inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors",
									mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
								<Icon className="w-3.5 h-3.5" /> {MODE_LABELS[m].text}
							</button>
						);
					})}
				</div>
				{/* Breadcrumb — renders the stack; the "as of <version>" chip lives IN it. */}
				<div className="flex items-center gap-1 text-[11px] text-slate-500 min-w-0">
					<button type="button" onClick={() => dispatchNav({ type: "reset" })} className="hover:text-slate-800 transition-colors">{MODE_LABELS[mode].text}</button>
					{stack.map((f, i) => (
						<span key={i} className="flex items-center gap-1 min-w-0">
							<ChevronRight className="w-3 h-3 text-slate-300 flex-shrink-0" />
							<span className={cn("truncate", i === stack.length - 1 ? "text-slate-800 font-medium" : "")}>
								{f.kind === "case" || f.kind === "caseData" ? (f.caseLabel || VIEW_LABELS.case) : VIEW_LABELS[f.kind] || f.kind}
							</span>
						</span>
					))}
					{version && (
						<button onClick={() => pinVersion(null)} title="Pinned to a run — click to clear (back to latest)"
							className="ml-1 inline-flex items-center gap-1 normal-case tracking-normal text-[10px] text-gold-700 bg-gold-50 border border-gold-200 rounded-full px-1.5 py-0.5 hover:bg-gold-100 transition-colors flex-shrink-0">
							<Clock className="w-2.5 h-2.5" /> as of {cycleDate(version.runTs || version.cycleTs)} <span className="text-gold-400">✕</span>
						</button>
					)}
					{stack.length > 0 && (
						<button type="button" onClick={back} className="ml-1 inline-flex items-center gap-0.5 text-slate-500 hover:text-slate-900 px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors flex-shrink-0">
							<ArrowLeft className="w-3 h-3" /> Back
						</button>
					)}
				</div>
			</div>

			{/* ── TUNE — links out to the prompt + config editors (their own routes). ── */}
			{mode === "tune" ? (
				<div className="grid gap-3 sm:grid-cols-2">
					<Link to={`/studio/a/${encodeURIComponent(app)}/prompts`}
						className="rounded-xl border border-slate-200 bg-white p-4 hover:border-gold-300 hover:shadow-sm transition-all group">
						<div className="flex items-center gap-2 text-sm font-medium text-slate-900"><FileText className="w-4 h-4 text-gold-600" /> Prompts</div>
						<div className="mt-1 text-[12px] text-slate-500">Edit the analyst &amp; judge instructions this app runs on. Shared prompts stay read-only — editing one creates a local override.</div>
						<div className="mt-2 text-[11px] text-gold-700 group-hover:underline">Open prompt editor →</div>
					</Link>
					<Link to={`/studio/a/${encodeURIComponent(app)}/config`}
						className="rounded-xl border border-slate-200 bg-white p-4 hover:border-gold-300 hover:shadow-sm transition-all group">
						<div className="flex items-center gap-2 text-sm font-medium text-slate-900"><SlidersHorizontal className="w-4 h-4 text-gold-600" /> Config</div>
						<div className="mt-1 text-[12px] text-slate-500">Edit this app's <code className="text-[11px] bg-slate-50 border border-slate-200 rounded px-1">xpcloud.yaml</code> — loops, goals, datasets, skills.</div>
						<div className="mt-2 text-[11px] text-gold-700 group-hover:underline">Open config editor →</div>
					</Link>
				</div>
			) : (
			/* ── OBSERVE / IMPROVE — the rail + the mode body. ── */
			<div ref={fillRef} style={{ height: fillH }} className="flex flex-col lg:flex-row gap-3 min-h-0">
				{/* LEFT — the collapsible "Cases & data" rail. Stacks above the body
				    below lg; collapses to a thin reopen button when closed. */}
				{railOpen ? (
					<div className="w-full lg:w-[30%] lg:min-w-[210px] lg:max-w-[360px] flex flex-col min-h-0 max-h-64 lg:max-h-none">
						<div className="flex-1 min-h-0 rounded-xl border border-slate-200 bg-white flex flex-col overflow-hidden">
							<div className="text-[11px] tracking-[0.08em] font-medium text-slate-400 uppercase flex items-center gap-1.5 flex-shrink-0 px-3 py-2 border-b border-slate-100">
								<Database className="w-3 h-3 text-gold-500" /> <span title={L.casesAndData.tip}>{L.casesAndData.text}</span>
								<button onClick={() => { switchMode("observe"); openMetrics(); }} title={L.metrics.tip}
									className={cn("ml-auto inline-flex items-center gap-1 normal-case tracking-normal text-[10px] rounded-full px-1.5 py-0.5 border transition-colors",
										metricsFocus ? "text-gold-700 bg-gold-50 border-gold-200" : "text-slate-500 bg-white border-slate-200 hover:border-gold-200 hover:text-gold-700")}>
									<BarChart3 className="w-3 h-3" /> {L.metrics.text}
								</button>
								<button onClick={() => openLog(version)} title={L.runLog.tip}
									className={cn("inline-flex items-center gap-1 normal-case tracking-normal text-[10px] rounded-full px-1.5 py-0.5 border transition-colors",
										logFocus ? "text-violet-700 bg-violet-50 border-violet-200" : "text-slate-500 bg-white border-slate-200 hover:border-violet-200 hover:text-violet-700")}>
									<MessageSquare className="w-3 h-3" /> {L.runLog.text}
								</button>
								<button onClick={() => setRailOpen(false)} title="Hide the cases & data rail" className="text-slate-300 hover:text-slate-600 transition-colors">
									<PanelLeftClose className="w-3.5 h-3.5" />
								</button>
							</div>
							<div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
							{(() => {
								const sources = (definition?.datasets?.length ? definition.datasets : wf.datasets) || [];
								return sources.length > 0 ? (
									<div>
										<div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">Data sources</div>
										<div className="flex flex-nowrap gap-1.5 overflow-hidden">
											{sources.map((d) => (<span key={d} className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 font-mono truncate max-w-[10rem] flex-shrink-0">{d}</span>))}
										</div>
									</div>
								) : null;
							})()}
							<Suspense fallback={<div className="flex items-center gap-2 text-xs text-slate-400 p-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading data…</div>}>
								<CasebookPanel app={app} loop={loop} atTs={version?.runTs || version?.cycleTs}
									onSelectCase={(c) => { switchMode("observe"); openCase(c); }} selectedCaseId={caseFocus?.id || caseDataFocus?.id}
									onViewData={(c) => { switchMode("observe"); openCaseData(c); }}
									onContextMenuCase={(c, e) => { e.preventDefault(); setCaseMenu({ x: e.clientX, y: e.clientY, target: { kind: "case", caseId: c.id, label: c.label } }); }}
									onSelectMetrics={() => { switchMode("observe"); openMetrics(); }} metricsSelected={metricsFocus} />
							</Suspense>
						</div>
					</div>
				</div>
				) : (
					<button onClick={() => setRailOpen(true)} title="Show the cases & data rail"
						className="flex-shrink-0 self-start inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors">
						<PanelLeftOpen className="w-3.5 h-3.5" /> {L.casesAndData.text}
					</button>
				)}
				{/* RIGHT — the mode body: the active sub-view, else the mode's base
				    (Observe & Improve both show the run tree as the base). */}
				<div className="flex-1 min-w-0 min-h-0">
					{compareSel.length === 2 ? (
						<RunCompareView app={app} loop={loop} tsA={compareSel[0]} tsB={compareSel[1]} onBack={back} />
					) : logFocus ? (
						<TrajectoryLogView app={app} loop={loop} ts={version?.runTs || version?.cycleTs || anchorTs || selectedRunTs || undefined} onBack={back} backLabel="Back" />
					) : caseDataFocus ? (
						<CaseContentViewer app={app} loop={loop} expId={loopExp?.id} caseId={caseDataFocus.id} caseLabel={caseDataFocus.label} atTs={version?.runTs || version?.cycleTs} onBack={back} />
					) : metricsFocus ? (
						<MetricsView app={app} loop={loop} atTs={version?.runTs || version?.cycleTs} onBack={back} />
					) : caseFocus ? (
						<CaseMapping app={app} loop={loop} caseId={caseFocus.id} caseLabel={caseFocus.label} atTs={version?.runTs || version?.cycleTs} onBack={back} />
					) : (
						<TrajectoryGraph app={app} loop={loop} definition={definition} onSelectVersion={pinVersion} running={running}
							onShowLog={(ts) => openLog({ runTs: ts, cycleTs: ts, label: cycleDate(ts) || ts })}
							actions={menuActions} selectedForCompare={compareSel} onToggleCompare={toggleCompare} />
					)}
				</div>
			</div>
			)}
			{/* Stage drill-down + free-text query on the selected run (Observe). */}
			{mode !== "tune" && selectedStage && tenantHasRuns && (
				<div ref={inspectorRef}>
					<StageDetail app={app} loop={loop} stage={selectedStage} initialTs={anchorTs || selectedRunTs || undefined} onStageChange={(k) => setSelectedStage(k)} q={stageQ} setQ={setStageQ} onClose={() => setSelectedStage(null)} />
				</div>
			)}

			{/* The visible ⋯ / right-click menu for a casebook case row (the run
			    tree owns its own internal menu). One shared menu component. */}
			{caseMenu && createPortal(
				<RunContextMenu
					x={caseMenu.x} y={caseMenu.y} target={caseMenu.target} actions={menuActions}
					selectedForCompare={compareSel} onToggleCompare={toggleCompare}
					onClose={() => setCaseMenu(null)}
				/>,
				document.body,
			)}

			{/* WS-5 — branch-with-intention dialog. */}
			{branchFor && (
				<BranchDialog app={app} loop={loop} fromTs={branchFor.ts} fromLabel={branchFor.label}
					onClose={() => setBranchFor(null)} onLaunched={() => { setOptimisticRun(true); window.setTimeout(() => setOptimisticRun(false), 120_000); }} />
			)}

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
function GoalHeader({ goal, kpis, app, loop, onSaved, experiment, onOpenMetrics }: { goal?: { primary: string; tracked?: string[] }; kpis: GoalKpi[]; app?: string; loop?: string; onSaved?: () => void; experiment?: MeExperiment | null; onOpenMetrics?: () => void }) {
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
						{/* #15 — the metric this goal is scored on (name + current mean +
						    verdict), linking the loop→its experiment. Clicks open MetricsView. */}
						<MetricBadge experiment={experiment} onClick={onOpenMetrics} />
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

// MetricBadge — #15. The goal's metric at a glance: "metric: <name>" + the
// current best mean + a verdict chip. Generic over whatever metric the loop's
// attached experiment declares; clicking opens the metric charts (MetricsView).
function MetricBadge({ experiment: e, onClick }: { experiment?: MeExperiment | null; onClick?: () => void }) {
	if (!e) return null;
	const name = e.metric_name || e.metric?.name || "";
	if (!name) return null;
	// Current mean: the best variant's mean if available, else baseline_value.
	const best = e.best_variant ? e.variants?.[e.best_variant] : undefined;
	const mean = best?.mean ?? e.baseline_value ?? null;
	const fmt = (v: number) => (Number.isInteger(v) ? String(v) : Math.abs(v) < 1 ? String(+v.toFixed(3)) : String(+v.toFixed(2)));
	const verdict = e.criteria_met ? "criteria met" : (e.status && e.status !== "running" ? e.status : "running");
	const verdictCls = e.criteria_met
		? "bg-gold-100 text-gold-700 border-gold-200"
		: "bg-violet-50 text-violet-600 border-violet-200";
	return (
		<button
			type="button"
			onClick={onClick}
			title={`Metric: ${name}${typeof mean === "number" ? ` · current ${fmt(mean)}` : ""}${e.hypothesis ? ` · ${e.hypothesis}` : ""} — open metric charts`}
			className="inline-flex items-center gap-1.5 text-[10.5px] rounded-full border border-violet-200 bg-violet-50/60 px-2 py-0.5 hover:bg-violet-100 transition-colors flex-shrink-0"
		>
			<Activity className="w-3 h-3 text-violet-500" />
			<span className="text-slate-500">metric</span>
			<span className="font-semibold text-slate-800">{name.replace(/_/g, " ")}</span>
			{typeof mean === "number" && <span className="tabular-nums text-slate-700 font-medium">{fmt(mean)}</span>}
			<span className={cn("rounded-full border px-1.5 leading-tight", verdictCls)}>{verdict}</span>
		</button>
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

	if (!blocks.length) return <div className="text-[11px] text-slate-400 italic">{STAGE_INFO[stage].role} — nothing recorded for this stage in this run.</div>;
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
					<div className="text-xs text-slate-400 italic py-1">No run recorded yet for this workflow.</div>
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
