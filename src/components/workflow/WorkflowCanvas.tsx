// WorkflowCanvas — n8n-style node view of one workflow (loop).
//
// This file is now a THIN RENDERER. The two honest shapes it draws are decided
// by src/workflow/adapters/xpio.ts, and their geometry by src/workflow/layout.ts:
//
//   Pattern A (runner-driven):  trigger → step → step → … → knowledge
//     each step node = one skill call, colored by its five-stage band
//     (observe → hypothesize → act → analyze → learn).
//
//   Pattern B (command-driven): trigger → engine ─┬─(declared)─ skill
//     the engine node is the real execution unit;  ├─(declared)─ skill
//     skills_invoked[] hang off DASHED edges        └─(declared)─ skill
//     because the contract enforces no ordering for them.
//
// n8n ideas borrowed: typed nodes, per-node status badge on each execution,
// click-node → data panel (StepInspectorPanel), execution replay (the panel's
// ?cycle=<ts> selection drives this overlay).
//
// modes: "observe" (interactive, controls, click-to-inspect) and
// "showcase" (static, compact — marketplace cards + app surfaces).
//
// One behaviour change worth knowing about: the stage a node belongs to is now
// computed ONCE, by the adapter, and stored on the node. The old code recomputed
// it here from `nodes.indexOf(n)` — an index into an array that also held the
// trigger and the already-unshifted band nodes — so a custom step name that fell
// through to the positional heuristic could land in a band that disagreed with
// the node's own stage label. Reading the stored value removes that mismatch
// (and an O(n²) scan).

import { useMemo } from "react";
import { ReactFlow, Background, Controls, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LoopDefinition, MeCycleDetail, MeCycleStep } from "@/api/me";
import { LOOP_STAGES } from "@/components/workflow/LoopOrbit";
import { projectXpio, isEmptyLoop } from "@/workflow/adapters/xpio";
import { layoutGraph, LAYOUT_GEOMETRY } from "@/workflow/layout";
import type { WfNode, WfStatus } from "@/workflow/model";
import {
	STATUS_COLOR, STATUS_BORDER, STAGE_TINT, STAGE_LABEL_COLOR,
	GOLD_SOFT, EDGE_IDLE, edgeDash,
} from "@/workflow/theme";

export interface CanvasStepRef {
	step_id: string;
	skill?: string;
	declared?: boolean; // Pattern B skills_invoked — no live status
	cycleStep?: MeCycleStep; // overlay from the selected run
}

interface Props {
	definition: LoopDefinition;
	cycle?: MeCycleDetail | null;
	running?: boolean;
	mode?: "observe" | "showcase";
	// Explicit canvas height. When set (e.g. the panel sizes it to the screen),
	// it overrides the content-derived height; fitView (capped at zoom 1) then
	// centers the graph in the taller box at native font size.
	height?: number | string;
	onStepSelect?: (ref: CanvasStepRef) => void;
}

const NODE_W = 196;
const NODE_H = 80;
const { GUTTER } = LAYOUT_GEOMETRY;

const STAGE_LABELS = Object.fromEntries(LOOP_STAGES.map((s) => [s.key, s.label]));

