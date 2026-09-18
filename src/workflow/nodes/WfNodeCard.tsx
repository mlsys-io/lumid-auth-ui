// WfNodeCard — the node visual language, one component for every dialect.
//
// THREE CHANNELS, NEVER OVERLOADED:
//   type     -> the 3px left accent rail + the tinted icon square
//   status   -> a RING and a dot, never a border or background repaint
//   relation -> nothing here; that is the edge's job
//
// The old canvases each spent the BORDER on a different channel — one on type,
// one on status — so the same card meant different things depending on which
// screen you were looking at. The border is now permanently neutral and the
// two channels are independent, which is what makes a mixed graph readable.
//
// Deliberately NOT React Flow's default look: the stock grey node with a grey
// circle handle is the single most recognisable "someone wired up the demo"
// tell. Everything here is a plain div, because React Flow renders nodes as
// DOM — which is also why framer-motion can animate them at all.

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { motion } from "framer-motion";
import { iconFor, BADGE_ICON } from "../icons";
import type { WfNode, WfStatus } from "../model";
import { ACCENT, STATUS_COLOR, accentOf, withAlpha } from "../theme";

export interface WfCardData extends Record<string, unknown> {
	node: WfNode;
	density: "comfortable" | "compact";
	/**
	 * Which way the graph flows. Handle orientation MUST follow this rather than
	 * the node's family: keying it off the family gave an xpio trigger (family
	 * "io") left/right handles inside a top-to-bottom pipeline, so its edge left
	 * the card sideways and looped back around to the node directly beneath it.
	 */
	direction: "LR" | "TB";
	/** Dim everything that is not the hovered/selected neighbourhood. */
	dimmed?: boolean;
	interactive?: boolean;
}

export const CARD_SIZE = {
	comfortable: { w: 216, minH: 64 },
	compact: { w: 168, minH: 44 },
};

/** A subtitle that is an identifier reads better in mono; prose does not. */
function isIdentifier(s: string): boolean {
	if (!s) return false;
	if (/\s/.test(s.trim())) return false;
	return /[/_.:-]/.test(s) || /^[A-Za-z0-9._/-]+$/.test(s);
}

function statusRingStyle(status: WfStatus | undefined, selected: boolean): React.CSSProperties {
	// Rings are composed as box-shadows so status and selection can coexist
	// without one clobbering the other's Tailwind ring utility.
	const rings: string[] = [];
	switch (status) {
		case "running":
			rings.push(`0 0 0 2px ${STATUS_COLOR.running}`, `0 0 0 6px ${withAlpha(STATUS_COLOR.running, 0.13)}`);
			break;
		case "succeeded":
			rings.push(`0 0 0 1px ${STATUS_COLOR.succeeded}`);
			break;
		case "failed":
			rings.push(`0 0 0 2px ${STATUS_COLOR.failed}`);
			break;
		default:
			break;
	}
	// Selection is gold and OFFSET, so it never reads as a status ring.
	if (selected) rings.push("0 0 0 2px white", `0 0 0 4px ${STATUS_COLOR.succeeded}`);
	rings.push("0 1px 2px rgba(15, 23, 42, 0.04)");
	return { boxShadow: rings.join(", ") };
}

