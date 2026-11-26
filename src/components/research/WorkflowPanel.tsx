// WorkflowPanel — the research graph's pop-up panel for a workflow (and for a
// child node), docked at the right of the graph. Everything about a workflow
// happens here, so the app needs no other tabs (user, 2026-11-25: "some
// functions can be embedded into the graph UIUX, including the pop up panel"):
//
//   Overview  how is it doing — status, feedback metrics vs target, insights,
//             what it's made of (steps, data, compute) — and the verbs:
//             Run · Try setups · Make a variant · Compare with… · Ask about it
//   Runs      its runs, live first; a row opens its answer in place
//   Compare   A (this) against B (picked on the graph), per metric, in words
//   Feedback  its feedback steps and metrics, editable
//
// Every run starts from a button press here (manual dispatch, for this stage).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, GitBranch, MessagesSquare, Play, Plus, Scale, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { me, type MeCycleDetail, type MeCycleListItem, type MeExperiment, type MeWorkflowRow } from "@/api/me";
import type { AppSpec, FeedbackStep, SpecNode, SpecWorkflow } from "@/lib/app-spec";
import { addNode, removeNode, renameNode, setFeedback, setWorkflowNode, addWorkflows } from "@/lib/app-spec";
import { compareVerdict, sideStats, type SideStats } from "@/lib/compare";
import { workflowStatusLine, fmtAgo, fmtDuration, dirIdToSec } from "@/lib/activity";
import { humanId, versionsOf } from "@/lib/research-map";
import { humanMetric, fmtMetricValue, measuredLine } from "@/lib/run-answer";