export default function WorkflowCanvas({ definition, cycle, running = false, mode = "observe", height: heightProp, onStepSelect }: Props) {
	const showcase = mode === "showcase";

	const { nodes, edges, contentH } = useMemo(() => {
		const g = projectXpio(definition, { cycle, running, bands: !showcase });
		const { positions, bands, contentH } = layoutGraph(g, { direction: "TB" });

		const nodes: Node[] = [];

		// Bands first so they land BEHIND everything. They are real background
		// elements with zIndex set as a node property (not inside style, which
		// React Flow v12 does not honour reliably) and are never selectable.
		for (const b of bands) {
			const tint = STAGE_TINT[b.key];
			if (!tint) continue;
			nodes.push({
				id: `band:${b.key}`,
				position: { x: b.x, y: b.y },
				data: { label: "" },
				draggable: false,
				selectable: false,
				zIndex: -1,
				style: {
					width: b.width,
					height: b.height,
					background: tint,
					border: "none",
					borderRadius: 14,
					pointerEvents: "none" as const,
				},
			});
			nodes.push({
				id: `bandlabel:${b.key}`,
				position: { x: 2, y: b.y + b.height / 2 - 8 },
				data: {
					label: (
						<div className="text-[10px] font-semibold uppercase tracking-wider text-right" style={{ color: STAGE_LABEL_COLOR[b.key] }}>
							{STAGE_LABELS[b.key] ?? b.key}
						</div>
					),
				},
				draggable: false,
				selectable: false,
				zIndex: 0,
				style: { width: GUTTER, background: "transparent", border: "none", pointerEvents: "none" as const },
			});
		}

		for (const n of g.nodes) {
			const p = positions.get(n.id);
			if (!p) continue;
			nodes.push({
				id: n.id,
				position: { x: p.x, y: p.y },
				data: { label: <NodeLabel node={n} /> },
				sourcePosition: Position.Bottom,
				targetPosition: Position.Top,
				zIndex: 1,
				style: nodeStyle(n.status ?? "pending"),
			});
		}

		const edges: Edge[] = g.edges.map((e) => {
			const toSink = e.target === "knowledge";
			return {
				id: e.id,
				source: e.source,
				target: e.target,
				// Orthogonal routing (down-then-across) keeps the fan-out tidy
				// instead of bezier curves that cross at odd angles.
				type: e.rel === "declared" || toSink ? "smoothstep" : undefined,
				animated: running && e.rel !== "declared",
				style: {
					stroke: toSink ? GOLD_SOFT : EDGE_IDLE,
					// Dashed "declared" edges — the canonical contract enforces NO
					// ordering for skills_invoked[] in Pattern B; don't draw a
					// pipeline that doesn't exist.
					strokeDasharray: edgeDash(e.rel),
				},
				label: e.label,
				labelStyle: { fontSize: 9, fill: "rgb(100 116 139)" },
				labelBgStyle: { fill: "white", fillOpacity: 0.85 },
			};
		});

		return { nodes, edges, contentH };
	}, [definition, cycle, running, showcase]);

	if (isEmptyLoop(definition)) return null;

	// Height tracks the actual vertical content so fitView (capped at zoom 1)
	// renders nodes at their native font size — text stays comparable to the
	// rest of the page. Long pipelines are capped and pan/scroll instead of
	// shrinking the text to fit.
	const height = heightProp ?? (showcase ? 200 : Math.min(Math.max(220, contentH + 24), 760));

	return (
		<div className="rounded-xl border border-slate-200 bg-white" style={{ height }}>
			<ReactFlow
				// Remount when the graph or the overlaid run changes — fitView
				// only runs on init, so late-arriving cycle data otherwise
				// leaves the viewport framed on the old (or empty) graph.
				key={`${nodes.length}:${cycle?.ts || ""}:${showcase}`}
				nodes={nodes}
				edges={edges}
				// Observe mode: center the graph HORIZONTALLY but pin it to the
				// TOP (zoom 1) — fitView centers both axes (hiding the top of a
				// tall pipeline), so we fitView for the horizontal centering +
				// zoom, then override the vertical offset to start at the top and
				// pan/scroll down for the rest. Showcase thumbnails just fitView.
				fitView={showcase}
				defaultViewport={showcase ? undefined : { x: 0, y: 8, zoom: 1 }}
				fitViewOptions={{ padding: showcase ? 0.1 : 0.12, maxZoom: 1, minZoom: showcase ? 0.2 : 1 }}
				onInit={showcase ? undefined : (rf) => {
					requestAnimationFrame(() => {
						rf.fitView({ padding: 0.12, minZoom: 1, maxZoom: 1 });
						const vp = rf.getViewport();
						rf.setViewport({ ...vp, y: 8 });
					});
				}}
				proOptions={{ hideAttribution: true }}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={!showcase}
				zoomOnScroll={false}
				panOnScroll={!showcase}
				panOnDrag={!showcase}
				onNodeClick={(_e, node) => {
					if (showcase || !onStepSelect) return;
					if (node.id.startsWith("step:") || node.id.startsWith("skill:")) {
						const stepID = node.id.replace(/^(step|skill):/, "");
						const cs = (cycle?.steps || []).find((s) => s.step_id === stepID);
						const decl = node.id.startsWith("skill:");
						const skill = definition.steps?.find((s) => (s.id || s.skill) === stepID)?.skill || (decl ? stepID : undefined);
						onStepSelect({ step_id: stepID, skill, declared: decl && !cs, cycleStep: cs });
					}
				}}
			>
				<Background gap={16} color="rgb(241 245 249)" />
				{!showcase && <Controls showInteractive={false} />}
			</ReactFlow>
		</div>
	);
}

function nodeStyle(status: WfStatus): React.CSSProperties {
	return {
		background: "white",
		border: `2px solid ${STATUS_BORDER[status] || STATUS_BORDER.pending}`,
		borderRadius: 12,
		padding: 0,
		fontSize: 13,
		fontWeight: 500,
		boxShadow: status === "running" ? `0 0 0 4px ${STATUS_COLOR.running}30` : "0 1px 2px rgba(15, 23, 42, 0.04)",
		minWidth: NODE_W,
	};
}

function NodeLabel({ node }: { node: WfNode }) {
	const status = node.status ?? "pending";
	const stage = node.kind.family === "xpio-step" ? node.kind.stage : node.group;
	// The run's per-step result, shown AS TEXT inside the node so the pipeline
	// is self-explanatory without clicking (error wins over output summary).
	const detail = node.run?.error ? node.run.error.split("\n")[0] : node.run?.summary;
	const experiment = node.badges?.some((b) => b.kind === "experiment");
	const knowledge = node.badges?.some((b) => b.kind === "knowledge");
	return (
		<div className="px-3 py-2 text-left" style={{ width: NODE_W }} data-pick-kind="cycle-step" data-pick-id={node.label}>
			<div className="flex items-center gap-1.5">
				<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[status] }} />
				<span className="text-[13px] text-slate-900 truncate flex-1">{node.label}</span>
				{experiment && <span title="runs an experiment" className="text-[11px]">🧪</span>}
				{knowledge && <span title="writes to a knowledge bank" className="text-[11px]">🧠</span>}
			</div>
			<div className="flex items-center gap-1.5 mt-0.5">
				{node.subtitle && <span className="text-[11px] text-slate-500 truncate" style={{ maxWidth: 112 }}>{node.subtitle}</span>}
				{node.run?.duration_s !== undefined && (
					<span className="text-[11px] text-slate-400 font-mono ml-auto">{node.run.duration_s.toFixed(1)}s</span>
				)}
				{stage && !node.subtitle && (
					<span className="text-[10px] uppercase tracking-wide" style={{ color: STAGE_LABEL_COLOR[stage] || "rgb(148 163 184)" }}>{stage}</span>
				)}
			</div>
			{detail && (
				<div className={`mt-1 text-[10px] leading-snug line-clamp-2 ${node.run?.error ? "text-rose-600" : "text-slate-500"}`} title={detail}>
					{detail}
				</div>
			)}
		</div>
	);
}
