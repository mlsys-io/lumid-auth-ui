// WorkflowList — the master column of the workflows master–detail page.
// Compact rows: status dot, humanized name, English schedule. Failing
// workflows sort (and badge) first so problems surface without scrolling.
// Sparklines stay display-only here (the detail card has the interactive
// one) — 12 hover-portal sources in a dense list is noise.

import { type MeWorkflowRow } from "@/api/me";
import RunSparkline from "@/components/RunSparkline";
import { loopLabel } from "@/lib/workflow-names";
import { describeSchedule } from "@/lib/schedule";
import { TONES, workflowTone } from "@/lib/tones";
import { cn } from "@/lib/utils";

export type WfListRow = { loop: string; wf: MeWorkflowRow };

function dotOf(wf: MeWorkflowRow): string {
	const tone = workflowTone(wf);
	return cn(TONES[tone].dot, tone === "running" && "running-pulse");
}

// needs-attention → running → recent first → paused last; stable in groups.
export function sortWorkflowRows(rows: WfListRow[]): WfListRow[] {
	const group = (r: WfListRow) =>
		r.wf.enabled === false ? 3
		: r.wf.last_run_ok === false ? 0
		: r.wf.running ? 1
		: 2;
	return [...rows].sort((a, b) => {
		const g = group(a) - group(b);
		if (g !== 0) return g;
		return (b.wf.last_run_ts || 0) - (a.wf.last_run_ts || 0);
	});
}

export default function WorkflowList({ rows, selected, onSelect }: {
	rows: WfListRow[];
	selected: string | null;
	onSelect: (loop: string) => void;
}) {
	const sorted = sortWorkflowRows(rows);
	const failing = rows.filter((r) => r.wf.last_run_ok === false && r.wf.enabled !== false).length;
	return (
		<div className="space-y-1.5">
			{failing > 0 && (
				<div className="text-[11px] font-medium text-rose-600 px-1">
					{failing} need{failing === 1 ? "s" : ""} attention
				</div>
			)}
			<ul className="space-y-1">
				{sorted.map(({ loop, wf }) => {
					const active = selected === loop;
					return (
						<li key={loop}>
							<button
								type="button"
								onClick={() => onSelect(loop)}
								className={cn(
									"w-full text-left rounded-lg border px-2.5 py-2 transition-colors",
									active
										? "border-amber-300 bg-amber-50/50"
										: "border-slate-200 bg-white hover:bg-slate-50",
								)}
							>
								<div className="flex items-center gap-2 min-w-0">
									<span className={cn("w-2 h-2 rounded-full flex-shrink-0", dotOf(wf))} />
									<span className="text-[12.5px] font-medium text-slate-800 truncate flex-1">
										{loopLabel(wf.name, loop)}
									</span>
									{wf.last_run_ok === false && wf.enabled !== false && (
										<span className="text-[9px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-1.5 flex-shrink-0">failed</span>
									)}
									<RunSparkline spec={wf.run_spark || ""} className="hidden xl:flex flex-shrink-0" />
								</div>
								<div className="text-[10.5px] text-slate-400 mt-0.5 pl-4 truncate">
									{describeSchedule(wf.trigger)}{wf.enabled === false ? " · paused" : ""}{wf.running ? " · running…" : ""}
								</div>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
