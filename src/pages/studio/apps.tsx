// /studio/apps — the Studio spine.
//
//   /studio/apps        → My Apps home: a grid of app cards (live
//                         progress) above a "start a new intent" launcher.
//   /studio/apps/:app   → app overview: the app's workflows, each
//                         expandable to its observability panel
//                         (status + insights + suggested improvements).
//                         ?selected=<loop> deep-links an open panel.
//
// All data is real, via me.* — no mock. App identity + per-loop schedule
// come from me.loopsHealth(); per-workflow run health + sparklines from
// me.listWorkflows(); per-cycle observability from me.cycleDetail (inside
// the panel).

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Boxes, Sparkles, FileText, Brain, Activity, AlertTriangle } from "lucide-react";
import { me, type MeWorkflowRow } from "@/api/me";
import apiClient from "@/api/client";
import { setStudioSelection } from "@/components/StudioContext";
import RunSparkline from "@/components/RunSparkline";
import { Skeleton, humanizeLoop, loopLabel } from "@/pages/app-revamp/loops";
import { QuickStarters } from "@/pages/studio/intents";
import WorkflowComposer from "@/components/WorkflowComposer";
import AppCard, { appTitle, type AppIdentity } from "@/components/workflow/AppCard";
import WorkflowObservabilityPanel, { type LoopHealth } from "@/components/workflow/WorkflowObservabilityPanel";
import LoopOrbit, { type LoopMode, type LoopStageKey } from "@/components/workflow/LoopOrbit";
import { RUNNING_APPS } from "@/lib/demo";
import { useCountUp } from "@/lib/use-count-up";
import { cn } from "@/lib/utils";

// Scope the surface to the showcase apps (keeps the demo focused).
const inScope = (app?: string) => !app || (RUNNING_APPS as readonly string[]).includes(app);

// me.loopsHealth() is typed {apps} in the client, but the handler also
// returns `loops` (per-loop schedule/status). Read both via this shape.
type LoopsHealthResp = {
	apps?: Array<{ app: string; version?: string; kind?: string; published?: boolean; status?: string }>;
	loops?: LoopHealth[];
};

function loopOf(w: MeWorkflowRow): string {
	const app = w.app || "";
	if (app && w.slug.startsWith(app + ":")) return w.slug.slice(app.length + 1);
	const i = w.slug.indexOf(":");
	return i >= 0 ? w.slug.slice(i + 1) : w.slug;
}

