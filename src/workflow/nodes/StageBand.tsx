// StageBand — the horizontal stripe behind an xpio stage, plus its gutter label.
//
// A real React Flow node type with `zIndex: -1` set as a NODE PROPERTY. The old
// implementation unshifted a plain node with zIndex inside `style`, which v12
// does not honour reliably and which fought selection: the band sat in the
// selection layer and had to opt out with pointerEvents, node by node.
//
// The tint alone is nearly invisible on a dim laptop screen, so each band also
// gets a 1px inner top rule in the stage's own label colour. That is the
// difference between a wash and a designed band.

import { memo } from "react";
import type { NodeProps, Node } from "@xyflow/react";
import { STAGE_TINT, STAGE_LABEL_COLOR } from "../theme";

export interface StageBandData extends Record<string, unknown> {
	stage: string;
	label: string;
	width: number;
	height: number;
}

function StageBandImpl({ data }: NodeProps<Node<StageBandData>>) {
	const color = STAGE_LABEL_COLOR[data.stage] ?? "rgb(148 163 184)";
	return (
		<div
			className="pointer-events-none rounded-2xl"
			style={{
				width: data.width,
				height: data.height,
				background: STAGE_TINT[data.stage] ?? "transparent",
				borderTop: `1px solid ${color}26`,
			}}
		/>
	);
}
export const StageBand = memo(StageBandImpl);

export interface StageLabelData extends Record<string, unknown> {
	stage: string;
	label: string;
	width: number;
}

function StageLabelImpl({ data }: NodeProps<Node<StageLabelData>>) {
	const color = STAGE_LABEL_COLOR[data.stage] ?? "rgb(148 163 184)";
	return (
		<div className="pointer-events-none flex items-center justify-end gap-1.5" style={{ width: data.width }}>
			<span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
				{data.label}
			</span>
			{/* A 2px tick makes the band legible as a legend even when the tint
			    washes out — the label alone floats with nothing to anchor it. */}
			<span aria-hidden className="h-3 w-[2px] rounded-full" style={{ background: color }} />
		</div>
	);
}
export const StageLabel = memo(StageLabelImpl);
