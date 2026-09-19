// model.ts — the DSL-agnostic workflow graph.
//
// Five dialects render through this one model. Two of them we AUTHOR
// (Lumilake ops, FlowMesh flowmesh/v1), one is declarative config we edit a
// subtree of (xpio loops[]), and two are IMPORT-ONLY (n8n, Dify) — parsed in,
// converted once to a native dialect, never written back out.
//
// The hard rule that shapes everything here: THE DOCUMENT IS THE SOURCE OF
// TRUTH, the graph is a projection. Every node carries `path`, a JSON path
// back into the document it came from, so an edit is a patch at that path
// rather than a regeneration of the whole file. That is what lets us edit an
// xpcloud.yaml that a human wrote — comments, key order and anchors intact.
//
// Nothing in this file imports React or @xyflow/react. The graph is data; the
// canvas is one of several possible renderers of it.

import type { LoopStageKey } from "@/components/workflow/LoopOrbit";

/** Dialects we can author and write back. */
export type WfFormat = "lumilake" | "flowmesh" | "xpio";
/** Dialects we can only read, then convert into a WfFormat. */
export type WfImportFormat = "n8n" | "dify";
export type WfAnyFormat = WfFormat | WfImportFormat;

/**
 * What a node IS. A discriminated union rather than a string, because the
 * renderer needs to switch on `family` for geometry (an xpio stage band, a
 * Lumilake op, an io endpoint) and the registry keys off the specific kind.
 */
export type WfNodeKind =
	| { family: "lumilake-op"; op: string }             // LLMChatOp, FormatOp, …
	| { family: "flowmesh-task"; taskType: string }     // InferenceTask, SFTTask, …
	| { family: "xpio-step"; stage: LoopStageKey | "other" }
	| { family: "xpio-engine" }
	| { family: "io"; role: "input" | "output" | "trigger" | "sink" }
	| { family: "note" }
	| { family: "unknown"; raw: string };               // imported kind with no mapping

/** Runtime state, from a run overlay. NEVER read from the document. */
export type WfStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "declared";

/**
 * What a node DID on the overlaid run. Kept beside `status` rather than in
 * `params`, because params is the document projection and this is not in the
 * document — it is the run talking. Rendering it as text inside the node is
 * what makes a pipeline self-explanatory without clicking each box.
 */
export interface WfRun {
	duration_s?: number;
	summary?: string;
	error?: string;
}

export interface WfPort {
	id: string;
	label?: string;
	/** `model` renders as an attach handle (bottom/top), not a data handle. */
	kind: "data" | "model" | "branch" | "control";
}

export interface WfBadge {
	kind: "worker" | "experiment" | "knowledge" | "gpu" | "dataset";
	label: string;
	title?: string;
}

export interface WfNode {
	/** The document-native id — op.id, node name, step id. Stable across edits. */
	id: string;
	kind: WfNodeKind;
	label: string;
	/**
	 * The ONE meaningful parameter (model / template excerpt / skill / fn).
	 * This is what makes the graph worth opening instead of a grid of boxes.
	 */
	subtitle?: string;
	/** Read-only projection of this node's document subtree. */
	params: Record<string, unknown>;
	/** JSON path INTO the document — the edit anchor. Empty for synthetic nodes. */
	path: (string | number)[];
	inputs: WfPort[];
	outputs: WfPort[];
	/** Stage band / subgraph membership. */
	group?: string;
	status?: WfStatus;
	/** Result of the overlaid run, when one is applied. */
	run?: WfRun;
	badges?: WfBadge[];
	/** Rendered but never serialized — FlowMesh data/output endpoints. */
	synthetic?: boolean;
	/** Authored position, if the source dialect carried one (n8n, Dify). */
	ui?: { x: number; y: number };
}

/**
 * How two nodes relate. This is the field that lets one model carry five
 * dialects without lying about any of them:
 *
 *   data     — a real dependency. Lumilake op.inputs, FlowMesh dependsOn,
 *              Dify edge, xpio Pattern A sequence.
 *   declared — xpio Pattern B skills_invoked[]. The contract enforces NO
 *              ordering, so this must not render as a pipeline.
 *   attach   — n8n ai_languageModel / ai_tool. NOT data flow: the model plugs
 *              INTO the chain node. Different geometry, different styling.
 *   branch   — Dify sourceHandle (case id / "false" / class id), n8n output
 *              index > 0.
 */
export type WfRel = "data" | "declared" | "attach" | "branch";

export interface WfEdge {
	id: string;
	source: string;
	/** For positional inputs (some Lumilake ops), the index within inputs[]. */
	sourcePort?: string;
	target: string;
	targetPort?: string;
	rel: WfRel;
	label?: string;
	status?: WfStatus;
}

export type WfDiagnosticLevel = "error" | "warning" | "info";

