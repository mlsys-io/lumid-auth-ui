// steplog.ts — a run's step_log.json, projected as a graph.
//
// The runtime emits step_log.json as a JSON array:
//   {"id": "observe", "ok": true,  "duration_s": 0.7, "skill": "email/observe"}
//   {"id": "act",     "ok": false, "duration_s": 1.2, "error": "Quota exceeded"}
//
// This is a RUN, not a document: there is nothing to edit and no file to patch,
// so every node's `path` is empty and the capabilities are all off. It is the
// clearest case for why status lives on the node rather than in params — here
// the status IS the content.
//
// Replaces the bespoke graph-building that used to live in RunDagCanvas, which
// had its own status palette (emerald and amber, both commented "gold-500").

import { emptyGraph, type WfEdge, type WfNode, type WfStatus, type WorkflowGraph } from "../model";

export interface StepLogEntry {
	id?: string;
	name?: string;
	skill?: string;
	ok?: boolean;
	skipped?: boolean;
	duration_s?: number;
	error?: string;
	stage?: string;
	// The runtime writes whatever the step produced — stdout, stderr, per-skill
	// fields. Narrowing this to the keys we happen to read would make the type a
	// claim about the runtime that the runtime never agreed to, and would reject
	// the richer shapes callers already hold.
	[k: string]: unknown;
}

function statusOf(s: StepLogEntry): WfStatus {
	if (s.skipped) return "skipped";
	if (s.ok === true) return "succeeded";
	if (s.ok === false) return "failed";
	return "pending";
}

/**
 * Left-to-right linear flow: the log is emitted in execution order, so the
 * order IS the edge set. A Pattern B run whose entries carry `dependsOn` would
 * warrant a real DAG here; nothing emits that today, and inventing edges the
 * log does not record would be asserting a shape we cannot see.
 */
export function projectStepLog(steps: StepLogEntry[]): WorkflowGraph {
	const g = emptyGraph("xpio", "run");
	g.direction = "LR";
	g.layout = "dagre";

	const nodes: WfNode[] = [];
	const edges: WfEdge[] = [];

	steps.forEach((s, i) => {
		const id = `step-${i}`;
		nodes.push({
			id,
			kind: { family: "xpio-step", stage: (s.stage as never) ?? "other" },
			label: s.id || s.name || s.skill || `step ${i + 1}`,
			subtitle: s.skill && s.skill !== s.id ? s.skill : undefined,
			params: { ...s },
			path: [],
			inputs: i === 0 ? [] : [{ id: "in", kind: "control" }],
			outputs: i === steps.length - 1 ? [] : [{ id: "out", kind: "control" }],
			status: statusOf(s),
			run: { duration_s: s.duration_s, error: s.error },
		});
		if (i > 0) edges.push({ id: `e-${i - 1}`, source: `step-${i - 1}`, target: id, rel: "data" });
	});

	g.nodes = nodes;
	g.edges = edges;
	return g;
}

/** The index a node id refers to, for click-through back to the raw entry. */
export function stepIndexOf(nodeId: string): number {
	const n = Number(nodeId.replace("step-", ""));
	return Number.isFinite(n) ? n : -1;
}
