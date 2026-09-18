// import/n8n.ts — read an n8n graph. One way, and honest about it.
//
// TWO JOBS, AND KEEPING THEM SEPARATE IS THE WHOLE DESIGN:
//
//   1. PROJECT — render an n8n graph in our canvas. This is not translation,
//      it is drawing somebody else's shape, and it is lossless because nothing
//      is being converted. Every node renders, including the ones no runtime
//      of ours understands.
//
//   2. SCAFFOLD — produce a Lumilake document as a STARTING POINT. Explicitly
//      not a faithful translation, and the UI says so.
//
// WHY NOT A REAL TRANSLATOR. Two authoritative n8n parsers already exist
// server-side and they disagree with each other: FlowMesh's accepts five node
// types (src/server/task/n8n_parser.py) and Lumilake's nine
// (lumilake_server/parser/n8n.py), with different mappings. Writing a third in
// the browser would not resolve that disagreement, it would add to it — and it
// would be the one that silently diverges, because it is the one with no tests
// against the runtime. So: to RUN an n8n graph, submit it with
// `Workflow-Format: n8n` and let the server that owns the semantics do the
// work. What this file offers is a view and a head start.
//
// Never written back out. There is no n8n serializer anywhere in this tree.

import {
	edgeId, emptyGraph,
	type WfDiagnostic, type WfEdge, type WfNode, type WorkflowGraph,
} from "../model";

interface N8nNode {
	name?: string;
	type?: string;
	parameters?: Record<string, unknown>;
	position?: [number, number];
	credentials?: Record<string, unknown>;
	notes?: string;
	disabled?: boolean;
	[k: string]: unknown;
}
export interface N8nDoc {
	name?: string;
	nodes?: N8nNode[];
	connections?: Record<string, Record<string, Array<Array<{ node?: string; type?: string; index?: number }>>>>;
	[k: string]: unknown;
}

/**
 * The node types FlowMesh's parser accepts, for reporting only — we do not
 * reimplement what it does with them. Anything outside this set cannot reach a
 * FlowMesh task however the graph is submitted.
 */
export const FLOWMESH_ACCEPTED = new Set([
	"n8n-nodes-base.set",
	"@n8n/n8n-nodes-langchain.chainLlm",
	"@n8n/n8n-nodes-langchain.lmOpenHuggingFaceInference",
	"@n8n/n8n-nodes-langchain.lmChatOpenAi",
	"@n8n/n8n-nodes-langchain.openAi",
]);

/** What a node type becomes in a Lumilake scaffold, where anything does. */
const TO_OP: Record<string, string> = {
	"@n8n/n8n-nodes-langchain.chainLlm": "LLMChatOp",
	"@n8n/n8n-nodes-langchain.openAi": "LLMChatOp",
	"n8n-nodes-base.set": "FormatOp",
	"n8n-nodes-base.code": "LambdaOp",
	"n8n-nodes-base.postgres": "DataRetrievalOp",
	"n8n-nodes-base.noOp": "MessageOp",
};

/**
 * PROVIDER nodes exist only to be attached to something else. An
 * `lmChatOpenAi` node is not a task that runs — it is the model a chain node
 * uses, expressed as a node because n8n's canvas has no other way to say it.
 *
 * Turning one into an op produced an orphan LLMChatOp with no inputs and no
 * consumer: a node in the imported graph that does nothing, sitting there
 * looking like it might. Instead the provider is folded into whatever it
 * attaches to, and its model becomes that op's config.
 */
const PROVIDER_TYPES = new Set([
	"@n8n/n8n-nodes-langchain.lmChatOpenAi",
	"@n8n/n8n-nodes-langchain.lmOpenHuggingFaceInference",
	"@n8n/n8n-nodes-langchain.lmChatAnthropic",
	"@n8n/n8n-nodes-langchain.embeddings",
]);

/** A model/tool plugged INTO a chain node, rather than feeding data to it. */
const ATTACH_TYPES = new Set(["ai_languageModel", "ai_tool", "ai_memory", "ai_embedding", "ai_document"]);

/** n8n's expression syntax. We do not translate it, so we report it. */
const EXPR = /=?\{\{[^}]*\}\}/;

