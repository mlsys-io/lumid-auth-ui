// flowmesh.edit.ts — patching a flowmesh/v1 document.
//
// The interesting operation here is PROMOTION. A single-task document has no
// `spec.graph`, so there is nowhere to put a second node; adding one has to
// restructure the document first:
//
//   spec: {taskType, resources, model, data, output}
//     ->
//   spec: {taskType, resources, model, output,      # shared config stays put
//          graph: {nodes: [{name: main, spec: {taskType, data}}]}}
//
// Only the per-node-varying keys move down. Model, resources and output stay at
// the top level as shared configuration, which is exactly how the shipped
// examples are written — a node spec that redeclared the model would not be
// wrong, but it would make every later "change the model" edit a multi-node
// operation.
//
// Promotion is ONE undoable step. It rewrites the shape of a file the user may
// have hand-written, and a silent restructure is the kind of thing that
// destroys trust in an editor permanently -- so it SHOULD be confirmed first.
//
// It is not. This comment previously asserted "the caller confirms it first"
// in the present tense; no caller does, and there is no confirm anywhere in
// src/workflow. Undo is the only thing standing behind it today. Either add
// the prompt or keep this accurate -- do not let the comment do the work.

import type { WorkflowDoc } from "../doc";
import type { WfEdit, WfEditResult, WorkflowGraph } from "../model";
import { TASK_TYPE_OF, type FlowMeshDoc } from "./flowmesh";

const refuse = (reason: string): WfEditResult => ({ ok: false, reason });

/** Keys that belong to an individual node rather than the shared config. */
const NODE_LOCAL = ["data", "taskType"] as const;

function graphNodes(doc: WorkflowDoc): Array<{ name?: string; dependsOn?: unknown }> {
	const js = doc.toJS<FlowMeshDoc>();
	return js.spec?.graph?.nodes ?? [];
}

function indexOf(doc: WorkflowDoc, name: string): number {
	return graphNodes(doc).findIndex((n) => n?.name === name);
}

function depsOf(doc: WorkflowDoc, idx: number): string[] {
	const d = graphNodes(doc)[idx]?.dependsOn;
	if (Array.isArray(d)) return d.map(String);
	return d != null ? [String(d)] : [];
}

function freshName(doc: WorkflowDoc, kind: string): string {
	const taken = new Set(graphNodes(doc).map((n) => n?.name).filter(Boolean) as string[]);
	const base = (TASK_TYPE_OF[kind] ?? "task").replace(/_/g, "-");
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) {
		const c = `${base}-${i}`;
		if (!taken.has(c)) return c;
	}
}

/**
 * Restructure a single-task document into the graph form. Returns false when
 * there is nothing to promote (already a graph, or no spec at all).
 */
export function promoteToGraph(doc: WorkflowDoc, firstName = "main"): boolean {
	const js = doc.toJS<FlowMeshDoc>();
	if (!js.spec || js.spec.graph?.nodes?.length) return false;

	const nodeSpec: Record<string, unknown> = {};
	for (const k of NODE_LOCAL) {
		if (js.spec[k] !== undefined) nodeSpec[k] = js.spec[k];
	}
	// taskType is both shared default and node-local; keep it in both places so
	// the promoted node is self-describing and the top level still routes.
	if (nodeSpec.taskType === undefined && js.spec.taskType !== undefined) {
		nodeSpec.taskType = js.spec.taskType;
	}

	return doc.mutate((d) => {
		d.setIn(["spec", "graph", "nodes"], d.createNode([{ name: firstName, spec: nodeSpec }]));
		// `data` moves; everything else that was shared stays shared.
		if (js.spec?.data !== undefined) d.deleteIn(["spec", "data"]);
	});
}

