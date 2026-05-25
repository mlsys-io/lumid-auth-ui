// AirflowGantt — horizontal time bars showing run durations across a
// time window. Rows = recent runs, x-axis = wall clock, bar = run
// duration with color = run state. Great for "is this workflow stuck?"
//
// Time scale auto-fits the data range; min/max derived from the runs
// list, plus a small head/tail pad.

import type { MeRunRow } from "@/api/me";

interface Props {
	runs: MeRunRow[];
	onClick?: (runId: string) => void;
}

const STATE_BG: Record<string, string> = {
	succeeded: "bg-emerald-400",
	failed:    "bg-rose-500",
	running:   "bg-amber-400 animate-pulse",
	skipped:   "bg-slate-300",
	canceled:  "bg-slate-400",
};

export function AirflowGantt({ runs, onClick }: Props) {
	if (runs.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
				No runs in the current window.
			</div>
		);
	}

	// Sort oldest → newest so bars stack top-down chronologically.
	const sorted = [...runs].sort((a, b) => a.started_at - b.started_at);

	// Compute time bounds. Use a 5% pad on each side.
	const minT = Math.min(...sorted.map((r) => r.started_at));
	const maxT = Math.max(...sorted.map((r) => r.started_at + (r.duration_s || 60)));
	const range = Math.max(maxT - minT, 60); // at least a minute wide
	const padded = range * 0.05;
	const windowMin = minT - padded;
	const windowMax = maxT + padded;
	const windowSpan = windowMax - windowMin;

	// X-axis tick labels — 4 evenly spaced.
	const ticks = Array.from({ length: 5 }, (_, i) => windowMin + (windowSpan * i) / 4);

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
			<div className="relative" style={{ minWidth: 480 }}>
				{/* Axis */}
				<div className="flex items-center gap-px mb-1 ml-48 border-b border-slate-200 pb-1">
					{ticks.map((t, i) => (
						<div
							key={i}
							className="flex-1 text-[10px] text-slate-400 font-mono"
							style={{ textAlign: i === 0 ? "left" : i === ticks.length - 1 ? "right" : "center" }}
						>
							{new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
						</div>
					))}
				</div>

				{sorted.map((r) => {
					const start = r.started_at;
					const dur = Math.max(r.duration_s || 60, 30); // minimum 30s wide so the bar is visible
					const startPct = ((start - windowMin) / windowSpan) * 100;
					const widthPct = (dur / windowSpan) * 100;
					return (
						<div key={r.run_id} className="flex items-center gap-2 mb-1 group">
							<div className="w-48 text-xs text-slate-700 truncate pr-2" title={r.workflow_slug}>
								{r.workflow_slug}
							</div>
							<div className="flex-1 relative h-5 bg-slate-50 rounded-sm">
								<button
									onClick={() => onClick?.(r.run_id)}
									title={`${r.workflow_slug} · ${r.started_iso} · ${r.state}${r.duration_s ? ` · ${r.duration_s.toFixed(1)}s` : ""}`}
									className={[
										"absolute h-full rounded-sm hover:ring-2 hover:ring-slate-900/20 transition-all",
										STATE_BG[r.state] || "bg-slate-300",
										onClick ? "cursor-pointer" : "cursor-default",
									].join(" ")}
									style={{
										left: `${Math.max(0, Math.min(98, startPct))}%`,
										width: `${Math.max(1.5, Math.min(100 - startPct, widthPct))}%`,
									}}
								/>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export default AirflowGantt;
