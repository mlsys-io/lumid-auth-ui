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
import { Workflow as WorkflowIcon, X, Cpu, Clock, Hash } from 'lucide-react';
import WorkflowCanvas from '@/workflow/WorkflowCanvas';
import { parseLumilake, type HaloPlan } from '@/workflow/adapters/lumilake';
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

	return (
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
						</div>
					)}
				</div>
				<button onClick={() => setOpen(false)} title="Close" aria-label="Close workflow panel"
					className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground">
					<X className="w-4 h-4" />
				</button>
			</header>
			<div className="flex-1 min-h-0 overflow-hidden">
				{wf?.workflow_yaml
					? <WorkflowCanvas
							graph={parseLumilake(wf.workflow_yaml, wf.plan)}
							overlay={wf.run_state}
							mode={wf.run_state ? 'run' : 'view'}
							height="100%"
							className="h-full w-full overflow-hidden bg-[#FCFCFD]"
						/>
					: <div className="p-4 text-[12px] text-muted-foreground">No workflow to show yet — optimize or run one from chat.</div>}
			</div>
			{plan?.error && (
				<div className="px-3 py-2 border-t border-border text-[11px] text-rose-600 flex-shrink-0">optimizer: {plan.error}</div>
			)}
		</aside>
	);
}
