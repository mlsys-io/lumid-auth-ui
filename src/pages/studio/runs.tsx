// /studio/runs — "Activity": what needs you (the Inbox, merged in 2026-11-25),
// what's running, what's broken, how each workflow is doing grouped by app
// (components/activity/ActivityView), and what your apps said. It was
// a flat list of workflow names with the app as a grey subtitle — runs read as
// detached from the apps that own them (2026-11-24).
//
// ?days= (default 7) and ?app= (one app) are URL state. The four power views
// (List / Grid / Gantt / Calendar) stay behind "Timeline"; ?view=, ?state=,
// ?workflow=<app:loop>. The List names each run in words (the workflow's
// title, never its slug), with its app, and ticked rows open Compare.
//
// One feed for every view: /me/runs for the window, kept live by the
// /me/runs/stream SSE (useRunsFeed).

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, BarChart3, X } from "lucide-react";
import { me, type MeRunRow, type MeWorkflowRow } from "@/api/me";
import AirflowGrid, { type GridCell, type GridState } from "@/components/AirflowGrid";
import AirflowGantt from "@/components/AirflowGantt";
import AirflowCalendar from "@/components/AirflowCalendar";
import { appTitle } from "@/components/workflow/AppCard";
import { TONES } from "@/lib/tones";
import { runStatus, runStatusTitle, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib/runStatus";
import { runRowHref } from "@/lib/run-routes";
import { fmtDuration } from "@/lib/activity";
import { runRowName, runRowWhen, runRowDetail, appLabels, workflowTitles, workflowFilterOptions, compareSelection, RUN_STATE_FILTERS } from "@/lib/runs-list";
import { cn } from "@/lib/utils";
import { jobsSourceNotice } from "@/lib/data-jobs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyRuns } from "@/components/illustrations/scenes";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ActivityView } from "@/components/activity/ActivityView";
import { useRunsFeed, useOncePerSession } from "@/components/activity/hooks";
import { useInbox, NeedsYou, AppUpdates } from "@/pages/account/inbox";

type View = "index" | "list" | "grid" | "gantt" | "calendar";

// Where a run row opens — the run page (lib/run-routes.ts).
const runHref = runRowHref;

const VIEWS: View[] = ["index", "list", "grid", "gantt", "calendar"];
const DEFAULT_DAYS = 7;

export default function StudioRuns() {
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const setParam = (k: string, v: string | null) => {
		const sp = new URLSearchParams(params);
		if (v == null || v === "") sp.delete(k); else sp.set(k, v);
		setParams(sp, { replace: true });
	};
	// `?state=` (e.g. the rail's "+N more failed") asks for a run LIST, which
	// only the Timeline views render — open the list rather than ignore it.
	const view: View = (VIEWS as string[]).includes(params.get("view") || "") ? (params.get("view") as View) : params.get("state") ? "list" : "index";
	const setView = (v: View) => setParam("view", v === "index" ? null : v);
	const stateFilter = params.get("state") || "";
	const setStateFilter = (v: string) => setParam("state", v || null);
	const windowDays = Math.max(1, Math.min(30, parseInt(params.get("days") || String(DEFAULT_DAYS), 10) || DEFAULT_DAYS));
	const setWindowDays = (n: number) => setParam("days", n === DEFAULT_DAYS ? null : String(n));
	const appFilter = params.get("app") || "";
	const workflowFilter = params.get("workflow") || "";

	const { runs, err, asOf, reload, truncated, jobsSource } = useRunsFeed(windowDays, view === "index" ? "" : stateFilter, view === "index" ? "" : workflowFilter);
	// Workflow titles and the workflow filter's choices (Timeline only).
	const workflowRows = useWorkflowRows(view !== "index");
	const titles = useMemo(() => workflowTitles(workflowRows || []), [workflowRows]);
	const entrance = useOncePerSession("activity");
	const inbox = useInbox();
	// Old Inbox links land on their part of the page (#needs / #updates / #audit).
	const { hash } = useLocation();
	const inboxReady = !inbox.firstLoad;
	useEffect(() => {
		if (!hash || !inboxReady) return;
		const el = document.getElementById(hash.slice(1));
		if (el instanceof HTMLDetailsElement) el.open = true;
		el?.scrollIntoView({ block: "start" });
	}, [hash, inboxReady]);

	const windowControl = (
		<Segmented
			size="sm"
			aria-label="Time window"
			value={String(windowDays)}
			onChange={(v) => setWindowDays(Number(v))}
			options={[
				{ value: "1", label: "24h" },
				{ value: "7", label: "7d" },
				{ value: "14", label: "14d" },
				{ value: "30", label: "30d" },
			]}
		/>
	);

	if (view === "index") {
		return (
			<div className="max-w-[980px] mx-auto w-full">
				<PageHeader
					className="pt-2"
					title="Activity"
					subtitle="What needs you, what's running, what's broken, and what your apps said."
					actions={
						<>
							{windowControl}
							<Button variant="secondary" size="sm" onClick={() => setView("grid")} title="Every run on a timeline (grid, Gantt, calendar, table)">
								<BarChart3 className="w-3.5 h-3.5" /> Timeline
							</Button>
						</>
					}
				/>
				{appFilter && (
					<div className="mb-4 -mt-1">
						<button
							onClick={() => setParam("app", null)}
							className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-ink-200 bg-card text-meta text-ink-800 hover:bg-ink-50"
							title="Show every app"
						>
							Only {appTitle(appFilter)} <X className="w-3 h-3" aria-label="clear" />
						</button>
					</div>
				)}
				{jobsSourceNotice(jobsSource) && (
					<p role="status" className="mb-4 -mt-1 text-meta text-ink-600">{jobsSourceNotice(jobsSource)}</p>
				)}
				<div className="space-y-8">
				<NeedsYou inbox={inbox} app={appFilter || undefined} />
				{runs === null && !err ? (
					<div className="space-y-3" role="status" aria-label="Loading activity">
						{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
					</div>
				) : runs === null ? (
					<ErrorState error={new Error(err || "")} onRetry={reload} />
				) : runs.filter((r) => !appFilter || r.app === appFilter).length === 0 ? (
					<EmptyState
						art={<EmptyRuns />}
						title="Nothing ran in this window"
						body="Runs appear here as your workflows execute. Widen the window, or start one from an app."
					/>
				) : (
					<ActivityView runs={runs} app={appFilter || undefined} days={windowDays} entrance={entrance} asOf={asOf} truncated={truncated} />
				)}
				<AppUpdates inbox={inbox} app={appFilter || undefined} audit />
				</div>
			</div>
		);
	}

	// ── Timeline (power views) ──
	const shown = (runs || []).filter((r) => (!stateFilter || r.state === stateFilter) && (!appFilter || r.app === appFilter) && (!workflowFilter || r.workflow_slug === workflowFilter));
	const wfGroups = workflowFilterOptions(workflowRows || [], appFilter || undefined);
	return (
		<div className="max-w-[980px] mx-auto w-full space-y-4 px-1 py-2">
			<div className="flex items-center gap-2 flex-wrap">
				<Button variant="ghost" size="sm" onClick={() => setView("index")}>
					<ChevronLeft className="w-3.5 h-3.5" /> Back to Activity
				</Button>
				<Segmented
					size="sm"
					aria-label="Timeline view"
					value={view}
					onChange={(v) => setView(v as View)}
					options={[
						{ value: "list", label: "List" },
						{ value: "grid", label: "Grid" },
						{ value: "gantt", label: "Gantt" },
						{ value: "calendar", label: "Calendar" },
					]}
				/>
				<select aria-label="Run state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={SELECT}>
					{RUN_STATE_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
				</select>
				<select aria-label="Workflow" value={workflowFilter} onChange={(e) => setParam("workflow", e.target.value || null)} className={cn(SELECT, "max-w-[14rem]")}>
					<option value="">Every workflow</option>
					{/* A filter from a link, before the list has loaded (or for a workflow since removed). */}
					{workflowFilter && !wfGroups.some((g) => g.options.some((o) => o.value === workflowFilter)) && (
						<option value={workflowFilter}>{runRowName({ run_id: "", workflow_slug: workflowFilter, kind: "scheduled", name: "", state: "succeeded", started_at: 0 }, titles.get(workflowFilter))}</option>
					)}
					{wfGroups.map((g) => (
						<optgroup key={g.app} label={g.app ? appTitle(g.app) : "Other"}>
							{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
						</optgroup>
					))}
				</select>
				{windowControl}
				<div className="ml-auto text-caption tabular-nums text-ink-600">
					{/* At the 500-row cap the window holds more than is shown — say so. */}
					{shown.length} runs{truncated && runs?.length ? ` · the newest ${runs.length} in this window` : ""}
				</div>
			</div>

			{runs === null && err ? (
				<ErrorState error={new Error(err)} onRetry={reload} />
			) : runs === null ? (
				<div className="space-y-2" role="status" aria-label="Loading runs">
					{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
				</div>
			) : view === "list" ? (
				<RunsList runs={shown} titles={titles} onClick={(id) => navigate(runHref(id))} onCompare={(href) => navigate(href)} />
			) : view === "grid" ? (
				<RunsCrossGrid runs={shown} onCellClick={(id) => navigate(runHref(id))} />
			) : view === "gantt" ? (
				<AirflowGantt runs={shown} onClick={(id) => navigate(runHref(id))} />
			) : (
				<AirflowCalendar runs={shown} days={windowDays > 1 ? windowDays : 14} />
			)}
		</div>
	);
}

const SELECT = "h-8 rounded-lg border border-ink-200 bg-card px-2 text-caption text-ink-800 hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** The scheduled workflow rows (titles + the workflow filter), read once. */
function useWorkflowRows(enabled: boolean): MeWorkflowRow[] | null {
	const [rows, setRows] = useState<MeWorkflowRow[] | null>(null);
	useEffect(() => {
		if (!enabled || rows) return;
		let live = true;
		me.listWorkflows("scheduled").then((r) => { if (live) setRows(r.workflows || []); }).catch(() => { if (live) setRows([]); });
		return () => { live = false; };
	}, [enabled, rows]);
	return rows;
}

function RunsList({ runs, titles, onClick, onCompare }: {
	runs: MeRunRow[];
	titles: Map<string, string>;
	onClick: (runId: string) => void;
	onCompare: (href: string) => void;
}) {
	const [ticked, setTicked] = useState<string[]>([]);
	const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
	const tickedRows = ticked.map((id) => runs.find((r) => r.run_id === id)).filter((r): r is MeRunRow => !!r);
	const sel = compareSelection(tickedRows);
	const apps = useMemo(() => appLabels(runs.map((r) => r.app || ""), appTitle), [runs]);
	if (runs.length === 0) {
		return (
			<EmptyState
				art={<EmptyRuns />}
				title="No runs in this window"
				body="Runs appear here as your workflows execute. Widen the window, or start one from an app."
			/>
		);
	}
	return (
		<div className="space-y-3">
			<div className="rounded-xl border border-ink-200 bg-card overflow-x-auto shadow-sm">
				<table className="w-full text-caption table-fixed sm:table-auto">
					<thead className="bg-ink-50/60 border-b border-ink-200">
						<tr>
							<th scope="col" className="w-9 px-2 py-2.5"><span className="sr-only">Pick to compare</span></th>
							<th scope="col" className="text-left px-2 py-2.5 font-medium text-ink-700">Workflow</th>
							<th scope="col" className="hidden md:table-cell text-left px-3 py-2.5 font-medium text-ink-700">App</th>
							<th scope="col" className="w-[5.5rem] sm:w-auto text-left px-2 sm:px-3 py-2.5 font-medium text-ink-700">State</th>
							<th scope="col" className="hidden sm:table-cell text-left px-3 py-2.5 font-medium text-ink-700">Started</th>
							<th scope="col" className="hidden sm:table-cell text-left px-3 py-2.5 font-medium text-ink-700">Took</th>
							<th scope="col" className="hidden lg:table-cell text-left px-3 py-2.5 font-medium text-ink-700">Detail</th>
						</tr>
					</thead>
					<tbody>
						{runs.map((r) => {
							const name = runRowName(r, titles.get(r.workflow_slug));
							const when = runRowWhen(r.started_at);
							const detail = runRowDetail(r);
							const appName = r.app ? apps.get(r.app) ?? appTitle(r.app) : "";
							const on = ticked.includes(r.run_id);
							return (
								<tr
									key={r.run_id}
									onClick={() => onClick(r.run_id)}
									className={cn("border-b border-ink-100 last:border-b-0 hover:bg-ink-50/40 transition-colors cursor-pointer", on && "bg-lagoon-50/60")}
								>
									<td className="w-9 px-2 py-2" onClick={(e) => e.stopPropagation()}>
										<input type="checkbox" checked={on} onChange={() => toggle(r.run_id)}
											aria-label={`Pick ${name}, ${when}, to compare`}
											className="w-4 h-4 align-middle accent-ink-900 cursor-pointer" />
									</td>
									<td className="px-2 py-2 min-w-0">
										<span className="block font-medium text-ink-900 truncate" title={name}>{name}</span>
										{/* Small screens: the app and start time under the name. */}
										<span className="block md:hidden text-micro text-ink-600 truncate">
											{appName}<span className="sm:hidden">{appName && when ? " · " : ""}{when}</span>
										</span>
									</td>
									<td className="hidden md:table-cell px-3 py-2 text-ink-700 whitespace-nowrap">{appName}</td>
									<td className="px-2 sm:px-3 py-2"><StateChip state={r.state} /></td>
									<td className="hidden sm:table-cell px-3 py-2 text-ink-600 whitespace-nowrap tabular-nums">{when}</td>
									<td className="hidden sm:table-cell px-3 py-2 text-ink-600 whitespace-nowrap tabular-nums">{fmtDuration(r.duration_s)}</td>
									<td className="hidden lg:table-cell px-3 py-2 text-ink-600 max-w-[14rem]" title={detail}><span className="block truncate">{detail}</span></td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{ticked.length > 0 && (
				<div role="region" aria-label="Compare the picked runs"
					className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-ink-200 bg-card/95 backdrop-blur px-3 py-2 shadow-e2">
					<span className="text-caption text-ink-800">{ticked.length} picked</span>
					<Button size="sm" disabled={!sel.ok} onClick={() => sel.href && onCompare(sel.href)} title={sel.reason || undefined}>{sel.label}</Button>
					{!sel.ok && <span className="text-micro text-ink-600">{sel.reason}</span>}
					<Button size="sm" variant="ghost" className="ml-auto" onClick={() => setTicked([])}>Clear</Button>
				</div>
			)}
		</div>
	);
}

function RunsCrossGrid({ runs, onCellClick }: { runs: MeRunRow[]; onCellClick: (runId: string) => void }) {
	// Bucket into 24-hour columns; rows are unique workflow slugs.
	const workflows = useMemo(() => Array.from(new Set(runs.map((r) => r.workflow_slug))).sort(), [runs]);
	// Use ISO date+hour as the column key.
	const colKey = (r: MeRunRow) => {
		const d = new Date(r.started_at * 1000);
		return `${d.toISOString().slice(0, 10)}T${pad2(d.getUTCHours())}`;
	};
	const columns = useMemo(() => {
		const set = new Set(runs.map(colKey));
		return Array.from(set).sort();
	}, [runs]);
	const cells: Record<string, Record<string, GridCell>> = {};
	for (const w of workflows) cells[w] = {};
	for (const r of runs) {
		const col = colKey(r);
		// Keep latest run per (workflow, col); failures sticky.
		const existing = cells[r.workflow_slug][col];
		const cur: GridCell = { state: mapState(r.state), tooltip: `${r.started_iso} · ${r.state}` };
		if (!existing) {
			cells[r.workflow_slug][col] = cur;
		} else if (existing.state !== "failed" && cur.state === "failed") {
			cells[r.workflow_slug][col] = cur;
		}
		// Stash run id on the cell tooltip — quick navigation hack
		// (the AirflowGrid's onCellClick is keyed by row/col labels,
		// not the run id; we resolve it back via a side-channel below).
	}

	const lookup = useMemo(() => {
		// row+col → runId for the click handler.
		const m = new Map<string, string>();
		for (const r of runs) {
			m.set(`${r.workflow_slug}:::${colKey(r)}`, r.run_id);
		}
		return m;
	}, [runs]);

	return (
		<AirflowGrid
			rows={workflows}
			columns={columns}
			cells={cells}
			onCellClick={(row, col) => {
				const id = lookup.get(`${row}:::${col}`);
				if (id) onCellClick(id);
			}}
			emptyText="No runs in the window."
		/>
	);
}

function StateChip({ state }: { state: string }) {
	const st = runStatus(state);
	const t = TONES[RUN_STATUS_TONE[st.status]];
	return (
		<span title={runStatusTitle(st)} className={["text-nano px-2 py-0.5 rounded-full border font-medium", t.bg, t.text, t.border].join(" ")}>
			{RUN_STATUS_LABEL[st.status].toLowerCase()}
		</span>
	);
}

function mapState(s: string): GridState {
	switch (s) {
		case "succeeded": return "succeeded";
		case "failed":    return "failed";
		case "running":   return "running";
		case "skipped":   return "skipped";
		case "canceled":  return "canceled";
		default:          return "empty";
	}
}

function pad2(n: number) { return n.toString().padStart(2, "0"); }