export interface WfDiagnostic {
	level: WfDiagnosticLevel;
	/** Node id this attaches to, when it has one. */
	node?: string;
	message: string;
	/** Set by importers: this node/field could not be translated. */
	untranslatable?: boolean;
}

export interface WorkflowGraph {
	format: WfAnyFormat;
	name: string;
	nodes: WfNode[];
	edges: WfEdge[];
	/** Preferred flow direction. Lumilake/FlowMesh read LR; xpio reads TB. */
	direction: "LR" | "TB";
	/** Which layout strategy suits this shape — see layout.ts. */
	layout: "dagre" | "column" | "column-bands" | "authored";
	/** Header-level fields: schedule, owner, apiVersion, goal. */
	meta: Record<string, unknown>;
	diagnostics: WfDiagnostic[];
}

/** A run overlay, keyed by node id. Applied on top of a parsed graph. */
export type WfOverlay = Record<string, WfStatus>;

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/**
 * The closed set of things a gesture can ask for. Deliberately small: every
 * authorable adapter must implement all of them, and MAY REFUSE any of them.
 * Refusal is how a dialect's contract is expressed — xpio refuses `connect`
 * because steps[] is linear and skills_invoked[] is unordered, so there is no
 * edge for the user to draw.
 */
export type WfEdit =
	| { t: "setParam"; node: string; key: (string | number)[]; value: unknown }
	| { t: "unsetParam"; node: string; key: (string | number)[] }
	| { t: "addNode"; id: string; kind: WfNodeKind; after?: string }
	| { t: "removeNode"; id: string }
	| { t: "renameNode"; id: string; to: string }
	| { t: "connect"; source: string; sourcePort?: string; target: string }
	| { t: "disconnect"; edge: string }
	| { t: "reorder"; id: string; index: number };

export interface WfEditRefusal {
	ok: false;
	reason: string;
}
export type WfEditResult = { ok: true } | WfEditRefusal;

/** What a dialect lets the UI do. Drives palette, handles, context menus. */
export interface WfCapabilities {
	addNode: boolean;
	removeNode: boolean;
	/** Can the user draw a new edge? False for xpio — see WfRel.declared. */
	rewire: boolean;
	reorder: boolean;
	renameNode: boolean;
	/** "authored" = the document carries x/y; "derived" = we lay it out. */
	positions: "authored" | "derived";
	/** Node kinds offered in the add palette. */
	palette: string[];
}

export const NO_CAPABILITIES: WfCapabilities = {
	addNode: false,
	removeNode: false,
	rewire: false,
	reorder: false,
	renameNode: false,
	positions: "derived",
	palette: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const dataPort = (id = "in"): WfPort => ({ id, kind: "data" });
export const outPort = (id = "out"): WfPort => ({ id, kind: "data" });

/** Stable edge id. Used for dedupe, so it must be a pure function of the ends. */
export function edgeId(source: string, target: string, port?: string): string {
	return port ? `${source}:${port}->${target}` : `${source}->${target}`;
}

export function emptyGraph(format: WfAnyFormat, name = ""): WorkflowGraph {
	return {
		format,
		name,
		nodes: [],
		edges: [],
		direction: "LR",
		layout: "dagre",
		meta: {},
		diagnostics: [],
	};
}

/**
 * Apply a run overlay to a parsed graph, returning a NEW graph.
 *
 * Edge status is derived, not stored: an edge is `running` when its target is
 * running (which is what the animation should point at — the place the run
 * actually is, not the whole graph), and `succeeded` only when BOTH ends
 * succeeded, which is what lets the renderer trace the executed path.
 */
export function applyOverlay(g: WorkflowGraph, overlay?: WfOverlay): WorkflowGraph {
	if (!overlay) return g;
	const nodes = g.nodes.map((n) => {
		const status = overlay[n.id];
		return status ? { ...n, status } : n;
	});
	const edges = g.edges.map((e) => {
		const s = overlay[e.source];
		const t = overlay[e.target];
		if (t === "running") return { ...e, status: "running" as WfStatus };
		if (s === "succeeded" && t === "succeeded") return { ...e, status: "succeeded" as WfStatus };
		if (t === "failed") return { ...e, status: "failed" as WfStatus };
		return e;
	});
	return { ...g, nodes, edges };
}

export function findNode(g: WorkflowGraph, id: string): WfNode | undefined {
	return g.nodes.find((n) => n.id === id);
}

/** Node ids with no incoming `data` edge — the graph's entry points. */
export function rootNodes(g: WorkflowGraph): string[] {
	const withIncoming = new Set(g.edges.filter((e) => e.rel === "data").map((e) => e.target));
	return g.nodes.filter((n) => !withIncoming.has(n.id)).map((n) => n.id);
}