function cycleTsToIso(ts: string): string {
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
	if (!m) return ts;
	const [, y, mo, d, h, mi, s] = m;
	return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

type TodayCycle = Awaited<ReturnType<typeof me.today>>["cycles"][number];

// A specific, human summary of a just-completed cycle for the AI-panel note
// (vs. a vague "insights updated").
function describeCycle(c: TodayCycle): string {
	const verb =
		c.outcome === "ran" ? "ran a full cycle"
		: c.outcome === "no_change" ? "observed — nothing new to act on"
		: c.outcome === "awaiting_review" ? "ran — items awaiting your review"
		: c.outcome === "no_setup" ? "needs setup"
		: c.ok === false ? "hit an error" : "ran";
	const bits: string[] = [];
	if (c.review_count) bits.push(`${c.review_count} to review`);
	if (c.offers_count) bits.push(`${c.offers_count} new suggestion${c.offers_count > 1 ? "s" : ""}`);
	if (typeof c.duration_s === "number" && c.duration_s > 0) bits.push(`${c.duration_s.toFixed(0)}s`);
	const extra = bits.length ? ` (${bits.join(" · ")})` : "";
	return `✓ ${appTitle(c.app)} · ${humanizeLoop(c.loop)} ${verb}${extra}. Ask me what changed.`;
}

// ══════════════════════════════════════════════════════════════════
//  My Apps home
// ══════════════════════════════════════════════════════════════════

interface Hero { apps: number; workflows: number; runsToday: number; drafts: number; memories: number; failing: number }

function AppsHome() {
	const [byApp, setByApp] = useState<Map<string, MeWorkflowRow[]> | null>(null);
	const [identity, setIdentity] = useState<Map<string, AppIdentity>>(new Map());
	const [hero, setHero] = useState<Hero | null>(null);
	const [selectedApp, setSelectedApp] = useState<string | null>(null);
	const [selectedLoop, setSelectedLoop] = useState<string | null>(null);
	const appsRef = useRef<HTMLDivElement>(null);
	// Aggregate loop state for the big LoopOrbit banner on the intent page.
	const [loopMode, setLoopMode] = useState<LoopMode>("idle");
	const [pulseStage, setPulseStage] = useState<LoopStageKey | null>(null);
	const [eventApp, setEventApp] = useState<string | null>(null);
	const prevMaxTsRef = useRef<string>("");

	// Composer host — folded in from the old Intents page. Opens on a
	// ?compose=1 deep-link and whenever the chat agent finishes a
	// compose_workflow (studio:composed).
	const [composerOpen, setComposerOpen] = useState(false);
	const [searchParams, setSearchParams] = useSearchParams();
	useEffect(() => {
		if (searchParams.get("compose") === "1") {
			setComposerOpen(true);
			const sp = new URLSearchParams(searchParams);
			sp.delete("compose");
			setSearchParams(sp, { replace: true });
		}
	}, [searchParams, setSearchParams]);
	useEffect(() => {
		const f = () => setComposerOpen(true);
		window.addEventListener("studio:composed", f);
		return () => window.removeEventListener("studio:composed", f);
	}, []);

	const load = useCallback(async () => {
			const [wfR, lhR, todayR, draftsR, agentsR] = await Promise.allSettled([
				me.listWorkflows(),
				me.loopsHealth(),
				me.today(),
				me.listDrafts({ state: "pending" }),
				apiClient.get("/api/v1/me/knowledge/agents"),
			]);

			const wfs = wfR.status === "fulfilled" ? (wfR.value.workflows || []).filter((w) => inScope(w.app)) : [];
			const m = new Map<string, MeWorkflowRow[]>();
			for (const w of wfs) {
				const k = w.app || "—";
				const a = m.get(k);
				if (a) a.push(w); else m.set(k, [w]);
			}
			setByApp(m);

			if (lhR.status === "fulfilled") {
				const apps = (lhR.value as unknown as LoopsHealthResp).apps || [];
				const im = new Map<string, AppIdentity>();
				for (const a of apps) im.set(a.app, { version: a.version, kind: a.kind, published: a.published, status: a.status });
				setIdentity(im);
			}

			let runsToday = 0;
			if (todayR.status === "fulfilled") {
				const start = new Date(); start.setHours(0, 0, 0, 0);
				const ms = start.getTime();
				for (const c of todayR.value.cycles) {
					const t = Date.parse(cycleTsToIso(c.ts));
					if (!isNaN(t) && t >= ms) runsToday++;
				}
			}
			const drafts = draftsR.status === "fulfilled" ? draftsR.value.drafts.length : 0;
			let memories = 0;
			if (agentsR.status === "fulfilled") {
				const ags = agentsR.value.data?.data?.agents || [];
				memories = ags.reduce((n: number, a: { memory_count?: number }) => n + (a.memory_count || 0), 0);
			}
			const failing = wfs.filter((w) => w.last_run_ok === false).length;
			setHero({ apps: m.size, workflows: wfs.length, runsToday, drafts, memories, failing });

			// Loop-event detection → drives the orbit banner. Running if any
			// cycle is mid-flight; a newer cycle ts than last poll = an event.
			const anyRunning = wfs.some((w) => w.running || (w.run_spark || "").endsWith("."));
			setLoopMode(anyRunning ? "running" : wfs.some((w) => w.enabled !== false) ? "idle" : "paused");
			let maxCycleTs = "";
			let freshCycle: TodayCycle | null = null;
			if (todayR.status === "fulfilled") {
				for (const c of todayR.value.cycles) {
					if (!inScope(c.app)) continue;
					if ((c.ts || "") > maxCycleTs) { maxCycleTs = c.ts || ""; freshCycle = c; }
				}
			}
			if (prevMaxTsRef.current && maxCycleTs && maxCycleTs !== prevMaxTsRef.current && freshCycle) {
				setPulseStage("learn");
				setEventApp(freshCycle.app);
				window.setTimeout(() => { setPulseStage(null); setEventApp(null); }, 3200);
				// Specific summary of what just ran (non-disruptive note).
				window.dispatchEvent(new CustomEvent("studio:notify", { detail: { message: describeCycle(freshCycle) } }));
			}
			if (maxCycleTs) prevMaxTsRef.current = maxCycleTs;
	}, []);

	// Poll so the home moves on its own — sparklines extend, counts tick.
	useEffect(() => {
		load();
		const id = window.setInterval(load, 20_000);
		return () => window.clearInterval(id);
	}, [load]);

	if (byApp === null) {
		return <div className="space-y-6"><div className="h-20 rounded-xl bg-slate-100 animate-pulse" /><Skeleton lines={3} /></div>;
	}

	const apps = [...byApp.keys()].sort();
	const fresh = apps.length === 0;

	return (
		<>
			<WorkflowComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
			{fresh ? (
				// Fresh user — lead with the launcher so they assemble app #1.
				<div className="space-y-6">
					<div className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-emerald-50 via-white to-sky-50/40 p-6">
						<div className="flex items-center gap-3">
							<div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center shadow-sm shadow-emerald-200">
								<Sparkles className="w-5 h-5" />
							</div>
							<div>
								<h2 className="text-xl font-medium text-slate-900 tracking-tight">Set up your first app.</h2>
								<p className="text-sm text-slate-600 mt-1">Pick a starter and your AI assembles, schedules, and runs it — then its progress lives here.</p>
							</div>
						</div>
					</div>
					<QuickStarters heading="Start with a starter" />
				</div>
			) : selectedApp ? (
				// A selected app takes the whole content area (slides in from
				// the right); the stat bar + grid + "Start a new intent" yield.
				<div key={selectedApp} className="space-y-4 panel-in-right overflow-x-hidden">
					<button
						onClick={() => { setSelectedApp(null); setSelectedLoop(null); }}
						className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 gap-1"
					>
						<ChevronRight className="w-4 h-4 rotate-180" /> All apps
					</button>
					<AppOverview app={selectedApp} embedded initialLoop={selectedLoop} />
				</div>
			) : (
				<div className="space-y-5 panel-in-left">
					{/* Numbers consolidated to a compact top bar. */}
					{hero && <HeroBar h={hero} onApps={() => appsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />}

					<div ref={appsRef} className="scroll-mt-4">
						<div className="text-[11px] tracking-[0.08em] font-semibold text-slate-400 uppercase mb-3">Your apps</div>
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
							{apps.map((a, i) => (
								<AppCard
									key={a} app={a} workflows={byApp.get(a)!} identity={identity.get(a)} index={i}
									onOpen={(ap, loop) => {
										setSelectedApp(ap); setSelectedLoop(loop ?? null);
										window.scrollTo({ top: 0, behavior: "smooth" });
									}}
								/>
							))}
						</div>
					</div>

					{/* Create is also one click here (the sidebar "+ New intent"
					    is the always-on primary). */}
					<div className="pt-1 border-t border-slate-200/60">
						<div className="pt-5"><QuickStarters heading="Start a new intent" /></div>
					</div>
				</div>
			)}
		</>
	);
}

// Compact top stat bar — a single thin row of inline, clickable stats
// (numbers consolidated to the top), including a failing count.
function HeroBar({ h, onApps }: { h: Hero; onApps: () => void }) {
	return (
		<div className="flex items-center flex-wrap gap-x-1 gap-y-1 -ml-2">
			<StatChip icon={Boxes} value={h.apps} label="apps" tone="text-emerald-600" onClick={onApps} />
			<StatChip icon={Activity} value={h.workflows} label="workflows" tone="text-emerald-600" onClick={onApps} />
			<StatChip icon={Sparkles} value={h.runsToday} label="runs today" tone="text-sky-600" to="/studio/runs" />
			<StatChip icon={FileText} value={h.drafts} label="drafts" tone="text-amber-600" to="/studio/inbox" />
			<StatChip icon={Brain} value={h.memories} label="memories" tone="text-indigo-600" to="/studio/knowledge" />
			{h.failing > 0 && <StatChip icon={AlertTriangle} value={h.failing} label="failing" tone="text-rose-600" onClick={onApps} />}
		</div>
	);
}

function StatChip({
	icon: Icon, value, label, tone, to, onClick,
}: {
	icon: React.ComponentType<{ className?: string }>;
	value: number; label: string; tone: string; to?: string; onClick?: () => void;
}) {
	const shown = Math.round(useCountUp(value));
	const inner = (
		<>
			<Icon className={cn("w-3.5 h-3.5", tone)} />
			<span className="font-semibold text-slate-800 tabular-nums">{shown}</span>
			<span className="text-slate-400">{label}</span>
		</>
	);
	const cls = "inline-flex items-center gap-1.5 text-[12px] rounded-lg px-2 py-1 hover:bg-slate-100/70 transition-colors";
	if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
	if (to) return <Link to={to} className={cls}>{inner}</Link>;
	return <div className={cls}>{inner}</div>;
}

// ══════════════════════════════════════════════════════════════════
//  App overview — workflows + expandable observability panels
// ══════════════════════════════════════════════════════════════════

interface Row { loop: string; wf: MeWorkflowRow; lh?: LoopHealth }

// Stale-while-revalidate caches so re-opening an app renders instantly
// (no skeleton flash) while a fresh fetch updates in the background.
const rowsCache = new Map<string, Row[]>();
const identCache = new Map<string, AppIdentity | undefined>();

function AppOverview({ app, embedded, initialLoop }: { app: string; embedded?: boolean; initialLoop?: string | null }) {
	const [rows, setRows] = useState<Row[] | null>(() => rowsCache.get(app) ?? null);
	const [identity, setIdentity] = useState<AppIdentity | undefined>(() => identCache.get(app));
	const [params, setParams] = useSearchParams();
	const selected = params.get("selected");

	const load = useCallback(async () => {
		const [lhR, wfR] = await Promise.allSettled([me.loopsHealth(), me.listWorkflows()]);
		const lhMap = new Map<string, LoopHealth>();
		if (lhR.status === "fulfilled") {
			const resp = lhR.value as unknown as LoopsHealthResp;
			for (const l of (resp.loops || []).filter((l) => l.app === app)) lhMap.set(l.loop, l);
			const ident = (resp.apps || []).find((a) => a.app === app);
			if (ident) { const id = { version: ident.version, kind: ident.kind, published: ident.published, status: ident.status }; identCache.set(app, id); setIdentity(id); }
		}
		// Drive from listWorkflows (tenant-correct) so the user's own
		// workflows always show; enrich with loop health when present.
		const wfs = wfR.status === "fulfilled" ? (wfR.value.workflows || []).filter((w) => w.app === app) : [];
		const next = wfs.map((w) => { const loop = loopOf(w); return { loop, wf: w, lh: lhMap.get(loop) }; });
		rowsCache.set(app, next);
		setRows(next);
	}, [app]);
	useEffect(() => {
		load();
		const id = window.setInterval(load, 20_000);
		return () => window.clearInterval(id);
	}, [load]);

	// Announce the active app so the chat agent knows what "pause it" means.
	useEffect(() => {
		setStudioSelection({ kind: "app", id: app, label: app, affordances: ["patch_loop (schedule/enabled)", "run_loop_now", "list_loops"] });
		return () => setStudioSelection(null);
	}, [app]);

	const toggle = (loop: string) => {
		const sp = new URLSearchParams(params);
		if (selected === loop) sp.delete("selected"); else sp.set("selected", loop);
		setParams(sp, { replace: true });
	};

	// Auto-expand the freshest workflow so landing on an app shows its
	// observability immediately (no extra click).
	const freshestLoop = rows && rows.length
		? [...rows].sort((a, b) => (b.wf.last_run_ts || 0) - (a.wf.last_run_ts || 0))[0].loop
		: null;
	const effSelected = selected ?? initialLoop ?? freshestLoop;

	return (
		<div className="space-y-5">
			{!embedded && (
				<Link to="/studio/apps" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 gap-1">
					<ChevronRight className="w-4 h-4 rotate-180" /> My Apps
				</Link>
			)}

			<header className="flex items-start gap-3">
				<div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
					<Boxes className="w-5 h-5" />
				</div>
				<div className="min-w-0">
					<h1 className="text-lg font-semibold text-slate-900">{appTitle(app)}</h1>
					<div className="text-xs text-slate-400 font-mono mt-0.5">
						{app}{identity?.version ? ` · v${identity.version}` : ""}{identity?.published ? " · published" : ""}
					</div>
				</div>
			</header>

			{rows === null ? (
				<Skeleton lines={3} />
			) : rows.length === 0 ? (
				<div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-sm text-slate-500">
					No workflows discovered for this app yet.
				</div>
			) : (
				<div className="space-y-2.5">
					<div className="text-[11px] tracking-[0.08em] font-semibold text-slate-400 uppercase">Workflows</div>
					<ul className="space-y-2">
						{rows.map(({ loop, wf, lh }, idx) => {
							const open = effSelected === loop;
							// Single failing predicate everywhere: last_run_ok===false (the
							// fresh journal truth). consecutive_failures (scheduler-state)
							// can lag behind a recovered run, so it must NOT drive red — that
							// was the "3 dots vs 1 count" mismatch.
							// Running takes visual precedence (live cycle now), then the
							// last-completed state. Keeps dots/counts on one predicate.
							const dot = wf.running ? "bg-sky-500 running-pulse"
								: wf.last_run_recovered ? "bg-amber-500"
								: wf.last_run_ok === true ? "bg-emerald-500"
								: wf.last_run_ok === false ? "bg-rose-500"
								: "bg-slate-300";
							return (
								<li
									key={loop}
									className="rounded-xl border border-slate-200 bg-white overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-500"
									style={{ animationDelay: `${idx * 60}ms`, animationFillMode: "both" }}
								>
									<button
										onClick={() => toggle(loop)}
										className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50/70 transition-colors"
									>
										{open ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
										<span className={cn("w-2 h-2 rounded-full flex-shrink-0", dot)} />
										<div className="min-w-0 flex-1">
											<div className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
												{loopLabel(wf.name, loop)}
												{wf.running && <span className="text-[10px] font-medium text-sky-600 inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500 running-pulse" />running…</span>}
											</div>
											{wf.enabled === false && <div className="text-[11px] text-slate-400">paused</div>}
										</div>
										<RunSparkline spec={wf.run_spark || ""} className="hidden sm:flex" />
									</button>
									{open && (
										<WorkflowObservabilityPanel app={app} loop={loop} wf={wf} loopHealth={lh} onChanged={load} />
									)}
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}

export default function StudioApps() {
	const { app } = useParams<{ app?: string }>();
	return app ? <AppOverview app={app} /> : <AppsHome />;
}
