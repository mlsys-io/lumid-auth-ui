// RunDagCanvas — per-run DAG view (W1).
//
// Each node renders one step from the run's step_log.json with its
// state color (succeeded / failed / running / skipped) and an optional
// onClick handler so the caller can open a side panel with logs +
// inputs/outputs + error.
//
// The runtime emits step_log.json as a JSON array of objects like:
//   {"id": "observe", "ok": true,  "duration_s": 0.7, "skill": "email/observe"}
//   {"id": "act",     "ok": false, "duration_s": 1.2, "error": "Quota exceeded"}
//
// Layout: left-to-right linear flow. xpio's 5-stage shape lays out
// naturally; future Pattern B DAGs can supply explicit "dependsOn"
// metadata to drive xyflow's edge graph more richly.

import { useMemo } from "react";
import { ReactFlow, Background, Controls, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

interface StepLogEntry {
	id?: string;
	name?: string;
	skill?: string;
	ok?: boolean;
	skipped?: boolean;
	duration_s?: number;
	error?: string;
}

interface Props {
	steps: StepLogEntry[];
	onStepClick?: (step: StepLogEntry) => void;
}

const STATE_BG: Record<string, string> = {
	succeeded: "rgb(16 185 129)",   // emerald-500
	failed:    "rgb(225 29 72)",    // rose-600
	running:   "rgb(245 158 11)",   // amber-500
	skipped:   "rgb(148 163 184)",  // slate-400
	pending:   "rgb(203 213 225)",  // slate-300
};

const STATE_BORDER: Record<string, string> = {
	succeeded: "rgb(5 150 105)",
	failed:    "rgb(190 18 60)",
	running:   "rgb(217 119 6)",
	skipped:   "rgb(100 116 139)",
	pending:   "rgb(148 163 184)",
};

export function RunDagCanvas({ steps, onStepClick }: Props) {
	const nodes = useMemo<Node[]>(
		() => steps.map((s, i) => {
			const state = inferState(s);
			const label = s.id || s.name || s.skill || `step ${i + 1}`;
			return {
				id: `step-${i}`,
				position: { x: i * 220, y: 0 },
				data: { label: <NodeLabel label={label} state={state} duration={s.duration_s} /> },
				sourcePosition: Position.Right,
				targetPosition: Position.Left,
				style: {
					background: "white",
					border: `2px solid ${STATE_BORDER[state] || "rgb(203 213 225)"}`,
					borderRadius: 12,
					padding: 0,
					fontSize: 12,
					fontWeight: 500,
					boxShadow: state === "running" ? `0 0 0 4px ${STATE_BG[state]}30` : "0 1px 2px rgba(15, 23, 42, 0.04)",
					minWidth: 180,
				},
			};
		}),
		[steps],
	);

	const edges = useMemo<Edge[]>(
		() => steps.slice(1).map((_, i) => ({
			id: `e-${i}`,
			source: `step-${i}`,
			target: `step-${i + 1}`,
			animated: false,
			style: { stroke: "rgb(148 163 184)" },
		})),
		[steps],
	);

	if (steps.length === 0) {
		return (
			<div className="h-[280px] rounded-xl border border-dashed border-slate-200 bg-white flex items-center justify-center text-sm text-slate-500">
				No step log captured for this run.
			</div>
		);
	}

	return (
		<div className="h-[320px] rounded-xl border border-slate-200 bg-white">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				fitView
				fitViewOptions={{ padding: 0.2 }}
				proOptions={{ hideAttribution: true }}
				nodesDraggable={false}
				nodesConnectable={false}
				elementsSelectable
				onNodeClick={(_e, node) => {
					const idx = Number(node.id.replace("step-", ""));
					if (steps[idx] && onStepClick) onStepClick(steps[idx]);
				}}
			>
				<Background gap={16} color="rgb(226 232 240)" />
				<Controls showInteractive={false} />
			</ReactFlow>
		</div>
	);
}

function NodeLabel({ label, state, duration }: { label: string; state: string; duration?: number }) {
	return (
		<div className="px-3 py-2 text-left">
			<div className="flex items-center gap-1.5">
				<span
					className="w-2 h-2 rounded-full flex-shrink-0"
					style={{ background: STATE_BG[state] || "rgb(203 213 225)" }}
				/>
				<span className="text-[12px] text-slate-900 truncate" style={{ maxWidth: 140 }}>
					{label}
				</span>
			</div>
			{duration !== undefined && (
				<div className="text-[10px] text-slate-500 mt-0.5 font-mono">
					{duration.toFixed(2)}s
				</div>
			)}
		</div>
	);
}

function inferState(s: StepLogEntry): string {
	if (s.skipped) return "skipped";
	if (s.ok === true) return "succeeded";
	if (s.ok === false) return "failed";
	return "pending";
}

export default RunDagCanvas;
