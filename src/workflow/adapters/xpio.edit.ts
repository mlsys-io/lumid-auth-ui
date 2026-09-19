// xpio.edit.ts — patching one loop inside a `.xpcloud.yaml`.
//
// This adapter REFUSES MORE THAN IT ALLOWS, and that is the point.
//
// Pattern A's `steps[]` is ordered, so the order IS the edge set — there is no
// edge to draw, only a list to rearrange. Pattern B's `skills_invoked[]` is
// explicitly unordered by contract, so there is no edge to draw there either.
// Offering a connect handle in a dialect with no drawable edge would be
// offering scissors the contract forbids: the user would wire something up,
// the document would not change, and they would rightly stop trusting the tool.
// So `connect`/`disconnect` return a refusal that says why, and the canvas
// never shows the handles in the first place (capabilities.rewire === false).
//
// Everything is rooted at a path prefix, because a manifest holds MANY loops
// and an edit written to `steps[0]` instead of `loops[1].steps[0]` would
// silently rewrite a different one.
//
// The write path that does NOT exist yet: `me.workflowDetail` returns a parsed
// LoopDefinition with no text behind it, so loops loaded that way are read-only
// and say so. Editing them from the UI needs a backend GET/PUT for the raw
// file. That is honest scope, not an oversight.

import type { WorkflowDoc } from "../doc";
import type { LoopDefinition } from "@/api/me";
import type { WfEdit, WfEditResult, WorkflowGraph } from "../model";
import { locateLoop, type XpioManifest } from "./xpio";

const refuse = (reason: string): WfEditResult => ({ ok: false, reason });

/** The document path of the loop currently being edited. */
function prefixOf(doc: WorkflowDoc, which?: string | number): (string | number)[] {
	return locateLoop(doc.toJS<XpioManifest>(), which).prefix;
}

function loopOf(doc: WorkflowDoc, which?: string | number): LoopDefinition {
	return locateLoop(doc.toJS<XpioManifest>(), which).loop;
}

/** `step:foo` / `skill:foo` -> `foo`. */
function bare(id: string): string {
	return id.replace(/^(step|skill):/, "");
}

function stepIndex(loop: LoopDefinition, id: string): number {
	return (loop.steps ?? []).findIndex((st, i) => (st.id || st.skill || `step-${i + 1}`) === id);
}

