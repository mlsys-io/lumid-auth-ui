// LumilakeWorkflowCanvas — renders a LUMILAKE-NATIVE workflow (name + inputs +
// ops) as a React-Flow DAG, with an optional HALO optimizer overlay.
//
// This file is now a THIN RENDERER. The parsing that used to live here moved to
// src/workflow/adapters/lumilake.ts and the positioning to src/workflow/layout.ts,
// so the same graph can be drawn by other surfaces and — later — edited. What
// remains here is the node component and the React Flow wiring.
//
// The public API is unchanged: workflowYaml / plan / runState in, plus the
// `parseWorkflow` named export that StudioWorkflowPanel and the tests use.
//
// Run state gets its OWN visual channel — an outline ring plus a dot — because
// the border and background are already spent encoding op TYPE. Repainting
// those for status would make a running LLMChatOp indistinguishable from a
// DataRetrievalOp, trading one axis of information for another instead of
// adding one. (Status colours now come from workflow/theme.ts, which is also
// where the old ring-emerald-500 got corrected to the site's gold.)

import { useEffect, useMemo, useRef } from 'react';
import {
	Background, Controls, ReactFlow, useEdgesState, useNodesState,
	Handle, Position, type Edge, type Node, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parseLumilake, type HaloPlan } from '@/workflow/adapters/lumilake';
import { layoutGraph } from '@/workflow/layout';
import { applyOverlay, type WfStatus } from '@/workflow/model';
import { STATUS_COLOR, accentOf, edgeStroke, type AccentKey } from '@/workflow/theme';

export type { HaloPlan };

// Per-op execution state for a run overlay. Distinct from `HaloPlan`, which is
// a PLAN (where an op would run); this is what actually happened.
export type OpRunState = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type RunOverlay = Record<string, OpRunState>;

type NodeData = {
	label: string;
	accent: AccentKey;
	isInput: boolean;
	subtitle: string;
	worker?: string;
	state?: WfStatus;
};

function stateRing(state?: WfStatus): string {
	switch (state) {
		case 'running': return 'ring-2 ring-sky-500 ring-offset-1';
		case 'succeeded': return 'ring-1 ring-[rgb(176_143_69)]';
		case 'failed': return 'ring-2 ring-rose-600 ring-offset-1';
		case 'skipped': return 'opacity-50';
		default: return '';
	}
}

function StateDot({ state }: { state?: WfStatus }) {
	if (!state || state === 'pending') return null;
	// title= rather than a visible label: at 210x60 the subtitle line is already
	// carrying the model/mode, and a word like "succeeded" would crowd out the
	// detail that makes the node worth reading.
	return (
		<span
			title={state}
			className={`h-2 w-2 flex-shrink-0 rounded-full ${state === 'running' ? 'animate-pulse' : ''}`}
			style={{ background: STATUS_COLOR[state] }}
		/>
	);
}

const NODE_W = 210;
const NODE_H = 60;

function OpNode({ data }: NodeProps<Node<NodeData>>) {
	const accent = data.isInput ? 'rgb(148 163 184)' : undefined;
	return (
		<div
			className={`flex h-full w-full flex-col justify-between overflow-hidden rounded-lg border bg-white p-2 pl-2.5 text-left shadow-sm border-slate-200 ${stateRing(data.state)}`}
			style={{ borderLeft: `3px solid ${accent ?? ACCENT_CSS[data.accent]}` }}
		>
			<Handle type="target" position={Position.Left} />
			<Handle type="source" position={Position.Right} />
			<div className="flex items-center gap-1">
				<StateDot state={data.state} />
				<span className="text-[11px] font-semibold text-gray-900 truncate">{data.label}</span>
			</div>
			<div className="flex items-center justify-between gap-1 text-[9px] text-gray-500">
				<span className="truncate">{data.subtitle}</span>
				{data.worker && (
					<span className="flex-shrink-0 rounded px-1 py-0.5 bg-gray-900 text-white font-mono">{data.worker}</span>
				)}
			</div>
		</div>
	);
}
const nodeTypes = { op: OpNode };

