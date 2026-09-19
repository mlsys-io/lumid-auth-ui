// WorkflowCanvas — one canvas for every dialect.
//
// Controlled and stateless with respect to the graph: it renders what it is
// given and reports intent. Increment 1 ships the read-only modes (view / run /
// showcase); `edit` lands with the inspector and brings onEdit with it.
//
// Modes, spelled out so nobody has to guess:
//
//                    view      edit      run       showcase
//   draggable        no        yes       no        no
//   connectable      no        yes       no        no
//   zoomOnScroll     NO        yes       NO        no
//   panOnDrag        yes       yes       yes       no
//   minimap          >12       yes       >12       no
//   controls         yes       yes       yes       no
//
// zoomOnScroll is off in view/run on purpose. A canvas embedded in a scrolling
// page that eats the wheel is the worst default React Flow has; edit mode is
// full-bleed, so there it owns the wheel.

import { useEffect, useMemo, useRef, useState } from "react";
import {
	Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider,
	type Connection, type Edge, type Node, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WfNodeCard, type WfCardData } from "./nodes/WfNodeCard";
import { StageBand, StageLabel } from "./nodes/StageBand";
import { CanvasControls, DiagnosticsStrip } from "./nodes/CanvasChrome";
import { layoutGraph, layoutKey, LAYOUT_GEOMETRY } from "./layout";
import { applyOverlay, type WfEdit, type WfNode, type WfOverlay, type WorkflowGraph } from "./model";
import { ACCENT, CANVAS_DOT, CANVAS_GRID, accentOf, edgeDash, edgeStroke, edgeWidth } from "./theme";

export type CanvasMode = "view" | "edit" | "run" | "showcase";

export interface WorkflowCanvasProps {
	graph: WorkflowGraph;
	/** Run state, keyed by node id. Applied on top of the parsed graph. */
	overlay?: WfOverlay;
	mode?: CanvasMode;
	density?: "comfortable" | "compact";
	/** Explicit height; otherwise derived from the laid-out content. */
	height?: number | string;
	selection?: string | null;
	onSelectionChange?: (id: string | null) => void;
	onNodeDoubleClick?: (node: WfNode) => void;
	chrome?: { minimap?: boolean; controls?: boolean; background?: boolean; diagnostics?: boolean };
	className?: string;
	emptyState?: React.ReactNode;
	/**
	 * Edit mode only. The canvas NEVER mutates anything itself — it reports
	 * intent and the caller applies it to the document, which is what keeps the
	 * document the single source of truth.
	 */
	onEdit?: (edit: WfEdit) => void;
	/** Adapter-supplied. False for xpio, whose contract has no drawable edge. */
	canConnect?: boolean;
}

const nodeTypes = { wf: WfNodeCard, band: StageBand, bandlabel: StageLabel };

