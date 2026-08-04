// StudioWorkflowPanel — right-edge pop-up drawer that visualizes a Lumilake
// workflow as a DAG (LumilakeWorkflowCanvas), with the HALO optimizer overlay.
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
import { Workflow as WorkflowIcon, X, Cpu, Clock } from 'lucide-react';
import LumilakeWorkflowCanvas, { type HaloPlan } from './workflow/LumilakeWorkflowCanvas';

const WIDTH_KEY = 'studio_workflow_panel_width_v1';
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 560;

type WorkflowPayload = { workflow_yaml: string; plan?: HaloPlan; title?: string };

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
					{plan && !plan.error && (
						<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
							{workers.length > 0 && (
								<span className="inline-flex items-center gap-0.5"><Cpu className="w-3 h-3" />{workers.length} worker{workers.length === 1 ? '' : 's'}</span>
							)}
							{optMs != null && (
								<span className="inline-flex items-center gap-0.5"><Clock className="w-3 h-3" />{optMs} ms optimize</span>
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
					? <LumilakeWorkflowCanvas workflowYaml={wf.workflow_yaml} plan={wf.plan} />
					: <div className="p-4 text-[12px] text-muted-foreground">No workflow to show yet — optimize or run one from chat.</div>}
			</div>
			{plan?.error && (
				<div className="px-3 py-2 border-t border-border text-[11px] text-rose-600 flex-shrink-0">optimizer: {plan.error}</div>
			)}
		</aside>
	);
}
