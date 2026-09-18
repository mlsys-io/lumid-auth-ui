// RunDagCanvas — per-run DAG view.
//
// A thin shim over the generic canvas: the graph comes from
// workflow/adapters/steplog.ts, so a run renders with the same node language,
// the same status colours and the same inspector affordances as everything
// else. The previous implementation built its own nodes, its own edges and its
// own palette — one in which `succeeded` was emerald and `running` was amber,
// both commented "gold-500".

import { useMemo, useState } from "react";
import WorkflowCanvas from "@/workflow/WorkflowCanvas";
import { projectStepLog, stepIndexOf, type StepLogEntry } from "@/workflow/adapters/steplog";

interface Props {
	steps: StepLogEntry[];
	onStepClick?: (step: StepLogEntry) => void;
}

export function RunDagCanvas({ steps, onStepClick }: Props) {
	const [selected, setSelected] = useState<string | null>(null);
	const graph = useMemo(() => projectStepLog(steps), [steps]);

	if (steps.length === 0) {
		return (
			<div className="flex h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white text-sm text-slate-500">
				No step log captured for this run.
			</div>
		);
	}

	return (
		<WorkflowCanvas
			graph={graph}
			mode="view"
			height={320}
			selection={selected}
			onSelectionChange={(id) => {
				setSelected(id);
				if (!id || !onStepClick) return;
				const idx = stepIndexOf(id);
				if (steps[idx]) onStepClick(steps[idx]);
			}}
		/>
	);
}

export default RunDagCanvas;
