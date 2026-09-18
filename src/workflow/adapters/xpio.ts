// xpio.ts — the xpio app-loop dialect (a `loops[]` entry in .xpcloud.yaml).
//
// Two honest shapes, and the difference between them is a CONTRACT, not a
// rendering preference:
//
//   Pattern A (runner-driven):  trigger -> step -> step -> … -> knowledge
//     steps[] is ORDERED, so the edge set is fully determined by index and
//     carries no information of its own.
//
//   Pattern B (command-driven): trigger -> engine =declared=> skill
//     the engine is the real execution unit; skills_invoked[] hangs off
//     DASHED edges because the contract enforces NO ordering for them. Drawing
//     those as a pipeline would assert a sequence that does not exist.
//
// That is why WfCapabilities.rewire is FALSE here. There is no edge for a user
// to draw in either pattern: in A the order is the array, in B there is no
// order at all. Offering a connect handle would be offering scissors the
// contract forbids.
//
// Lifted from components/workflow/WorkflowCanvas.tsx, with one bug fixed —
// see stageOf below.

import { LOOP_STAGES, type LoopStageKey } from "@/components/workflow/LoopOrbit";
import type { LoopDefinition, MeCycleDetail, MeCycleStep } from "@/api/me";
import { describeSchedule } from "@/lib/schedule";
import {
	emptyGraph,
	type WfBadge, type WfCapabilities, type WfEdge, type WfNode,
	type WfStatus, type WorkflowGraph,
} from "../model";

/**
 * Editing is per-step; the topology is the array order, so `rewire` is off and
 * `reorder` carries the real intent. `addNode`/`removeNode` edit steps[].
 */
export const XPIO_CAPABILITIES: WfCapabilities = {
	addNode: true,
	removeNode: true,
	rewire: false,
	reorder: true,
	renameNode: true,
	positions: "derived",
	palette: ["step"],
};

/**
 * Read-only: what you get when the caller has a parsed LoopDefinition object
 * rather than the document text. me.workflowDetail returns exactly that, so
 * there is no document to patch and nothing can be edited — say so honestly
 * instead of offering controls that would silently do nothing.
 */
export const XPIO_READONLY_CAPABILITIES: WfCapabilities = {
	addNode: false, removeNode: false, rewire: false, reorder: false,
	renameNode: false, positions: "derived", palette: [],
};

/**
 * Map a step id to its canonical stage. Cycle truth wins; otherwise match
 * canonical names; otherwise spread linearly, since id order IS the contract's
 * execution order for Pattern A.
 *
 * `idx`/`total` must be the STEP index and step count. The old caller in
 * WorkflowCanvas passed `nodes.indexOf(n)` and `nodes.length` when painting the
 * stage bands — indices into an array that also held the trigger node and any
 * already-unshifted band nodes — so for custom step names that fall through to
 * the positional heuristic, the band and the node's own stage label could
 * disagree. Here the stage is computed ONCE per step and stored on the node, so
 * there is no second caller to get it wrong (and no O(n²) indexOf).
 */
export function stageOf(stepID: string, idx: number, total: number, cycleStage?: string): LoopStageKey | "other" {
	if (cycleStage && LOOP_STAGES.some((s) => s.key === cycleStage)) return cycleStage as LoopStageKey;
	const id = stepID.toLowerCase();
	for (const s of LOOP_STAGES) {
		if (id === s.key || id.startsWith(s.key) || id.includes(s.key)) return s.key;
	}
	const slot = Math.min(LOOP_STAGES.length - 1, Math.floor((idx / Math.max(1, total)) * LOOP_STAGES.length));
	return LOOP_STAGES[slot].key;
}

function statusOf(cs: MeCycleStep | undefined, declared: boolean, running: boolean): WfStatus {
	if (running && !cs) return declared ? "declared" : "running";
	if (declared && !cs) return "declared";
	if (!cs) return "pending";
	if (cs.ok === false) return "failed";
	return "succeeded";
}

/** The step's stable id, matching the runner's step_id. */
function stepKey(st: { id?: string; skill?: string }, i: number): string {
	return st.id || st.skill || `step-${i + 1}`;
}

export interface ProjectXpioOpts {
	cycle?: MeCycleDetail | null;
	running?: boolean;
	/** Omit the stage bands (showcase thumbnails do). */
	bands?: boolean;
}

/**
 * Project one loop definition into the graph model.
 *
 * Both patterns share the trigger head and the optional knowledge sink; they
 * differ in the middle and in `layout`, which tells the renderer whether to
 * stack a column with stage bands or fan out beneath an engine.
 */
