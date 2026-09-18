// flowmesh.ts — the FlowMesh native dialect (`apiVersion: flowmesh/v1`).
//
//   apiVersion: flowmesh/v1
//   kind: InferenceTask
//   metadata: {name, owner, annotations}
//   spec:
//     taskType: inference
//     resources: {hardware: {cpu, memory, gpu: {type, count}}}
//     model: {source: {type: huggingface, identifier}}
//     data: {...}
//     output: {destination: {type}, artifacts: [...]}
//     graph:                      # OPTIONAL — the multi-node form
//       nodes:
//         - name: branch-a
//           spec: {...}
//         - name: synthesis
//           dependsOn: [branch-a, branch-b]
//           spec: {...}
//
// THE THING THAT SHAPES THIS ADAPTER: most FlowMesh documents are not graphs.
// Thirteen of the fifteen kinds are a single task, and a canvas showing one
// lonely box is worse than no canvas — so a single-task document projects to
// one real node plus SYNTHETIC endpoints for its data source and output sink.
// Those two are drawn but never serialized: they exist to make the spec legible
// as a picture (what goes in, what comes out) without pretending the document
// has a topology it does not have.
//
// When `spec.graph` IS present, the nodes are real and `dependsOn` is the edge
// set. The top-level spec stays the shared configuration — model, resources and
// output live there and each node's spec carries only what varies, which is
// exactly how the shipped examples are written.

import { parse as parseYaml } from "yaml";
import {
	emptyGraph,
	type WfCapabilities, type WfDiagnostic, type WfEdge, type WfNode, type WorkflowGraph,
} from "../model";

interface GraphNode {
	name?: string;
	dependsOn?: unknown;
	spec?: Record<string, unknown>;
}
interface FlowMeshSpec {
	taskType?: string;
	resources?: Record<string, unknown>;
	model?: Record<string, unknown>;
	data?: Record<string, unknown>;
	output?: Record<string, unknown>;
	graph?: { nodes?: GraphNode[] };
	[k: string]: unknown;
}
export interface FlowMeshDoc {
	apiVersion?: string;
	kind?: string;
	metadata?: { name?: string; owner?: string; annotations?: Record<string, unknown> };
	spec?: FlowMeshSpec;
}

/** The fifteen kinds, as offered in the add palette. */
export const FLOWMESH_KINDS = [
	"InferenceTask", "AgentTask", "TrainingTask", "SFTTask", "LoRASFTTask", "OmniTask",
	"EmbeddingTask", "DiffusersTask", "ImageClassificationTask", "RetrievalTask",
	"DataProfilingTask", "ServeTask", "APITask", "SSHTask", "EchoTask",
] as const;

/** kind -> the taskType a new node should carry. They are not the same string. */
export const TASK_TYPE_OF: Record<string, string> = {
	InferenceTask: "inference", AgentTask: "agent", TrainingTask: "sft", SFTTask: "sft",
	LoRASFTTask: "lora_sft", OmniTask: "omni_text", EmbeddingTask: "embedding",
	DiffusersTask: "diffusion", ImageClassificationTask: "image_classification_training",
	RetrievalTask: "rag", DataProfilingTask: "data_profiling", ServeTask: "serve",
	APITask: "api", SSHTask: "ssh", EchoTask: "echo",
};

/**
 * taskType -> Kind. The document uses BOTH vocabularies: `kind: InferenceTask`
 * at the top, `taskType: inference` inside each spec. The model must settle on
 * one, and Kind is the right choice because that is what the registry, the
 * accent table and the add palette are all keyed on.
 *
 * Getting this wrong was not merely cosmetic: a graph node built with
 * `taskType: "inference"` looked up nothing in the registry, so every node in a
 * multi-node document fell through to "no parameter schema for this kind" —
 * while the identical task in a single-task document had a full form.
 */
const KIND_OF_TASK_TYPE: Record<string, string> = Object.fromEntries(
	Object.entries(TASK_TYPE_OF).map(([kind, tt]) => [tt, kind]),
);

