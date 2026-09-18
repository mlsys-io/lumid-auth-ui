// lumilake.edit.ts — turning a gesture into a patch on the document.
//
// Lumilake is the dialect where editing is genuinely cheap, because AN EDGE IS
// AN ARRAY ENTRY. There is no edges list to keep in sync: `connect` pushes an
// id into the target op's `inputs`, `disconnect` splices it out, and the graph
// re-derives itself on the next projection. That is why this is the first
// dialect to get an editor.
//
// Two operations need care, and both for the same reason — an op id is a
// REFERENCE, not just a label:
//
//   renameNode must rewrite every `inputs` entry and every `outputs[].ref`
//   that pointed at the old id, or the rename silently disconnects the graph.
//
//   removeNode must strip the departing id out of every other op's `inputs`
//   first, and only then delete the op — otherwise the survivors are left
//   holding dangling references that render as errors the user did not make.
//
// Everything here goes through WorkflowDoc, so every write is snapshotted for
// undo and refused outright on a document locked by anchors.

import type { WorkflowDoc } from "../doc";
import type { WfEdit, WfEditResult, WorkflowGraph } from "../model";
import { seedParams } from "../registry/lumilake";

interface OpLike {
	id?: string;
	op?: string;
	inputs?: unknown;
	[k: string]: unknown;
}
interface DocShape {
	inputs?: Record<string, unknown>;
	outputs?: Array<{ name?: string; ref?: string }>;
	ops?: OpLike[];
}

const refuse = (reason: string): WfEditResult => ({ ok: false, reason });

/** Index of an op in `ops`, or -1. Read from the document, never the graph. */
function indexOf(doc: WorkflowDoc, id: string): number {
	const js = doc.toJS<DocShape>();
	return (js.ops ?? []).findIndex((o) => o?.id === id);
}

function inputsOf(doc: WorkflowDoc, idx: number): string[] {
	const js = doc.toJS<DocShape>();
	const raw = js.ops?.[idx]?.inputs;
	if (Array.isArray(raw)) return raw.map(String);
	return raw != null ? [String(raw)] : [];
}

/** A fresh op id that does not collide, e.g. LLMChatOp -> llm_chat_2. */
function freshId(doc: WorkflowDoc, op: string): string {
	const js = doc.toJS<DocShape>();
	const taken = new Set([
		...(js.ops ?? []).map((o) => o?.id).filter(Boolean) as string[],
		...Object.keys(js.inputs ?? {}),
	]);
	const base = op.replace(/Op$/, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase() || "op";
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) {
		const candidate = `${base}_${i}`;
		if (!taken.has(candidate)) return candidate;
	}
}

