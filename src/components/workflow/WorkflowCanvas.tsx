// WorkflowCanvas — n8n-style node view of one workflow (loop).
//
// Structure comes from the loop's verbatim xpcloud.yaml declaration
// (me.workflowDetail → LoopDefinition); the live overlay comes from a
// selected run's cycle detail. Two honest shapes:
//
//   Pattern A (runner-driven):  trigger → step → step → … → knowledge
//     each step node = one skill call, colored by its five-stage band
//     (observe → hypothesize → act → analyze → learn).
//
//   Pattern B (command-driven): trigger → engine ─┬─(declared)─ skill
//     the engine node is the real execution unit;  ├─(declared)─ skill
//     skills_invoked[] hang off DASHED edges        └─(declared)─ skill
//     because the contract enforces no ordering for them.
//
// n8n ideas borrowed: typed nodes, per-node status badge on each
// execution, click-node → data panel (StepInspectorPanel), execution
// replay (the panel's ?cycle=<ts> selection drives this overlay).
//
// modes: "observe" (interactive, controls, click-to-inspect) and
// "showcase" (static, compact — marketplace cards + app surfaces).

import { useMemo } from "react";
import { ReactFlow, Background, Controls, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LoopDefinition, MeCycleDetail, MeCycleStep } from "@/api/me";
import { LOOP_STAGES, type LoopStageKey } from "@/components/workflow/LoopOrbit";
import { describeSchedule } from "@/lib/schedule";

// State colors — shared with RunDagCanvas's palette.
// Success/ok = brand GOLD (the whole site uses gold for healthy/ok, not green
// — run dots, sparklines, status pills all do). Failed stays rose, running
// stays sky (a transient state, matches the runs list).
const STATE_BG: Record<string, string> = {
	succeeded: "rgb(176 143 69)",  // gold-500
	failed:    "rgb(225 29 72)",
	running:   "rgb(14 165 233)",
	declared:  "rgb(148 163 184)",
	pending:   "rgb(203 213 225)",
};
const STATE_BORDER: Record<string, string> = {
	succeeded: "rgb(150 119 58)",  // gold-600
	failed:    "rgb(190 18 60)",
	running:   "rgb(2 132 199)",
	declared:  "rgb(148 163 184)",
	pending:   "rgb(203 213 225)",
};

// Stage band tints (canvas backgrounds are subtle washes).
const STAGE_TINT: Record<string, string> = {
	observe:     "rgba(56, 189, 248, 0.07)",   // sky
	hypothesize: "rgba(167, 139, 250, 0.08)",  // violet
	act:         "rgba(251, 191, 36, 0.09)",   // amber
	analyze:     "rgba(45, 212, 191, 0.08)",   // teal
	learn:       "rgba(176, 143, 69, 0.10)",   // gold (banked outcome = on-brand)
};
const STAGE_LABEL_COLOR: Record<string, string> = {
	observe: "rgb(2 132 199)", hypothesize: "rgb(124 58 237)", act: "rgb(180 83 9)",
	analyze: "rgb(13 148 136)", learn: "rgb(123 98 48)",
};

export interface CanvasStepRef {
	step_id: string;
	skill?: string;
	declared?: boolean; // Pattern B skills_invoked — no live status
	cycleStep?: MeCycleStep; // overlay from the selected run
}

interface Props {
	definition: LoopDefinition;
	cycle?: MeCycleDetail | null;
	running?: boolean;
	mode?: "observe" | "showcase";
	onStepSelect?: (ref: CanvasStepRef) => void;
}

// Map a step id to its canonical stage. Cycle truth wins; otherwise
// match canonical names; otherwise spread linearly (id order is the
// contract's execution order for Pattern A).
function stageOf(stepID: string, idx: number, total: number, cycleStage?: string): LoopStageKey | "other" {
	if (cycleStage && LOOP_STAGES.some((s) => s.key === cycleStage)) return cycleStage as LoopStageKey;
	const id = stepID.toLowerCase();
	for (const s of LOOP_STAGES) {
		if (id === s.key || id.startsWith(s.key) || id.includes(s.key)) return s.key;
	}
	// Heuristic position mapping keeps the band painting sensible for
	// custom step names without lying about the name itself.
	const slot = Math.min(LOOP_STAGES.length - 1, Math.floor((idx / Math.max(1, total)) * LOOP_STAGES.length));
	return LOOP_STAGES[slot].key;
}