/** Normalise either vocabulary to a Kind. */
export function toKind(v: string | undefined, fallback = "EchoTask"): string {
	if (!v) return fallback;
	if (TASK_TYPE_OF[v]) return v;              // already a Kind
	return KIND_OF_TASK_TYPE[v] ?? fallback;    // a taskType, or unknown
}

export const FLOWMESH_CAPABILITIES: WfCapabilities = {
	addNode: true,
	removeNode: true,
	// `dependsOn` is a plain list of node names, so an edge is an array entry —
	// the same cheap shape Lumilake has.
	rewire: true,
	reorder: true,
	renameNode: true,
	positions: "derived",
	palette: [...FLOWMESH_KINDS],
};

const NODE_LOCAL_KEYS = ["data", "taskType", "agent", "inference", "prompt"];

/** A one-line detail for the node card — the model, the data source, the mode. */
export function specDetail(spec: Record<string, unknown> | undefined, parent?: FlowMeshSpec): string {
	if (!spec) return "";
	const model = (spec.model ?? parent?.model) as { source?: { identifier?: string } } | undefined;
	if (model?.source?.identifier) return String(model.source.identifier);
	const data = spec.data as Record<string, unknown> | undefined;
	if (data?.dataset_name) return `dataset · ${String(data.dataset_name)}`;
	if (data?.url) return `dataset · ${String(data.url)}`;
	if (data?.type) return `data · ${String(data.type)}`;
	if (spec.taskType) return String(spec.taskType);
	return "";
}

function asList(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(String);
	return v != null ? [String(v)] : [];
}

/** Hardware, as a short badge: `A100x2` / `cpu 8`. */
function hardwareBadge(res: Record<string, unknown> | undefined): string | undefined {
	const hw = res?.hardware as Record<string, unknown> | undefined;
	if (!hw) return undefined;
	const gpu = hw.gpu as { type?: string; count?: number } | undefined;
	if (gpu?.count) {
		const t = gpu.type && gpu.type !== "any" ? String(gpu.type) : "GPU";
		return gpu.count > 1 ? `${t}x${gpu.count}` : t;
	}
	return hw.cpu ? `cpu ${hw.cpu}` : undefined;
}