function WfNodeCardImpl({ data, selected }: NodeProps<Node<WfCardData>>) {
	const { node, density, dimmed, interactive, direction } = data;
	const Icon = iconFor(node.kind);
	const accent = ACCENT[accentOf(node.kind)];
	const size = CARD_SIZE[density];
	const status = node.status;
	const compact = density === "compact";

	const detail = node.run?.error ? node.run.error.split("\n")[0] : node.run?.summary;
	const worker = node.badges?.find((b) => b.kind === "worker");
	const marks = node.badges?.filter((b) => b.kind !== "worker") ?? [];

	return (
		<motion.div
			// Enter animation only — position is React Flow's job, so there is no
			// `layout` prop here to fight it.
			initial={{ opacity: 0, scale: 0.96 }}
			animate={{ opacity: dimmed ? 0.3 : 1, scale: 1 }}
			transition={{ duration: 0.18, ease: "easeOut" }}
			className={[
				"group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left",
				"transition-[transform,box-shadow] duration-[120ms]",
				interactive ? "hover:-translate-y-px hover:shadow-md cursor-pointer" : "",
				status === "skipped" ? "opacity-55 grayscale" : "",
			].join(" ")}
			style={{ width: size.w, minHeight: size.minH, ...statusRingStyle(status, !!selected) }}
			data-pick-kind="workflow-node"
			data-pick-id={node.label}
			title={node.label}
		>
			{/* Type rail — full height, left edge. */}
			<span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />

			{/* Handles are invisible until the node is hovered: a canvas peppered
			    with grey dots looks unfinished, and in view mode they do nothing. */}
			{node.inputs.length > 0 && (
				<Handle
					type="target"
					position={direction === "TB" ? Position.Top : Position.Left}
					className="!h-2 !w-2 !rounded-[3px] !border-2 !border-slate-300 !bg-white !opacity-0 transition-opacity group-hover:!opacity-100"
				/>
			)}
			{node.outputs.length > 0 && (
				<Handle
					type="source"
					position={direction === "TB" ? Position.Bottom : Position.Right}
					className="!h-2 !w-2 !rounded-[3px] !border-2 !border-slate-300 !bg-white !opacity-0 transition-opacity group-hover:!opacity-100"
				/>
			)}

			<div className={compact ? "flex items-center gap-2 py-1.5 pl-3 pr-2.5" : "flex items-center gap-2 px-3 pt-2 pl-3.5"}>
				<span
					aria-hidden
					className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md"
					style={{ background: withAlpha(accent, 0.1), color: accent }}
				>
					<Icon size={14} strokeWidth={2} />
				</span>
				<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">{node.label}</span>
				{marks.map((b) => {
					const BIcon = BADGE_ICON[b.kind];
					return BIcon ? <BIcon key={b.kind} size={12} className="flex-shrink-0 text-slate-400" aria-label={b.title ?? b.kind} /> : null;
				})}
				{status && status !== "pending" && (
					<span
						title={status}
						className={`h-2 w-2 flex-shrink-0 rounded-full ${status === "running" ? "animate-pulse" : ""}`}
						style={{ background: STATUS_COLOR[status] }}
					/>
				)}
			</div>

			{!compact && (node.subtitle || node.run?.duration_s !== undefined) && (
				<div className="flex items-baseline gap-2 px-3 pb-2 pl-3.5">
					{node.subtitle && (
						<span
							className={`min-w-0 flex-1 truncate text-[11px] text-slate-500 ${isIdentifier(node.subtitle) ? "font-mono" : ""}`}
							title={node.subtitle}
						>
							{node.subtitle}
						</span>
					)}
					{node.run?.duration_s !== undefined && (
						<span className="ml-auto flex-shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
							{node.run.duration_s.toFixed(1)}s
						</span>
					)}
				</div>
			)}

			{/* The run's result, AS TEXT inside the node, so a finished pipeline is
			    self-explanatory without clicking each box. Error wins over summary. */}
			{!compact && detail && (
				<div
					className={`border-t border-slate-100 px-3 py-1.5 pl-3.5 text-[10px] leading-snug ${node.run?.error ? "text-rose-600" : "text-slate-500"}`}
					style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
					title={detail}
				>
					{detail}
				</div>
			)}

			{!compact && worker && (
				<div className="flex items-center gap-1 px-3 pb-2 pl-3.5">
					<span className="rounded bg-slate-900 px-1 py-0.5 font-mono text-[9px] text-white" title={worker.title}>
						{worker.label}
					</span>
				</div>
			)}
		</motion.div>
	);
}

export const WfNodeCard = memo(WfNodeCardImpl);
