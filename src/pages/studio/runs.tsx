// /studio/runs — "Activity": what needs you (the Inbox, merged in 2026-11-25),
// what's running, what's broken, how each workflow is doing grouped by app
// (components/activity/ActivityView), and what your apps said. It was
// a flat list of workflow names with the app as a grey subtitle — runs read as
// detached from the apps that own them (2026-11-24).
//
// ?days= (default 7) and ?app= (one app) are URL state. The four power views
// (List / Grid / Gantt / Calendar) stay behind "Timeline"; ?view=, ?state=.
//
// One feed for every view: /me/runs for the window, kept live by the
// /me/runs/stream SSE (useRunsFeed).

import { useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, BarChart3, X } from "lucide-react";
import type { MeRunRow } from "@/api/me";
import AirflowGrid, { type GridCell, type GridState } from "@/components/AirflowGrid";
import AirflowGantt from "@/components/AirflowGantt";
import AirflowCalendar from "@/components/AirflowCalendar";
import { appTitle } from "@/components/workflow/AppCard";
import { TONES } from "@/lib/tones";
import { runStatus, runStatusTitle, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib/runStatus";
import { runRowHref } from "@/lib/run-routes";
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

	const { runs, err, asOf, reload, truncated, jobsSource } = useRunsFeed(windowDays, view === "index" ? "" : stateFilter);
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
	const shown = (runs || []).filter((r) => (!stateFilter || r.state === stateFilter) && (!appFilter || r.app === appFilter));
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
				<Segmented
					size="sm"
					aria-label="Run state"
					value={stateFilter || "all"}
					onChange={(v) => setStateFilter(v === "all" ? "" : v)}
					options={[
						{ value: "all", label: "All" },
						{ value: "succeeded", label: "Succeeded" },
						{ value: "failed", label: "Failed" },
						{ value: "running", label: "Running" },
					]}
				/>
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
				<RunsList runs={shown} onClick={(id) => navigate(runHref(id))} />
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

function RunsList({ runs, onClick }: { runs: MeRunRow[]; onClick: (runId: string) => void }) {
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
		<div className="rounded-xl border border-ink-200 bg-card overflow-hidden shadow-sm">
			<table className="min-w-full text-sm">
				<thead className="bg-ink-50/60 border-b border-ink-200">
					<tr>
						<th className="text-left px-4 py-2.5 font-medium text-ink-700">Workflow</th>
						<th className="text-left px-3 py-2.5 font-medium text-ink-700">State</th>
						<th className="text-left px-3 py-2.5 font-medium text-ink-700">Started</th>
						<th className="text-left px-3 py-2.5 font-medium text-ink-700">Duration</th>
						<th className="text-left px-3 py-2.5 font-medium text-ink-700">Detail</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((r) => (
						<tr
							key={r.run_id}
							onClick={() => onClick(r.run_id)}
							className="border-b border-ink-100 last:border-b-0 hover:bg-ink-50/40 transition-colors cursor-pointer"
						>
							<td className="px-4 py-2 font-medium text-ink-800">{r.workflow_slug}</td>
							<td className="px-3 py-2"><StateChip state={r.state} /></td>
							<td className="px-3 py-2 text-xs text-ink-600 font-mono">
								{new Date(r.started_at * 1000).toLocaleString(undefined, {
									month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
								})}
							</td>
							<td className="px-3 py-2 text-xs text-ink-600">
								{r.duration_s ? `${r.duration_s.toFixed(1)}s` : "—"}
							</td>
							<td className="px-3 py-2 text-xs text-ink-600 truncate max-w-md">
								{r.reason || "—"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
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
