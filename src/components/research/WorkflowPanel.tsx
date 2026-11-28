// WorkflowPanel — the research graph's pop-up panel for a workflow (and for a
// child node), docked at the right of the graph. Everything about a workflow
// happens here, so the app needs no other tabs (user, 2026-11-25: "some
// functions can be embedded into the graph UIUX, including the pop up panel"):
//
//   header    name · one status line · Run · Ask · ⋯ (Try setups, Make a
//             variant, Open its page, Pause, Delete)
//   Summary   five lines — asks · found · measured on · cost · built from —
//             then its last runs as dots and what's under it
//   Runs      its runs, live first; a row opens its answer in place
//   Steps     the workflow drawn as a graph (data → steps → feedback, or a
//             chain's stages), then what it's made of and its feedback (editable)
//   (Compare  A against B, only while a B is picked on the graph)
//
// Round 9 (2026-11-27, "the pop up panel needs scrubbing and simplification"):
// empty rows are hidden, never "—"; the five-button footer became the header.
// Every run starts from a button press here (manual dispatch, for this stage).

import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { LoopDefinition } from "@/api/me";
import { isEmptyLoop } from "@/workflow/adapters/xpio";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, GitBranch, MessagesSquare, Pencil, Play, Plus, Scale, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { me, type MeCycleDetail, type MeCycleListItem, type MeExperiment, type MeWorkflowRow } from "@/api/me";
import type { AppSpec, FeedbackStep, SpecNode, SpecWorkflow } from "@/lib/app-spec";
import { addNode, removeNode, renameNode, setFeedback, setWorkflowNode, addWorkflows } from "@/lib/app-spec";
import { compareVerdict, runMetricValues, sideStats, type SideStats } from "@/lib/compare";
import { workflowStatusLine, fmtAgo, fmtDuration, dirIdToSec } from "@/lib/activity";
import { humanId, versionsOf, experimentLabel, shortStatus, workflowPress } from "@/lib/research-map";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { humanMetric, fmtMetricValue, measuredLine } from "@/lib/run-answer";
import { instrumentChoices, instrumentName, measuredBy } from "@/lib/measure";
import { useInstruments } from "@/hooks/useInstruments";

const mLabel = (name: string) => humanMetric(name).label;
/** A metric value with its unit, the way the run page writes it. */
// fmtMetricValue writes the unit itself; adding it again doubled it.
const mVal = (name: string, v: number) => fmtMetricValue(v, humanMetric(name).unit, name);
import { compareHref, runPath, workflowPath } from "@/lib/run-routes";
import { RunSteps, StepProgress } from "@/components/research/ProgressDots";
import { stepsFromCycle } from "@/lib/progress-dots";
import { loopLabel } from "@/lib/workflow-names";
import { appTitle } from "@/components/workflow/AppCard";
import RunAnswerCard from "@/components/workflow/RunAnswerCard";
import WorkflowInsights from "@/components/workflow/WorkflowInsights";
// A panel's own forms (New variant, New experiment) open IN the panel, with
// Back — never as a popup over it (operator, 2026-11-28).
const VariantSheetBody = lazy(() => import("@/components/research/VariantSheet").then((m) => ({ default: m.VariantSheetBody })));
const TrySetupsBody = lazy(() => import("@/components/research/TrySetups").then((m) => ({ default: m.TrySetupsBody })));
const WorkflowShapeEditor = lazy(() => import("@/components/research/WorkflowShapeEditor"));
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PanelView = "overview" | "runs" | "compare" | "feedback";

/** What a graph selection names as a side of a comparison. */
export interface CompareSide { kind: "workflow" | "version"; id: string; label: string; exp?: MeExperiment }

export const wfLabel = (w: SpecWorkflow) => w.title || loopLabel("", w.id);
const ask = (prompt: string, context: Record<string, unknown>) =>
	window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt, context } }));

// ── data ──────────────────────────────────────────────────────────────────

const cyclesCache = new Map<string, { at: number; cycles: MeCycleListItem[] }>();
/** A workflow's recent runs (newest first); polls every 5 s while one is running. */
export function useCycles(app: string, loop: string | null, limit = 40) {
	const key = `${app}:${loop}:${limit}`;
	const [cycles, setCycles] = useState<MeCycleListItem[] | null>(() => (loop ? cyclesCache.get(key)?.cycles ?? null : null));
	const load = useCallback(async () => {
		if (!loop) return;
		try {
			const r = await me.cyclesList(app, loop, limit);
			const c = (r.cycles || []).slice().sort((a, b) => (dirIdToSec(b.ts) ?? 0) - (dirIdToSec(a.ts) ?? 0));
			cyclesCache.set(key, { at: Date.now(), cycles: c });
			setCycles(c);
		} catch { setCycles((cur) => cur ?? []); }
	}, [app, loop, key, limit]);
	useEffect(() => { setCycles(loop ? cyclesCache.get(key)?.cycles ?? null : null); void load(); }, [key, loop, load]);
	const running = !!cycles?.some((c) => c.running);
	useEffect(() => {
		if (!running) return;
		const t = window.setInterval(() => void load(), 5000);
		return () => window.clearInterval(t);
	}, [running, load]);
	return { cycles, reload: load };
}

/** The run's value for `metric` from the list row (its headline metric). */
export function keyValue(c: MeCycleListItem, metric?: string): number | null {
	const km = c.key_metric;
	if (typeof km === "number") return Number.isFinite(km) ? km : null;
	if (km && typeof km.value === "number" && (!metric || !km.name || km.name === metric)) return km.value;
	return null;
}

const detailCache = new Map<string, MeCycleDetail>();
function useLatestMetrics(app: string, loop: string, cycles: MeCycleListItem[] | null) {
	// The newest run that MEASURED something (list rows carry key_metric when it
	// did): a poll with nothing to resolve is still a run, and used to blank the
	// feedback block although the run before it had a P&L.
	const done = cycles?.filter((c) => !c.running && c.ok !== undefined) ?? [];
	const last = done.find((c) => c.key_metric != null) ?? done[0];
	const [m, setM] = useState<Record<string, unknown> | null>(null);
	useEffect(() => {
		if (!last) { setM(null); return; }
		const k = `${app}:${loop}:${last.ts}`;
		const hit = detailCache.get(k);
		if (hit) { setM(hit.summary?.metrics ?? null); return; }
		let live = true;
		me.cycleDetail(app, loop, last.ts).then((d) => { detailCache.set(k, d); if (live) setM(d.summary?.metrics ?? null); }).catch(() => {});
		return () => { live = false; };
	}, [app, loop, last?.ts, last]);
	return m;
}

// ── shell ─────────────────────────────────────────────────────────────────

