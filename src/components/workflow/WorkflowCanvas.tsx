// WorkflowCanvas — node view of one xpio workflow (loop).
//
// This is now a COMPATIBILITY SHIM over the generic canvas at
// src/workflow/WorkflowCanvas.tsx. It keeps this module's props and its
// `CanvasStepRef` export so the four existing call sites — the observability
// panel, the app surface, the trajectory graph and the step inspector — do not
// move. The shape of the graph is decided by workflow/adapters/xpio.ts:
//
//   Pattern A (runner-driven):  trigger → step → step → … → knowledge
//   Pattern B (command-driven): trigger → engine ═declared═> skill
//
// The dashed "declared" edges are not a style choice: the contract enforces NO
// ordering for skills_invoked[], so drawing a pipeline there would assert a
// sequence that does not exist.
//
// modes: "observe" (interactive, click-to-inspect) and "showcase" (static,
// compact — marketplace cards + app surfaces).

import { useMemo, useState } from "react";
import type { LoopDefinition, MeCycleDetail, MeCycleStep } from "@/api/me";
import GenericWorkflowCanvas from "@/workflow/WorkflowCanvas";
import { projectXpio, isEmptyLoop } from "@/workflow/adapters/xpio";

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
	// it overrides the content-derived height.
	height?: number | string;
	onStepSelect?: (ref: CanvasStepRef) => void;
}

export default function WorkflowCanvas({
	definition, cycle, running = false, mode = "observe", height, onStepSelect,
}: Props) {
	const showcase = mode === "showcase";
	const [selected, setSelected] = useState<string | null>(null);

	const graph = useMemo(
		() => projectXpio(definition, { cycle, running, bands: !showcase }),
		[definition, cycle, running, showcase],
	);

	if (isEmptyLoop(definition)) return null;

	return (
		<GenericWorkflowCanvas
			graph={graph}
			mode={showcase ? "showcase" : running ? "run" : "view"}
			height={height}
			selection={selected}
			onSelectionChange={(id) => {
				setSelected(id);
				if (!id || !onStepSelect) return;
				if (!id.startsWith("step:") && !id.startsWith("skill:")) return;
				const stepID = id.replace(/^(step|skill):/, "");
				const cs = (cycle?.steps || []).find((s) => s.step_id === stepID);
				const declared = id.startsWith("skill:");
				const skill =
					definition.steps?.find((s) => (s.id || s.skill) === stepID)?.skill
					?? (declared ? stepID : undefined);
				onStepSelect({ step_id: stepID, skill, declared: declared && !cs, cycleStep: cs });
			}}
		/>
	);
}