export function projectFlowMesh(doc: FlowMeshDoc): WorkflowGraph {
	const g = emptyGraph("flowmesh", doc.metadata?.name ?? "");
	g.direction = "LR";
	g.layout = "dagre";
	g.meta = {
		apiVersion: doc.apiVersion,
		kind: doc.kind,
		owner: doc.metadata?.owner,
		annotations: doc.metadata?.annotations,
		taskType: doc.spec?.taskType,
	};

	const spec = doc.spec ?? {};
	const nodes: WfNode[] = [];
	const edges: WfEdge[] = [];
	const diagnostics: WfDiagnostic[] = [];

	if (!doc.apiVersion) {
		diagnostics.push({ level: "warning", message: "No apiVersion — FlowMesh expects `apiVersion: flowmesh/v1`." });
	}
	if (!doc.kind) {
		diagnostics.push({ level: "error", message: "No kind — FlowMesh cannot route this document to an executor." });
	}

	const graphNodes = spec.graph?.nodes;
	const isGraph = Array.isArray(graphNodes) && graphNodes.length > 0;

	if (isGraph) {
		const names = new Set(graphNodes.map((n) => n?.name).filter(Boolean) as string[]);
		graphNodes.forEach((n, i) => {
			if (!n?.name) {
				diagnostics.push({ level: "error", message: `spec.graph.nodes[${i}] has no name — nothing can depend on it.` });
				return;
			}
			const badges = [];
			const hw = hardwareBadge((n.spec?.resources ?? spec.resources) as Record<string, unknown>);
			if (hw) badges.push({ kind: "gpu" as const, label: hw, title: "requested hardware" });
			nodes.push({
				id: n.name,
				kind: { family: "flowmesh-task", taskType: toKind(String(n.spec?.taskType ?? spec.taskType ?? doc.kind ?? ""), doc.kind ?? "EchoTask") },
				label: n.name,
				subtitle: specDetail(n.spec, spec),
				params: { ...(n.spec ?? {}) },
				path: ["spec", "graph", "nodes", i, "spec"],
				inputs: [{ id: "in", kind: "data" }],
				outputs: [{ id: "out", kind: "data" }],
				badges: badges.length ? badges : undefined,
			});
			for (const dep of asList(n.dependsOn)) {
				if (!names.has(dep)) {
					diagnostics.push({
						level: "error",
						node: n.name,
						message: `dependsOn "${dep}" names no node in spec.graph.`,
					});
					continue;
				}
				edges.push({ id: `${dep}->${n.name}`, source: dep, target: n.name, rel: "data" });
			}
		});
	} else {
		// The single-task form. One real node, flanked by synthetic endpoints so
		// the spec reads as a picture without claiming a topology it lacks.
		const name = doc.metadata?.name || "task";
		const badges = [];
		const hw = hardwareBadge(spec.resources);
		if (hw) badges.push({ kind: "gpu" as const, label: hw, title: "requested hardware" });

		if (spec.data) {
			nodes.push({
				id: "__data",
				kind: { family: "io", role: "input" },
				label: dataLabel(spec.data),
				subtitle: "input",
				params: { ...spec.data },
				path: ["spec", "data"],
				inputs: [],
				outputs: [{ id: "out", kind: "data" }],
				synthetic: true,
			});
			edges.push({ id: `__data->${name}`, source: "__data", target: name, rel: "data" });
		}

		nodes.push({
			id: name,
			kind: { family: "flowmesh-task", taskType: toKind(doc.kind ?? String(spec.taskType ?? "")) },
			label: name,
			subtitle: specDetail(spec),
			params: { ...spec },
			path: ["spec"],
			inputs: spec.data ? [{ id: "in", kind: "data" }] : [],
			outputs: spec.output ? [{ id: "out", kind: "data" }] : [],
			badges: badges.length ? badges : undefined,
		});

		if (spec.output) {
			const dest = (spec.output.destination as { type?: string } | undefined)?.type;
			nodes.push({
				id: "__output",
				kind: { family: "io", role: "output" },
				label: dest ? `output · ${dest}` : "output",
				subtitle: asList((spec.output as { artifacts?: unknown }).artifacts).slice(0, 2).join(", "),
				params: { ...spec.output },
				path: ["spec", "output"],
				inputs: [{ id: "in", kind: "data" }],
				outputs: [],
				synthetic: true,
			});
			edges.push({ id: `${name}->__output`, source: name, target: "__output", rel: "data" });
		}
	}

	g.nodes = nodes;
	g.edges = edges;
	g.diagnostics = diagnostics;
	return g;
}

function dataLabel(data: Record<string, unknown>): string {
	if (data.dataset_name) return String(data.dataset_name);
	if (data.url) return String(data.url);
	if (data.type) return `data · ${String(data.type)}`;
	return "data";
}

/** True when this document is a real DAG rather than one task with endpoints. */
export function isGraphForm(doc: FlowMeshDoc): boolean {
	const n = doc.spec?.graph?.nodes;
	return Array.isArray(n) && n.length > 0;
}

/**
 * True when the canvas should step aside for the form.
 *
 * A single task is not a graph, and drawing one box with two stubs as if it
 * were is the kind of thing that makes a tool feel like it is performing
 * rather than working. The caller reduces the canvas to a header strip and
 * gives the spec form the room instead.
 */
export function isFormFirst(g: WorkflowGraph): boolean {
	return g.format === "flowmesh" && g.nodes.filter((n) => !n.synthetic).length <= 1;
}

export function parseFlowMesh(text: string): WorkflowGraph {
	let doc: FlowMeshDoc;
	try {
		doc = (parseYaml(text) || {}) as FlowMeshDoc;
	} catch (e) {
		const g = emptyGraph("flowmesh");
		g.diagnostics = [{ level: "error", message: String((e as Error).message || e) }];
		return g;
	}
	return projectFlowMesh(doc);
}

export { NODE_LOCAL_KEYS };
