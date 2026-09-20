// StudioWorkflowPanel — right-edge pop-up drawer that visualizes a Lumilake
// workflow as a DAG (the generic workflow canvas), with the HALO optimizer overlay.
//
// Driven by the same CustomEvent-bus pattern as StudioArtifactPanel:
//   - window CustomEvent('studio:workflow-open', { detail: { workflow_yaml, plan, title } })
//       → store the workflow + force-open. Dispatched from chat/protocol.ts when
//         an optimize_workflow / run_workflow tool call completes, and by the
//         inline "Open workflow" card in entityCards.
//   - window CustomEvent('studio:workflow-panel-toggle')  → flip open/closed
//         (fired by the composer icon button in StudioChat).
//
// Self-contained fixed drawer (right edge, resizable) so it needs no shell
// layout surgery — it overlays the workspace, like a slide-in inspector.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Workflow as WorkflowIcon, X, Cpu, Clock, Hash } from 'lucide-react';
import WorkflowEditor from '@/workflow/WorkflowEditor';
import type { HaloPlan } from '@/workflow/adapters/lumilake';
import type { WfOverlay as RunOverlay } from '@/workflow/model';

const WIDTH_KEY = 'studio_workflow_panel_width_v1';
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 560;

// `run_state` is an OPTIONAL per-op execution overlay (opId -> pending |
// running | succeeded | failed | skipped), distinct from `plan`, which says
// where an op WOULD run rather than what happened.
//
// MEASURED 2026-09-20, settling the question this comment used to leave open:
// `lumilake_job_status`'s `steps` keys are NOT op ids. They are five fixed
// JOB-LIFECYCLE phases — queuing / query parsing / data probing / execution /
// outputs — while the workflow's ops are its own ids (for vla_curation:
// "Episode Frames", "Keyframe", "Caption", "Normalized Instruction"). Checked
// against a real completed job (req-5UgV3Qgdqb6shnethiQhCt); the other two
// surfaces give no more: /jobs/{id}/workflows came back EMPTY and
// batch_progress was zeroed.
//
// So per-op state is NOT DERIVABLE from this API, and no mapping will make it
// so. `run_state` stays unpopulated — not because the producer is unwritten,
// but because the data does not exist. Painting confident, plausible, wrong
// state onto a graph is worse than painting none.
//
// The honest surface is JOB-LEVEL: the phase, and the id needed to re-query it.
// That needs a browser-reachable status endpoint, which does not exist today —
// there is no `lumilake` route in identity's router and nothing in api/me.ts —
// so this panel shows what the tool call already returned and no more.
type WorkflowPayload = {
	workflow_yaml: string;
	/** The run this graph belongs to. Without it the panel cannot address,
	 *  re-query, or even name the job it is drawing. */
	job_id?: string;
	/** Which site ran it. The status endpoint is site-scoped, and an un-sited
	 *  guess would poll a Lumilake that never saw this job. */
	site?: string;
	plan?: HaloPlan;
	title?: string;
	run_state?: RunOverlay;
};

