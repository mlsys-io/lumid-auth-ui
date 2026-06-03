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
	Activity, Play, Pause, Loader2, Save, Lightbulb, Clock, ArrowRight, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/api/client";
import { me, MeApiError, type MeWorkflowRow } from "@/api/me";
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
	app, loop, wf, loopHealth, onChanged,
}: {
	app: string;
	loop: string;
	wf: MeWorkflowRow;
	loopHealth?: LoopHealth;
	onChanged?: () => void;
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
	const [lastError, setLastError] = useState<string | null>(null);
	// Live running/event state — distinct from one-shot load motion.
	const [optimisticRun, setOptimisticRun] = useState(false);
	const [justRan, setJustRan] = useState(false);
	const [pulseStage, setPulseStage] = useState<LoopStageKey | null>(null);
	const [selectedStage, setSelectedStage] = useState<LoopStageKey | null>(null);
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

	const gate = summary?.observe_gate;
	const reviewQueue = Array.isArray(summary?.review_queue) ? summary!.review_queue! : [];
	const offers = Array.isArray(summary?.offers) ? summary!.offers! : [];

	const enabled = wf.enabled !== false;
	const dataRunning = (wf.run_spark || "").endsWith(".");
	const mode: LoopMode = !enabled ? "paused" : (optimisticRun || dataRunning) ? "running" : "idle";

	const loopCaption: React.ReactNode =
		justRan ? <span className="text-emerald-700 font-medium">✓ New cycle complete — insights updated</span>
		: mode === "running" ? "Iterating now — moving through the stages (scoring loops can take a few minutes)"
		: mode === "idle" ? (wf.next_run_ts ? <span>Armed · <NextRunCountdown nextTs={wf.next_run_ts} /></span> : "Armed — waiting for the next run")
		: "Paused";

	return (
		<div className="border-t border-slate-200/70 bg-slate-50/40 px-4 py-4 space-y-4 animate-in fade-in duration-300">
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
					app={app} loop={loop} stage={selectedStage} summary={summary}
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
					<RunSparkline spec={wf.run_spark || ""} />
					<span className="text-xs text-slate-500">{whenLast(wf.last_run_ts)}</span>
					{(loopHealth?.consecutive_failures ?? 0) > 0 && (
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

			{/* Footer — deep link into the full cycle inspector */}
			{cycleTs && (
				<Link
					to={`/studio/intents/cycle/${encodeURIComponent(app)}/${encodeURIComponent(loop)}/${encodeURIComponent(cycleTs)}`}
					className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-emerald-700 transition-colors"
				>
					Open last cycle <ArrowRight className="w-3 h-3" />
				</Link>
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
function StageDetail({
	app, loop, stage, summary, q, setQ, onClose,
}: {
	app: string; loop: string; stage: LoopStageKey; summary: CycleSummary | null;
	q: string; setQ: (v: string) => void; onClose: () => void;
}) {
	const info = STAGE_INFO[stage];
	const decisions = Array.isArray((summary as Record<string, unknown> | null)?.["decisions"])
		? ((summary as Record<string, unknown>)["decisions"] as unknown[]) : [];
	const reviewQueue = Array.isArray(summary?.review_queue) ? summary!.review_queue! : [];
	const offers = Array.isArray(summary?.offers) ? summary!.offers! : [];
	const gate = summary?.observe_gate;

	let body: React.ReactNode;
	switch (stage) {
		case "observe":
			body = gate ? `${gate.passed ? "Proceeded" : "Held"} — ${gate.reason || "evaluated the latest signals."}` : "Senses fresh signals at the start of each cycle.";
			break;
		case "hypothesize":
			body = decisions.length ? `${decisions.length} decision(s) formed from what it observed.` : "Forms a plan from what it observed.";
			break;
		case "act":
			body = reviewQueue.length ? `${reviewQueue.length} action(s) awaiting your approval below.` : offers.length ? `${offers.length} suggestion(s) surfaced below.` : "Runs the plan — drafting actions, holding risky ones for you.";
			break;
		case "analyze":
			body = "Reliability + month-over-month deltas are in Insights below.";
			break;
		case "learn":
			body = <>What it banks compounds into your <Link to="/studio/knowledge" className="text-emerald-700 hover:underline">knowledge</Link>.</>;
			break;
	}

	const ask = (e: React.FormEvent) => {
		e.preventDefault();
		const t = q.trim();
		if (!t) return;
		window.dispatchEvent(new CustomEvent("studio:ask", {
			detail: { prompt: `On ${app} / ${loop} — the ${info.label} stage: ${t}`, autosend: true },
		}));
		setQ("");
	};

	return (
		<div className="rounded-xl border border-emerald-200/70 bg-emerald-50/30 p-3 animate-in fade-in slide-in-from-top-1 duration-300">
			<div className="flex items-center justify-between gap-2">
				<div className="text-[13px] font-medium text-emerald-900">{info.label}</div>
				<button onClick={onClose} className="text-[11px] text-slate-400 hover:text-slate-700">close</button>
			</div>
			<div className="text-[11px] text-slate-500">{info.role}</div>
			<div className="text-xs text-slate-700 mt-1.5">{body}</div>
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
