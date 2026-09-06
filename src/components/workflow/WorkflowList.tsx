// WorkflowList — the master column of the workflows master–detail page.
//
// A row says what the loop IS, not just that it exists: name, what it is
// scored on (metric), what it is scored over (dataset), and when it last ran.
// Failing workflows sort (and badge) first so problems surface without
// scrolling. Sparklines stay display-only here (the detail card has the
// interactive one) — 12 hover-portal sources in a dense list is noise.
//
// Two things this list learned the hard way (review 2026-09-06):
//
//   * SCHEDULED PLUMBING DOES NOT LEAD. quant-research declares ten loops, six
//     of which are internal verbs (harvest_outbox, two universe refreshes,
//     send_engine_config, send_strategy_disable). Sorted by recency they took
//     the top of the list and `backtest` — the thing a researcher opens the app
//     for — sat fourth. Cron-scheduled loops with no metric now collapse under
//     a count, the way the design always said they should.
//   * AN EMPTY COLUMN IS WORSE THAN NO COLUMN. Every row rendered a trailing
//     em dash (an empty sparkline placeholder), which is the exact
//     unbound-binding-renders-as-"—" pattern this surface was rebuilt to kill.
//     A row with no runs now says nothing there.

import { useState } from "react";
import { type MeWorkflowRow } from "@/api/me";
import RunSparkline from "@/components/RunSparkline";
import { loopLabel } from "@/lib/workflow-names";
import { describeSchedule, parseSchedule } from "@/lib/schedule";
import { TONES, workflowTone } from "@/lib/tones";
import { cn } from "@/lib/utils";

export type WfListRow = { loop: string; wf: MeWorkflowRow };

function dotOf(wf: MeWorkflowRow): string {
	const tone = workflowTone(wf);
	return cn(TONES[tone].dot, tone === "running" && "running-pulse");
}

// A loop is "measured" when it declares a metric — that is what makes it an
// experiment rather than a plain workflow, and what earns it a first-class row.
const isMeasured = (wf: MeWorkflowRow) => !!wf.metric;

// Plumbing = runs itself on a cron AND is not measured. On-demand loops are
// always user-facing (someone has to trigger them), so they never collapse.
export function isPlumbing(wf: MeWorkflowRow): boolean {
	if (isMeasured(wf)) return false;
	const kind = parseSchedule(wf.trigger).kind;
	return kind !== "trigger";
}

// needs-attention → measured → running → recent first → paused last.
export function sortWorkflowRows(rows: WfListRow[]): WfListRow[] {
	const group = (r: WfListRow) =>
		r.wf.enabled === false ? 4
		: r.wf.last_run_ok === false ? 0
		: r.wf.running ? 1
		: isMeasured(r.wf) ? 2
		: 3;
	return [...rows].sort((a, b) => {
		const g = group(a) - group(b);
		if (g !== 0) return g;
		return (b.wf.last_run_ts || 0) - (a.wf.last_run_ts || 0);
	});
}

function relTime(ts?: number): string {
	if (!ts) return "";
	const s = Math.max(0, Date.now() / 1000 - ts);
	if (s < 90) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
}

function Row({ loop, wf, active, onSelect }: WfListRow & { active: boolean; onSelect: (l: string) => void }) {
	return (
		<li>
			<button
				type="button"
				onClick={() => onSelect(loop)}
				className={cn(
					"w-full text-left rounded-lg border px-2.5 py-2 transition-colors",
					active ? "border-gold-300 bg-gold-50/50" : "border-slate-200 bg-white hover:bg-slate-50",
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
					{/* Only render the sparkline when there ARE runs — an empty one
					    drew a dash that read as a broken metric binding. */}
					{wf.run_spark ? (
						<RunSparkline spec={wf.run_spark} className="hidden xl:flex flex-shrink-0" />
					) : null}
				</div>
				<div className="text-[10.5px] text-slate-400 mt-0.5 pl-4 truncate">
					{describeSchedule(wf.trigger)}
					{wf.enabled === false ? " · paused" : ""}
					{wf.running ? " · running…" : ""}
					{wf.last_run_ts ? ` · ${relTime(wf.last_run_ts)}` : ""}
				</div>
				{/* The measurement line — what it is scored on, over which subject
				    set. Absent entirely for a plain workflow, so "no metric" reads
				    as "this isn't an experiment", not as missing data. */}
				{(wf.metric || wf.dataset_id) && (
					<div className="mt-1 pl-4 flex items-center gap-1.5 flex-wrap">
						{wf.metric && (
							<span className="text-[9.5px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded px-1.5 py-px">
								{wf.metric}
							</span>
						)}
						{wf.dataset_id && (
							<span className="text-[9.5px] font-mono text-slate-500 bg-white border border-slate-200 rounded px-1.5 py-px truncate max-w-[60%]">
								{wf.dataset_id}
							</span>
						)}
					</div>
				)}
			</button>
		</li>
	);
}

export default function WorkflowList({ rows, selected, onSelect }: {
	rows: WfListRow[];
	selected: string | null;
	onSelect: (loop: string) => void;
}) {
	const [showPlumbing, setShowPlumbing] = useState(false);
	const primary = sortWorkflowRows(rows.filter((r) => !isPlumbing(r.wf)));
	const plumbing = sortWorkflowRows(rows.filter((r) => isPlumbing(r.wf)));
	// A selected plumbing row must stay visible — collapsing the thing the user
	// just opened would look like it vanished.
	const selectedIsPlumbing = plumbing.some((r) => r.loop === selected);
	const plumbingOpen = showPlumbing || selectedIsPlumbing;
	return (
		<div className="space-y-1.5">
			{/* No "N need attention" header — each failing row already shows a
			    "failed" badge, so the count was redundant. */}
			<ul className="space-y-1">
				{primary.map(({ loop, wf }) => (
					<Row key={loop} loop={loop} wf={wf} active={selected === loop} onSelect={onSelect} />
				))}
			</ul>
			{plumbing.length > 0 && (
				<div className="pt-0.5">
					<button
						type="button"
						onClick={() => setShowPlumbing((v) => !v)}
						className="w-full text-left text-[10.5px] text-slate-400 hover:text-slate-600 px-2.5 py-1 rounded-lg hover:bg-slate-50 transition-colors"
					>
						{plumbingOpen ? "▾" : "▸"} {plumbing.length} scheduled ·{" "}
						{plumbing.slice(0, 3).map(({ loop, wf }) => loopLabel(wf.name, loop)).join(", ")}
						{plumbing.length > 3 ? "…" : ""}
					</button>
					{plumbingOpen && (
						<ul className="space-y-1 mt-1">
							{plumbing.map(({ loop, wf }) => (
								<Row key={loop} loop={loop} wf={wf} active={selected === loop} onSelect={onSelect} />
							))}
						</ul>
					)}
				</div>
			)}
		</div>
	);
}