const NODE_W = 190;
const GAP_X = 70;

export default function WorkflowCanvas({ definition, cycle, running = false, mode = "observe", onStepSelect }: Props) {
	const showcase = mode === "showcase";

	const { nodes, edges } = useMemo(() => {
		const nodes: Node[] = [];
		const edges: Edge[] = [];
		const cycleByStep = new Map<string, MeCycleStep>();
		for (const s of cycle?.steps || []) cycleByStep.set(s.step_id, s);

		const stateOf = (cs?: MeCycleStep, declared = false): string => {
			if (declared && !cs) return "declared";
			if (!cs) return "pending";
			if (cs.ok === false) return "failed";
			return "succeeded";
		};

		let x = 0;
		const Y = 70;

		// Trigger node — cron or @trigger.
		const schedule = definition.schedule || "";
		nodes.push({
			id: "trigger",
			position: { x, y: Y },
			data: {
				label: (
					<NodeLabel
						title={schedule === "@trigger" || schedule === "" || schedule === "manual" ? "Manual trigger" : describeSchedule(schedule)}
						subtitle="trigger"
						state={running ? "running" : "succeeded"}
					/>
				),
			},
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
			style: nodeStyle("trigger", running ? "running" : "pending"),
		});
		x += NODE_W + GAP_X;

		const patternA = (definition.steps?.length || 0) > 0;

		if (patternA) {
			const steps = definition.steps!;
			steps.forEach((st, i) => {
				const id = st.id || st.skill || `step-${i + 1}`;
				const cs = cycleByStep.get(id);
				const state = running && !cs ? "running" : stateOf(cs);
				const stage = stageOf(id, i, steps.length, cs?.stage);
				nodes.push({
					id: `step:${id}`,
					position: { x, y: Y },
					data: {
						label: (
							<NodeLabel
								title={id}
								subtitle={st.skill || ""}
								state={state}
								duration={cs?.duration_s}
								badges={{ experiment: !!st.experiment, knowledge: !!st.knowledge_agent }}
								stage={stage}
							/>
						),
					},
					sourcePosition: Position.Right,
					targetPosition: Position.Left,
					style: nodeStyle(state, state),
				});
				edges.push({
					id: `e:${i}`,
					source: i === 0 ? "trigger" : `step:${steps[i - 1].id || steps[i - 1].skill || `step-${i}`}`,
					target: `step:${id}`,
					animated: running,
					style: { stroke: "rgb(148 163 184)" },
				});
				x += NODE_W + GAP_X;
			});
			// Knowledge sink off the learn end.
			if (definition.knowledge_agent) {
				nodes.push({
					id: "knowledge",
					position: { x, y: Y },
					data: { label: <NodeLabel title={definition.knowledge_agent} subtitle="knowledge bank" state="succeeded" stage="learn" /> },
					targetPosition: Position.Left,
					style: nodeStyle("knowledge", "pending"),
				});
				const lastID = steps[steps.length - 1].id || steps[steps.length - 1].skill || `step-${steps.length}`;
				edges.push({
					id: "e:knowledge",
					source: `step:${lastID}`,
					target: "knowledge",
					animated: running,
					style: { stroke: "rgb(197 167 94)" },
				});
			}
		} else {
			// Pattern B — engine node + declared-skill fan-out.
			const engineLabel = definition.engine?.module || definition.engine?.type || "engine";
			const engineState = running ? "running" : cycle ? (cycle.summary?.step_errors?.length || (cycle.summary as any)?.ok === false ? "failed" : "succeeded") : "pending";
			nodes.push({
				id: "engine",
				position: { x, y: Y },
				data: { label: <NodeLabel title={`command: ${engineLabel}`} subtitle={definition.engine?.experiment ? `experiment: ${definition.engine.experiment}` : "Pattern B engine"} state={engineState} badges={{ experiment: !!definition.engine?.experiment }} /> },
				sourcePosition: Position.Right,
				targetPosition: Position.Left,
				style: nodeStyle("engine", engineState),
			});
			edges.push({ id: "e:t", source: "trigger", target: "engine", animated: running, style: { stroke: "rgb(148 163 184)" } });
			x += NODE_W + GAP_X;

			const declared = definition.skills_invoked || [];
			// Grid the fan-out: 4 per column. One vertical stack made the
			// canvas tall-narrow and fitView crushed it (engine/trigger
			// rendered off-frame on mbb-ai's 8-skill manifest).
			const PER_COL = 4;
			// Center the fan on the engine row — a 1-2 skill fan used to hang
			// at the top of an otherwise empty canvas.
			const colRows = Math.min(PER_COL, declared.length || 1);
			const yStart = Math.max(4, Y - ((colRows - 1) * 72) / 2);
			declared.forEach((sk, i) => {
				const cs = cycleByStep.get(sk);
				const state = stateOf(cs, true);
				const col = Math.floor(i / PER_COL);
				nodes.push({
					id: `skill:${sk}`,
					position: { x: x + col * (NODE_W + 50), y: yStart + (i % PER_COL) * 72 },
					data: { label: <NodeLabel title={sk} subtitle={cs ? "" : "declared"} state={state} duration={cs?.duration_s} /> },
					targetPosition: Position.Left,
					style: nodeStyle(state, state),
				});
				edges.push({
					id: `e:s${i}`,
					source: "engine",
					target: `skill:${sk}`,
					animated: false,
					// Dashed "declared" edges — the canonical contract enforces
					// NO ordering for skills_invoked[] in Pattern B; don't draw
					// a pipeline that doesn't exist.
					style: { stroke: "rgb(148 163 184)", strokeDasharray: cs ? undefined : "6 4" },
					label: cs ? undefined : "declared",
					labelStyle: { fontSize: 9, fill: "rgb(100 116 139)" },
				});
			});
			x += (Math.ceil(declared.length / PER_COL) || 1) * (NODE_W + 50) + 20;
			if (definition.knowledge_agent) {
				nodes.push({
					id: "knowledge",
					position: { x, y: Y },
					data: { label: <NodeLabel title={definition.knowledge_agent} subtitle="knowledge bank" state="succeeded" stage="learn" /> },
					targetPosition: Position.Left,
					style: nodeStyle("knowledge", "pending"),
				});
				edges.push({ id: "e:k", source: "engine", target: "knowledge", animated: running, style: { stroke: "rgb(197 167 94)" } });
			}
		}

		// Stage bands — group-style background nodes behind Pattern A pipelines.
		if (patternA && !showcase) {
			const stageSpans = new Map<string, { minX: number; maxX: number }>();
			for (const n of nodes) {
				if (!n.id.startsWith("step:")) continue;
				const idx = nodes.indexOf(n);
				const stage = stageOf(n.id.slice(5), idx, nodes.length, cycleByStep.get(n.id.slice(5))?.stage);
				const span = stageSpans.get(stage) || { minX: n.position.x, maxX: n.position.x };
				span.minX = Math.min(span.minX, n.position.x);
				span.maxX = Math.max(span.maxX, n.position.x);
				stageSpans.set(stage, span);
			}
			let bandIdx = 0;
			for (const s of LOOP_STAGES) {
				const span = stageSpans.get(s.key);
				if (!span) continue;
				nodes.unshift({
					id: `band:${s.key}`,
					position: { x: span.minX - 14, y: 0 },
					data: { label: <div className="text-[9px] font-semibold uppercase tracking-wider px-2 pt-1" style={{ color: STAGE_LABEL_COLOR[s.key] }}>{s.label}</div> },
					draggable: false,
					selectable: false,
					style: {
						width: span.maxX - span.minX + NODE_W + 28,
						height: 170,
						background: STAGE_TINT[s.key],
						border: "none",
						borderRadius: 14,
						zIndex: -1,
						pointerEvents: "none" as const,
					},
				});
				bandIdx++;
			}
			void bandIdx;
		}

		return { nodes, edges };
	}, [definition, cycle, running, showcase]);

	const empty = !definition.steps?.length && !definition.skills_invoked?.length && !definition.engine?.type && !definition.engine?.module;
	if (empty) return null;

	// Height tracks actual content: a 3-node lqt-mailbox graph gets a
	// slim strip, an 8-skill fan gets room. fitView's maxZoom (below)
	// stops small graphs ballooning to fill the slack.
	const fanRows = Math.min(4, definition.skills_invoked?.length || 0);
	const height = showcase ? 160 : fanRows > 1 ? Math.max(220, fanRows * 72 + 90) : 190;

	return (
		<div className="rounded-xl border border-slate-200 bg-white" style={{ height }}>
			<ReactFlow
				// Remount when the graph or the overlaid run changes — fitView
				// only runs on init, so late-arriving cycle data otherwise
				// leaves the viewport framed on the old (or empty) graph.
				key={`${nodes.length}:${cycle?.ts || ""}:${showcase}`}
				nodes={nodes}
				edges={edges}
				fitView
				fitViewOptions={{ padding: showcase ? 0.08 : 0.12, maxZoom: 1 }}
				proOptions={{ hideAttribution: true }}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={!showcase}
				zoomOnScroll={!showcase}
				panOnDrag={!showcase}
				onNodeClick={(_e, node) => {
					if (showcase || !onStepSelect) return;
					if (node.id.startsWith("step:") || node.id.startsWith("skill:")) {
						const stepID = node.id.replace(/^(step|skill):/, "");
						const cs = (cycle?.steps || []).find((s) => s.step_id === stepID);
						const decl = node.id.startsWith("skill:");
						const skill = definition.steps?.find((s) => (s.id || s.skill) === stepID)?.skill || (decl ? stepID : undefined);
						onStepSelect({ step_id: stepID, skill, declared: decl && !cs, cycleStep: cs });
					}
				}}
			>
				<Background gap={16} color="rgb(241 245 249)" />
				{!showcase && <Controls showInteractive={false} />}
			</ReactFlow>
		</div>
	);
}

