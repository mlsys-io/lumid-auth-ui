// lumilake.ts — the Lumilake-native dialect.
//
//   name: hello
//   inputs:  { Name: ["world"] }        <- named source values
//   outputs: [{ name: reply, ref: Reply }]
//   ops:     [{ id, op, inputs: [...], ...opFields }]
//
// EDGES ARE DERIVED FROM `op.inputs`. There is no edges array: an entry equal
// to another op's id is an upstream dependency, an entry equal to a top-level
// input name binds that input. That is the whole topology rule, and it is why
// `connect` here is a single array push rather than a graph rewrite.
//
// The parsing logic (parseWorkflow / opDetail / workerByOp) came from
// components/workflow/LumilakeWorkflowCanvas.tsx nearly verbatim — it was
// already pure and correct. What changed is the return type: a WorkflowGraph
// instead of positioned React Flow nodes, so layout and rendering are somebody
// else's problem.

import { parse as parseYaml } from "yaml";
import {
	edgeId, emptyGraph,
	type WfBadge, type WfCapabilities, type WfDiagnostic, type WfEdge,
	type WfNode, type WorkflowGraph,
} from "../model";

/** optimize_workflow's result — where an op WOULD run (a plan, not a run). */
export type HaloPlan = {
	selected_workers?: string[];
	worker_assignment?: Record<string, string[]>;
	runtime_graph_node_counts?: Record<string, number>;
	merged_runtime_node_count?: number;
	optimization_seconds?: number;
	selection_seconds?: number;
	error?: string;
};

type ParsedOp = {
	id?: string;
	op?: string;
	inputs?: unknown;
	config?: unknown;
	template?: unknown;
	data_spec?: unknown;
	fn_name?: unknown;
	messages?: unknown;
	[k: string]: unknown;
};
type Parsed = {
	name?: string;
	inputs?: Record<string, unknown>;
	outputs?: Array<{ name?: string; ref?: string }>;
	ops?: ParsedOp[];
};

/** The op catalog, as offered in the add palette. Order is the menu order. */
export const LUMILAKE_OPS = [
	"DataRetrievalOp", "FormatOp", "LambdaOp", "LLMChatOp", "LLMVisionOp",
	"EmbeddingOp", "ImageGenerationOp", "MessageOp", "DataOp",
] as const;

export const LUMILAKE_CAPABILITIES: WfCapabilities = {
	addNode: true,
	removeNode: true,
	rewire: true,       // an edge IS an entry in op.inputs — trivially editable
	reorder: true,      // op.inputs is positional for some ops
	renameNode: true,
	positions: "derived", // the dialect has no x/y, and must never grow one
	palette: [...LUMILAKE_OPS],
};

/**
 * A meaningful one-line detail for the node subtitle — the op's key parameter
 * (model / template / data mode / fn) rather than repeating the op type, which
 * the accent colour and label already convey. This is what makes the graph
 * worth opening instead of an unlabelled box grid.
 */
export function opDetail(o: ParsedOp): string {
	const cfg = o.config && typeof o.config === "object" ? (o.config as Record<string, unknown>) : undefined;
	if (cfg?.model) return String(cfg.model);
	if (o.op === "FormatOp" && typeof o.template === "string") {
		return `"${o.template.slice(0, 30)}${o.template.length > 30 ? "…" : ""}"`;
	}
	if ((o.op === "DataRetrievalOp" || o.op === "DataOp") && o.data_spec && typeof o.data_spec === "object") {
		const d = o.data_spec as Record<string, unknown>;
		const m = d.mode || d.type;
		return m ? `data · ${String(m)}` : "data";
	}
	if (o.op === "LambdaOp" && o.fn_name) return `fn ${String(o.fn_name)}`;
	return o.op || "op";
}

/**
 * Best-effort: map a HALO worker_assignment (worker -> [runtime node ids]) back
 * to op ids by substring, because runtime ids embed the op id
 * (e.g. `graph_0__llm_graph_0_Reply_38`). Returns opId -> worker.
 */
export function workerByOp(plan?: HaloPlan, opIds: string[] = []): Record<string, string> {
	const out: Record<string, string> = {};
	const wa = plan?.worker_assignment;
	if (!wa) return out;
	for (const [worker, nodes] of Object.entries(wa)) {
		for (const rn of nodes || []) {
			const hit = opIds.find(
				(id) => rn === id || rn.includes(`_${id}_`) || rn.includes(`_${id}`) || rn.endsWith(id),
			);
			if (hit && !out[hit]) out[hit] = worker;
		}
	}
	return out;
}

/** Everything on an op except the structural keys — what the inspector edits. */
function opParams(o: ParsedOp): Record<string, unknown> {
	const { id: _id, op: _op, inputs: _inputs, ...rest } = o;
	return rest as Record<string, unknown>;
}