// Resolved once — accentOf returns a key, theme owns the values.
const ACCENT_CSS: Record<AccentKey, string> = {
	compute: 'rgb(139 92 246)', data: 'rgb(59 130 246)', serve: 'rgb(20 184 166)',
	io: 'rgb(148 163 184)', util: 'rgb(16 185 129)', vision: 'rgb(236 72 153)',
	image: 'rgb(217 70 239)', unknown: 'rgb(203 213 225)',
};

/**
 * Parse + lay out a Lumilake workflow into React Flow primitives.
 *
 * Kept as a named export because StudioWorkflowPanel imports it. It is now a
 * shim over the adapter: parse -> overlay -> layout -> render primitives.
 */
export function parseWorkflow(
	workflowYaml: string,
	plan?: HaloPlan,
	runState?: RunOverlay,
): { nodes: Node[]; edges: Edge[]; error?: string } {
	const parsed = parseLumilake(workflowYaml, plan);
	// A YAML syntax error is the one diagnostic the caller renders specially.
	const fatal = parsed.diagnostics.find((d) => d.level === 'error' && !d.node && !parsed.nodes.length);
	if (fatal) return { nodes: [], edges: [], error: fatal.message };

	const g = applyOverlay(parsed, runState);
	const { positions } = layoutGraph(g, { direction: 'LR' });

	const nodes: Node[] = g.nodes.map((n) => {
		const p = positions.get(n.id);
		const worker = n.badges?.find((b) => b.kind === 'worker')?.label;
		return {
			id: n.id,
			type: 'op',
			position: { x: p?.x ?? 0, y: p?.y ?? 0 },
			style: { width: NODE_W, height: NODE_H },
			data: {
				label: n.label,
				accent: accentOf(n.kind),
				isInput: n.kind.family === 'io',
				subtitle: n.subtitle ?? '',
				worker,
				state: n.status,
			} satisfies NodeData,
		};
	});

	const edges: Edge[] = g.edges.map((e) => ({
		id: e.id,
		source: e.source,
		target: e.target,
		// Animate only the edges FEEDING a currently-running op. Animating the
		// whole graph would say "everything is moving"; animating the in-edges of
		// the one running node points at where the run actually is.
		animated: e.status === 'running',
		style: { stroke: edgeStroke(e.rel, e.status) },
	}));

	return { nodes, edges };
}

export default function LumilakeWorkflowCanvas(
	{ workflowYaml, plan, runState }: { workflowYaml: string; plan?: HaloPlan; runState?: RunOverlay },
) {
	const { nodes: initNodes, edges: initEdges, error } = useMemo(
		() => parseWorkflow(workflowYaml, plan, runState),
		[workflowYaml, plan, runState],
	);
	const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);
	useEffect(() => { setNodes(initNodes); setEdges(initEdges); }, [initNodes, initEdges, setNodes, setEdges]);

	const rf = useRef<ReactFlowInstance | null>(null);
	const wrap = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const el = wrap.current; if (!el) return;
		let t: ReturnType<typeof setTimeout> | undefined;
		const obs = new ResizeObserver(() => { if (t) clearTimeout(t); t = setTimeout(() => rf.current?.fitView({ padding: 0.15, duration: 250 }), 80); });
		obs.observe(el);
		return () => { if (t) clearTimeout(t); obs.disconnect(); };
	}, []);

	if (error) {
		return (
			<div className="p-3 text-[12px]">
				<div className="text-rose-600 mb-1">Couldn't parse the workflow YAML: {error}</div>
				<pre className="whitespace-pre-wrap break-words text-[11px] text-muted-foreground bg-muted rounded p-2 max-h-full overflow-auto">{workflowYaml}</pre>
			</div>
		);
	}
	return (
		<div ref={wrap} className="h-full w-full overflow-hidden">
			<ReactFlow
				nodes={nodes} edges={edges}
				onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
				onInit={(i) => { rf.current = i; }}
				nodeTypes={nodeTypes}
				fitView nodesDraggable
				proOptions={{ hideAttribution: true }}
			>
				<Background />
				<Controls showInteractive={false} />
			</ReactFlow>
		</div>
	);
}
