// ActivityView — the three answers about runs, in reading order:
//   Running now  → what is it doing, and how long has it been going?
//   Needs fixing → what's broken, since when, and why?
//   Workflows    → how is each one doing? (grouped by app)
//
// Used by /studio/runs (every app) and by an app's home (one app). All of it
// is computed from /me/runs rows (lib/activity.ts) — on the cloud deployment
// that is the only per-run source.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { me, type MeRunRow, type MeRunStepEvent } from "@/api/me";
import { estimateSteps, type StepEstimate } from "@/lib/run-timeline";
import {
	groupActivity, fmtDuration, fmtTypical, fmtSince, fmtAgo, progressOf, isOverdue, failingSentence,
	type RunningItem, type WorkflowActivity, type AppActivity,
} from "@/lib/activity";
import { runRowHref, workflowPath, parseScheduledRunId } from "@/lib/run-routes";
import { appTitle } from "@/components/workflow/AppCard";
import { loopLabel } from "@/lib/workflow-names";
import { RunSparkline } from "@/components/RunSparkline";
import { StrandAvatar } from "@/components/illustrations/StrandAvatar";
import { StatusDot } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNowSec } from "./hooks";

const title = (wf: WorkflowActivity) => loopLabel(wf.name, wf.loop);
const appName = (app: string) => (app ? appTitle(app) : "Other");

const ago = fmtAgo;

function money(cents: number): string {
	if (!cents) return "";
	return cents < 100 ? `${Math.round(cents)}¢` : `$${(cents / 100).toFixed(2)}`;
}

/** Three blinking dots after "Running" — the work is live. */
export function WorkingDots() {
	return <span className="lumen-dots" aria-hidden><span /><span /><span /></span>;
}