function PanelShell({ kicker, title, sub, onClose, onBack, backLabel, children, foot, actions, label, style, page = false }: {
	kicker: string; title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode; label: string; style?: React.CSSProperties;
	/** A view inside the panel (a form): Back returns to the panel, and Esc does too. */
	onBack?: () => void; backLabel?: string;
	/** The panel's verbs, beside its title (Run · Ask · ⋯). */
	actions?: React.ReactNode;
	/** The workflow's own page: the same panel, full width, in the flow. */
	page?: boolean;
}) {
	useEffect(() => {
		// A page has nothing to close, but a form in it still goes Back on Esc.
		if (page && !onBack) return;
		const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") (onBack ?? onClose)(); };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose, onBack, page]);
	return (
		<div role={page ? "region" : "dialog"} aria-label={label} style={style}
			className={page
				? "flex w-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-card shadow-e1"
				: "absolute right-3 top-12 z-[6100] flex w-[22rem] max-w-[48%] flex-col overflow-hidden rounded-xl border border-ink-200 bg-card shadow-e3 map-panel-in 2xl:w-[26rem]"}>
			<div className="space-y-1 border-b border-ink-100 px-3.5 pb-2.5 pt-3">
				<div className="flex items-center gap-2">
					{onBack && (
						<button type="button" onClick={onBack} aria-label={backLabel ?? "Back"} title={`${backLabel ?? "Back"} (Esc)`}
							className="-ml-1 inline-flex h-6 items-center gap-1 rounded-md px-1 text-caption text-ink-700 hover:bg-ink-100 hover:text-ink-900">
							<ArrowLeft className="h-3.5 w-3.5" />
						</button>
					)}
					<span className="eyebrow text-plum-700">{kicker}</span>
					{!page && (
						<button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"
							className="ml-auto -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 hover:text-ink-900">
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1 text-title font-semibold leading-snug text-ink-900">{title}</div>
					{actions && <div className="flex flex-shrink-0 items-center gap-1">{actions}</div>}
				</div>
				{sub}
			</div>
			{children}
			{foot && <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 bg-muted/30 px-3 py-2">{foot}</div>}
		</div>
	);
}

// ── workflow panel ────────────────────────────────────────────────────────

export default function WorkflowPanel({ app, wf, spec, row, exps, view, onView, compareWith, onPickCompare, onSelect, save, editable, onClose, style, page = false }: {
	app: string;
	wf: SpecWorkflow;
	spec: AppSpec;
	row?: MeWorkflowRow;
	exps: MeExperiment[];
	view: PanelView;
	onView: (v: PanelView) => void;
	/** B, when the reader picked one on the graph. */
	compareWith: CompareSide | null;
	/** Start picking B on the graph (the next click). */
	onPickCompare: () => void;
	/** Unused: New variant and New experiment open in this panel (kept so callers compile). */
	onMakeVariant?: () => void;
	onTrySetups?: () => void;
	onSelect: (graphId: string) => void;
	save: (edit: (t: string) => string, files?: Array<{ path: string; content: string }>) => Promise<unknown>;
	editable: boolean;
	onClose: () => void;
	style?: React.CSSProperties;
	/** Rendered as the workflow's own page (full width) rather than over the graph. */
	page?: boolean;
}) {
	const [limit, setLimit] = useState(40);
	const { cycles, reload } = useCycles(app, wf.id, limit);
	// A form shown in this panel in place of its tabs (Back returns).
	const [form, setForm] = useState<null | "variant" | "setups">(null);
	useEffect(() => { setForm(null); }, [wf.id]);
	const onMakeVariant = () => setForm("variant");
	const onTrySetups = () => setForm("setups");
	// null = still reading: never say "Hasn't run yet" about a list we haven't read.
	const status = useMemo(() => (cycles === null
		? { tone: "none" as const, text: "Reading its runs…" }
		: workflowStatusLine(cycles.map((c) => ({ ts: c.ts, ok: c.ok, running: c.running, duration_s: c.duration_s })))), [cycles]);
	const running = !!cycles?.some((c) => c.running) || !!row?.running;
	const [busy, setBusy] = useState(false);
	const runNow = async () => {
		setBusy(true);
		try {
			await me.launchRun(app, wf.id, {});
			toast.success(`${wfLabel(wf)} started`, { description: "It shows under Runs as it goes." });
			onView("runs");
			window.setTimeout(() => void reload(), 1500);
		} catch (e) {
			toast.error(`Couldn't start ${wfLabel(wf)}`, { description: String((e as Error).message || e) });
		} finally { setBusy(false); }
	};
	const variants = spec.workflows.filter((w) => w.parent === wf.id && !w.helper);
	const helpers = spec.workflows.filter((w) => w.parent === wf.id && w.helper);
	const ownExps = exps.filter((e) => (e.dispatch?.loop || e.loops?.[0]) === wf.id);
	const press = workflowPress(ownExps);
	const toneCls = status.tone === "ok" ? "text-gold-700" : status.tone === "failing" ? "text-brick-700" : "text-ink-600";
	const sub = (
		<div className="space-y-2">
			<div className={cn("flex items-center gap-1.5 text-caption font-medium", running ? "text-lagoon-700" : toneCls)}>
				<span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-lagoon-500 animate-lumen-breathe" : status.tone === "ok" ? "bg-gold-500" : status.tone === "failing" ? "bg-brick-500" : "bg-ink-400")} />
				{running ? "Running now" : status.text}
			</div>
			{/* The verbs, in plain sight: run it, try values of one input (a new
			    experiment), or make a changed copy (a new variant). Nothing new runs
			    until you press Run. */}
			<div className="flex flex-wrap items-center gap-1.5">
				{press.versions ? (
					// It feeds experiments: the press that counts runs versions of one
					// (the experiment's own Run button, priced there).
					ownExps.length === 1 ? (
						<Button size="sm" variant="accent" onClick={() => onSelect(`exp:${ownExps[0].id}`)} title={`Open ${experimentLabel(ownExps[0])} to run its versions`}>
							<Play className="h-3.5 w-3.5" />{press.label}
						</Button>
					) : (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button size="sm" variant="accent"><Play className="h-3.5 w-3.5" />{press.label}</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="w-72">
								{ownExps.map((e) => (
									<DropdownMenuItem key={e.id} onSelect={() => onSelect(`exp:${e.id}`)} className="flex flex-col items-start gap-0">
										<span className="text-caption text-ink-900">{experimentLabel(e)}</span>
										<span className="text-micro text-ink-600">{shortStatus(e).text}</span>
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)
				) : null}
				<Button size="sm" variant={press.versions ? "ghost" : "accent"} onClick={runNow} disabled={busy || running} aria-label={`${press.plainLabel}: ${wfLabel(wf)}`} title={press.plainTitle}>
					<Play className="h-3.5 w-3.5" />{running ? "Running…" : press.plainLabel}
				</Button>
				<Button size="sm" variant="secondary" onClick={onTrySetups} title="Try values of one input — one version per value, compared on a metric">
					<Plus className="h-3.5 w-3.5" />New experiment
				</Button>
				<Button size="sm" variant="secondary" onClick={onMakeVariant} disabled={!editable} title={editable ? "A workflow made from this one: changed steps, data, compute or feedback" : "Install your own copy to change it"}>
					<GitBranch className="h-3.5 w-3.5" />New variant
				</Button>
				<MoreVerbs app={app} wf={wf} row={row} editable={editable} />
			</div>
		</div>
	);
	if (form) {
		const back = () => setForm(null);
		const wider = !page && style ? { ...style, width: Math.max(Number(style.width) || 0, 600) } : style;
		const isVariant = form === "variant";
		return (
			<PanelShell kicker={isVariant ? "New variant" : "New experiment"} title={wfLabel(wf)} onClose={onClose} onBack={back} backLabel={`Back to ${wfLabel(wf)}`}
				label={`${isVariant ? "New variant of" : "New experiment on"} ${wfLabel(wf)}`} style={wider} page={page}
				sub={<p className="text-caption text-ink-600">{isVariant
					? "A new workflow made from this one — change its steps, data, compute or feedback. It runs only when you start it."
					: "Try values of one input: one version per value, compared on one metric. Nothing runs until you press Run."}</p>}>
				<Suspense fallback={<div className="m-3 h-40 rounded-lg lumen-skeleton" role="status" aria-label="Opening the form" />}>
					{isVariant
						? <div className="flex min-h-0 flex-1 flex-col"><VariantSheetBody app={app} parent={wf} spec={spec} save={save} onClose={back} onCreated={(ids) => { back(); if (ids[0]) onSelect(`wf:${ids[0]}`); }} /></div>
						: <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3"><TrySetupsBody app={app} wf={wf} spec={spec} onCreated={(id) => { back(); onSelect(`exp:${id}`); }} /></div>}
				</Suspense>
			</PanelShell>
		);
	}
	const askAbout = () => ask(`How is ${wfLabel(wf)} in ${appTitle(app)} doing, and what should it try next? Look at its recent runs and their metrics first; cite run ids. Suggest the next runs, but start nothing.`, { app, workflow: wf.id });
	// Compare is a tab only while a B is picked (⇧-click on the graph).
	const tabs = [{ value: "overview", label: "Summary" }, { value: "runs", label: "Runs" }, { value: "feedback", label: "Steps" }];
	if (view === "compare" || compareWith) tabs.push({ value: "compare", label: "Compare" });
	return (
		<PanelShell kicker={wf.parent ? "Variant" : "Workflow"} title={wfLabel(wf)} sub={sub} onClose={onClose} label={`Workflow: ${wfLabel(wf)}`} style={style} page={page}
			actions={<>
				<button type="button" onClick={askAbout} aria-label="Ask about it" title="Ask the chat how it's doing and what to try next"
					className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-700 hover:bg-ink-100 hover:text-ink-900">
					<MessagesSquare className="h-4 w-4" />
				</button>

			</>}>
			<div className="border-b border-ink-100 px-3 py-1.5">
				<Segmented size="sm" aria-label="Panel view" value={view === "compare" && !tabs.some((t) => t.value === "compare") ? "overview" : view} onChange={(v) => onView(v as PanelView)} options={tabs} />
			</div>
			<div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3", page && "md:px-5 md:py-4")}>
				{view === "overview" && <OverviewView app={app} wf={wf} spec={spec} row={row} cycles={cycles} variants={variants} exps={ownExps} onSelect={onSelect} onView={onView} />}
				{view === "runs" && <RunsView app={app} wf={wf} cycles={cycles} canMore={(cycles?.length ?? 0) >= limit} onMore={() => setLimit((l) => l + 40)} onChanged={() => void reload()} />}
				{view === "compare" && <CompareView app={app} a={{ kind: "workflow", id: wf.id, label: wfLabel(wf) }} b={compareWith} wf={wf} spec={spec} onPick={onPickCompare} />}
				{view === "feedback" && <SetupView app={app} wf={wf} spec={spec} row={row} cycles={cycles} helpers={helpers} save={save} editable={editable} />}
			</div>
		</PanelShell>
	);
}

// ── ⋯ : Pause / Resume (only where a schedule exists) and Delete ──────────

/** The rest of the verbs, in plain sight beside Run (2026-11-27: "the ... menu
 *  in variant is obscure, just move the items out"). */
function MoreVerbs({ app, wf, row, editable }: { app: string; wf: SpecWorkflow; row?: MeWorkflowRow; editable: boolean }) {
	const scheduled = wf.run !== "manual";
	const paused = row?.enabled === false;
	const toggle = async () => {
		try {
			await me.patchLoop(app, wf.id, { enabled: paused });
			window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["workflows", "loops"] } }));
			toast.success(paused ? `${wfLabel(wf)} runs on its schedule again` : `${wfLabel(wf)} paused — it runs only when you press Run`);
		} catch (e) { toast.error("Couldn't change it", { description: String((e as Error).message || e) }); }
	};
	const del = async () => {
		const { deleteWorkflow } = await import("@/lib/delete-workflow");
		await deleteWorkflow(app, appTitle(app), wf.id, wfLabel(wf));
	};
	const quiet = "inline-flex h-8 items-center gap-1 rounded-md px-2 text-caption text-ink-700 hover:bg-ink-100 hover:text-ink-900";
	return <>
		<Link to={workflowPath(app, wf.id)} className={quiet} title="Its own page: every run, its data and its definition"><ArrowRight className="h-3.5 w-3.5" />Its page</Link>
		{editable && scheduled && <button type="button" onClick={toggle} className={quiet}>{paused ? "Resume schedule" : "Pause schedule"}</button>}
		{editable && <button type="button" onClick={del} className={cn(quiet, "text-brick-700 hover:bg-brick-50 hover:text-brick-800")} title="Delete this workflow (asks first)"><Trash2 className="h-3.5 w-3.5" />Delete</button>}
	</>;
}

// ── Summary ───────────────────────────────────────────────────────────────

function metricLine(name: string, v: unknown, target?: number, better?: "higher" | "lower") {
	const val = typeof v === "number" ? v : Number(v);
	const has = v != null && Number.isFinite(val);
	const met = has && target != null ? (better === "lower" ? val <= target : val >= target) : null;
	return { has, label: mLabel(name), value: has ? mVal(name, val) : "", target: target != null ? mVal(name, target) : null, met };
}

/** The declared feedback metrics, or the legacy primary metric. */
function feedbackSteps(wf: SpecWorkflow): FeedbackStep[] {
	return wf.feedback.length ? wf.feedback : wf.primary ? [{ step: "result", metrics: [{ name: wf.primary, better: "higher" as const }] }] : [];
}

/** One dot per run, newest on the right — "a dot is a run". */
function RunDotsLine({ cycles, onOpen }: { cycles: MeCycleListItem[]; onOpen: () => void }) {
	const last = cycles.slice(0, 20).reverse();
	if (!last.length) return null;
	const failed = last.filter((c) => !c.running && c.ok === false).length;
	return (
		<button type="button" onClick={onOpen} className="group block w-full space-y-1 rounded-md text-left" title="Open its runs">
			<span className="flex items-baseline gap-2 text-caption">
				<span className="text-ink-600">Last {last.length} run{last.length === 1 ? "" : "s"}{failed ? ` · ${failed} failed` : ""}</span>
				<span className="ml-auto whitespace-nowrap text-micro text-ink-600 group-hover:text-ink-900">all runs ›</span>
			</span>
			<span className="flex items-center gap-[3px]">
				{last.map((c) => (
					<span key={c.ts} aria-label={`${fmtAgo(dirIdToSec(c.ts) ?? 0)} — ${c.running ? "running" : c.ok ? "done" : "failed"}`}
						className={cn("h-2 w-2 flex-shrink-0 rounded-sm", c.running ? "bg-lagoon-500 animate-lumen-breathe" : c.ok ? "bg-gold-500" : "bg-brick-500")} />
				))}
			</span>
		</button>
	);
}

function OverviewView({ app, wf, spec, row, cycles, variants, exps, onSelect, onView }: {
	app: string; wf: SpecWorkflow; spec: AppSpec; row?: MeWorkflowRow; cycles: MeCycleListItem[] | null;
	variants: SpecWorkflow[]; exps: MeExperiment[]; onSelect: (id: string) => void; onView: (v: PanelView) => void;
}) {
	const latest = useLatestMetrics(app, wf.id, cycles);
	const measured = measuredLine(latest);
	const found = feedbackSteps(wf).flatMap((st) => st.metrics.map((m) => ({ m, l: metricLine(m.name, latest?.[m.name], m.target, m.better) }))).filter((x) => x.l.has);
	const parent = wf.parent ? spec.workflows.find((w) => w.id === wf.parent) : undefined;
	const cost = row?.cost_cents_mtd ? `$${(row.cost_cents_mtd / 100).toFixed(2)} this month` : null;
	// Sakana-style five lines; a line with nothing to say is left out.
	const lines: Array<[string, React.ReactNode]> = [];
	if (wf.about) lines.push(["Asks", <span className="line-clamp-3" title={wf.about}>{wf.about}</span>]);
	lines.push(["Found", found.length ? (
		<span className="space-y-0.5">
			{found.slice(0, 4).map(({ m, l }) => (
				<span key={m.name} className="flex flex-wrap items-baseline gap-x-1.5">
					<span className="text-ink-700">{l.label}</span>
					<span className="font-mono tabular-nums text-ink-900">{l.value}</span>
					{l.target && <span className={cn("text-micro", l.met === true ? "text-gold-700" : l.met === false ? "text-brick-700" : "text-ink-600")}>{l.met === true ? "meets" : l.met === false ? "misses" : "aim"} {m.better === "lower" ? "≤" : "≥"} {l.target}</span>}
				</span>
			))}
		</span>
	) : cycles === null ? <span className="text-ink-600">Reading its runs…</span> : cycles.length === 0 ? <span className="text-ink-600">{workflowPress(exps.filter((e) => (e.dispatch?.loop || e.loops?.[0]) === wf.id)).versions ? "No results yet: run versions of its experiment to get the first." : "No results yet: press Run to get the first."}</span> : <span className="text-ink-600">{workflowPress(exps.filter((e) => (e.dispatch?.loop || e.loops?.[0]) === wf.id)).found}</span>]);
	if (measured) lines.push(["Measured", <span className={measured.measured ? "text-ink-800" : "text-ember-700"}>{measured.text.replace(/^Measured on:?\s*/i, "")}</span>]);
	if (cost) lines.push(["Cost", cost]);
	if (parent) lines.push(["Built from", <button type="button" onClick={() => onSelect(`wf:${parent.id}`)} className="text-left text-ink-900 hover:underline">Variant of {wfLabel(parent)}</button>]);
	return (
		<div className="space-y-3.5">
			<dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1.5 text-caption">
				{lines.map(([k, v]) => (<Fragment key={k}><dt className="text-ink-600">{k}</dt><dd className="min-w-0 text-ink-900">{v}</dd></Fragment>))}
			</dl>
			{cycles && cycles.length > 0 && <RunDotsLine cycles={cycles} onOpen={() => onView("runs")} />}
			{(exps.length > 0 || variants.length > 0) && (
				<section aria-label="Under it" className="space-y-1">
					<h3 className="eyebrow">Under it</h3>
					{exps.map((e) => (
						<button key={e.id} type="button" onClick={() => onSelect(`exp:${e.id}`)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-caption hover:bg-ink-50">
							<span className="h-2 w-2 rounded-full bg-plum-500" /><span className="text-ink-900">{experimentLabel(e)}</span>
							<span className="ml-auto text-micro text-ink-600">{versionsOf(e).length} versions</span>
						</button>
					))}
					{variants.map((v) => (
						<button key={v.id} type="button" onClick={() => onSelect(`wf:${v.id}`)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-caption hover:bg-ink-50">
							<GitBranch className="h-3 w-3 text-plum-600" /><span className="text-ink-900">{wfLabel(v)}</span>
							<span className="ml-auto text-micro text-ink-600">variant</span>
						</button>
					))}
				</section>
			)}
			{row && <WorkflowInsights slug={row.slug} knownRuns={cycles?.length ?? 0} />}
		</div>
	);
}

// ── Steps: the workflow as a graph ────────────────────────────────────────

const WorkflowCanvas = lazy(() => import("@/components/workflow/WorkflowCanvas"));

/** How the workflow is built, drawn (2026-11-27: "I don't know what 'setup' is
 *  used for — why not a workflow construction DAG like n8n?"). A workflow with
 *  declared steps draws on the node canvas; a code or chain workflow draws its
 *  shape — data → its steps → how each run is measured. */
function StepsGraph({ app, wf, spec, cycles }: { app: string; wf: SpecWorkflow; spec: AppSpec; cycles: MeCycleListItem[] | null }) {
	const [def, setDef] = useState<LoopDefinition | null | undefined>(undefined);
	const [cycle, setCycle] = useState<MeCycleDetail | null>(null);
	useEffect(() => {
		let live = true;
		setDef(undefined);
		me.workflowDetail(`${app}:${wf.id}`).then((r) => { if (live) setDef((r.definition || null) as LoopDefinition | null); }).catch(() => { if (live) setDef(null); });
		return () => { live = false; };
	}, [app, wf.id]);
	const last = cycles?.find((c) => !c.running && c.ok !== undefined);
	useEffect(() => {
		if (!last) { setCycle(null); return; }
		let live = true;
		me.cycleDetail(app, wf.id, last.ts).then((d) => { if (live) setCycle(d); }).catch(() => {});
		return () => { live = false; };
	}, [app, wf.id, last?.ts, last]);
	if (def === undefined) return <div className="h-40 rounded-lg lumen-skeleton" role="status" aria-label="Reading its steps" />;
	// A chain draws its stages: the scheduler's definition of a chain is one
	// generic command node, which hid Simulate → Sandbox behind "command".
	if (def && !isEmptyLoop(def) && !wf.steps.workflows?.length) {
		return (
			<div className="overflow-hidden rounded-lg border border-ink-200" data-steps-canvas>
				<Suspense fallback={<div className="h-56 lumen-skeleton" />}>
					<WorkflowCanvas definition={def} cycle={cycle} mode="showcase" height={260} />
				</Suspense>
			</div>
		);
	}
	// No declared steps (a code workflow, or a chain): draw its shape.
	const stages = wf.steps.workflows?.map((st) => (typeof st === "string" ? st : st.use)) ?? [];
	const box = "rounded-lg border bg-card px-2.5 py-1.5 text-caption shadow-e1";
	const nodes: Array<{ kind: string; title: string; sub?: string; tone: string }> = [];
	if (wf.data.length) nodes.push({ kind: "Data", title: wf.data.join(", "), tone: "border-lagoon-200" });
	if (stages.length) stages.forEach((id, i) => nodes.push({ kind: `Stage ${i + 1}`, title: wfLabel(spec.workflows.find((w) => w.id === id) ?? ({ id } as SpecWorkflow)), sub: i ? "gets the stage before's results" : undefined, tone: "border-plum-300" }));
	else if (wf.steps.python) nodes.push({ kind: "Steps", title: `commands/${wf.steps.python}.py`, sub: Object.keys(wf.inputs).length ? `inputs: ${Object.keys(wf.inputs).join(", ")}` : undefined, tone: "border-plum-300" });
	else if (wf.steps.dag) nodes.push({ kind: "Steps", title: wf.steps.dag, tone: "border-plum-300" });
	else if (wf.steps.skills?.length) wf.steps.skills.forEach((k, i) => nodes.push({ kind: `Step ${i + 1}`, title: k, tone: "border-plum-300" }));
	for (const f of feedbackSteps(wf)) nodes.push({ kind: "Measured by", title: humanId(f.step), sub: f.metrics.map((m) => mLabel(m.name)).join(", "), tone: "border-gold-300" });
	if (!nodes.length) return <p className="text-caption text-ink-600">It declares no steps yet.</p>;
	return (
		<ol className="flex flex-col items-stretch gap-0" aria-label="How it is built" data-steps-flow>
			{nodes.map((n, i) => (
				<li key={i} className="flex flex-col items-center">
					{i > 0 && <span aria-hidden className="h-3 w-px bg-ink-300" />}
					<div className={cn(box, "w-full", n.tone)}>
						<div className="eyebrow">{n.kind}</div>
						<div className="truncate font-medium text-ink-900" title={n.title}>{n.title}</div>
						{n.sub && <div className="truncate text-micro text-ink-600">{n.sub}</div>}
					</div>
				</li>
			))}
		</ol>
	);
}

// ── Setup: what it's made of + its feedback ───────────────────────────────

function SetupView({ app, wf, spec, row, cycles, helpers, save, editable }: {
	app: string; wf: SpecWorkflow; spec: AppSpec; row?: MeWorkflowRow; cycles: MeCycleListItem[] | null; helpers: SpecWorkflow[];
	save: (edit: (t: string) => string, files?: Array<{ path: string; content: string }>) => Promise<unknown>; editable: boolean;
}) {
	const [editing, setEditing] = useState(false);
	useEffect(() => { setEditing(false); }, [wf.id]);
	const compute = { ...spec.compute, ...wf.compute };
	const rows: Array<[string, React.ReactNode]> = [];
	const steps = wf.steps.workflows?.length ? wf.steps.workflows.map((st) => { const id = typeof st === "string" ? st : st.use; const w = spec.workflows.find((x) => x.id === id); return w ? wfLabel(w) : id; }).join(" → ") : wf.steps.python ? <>Python <code className="font-mono text-micro">commands/{wf.steps.python}.py</code></> : wf.steps.dag ? <>A step graph <code className="font-mono text-micro">{wf.steps.dag}</code></> : wf.steps.skills?.length ? wf.steps.skills.join(" → ") : null;
	if (steps) rows.push(["Steps", steps]);
	if (Object.keys(wf.inputs).length) rows.push(["Inputs", <span className="font-mono text-micro text-ink-800">{Object.entries(wf.inputs).map(([k, v]) => `${k}=${String(v) || "…"}`).join(" · ")}</span>]);
	if (wf.data.length) rows.push(["Data", wf.data.join(", ")]);
	rows.push(["Compute", compute.site ? `${compute.site}${compute.gpu ? ` · GPU ${compute.gpu}` : ""}` : "the app's default"]);
	rows.push(["Starts", wf.run === "manual" ? "When you press Run" : `On its own (${row?.trigger || wf.run}) — and when you press Run`]);
	if (helpers.length) rows.push(["Helpers", helpers.map(wfLabel).join(", ")]);
	// Whether its shape can be changed here; the older loops form is changed in Manage → Spec.
	const canShape = editable && !wf.legacy;
	return (
		<div className="space-y-4">
			{editing ? (
				<Suspense fallback={<div className="h-56 rounded-lg lumen-skeleton" role="status" aria-label="Opening the editor" />}>
					<WorkflowShapeEditor app={app} wf={wf} spec={spec} save={save} onDone={() => setEditing(false)} />
				</Suspense>
			) : (
				<>
					<div className="flex items-center gap-2">
						<h3 className="eyebrow">How it&apos;s built</h3>
						{canShape && (
							<Button size="sm" variant="secondary" className="ml-auto" onClick={() => setEditing(true)} title="Change its steps, data, inputs and where it runs">
								<Pencil className="h-3.5 w-3.5" />Edit
							</Button>
						)}
					</div>
					<StepsGraph app={app} wf={wf} spec={spec} cycles={cycles} />
					<section aria-label="What it's made of" className="space-y-1">
						<h3 className="eyebrow">What it&apos;s made of</h3>
						<dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-caption">
							{rows.map(([k, v]) => (<Fragment key={k}><dt className="text-ink-600">{k}</dt><dd className="min-w-0 text-ink-900">{v}</dd></Fragment>))}
						</dl>
						{editable && wf.legacy && <p className="text-micro text-ink-600">It is written in the older format; change it in Manage → Spec.</p>}
					</section>
				</>
			)}
			<FeedbackView app={app} wf={wf} cycles={cycles} save={save} editable={editable} />
		</div>
	);
}

// ── Runs ──────────────────────────────────────────────────────────────────

function RunsView({ app, wf, cycles, canMore, onMore, onChanged }: {
	app: string; wf: SpecWorkflow; cycles: MeCycleListItem[] | null;
	canMore: boolean; onMore: () => void; onChanged: () => void;
}) {
	const [open, setOpen] = useState<string | null>(null);
	// null = reading; false = this run's detail can't be read here (some
	// workflows keep only the run's row, not its folder).
	const [detail, setDetail] = useState<MeCycleDetail | null | false>(null);
	const [picked, setPicked] = useState<string[]>([]);
	const [busy, setBusy] = useState<string | null>(null);
	useEffect(() => {
		if (!open) { setDetail(null); return; }
		let live = true;
		setDetail(null);
		me.cycleDetail(app, wf.id, open).then((d) => { if (live) setDetail(d); }).catch(() => { if (live) setDetail(false); });
		return () => { live = false; };
	}, [app, wf.id, open]);
	if (cycles === null) return <p className="text-caption text-ink-600" role="status">Reading its runs…</p>;
	if (!cycles.length) return <p className="text-caption text-ink-600">No runs yet. Press Run to start one.</p>;
	const ordered = [...cycles.filter((c) => c.running), ...cycles.filter((c) => !c.running)];
	const pick = (ts: string) => setPicked((p) => (p.includes(ts) ? p.filter((x) => x !== ts) : p.length >= 5 ? p : [...p, ts]));
	const cancel = async () => {
		setBusy("cancel");
		try { await me.stopLoop(app, wf.id); toast.success(`Cancelling ${wfLabel(wf)}'s run`, { description: "It stops at its next step." }); onChanged(); }
		catch (e) { toast.error("Couldn't cancel it", { description: String((e as Error).message || e) }); }
		finally { setBusy(null); }
	};
	const mark = async (ts: string, verdict: "keep" | "discard") => {
		setBusy(ts);
		try {
			if (verdict === "keep") await me.promoteRun(app, ts, undefined, wf.id); else await me.discardRun(app, ts, undefined, wf.id);
			toast.success(verdict === "keep" ? "Kept — what this run learned carries forward" : "Discarded — what this run learned is dropped");
			onChanged();
		} catch (e) { toast.error("Couldn't mark it", { description: String((e as Error).message || e) }); }
		finally { setBusy(null); }
	};
	return (
		<div className="space-y-2">
			<ul className="space-y-1" aria-label={`Runs of ${wfLabel(wf)}`}>
				{ordered.map((c) => {
					const sec = dirIdToSec(c.ts);
					const v = keyValue(c);
					const label = c.running ? "Running" : c.ok ? "Succeeded" : c.ok === false ? "Failed" : "Ended";
					const isOpen = open === c.ts;
					return (
						<li key={c.ts} className={cn("rounded-lg border", isOpen ? "border-plum-200" : c.running ? "border-lagoon-200" : "border-ink-100")}>
							<div className="flex items-center gap-2 px-2 py-1.5 text-caption">
								{!c.running ? (
									<input type="checkbox" checked={picked.includes(c.ts)} onChange={() => pick(c.ts)} aria-label={`Compare the run from ${sec ? fmtAgo(sec) : c.ts}`}
										className="h-3.5 w-3.5 flex-shrink-0 accent-plum-700" />
								) : <span className="w-3.5 flex-shrink-0" />}
								<button type="button" onClick={() => setOpen(isOpen ? null : c.ts)} aria-expanded={isOpen}
									className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline decoration-ink-300">
									<span className={cn("h-2 w-2 flex-shrink-0 rounded-[2px]", c.running ? "bg-lagoon-500 animate-lumen-breathe" : c.ok ? "bg-gold-500" : "bg-brick-500")} />
									<span className={cn("font-medium", c.running ? "text-lagoon-700" : c.ok ? "text-ink-900" : "text-brick-700")}>{label}</span>
									<span className="whitespace-nowrap text-ink-600">{sec ? fmtAgo(sec) : c.ts}</span>
									{c.duration_s ? <span className="whitespace-nowrap text-micro text-ink-600">· {fmtDuration(c.duration_s)}</span> : null}
									{c.branch_label && <span className="truncate text-micro text-plum-700">{c.branch_label}</span>}
									{c.reused && <span className="rounded-full bg-plum-50 px-1.5 text-micro text-plum-700" title={c.measured_on || "Answered by an identical earlier measurement"}>reused</span>}
								</button>
								{v != null && <span className="flex-shrink-0 font-mono text-micro tabular-nums text-ink-800">{mVal(typeof c.key_metric === "object" ? c.key_metric?.name ?? "" : "", v)}</span>}
								{c.running && (
									<button type="button" onClick={cancel} disabled={busy === "cancel"}
										className="flex-shrink-0 rounded-md border border-ink-200 px-1.5 py-0.5 text-micro text-ink-800 hover:border-brick-300 hover:text-brick-700 disabled:opacity-50">Cancel</button>
								)}
							</div>
							{/* A running run shows its steps as they fill in. */}
							{c.running && (
								<div className="border-t border-ink-100 px-2.5 py-2">
									<RunSteps app={app} loop={wf.id} ts={c.ts} running />
								</div>
							)}
							{isOpen && (
								<div className="space-y-2 border-t border-ink-100 px-2.5 py-2">
									{detail === null ? <p className="text-micro text-ink-600" role="status">Reading the run…</p>
										: detail === false ? <p className="text-micro text-ink-600">This run's details aren't kept here — only its outcome{c.duration_s ? ` and time (${fmtDuration(c.duration_s)})` : ""}.</p>
										: <>
											{!c.running && (() => { const st = stepsFromCycle(detail, { app }); return st.length > 1 ? <StepProgress steps={st} /> : null; })()}
											<RunAnswerCard app={app} loop={wf.id} runId={c.ts} detail={detail} listRow={c} cycles={cycles} durationS={c.duration_s} />
										</>}
									<div className="flex flex-wrap items-center gap-1.5">
										{!c.running && <>
											<button type="button" onClick={() => mark(c.ts, "keep")} disabled={busy === c.ts} title="What this run learned carries forward"
												className="rounded-md border border-gold-300 bg-gold-50 px-2 py-0.5 text-micro font-medium text-gold-800 hover:bg-gold-100 disabled:opacity-50">Keep it</button>
											<button type="button" onClick={() => mark(c.ts, "discard")} disabled={busy === c.ts} title="What this run learned is dropped"
												className="rounded-md border border-ink-200 px-2 py-0.5 text-micro text-ink-800 hover:bg-ink-50 disabled:opacity-50">Discard it</button>
										</>}
										<Link to={runPath(app, wf.id, c.ts)} className="ml-auto inline-flex items-center gap-1 text-micro text-ink-700 hover:text-ink-900 hover:underline">
											Open the full log <ArrowRight className="h-3 w-3" />
										</Link>
									</div>
								</div>
							)}
						</li>
					);
				})}
			</ul>
			{canMore && <button type="button" onClick={onMore} className="w-full rounded-lg border border-dashed border-ink-200 py-1.5 text-caption text-ink-700 hover:bg-ink-50">Load 40 more</button>}
			{picked.length > 0 && (
				<div className="sticky bottom-0 flex items-center gap-2 rounded-lg border border-plum-200 bg-plum-50 px-2.5 py-1.5 text-caption text-plum-900">
					<Scale className="h-3.5 w-3.5" aria-hidden />
					<span>{picked.length === 1 ? "Pick one more run" : `${picked.length} runs picked`}</span>
					<button type="button" onClick={() => setPicked([])} className="text-micro underline">clear</button>
					{picked.length >= 2 && (
						<Link to={compareHref(app, { runs: picked.map((ts) => ({ loop: wf.id, ts })) })}
							className="ml-auto rounded-md bg-plum-700 px-2 py-0.5 text-caption font-medium text-white hover:bg-plum-800">Compare {picked.length}</Link>
					)}
				</div>
			)}
		</div>
	);
}

// ── Compare ───────────────────────────────────────────────────────────────

/** The workflow a side's runs come from: itself, or its experiment's dispatch workflow. */
function sideLoop(side: CompareSide | null): string | null {
	if (!side) return null;
	if (side.kind === "workflow") return side.id;
	const e = side.exp;
	return e?.dispatch?.loop || e?.loops?.[0] || null;
}

/**
 * Values per metric for one side, from its last runs' full metrics (every
 * metric, not just the headline), so two sides compare on what they share:
 * a version of one experiment against a version of another, or a workflow.
 * A version keeps only its own runs (`metrics.arm`). Falls back to the
 * headline metric / the experiment's series where details aren't readable.
 */
function useSideValues(app: string, side: CompareSide | null): { byMetric: Map<string, number[]>; ready: boolean } {
	const loop = sideLoop(side);
	const { cycles } = useCycles(app, loop);
	const done = useMemo(() => (cycles || []).filter((c) => !c.running && c.ok !== false).slice(0, 20), [cycles]);
	const [details, setDetails] = useState<Array<Record<string, unknown> | null> | null>(null);
	const doneKey = done.map((c) => c.ts).join(",");
	useEffect(() => {
		if (!loop || cycles === null) { setDetails(null); return; }
		let live = true;
		Promise.all(done.map(async (c) => {
			const k = `${app}:${loop}:${c.ts}`;
			let d = detailCache.get(k);
			if (!d) { try { d = await me.cycleDetail(app, loop, c.ts); detailCache.set(k, d); } catch { return null; } }
			return (d.summary?.metrics as Record<string, unknown> | undefined) ?? null;
		})).then((rows) => { if (live) setDetails(rows.reverse()); });
		return () => { live = false; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [app, loop, doneKey, cycles === null]);
	const [series, setSeries] = useState<Array<{ ts: string; v: number }> | null>(null);
	const exp = side?.exp;
	const vid = side?.kind === "version" ? side.id : null;
	useEffect(() => {
		if (!exp || !vid) { setSeries(null); return; }
		let live = true;
		me.experiment(app, exp.id).then((d) => {
			const s = (d.series || []).find((x) => x.variant_id === vid);
			if (live) setSeries(s?.points ?? []);
		}).catch(() => { if (live) setSeries([]); });
		return () => { live = false; };
	}, [app, exp, vid]);
	return useMemo(() => {
		if (!side) return { byMetric: new Map(), ready: true };
		const by = runMetricValues(details ?? [], vid ?? undefined);
		if (side.kind === "workflow" && !by.size) {
			for (const c of [...done].reverse()) {
				const km = c.key_metric;
				const name = typeof km === "object" && km?.name ? km.name : "result";
				const v = keyValue(c);
				if (v != null) by.set(name, [...(by.get(name) ?? []), v]);
			}
		}
		if (side.kind === "version" && exp) {
			const name = exp.metric?.name || exp.metric_name || "result";
			if (!by.get(name)?.length && series?.length) by.set(name, series.map((p) => p.v));
		}
		const ready = side.kind === "version" ? series !== null && (details !== null || !loop) : details !== null || cycles !== null && !done.length;
		return { byMetric: by, ready };
	}, [side, details, series, exp, vid, done, loop, cycles]);
}

export function CompareView({ app, a, b, wf, spec, onPick }: {
	app: string; a: CompareSide; b: CompareSide | null; wf?: SpecWorkflow; spec?: AppSpec; onPick: () => void;
}) {
	const A = useSideValues(app, a);
	const B = useSideValues(app, b);
	const betterOf = (metric: string): "higher" | "lower" => {
		for (const w of spec?.workflows ?? []) for (const st of w.feedback) for (const m of st.metrics) if (m.name === metric) return m.better;
		if (a.exp?.metric?.name === metric) return a.exp.metric.higher_is_better === false ? "lower" : "higher";
		return "higher";
	};
	if (!b) {
		return (
			<div className="space-y-2">
				<p className="text-caption text-ink-700"><span className="font-medium text-ink-900">A: {a.label}</span>. Pick what to compare it with: a workflow, a variant or a setup.</p>
				<Button size="sm" variant="secondary" onClick={onPick}><Scale className="h-3.5 w-3.5" />Pick B on the graph</Button>
				<p className="text-micro text-ink-600">Or hold ⇧ and click it.</p>
			</div>
		);
	}
	// What the sides are judged on: their workflows' feedback metrics and their
	// experiments' metrics. Everything else a run reports (seeds, sizes) is noise here.
	const declared = new Set<string>();
	for (const side of [a, b]) {
		const w = spec?.workflows.find((x) => x.id === sideLoop(side));
		for (const st of w?.feedback ?? []) for (const m of st.metrics) declared.add(m.name);
		const em = side.exp?.metric?.name || side.exp?.metric_name;
		if (em) declared.add(em);
	}
	const seen = [...new Set([...A.byMetric.keys(), ...B.byMetric.keys()])];
	const metrics = declared.size ? seen.filter((m) => declared.has(m)) : seen;
	const rows: Array<{ metric: string; a: SideStats | null; b: SideStats | null }> = metrics.map((m) => ({ metric: m, a: sideStats(A.byMetric.get(m) ?? []), b: sideStats(B.byMetric.get(m) ?? []) }));
	return (
		<div className="space-y-3">
			<div className="grid grid-cols-2 gap-2 text-caption">
				<div className="rounded-lg border border-ink-200 px-2 py-1.5"><div className="text-micro font-semibold text-ink-600">A</div><div className="truncate font-medium text-ink-900">{a.label}</div></div>
				<div className="rounded-lg border border-plum-200 px-2 py-1.5"><div className="text-micro font-semibold text-plum-700">B</div><div className="truncate font-medium text-ink-900">{b.label}</div></div>
			</div>
			{!A.ready || !B.ready ? <p className="text-caption text-ink-600" role="status">Reading both sides…</p>
				: rows.length === 0 ? <p className="text-caption text-ink-600">Neither side has a result to compare yet.</p>
					: rows.map((r) => {
						const better = betterOf(r.metric);
						const v = compareVerdict(mLabel(r.metric), r.a, r.b, better, { a: a.label, b: b.label });
						return (
							<div key={r.metric} className="space-y-1 rounded-lg border border-ink-100 px-2.5 py-2">
								<div className="flex items-baseline gap-2"><span className="text-caption font-medium text-ink-900">{mLabel(r.metric)}</span><span className="text-micro text-ink-600">{better === "lower" ? "lower is better" : "higher is better"}</span></div>
								<table className="w-full text-micro tabular-nums">
									<thead><tr className="text-ink-600"><th className="text-left font-normal" /><th className="text-right font-normal">runs</th><th className="text-right font-normal">average</th><th className="text-right font-normal">range</th></tr></thead>
									<tbody>
										{(["a", "b"] as const).map((k) => {
											const s = r[k];
											return (
												<tr key={k} className={cn(v.ahead === k && "font-semibold text-ink-900")}>
													<td className="text-left text-ink-700">{k.toUpperCase()}</td>
													<td className="text-right">{s?.n ?? 0}</td>
													<td className="text-right font-mono">{s ? mVal(r.metric, s.mean) : "—"}</td>
													<td className="text-right font-mono">{s ? `${mVal(r.metric, s.min)}–${mVal(r.metric, s.max)}` : "—"}</td>
												</tr>
											);
										})}
									</tbody>
								</table>
								<p className={cn("text-caption", v.tone === "ok" ? "text-gold-700" : v.tone === "attention" ? "text-ember-700" : "text-ink-600")}>{v.text}</p>
							</div>
						);
					})}
			<div className="flex flex-wrap gap-1.5">
				<button type="button" onClick={() => ask(`In ${appTitle(app)}, compare ${a.label} (A) with ${b.label} (B). Look at their runs and metrics, cite run ids, and explain why one is ahead or why they can't be told apart yet — and what run would settle it. Invent no numbers; start nothing.`, { app, workflow: wf?.id, compare: [a.id, b.id] })}
					className="inline-flex items-center gap-1 rounded-md border border-ink-200 px-2 py-1 text-caption text-ink-800 hover:bg-ink-50">
					<MessagesSquare className="h-3.5 w-3.5" />Ask why
				</button>
				<button type="button" onClick={onPick} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption text-ink-700 hover:bg-ink-50">Pick another B</button>
			</div>
		</div>
	);
}

// ── Feedback & metrics ────────────────────────────────────────────────────

function FeedbackView({ app, wf, cycles, save, editable }: {
	app: string; wf: SpecWorkflow; cycles: MeCycleListItem[] | null;
	save: (edit: (t: string) => string) => Promise<unknown>; editable: boolean;
}) {
	const latest = useLatestMetrics(app, wf.id, cycles);
	const instruments = useInstruments();
	const [draft, setDraft] = useState<FeedbackStep[]>(wf.feedback);
	const [saving, setSaving] = useState(false);
	useEffect(() => { setDraft(wf.feedback); }, [wf.feedback]);
	const dirty = JSON.stringify(draft) !== JSON.stringify(wf.feedback);
	const upd = (i: number, f: (s: FeedbackStep) => FeedbackStep) => setDraft((d) => d.map((s, j) => (j === i ? f(s) : s)));
	const known = latest ? Object.keys(latest).filter((k) => typeof latest[k] === "number") : [];
	const onSave = async () => {
		setSaving(true);
		try {
			await save((t) => setFeedback(t, wf.id, draft.filter((s) => s.step.trim()).map((s) => ({ ...s, step: s.step.trim(), metrics: s.metrics.filter((m) => m.name.trim()) }))));
			toast.success("Feedback saved");
		} catch (e) {
			toast.error("Couldn't save the feedback", { description: String((e as Error).message || e) });
		} finally { setSaving(false); }
	};
	return (
		<div className="space-y-2.5">
			<p className="text-micro text-ink-600">The steps that measure each run, cheapest first (e.g. simulator → sandbox, backtest → forward test), and what each one reports.</p>
			{draft.map((st, i) => (
				<div key={i} className="space-y-1.5 rounded-lg border border-ink-100 px-2.5 py-2">
					<div className="flex items-center gap-1.5">
						<input aria-label="Feedback step" value={st.step} disabled={!editable} onChange={(e) => upd(i, (s) => ({ ...s, step: e.target.value.replace(/\s+/g, "_").toLowerCase() }))}
							className="h-7 min-w-0 flex-1 rounded-md border border-ink-200 bg-card px-2 text-caption text-ink-900" placeholder="e.g. sandbox" />
						{editable && <button type="button" aria-label="Remove step" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} className="rounded p-1 text-ink-600 hover:bg-ink-100 hover:text-brick-700"><Trash2 className="h-3.5 w-3.5" /></button>}
					</div>
					{/* Which shared instrument measures this step (identity /me/measure). */}
					<div className="flex items-center gap-1.5 text-micro">
						<label className="text-ink-600" htmlFor={`svc-${wf.id}-${i}`}>Measured by</label>
						<select id={`svc-${wf.id}-${i}`} value={st.service ?? ""} disabled={!editable}
							onChange={(e) => upd(i, (s) => { const { service: _drop, ...rest } = s; return e.target.value ? { ...rest, service: e.target.value } : rest; })}
							className="h-6 min-w-0 flex-1 rounded-md border border-ink-200 bg-card px-1 text-micro text-ink-800">
							<option value="">the app itself</option>
							{instrumentChoices(instruments).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
						</select>
					</div>
					{st.service && <p className="text-micro text-ink-700">{measuredBy(st.service, instruments)}</p>}
					{/* The step's pass condition: a chain stops here when a run misses it. */}
					<div className="flex items-center gap-1.5 text-micro">
						<label className="text-ink-600" htmlFor={`gate-${wf.id}-${i}`}>Passes when</label>
						<input id={`gate-${wf.id}-${i}`} value={st.gate ?? ""} disabled={!editable} placeholder="always (no gate), e.g. meets_constraints >= 1"
							onChange={(e) => upd(i, (s) => { const { gate: _drop, ...rest } = s; return e.target.value ? { ...rest, gate: e.target.value } : rest; })}
							className="h-6 min-w-0 flex-1 rounded-md border border-ink-200 bg-card px-1.5 font-mono text-micro text-ink-800" />
					</div>
					{st.metrics.map((m, k) => (
						<div key={k} className="flex items-center gap-1.5 text-caption">
							<input aria-label="Metric" list={`metrics-${wf.id}`} value={m.name} disabled={!editable} onChange={(e) => upd(i, (s) => ({ ...s, metrics: s.metrics.map((x, q) => (q === k ? { ...x, name: e.target.value } : x)) }))}
								className="h-7 min-w-0 flex-1 rounded-md border border-ink-200 bg-card px-2 font-mono text-micro" placeholder="metric" />
							<select aria-label="Better" value={m.better} disabled={!editable} onChange={(e) => upd(i, (s) => ({ ...s, metrics: s.metrics.map((x, q) => (q === k ? { ...x, better: e.target.value as "higher" | "lower" } : x)) }))}
								className="h-7 rounded-md border border-ink-200 bg-card px-1 text-micro">
								<option value="higher">higher better</option><option value="lower">lower better</option>
							</select>
							<input aria-label="Target" inputMode="decimal" value={m.target ?? ""} disabled={!editable} placeholder="target"
								onChange={(e) => { const t = e.target.value.trim(); const n = Number(t); upd(i, (s) => ({ ...s, metrics: s.metrics.map((x, q) => (q === k ? { ...x, target: t === "" || !Number.isFinite(n) ? undefined : n } : x)) })); }}
								className="h-7 w-16 rounded-md border border-ink-200 bg-card px-1.5 text-micro tabular-nums" />
							<span className="w-14 truncate text-right font-mono text-micro text-ink-600" title="latest run">{latest && typeof latest[m.name] === "number" ? mVal(m.name, latest[m.name] as number) : "—"}</span>
						</div>
					))}
					{editable && <button type="button" onClick={() => upd(i, (s) => ({ ...s, metrics: [...s.metrics, { name: "", better: "higher" }] }))} className="inline-flex items-center gap-1 text-micro text-ink-700 hover:text-ink-900"><Plus className="h-3 w-3" />metric</button>}
				</div>
			))}
			<datalist id={`metrics-${wf.id}`}>{known.map((k) => <option key={k} value={k} />)}</datalist>
			{editable ? (
				<div className="flex items-center gap-2">
					<button type="button" onClick={() => setDraft((d) => [...d, { step: "", metrics: [{ name: "", better: "higher" }] }])} className="inline-flex items-center gap-1 text-caption text-ink-700 hover:text-ink-900"><Plus className="h-3.5 w-3.5" />Add a feedback step</button>
					<Button size="sm" className="ml-auto" onClick={onSave} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</Button>
				</div>
			) : <p className="text-micro text-ink-600">This is a shared copy — install your own to change it.</p>}
		</div>
	);
}

// ── Node panel ────────────────────────────────────────────────────────────

export function NodePanel({ app, node, spec, save, editable, onSelect, onClose, style }: {
	app: string; node: SpecNode | { id: "__other"; title: string; parent: string }; spec: AppSpec;
	save: (edit: (t: string) => string) => Promise<unknown>; editable: boolean;
	onSelect: (graphId: string) => void; onClose: () => void; style?: React.CSSProperties;
}) {
	const other = node.id === "__other";
	const members = other
		? spec.workflows.filter((w) => w.helper && !(w.parent && spec.workflows.some((p) => p.id === w.parent)))
		: spec.workflows.filter((w) => w.node === node.id);
	const childNodes = spec.nodes.filter((n) => n.parent === node.id);
	const [title, setTitle] = useState(node.title);
	const [picking, setPicking] = useState(false);
	const [pick, setPick] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	useEffect(() => { setTitle(node.title); setPicking(false); setPick([]); }, [node.id, node.title]);
	const run = async (what: string, edit: (t: string) => string) => {
		setBusy(true);
		try { await save(edit); toast.success(what); } catch (e) { toast.error(`Couldn't ${what.toLowerCase()}`, { description: String((e as Error).message || e) }); } finally { setBusy(false); }
	};
	const parentLabel = spec.workflows.find((w) => w.id === node.parent) ? wfLabel(spec.workflows.find((w) => w.id === node.parent)!) : spec.nodes.find((n) => n.id === node.parent)?.title;
	const candidates = spec.workflows.filter((w) => !w.helper && w.node !== node.id);
	return (
		<PanelShell kicker={other ? "Housekeeping" : "Node"} title={node.title} onClose={onClose} label={`Node: ${node.title}`} style={style}
			sub={!other && parentLabel ? <div className="text-micro text-ink-600">Under {parentLabel}</div> : other ? <div className="text-micro text-ink-600">Workflows that keep the app running; they serve no one workflow.</div> : undefined}
			foot={!other && editable ? <>
				<Button size="sm" variant="secondary" onClick={() => setPicking((p) => !p)} disabled={busy}>Move here…</Button>
				<Button size="sm" variant="secondary" disabled={busy} onClick={() => run("Node added", (t) => addNode(t, "New node", node.id).text)}><Plus className="h-3.5 w-3.5" />New node inside</Button>
				<button type="button" disabled={busy} onClick={() => run("Node removed — what it held moved up", (t) => removeNode(t, node.id))} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-caption text-ink-700 hover:bg-ink-100 hover:text-brick-700">
					<Trash2 className="h-3.5 w-3.5" />Remove node
				</button>
			</> : undefined}>
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-3">
				{!other && editable && (
					<form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (title.trim() && title.trim() !== node.title) void run("Node renamed", (t) => renameNode(t, node.id, title)); }}>
						<label className="sr-only" htmlFor={`node-name-${node.id}`}>Node name</label>
						<input id={`node-name-${node.id}`} value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-ink-200 bg-card px-2 text-caption text-ink-900" />
						<Button size="sm" type="submit" disabled={busy || !title.trim() || title.trim() === node.title}>Rename</Button>
					</form>
				)}
				{picking && (
					<div className="space-y-1 rounded-lg border border-plum-200 bg-plum-50/40 px-2.5 py-2">
						<div className="text-micro font-medium text-ink-700">Move these into {node.title}:</div>
						{candidates.length === 0 && <p className="text-micro text-ink-600">Nothing else to move.</p>}
						{candidates.map((w) => (
							<label key={w.id} className="flex items-center gap-2 text-caption text-ink-900">
								<input type="checkbox" checked={pick.includes(w.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, w.id] : p.filter((x) => x !== w.id)))} />
								{wfLabel(w)}{w.parent && <span className="text-micro text-ink-600">variant of {w.parent}</span>}
							</label>
						))}
						<Button size="sm" disabled={!pick.length || busy} onClick={() => run(`Moved ${pick.length} into ${node.title}`, (t) => pick.reduce((acc, id) => setWorkflowNode(acc, id, node.id), t)).then(() => setPicking(false))}>Move {pick.length || ""}</Button>
					</div>
				)}
				<section className="space-y-1" aria-label="In this node">
					<h3 className="eyebrow">In it</h3>
					{members.length + childNodes.length === 0 && <p className="text-caption text-ink-600">Empty — use Move here… to put workflows in it.</p>}
					{childNodes.map((n) => (
						<button key={n.id} type="button" onClick={() => onSelect(`node:${n.id}`)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-caption hover:bg-ink-50">
							<span className="h-2 w-2 rounded-full border border-dashed border-plum-500" /><span className="text-ink-900">{n.title}</span><span className="ml-auto text-micro text-ink-600">node</span>
						</button>
					))}
					{members.map((w) => (
						<div key={w.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-caption hover:bg-ink-50">
							<button type="button" onClick={() => (other ? undefined : onSelect(`wf:${w.id}`))} className="flex min-w-0 flex-1 items-center gap-2 text-left">
								<span className="h-1.5 w-1.5 rounded-full bg-plum-500" /><span className="truncate text-ink-900">{wfLabel(w)}</span>
							</button>
							{!other && editable && (
								<button type="button" title="Move it out of this node" disabled={busy} onClick={() => run(`${wfLabel(w)} moved out`, (t) => setWorkflowNode(t, w.id, null))}
									className="text-micro text-ink-600 hover:text-ink-900">Move out</button>
							)}
						</div>
					))}
				</section>
				<p className="text-micro text-ink-600">Moving a workflow only changes where it sits on the graph; its definition and runs stay as they are.</p>
			</div>
		</PanelShell>
	);
}

// Re-exported for the variant sheet and tests.
export { addWorkflows };
