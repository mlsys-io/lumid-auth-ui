// LumilakeWorkflowCanvas — renders a LUMILAKE-NATIVE workflow (name + inputs +
// ops) as a React-Flow DAG, with an optional HALO optimizer overlay.
//
// Adapted from mlsys-io/lumilake.ui's canvas/FlowCanvas.tsx, but for the
// Lumilake-native shape our MCP tools use (optimize_workflow / run_workflow):
//   - each `op` -> a node (colored by op type),
//   - each top-level `inputs:` key -> an InputOp source node,
//   - EDGES are derived from each op's `inputs` list (an entry equal to another
//     op's id is an upstream dep; an entry equal to a top-level input name binds
//     that input). (lumilake.ui derives edges from `depends_on`; native uses
//     `op.inputs`.)
// The optional `plan` (optimize_workflow result) badges each op with the HALO
// worker it was assigned to, best-effort matched (runtime node ids embed the
// op id, e.g. `graph_0__llm_graph_0_Reply_38`).
//
// Self-contained: reuses @xyflow/react (already a dep) + @dagrejs/dagre; no
// import from lumilake.ui's type system.

import { useEffect, useMemo, useRef } from 'react';
import {
	Background, Controls, ReactFlow, useEdgesState, useNodesState,
	Handle, Position, type Edge, type Node, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { parse as parseYaml } from 'yaml';

export type HaloPlan = {
	selected_workers?: string[];
	worker_assignment?: Record<string, string[]>;
	runtime_graph_node_counts?: Record<string, number>;
	merged_runtime_node_count?: number;
	optimization_seconds?: number;
	selection_seconds?: number;
	error?: string;
};

type NodeData = {
	label: string;
	op: string;           // op type (FormatOp, LLMChatOp, InputOp, …)
	subtitle: string;
	worker?: string;      // HALO-assigned worker, if any
};

const NODE_W = 210;
const NODE_H = 60;

// op type → accent color (Tailwind class fragments)
function opColor(op: string): string {
	if (op === 'InputOp') return 'border-slate-300 bg-slate-50';
	if (op === 'LLMChatOp' || op === 'LLMOp') return 'border-purple-400 bg-purple-50';
	if (op === 'LLMVisionOp') return 'border-pink-400 bg-pink-50';
	if (op === 'ImageGenerationOp') return 'border-fuchsia-400 bg-fuchsia-50';
	if (op === 'LambdaOp') return 'border-amber-400 bg-amber-50';
	if (op === 'FormatOp' || op === 'MessageOp') return 'border-emerald-400 bg-emerald-50';
	if (op === 'DataRetrievalOp' || op === 'DataOp') return 'border-blue-400 bg-blue-50';
	return 'border-gray-300 bg-white';
}

function OpNode({ data }: NodeProps<Node<NodeData>>) {
	return (
		<div className={`flex h-full w-full flex-col justify-between rounded-lg border-2 p-2 text-left shadow-sm ${opColor(data.op)}`}>
			<Handle type="target" position={Position.Left} />
			<Handle type="source" position={Position.Right} />
			<div className="text-[11px] font-semibold text-gray-900 truncate">{data.label}</div>
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

type ParsedOp = { id: string; op: string; inputs?: unknown; config?: unknown; template?: unknown; data_spec?: unknown; fn_name?: unknown };
type Parsed = { name?: string; inputs?: Record<string, unknown>; ops?: ParsedOp[] };

// A meaningful one-line detail for a node subtitle — the op's key parameter
// (model / template / data mode / fn) rather than just repeating the op type
// (which the node color + label already convey). This is what makes the graph
// worth opening instead of an unlabeled box grid.
function opDetail(o: ParsedOp): string {
	const cfg = o.config && typeof o.config === 'object' ? (o.config as Record<string, unknown>) : undefined;
	if (cfg?.model) return String(cfg.model);
	if (o.op === 'FormatOp' && typeof o.template === 'string') return `"${o.template.slice(0, 30)}${o.template.length > 30 ? '…' : ''}"`;
	if ((o.op === 'DataRetrievalOp' || o.op === 'DataOp') && o.data_spec && typeof o.data_spec === 'object') {
		const d = o.data_spec as Record<string, unknown>;
		const m = d.mode || d.type;
		return m ? `data · ${String(m)}` : 'data';
	}
	if (o.op === 'LambdaOp' && o.fn_name) return `fn ${String(o.fn_name)}`;
	return o.op || 'op';
}

// Best-effort: map a HALO worker_assignment (worker -> [runtime node ids]) to op
// ids by substring (runtime ids embed the op id). Returns opId -> worker.
function workerByOp(plan?: HaloPlan, opIds: string[] = []): Record<string, string> {
	const out: Record<string, string> = {};
	const wa = plan?.worker_assignment;
	if (!wa) return out;
	for (const [worker, nodes] of Object.entries(wa)) {
		for (const rn of nodes || []) {
			const hit = opIds.find((id) => rn === id || rn.includes(`_${id}_`) || rn.includes(`_${id}`) || rn.endsWith(id));
			if (hit && !out[hit]) out[hit] = worker;
		}
	}
	return out;
}

export function parseWorkflow(workflowYaml: string, plan?: HaloPlan): { nodes: Node[]; edges: Edge[]; error?: string } {
	let wf: Parsed;
	try { wf = (parseYaml(workflowYaml) || {}) as Parsed; }
	catch (e) { return { nodes: [], edges: [], error: String((e as Error).message || e) }; }
	const ops = Array.isArray(wf.ops) ? wf.ops : [];
	const inputNames = wf.inputs && typeof wf.inputs === 'object' ? Object.keys(wf.inputs) : [];
	const opIds = ops.map((o) => o.id).filter(Boolean);
	const opIdSet = new Set(opIds);
	const inputSet = new Set(inputNames);
	const wbo = workerByOp(plan, opIds);

	// dagre layout (LR)
	const g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 60 });
	g.setDefaultEdgeLabel(() => ({}));
	for (const name of inputNames) g.setNode(`input:${name}`, { width: NODE_W, height: NODE_H });
	for (const o of ops) if (o.id) g.setNode(o.id, { width: NODE_W, height: NODE_H });

	const edges: Edge[] = [];
	const addEdge = (src: string, tgt: string) => {
		const id = `${src}->${tgt}`;
		if (!edges.some((e) => e.id === id)) { edges.push({ id, source: src, target: tgt, animated: false }); g.setEdge(src, tgt); }
	};
	for (const o of ops) {
		if (!o.id) continue;
		const ins = Array.isArray(o.inputs) ? o.inputs : o.inputs != null ? [o.inputs] : [];
		for (const raw of ins) {
			const ref = String(raw);
			if (opIdSet.has(ref)) addEdge(ref, o.id);
			else if (inputSet.has(ref)) addEdge(`input:${ref}`, o.id);
		}
	}
	dagre.layout(g);

	const nodes: Node[] = [];
	for (const name of inputNames) {
		const p = g.node(`input:${name}`);
		const vals = wf.inputs?.[name];
		const n = Array.isArray(vals) ? vals.length : vals != null ? 1 : 0;
		nodes.push({
			id: `input:${name}`, type: 'op',
			position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
			style: { width: NODE_W, height: NODE_H },
			data: { label: name, op: 'InputOp', subtitle: `input · ${n} value${n === 1 ? '' : 's'}` },
		});
	}
	for (const o of ops) {
		if (!o.id) continue;
		const p = g.node(o.id);
		nodes.push({
			id: o.id, type: 'op',
			position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
			style: { width: NODE_W, height: NODE_H },
			data: { label: o.id, op: o.op || 'Op', subtitle: opDetail(o), worker: wbo[o.id] },
		});
	}
	return { nodes, edges };
}

export default function LumilakeWorkflowCanvas({ workflowYaml, plan }: { workflowYaml: string; plan?: HaloPlan }) {
	const { nodes: initNodes, edges: initEdges, error } = useMemo(() => parseWorkflow(workflowYaml, plan), [workflowYaml, plan]);
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