function Section({ label, count, children, className, style }: {
	label: string; count?: number; children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
	return (
		<section className={cn("space-y-2", className)} style={style} aria-label={label}>
			<h2 className="eyebrow flex items-center gap-2">
				{label}
				{count != null && <span className="tabular-nums text-ink-600 normal-case tracking-normal">{count}</span>}
			</h2>
			{children}
		</section>
	);
}

// ── Running now ────────────────────────────────────────────────────────────

// The steps the workflow's LAST run took — the template a running card
// estimates its progress against. One fetch per workflow per session.
const lastStepsCache = new Map<string, MeRunStepEvent[] | null>();
function useLastRunSteps(wf: WorkflowActivity): MeRunStepEvent[] | null {
	const ts = wf.latestFinished ? parseScheduledRunId(wf.latestFinished.run_id)?.runId : undefined;
	const key = `${wf.app}:${wf.loop}:${ts ?? ""}`;
	const [ev, setEv] = useState<MeRunStepEvent[] | null>(() => lastStepsCache.get(key) ?? null);
	useEffect(() => {
		if (!ts || !wf.app || !wf.loop || lastStepsCache.has(key)) return;
		let live = true;
		me.cycleDetail(wf.app, wf.loop, ts)
			.then((d) => { const e = (d as { events?: MeRunStepEvent[] }).events ?? null; lastStepsCache.set(key, e); if (live) setEv(e); })
			.catch(() => { lastStepsCache.set(key, null); });
		return () => { live = false; };
	}, [key, ts, wf.app, wf.loop]);
	return ev;
}

/** Novix's mini step grid on a running card, from the last run's steps: done
 *  solid, the estimated current step pulsing, the rest waiting. */
function MiniSteps({ est }: { est: StepEstimate }) {
	return (
		<div className="mt-2 flex flex-wrap gap-[3px]" aria-hidden>
			{est.steps.map((st, i) => (
				<span key={i} title={`${st.stage ? st.stage + " · " : ""}${st.name}`}
					className={cn("w-2.5 h-2.5 rounded-[2px]",
						st.state === "done" ? "bg-gold-300" : st.state === "now" ? "bg-lagoon-400 animate-lumen-breathe" : "bg-ink-100 border border-ink-200")} />
			))}
		</div>
	);
}

export function RunningCard({ item, now, showApp }: { item: RunningItem; now: number; showApp: boolean }) {
	const { run, wf } = item;
	const elapsed = Math.max(0, now - (run.started_at || now));
	const typical = wf.typicalS;
	const p = progressOf(elapsed, typical);
	const late = isOverdue(elapsed, typical);
	const started = new Date((run.started_at || 0) * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	const tpl = useLastRunSteps(wf);
	const est = tpl ? estimateSteps(tpl, elapsed, wf.loop) : null;
	return (
		<Link
			to={runRowHref(run.run_id)}
			className="block rounded-xl border border-lagoon-200 bg-card p-3 shadow-e1 animate-lumen-rise lumen-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
			aria-label={`${showApp ? appName(wf.app) + ", " : ""}${title(wf)} — running for ${fmtDuration(elapsed)}`}
		>
			<div className="flex items-center gap-2 text-micro text-ink-600">
				<StatusDot tone="running" pulse title="Running now" />
				<span className="font-mono tabular-nums">Started {started}</span>
				<span className="ml-auto font-mono tabular-nums text-ink-800">{fmtDuration(elapsed)}</span>
			</div>
			<div className="mt-1.5 flex items-center gap-2 min-w-0">
				{showApp && <StrandAvatar slug={wf.app || "other"} size={18} />}
				<div className="min-w-0 truncate text-body font-medium text-ink-900">
					{showApp && <span className="text-ink-600 font-normal">{appName(wf.app)} · </span>}
					{title(wf)}
				</div>
			</div>
			<div className="mt-1 text-meta">
				{late ? (
					<span className="text-ember-700">Taking longer than usual{typical ? ` (usually ${fmtTypical(typical)})` : ""}</span>
				) : (
					<span className="text-ink-600">
						{/* The current action as a sentence — estimated from the last run's
						    steps, because runs report steps only when they finish. */}
						<span className="lumen-shine font-medium">{est?.now && !est.beyond ? est.now.name : "Running"}</span><WorkingDots />
						{typical ? <> · usually {fmtTypical(typical)}</> : <> · first timed run</>}
					</span>
				)}
			</div>
			{est && <MiniSteps est={est} />}
			{est && <div className="mt-1 text-nano text-ink-600">steps estimated from the last run</div>}
			{/* How far through its usual time — a fill, never a spinner. */}
			<div className="mt-2 h-1 rounded-full bg-ink-100 overflow-hidden" aria-hidden>
				<div
					className={cn("h-full rounded-full lumen-sweep transition-[width] duration-1000 ease-linear", late ? "bg-ember-400" : "bg-lagoon-400")}
					style={{ width: `${Math.round((p ?? 0.35) * 100)}%` }}
				/>
			</div>
		</Link>
	);
}

// A run that just finished keeps its card for a moment — its outcome in words —
// then folds away; its workflow's strip below gains the new cell.
const FOLD_MS = 2400;
function useFinishing(act: { running: RunningItem[] }, runs: MeRunRow[]): RunningItem[] {
	const prev = useRef<Map<string, RunningItem>>(new Map());
	const [finishing, setFinishing] = useState<RunningItem[]>([]);
	useEffect(() => {
		const nowIds = new Set(act.running.map((r) => r.run.run_id));
		const gone: RunningItem[] = [];
		for (const [id, it] of prev.current) {
			if (nowIds.has(id)) continue;
			const fin = runs.find((r) => r.run_id === id);
			if (fin && fin.state !== "running") gone.push({ run: fin, wf: it.wf });
		}
		prev.current = new Map(act.running.map((r) => [r.run.run_id, r]));
		if (!gone.length) return;
		setFinishing((cur) => [...cur, ...gone]);
		// No cleanup on purpose: `act.running` is a new array every render, so
		// this effect re-runs often, and clearing here would cancel the fold.
		window.setTimeout(() => setFinishing((cur) => cur.filter((c) => !gone.some((g) => g.run.run_id === c.run.run_id))), FOLD_MS);
	}, [act.running, runs]);
	return finishing;
}

function FinishedCard({ run, wf, showApp }: { run: MeRunRow; wf: WorkflowActivity; showApp: boolean }) {
	const ok = run.state === "succeeded";
	return (
		<div className={cn("rounded-xl border p-3 activity-fold", ok ? "border-gold-200 bg-gold-50/60" : "border-brick-200 bg-brick-50/60")} role="status">
			<div className="text-micro text-ink-600 font-mono tabular-nums">{fmtDuration(run.duration_s)}</div>
			<div className="mt-1 text-body font-medium text-ink-900 truncate">
				{showApp && <span className="text-ink-600 font-normal">{appName(wf.app)} · </span>}{title(wf)}
			</div>
			<div className={cn("mt-1 text-meta font-medium", ok ? "text-gold-700" : "text-brick-700")}>
				{ok ? "Finished — succeeded" : `Finished — ${run.state === "failed" ? "failed" : run.state}`}
			</div>
		</div>
	);
}

// ── Needs fixing ───────────────────────────────────────────────────────────

export function NeedsFixingRow({ wf, showApp, span }: { wf: WorkflowActivity; showApp: boolean; span: string }) {
	const f = wf.failing!;
	const streak = failingSentence(f, span);
	return (
		<div className="flex items-start gap-3 rounded-xl border border-brick-200 bg-brick-50/50 px-3.5 py-3 animate-lumen-rise">
			<AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-brick-600" aria-hidden />
			<div className="min-w-0 flex-1">
				<div className="text-body font-medium text-ink-900 truncate">
					{showApp && <span className="text-ink-600 font-normal">{appName(wf.app)} · </span>}
					{title(wf)}
				</div>
				<div className="text-meta text-ink-700">{streak}</div>
				<div className="text-meta text-brick-700 break-words" title={f.rawReason || undefined}>{f.cause}</div>
			</div>
			<Button asChild variant="secondary" size="sm" className="flex-shrink-0">
				<Link to={runRowHref(f.latestRunId)}>Open run <ArrowRight className="w-3.5 h-3.5" /></Link>
			</Button>
		</div>
	);
}

// ── Workflows ──────────────────────────────────────────────────────────────

function lastOutcome(wf: WorkflowActivity, now: number): { text: string; tone: string } {
	if (wf.running.length) return { text: "Running now", tone: "text-lagoon-700" };
	const r = wf.latestFinished;
	if (!r) return { text: "No runs yet", tone: "text-ink-600" };
	const when = ago(r.started_at, now);
	const dur = r.duration_s ? ` · ${fmtDuration(r.duration_s)}` : "";
	switch (r.state) {
		case "succeeded": return { text: `Succeeded ${when}${dur}`, tone: "text-ink-700" };
		case "failed": return { text: `Failed ${when}`, tone: "text-brick-700" };
		case "skipped": return { text: `Nothing to do ${when}`, tone: "text-ink-600" };
		default: return { text: `Cancelled ${when}`, tone: "text-ink-600" };
	}
}

export function WorkflowRow({ wf, now }: { wf: WorkflowActivity; now: number }) {
	const navigate = useNavigate();
	const href = wf.app ? workflowPath(wf.app, wf.loop) : runRowHref(wf.runs[0]?.run_id || "");
	const out = lastOutcome(wf, now);
	const cost = money(wf.costCents);
	return (
		<div
			role="link"
			tabIndex={0}
			onClick={() => navigate(href)}
			onKeyDown={(e) => { if (e.key === "Enter") navigate(href); }}
			className="group grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_11rem] items-center gap-x-4 gap-y-1 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-ink-50 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		>
			<div className="min-w-0">
				<div className="text-body text-ink-900 truncate">{title(wf)}</div>
				<div className={cn("text-meta truncate", out.tone)}>
					{out.text}
					{cost && <span className="text-ink-600"> · {cost}</span>}
				</div>
			</div>
			{/* The strip's dots open their run's card; keep those clicks off the row. */}
			<div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="justify-self-end">
				<RunSparkline spec={wf.spark} runs={wf.app ? wf.sparkRuns : undefined} app={wf.app || undefined} loop={wf.loop} />
			</div>
			<div className="hidden sm:block text-micro text-ink-600 text-right tabular-nums">
				{wf.runs.length} run{wf.runs.length === 1 ? "" : "s"}
				{wf.typicalS ? <> · usually {fmtTypical(wf.typicalS)}</> : null}
			</div>
		</div>
	);
}

function AppGroup({ a, now, showHeader }: { a: AppActivity; now: number; showHeader: boolean }) {
	return (
		<div className="rounded-xl border border-ink-200 bg-card shadow-e1">
			{showHeader && (
				<Link
					to={a.app ? `/studio/apps/${encodeURIComponent(a.app)}` : "#"}
					className="flex items-center gap-2.5 px-3.5 pt-3 pb-2 border-b border-ink-100 hover:bg-ink-50/60 rounded-t-xl"
				>
					<StrandAvatar slug={a.app || "other"} size={22} />
					<span className="text-body font-medium text-ink-900">{appName(a.app)}</span>
					<span className="ml-auto text-micro text-ink-600">
						{[
							a.runningCount ? `${a.runningCount} running` : "",
							a.failingCount ? `${a.failingCount} failing` : "",
							`${a.workflows.length} workflow${a.workflows.length === 1 ? "" : "s"}`,
						].filter(Boolean).join(" · ")}
					</span>
				</Link>
			)}
			<div className="p-1 divide-y divide-ink-100">
				{a.workflows.map((wf) => <WorkflowRow key={wf.key} wf={wf} now={now} />)}
			</div>
		</div>
	);
}

// ── The view ───────────────────────────────────────────────────────────────

export function ActivityView({ runs, app, days, entrance = false, compact = false, asOf, truncated = false, skipRunning = false }: {
	runs: MeRunRow[];
	/** The API capped the window: only the newest runs are here. */
	truncated?: boolean;
	/** Narrow to one app (its home). */
	app?: string;
	days: number;
	/** First view this session: sections enter with the blur-rise, staggered. */
	entrance?: boolean;
	/** App home: running + needs fixing only, workflows live in their own tab. */
	compact?: boolean;
	/** Running runs are shown elsewhere (the app home's Compute panel). */
	skipRunning?: boolean;
	asOf?: number;
}) {
	const act = groupActivity(runs, { app });
	const finishing = useFinishing(act, runs);
	const now = useNowSec(act.running.length > 0) ;
	const nowSec = act.running.length ? now : Date.now() / 1000;
	const showApp = !app;
	const stagger = (i: number): React.CSSProperties | undefined => (entrance ? { animationDelay: `${[0, 100, 300][i] ?? 300}ms` } : undefined);
	const enter = entrance ? "lumen-hero-in" : "";
	const nWf = act.apps.reduce((s, a) => s + a.workflows.length, 0);
	const updated = asOf ? new Date(asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
	// What the loaded runs actually cover — "in the last 7 days" is a lie when
	// the feed read only the newest rows of the window (FEED_MAX).
	const oldest = runs.reduce((m, r) => (r.started_at && r.started_at < m ? r.started_at : m), Infinity);
	const span = truncated && isFinite(oldest)
		? `since ${fmtSince(oldest)}`
		: `in the last ${days === 1 ? "24 hours" : `${days} days`}`;

	return (
		<div className="space-y-6">
			{!skipRunning && (act.running.length > 0 || finishing.length > 0) && (
				<Section label="Running now" count={act.running.length} className={enter} style={stagger(0)}>
					<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{act.running.map((it) => <RunningCard key={it.run.run_id} item={it} now={nowSec} showApp={showApp} />)}
						{finishing.map((f) => <FinishedCard key={f.run.run_id} run={f.run} wf={f.wf} showApp={showApp} />)}
					</div>
				</Section>
			)}
			{act.failing.length > 0 && (
				<Section label="Needs fixing" count={act.failing.length} className={enter} style={stagger(1)}>
					<div className="space-y-2">
						{act.failing.map((wf) => <NeedsFixingRow key={wf.key} wf={wf} showApp={showApp} span={span} />)}
					</div>
				</Section>
			)}
			{compact ? (
				act.running.length === 0 && act.failing.length === 0 && nWf > 0 ? (
					<p className="text-meta text-ink-600">
						Nothing running, nothing failing · {nWf} workflow{nWf === 1 ? "" : "s"} ran {span}.
					</p>
				) : null
			) : (
				nWf > 0 && (
					<Section label={app ? "Workflows" : "All workflows"} className={enter} style={stagger(2)}>
						<div className="space-y-3">
							{act.apps.map((a) => <AppGroup key={a.app || "_"} a={a} now={nowSec} showHeader={showApp} />)}
						</div>
					</Section>
				)
			)}
			{!compact && nWf > 0 && (
				<p className="font-mono text-micro text-ink-600">
					{nWf} workflow{nWf === 1 ? "" : "s"} · {runs.filter((r) => !app || r.app === app).length} runs {span}
					{truncated && <> (the newest {runs.length})</>}
					{updated && <> · updated {updated}</>}
				</p>
			)}
		</div>
	);
}
