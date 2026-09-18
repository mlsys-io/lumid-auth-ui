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

import { useCallback, useMemo, useRef, useState } from "react";
import {
	Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider,
	type Edge, type Node, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WfNodeCard, type WfCardData } from "./nodes/WfNodeCard";
import { StageBand, StageLabel } from "./nodes/StageBand";
import { CanvasControls, DiagnosticsStrip } from "./nodes/CanvasChrome";
import { layoutGraph, layoutKey, LAYOUT_GEOMETRY } from "./layout";
import { applyOverlay, type WfNode, type WfOverlay, type WorkflowGraph } from "./model";
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
}

const nodeTypes = { wf: WfNodeCard, band: StageBand, bandlabel: StageLabel };

function WorkflowCanvasInner({
	graph, overlay, mode = "view", density = "comfortable", height: heightProp,
	selection, onSelectionChange, onNodeDoubleClick, chrome, className, emptyState,
}: WorkflowCanvasProps) {
	const showcase = mode === "showcase";
	const rf = useRef<ReactFlowInstance | null>(null);
	// Focus-by-dimming: hovering a node drops everything outside its immediate
	// neighbourhood to 30%. This is what makes a 40-node graph readable, and it
	// is the cheapest legibility win on the canvas.
	const [hovered, setHovered] = useState<string | null>(null);

	const g = useMemo(() => applyOverlay(graph, overlay), [graph, overlay]);

	// The memo key MUST be structural. Keying on the graph object re-runs dagre
	// whenever a parameter changes and slides nodes out from under the cursor.
	const key = layoutKey(g, { density });
	const laid = useMemo(
		() => layoutGraph(g, { density }),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[key],
	);

	const neighbourhood = useMemo(() => {
		if (!hovered) return null;
		const keep = new Set<string>([hovered]);
		for (const e of g.edges) {
			if (e.source === hovered) keep.add(e.target);
			if (e.target === hovered) keep.add(e.source);
		}
		return keep;
	}, [hovered, g.edges]);

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
				draggable: false,
				connectable: false,
				selectable: !showcase,
				zIndex: 1,
				data: {
					node: n,
					density,
					dimmed: neighbourhood ? !neighbourhood.has(n.id) : false,
					interactive: !showcase,
				} satisfies WfCardData,
			});
		}
		return out;
	}, [g.nodes, laid, density, selection, showcase, neighbourhood]);

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

	if (!g.nodes.length) return emptyState ?? null;

	const vertical = g.direction === "TB";
	const showMinimap = chrome?.minimap ?? (!showcase && g.nodes.length > 12);
	const showControls = chrome?.controls ?? !showcase;
	const showBackground = chrome?.background ?? true;
	const showDiagnostics = chrome?.diagnostics ?? (!showcase && g.diagnostics.length > 0);

	// Height tracks the laid-out content so fitView (capped at zoom 1) renders
	// nodes at native font size; long pipelines pan instead of shrinking.
	const height = heightProp ?? (showcase ? 200 : Math.min(Math.max(220, laid.contentH + 24), 760));

	return (
		<div className={className ?? "rounded-xl border border-slate-200 bg-[#FCFCFD]"} style={{ height }}>
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
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={!showcase}
				zoomOnScroll={false}
				zoomOnDoubleClick={!showcase}
				panOnScroll={!showcase}
				panOnDrag={!showcase}
				onNodeMouseEnter={showcase ? undefined : (_e, n) => { if (n.type === "wf") setHovered(n.id); }}
				onNodeMouseLeave={showcase ? undefined : () => setHovered(null)}
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