export function StudioWorkflowPanel() {
	const [open, setOpen] = useState(false);
	const [wf, setWf] = useState<WorkflowPayload | null>(null);
	const [width, setWidth] = useState<number>(() => {
		try {
			const n = parseInt(localStorage.getItem(WIDTH_KEY) || '', 10);
			return Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
		} catch { return DEFAULT_WIDTH; }
	});
	const [resizing, setResizing] = useState(false);

	useEffect(() => {
		const onOpen = (e: Event) => {
			const d = (e as CustomEvent).detail as WorkflowPayload | undefined;
			if (d && typeof d.workflow_yaml === 'string' && d.workflow_yaml.trim()) {
				// Hold the latest workflow but DON'T auto-pop the full-height drawer.
				// The compact inline chat card (workflowResultCard) is the default
				// surface; the user opens the DAG on demand via its "Open full graph"
				// button (which fires studio:workflow-panel-toggle).
				setWf(d);
			}
		};
		const onToggle = () => setOpen((v) => !v);
		window.addEventListener('studio:workflow-open', onOpen as EventListener);
		window.addEventListener('studio:workflow-panel-toggle', onToggle);
		return () => {
			window.removeEventListener('studio:workflow-open', onOpen as EventListener);
			window.removeEventListener('studio:workflow-panel-toggle', onToggle);
		};
	}, []);


	// Poll job-level progress while the run is live.
	//
	// The panel used to be one-shot: it was filled by a completed tool call and
	// then never updated, so a job that took twenty minutes showed the frame
	// from its first second for the whole run.
	//
	// JOB-LEVEL, NOT PER-OP, and the distinction is load-bearing. Measured on a
	// real completed job: `progress` keys are five fixed lifecycle phases
	// (queuing / query parsing / data probing / execution / outputs) and the
	// workflow's op ids appear nowhere — /jobs/{id}/workflows came back empty
	// and batch_progress was zeroed. There is no per-op state to be had, so
	// `run_state` stays unset rather than being fabricated from phases that
	// mean something else.
	const [job, setJob] = useState<null | {
		status: string; terminal: boolean;
		// `completed` is a BOOLEAN on a phase and a COUNT on batch_progress.
		// The two are distinguished at render, not assumed away here.
		progress?: Record<string, { completed?: boolean | number; eta_seconds?: number }>;
	}>(null);
	const [jobErr, setJobErr] = useState<string>("");
	// The run's other jobs, and which one is being drawn.
	//
	// A fan-out is N jobs against ONE graph, and the panel is handed exactly one
	// of them — whatever the chat tool call returned. `sel` is the job actually
	// polled; it starts as the given one and moves when a user picks an arm.
	const [sibs, setSibs] = useState<Array<{
		job_id: string; site: string; arm?: string; workers?: Record<string, string>;
	}>>([]);
	const [sel, setSel] = useState<{ job_id: string; site: string } | null>(null);
	useEffect(() => {
		// Reset on a NEW run, not on every render: leaving the previous run's
		// selection in place would poll one run while drawing another's graph.
		setSel(wf?.job_id && wf?.site ? { job_id: wf.job_id, site: wf.site } : null);
		setSibs([]);
		if (!wf?.job_id || !wf?.site) return;
		let live = true;
		(async () => {
			try {
				const { me } = await import("@/api/me");
				const r = await me.computeJobSiblings(wf.site!, wf.job_id!);
				if (live && Array.isArray(r.jobs) && r.jobs.length > 1) setSibs(r.jobs);
			} catch { /* a run of one, or an older server: no switcher, same panel */ }
		})();
		return () => { live = false; };
	}, [wf?.job_id, wf?.site]);
	useEffect(() => {
		const id = sel?.job_id ?? wf?.job_id;
		const site = sel?.site ?? wf?.site;
		// No site means no addressable job: the endpoint is site-scoped, and
		// guessing one polls a Lumilake that never saw this run.
		if (!id || !site) { setJob(null); setJobErr(""); return; }
		let live = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let fails = 0;
		const tick = async () => {
			try {
				const { me } = await import("@/api/me");
				const r = await me.computeJob(site, id);
				if (!live) return;
				setJob({ status: r.status, terminal: r.terminal, progress: r.progress });
				setJobErr(""); fails = 0;
				// Stop on terminal. `terminal` is the SERVER's answer, not a
				// status string matched here — two places deciding what "done"
				// means eventually disagree, and the loser spins forever.
				if (!r.terminal) timer = setTimeout(tick, 5000);
			} catch (e) {
				if (!live) return;
				// Say it — an unconfigured endpoint returns a 503 naming the env
				// var it wants, and that message is more useful on screen than a
				// bar that never moves.
				setJobErr(String((e as Error)?.message || e).slice(0, 160));
				// ...but keep polling through a blip. The first version stopped
				// dead on any error, so a single transient 502 — from a service
				// this stack restarts routinely — ended the poll for the rest of
				// the session and left a half-finished job looking frozen.
				// Bounded so a genuinely dead endpoint does not retry forever:
				// give up after 5 consecutive failures, backing off as it goes.
				fails += 1;
				if (fails < 5) timer = setTimeout(tick, 5000 * fails);
			}
		};
		void tick();
		return () => { live = false; if (timer) clearTimeout(timer); };
	}, [sel?.job_id, sel?.site, wf?.job_id, wf?.site]);

	// pointer-drag resize from the left edge (drawer is on the right)
	const startResize = useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		setResizing(true);
		const startX = e.clientX;
		const startW = width;
		const onMove = (ev: PointerEvent) => {
			const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + (startX - ev.clientX)));
			setWidth(next);
		};
		const onUp = () => {
			setResizing(false);
			try { localStorage.setItem(WIDTH_KEY, String(widthRef.current)); } catch { /* ignore */ }
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}, [width]);
	const widthRef = useRef(width);
	widthRef.current = width;

	if (!open) return null;

	const plan = wf?.plan;
	const workers = plan?.selected_workers || [];
	const optMs = plan?.optimization_seconds != null ? Math.round(plan.optimization_seconds * 1000) : null;

	// PORTALLED TO document.body, and that is load-bearing rather than tidy.
	//
	// This component is mounted inside StudioChat's <header>, beside the toggle
	// button that opens it. That header is `sticky z-10`, which creates a
	// STACKING CONTEXT — so the drawer's z-40 was scoped INSIDE z-10 and could
	// never beat the chat column's z-20, a sibling context. The comment below
	// states the intent ("z-40 keeps it above chat content") and the mount
	// position silently defeated it.
	//
	// The drawer stayed VISIBLE throughout, because the chat column is
	// transparent there — so this never looked broken. It just swallowed every
	// click: measured with elementFromPoint at the arm chips' centre, the
	// topmost element was the chat column, not the button. Visibility is not
	// hit-testing, and only a click test could tell them apart.
	//
	// A portal escapes ancestor stacking entirely, which is what a
	// `position: fixed` overlay needs — moving the mount point would fix it
	// today and re-break the moment anything above it gains a z-index.
	return createPortal((
		<aside
			// Slide-in inspector on the right edge. Starts BELOW the sticky top bar
			// (min-h-[64px] = top-16) instead of top-0/h-screen, so it no longer
			// overlays the header (toggle, account menu, panel icons). z-40 keeps it
			// above chat content (z-20/30) but below composer menus (z-50) + the
			// session-expand modal (z-60).
			className="fixed top-16 right-0 bottom-0 z-40 flex flex-col bg-card border-l border-border shadow-xl"
			style={{ width }}
		>
			{/* left-edge resize handle */}
			<div
				onPointerDown={startResize}
				className={['absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-gold-300', resizing ? 'bg-gold-400' : ''].join(' ')}
			/>
			<header className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
				<WorkflowIcon className="w-4 h-4 text-gold-600" />
				<div className="min-w-0 flex-1">
					<div className="text-[13px] font-semibold text-foreground truncate">
						{wf?.title || 'Workflow'}
					</div>
					{(wf?.job_id || (plan && !plan.error)) && (
						<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
							{workers.length > 0 && (
								<span className="inline-flex items-center gap-0.5"><Cpu className="w-3 h-3" />{workers.length} worker{workers.length === 1 ? '' : 's'}</span>
							)}
							{optMs != null && (
								<span className="inline-flex items-center gap-0.5"><Clock className="w-3 h-3" />{optMs} ms optimize</span>
							)}
							{/* Shown in FULL and selectable. Every job id recorded in the
							    runbook so far is truncated with an ellipsis and therefore
							    cannot be re-queried — a run you cannot look up is a run
							    you cannot learn from. */}
							{wf?.job_id && (
								<span className="inline-flex items-center gap-0.5 font-mono select-all"
									title="Job id — select to copy; re-query with lumilake_job_status">
									<Hash className="w-3 h-3" />{wf.job_id}
								</span>
							)}
							{job && (
								<span className="inline-flex items-center gap-0.5"
									title={job.terminal ? "final" : "polling every 5s"}>
									<span className={`inline-block w-1.5 h-1.5 rounded-full ${
										job.status === "completed" ? "bg-emerald-500"
										: job.status === "failed" || job.status === "cancelled" ? "bg-rose-500"
										: "bg-amber-500 animate-pulse"}`} />
									{job.status}
								</span>
							)}
						</div>
					)}
				</div>
				<button onClick={() => setOpen(false)} title="Close" aria-label="Close workflow panel"
					className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground">
					<X className="w-4 h-4" />
				</button>
			</header>
			{/* The arm switcher. Only when there IS a fan-out — one job needs no
			    chooser, and a control that never has a second option is noise.
			
			    It names the arm it is drawing. An unlabelled overlay across
			    parallel arms is worse than none: four runs and no way to tell
			    which the canvas is showing. Falls back to a short job id when a
			    run carries no arm, rather than rendering an empty chip. */}
			{sibs.length > 1 && (
				<div className="px-3 pb-1 flex flex-wrap items-center gap-1 text-[10px]">
					<span className="opacity-60">arm:</span>
					{sibs.map((j) => {
						const on = j.job_id === (sel?.job_id ?? wf?.job_id);
						const uniq = Array.from(new Set(Object.values(j.workers || {})));
						return (
							<button key={`${j.site}/${j.job_id}`}
								onClick={() => setSel({ job_id: j.job_id, site: j.site })}
								title={`${j.job_id} on ${j.site}${uniq.length ? ` — ${uniq.join(", ")}` : ""}`}
								className={`px-1.5 py-0.5 rounded border ${on
									? "border-gold-400 bg-gold-50 text-gold-800 dark:bg-gold-900/30 dark:text-gold-200"
									: "border-border text-muted-foreground hover:bg-muted"}`}>
								{j.arm || j.job_id.slice(0, 10)}
								{/* WHERE it landed. With N arms on one fleet this is the
								    difference between "it is slow" and "three arms queued
								    behind one card" — so distinct workers are shown, not
								    the op count. */}
								{uniq.length > 0 && (
									<span className="opacity-60"> · {uniq.length === 1
										? uniq[0] : `${uniq.length} workers`}</span>
								)}
							</button>
						);
					})}
					{/* Same site for every arm is the common case; say so only when it
					    is NOT, because a fan-out split across sites explains a latency
					    difference that would otherwise look like the arm. */}
					{new Set(sibs.map((j) => j.site)).size > 1 && (
						<span className="opacity-60">· split across sites</span>
					)}
				</div>
			)}
			{(job?.progress || jobErr) && (
				<div className="px-3 pb-1 text-[10px] text-muted-foreground">
					{jobErr ? (
						<span className="text-rose-500">{jobErr}</span>
					) : (
						<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							{/* Labelled JOB phases, deliberately. These are the five
							    lifecycle steps the server reports; they are NOT the
							    graph's ops, and showing them beside the canvas
							    without saying so would invite exactly that reading. */}
							<span className="opacity-60">job phases:</span>
							{/* Only entries whose `completed` is a BOOLEAN are phases. Measured
							    on a real job, `progress` also carries `batch_progress`, whose
							    `completed` is a COUNT of finished batches — so rendering every
							    key painted it as a sixth phase, ticked green the moment one
							    batch landed. A count is not a state. */}
							{Object.entries(job?.progress || {})
								.filter(([, v]) => typeof v?.completed === "boolean")
								.map(([k, v]) => (
									<span key={k} className={v.completed ? "text-emerald-600" : "opacity-50"}>
										{v.completed ? "✓" : "·"} {k}
									</span>
								))}
							{/* batch_progress is real progress, just not a phase — and it
							    carries the only ETA this API offers. */}
							{typeof job?.progress?.batch_progress?.eta_seconds === "number" && !job.terminal && (
								<span className="opacity-70">~{Math.max(0, Math.round(
									job.progress.batch_progress.eta_seconds))}s left</span>
							)}
						</span>
					)}
				</div>
			)}
			<div className="flex-1 min-h-0 overflow-hidden">
				{wf?.workflow_yaml
					// The SAME surface the workflow UI uses, read-only — not a second
					// viewer that happens to look like it. WorkflowEditor wraps the
					// very WorkflowCanvas this panel used to mount directly, so the
					// graph is unchanged; what it adds is the whole reason to stop
					// duplicating it:
					//
					//   * a YAML / Canvas toggle, so a run can be read as text
					//     without leaving the drawer;
					//   * DIALECT DETECTION. The bare canvas is Lumilake-only, so a
					//     FlowMesh or xpio workflow opened from chat drew nothing;
					//   * an UnknownDialect fallback that renders the text and SAYS
					//     why it could not be drawn. The bare canvas failed silent:
					//     a malformed workflow produced an empty drawer, no message
					//     and no console error.
					//
					// Its YAML pane is a plain <textarea>, not Monaco — which
					// matters here, because Monaco fetches itself from a CDN our CSP
					// blocks and would have sat on "Loading…" forever.
					? <WorkflowEditor
							value={wf.workflow_yaml}
							plan={wf.plan}
							overlay={wf.run_state}
							readOnly
							height="100%"
						/>
					: <div className="p-4 text-[12px] text-muted-foreground">No workflow to show yet — optimize or run one from chat.</div>}
			</div>
			{plan?.error && (
				<div className="px-3 py-2 border-t border-border text-[11px] text-rose-600 flex-shrink-0">optimizer: {plan.error}</div>
			)}
		</aside>
	), document.body);
}
