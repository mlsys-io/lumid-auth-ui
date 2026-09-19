// import/dify.ts — read a Dify DSL app. One way, like n8n.
//
// Dify's DSL is, conveniently, a serialized React Flow graph — the same shape
// our canvas already thinks in:
//
//   version: "0.7.0"          # a QUOTED string; unquoting it breaks the import
//   kind: app
//   app: {name, mode}         # workflow | advanced-chat | agent
//   workflow:
//     graph:
//       nodes: [{id, type: "custom", position, data: {type: llm, ...}}]
//       edges: [{source, target, sourceHandle}]
//
// TWO TRAPS, BOTH LOAD-BEARING:
//
//   The node's own `type` is almost always the literal string "custom" — the
//   real kind is `data.type`. Reading the wrong one makes every node identical.
//
//   `sourceHandle` carries BRANCH IDENTITY, not a port name: an if-else uses
//   "true"/"false" or a case id, a question-classifier uses a class id. An
//   edge that drops it loses which branch it was.
//
// Dify also stores UI bookkeeping inside `data` (_hovering, _runningStatus,
// selected, _connected*). Those are the frontend's scratch space, not the
// workflow, and importing them would carry another tool's transient state into
// our document.

import { parse as parseYaml } from "yaml";
import {
	edgeId, emptyGraph,
	type WfDiagnostic, type WfEdge, type WfNode, type WorkflowGraph,
} from "../model";
import { scaffoldLumilake, type ScaffoldResult } from "./n8n";

interface DifyNode {
	id?: string;
	type?: string;
	position?: { x?: number; y?: number };
	data?: Record<string, unknown>;
}
interface DifyEdge {
	id?: string;
	source?: string;
	target?: string;
	sourceHandle?: string;
	targetHandle?: string;
}
export interface DifyDoc {
	version?: string;
	kind?: string;
	app?: { name?: string; mode?: string };
	workflow?: { graph?: { nodes?: DifyNode[]; edges?: DifyEdge[] } };
	dependencies?: unknown[];
	[k: string]: unknown;
}

/** Frontend scratch space that must never reach our document. */
const UI_KEYS = new Set([
	"_hovering", "_connectedNodeIsHovering", "_connectedSourceHandleIds",
	"_connectedTargetHandleIds", "_runningStatus", "_singleRunningStatus",
	"_isCandidate", "_targetBranches", "selected", "_isEntering", "_showAddVariablePopup",
]);

function stripUi(data: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(data)) {
		if (UI_KEYS.has(k) || k === "type" || k === "title" || k === "desc") continue;
		out[k] = v;
	}
	return out;
}

/** Dify kind -> Lumilake op, where one exists. */
const TO_OP: Record<string, string> = {
	llm: "LLMChatOp",
	"template-transform": "FormatOp",
	code: "LambdaOp",
	"knowledge-retrieval": "DataRetrievalOp",
	answer: "MessageOp",
	end: "MessageOp",
};

/** Kinds that exist in Dify and have no equivalent anywhere in our runtimes. */
const CONTROL_FLOW = new Set(["if-else", "question-classifier", "iteration", "loop", "variable-aggregator", "agent", "tool"]);

