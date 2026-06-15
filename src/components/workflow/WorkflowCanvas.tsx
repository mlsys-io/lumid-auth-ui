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
	// Explicit canvas height. When set (e.g. the panel sizes it to the screen),
	// it overrides the content-derived height; fitView (capped at zoom 1) then
	// centers the graph in the taller box at native font size.
	height?: number | string;
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

// Vertical layout — the pipeline flows top→bottom. NODE_W is the node
// width; STEP_Y is the center-to-center vertical distance between stacked
// nodes; NODE_H approximates a node's rendered height (for band sizing +
// canvas height); GUTTER leaves a left column for the stage labels; COL_X
// is the x of the main vertical column.
const NODE_W = 196;
const STEP_Y = 84;
const NODE_H = 50;
const GUTTER = 96;
const COL_X = GUTTER + 18;

export default function WorkflowCanvas({ definition, cycle, running = false, mode = "observe", height: heightProp, onStepSelect }: Props) {
	const showcase = mode === "showcase";

	const { nodes, edges, contentH } = useMemo(() => {
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

		const TOP = 16;
		let y = TOP;

		// Trigger node — cron or @trigger. Top of the vertical chain.
		const schedule = definition.schedule || "";
		nodes.push({
			id: "trigger",
			position: { x: COL_X, y },
			data: {
				label: (
					<NodeLabel
						title={schedule === "@trigger" || schedule === "" || schedule === "manual" ? "Manual trigger" : describeSchedule(schedule)}
						subtitle="trigger"
						state={running ? "running" : "succeeded"}
					/>
				),
			},
			sourcePosition: Position.Bottom,
			targetPosition: Position.Top,
			style: nodeStyle("trigger", running ? "running" : "pending"),
		});
		y += STEP_Y;

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
					position: { x: COL_X, y },
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
					sourcePosition: Position.Bottom,
					targetPosition: Position.Top,
					style: nodeStyle(state, state),
				});
				edges.push({
					id: `e:${i}`,
					source: i === 0 ? "trigger" : `step:${steps[i - 1].id || steps[i - 1].skill || `step-${i}`}`,
					target: `step:${id}`,
					animated: running,
					style: { stroke: "rgb(148 163 184)" },
				});
				y += STEP_Y;
			});
			// Knowledge sink off the learn end (bottom).
			if (definition.knowledge_agent) {
				nodes.push({
					id: "knowledge",
					position: { x: COL_X, y },
					data: { label: <NodeLabel title={definition.knowledge_agent} subtitle="knowledge bank" state="succeeded" stage="learn" /> },
					targetPosition: Position.Top,
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
				y += STEP_Y;
			}
		} else {
			// Pattern B — engine node, then declared-skill fan-out in rows below.
			const engineLabel = definition.engine?.module || definition.engine?.type || "engine";
			const engineState = running ? "running" : cycle ? (cycle.summary?.step_errors?.length || (cycle.summary as any)?.ok === false ? "failed" : "succeeded") : "pending";
			nodes.push({
				id: "engine",
				position: { x: COL_X, y },
				data: { label: <NodeLabel title={`command: ${engineLabel}`} subtitle={definition.engine?.experiment ? `experiment: ${definition.engine.experiment}` : "Pattern B engine"} state={engineState} badges={{ experiment: !!definition.engine?.experiment }} /> },
				sourcePosition: Position.Bottom,
				targetPosition: Position.Top,
				style: nodeStyle("engine", engineState),
			});
			edges.push({ id: "e:t", source: "trigger", target: "engine", animated: running, style: { stroke: "rgb(148 163 184)" } });
			y += STEP_Y;

			const declared = definition.skills_invoked || [];
			// Fan the declared skills into rows BELOW the engine (2 per row) so
			// the graph still reads top→bottom; a single tall stack would push
			// the knowledge sink off-frame on big manifests.
			const PER_ROW = 2;
			const cols = Math.min(PER_ROW, declared.length || 1);
			const fanW = cols * NODE_W + (cols - 1) * 44;
			const startX = COL_X + NODE_W / 2 - fanW / 2;
			const skillTop = y;
			declared.forEach((sk, i) => {
				const cs = cycleByStep.get(sk);
				const state = stateOf(cs, true);
				const row = Math.floor(i / PER_ROW);
				const col = i % PER_ROW;
				nodes.push({
					id: `skill:${sk}`,
					position: { x: startX + col * (NODE_W + 44), y: skillTop + row * STEP_Y },
					data: { label: <NodeLabel title={sk} subtitle={cs ? "" : "declared"} state={state} duration={cs?.duration_s} /> },
					targetPosition: Position.Top,
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
			y = skillTop + (Math.ceil((declared.length || 1) / PER_ROW)) * STEP_Y;
			if (definition.knowledge_agent) {
				nodes.push({
					id: "knowledge",
					position: { x: COL_X, y },
					data: { label: <NodeLabel title={definition.knowledge_agent} subtitle="knowledge bank" state="succeeded" stage="learn" /> },
					targetPosition: Position.Top,
					style: nodeStyle("knowledge", "pending"),
				});
				edges.push({ id: "e:k", source: "engine", target: "knowledge", animated: running, style: { stroke: "rgb(197 167 94)" } });
				y += STEP_Y;
			}
		}

		// Stage bands — horizontal stripes behind the Pattern A vertical
		// pipeline, with the stage name in the left gutter (observe at the
		// top, learn at the bottom — the five stages flow downward).
		if (patternA && !showcase) {
			const stageSpans = new Map<string, { minY: number; maxY: number }>();
			for (const n of nodes) {
				if (!n.id.startsWith("step:")) continue;
				const idx = nodes.indexOf(n);
				const stage = stageOf(n.id.slice(5), idx, nodes.length, cycleByStep.get(n.id.slice(5))?.stage);
				const span = stageSpans.get(stage) || { minY: n.position.y, maxY: n.position.y };
				span.minY = Math.min(span.minY, n.position.y);
				span.maxY = Math.max(span.maxY, n.position.y);
				stageSpans.set(stage, span);
			}
			for (const s of LOOP_STAGES) {
				const span = stageSpans.get(s.key);
				if (!span) continue;
				// Stripe behind the column.
				nodes.unshift({
					id: `band:${s.key}`,
					position: { x: COL_X - 14, y: span.minY - 10 },
					data: { label: "" },
					draggable: false,
					selectable: false,
					style: {
						width: NODE_W + 28,
						height: span.maxY - span.minY + NODE_H + 20,
						background: STAGE_TINT[s.key],
						border: "none",
						borderRadius: 14,
						zIndex: -1,
						pointerEvents: "none" as const,
					},
				});
				// Stage name in the left gutter, vertically centered on the band.
				nodes.unshift({
					id: `bandlabel:${s.key}`,
					position: { x: 2, y: (span.minY + span.maxY) / 2 + NODE_H / 2 - 8 },
					data: { label: <div className="text-[10px] font-semibold uppercase tracking-wider text-right" style={{ color: STAGE_LABEL_COLOR[s.key] }}>{s.label}</div> },
					draggable: false,
					selectable: false,
					style: { width: GUTTER, background: "transparent", border: "none", zIndex: 0, pointerEvents: "none" as const },
				});
			}
		}

		const maxY = nodes.reduce(
			(m, n) => Math.max(m, n.position.y + (typeof n.style?.height === "number" ? (n.style.height as number) : NODE_H)),
			0,
		);
		return { nodes, edges, contentH: maxY + TOP };
	}, [definition, cycle, running, showcase]);

	const empty = !definition.steps?.length && !definition.skills_invoked?.length && !definition.engine?.type && !definition.engine?.module;
	if (empty) return null;

	// Height tracks the actual vertical content so fitView (capped at zoom 1)
	// renders nodes at their native font size — text stays comparable to the
	// rest of the page. Long pipelines are capped and pan/scroll instead of
	// shrinking the text to fit.
	const height = heightProp ?? (showcase ? 200 : Math.min(Math.max(220, contentH + 24), 760));

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
				// Lock zoom to 1 in observe mode so nodes ALWAYS render at their
				// native font size — fitView only translates (centers), never
				// shrinks the graph to cram a tall pipeline into the box. Overflow
				// is reached by scroll/drag, not by zooming out. Showcase
				// thumbnails still scale down to fit.
				fitViewOptions={{ padding: showcase ? 0.1 : 0.12, maxZoom: 1, minZoom: showcase ? 0.2 : 1 }}
				proOptions={{ hideAttribution: true }}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable={!showcase}
				zoomOnScroll={false}
				panOnScroll={!showcase}
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
		fontSize: 13,
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
				<span className="text-[13px] text-slate-900 truncate" style={{ maxWidth: 134 }}>{title}</span>
				{badges?.experiment && <span title="runs an experiment" className="text-[11px]">🧪</span>}
				{badges?.knowledge && <span title="writes to a knowledge bank" className="text-[11px]">🧠</span>}
			</div>
			<div className="flex items-center gap-1.5 mt-0.5">
				{subtitle && <span className="text-[11px] text-slate-500 truncate" style={{ maxWidth: 112 }}>{subtitle}</span>}
				{duration !== undefined && <span className="text-[11px] text-slate-400 font-mono ml-auto">{duration.toFixed(1)}s</span>}
				{stage && !subtitle && <span className="text-[10px] uppercase tracking-wide" style={{ color: STAGE_LABEL_COLOR[stage] || "rgb(148 163 184)" }}>{stage}</span>}
			</div>
		</div>
	);
}