function hasExpression(v: unknown): boolean {
	if (typeof v === "string") return EXPR.test(v);
	if (Array.isArray(v)) return v.some(hasExpression);
	if (v && typeof v === "object") return Object.values(v).some(hasExpression);
	return false;
}

/** A short, meaningful subtitle: the model, the mode, the first text. */
function detailOf(n: N8nNode): string {
	const p = n.parameters ?? {};
	if (typeof p.model === "string") return p.model;
	if (typeof p.mode === "string") return `mode · ${p.mode}`;
	if (typeof p.text === "string" && p.text) return `"${p.text.slice(0, 28)}${p.text.length > 28 ? "…" : ""}"`;
	// A type like `n8n-nodes-base.httpRequest` reads better as `httpRequest`.
	return (n.type ?? "").split(".").pop() ?? "node";
}

/**
 * Project an n8n graph for viewing.
 *
 * Authored positions are honoured, so an imported workflow opens looking like
 * it did in n8n. Nodes we cannot map are still drawn — as `unknown`, which the
 * canvas renders grey and dashed — because hiding them would misrepresent the
 * graph the user is looking at.
 */
export function projectN8n(doc: N8nDoc): WorkflowGraph {
	const g = emptyGraph("n8n", doc.name ?? "");
	g.direction = "LR";
	// n8n carries x/y, so honour them rather than re-laying-out somebody's graph.
	g.layout = "authored";

	const nodes: WfNode[] = [];
	const edges: WfEdge[] = [];
	const diagnostics: WfDiagnostic[] = [];
	const byName = new Map<string, N8nNode>();

	for (const [i, n] of (doc.nodes ?? []).entries()) {
		if (!n?.name) {
			diagnostics.push({ level: "error", message: `nodes[${i}] has no name — n8n keys its connections by name, so nothing can reference it.` });
			continue;
		}
		byName.set(n.name, n);
		const op = TO_OP[n.type ?? ""];
		const provider = PROVIDER_TYPES.has(n.type ?? "");
		nodes.push({
			id: n.name,
			// A provider still RENDERS — it is in the graph the user is looking
			// at — but it is not an op, so it is not offered as one.
			kind: op
				? { family: "lumilake-op", op }
				: { family: "unknown", raw: n.type ?? "?" },
			group: provider ? "provider" : undefined,
			label: n.name,
			subtitle: detailOf(n),
			params: { ...(n.parameters ?? {}) },
			path: ["nodes", i],
			inputs: [{ id: "in", kind: "data" }],
			outputs: [{ id: "out", kind: "data" }],
			ui: n.position ? { x: n.position[0], y: n.position[1] } : undefined,
			status: n.disabled ? "skipped" : undefined,
		});

		if (n.credentials && Object.keys(n.credentials).length) {
			diagnostics.push({
				level: "warning",
				node: n.name,
				message: "Carries credentials. Those are never imported — re-enter them on the target side.",
			});
		}
		if (hasExpression(n.parameters)) {
			diagnostics.push({
				level: "warning",
				node: n.name,
				message: "Uses an n8n expression ({{ … }}). Expressions are not translated; this node's wiring will need doing by hand.",
			});
		}
	}

	// n8n's `connections` is an adjacency MAP keyed by source node name, then by
	// connection type, then a list of output slots, each a list of targets. The
	// connection TYPE is load-bearing: `ai_languageModel` plugs a model into a
	// chain node, which is not data flow and must not render as a pipeline.
	for (const [source, byType] of Object.entries(doc.connections ?? {})) {
		if (!byName.has(source)) {
			diagnostics.push({ level: "error", message: `connections names "${source}", which is not a node in this graph.` });
			continue;
		}
		for (const [connType, slots] of Object.entries(byType ?? {})) {
			(slots ?? []).forEach((slot, slotIndex) => {
				for (const target of slot ?? []) {
					if (!target?.node) continue;
					if (!byName.has(target.node)) {
						diagnostics.push({ level: "error", node: source, message: `connects to "${target.node}", which is not a node in this graph.` });
						continue;
					}
					const attach = ATTACH_TYPES.has(connType);
					const id = edgeId(source, target.node, `${connType}:${slotIndex}`);
					if (edges.some((e) => e.id === id)) continue;
					edges.push({
						id,
						// An attach edge points the other way round from how n8n
						// stores it: the MODEL is the source in the file, but it
						// plugs INTO the chain node, so that is the direction that
						// reads correctly.
						source,
						target: target.node,
						rel: attach ? "attach" : slotIndex > 0 ? "branch" : "data",
						label: attach ? connType.replace(/^ai_/, "") : slotIndex > 0 ? `out ${slotIndex}` : undefined,
					});
				}
			});
		}
	}

	g.nodes = nodes;
	g.edges = edges;
	g.diagnostics = diagnostics;
	g.meta = { source: "n8n", nodeCount: nodes.length };
	return g;
}