export function applyFlowMeshEdit(doc: WorkflowDoc, graph: WorkflowGraph, edit: WfEdit): WfEditResult {
	if (!doc.editable) {
		return refuse(doc.lock?.detail ?? "This document cannot be edited structurally.");
	}
	const js = doc.toJS<FlowMeshDoc>();
	const isGraph = !!js.spec?.graph?.nodes?.length;

	switch (edit.t) {
		case "setParam": {
			// A synthetic endpoint edits the spec subtree it stands for.
			if (edit.node === "__data") { doc.setIn(["spec", "data", ...edit.key], edit.value); return { ok: true }; }
			if (edit.node === "__output") { doc.setIn(["spec", "output", ...edit.key], edit.value); return { ok: true }; }
			if (!isGraph) { doc.setIn(["spec", ...edit.key], edit.value); return { ok: true }; }
			const i = indexOf(doc, edit.node);
			if (i < 0) return refuse(`No node "${edit.node}" in spec.graph.`);
			doc.setIn(["spec", "graph", "nodes", i, "spec", ...edit.key], edit.value);
			return { ok: true };
		}

		case "unsetParam": {
			if (!isGraph) { doc.deleteIn(["spec", ...edit.key]); return { ok: true }; }
			const i = indexOf(doc, edit.node);
			if (i < 0) return refuse(`No node "${edit.node}" in spec.graph.`);
			doc.deleteIn(["spec", "graph", "nodes", i, "spec", ...edit.key]);
			return { ok: true };
		}

		case "addNode": {
			if (edit.kind.family !== "flowmesh-task") {
				return refuse("Only FlowMesh task kinds can be added to a flowmesh/v1 document.");
			}
			// Adding a second node to a single-task document restructures it. One
			// step and undoable -- but NOT confirmed; see the header note.
			if (!isGraph) promoteToGraph(doc);
			const kind = edit.kind.taskType;
			const name = edit.id || freshName(doc, kind);
			if (indexOf(doc, name) >= 0) return refuse(`"${name}" is already taken.`);
			const after = edit.after && indexOf(doc, edit.after) >= 0 ? [edit.after] : undefined;
			doc.addIn(["spec", "graph", "nodes"], {
				name,
				...(after ? { dependsOn: after } : {}),
				spec: { taskType: TASK_TYPE_OF[kind] ?? "inference" },
			});
			return { ok: true };
		}

		case "removeNode": {
			if (!isGraph) return refuse("A single-task document has one task; remove it by deleting the file.");
			const i = indexOf(doc, edit.id);
			if (i < 0) return refuse(`No node "${edit.id}" in spec.graph.`);
			// Strip dependsOn references first, exactly as Lumilake does: deleting
			// the node first would leave survivors pointing at a name that is gone.
			stripDeps(doc, edit.id);
			const after = indexOf(doc, edit.id);
			doc.deleteIn(["spec", "graph", "nodes", after < 0 ? i : after]);
			return { ok: true };
		}

		case "renameNode": {
			if (!edit.to.trim()) return refuse("A name is required.");
			if (!isGraph) {
				// The single task's identity IS metadata.name.
				doc.setIn(["metadata", "name"], edit.to);
				return { ok: true };
			}
			if (indexOf(doc, edit.to) >= 0) return refuse(`"${edit.to}" is already taken.`);
			const i = indexOf(doc, edit.id);
			if (i < 0) return refuse(`No node "${edit.id}" in spec.graph.`);
			doc.setIn(["spec", "graph", "nodes", i, "name"], edit.to);
			rewriteDeps(doc, edit.id, edit.to);
			return { ok: true };
		}

		case "connect": {
			if (!isGraph) return refuse("Add a second task first — a single-task document has nothing to connect.");
			const ti = indexOf(doc, edit.target);
			if (ti < 0) return refuse(`No node "${edit.target}" in spec.graph.`);
			if (indexOf(doc, edit.source) < 0) return refuse(`No node "${edit.source}" in spec.graph.`);
			const deps = depsOf(doc, ti);
			if (deps.includes(edit.source)) return refuse("Already connected.");
			if (wouldCycle(graph, edit.source, edit.target)) {
				return refuse(`That would make a cycle: ${edit.target} already feeds ${edit.source}.`);
			}
			doc.setIn(["spec", "graph", "nodes", ti, "dependsOn"], [...deps, edit.source]);
			return { ok: true };
		}

		case "disconnect": {
			const e = graph.edges.find((x) => x.id === edit.edge);
			if (!e) return refuse("No such connection.");
			const ti = indexOf(doc, e.target);
			if (ti < 0) return refuse(`No node "${e.target}" in spec.graph.`);
			const deps = depsOf(doc, ti).filter((d) => d !== e.source);
			doc.setIn(["spec", "graph", "nodes", ti, "dependsOn"], deps);
			return { ok: true };
		}

		case "reorder": {
			if (!isGraph) return refuse("Nothing to reorder in a single-task document.");
			const i = indexOf(doc, edit.id);
			if (i < 0) return refuse(`No node "${edit.id}" in spec.graph.`);
			doc.reorderIn(["spec", "graph", "nodes"], i, edit.index);
			return { ok: true };
		}

		default:
			return refuse("Unsupported edit.");
	}
}

function stripDeps(doc: WorkflowDoc, name: string): void {
	graphNodes(doc).forEach((n, i) => {
		if (!n || n.name === name) return;
		const deps = Array.isArray(n.dependsOn) ? n.dependsOn.map(String) : n.dependsOn != null ? [String(n.dependsOn)] : [];
		const kept = deps.filter((d) => d !== name);
		if (kept.length !== deps.length) doc.setIn(["spec", "graph", "nodes", i, "dependsOn"], kept);
	});
}

function rewriteDeps(doc: WorkflowDoc, from: string, to: string): void {
	graphNodes(doc).forEach((n, i) => {
		if (!n) return;
		const deps = Array.isArray(n.dependsOn) ? n.dependsOn.map(String) : n.dependsOn != null ? [String(n.dependsOn)] : [];
		if (!deps.includes(from)) return;
		doc.setIn(["spec", "graph", "nodes", i, "dependsOn"], deps.map((d) => (d === from ? to : d)));
	});
}

function wouldCycle(graph: WorkflowGraph, source: string, target: string): boolean {
	if (source === target) return true;
	const seen = new Set<string>();
	const stack = [target];
	while (stack.length) {
		const cur = stack.pop()!;
		if (cur === source) return true;
		if (seen.has(cur)) continue;
		seen.add(cur);
		for (const e of graph.edges) if (e.source === cur) stack.push(e.target);
	}
	return false;
}