/** Dify's variable reference syntax: {{#node_id.field#}}. */
const VAR_REF = /\{\{#[^}]*#\}\}/;

function hasVarRef(v: unknown): boolean {
	if (typeof v === "string") return VAR_REF.test(v);
	if (Array.isArray(v)) return v.some(hasVarRef);
	if (v && typeof v === "object") return Object.values(v).some(hasVarRef);
	return false;
}

function detailOf(kind: string, data: Record<string, unknown>): string {
	const model = data.model as { name?: string; provider?: string } | undefined;
	if (model?.name) return model.name;
	if (typeof data.code_language === "string") return String(data.code_language);
	return kind;
}

export function projectDify(doc: DifyDoc): WorkflowGraph {
	const g = emptyGraph("dify", doc.app?.name ?? "");
	g.direction = "LR";
	g.layout = "authored";

	const nodes: WfNode[] = [];
	const edges: WfEdge[] = [];
	const diagnostics: WfDiagnostic[] = [];

	const graph = doc.workflow?.graph;
	if (!graph?.nodes) {
		diagnostics.push({ level: "error", message: "No workflow.graph.nodes — this is not a Dify workflow app." });
		g.diagnostics = diagnostics;
		return g;
	}
	if (doc.version && !/^\d+\.\d+\.\d+$/.test(doc.version)) {
		diagnostics.push({ level: "warning", message: `version "${doc.version}" is not the x.y.z Dify expects.` });
	}

	const ids = new Set<string>();
	graph.nodes.forEach((n, i) => {
		if (!n?.id) {
			diagnostics.push({ level: "error", message: `workflow.graph.nodes[${i}] has no id — edges reference nodes by id.` });
			return;
		}
		ids.add(n.id);
		const data = n.data ?? {};
		// The REAL kind. `n.type` is the literal "custom" on almost every node.
		const kind = typeof data.type === "string" ? data.type : "unknown";
		const title = typeof data.title === "string" && data.title ? data.title : n.id;
		const op = TO_OP[kind];

		nodes.push({
			id: n.id,
			kind: kind === "custom-note" || kind === "note"
				? { family: "note" }
				: op
					? { family: "lumilake-op", op }
					: { family: "unknown", raw: kind },
			label: title,
			subtitle: detailOf(kind, data),
			params: stripUi(data),
			path: ["workflow", "graph", "nodes", i, "data"],
			inputs: [{ id: "in", kind: "data" }],
			outputs: [{ id: "out", kind: "data" }],
			ui: n.position ? { x: n.position.x ?? 0, y: n.position.y ?? 0 } : undefined,
		});

		if (CONTROL_FLOW.has(kind)) {
			diagnostics.push({
				level: "warning",
				node: n.id,
				message: `"${kind}" is control flow Dify runs itself. Nothing in Lumilake or FlowMesh expresses it, so it cannot be imported — only redesigned.`,
				untranslatable: true,
			});
		}
		if (hasVarRef(data)) {
			diagnostics.push({
				level: "warning",
				node: n.id,
				message: "Uses Dify variable references ({{#node.field#}}). Those are not translated; rewire this node's inputs by hand.",
			});
		}
	});

	for (const e of graph.edges ?? []) {
		if (!e?.source || !e?.target) continue;
		if (!ids.has(e.source) || !ids.has(e.target)) {
			diagnostics.push({ level: "error", message: `An edge references ${!ids.has(e.source) ? e.source : e.target}, which is not a node in this graph.` });
			continue;
		}
		// sourceHandle carries branch identity. "source" is Dify's name for the
		// ordinary single output, so only anything else is a real branch.
		const branch = e.sourceHandle && e.sourceHandle !== "source" ? e.sourceHandle : undefined;
		edges.push({
			id: e.id || edgeId(e.source, e.target, branch),
			source: e.source,
			target: e.target,
			sourcePort: branch,
			rel: branch ? "branch" : "data",
			label: branch,
		});
	}

	g.nodes = nodes;
	g.edges = edges;
	g.diagnostics = diagnostics;
	g.meta = { source: "dify", mode: doc.app?.mode, version: doc.version };
	return g;
}

export function parseDify(text: string): WorkflowGraph {
	try {
		return projectDify((parseYaml(text) || {}) as DifyDoc);
	} catch (e) {
		const g = emptyGraph("dify");
		g.diagnostics = [{ level: "error", message: String((e as Error).message || e) }];
		return g;
	}
}

/**
 * Scaffold a Lumilake document. Shares n8n's builder, because once a graph is
 * in the model the two are the same problem — which is the payoff for having a
 * model at all.
 *
 * Branch edges are the honest limit: Lumilake has no conditional, so an
 * if-else becomes two unconditional inputs. That is reported, not smoothed
 * over.
 */
export function scaffoldFromDify(g: WorkflowGraph): ScaffoldResult {
	const r = scaffoldLumilake(g);
	const branches = g.edges.filter((e) => e.rel === "branch").length;
	if (branches) {
		r.notes.push(
			`${branches} branch edge(s) were flattened: Lumilake has no conditional, so every branch becomes an unconditional input. The logic needs rebuilding.`,
		);
	}
	const control = g.nodes.filter((n) => n.kind.family === "unknown" && CONTROL_FLOW.has(n.kind.raw)).length;
	if (control) {
		r.notes.push(`${control} control-flow node(s) have no equivalent at all and were left out.`);
	}
	return r;
}

export { CONTROL_FLOW };