export function parseN8n(text: string): WorkflowGraph {
	try {
		return projectN8n(JSON.parse(text) as N8nDoc);
	} catch (e) {
		const g = emptyGraph("n8n");
		g.diagnostics = [{ level: "error", message: String((e as Error).message || e) }];
		return g;
	}
}

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

export interface ScaffoldResult {
	/** The Lumilake document to start from. */
	text: string;
	/** Nodes that made it across. */
	mapped: Array<{ from: string; to: string; op: string }>;
	/** Nodes that did not, and why. Rendered as ghost cards in the dialog. */
	dropped: Array<{ name: string; type: string; reason: string }>;
	notes: string[];
}

/**
 * Walk back from `id` along data edges until a node that survived the mapping
 * is found, stepping over the ones that did not. Cycle-safe.
 */
function upstreamsThrough(g: WorkflowGraph, id: string, kept: Map<string, string>): string[] {
	const out: string[] = [];
	const seen = new Set<string>([id]);
	const stack = g.edges.filter((e) => e.target === id && e.rel !== "attach").map((e) => e.source);
	while (stack.length) {
		const cur = stack.pop()!;
		if (seen.has(cur)) continue;
		seen.add(cur);
		if (kept.has(cur)) {
			if (!out.includes(cur)) out.push(cur);
			continue;
		}
		for (const e of g.edges) {
			if (e.target === cur && e.rel !== "attach") stack.push(e.source);
		}
	}
	return out;
}

/** A Lumilake op id: lowercase, underscores, unique. */
function opId(name: string, taken: Set<string>): string {
	const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "op";
	if (!taken.has(base)) { taken.add(base); return base; }
	for (let i = 2; ; i++) {
		const c = `${base}_${i}`;
		if (!taken.has(c)) { taken.add(c); return c; }
	}
}