function nodeStyle(_kind: string, state: string): React.CSSProperties {
	return {
		background: "white",
		border: `2px solid ${STATE_BORDER[state] || "rgb(203 213 225)"}`,
		borderRadius: 12,
		padding: 0,
		fontSize: 12,
		fontWeight: 500,
		boxShadow: state === "running" ? `0 0 0 4px ${STATE_BG.running}30` : "0 1px 2px rgba(15, 23, 42, 0.04)",
		minWidth: NODE_W,
		zIndex: 1,
	};
}

function NodeLabel({ title, subtitle, state, duration, badges, stage }: {
	title: string;
	subtitle?: string;
	state: string;
	duration?: number;
	badges?: { experiment?: boolean; knowledge?: boolean };
	stage?: string;
}) {
	return (
		<div className="px-3 py-2 text-left" data-pick-kind="cycle-step" data-pick-id={title}>
			<div className="flex items-center gap-1.5">
				<span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATE_BG[state] || STATE_BG.pending }} />
				<span className="text-[12px] text-slate-900 truncate" style={{ maxWidth: 130 }}>{title}</span>
				{badges?.experiment && <span title="runs an experiment" className="text-[10px]">🧪</span>}
				{badges?.knowledge && <span title="writes to a knowledge bank" className="text-[10px]">🧠</span>}
			</div>
			<div className="flex items-center gap-1.5 mt-0.5">
				{subtitle && <span className="text-[10px] text-slate-500 truncate" style={{ maxWidth: 110 }}>{subtitle}</span>}
				{duration !== undefined && <span className="text-[10px] text-slate-400 font-mono ml-auto">{duration.toFixed(1)}s</span>}
				{stage && !subtitle && <span className="text-[9px] uppercase tracking-wide" style={{ color: STAGE_LABEL_COLOR[stage] || "rgb(148 163 184)" }}>{stage}</span>}
			</div>
		</div>
	);
}