export function applyLumilakeEdit(doc: WorkflowDoc, graph: WorkflowGraph, edit: WfEdit): WfEditResult {
	if (!doc.editable) {
		return refuse(doc.lock?.detail ?? "This document cannot be edited structurally.");
	}

	switch (edit.t) {
		case "setParam": {
			// A top-level declared input is a real document entry too, and its
			// "param" is the value list itself.
			if (edit.node.startsWith("input:")) {
				const name = edit.node.slice("input:".length);
				doc.setIn(["inputs", name, ...edit.key], edit.value);
				return { ok: true };
			}
			const idx = indexOf(doc, edit.node);
			if (idx < 0) return refuse(`No op "${edit.node}" in this document.`);
			doc.setIn(["ops", idx, ...edit.key], edit.value);
			return { ok: true };
		}

		case "unsetParam": {
			const idx = indexOf(doc, edit.node);
			if (idx < 0) return refuse(`No op "${edit.node}" in this document.`);
			doc.deleteIn(["ops", idx, ...edit.key]);
			return { ok: true };
		}

		case "addNode": {
			if (edit.kind.family !== "lumilake-op") {
				return refuse("Only Lumilake ops can be added to a Lumilake workflow.");
			}
			const op = edit.kind.op;
			const id = edit.id || freshId(doc, op);
			if (indexOf(doc, id) >= 0) return refuse(`"${id}" is already taken.`);
			// A node dropped after another wires itself up immediately: an op with
			// no inputs is a second root, which is almost never what was meant.
			const inputs = edit.after ? [edit.after] : [];
			doc.addIn(["ops"], { id, op, ...(inputs.length ? { inputs } : {}), ...seedParams(op) });
			return { ok: true };
		}

		case "removeNode": {
			if (edit.id.startsWith("input:")) {
				const name = edit.id.slice("input:".length);
				stripReferences(doc, name);
				doc.deleteIn(["inputs", name]);
				return { ok: true };
			}
			const idx = indexOf(doc, edit.id);
			if (idx < 0) return refuse(`No op "${edit.id}" in this document.`);
			// Strip references FIRST: deleting the op first would leave the
			// survivors holding dangling refs, which then render as errors the
			// user never made.
			stripReferences(doc, edit.id);
			const after = indexOf(doc, edit.id); // indices may have shifted
			doc.deleteIn(["ops", after < 0 ? idx : after]);
			return { ok: true };
		}

		case "renameNode": {
			if (!edit.to.trim()) return refuse("A name is required.");
			if (indexOf(doc, edit.to) >= 0) return refuse(`"${edit.to}" is already taken.`);
			const idx = indexOf(doc, edit.id);
			if (idx < 0) return refuse(`No op "${edit.id}" in this document.`);
			doc.setIn(["ops", idx, "id"], edit.to);
			rewriteReferences(doc, edit.id, edit.to);
			return { ok: true };
		}

		case "connect": {
			const tgt = indexOf(doc, edit.target);
			if (tgt < 0) return refuse(`No op "${edit.target}" in this document.`);
			const srcName = edit.source.startsWith("input:") ? edit.source.slice("input:".length) : edit.source;
			const current = inputsOf(doc, tgt);
			if (current.includes(srcName)) return refuse("Already connected.");
			// Refuse a cycle rather than write one: Lumilake's scheduler would
			// reject it much later with a message that names neither op.
			if (wouldCycle(graph, edit.source, edit.target)) {
				return refuse(`That would make a cycle: ${edit.target} already feeds ${edit.source}.`);
			}
			doc.setIn(["ops", tgt, "inputs"], [...current, srcName]);
			return { ok: true };
		}

		case "disconnect": {
			const e = graph.edges.find((x) => x.id === edit.edge);
			if (!e) return refuse("No such connection.");
			const tgt = indexOf(doc, e.target);
			if (tgt < 0) return refuse(`No op "${e.target}" in this document.`);
			const srcName = e.source.startsWith("input:") ? e.source.slice("input:".length) : e.source;
			const current = inputsOf(doc, tgt);
			// Remove ONE occurrence, at the recorded index where we have it: an op
			// may legitimately take the same upstream twice, and dropping both
			// would change what the function receives.
			const at = e.sourcePort !== undefined ? Number(e.sourcePort) : current.indexOf(srcName);
			if (at < 0 || current[at] !== srcName) return refuse("That connection is no longer there.");
			doc.setIn(["ops", tgt, "inputs"], current.filter((_, i) => i !== at));
			return { ok: true };
		}

		case "reorder": {
			const idx = indexOf(doc, edit.id);
			if (idx < 0) return refuse(`No op "${edit.id}" in this document.`);
			doc.reorderIn(["ops"], idx, edit.index);
			return { ok: true };
		}

		default:
			return refuse("Unsupported edit.");
	}
}

/** Drop every reference to `id` from every op's inputs and from outputs[]. */
function stripReferences(doc: WorkflowDoc, id: string): void {
	const js = doc.toJS<DocShape>();
	(js.ops ?? []).forEach((o, i) => {
		if (!o || o.id === id) return;
		const ins = Array.isArray(o.inputs) ? o.inputs.map(String) : o.inputs != null ? [String(o.inputs)] : [];
		const kept = ins.filter((x) => x !== id);
		if (kept.length !== ins.length) doc.setIn(["ops", i, "inputs"], kept);
	});
	(js.outputs ?? []).forEach((out, i) => {
		if (out?.ref === id) doc.deleteIn(["outputs", i]);
	});
}

/** Point every reference to `from` at `to` instead. */
function rewriteReferences(doc: WorkflowDoc, from: string, to: string): void {
	const js = doc.toJS<DocShape>();
	(js.ops ?? []).forEach((o, i) => {
		if (!o) return;
		const ins = Array.isArray(o.inputs) ? o.inputs.map(String) : o.inputs != null ? [String(o.inputs)] : [];
		if (!ins.includes(from)) return;
		doc.setIn(["ops", i, "inputs"], ins.map((x) => (x === from ? to : x)));
	});
	(js.outputs ?? []).forEach((out, i) => {
		if (out?.ref === from) doc.setIn(["outputs", i, "ref"], to);
	});
}

/**
 * Would connecting source -> target close a loop? Walks the existing graph
 * forward from `target` looking for `source`.
 */
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