export function projectXpio(def: LoopDefinition, opts: ProjectXpioOpts = {}): WorkflowGraph {
	const { cycle, running = false, bands = true } = opts;
	const g = emptyGraph("xpio", def.name || "");
	g.direction = "TB";

	const cycleByStep = new Map<string, MeCycleStep>();
	for (const s of cycle?.steps || []) cycleByStep.set(s.step_id, s);

	const nodes: WfNode[] = [];
	const edges: WfEdge[] = [];

	const schedule = def.schedule || "";
	const manual = schedule === "@trigger" || schedule === "" || schedule === "manual";
	nodes.push({
		id: "trigger",
		kind: { family: "io", role: "trigger" },
		label: manual ? "Manual trigger" : describeSchedule(schedule),
		subtitle: "trigger",
		params: { schedule },
		path: ["schedule"],
		inputs: [],
		outputs: [{ id: "out", kind: "control" }],
		status: running ? "running" : "succeeded",
	});

	const steps = def.steps || [];
	const patternA = steps.length > 0;

	if (patternA) {
		g.layout = bands ? "column-bands" : "column";
		steps.forEach((st, i) => {
			const id = stepKey(st, i);
			const cs = cycleByStep.get(id);
			const stage = stageOf(id, i, steps.length, cs?.stage);
			const badges: WfBadge[] = [];
			if (st.experiment) badges.push({ kind: "experiment", label: String(st.experiment), title: "runs an experiment" });
			if (st.knowledge_agent) badges.push({ kind: "knowledge", label: String(st.knowledge_agent), title: "writes to a knowledge bank" });
			nodes.push({
				id: `step:${id}`,
				kind: { family: "xpio-step", stage },
				label: id,
				subtitle: st.skill || "",
				params: { ...st },
				path: ["steps", i],
				inputs: [{ id: "in", kind: "control" }],
				outputs: [{ id: "out", kind: "control" }],
				group: stage,
				status: statusOf(cs, false, running),
				run: cs ? { duration_s: cs.duration_s, summary: cs.output_summary, error: cs.error } : undefined,
				badges: badges.length ? badges : undefined,
			});
			edges.push({
				id: `e:${i}`,
				source: i === 0 ? "trigger" : `step:${stepKey(steps[i - 1], i - 1)}`,
				target: `step:${id}`,
				rel: "data",
			});
		});
	} else {
		g.layout = "column";
		const engineLabel = def.engine?.module || def.engine?.type || "engine";
		// A cycle with recorded step errors, or an explicit ok:false, failed.
		const summary = cycle?.summary as { step_errors?: unknown[]; ok?: boolean } | undefined;
		const engineStatus: WfStatus = running
			? "running"
			: cycle
				? (summary?.step_errors?.length || summary?.ok === false ? "failed" : "succeeded")
				: "pending";
		const badges: WfBadge[] = [];
		if (def.engine?.experiment) badges.push({ kind: "experiment", label: def.engine.experiment, title: "runs an experiment" });
		nodes.push({
			id: "engine",
			kind: { family: "xpio-engine" },
			label: `command: ${engineLabel}`,
			subtitle: def.engine?.experiment ? `experiment: ${def.engine.experiment}` : "Pattern B engine",
			params: { ...(def.engine || {}) },
			path: ["engine"],
			inputs: [{ id: "in", kind: "control" }],
			outputs: [{ id: "out", kind: "control" }],
			status: engineStatus,
			badges: badges.length ? badges : undefined,
		});
		edges.push({ id: "e:t", source: "trigger", target: "engine", rel: "data" });

		(def.skills_invoked || []).forEach((sk, i) => {
			const cs = cycleByStep.get(sk);
			nodes.push({
				id: `skill:${sk}`,
				kind: { family: "xpio-step", stage: "other" },
				label: sk,
				subtitle: cs ? "" : "declared",
				params: { skill: sk },
				path: ["skills_invoked", i],
				inputs: [{ id: "in", kind: "control" }],
				outputs: [],
				status: statusOf(cs, true, running),
				run: cs ? { duration_s: cs.duration_s, summary: cs.output_summary, error: cs.error } : undefined,
			});
			edges.push({
				id: `e:s${i}`,
				source: "engine",
				target: `skill:${sk}`,
				// Dashed, unordered, labelled "declared" — see the file header.
				rel: cs ? "data" : "declared",
				label: cs ? undefined : "declared",
			});
		});
	}

	if (def.knowledge_agent) {
		nodes.push({
			id: "knowledge",
			kind: { family: "io", role: "sink" },
			label: def.knowledge_agent,
			subtitle: "knowledge bank",
			params: { knowledge_agent: def.knowledge_agent },
			path: ["knowledge_agent"],
			inputs: [{ id: "in", kind: "data" }],
			outputs: [],
			group: "learn",
			status: "succeeded",
		});
		const last = patternA ? `step:${stepKey(steps[steps.length - 1], steps.length - 1)}` : "engine";
		edges.push({ id: "e:knowledge", source: last, target: "knowledge", rel: "data" });
	}

	g.nodes = nodes;
	g.edges = edges;
	g.meta = {
		schedule: def.schedule,
		mode: def.mode,
		description: def.description,
		goal: def.goal,
		datasets: def.datasets,
		pattern: patternA ? "A" : "B",
	};
	return g;
}

/** True when a loop declares nothing renderable — the caller should render nothing. */
export function isEmptyLoop(def: LoopDefinition): boolean {
	return !def.steps?.length
		&& !def.skills_invoked?.length
		&& !def.engine?.type
		&& !def.engine?.module;
}
