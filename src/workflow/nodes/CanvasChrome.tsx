// CanvasChrome — the controls pill and the diagnostics strip.
//
// React Flow's stock <Controls/> is the second-most recognisable "this is a
// React Flow demo" tell after the grey circular handles: a hard-edged white
// column of grey glyphs that matches nothing else on the page. Replacing it
// with the app's own button language is the single cheapest change that makes
// the canvas look built rather than wired up.

import { Panel, useReactFlow, type PanelPosition } from "@xyflow/react";
import { motion } from "framer-motion";
import { AlertTriangle, Info, Maximize2, Minus, Plus, Wand2 } from "lucide-react";
import type { WfDiagnostic } from "../model";

interface ControlsProps {
	position?: PanelPosition;
	/** Offered only when the caller can actually re-run the layout. */
	onAutoLayout?: () => void;
}

export function CanvasControls({ position = "bottom-left", onAutoLayout }: ControlsProps) {
	const rf = useReactFlow();
	const btn =
		"flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(176_143_69)]";
	return (
		<Panel position={position}>
			<motion.div
				initial={{ opacity: 0, y: 6 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.2, ease: "easeOut" }}
				className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur"
			>
				<button type="button" className={btn} onClick={() => rf.zoomOut({ duration: 160 })} title="Zoom out" aria-label="Zoom out">
					<Minus size={14} />
				</button>
				<button type="button" className={btn} onClick={() => rf.zoomIn({ duration: 160 })} title="Zoom in" aria-label="Zoom in">
					<Plus size={14} />
				</button>
				<button type="button" className={btn} onClick={() => rf.fitView({ padding: 0.15, duration: 220 })} title="Fit to view" aria-label="Fit to view">
					<Maximize2 size={13} />
				</button>
				{onAutoLayout && (
					<button type="button" className={btn} onClick={onAutoLayout} title="Auto-layout" aria-label="Auto-layout">
						<Wand2 size={13} />
					</button>
				)}
			</motion.div>
		</Panel>
	);
}

/**
 * Diagnostics, surfaced ON the canvas rather than in a console nobody opens.
 *
 * A dangling `inputs:` reference or a missing `outputs:` block used to be
 * invisible here and would fail much later, server-side, as a 400. Showing it
 * next to the graph it belongs to is most of the value of having parsed it.
 */
export function DiagnosticsStrip({ diagnostics }: { diagnostics: WfDiagnostic[] }) {
	if (!diagnostics.length) return null;
	const errors = diagnostics.filter((d) => d.level === "error");
	const shown = (errors.length ? errors : diagnostics).slice(0, 3);
	const more = (errors.length ? errors : diagnostics).length - shown.length;
	const bad = errors.length > 0;
	return (
		<Panel position="top-right">
			<motion.div
				initial={{ opacity: 0, y: -6 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.2, ease: "easeOut" }}
				className={`max-w-[320px] rounded-xl border px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur ${
					bad ? "border-rose-200 bg-rose-50/90 text-rose-700" : "border-amber-200 bg-amber-50/90 text-amber-800"
				}`}
			>
				<div className="mb-0.5 flex items-center gap-1.5 font-medium">
					{bad ? <AlertTriangle size={12} /> : <Info size={12} />}
					{bad ? `${errors.length} problem${errors.length === 1 ? "" : "s"}` : "Check this workflow"}
				</div>
				<ul className="space-y-0.5">
					{shown.map((d, i) => (
						<li key={i} className="leading-snug">
							{d.node && <span className="font-mono opacity-70">{d.node}: </span>}
							{d.message}
						</li>
					))}
					{more > 0 && <li className="opacity-70">and {more} more…</li>}
				</ul>
			</motion.div>
		</Panel>
	);
}
