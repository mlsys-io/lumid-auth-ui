// WorkflowObservabilityPanel — the expandable per-workflow detail.
//
// Three sections, mapping 1:1 to "status + insights + suggested
// improvements" — all real, all from me.*:
//   STATUS       — run-history sparkline, health chip, next-run, schedule,
//                  Run-now / Pause-Resume / edit-cron controls.
//   INSIGHTS     — <WorkflowInsights> (reliability + month-over-month
//                  deltas) + the latest cycle's observe-gate decision.
//   IMPROVEMENTS — the latest cycle's held review queue (approve / edit /
//                  revamp, fully wired) + spot-wise compound offers.
//
// The deepest view (per-step, prompt audit) stays in the cycle inspector;
// the footer deep-links there.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
	Activity, Play, Pause, Loader2, Save, Lightbulb, Clock, AlertCircle, Target,
	ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { me, MeApiError, type MeWorkflowRow, type MeCycleDetail, type MeMetricSeries } from "@/api/me";
import { TrendRow } from "@/components/workflow/MetricTrend";
import RunSparkline from "@/components/RunSparkline";
import WorkflowInsights from "@/components/workflow/WorkflowInsights";
import LoopOrbit, { type LoopMode, type LoopStageKey } from "@/components/workflow/LoopOrbit";
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
}

