// WorkflowPreview — a read-only thumbnail of whatever a stored workflow is.
//
// Marketplace rows hold `definition_json`, an opaque LONGTEXT the Java backend
// never parses. In practice that column contains at least four different
// dialects, none of them labelled, so a preview must sniff the bytes and
// degrade gracefully — an unrecognised row is an ordinary occurrence here, not
// a fault.
//
// It replaced an iframe pointed at VITE_N8N_URL, which has been returning 504
// since the n8n container went away with the pre-Kubernetes lift. The pane was
// a gateway-timeout box behind a spinner, and the spinner never stopped because
// the `previewPageReady` message it waited for could never arrive.

import { useMemo } from "react";
import WorkflowCanvas from "./WorkflowCanvas";
import { graphFor } from "./preview";

interface Props {
	/** The stored document. JSON or YAML; the dialect is sniffed, not declared. */
	definitionJson?: string | null;
	height?: number | string;
	className?: string;
}

export default function WorkflowPreview({ definitionJson, height = "100%", className }: Props) {
	const { graph, label } = useMemo(() => graphFor(definitionJson ?? ""), [definitionJson]);

	if (!graph || !graph.nodes.length) {
		return (
			<div className={className ?? "flex h-full w-full items-center justify-center bg-slate-50 px-6 text-center"}>
				<p className="text-[12px] leading-relaxed text-slate-400">
					{label === "empty"
						? "This workflow has no definition saved yet."
						: `Nothing to draw — the stored definition is ${label}.`}
				</p>
			</div>
		);
	}

	return (
		<div className="relative h-full w-full">
			<WorkflowCanvas
				graph={graph}
				mode="showcase"
				height={height}
				density="compact"
				className={className ?? "h-full w-full bg-[#FCFCFD]"}
			/>
			<span className="pointer-events-none absolute right-2 top-2 rounded bg-white/85 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 backdrop-blur">
				{label}
			</span>
		</div>
	);
}