function WorkflowCanvasInner({
	graph, overlay, mode = "view", density = "comfortable", height: heightProp,
	selection, onSelectionChange, onNodeDoubleClick, chrome, className, emptyState,
	onEdit, canConnect = false,
}: WorkflowCanvasProps) {
	const showcase = mode === "showcase";
	const editing = mode === "edit";
	const rf = useRef<ReactFlowInstance | null>(null);
	const wrap = useRef<HTMLDivElement | null>(null);
	// Focus-by-dimming keys off SELECTION, not hover.
	//
	// It was hover, and that made the canvas flicker: every mouse move across the
	// graph changed the neighbourhood, which re-animated every node's opacity.
	// Measured while sweeping the cursor over three nodes — 27 distinct opacity
	// states and 24 of 70 samples caught mid-fade. The feature is worth keeping;
	// driving it from a pointer that moves continuously was not.
	//
	// Selection changes only on click, so the graph settles and stays settled.

	const g = useMemo(() => applyOverlay(graph, overlay), [graph, overlay]);
	const vertical = g.direction === "TB";

	// The memo key MUST be structural. Keying on the graph object re-runs dagre
	// whenever a parameter changes and slides nodes out from under the cursor.
	const key = layoutKey(g, { density });
	const laid = useMemo(
		() => layoutGraph(g, { density }),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[key],
	);

	const neighbourhood = useMemo(() => {
		if (!selection) return null;
		const keep = new Set<string>([selection]);
		for (const e of g.edges) {
			if (e.source === selection) keep.add(e.target);
			if (e.target === selection) keep.add(e.source);
		}
		return keep;
	}, [selection, g.edges]);

	const nodes = useMemo<Node[]>(() => {
		const out: Node[] = [];

		// Bands first, so they land behind. zIndex is a NODE PROPERTY in v12 —
		// putting it in `style` is unreliable and fights the selection layer.
		for (const b of laid.bands) {
			out.push({
				id: `band:${b.key}`,
				type: "band",
				position: { x: b.x, y: b.y },
				data: { stage: b.key, label: b.label, width: b.width, height: b.height },
				draggable: false, selectable: false, zIndex: -1,
			});
			out.push({
				id: `bandlabel:${b.key}`,
				type: "bandlabel",
				position: { x: 2, y: b.y + b.height / 2 - 8 },
				data: { stage: b.key, label: b.label, width: LAYOUT_GEOMETRY.GUTTER },
				draggable: false, selectable: false, zIndex: 0,
			});
		}

		for (const n of g.nodes) {
			const p = laid.positions.get(n.id);
			if (!p) continue;
			out.push({
				id: n.id,
				type: "wf",
				position: { x: p.x, y: p.y },
				selected: selection === n.id,
				draggable: editing,
				connectable: editing && canConnect,
				selectable: !showcase,
				zIndex: 1,
				data: {
					node: n,
					density,
					direction: g.direction,
					dimmed: neighbourhood ? !neighbourhood.has(n.id) : false,
					interactive: !showcase,
				} satisfies WfCardData,
			});
		}
		return out;
	}, [g.nodes, g.direction, laid, density, selection, showcase, neighbourhood, editing, canConnect]);

	const edges = useMemo<Edge[]>(
		() => g.edges.map((e) => {
			const dim = neighbourhood ? !(neighbourhood.has(e.source) && neighbourhood.has(e.target)) : false;
			const stroke = edgeStroke(e.rel, e.status);
			return {
				id: e.id,
				source: e.source,
				target: e.target,
				// smoothstep everywhere: beziers crossing at odd angles is the
				// other classic stock-demo tell, and orthogonal routing keeps a
				// fan-out tidy.
				type: "smoothstep",
				// Animate ONLY the in-edges of a running node. Animating the whole
				// graph says "everything is moving"; this points at where the run is.
				animated: e.status === "running",
				style: {
					stroke,
					strokeWidth: edgeWidth(e.rel, e.status),
					strokeDasharray: edgeDash(e.rel),
					opacity: dim ? 0.25 : 1,
					transition: "opacity 140ms ease",
				},
				label: e.label,
				labelStyle: { fontSize: 9, fill: "rgb(100 116 139)" },
				labelBgStyle: { fill: "white", fillOpacity: 0.85 },
				labelBgPadding: [4, 2] as [number, number],
				labelBgBorderRadius: 4,
				// An `attach` edge is a plug-in relation, not flow — keep it under
				// the node layer so it reads as wiring rather than a pipeline.
				zIndex: e.rel === "attach" ? 0 : 1,
			};
		}),
		[g.edges, neighbourhood],
	);

	// Refit when the canvas itself changes size. Without this, opening the
	// inspector narrows the pane and the right-hand nodes slide underneath it —
	// the graph looks truncated at exactly the moment the user asked to inspect
	// it. Debounced, because a drag-resize fires this continuously.
	useEffect(() => {
		const el = wrap.current;
		if (!el || showcase) return;
		let t: ReturnType<typeof setTimeout> | undefined;
		let first = true;
		const obs = new ResizeObserver(() => {
			// The observer fires once on attach; that pass is the initial layout,
			// which onInit has already framed.
			if (first) { first = false; return; }
			if (t) clearTimeout(t);
			t = setTimeout(() => {
				rf.current?.fitView({ padding: 0.12, minZoom: vertical ? 1 : 0.4, maxZoom: 1, duration: 200 });
				if (vertical) {
					const vp = rf.current?.getViewport();
					if (vp) rf.current?.setViewport({ ...vp, y: 8 });
				}
			}, 120);
		});
		obs.observe(el);
		return () => { if (t) clearTimeout(t); obs.disconnect(); };
	}, [showcase, vertical]);

	if (!g.nodes.length) return emptyState ?? null;

	const showMinimap = chrome?.minimap ?? (!showcase && g.nodes.length > 12);
	const showControls = chrome?.controls ?? !showcase;
	const showBackground = chrome?.background ?? true;
	const showDiagnostics = chrome?.diagnostics ?? (!showcase && g.diagnostics.length > 0);

	// Height tracks the laid-out content so fitView (capped at zoom 1) renders
	// nodes at native font size; long pipelines pan instead of shrinking.
	const height = heightProp ?? (showcase ? 200 : Math.min(Math.max(220, laid.contentH + 24), 760));

	return (
		<div ref={wrap} className={className ?? "rounded-xl border border-slate-200 bg-[#FCFCFD]"} style={{ height }}>
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onInit={(i) => {
					rf.current = i;
					if (showcase) return;
					requestAnimationFrame(() => {
						// A tall pipeline must be pinned to the TOP: fitView centres
						// both axes, which hides the first steps. Fit for the
						// horizontal centring and zoom, then override y.
						i.fitView({ padding: 0.12, minZoom: vertical ? 1 : 0.4, maxZoom: 1 });
						if (vertical) {
							const vp = i.getViewport();
							i.setViewport({ ...vp, y: 8 });
						}
					});
				}}
				fitView={showcase}
				fitViewOptions={{ padding: showcase ? 0.1 : 0.12, maxZoom: 1, minZoom: showcase ? 0.2 : 0.4 }}
				proOptions={{ hideAttribution: true }}
				nodesDraggable={editing}
				nodesConnectable={editing && canConnect}
				elementsSelectable={!showcase}
				// THE WHEEL BELONGS TO THE PAGE. This was zoomOnScroll={editing},
				// justified as "edit mode is full-bleed so it owns the wheel" — but
				// the editor is a fixed-height box inside a scrolling page, so
				// scrolling past it rescaled the graph under the cursor and the page
				// never moved. That reads as the canvas flickering.
				//
				// preventScrolling={false} hands the wheel back; ctrl/cmd+wheel still
				// zooms, as does the controls pill, which is where zoom belongs for
				// an embedded canvas.
				zoomOnScroll={false}
				preventScrolling={false}
				// NOTE: this stops the ZOOM, which is what was visibly wrong. It does
				// NOT hand the wheel back to the page — measured, with an off-canvas
				// control proving the rig scrolls (458px) while over the pane it stays
				// at 0. React Flow still swallows the event. `nowheel` on the wrapper
				// was tried and does nothing (that class is for elements inside
				// nodes). Left as a known limitation rather than dead code.
				zoomOnDoubleClick={!showcase}
				panOnScroll={!showcase && !editing}
				panOnDrag={!showcase}
				deleteKeyCode={editing ? ["Backspace", "Delete"] : null}
				onConnect={editing && canConnect && onEdit ? (c: Connection) => {
					if (!c.source || !c.target) return;
					onEdit({ t: "connect", source: c.source, target: c.target });
				} : undefined}
				onNodesDelete={editing && onEdit ? (deleted) => {
					for (const n of deleted) if (n.type === "wf") onEdit({ t: "removeNode", id: n.id });
				} : undefined}
				onEdgesDelete={editing && onEdit ? (deleted) => {
					for (const e of deleted) onEdit({ t: "disconnect", edge: e.id });
				} : undefined}
				onNodeClick={showcase ? undefined : (_e, n) => {
					if (n.type !== "wf") return;
					onSelectionChange?.(selection === n.id ? null : n.id);
				}}
				onNodeDoubleClick={showcase ? undefined : (_e, n) => {
					const found = g.nodes.find((x) => x.id === n.id);
					if (found) onNodeDoubleClick?.(found);
				}}
				onPaneClick={showcase ? undefined : () => onSelectionChange?.(null)}
			>
				{showBackground && (
					<Background variant={BackgroundVariant.Dots} gap={16} size={1} color={CANVAS_DOT} />
				)}
				{showBackground && !showcase && (
					// A second, coarser grid. Two stacked Backgrounds is supported and
					// reads as graph paper rather than as a dotted void.
					<Background id="major" variant={BackgroundVariant.Lines} gap={80} color={CANVAS_GRID} />
				)}
				{showMinimap && (
					<MiniMap
						pannable
						zoomable
						className="!rounded-lg !border !border-slate-200 !bg-white/80 !backdrop-blur"
						maskColor="rgba(15, 23, 42, 0.06)"
						nodeColor={(n) => {
							const found = g.nodes.find((x) => x.id === n.id);
							return found ? ACCENT[accentOf(found.kind)] : "transparent";
						}}
					/>
				)}
				{showControls && <CanvasControls />}
				{showDiagnostics && <DiagnosticsStrip diagnostics={g.diagnostics} />}
			</ReactFlow>
		</div>
	);
}

/**
 * The provider is mounted here rather than by every caller, so `useReactFlow`
 * works inside the controls pill without each surface remembering to wrap.
 */
export default function WorkflowCanvas(props: WorkflowCanvasProps) {
	return (
		<ReactFlowProvider>
			<WorkflowCanvasInner {...props} />
		</ReactFlowProvider>
	);
}