function yamlString(v: string): string {
	return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build a Lumilake document from an n8n graph — a STARTING POINT, not a
 * translation, and the dialog says exactly that.
 *
 * Only the topology and the prompts come across. Expressions, credentials and
 * every node type with no Lumilake equivalent are reported rather than guessed
 * at. Guessing is what would make this dangerous: a workflow that looks
 * imported and runs wrong is worse than one that plainly did not import.
 */
export function scaffoldLumilake(g: WorkflowGraph): ScaffoldResult {
	const taken = new Set<string>();
	const idOf = new Map<string, string>();
	const mapped: ScaffoldResult["mapped"] = [];
	const dropped: ScaffoldResult["dropped"] = [];

	for (const n of g.nodes) {
		if (n.kind.family !== "lumilake-op") {
			const isProvider = n.group === "provider";
			// Prefer the reason the PARSER already worked out. It knows why a
			// particular node cannot come across — that an if-else is control flow
			// Dify runs itself, for instance — and falling back to the generic
			// line threw that away at exactly the point the user reads it.
			const specific = g.diagnostics.find((d) => d.node === n.id && d.untranslatable)?.message;
			dropped.push({
				name: n.label,
				type: n.kind.family === "unknown" ? n.kind.raw : n.kind.family,
				reason: isProvider
					? "A model provider, not a task. Its model was folded into the op it was attached to, so it does not become a node of its own."
					: specific
						?? "No Lumilake op does this. Add a step by hand, or run the original through its own runtime.",
			});
			continue;
		}
		const id = opId(n.label, taken);
		idOf.set(n.id, id);
		mapped.push({ from: n.label, to: id, op: n.kind.op });
	}

	const lines: string[] = [`name: ${g.name || "imported"}`, "ops:"];
	for (const n of g.nodes) {
		const id = idOf.get(n.id);
		if (!id) continue;
		const op = (n.kind as { op: string }).op;
		// Only DATA edges become inputs. An attach edge is a model plugged into a
		// chain node, which Lumilake expresses as config, not as a dependency.
		//
		// Upstreams are resolved THROUGH dropped nodes. A Dify start node or an
		// n8n manual trigger has no Lumilake equivalent, so A -> trigger -> B
		// would otherwise leave A and B as two disconnected orphans — a scaffold
		// that lost the pipeline while keeping all its parts. Bridging preserves
		// the flow; where the bridge crosses control flow, the notes already say
		// the logic needs rebuilding.
		const deps = upstreamsThrough(g, n.id, idOf).map((src) => idOf.get(src)!);
		lines.push(`  - id: ${id}`);
		lines.push(`    op: ${op}`);
		if (deps.length) lines.push(`    inputs: [${deps.join(", ")}]`);

		const p = n.params as Record<string, unknown>;
		if (op === "LLMChatOp") {
			const text = typeof p.text === "string" ? p.text : "";
			lines.push("    messages:");
			lines.push(`      - {role: user, content: ${yamlString(text)}}`);
			// Lift the model off whatever provider node was ATTACHED to this one;
			// that is where n8n keeps it.
			const attached = g.edges.find((e) => e.rel === "attach" && e.target === n.id);
			const providerNode = attached ? g.nodes.find((x) => x.id === attached.source) : undefined;
			const providerModel = providerNode && typeof (providerNode.params as { model?: unknown }).model === "string"
				? String((providerNode.params as { model: string }).model)
				: undefined;
			const model = providerModel ?? (typeof p.model === "string" ? p.model : "Qwen/Qwen2.5-7B-Instruct");
			lines.push(`    config: {model: ${model}}`);
		} else if (op === "FormatOp") {
			lines.push(`    template: ${yamlString(typeof p.value === "string" ? p.value : "{input}")}`);
			lines.push("    format_kwargs: {}");
		} else if (op === "LambdaOp") {
			lines.push("    fn_name: fn");
			lines.push("    code: |");
			lines.push("      def fn(inputs: tuple[str, ...]) -> str:");
			lines.push("          (x,) = inputs");
			lines.push("          return x");
		}
	}

	// A workflow with no outputs fails server-side with "Missing output for
	// workflow", so point the last mapped op at one rather than leave a trap.
	const last = mapped[mapped.length - 1];
	if (last) {
		lines.splice(1, 0, "outputs:", `  - name: result`, `    ref: ${last.to}`);
	}

	const notes: string[] = [];
	const exprNodes = g.diagnostics.filter((d) => d.message.includes("expression")).length;
	if (exprNodes) notes.push(`${exprNodes} node(s) use n8n expressions. Those are not translated — check every prompt before running.`);
	const credNodes = g.diagnostics.filter((d) => d.message.includes("credentials")).length;
	if (credNodes) notes.push(`${credNodes} node(s) carried credentials. None were imported.`);
	const attach = g.edges.filter((e) => e.rel === "attach").length;
	if (attach) notes.push(`${attach} model/tool attachment(s) became config rather than nodes — confirm the model on each op.`);
	if (!mapped.length) notes.push("Nothing in this graph maps to a Lumilake op, so the scaffold is empty.");

	return { text: lines.join("\n") + "\n", mapped, dropped, notes };
}

/** How much of this graph could FlowMesh's own parser accept, if submitted? */
export function flowmeshCoverage(doc: N8nDoc): { accepted: number; total: number; unsupported: string[] } {
	const types = (doc.nodes ?? []).map((n) => n.type ?? "?");
	const unsupported = [...new Set(types.filter((t) => !FLOWMESH_ACCEPTED.has(t)))];
	return { accepted: types.filter((t) => FLOWMESH_ACCEPTED.has(t)).length, total: types.length, unsupported };
}