const mLabel = (name: string) => humanMetric(name).label;
/** A metric value with its unit, the way the run page writes it. */
const mVal = (name: string, v: number) => { const h = humanMetric(name); const t = fmtMetricValue(v, h.unit, name); return h.unit && !t.endsWith("%") ? `${t} ${h.unit}` : t; };
import { runPath, workflowPath } from "@/lib/run-routes";
import { loopLabel } from "@/lib/workflow-names";
import { appTitle } from "@/components/workflow/AppCard";
import RunAnswerCard from "@/components/workflow/RunAnswerCard";
import WorkflowInsights from "@/components/workflow/WorkflowInsights";
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
export function useCycles(app: string, loop: string | null) {
	const key = `${app}:${loop}`;
	const [cycles, setCycles] = useState<MeCycleListItem[] | null>(() => (loop ? cyclesCache.get(key)?.cycles ?? null : null));
	const load = useCallback(async () => {
		if (!loop) return;
		try {
			const r = await me.cyclesList(app, loop, 40);
			const c = (r.cycles || []).slice().sort((a, b) => (dirIdToSec(b.ts) ?? 0) - (dirIdToSec(a.ts) ?? 0));
			cyclesCache.set(key, { at: Date.now(), cycles: c });
			setCycles(c);
		} catch { setCycles((cur) => cur ?? []); }
	}, [app, loop, key]);
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
	const last = cycles?.find((c) => !c.running && c.ok !== undefined);
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

function PanelShell({ kicker, title, sub, onClose, children, foot, label, style, page = false }: {
	kicker: string; title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode; label: string; style?: React.CSSProperties;
	/** The workflow's own page: the same panel, full width, in the flow. */
	page?: boolean;
}) {
	useEffect(() => {
		if (page) return;
		const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose, page]);
	return (
		<div role={page ? "region" : "dialog"} aria-label={label} style={style}
			className={page
				? "flex w-full flex-col overflow-hidden rounded-xl border border-ink-200 bg-card shadow-e1"
				: "absolute right-3 top-12 z-[6100] flex w-[22rem] max-w-[48%] flex-col overflow-hidden rounded-xl border border-ink-200 bg-card shadow-e3 map-panel-in 2xl:w-[26rem]"}>
			<div className="space-y-1 border-b border-ink-100 px-3.5 pb-2.5 pt-3">
				<div className="flex items-center gap-2">
					<span className="eyebrow text-plum-700">{kicker}</span>
					{!page && (
						<button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)"
							className="ml-auto -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 hover:text-ink-900">
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
				<div className="text-title font-semibold leading-snug text-ink-900">{title}</div>
				{sub}
			</div>
			{children}
			{foot && <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 bg-muted/30 px-3 py-2">{foot}</div>}
		</div>
	);
}

// ── workflow panel ────────────────────────────────────────────────────────

export default function WorkflowPanel({ app, wf, spec, row, exps, view, onView, compareWith, onPickCompare, onMakeVariant, onTrySetups, onSelect, save, editable, onClose, style, page = false }: {
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
	onMakeVariant: () => void;
	onTrySetups: () => void;
	onSelect: (graphId: string) => void;
	save: (edit: (t: string) => string, files?: Array<{ path: string; content: string }>) => Promise<unknown>;
	editable: boolean;
	onClose: () => void;
	style?: React.CSSProperties;
	/** Rendered as the workflow's own page (full width) rather than over the graph. */
	page?: boolean;
}) {
	const { cycles, reload } = useCycles(app, wf.id);
	const status = useMemo(() => workflowStatusLine((cycles || []).map((c) => ({ ts: c.ts, ok: c.ok, running: c.running, duration_s: c.duration_s }))), [cycles]);
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
	const toneCls = status.tone === "ok" ? "text-gold-700" : status.tone === "failing" ? "text-brick-700" : "text-ink-600";
	const sub = (
		<div className="space-y-0.5">
			{wf.about && <div className="line-clamp-2 text-caption text-ink-700" title={wf.about}>{wf.about}</div>}
			<div className={cn("flex items-center gap-1.5 text-caption font-medium", running ? "text-lagoon-700" : toneCls)}>
				<span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-lagoon-500 animate-lumen-breathe" : status.tone === "ok" ? "bg-gold-500" : status.tone === "failing" ? "bg-brick-500" : "bg-ink-400")} />
				{running ? "Running now" : status.text}
			</div>
			{wf.parent && (
				<button type="button" onClick={() => onSelect(`wf:${wf.parent}`)} className="text-micro text-ink-600 hover:text-ink-900 hover:underline">
					Variant of {wfLabel(spec.workflows.find((w) => w.id === wf.parent) ?? ({ id: wf.parent } as SpecWorkflow))}
				</button>
			)}
		</div>
	);
	return (
		<PanelShell kicker={wf.parent ? "Variant" : "Workflow"} title={wfLabel(wf)} sub={sub} onClose={onClose} label={`Workflow: ${wfLabel(wf)}`} style={style} page={page}
			foot={<>
				<Button size="sm" variant="accent" onClick={runNow} disabled={busy || running} aria-label={`Run ${wfLabel(wf)}`}>
					<Play className="h-3.5 w-3.5" />{running ? "Running…" : "Run"}
				</Button>
				<Button size="sm" variant="secondary" onClick={onTrySetups}>Try setups</Button>
				<Button size="sm" variant="secondary" onClick={onMakeVariant} disabled={!editable} title={editable ? "A workflow made from this one" : "Install your own copy to change it"}>
					<GitBranch className="h-3.5 w-3.5" />Make a variant
				</Button>
				<MoreMenu app={app} wf={wf} row={row} editable={editable} />
				<button type="button" onClick={() => ask(`How is ${wfLabel(wf)} in ${appTitle(app)} doing, and what should it try next? Look at its recent runs and their metrics first; cite run ids. Suggest the next runs, but start nothing.`, { app, workflow: wf.id })}
					className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-caption text-ink-700 hover:bg-ink-100 hover:text-ink-900">
					<MessagesSquare className="h-3.5 w-3.5" />Ask about it
				</button>
			</>}>
			<div className="border-b border-ink-100 px-3 py-1.5">
				<Segmented size="sm" aria-label="Panel view" value={view} onChange={(v) => onView(v as PanelView)}
					options={[{ value: "overview", label: "Overview" }, { value: "runs", label: "Runs" }, { value: "compare", label: "Compare" }, { value: "feedback", label: "Feedback" }]} />
			</div>
			<div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3", page && "md:px-5 md:py-4")}>
				{view === "overview" && <OverviewView app={app} wf={wf} spec={spec} row={row} cycles={cycles} variants={variants} helpers={helpers} exps={ownExps} onSelect={onSelect} />}
				{view === "runs" && <RunsView app={app} wf={wf} cycles={cycles} />}
				{view === "compare" && <CompareView app={app} a={{ kind: "workflow", id: wf.id, label: wfLabel(wf) }} b={compareWith} wf={wf} spec={spec} onPick={onPickCompare} />}
				{view === "feedback" && <FeedbackView app={app} wf={wf} cycles={cycles} save={save} editable={editable} />}
			</div>
		</PanelShell>
	);
}

// ── ⋯ : Pause / Resume (only where a schedule exists) and Delete ──────────

function MoreMenu({ app, wf, row, editable }: { app: string; wf: SpecWorkflow; row?: MeWorkflowRow; editable: boolean }) {
	const [open, setOpen] = useState(false);
	const scheduled = wf.run !== "manual";
	const paused = row?.enabled === false;
	const toggle = async () => {
		setOpen(false);
		try {
			await me.patchLoop(app, wf.id, { enabled: paused });
			window.dispatchEvent(new CustomEvent("studio:data", { detail: { scopes: ["workflows", "loops"] } }));
			toast.success(paused ? `${wfLabel(wf)} runs on its schedule again` : `${wfLabel(wf)} paused — it runs only when you press Run`);
		} catch (e) { toast.error("Couldn't change it", { description: String((e as Error).message || e) }); }
	};
	const del = async () => {
		setOpen(false);
		const { deleteWorkflow } = await import("@/lib/delete-workflow");
		await deleteWorkflow(app, appTitle(app), wf.id, wfLabel(wf));
	};
	if (!editable) return null;
	return (
		<div className="relative">
			<button type="button" aria-label="More" aria-expanded={open} onClick={() => setOpen((v) => !v)}
				className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 hover:text-ink-900">⋯</button>
			{open && (
				<div role="menu" className="absolute bottom-full left-0 z-10 mb-1 w-48 rounded-lg border border-ink-200 bg-popover p-1 shadow-e2">
					{scheduled && <button type="button" role="menuitem" onClick={toggle} className="block w-full rounded-md px-2 py-1.5 text-left text-caption text-ink-800 hover:bg-ink-100">{paused ? "Resume its schedule" : "Pause its schedule"}</button>}
					<button type="button" role="menuitem" onClick={del} className="block w-full rounded-md px-2 py-1.5 text-left text-caption text-brick-700 hover:bg-brick-50">Delete workflow…</button>
				</div>
			)}
		</div>
	);
}

// ── Overview ──────────────────────────────────────────────────────────────

function metricLine(name: string, v: unknown, target?: number, better?: "higher" | "lower") {
	const val = typeof v === "number" ? v : Number(v);
	const has = v != null && Number.isFinite(val);
	const met = has && target != null ? (better === "lower" ? val <= target : val >= target) : null;
	return { label: mLabel(name), value: has ? mVal(name, val) : "—", target: target != null ? mVal(name, target) : null, met };
}

function OverviewView({ app, wf, spec, row, cycles, variants, helpers, exps, onSelect }: {
	app: string; wf: SpecWorkflow; spec: AppSpec; row?: MeWorkflowRow; cycles: MeCycleListItem[] | null;
	variants: SpecWorkflow[]; helpers: SpecWorkflow[]; exps: MeExperiment[]; onSelect: (id: string) => void;
}) {
	const latest = useLatestMetrics(app, wf.id, cycles);
	const measured = measuredLine(latest);
	const steps = wf.feedback.length ? wf.feedback : wf.primary ? [{ step: "result", metrics: [{ name: wf.primary, better: "higher" as const }] }] : [];
	const compute = { ...spec.compute, ...wf.compute };
	return (
		<div className="space-y-3.5">
			<section aria-label="Feedback" className="space-y-1.5">
				<h3 className="eyebrow">Feedback, latest run</h3>
				{steps.length === 0 ? (
					<p className="text-caption text-ink-600">It declares no feedback steps yet — add them under Feedback.</p>
				) : steps.map((st) => (
					<div key={st.step} className="rounded-lg border border-ink-100 px-2.5 py-1.5">
						<div className="text-micro font-medium uppercase tracking-wide text-ink-600">{humanId(st.step)}</div>
						{st.metrics.map((m) => {
							const l = metricLine(m.name, latest?.[m.name], m.target, m.better);
							return (
								<div key={m.name} className="flex items-baseline gap-2 text-caption">
									<span className="text-ink-700">{l.label}</span>
									<span className="ml-auto font-mono tabular-nums text-ink-900">{l.value}</span>
									{l.target && <span className={cn("text-micro", l.met === true ? "text-gold-700" : l.met === false ? "text-brick-700" : "text-ink-600")}>
										{l.met === true ? "meets" : l.met === false ? "misses" : "aim"} {m.better === "lower" ? "≤" : "≥"} {l.target}
									</span>}
								</div>
							);
						})}
					</div>
				))}
				{measured && (
					<p className={cn("text-caption", measured.measured ? "text-ink-700" : "text-ember-700")}>{measured.text}</p>
				)}
			</section>
			{(exps.length > 0 || variants.length > 0) && (
				<section aria-label="Under it" className="space-y-1">
					<h3 className="eyebrow">Under it</h3>
					{exps.map((e) => (
						<button key={e.id} type="button" onClick={() => onSelect(`exp:${e.id}`)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-caption hover:bg-ink-50">
							<span className="h-1.5 w-1.5 rounded-full bg-plum-500" /><span className="text-ink-900">{humanId(e.id)}</span>
							<span className="ml-auto text-micro text-ink-600">{versionsOf(e).length} setups</span>
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
			<section aria-label="What it's made of" className="space-y-1">
				<h3 className="eyebrow">What it&apos;s made of</h3>
				<dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-caption">
					<dt className="text-ink-600">Steps</dt>
					<dd className="text-ink-900">{wf.steps.python ? <>Python <code className="font-mono text-micro">commands/{wf.steps.python}.py</code></> : wf.steps.dag ? <>A DAG <code className="font-mono text-micro">{wf.steps.dag}</code></> : wf.steps.skills?.length ? wf.steps.skills.join(" → ") : "—"}</dd>
					{Object.keys(wf.inputs).length > 0 && <><dt className="text-ink-600">Inputs</dt><dd className="font-mono text-micro text-ink-800">{Object.entries(wf.inputs).map(([k, v]) => `${k}=${String(v) || "…"}`).join(" · ")}</dd></>}
					<dt className="text-ink-600">Data</dt><dd className="text-ink-900">{wf.data.length ? wf.data.join(", ") : "—"}</dd>
					<dt className="text-ink-600">Compute</dt><dd className="text-ink-900">{compute.site ? `${compute.site}${compute.gpu ? ` · GPU ${compute.gpu}` : ""}` : "the app's default"}</dd>
					<dt className="text-ink-600">Starts</dt><dd className="text-ink-900">{wf.run === "manual" ? "When you press Run" : `On its own (${row?.trigger || wf.run}) — and when you press Run`}</dd>
					{helpers.length > 0 && <><dt className="text-ink-600">Helpers</dt><dd className="text-ink-800">{helpers.map(wfLabel).join(", ")}</dd></>}
				</dl>
				<Link to={workflowPath(app, wf.id)} className="inline-flex items-center gap-1 pt-1 text-micro text-ink-700 hover:text-ink-900 hover:underline">
					Open its page <ArrowRight className="h-3 w-3" />
				</Link>
			</section>
		</div>
	);
}

// ── Runs ──────────────────────────────────────────────────────────────────

function RunsView({ app, wf, cycles }: { app: string; wf: SpecWorkflow; cycles: MeCycleListItem[] | null }) {
	const [open, setOpen] = useState<string | null>(null);
	const [detail, setDetail] = useState<MeCycleDetail | null>(null);
	useEffect(() => {
		if (!open) { setDetail(null); return; }
		let live = true;
		setDetail(null);
		me.cycleDetail(app, wf.id, open).then((d) => { if (live) setDetail(d); }).catch(() => {});
		return () => { live = false; };
	}, [app, wf.id, open]);
	if (cycles === null) return <p className="text-caption text-ink-600" role="status">Reading its runs…</p>;
	if (!cycles.length) return <p className="text-caption text-ink-600">No runs yet. Press Run to start one.</p>;
	const ordered = [...cycles.filter((c) => c.running), ...cycles.filter((c) => !c.running)];
	return (
		<ul className="space-y-1" aria-label={`Runs of ${wfLabel(wf)}`}>
			{ordered.map((c) => {
				const sec = dirIdToSec(c.ts);
				const v = keyValue(c);
				const label = c.running ? "Running" : c.ok ? "Succeeded" : c.ok === false ? "Failed" : "Ended";
				const isOpen = open === c.ts;
				return (
					<li key={c.ts} className={cn("rounded-lg border", isOpen ? "border-plum-200" : "border-ink-100")}>
						<button type="button" onClick={() => setOpen(isOpen ? null : c.ts)} aria-expanded={isOpen}
							className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-caption hover:bg-ink-50">
							<span className={cn("h-1.5 w-1.5 rounded-full", c.running ? "bg-lagoon-500 animate-lumen-breathe" : c.ok ? "bg-gold-500" : "bg-brick-500")} />
							<span className={cn("font-medium", c.running ? "text-lagoon-700" : c.ok ? "text-ink-900" : "text-brick-700")}>{label}</span>
							<span className="text-ink-600">{sec ? fmtAgo(sec) : c.ts}</span>
							{c.duration_s ? <span className="text-micro text-ink-600">· {fmtDuration(c.duration_s)}</span> : null}
							{c.branch_label && <span className="truncate text-micro text-plum-700">{c.branch_label}</span>}
							{v != null && <span className="ml-auto font-mono text-micro tabular-nums text-ink-800">{mVal(typeof c.key_metric === "object" ? c.key_metric?.name ?? "" : "", v)}</span>}
						</button>
						{isOpen && (
							<div className="space-y-2 border-t border-ink-100 px-2.5 py-2">
								{detail ? <RunAnswerCard app={app} loop={wf.id} runId={c.ts} detail={detail} listRow={c} cycles={cycles} durationS={c.duration_s} />
									: <p className="text-micro text-ink-600" role="status">Reading the run…</p>}
								<Link to={runPath(app, wf.id, c.ts)} className="inline-flex items-center gap-1 text-micro text-ink-700 hover:text-ink-900 hover:underline">
									Open the full log <ArrowRight className="h-3 w-3" />
								</Link>
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}

// ── Compare ───────────────────────────────────────────────────────────────

/** Values per metric for one side: a workflow's runs, or a version's results. */
function useSideValues(app: string, side: CompareSide | null): { byMetric: Map<string, number[]>; ready: boolean } {
	const loop = side?.kind === "workflow" ? side.id : null;
	const { cycles } = useCycles(app, loop);
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
		const by = new Map<string, number[]>();
		if (side?.kind === "workflow") {
			for (const c of [...(cycles || [])].reverse()) {
				if (c.running || c.ok === false) continue;
				const km = c.key_metric;
				const name = typeof km === "object" && km?.name ? km.name : "result";
				const v = keyValue(c);
				if (v != null) by.set(name, [...(by.get(name) ?? []), v]);
			}
			return { byMetric: by, ready: cycles !== null };
		}
		if (side?.kind === "version" && exp) {
			const name = exp.metric?.name || exp.metric_name || "result";
			by.set(name, (series || []).map((p) => p.v));
			return { byMetric: by, ready: series !== null };
		}
		return { byMetric: by, ready: !side };
	}, [side, cycles, series, exp]);
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
	const metrics = [...new Set([...A.byMetric.keys(), ...B.byMetric.keys()])];
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
