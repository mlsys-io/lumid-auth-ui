// AirflowGrid — Airflow-inspired grid view primitive.
//
// Two modes:
//   mode="per-workflow"   rows = step names, columns = recent runs
//   mode="cross-workflow" rows = workflow slugs, columns = time buckets
//
// In both modes, cells are state-colored squares with hover tooltips.
// Click a cell → notifies the caller (typically navigate to run detail).

import { useMemo } from "react";

export type GridState =
	| "succeeded"
	| "failed"
	| "running"
	| "skipped"
	| "canceled"
	| "empty";

export interface GridCell {
	state: GridState;
	tooltip?: string;
	href?: string;
}

interface Props {
	/** Row labels (steps OR workflow slugs). Newest-first not required. */
	rows: string[];
	/** Column labels (timestamps, run ids, or bucket starts). */
	columns: string[];
	/** Sparse: cells[row][col] → state, missing means "empty". */
	cells: Record<string, Record<string, GridCell>>;
	/** When a cell is clicked, the handler receives `(row, col)`. */
	onCellClick?: (row: string, col: string) => void;
	emptyText?: string;
}

const STATE_CLASS: Record<GridState, string> = {
	succeeded: "bg-amber-400 hover:bg-amber-500",
	failed:    "bg-rose-500 hover:bg-rose-600",
	running:   "bg-amber-400 hover:bg-amber-500 animate-pulse",
	skipped:   "bg-slate-300 hover:bg-slate-400",
	canceled:  "bg-slate-400 hover:bg-slate-500",
	empty:     "bg-slate-100 hover:bg-slate-200",
};

export function AirflowGrid({ rows, columns, cells, onCellClick, emptyText }: Props) {
	const hasContent = useMemo(
		() => rows.length > 0 && columns.length > 0,
		[rows.length, columns.length],
	);
	if (!hasContent) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
				{emptyText || "No runs yet — this grid will fill in as your workflow executes."}
			</div>
		);
	}

	return (
		<div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
			<div className="inline-block">
				{/* Column header row — timestamps rotated 90° for density */}
				<div className="flex items-end gap-px ml-32 mb-1.5">
					{columns.map((c) => (
						<div
							key={c}
							className="w-4 text-[9px] text-slate-400 font-mono whitespace-nowrap"
							style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
							title={c}
						>
							{shortLabel(c)}
						</div>
					))}
				</div>
				{rows.map((row) => (
					<div key={row} className="flex items-center gap-px mb-px">
						<div className="w-32 text-xs text-slate-700 pr-2 truncate" title={row}>
							{row}
						</div>
						{columns.map((col) => {
							const cell = cells[row]?.[col] || { state: "empty" as GridState };
							return (
								<button
									key={col}
									onClick={() => onCellClick?.(row, col)}
									className={[
										"w-4 h-4 rounded-sm transition-colors",
										STATE_CLASS[cell.state],
										onCellClick && cell.state !== "empty" ? "cursor-pointer" : "cursor-default",
									].join(" ")}
									title={cell.tooltip || `${row} · ${col} · ${cell.state}`}
									disabled={!onCellClick || cell.state === "empty"}
								/>
							);
						})}
					</div>
				))}
				{/* Legend */}
				<div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
					<Legend state="succeeded" label="Succeeded" />
					<Legend state="failed" label="Failed" />
					<Legend state="running" label="Running" />
					<Legend state="skipped" label="Skipped" />
				</div>
			</div>
		</div>
	);
}

function Legend({ state, label }: { state: GridState; label: string }) {
	return (
		<span className="inline-flex items-center gap-1">
			<span className={["w-2.5 h-2.5 rounded-sm", STATE_CLASS[state]].join(" ")} />
			{label}
		</span>
	);
}

// shortLabel — try to display a compact tick. ISO/timestamp strings
// get their HH:MM portion; otherwise truncate.
function shortLabel(s: string): string {
	if (s.length === 16 && s[8] === "T") return s.slice(9, 11) + ":" + s.slice(11, 13);
	if (s.length >= 14 && s.includes("T")) {
		const parts = s.split("T");
		return parts[1]?.slice(0, 5) || s.slice(0, 6);
	}
	if (s.length > 8) return s.slice(0, 5) + "…";
	return s;
}

export default AirflowGrid;