export function applyXpioEdit(
	doc: WorkflowDoc,
	graph: WorkflowGraph,
	edit: WfEdit,
	which?: string | number,
): WfEditResult {
	if (!doc.editable) {
		return refuse(doc.lock?.detail ?? "This document cannot be edited structurally.");
	}
	const prefix = prefixOf(doc, which);
	const loop = loopOf(doc, which);
	const at = (...rest: (string | number)[]) => [...prefix, ...rest];

	// An anchored value is shared with somewhere else in the file. Check before
	// writing and report the reason, rather than letting the write quietly fail.
	const guard = (path: (string | number)[]): WfEditResult | null => {
		const risk = doc.aliasRiskAt(path);
		return risk ? refuse(risk) : null;
	};

	switch (edit.t) {
		case "connect":
		case "disconnect":
			// The contract, not a limitation of this code.
			return refuse(
				(loop.steps?.length ?? 0) > 0
					? "A loop's steps run in the order they are written, so there are no connections to draw — drag a step to reorder it instead."
					: "skills_invoked[] is explicitly unordered, so an arrow between two skills would assert a sequence the runner does not honour.",
			);

		case "setParam": {
			const id = bare(edit.node);
			if (edit.node === "trigger") {
				const path = at("schedule");
				return guard(path) ?? (doc.setIn(path, edit.value), { ok: true });
			}
			if (edit.node === "engine") {
				const path = at("engine", ...edit.key);
				return guard(path) ?? (doc.setIn(path, edit.value), { ok: true });
			}
			if (edit.node === "knowledge") {
				const path = at("knowledge_agent");
				return guard(path) ?? (doc.setIn(path, edit.value), { ok: true });
			}
			if (edit.node.startsWith("skill:")) {
				const i = (loop.skills_invoked ?? []).indexOf(id);
				if (i < 0) return refuse(`"${id}" is not in skills_invoked.`);
				const path = at("skills_invoked", i);
				return guard(path) ?? (doc.setIn(path, edit.value), { ok: true });
			}
			const i = stepIndex(loop, id);
			if (i < 0) return refuse(`No step "${id}" in this loop.`);
			const path = at("steps", i, ...edit.key);
			return guard(path) ?? (doc.setIn(path, edit.value), { ok: true });
		}

		case "unsetParam": {
			const i = stepIndex(loop, bare(edit.node));
			if (i < 0) return refuse(`No step "${bare(edit.node)}" in this loop.`);
			const path = at("steps", i, ...edit.key);
			return guard(path) ?? (doc.deleteIn(path), { ok: true });
		}

		case "addNode": {
			if (edit.kind.family !== "xpio-step") {
				return refuse("A loop's stages are steps; other node kinds belong to other dialects.");
			}
			if (!loop.steps) {
				// Pattern B has an engine, not a step list. Adding a step would
				// quietly convert the loop to Pattern A and change how it runs.
				return refuse("This is a command-driven loop. Add a step by switching it to steps[] in the YAML first — converting it here would change how the loop runs.");
			}
			const taken = new Set((loop.steps ?? []).map((st, i) => st.id || st.skill || `step-${i + 1}`));
			let id = edit.id || "step";
			if (taken.has(id)) {
				for (let n = 2; taken.has(`${id}_${n}`); n++) id = `step_${n}`;
				if (taken.has(id)) id = `${id}_${taken.size + 1}`;
			}
			const path = at("steps");
			const g = guard(path);
			if (g) return g;
			const afterIdx = edit.after ? stepIndex(loop, bare(edit.after)) : -1;
			doc.addIn(path, { id, stage: "observe", required: true });
			// addIn appends; move it into place when it was dropped mid-list.
			if (afterIdx >= 0 && afterIdx < (loop.steps?.length ?? 0) - 1) {
				doc.reorderIn(path, (loop.steps?.length ?? 1), afterIdx + 1);
			}
			return { ok: true };
		}

		case "removeNode": {
			const id = bare(edit.id);
			if (edit.id.startsWith("skill:")) {
				const i = (loop.skills_invoked ?? []).indexOf(id);
				if (i < 0) return refuse(`"${id}" is not in skills_invoked.`);
				const path = at("skills_invoked");
				return guard(path) ?? (doc.deleteIn(at("skills_invoked", i)), { ok: true });
			}
			const i = stepIndex(loop, id);
			if (i < 0) return refuse(`No step "${id}" in this loop.`);
			const path = at("steps");
			return guard(path) ?? (doc.deleteIn(at("steps", i)), { ok: true });
		}

		case "renameNode": {
			if (!edit.to.trim()) return refuse("A name is required.");
			const id = bare(edit.id);
			const i = stepIndex(loop, id);
			if (i < 0) return refuse(`No step "${id}" in this loop.`);
			if (stepIndex(loop, edit.to) >= 0) return refuse(`"${edit.to}" is already taken.`);
			const path = at("steps", i, "id");
			return guard(path) ?? (doc.setIn(path, edit.to), { ok: true });
		}

		case "reorder": {
			// The ONE topology edit this dialect has, because the order of
			// steps[] is the execution order.
			const id = bare(edit.id);
			const i = stepIndex(loop, id);
			if (i < 0) return refuse(`No step "${id}" in this loop.`);
			const path = at("steps");
			return guard(path) ?? (doc.reorderIn(path, i, edit.index), { ok: true });
		}

		default:
			return refuse("Unsupported edit.");
	}
}