/**
 * Project a Lumilake document into the graph model.
 *
 * Structurally lossless: every op becomes a node, every top-level input
 * becomes a source node, and an `inputs` entry that matches NEITHER becomes a
 * visible diagnostic rather than a silent drop — a dangling reference is the
 * single most common authoring mistake in this dialect and the old canvas just
 * swallowed it.
 */
export function projectLumilake(wf: Parsed, plan?: HaloPlan): WorkflowGraph {
	const g = emptyGraph("lumilake", wf.name || "");
	g.direction = "LR";
	g.layout = "dagre";
	g.meta = { name: wf.name, outputs: wf.outputs };

	const ops = Array.isArray(wf.ops) ? wf.ops : [];
	const inputNames = wf.inputs && typeof wf.inputs === "object" ? Object.keys(wf.inputs) : [];
	const opIds = ops.map((o) => o.id).filter(Boolean) as string[];
	const opIdSet = new Set(opIds);
	const inputSet = new Set(inputNames);
	const wbo = workerByOp(plan, opIds);

	const nodes: WfNode[] = [];
	const edges: WfEdge[] = [];
	const diagnostics: WfDiagnostic[] = [];

	// Top-level inputs become source nodes. They are real document entries
	// (path = ["inputs", name]), not synthetic — you can edit their values.
	inputNames.forEach((name) => {
		const vals = wf.inputs?.[name];
		const n = Array.isArray(vals) ? vals.length : vals != null ? 1 : 0;
		nodes.push({
			id: `input:${name}`,
			kind: { family: "io", role: "input" },
			label: name,
			subtitle: `input · ${n} value${n === 1 ? "" : "s"}`,
			params: { values: vals },
			path: ["inputs", name],
			inputs: [],
			outputs: [{ id: "out", kind: "data" }],
		});
	});

	ops.forEach((o, i) => {
		if (!o.id) {
			diagnostics.push({ level: "error", message: `ops[${i}] has no id — it cannot be referenced or rendered.` });
			return;
		}
		const badges: WfBadge[] = [];
		if (wbo[o.id]) badges.push({ kind: "worker", label: wbo[o.id], title: "HALO-assigned worker" });
		nodes.push({
			id: o.id,
			kind: { family: "lumilake-op", op: o.op || "Op" },
			label: o.id,
			subtitle: opDetail(o),
			params: opParams(o),
			path: ["ops", i],
			inputs: [{ id: "in", kind: "data" }],
			outputs: [{ id: "out", kind: "data" }],
			badges: badges.length ? badges : undefined,
		});
	});

	// Edges from op.inputs. The index is carried as sourcePort because some ops
	// treat inputs positionally (FormatOp's format_kwargs bind by name, but
	// LambdaOp destructures the tuple) — dropping the index would make a
	// reorder unrepresentable.
	ops.forEach((o) => {
		if (!o.id) return;
		const ins = Array.isArray(o.inputs) ? o.inputs : o.inputs != null ? [o.inputs] : [];
		ins.forEach((raw, idx) => {
			const ref = String(raw);
			const src = opIdSet.has(ref) ? ref : inputSet.has(ref) ? `input:${ref}` : null;
			if (!src) {
				diagnostics.push({
					level: "error",
					node: o.id,
					message: `"${ref}" in ${o.id}.inputs matches no op id and no top-level input.`,
				});
				return;
			}
			const id = edgeId(src, o.id!, String(idx));
			if (edges.some((e) => e.id === id)) return;
			edges.push({
				id,
				source: src,
				sourcePort: String(idx),
				target: o.id!,
				rel: "data",
			});
		});
	});

	// A declared output whose ref points nowhere fails at submit time with a
	// server-side "Missing output for workflow" — catching it here turns a
	// remote 400 into a red dot on the canvas.
	for (const out of wf.outputs || []) {
		if (out?.ref && !opIdSet.has(out.ref)) {
			diagnostics.push({
				level: "error",
				message: `outputs[${out.name ?? "?"}].ref = "${out.ref}" matches no op id.`,
			});
		}
	}
	if (ops.length && !(wf.outputs || []).length) {
		diagnostics.push({
			level: "warning",
			message: "No top-level outputs: — the job will fail with \"Missing output for workflow\".",
		});
	}

	g.nodes = nodes;
	g.edges = edges;
	g.diagnostics = diagnostics;
	return g;
}

/** Parse YAML text into a graph. A syntax error becomes a diagnostic, not a throw. */
export function parseLumilake(text: string, plan?: HaloPlan): WorkflowGraph {
	let wf: Parsed;
	try {
		wf = (parseYaml(text) || {}) as Parsed;
	} catch (e) {
		const g = emptyGraph("lumilake");
		g.diagnostics = [{ level: "error", message: String((e as Error).message || e) }];
		return g;
	}
	return projectLumilake(wf, plan);
}
