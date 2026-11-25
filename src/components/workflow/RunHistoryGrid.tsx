// RunHistoryGrid — a workflow's runs as one cell each, oldest → newest
// (Novix's run grid, labelled): gold succeeded, brick failed, lagoon breathing
// while running, the open run outlined. Click a cell to open that run. The
// filterable list is one switch away (List).

import { Link } from "react-router-dom";
import type { RunRow } from "@/components/workflow/RunsMasterDetail";
import { runPath } from "@/lib/run-routes";
import { dirIdToSec, fmtDuration } from "@/lib/activity";
import { cn } from "@/lib/utils";

const when = (ts: string) => {
	const s = dirIdToSec(ts);
	return s ? new Date(s * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ts;
};

export default function RunHistoryGrid({ app, loop, cycles, selectedId, onList }: {
	app: string; loop: string; cycles: RunRow[]; selectedId: string | null; onList: () => void;
}) {
	const rows = [...cycles].reverse(); // oldest → newest, like reading a timeline
	const failed = cycles.filter((c) => c.ok === false).length;
	const first = rows[0] ? when(rows[0].ts).split(",")[0] : "";
	return (
		<section aria-label="Run history" className="rounded-xl border border-ink-200 bg-card px-3 py-2.5 space-y-2">
			<div className="flex items-baseline gap-2 flex-wrap">
				<h3 className="text-caption font-semibold text-ink-800">Runs</h3>
				<span className="text-micro text-ink-600 tabular-nums">
					{cycles.length} since {first}{failed ? ` · ${failed} failed` : ""}
				</span>
				<span className="ml-auto inline-flex items-center gap-3 text-micro text-ink-600">
					<span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-[2px] bg-gold-400" />succeeded</span>
					<span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-[2px] bg-brick-500" />failed</span>
					<button type="button" onClick={onList} className="text-ink-700 hover:text-ink-900 underline decoration-dotted">List</button>
				</span>
			</div>
			<div className="flex flex-wrap gap-[3px]" role="list">
				{rows.map((c) => {
					const sel = c.ts === selectedId;
					const state = c.running ? "running" : c.ok === false ? "failed" : c.ok ? "succeeded" : "unknown";
					return (
						<Link key={c.ts} role="listitem" to={runPath(app, loop, c.ts)}
							title={`${when(c.ts)} · ${state}${c.duration_s != null ? ` · ${fmtDuration(c.duration_s)}` : ""}`}
							aria-label={`Run ${when(c.ts)}, ${state}`} aria-current={sel ? "page" : undefined}
							className={cn("w-3.5 h-3.5 rounded-[3px] transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
								c.running ? "bg-lagoon-400 animate-lumen-breathe" : c.ok === false ? "bg-brick-500" : c.ok ? "bg-gold-400" : "bg-ink-200",
								sel && "ring-2 ring-ink-800 ring-offset-1")} />
					);
				})}
			</div>
		</section>
	);
}