// Health chip — one honest read of "how's this workflow doing".
function health(wf: MeWorkflowRow, lh?: LoopHealth): { label: string; cls: string; dot: string } {
	if (wf.enabled === false) return { label: "Paused", cls: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-300" };
	// Failing = last run failed (fresh journal truth). consecutive_failures
	// (scheduler-state) can lag a recovered run, so it must not drive red —
	// keep counts and dots/health on the same single predicate.
	if (wf.last_run_ok === false)
		return { label: "Needs attention", cls: "text-rose-700 bg-rose-50 border-rose-200", dot: "bg-rose-500" };
	if (wf.last_run_recovered)
		return { label: "Recovered", cls: "text-amber-700 bg-amber-50 border-amber-200", dot: "bg-amber-500" };
	if (wf.last_run_ok === true) return { label: "Healthy", cls: "text-emerald-700 bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" };
	return { label: "Idle", cls: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-300" };
}

function whenLast(ts?: number): string {
	if (!ts) return "no runs yet";
	const s = (Date.now() - ts * 1000) / 1000;
	if (s < 60) return "ran just now";
	if (s < 3600) return `ran ${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `ran ${Math.floor(s / 3600)}h ago`;
	return `ran ${Math.floor(s / 86400)}d ago`;
}

// Cache the latest-cycle summary per (app:loop) for instant re-open.
const cycleCache = new Map<string, { ts: string | null; summary: CycleSummary | null }>();

export default function WorkflowObservabilityPanel({
	app, loop, wf, loopHealth, onChanged, initialCycle,
}: {
	app: string;
	loop: string;
	wf: MeWorkflowRow;
	loopHealth?: LoopHealth;
	onChanged?: () => void;
	// Deep-link anchor (?cycle=<ts>) — when set (e.g. CycleCard "Open full
	// cycle"), auto-open a stage on that run instead of waiting for a click.
	initialCycle?: string | null;
}) {
	const h = health(wf, loopHealth);

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
			toast.success("Running — the cycle will land here shortly.");
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
	const [summary, setSummary] = useState<CycleSummary | null>(cached0?.summary ?? null);
	const [cycleFiles, setCycleFiles] = useState<Record<string, unknown>>({});
	const [metricSeries, setMetricSeries] = useState<MeMetricSeries[]>([]);
	const [metricEvents, setMetricEvents] = useState<Record<string, string>>({});
	const [lastError, setLastError] = useState<string | null>(null);
	// Live running/event state — distinct from one-shot load motion.
	const [optimisticRun, setOptimisticRun] = useState(false);
	const [justRan, setJustRan] = useState(false);
	const [pulseStage, setPulseStage] = useState<LoopStageKey | null>(null);
	// Arriving with a ?cycle anchor opens the Learn stage (the run's outcome)
	// on that cycle, so "Open full cycle" lands on real content immediately.
	const [selectedStage, setSelectedStage] = useState<LoopStageKey | null>(initialCycle ? "learn" : null);
	const [stageQ, setStageQ] = useState("");
	const prevTsRef = useRef<string | null>(null);

	const loadLatestCycle = useCallback(async () => {
		try {
			// Use the cycle DIR ids (compact, e.g. 20260601T190000Z) from
			// /me/cycles — NOT me.today()'s journal-event ts, which is logged
			// minutes after the cycle and doesn't match the dir MeCycleDetail
			// looks up. Mismatch was the "cycle not found" + empty offers bug.
			const list = await apiClient.get(
				`/api/v1/me/cycles?app=${encodeURIComponent(app)}&loop=${encodeURIComponent(loop)}&limit=20`,
			);
			const cycles = (list.data?.data?.cycles ?? []) as Array<{ ts: string }>;
			cycles.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
			const ts = cycles[0]?.ts;
			if (!ts) { setCycleTs(null); setSummary(null); cycleCache.set(cacheKey, { ts: null, summary: null }); return; }
			// A newer cycle than last poll → a run just landed: flash it.
			if (prevTsRef.current !== null && ts !== prevTsRef.current) {
				setOptimisticRun(false);
				setJustRan(true);
				setPulseStage("learn"); // the loop just closed → learned
				window.setTimeout(() => { setJustRan(false); setPulseStage(null); }, 2600);
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

	const gate = summary?.observe_gate;
	const reviewQueue = Array.isArray(summary?.review_queue) ? summary!.review_queue! : [];
	const offers = Array.isArray(summary?.offers) ? summary!.offers! : [];

	const enabled = wf.enabled !== false;
	const dataRunning = (wf.run_spark || "").endsWith(".");
	const mode: LoopMode = !enabled ? "paused" : (optimisticRun || dataRunning) ? "running" : "idle";

	const loopCaption: React.ReactNode =
		justRan ? <span className="text-emerald-700 font-medium">✓ New cycle complete — insights updated</span>
		: mode === "running" ? "Iterating now — moving through the stages (scoring loops can take a few minutes)"
		: mode === "idle" ? (wf.next_run_ts ? <span>Armed · <NextRunCountdown nextTs={wf.next_run_ts} /></span> : "On demand — runs when you click Run now")
		: "Paused";

	return (
		<div className="border-t border-slate-200/70 bg-slate-50/40 px-4 py-4 space-y-4 animate-in fade-in duration-300">
			{/* What this loop is chasing — the goal + how its metrics move over runs. */}
			{wf.goal?.primary && <GoalHeader goal={wf.goal} kpis={buildGoalKpis(summary, cycleFiles)} series={metricSeries} events={metricEvents} />}
			{/* The loop, as the centerpiece — turning while a cycle runs,
			    rippling the stage when an event (new cycle) fires. */}
			<LoopOrbit
				mode={mode}
				pulse={pulseStage}
				caption={loopCaption}
				onStageClick={(k) => setSelectedStage((s) => (s === k ? null : k))}
				selected={selectedStage}
			/>
			{selectedStage && (
				<StageDetail
					app={app} loop={loop} stage={selectedStage} initialTs={initialCycle || undefined}
					q={stageQ} setQ={setStageQ} onClose={() => setSelectedStage(null)}
				/>
			)}

			{/* ── STATUS ───────────────────────────────────────────── */}
			<Section icon={Activity} title="Status">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
					<span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium", h.cls, justRan && "value-pop")}>
						<span className={cn("w-1.5 h-1.5 rounded-full", h.dot, mode === "running" && "running-glow")} />
						{h.label}
					</span>
					<RunSparkline spec={wf.run_spark || ""} runs={wf.runs_recent} app={app} loop={loop} />
					<span className="text-xs text-slate-500">{whenLast(wf.last_run_ts)}</span>
					{wf.last_run_ok === false && (loopHealth?.consecutive_failures ?? 0) > 0 && (
						<span className="text-xs text-rose-600">· {loopHealth!.consecutive_failures} consecutive failures</span>
					)}
				</div>

				{/* #4 — why is it red? Surface the latest failing step inline. */}
				{mode !== "running" && wf.last_run_ok === false && lastError && (
					<div className="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50/60 px-2.5 py-1.5 text-[11px] text-rose-800">
						<AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
						<span className="font-mono break-all">{lastError.slice(0, 220)}</span>
					</div>
				)}

				<div className="flex flex-wrap items-center gap-2 pt-1">
					<button
						onClick={runNow}
						disabled={!!busy}
						className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 disabled:opacity-50 transition-all shadow-sm shadow-emerald-100"
					>
						{busy === "run" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
						Run now
					</button>
					<button
						onClick={toggle}
						disabled={!!busy}
						className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
					>
						{busy === "toggle" ? <Loader2 className="w-3 h-3 animate-spin" /> : enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
						{enabled ? "Pause" : "Resume"}
					</button>
					<div className="flex items-center gap-1.5 ml-auto">
						<label className="text-[11px] text-slate-400">Schedule</label>
						<input
							type="text"
							value={sched}
							onChange={(e) => { setSched(e.target.value); setSchedDirty(true); }}
							placeholder="cron e.g. 0 8 * * *"
							className="w-36 px-2 py-1 text-xs font-mono rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
						/>
						<button
							onClick={saveSchedule}
							disabled={!schedDirty || !!busy}
							className={cn(
								"inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors",
								schedDirty ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-slate-200 text-slate-400 cursor-not-allowed",
							)}
						>
							{busy === "save" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
						</button>
					</div>
					<div className="basis-full text-[10px] text-slate-400 text-right -mt-1">{humanizeSchedule(sched)}</div>
				</div>
			</Section>

			{/* ── INSIGHTS ─────────────────────────────────────────── */}
			<Section icon={Lightbulb} title="Insights" delay={120}>
				<WorkflowInsights slug={wf.slug} />
				{gate && <div className="mt-2"><ObserveGatePanel gate={gate} /></div>}
			</Section>

			{/* ── SUGGESTED IMPROVEMENTS ───────────────────────────── */}
			{(reviewQueue.length > 0 || offers.length > 0) && (
				<Section icon={Clock} title="Suggested improvements" delay={240}>
					{offers.length > 0 && <OffersPanel offers={offers} />}
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

// Render a cron schedule in plain English (the raw "@trigger" / cron is
// confusing in the UI).
function humanizeSchedule(s?: string): string {
	if (!s || s === "@trigger") return "On demand — runs only when you click Run now";
	let m: RegExpMatchArray | null;
	if ((m = s.match(/^0 (\d{1,2}) \* \* \*$/))) return `Daily at ${m[1].padStart(2, "0")}:00`;
	if ((m = s.match(/^0 \*\/(\d+) \* \* \*$/))) return `Every ${m[1]}h`;
	if ((m = s.match(/^\*\/(\d+) \* \* \* \*$/))) return `Every ${m[1]} min`;
	if ((m = s.match(/^\d{1,2} \*\/(\d+) \* \* \*$/))) return `Every ${m[1]}h`;
	if (/\* \* 1-5$/.test(s)) return "Weekdays on schedule";
	if (/\* \* 1$/.test(s)) return "Weekly";
	return `Cron: ${s}`;
}

// Per-stage one-liners for the clickable orbit drill-down.
const STAGE_INFO: Record<LoopStageKey, { label: string; role: string }> = {
	observe: { label: "Observe", role: "what the loop sensed at the start of this cycle" },
	hypothesize: { label: "Hypothesize", role: "the plan it formed from what it observed" },
	act: { label: "Act", role: "what it did — and what it held for your approval" },
	analyze: { label: "Analyze", role: "how it's performing over time" },
	learn: { label: "Learn", role: "what it banked to do better next cycle" },
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

function GoalHeader({ goal, kpis, series, events }: { goal: { primary: string; tracked?: string[] }; kpis: GoalKpi[]; series: MeMetricSeries[]; events: Record<string, string> }) {
	// Best: trajectories (how metrics move over runs). Then latest static
	// values. Then just the tracked-metric names, terse.
	const hasTrends = series.length > 0;
	const showNames = !hasTrends && kpis.length === 0 && goal.tracked && goal.tracked.length > 0;
	return (
		<div className="rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-white p-3">
			<div className="flex items-start gap-2">
				<Target className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="text-[10px] uppercase tracking-wide text-emerald-700/70 font-semibold">Goal · how it's trending</div>
					<div className="text-[13px] text-slate-800 font-medium leading-snug">{humanizeGoal(goal.primary)}</div>
					{hasTrends ? (
						<TrendRow series={series} events={events} tracked={goal.tracked} />
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
					{showNames && (
						<div className="mt-1 text-[10px] text-slate-400 truncate" title={goal.tracked!.join(" · ")}>
							tracks {goal.tracked!.join(" · ")}
						</div>
					)}
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
	return <div className={cn("text-[11px] leading-snug", tone === "ok" ? "text-emerald-700" : "text-amber-700")}>{children}</div>;
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
				blocks.push(<div key="lk" className="text-[11px] text-slate-500">Nothing new to bank this cycle. It compounds into your <Link to="/studio/knowledge" className="text-emerald-700 hover:underline">knowledge</Link> as it learns.</div>);
			break;
		}
	}

	if (steps.length) blocks.push(
		<ul key="steps" className="space-y-1 pt-0.5">
			{steps.map((st) => (
				<li key={st.step_id} className="text-[11px] flex items-start gap-1.5">
					<span className={cn("mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0", st.ok === false ? "bg-rose-500" : "bg-emerald-400")} />
					<span className="text-slate-600"><span className="font-medium text-slate-700">{st.skill || st.step_id}</span>{st.output_summary ? ` — ${st.output_summary}` : ""}{st.error ? ` · ${st.error.split("\n")[0]}` : ""}</span>
				</li>
			))}
		</ul>,
	);

	if (!blocks.length) return <div className="text-[11px] text-slate-400 italic">{STAGE_INFO[stage].role} — nothing recorded for this stage in this cycle.</div>;
	return <div className="space-y-2">{blocks}</div>;
}

function StageDetail({
	app, loop, stage, q, setQ, onClose, initialTs,
}: {
	app: string; loop: string; stage: LoopStageKey;
	q: string; setQ: (v: string) => void; onClose: () => void;
	initialTs?: string;
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
			detail: { prompt: `On ${app} / ${loop} — the ${info.label} stage${ts ? ` (run ${cycleDate(ts)})` : ""}: ${t}`, autosend: true },
		}));
		setQ("");
	};

	return (
		<div className="rounded-xl border border-emerald-200/70 bg-emerald-50/30 p-3 animate-in fade-in slide-in-from-top-1 duration-300">
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="text-[13px] font-medium text-emerald-900">{info.label}</div>
					<div className="text-[11px] text-slate-500">{info.role}</div>
				</div>
				<div className="flex items-center gap-1.5 flex-shrink-0">
					{total > 0 && (
						<div className="flex items-center gap-1">
							<button type="button" disabled={idx >= total - 1} onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
								className="p-0.5 rounded disabled:opacity-30 enabled:hover:bg-emerald-100 text-emerald-700" title="older run"><ChevronLeft className="w-3.5 h-3.5" /></button>
							<span className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap" title={ts}>{cycleDate(ts)} · {idx + 1}/{total}</span>
							<button type="button" disabled={idx <= 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}
								className="p-0.5 rounded disabled:opacity-30 enabled:hover:bg-emerald-100 text-emerald-700" title="newer run"><ChevronRight className="w-3.5 h-3.5" /></button>
						</div>
					)}
					<button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-700 ml-1">close</button>
				</div>
			</div>

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
					className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
				/>
				<button type="submit" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600">Ask</button>
			</form>
		</div>
	);
}

// Live ticking countdown to the loop's next scheduled fire — honest motion
// for an idle (armed) loop.
function NextRunCountdown({ nextTs }: { nextTs: number }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);
	const ms = nextTs * 1000 - now;
	if (ms <= 0) return <span className="text-[11px] text-slate-400">next run due now</span>;
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
	const txt = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
	return <span className="text-[11px] text-slate-400 tabular-nums">next run in {txt}</span>;
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
