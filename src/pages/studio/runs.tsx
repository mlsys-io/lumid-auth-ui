// /studio/runs — the unified runs surface (W1). Titled "Runs" (it said "Jobs"
// while the breadcrumb said "Activity" — one page, three names).
//
// A row opens THE RUN (its page, /studio/apps/:app/w/:loop/r/:runId, for a
// scheduled cycle; /studio/runs/:run_id for anything else). Asking the chat
// about it is the secondary button. ?state=, ?view= and ?days= are in the URL.
//
// Views via top toggle:
//   Index     — the list (default).
//   List      — Prefect-style table.
//   Grid      — cross-workflow Airflow grid.
//   Gantt     — per-run time bars (good for "stuck" detection).
//   Calendar  — heatmap of day × hour.
//
// SSE stream (/me/runs/stream) pushes state transitions live; the
// page subscribes on mount and updates the rows in place.

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Filter, RefreshCw, ChevronLeft, BarChart3 } from "lucide-react";
import { me, streamRuns, MeApiError, type MeRunRow } from "@/api/me";
import AirflowGrid, { type GridCell, type GridState } from "@/components/AirflowGrid";
import AirflowGantt from "@/components/AirflowGantt";
import AirflowCalendar from "@/components/AirflowCalendar";
import IndexList, { type IndexRow } from "@/components/studio/IndexList";
import { askRun } from "@/lib/grounded-asks";
import { appTitle } from "@/components/workflow/AppCard";
import { loopLabel } from "@/lib/workflow-names";
import { TONES } from "@/lib/tones";
import { runStatus, runStatusTitle, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib/runStatus";
import { runRowHref } from "@/lib/run-routes";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { EmptyRuns } from "@/components/illustrations/scenes";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";

// "index" is the default claude-style list (→ chat); the other four are the
// power "Timeline" views kept as an escape hatch behind the toggle.
type View = "index" | "list" | "grid" | "gantt" | "calendar";

function loopOfRun(r: MeRunRow): string | undefined {
	if (r.app && r.workflow_slug?.startsWith(r.app + ":")) return r.workflow_slug.slice(r.app.length + 1);
	const i = r.workflow_slug?.indexOf(":") ?? -1;
	return i >= 0 ? r.workflow_slug.slice(i + 1) : r.workflow_slug;
}

function relSec(tsSec?: number): string {
	if (!tsSec) return "";
	const diff = Date.now() / 1000 - tsSec;
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

// Where a run row opens — the run page (lib/run-routes.ts).
const runHref = runRowHref;

const VIEWS: View[] = ["index", "list", "grid", "gantt", "calendar"];

export default function StudioRuns() {
	const navigate = useNavigate();
	// View, state filter and window are URL state (?view=&state=&days=), so a
	// filtered list is a link and survives a reload. ?state=failed is also what
	// the attention rail's "+N more" links to.
	const [params, setParams] = useSearchParams();
	const setParam = (k: string, v: string | null) => {
		const sp = new URLSearchParams(params);
		if (v == null || v === "") sp.delete(k); else sp.set(k, v);
		setParams(sp, { replace: true });
	};
	const view: View = (VIEWS as string[]).includes(params.get("view") || "") ? (params.get("view") as View) : "index";
	const setView = (v: View) => setParam("view", v === "index" ? null : v);
	const stateFilter = params.get("state") || "";
	const setStateFilter = (v: string) => setParam("state", v || null);
	const windowDays = Math.max(1, Math.min(30, parseInt(params.get("days") || "1", 10) || 1));
	const setWindowDays = (n: number) => setParam("days", n === 1 ? null : String(n));
	const [runs, setRuns] = useState<MeRunRow[] | null>(null);
	const [err, setErr] = useState<string | null>(null);

	const load = async () => {
		try {
			const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
			const r = await me.listRuns({ state: stateFilter || undefined, since, limit: 500 });
			setRuns(r.runs);
		} catch (e) {
			setErr(e instanceof MeApiError ? e.message : String(e));
		}
	};
	useEffect(() => { load(); }, [stateFilter, windowDays]);
	// Chat→page bus: a run fired from chat shows up before the SSE/poll tick.
	useStudioRefetch(["runs", "cycles"], load);

	// SSE — live state transitions. Update the local rows array in
	// place so the user sees workflows light up in real time.
	useEffect(() => {
		const stop = streamRuns(
			(evt) => {
				setRuns((prev) => {
					if (!prev) return [evt.run];
					const idx = prev.findIndex((r) => r.run_id === evt.run.run_id);
					if (idx === -1) return [evt.run, ...prev].slice(0, 500);
					const next = [...prev];
					next[idx] = evt.run;
					return next;
				});
			},
			(e) => console.warn("runs stream error:", e),
		);
		return () => stop();
	}, []);

	if (err) return <div className="text-brick-700 text-sm">{err}</div>;

	// ── Default: the claude-style index. Each run row opens the grounded
	//    chat (askRun); the old per-run inspector / app cycle panel stays a
	//    click away via "details →" (runHref). The Timeline button reveals
	//    the cross-run power views (grid / gantt / calendar / table). ──
	if (view === "index") {
		const INDEX_CAP = 50;
		const shown = (runs || []).slice(0, INDEX_CAP);
		const rows: IndexRow[] = shown.map((r) => {
			const loop = loopOfRun(r);
			const st = runStatus(r.state);
			return {
				id: r.run_id,
				title: loopLabel(r.name, loop || r.workflow_slug),
				tone: RUN_STATUS_TONE[st.status],
				statusLabel: RUN_STATUS_LABEL[st.status].toLowerCase() + (st.recovered ? " · recovered" : ""),
				statusTitle: runStatusTitle(st),
				meta: [r.app ? appTitle(r.app) : "", relSec(r.started_at), r.duration_s ? `${r.duration_s.toFixed(1)}s` : ""]
					.filter(Boolean).join(" · "),
				ask: askRun({ run_id: r.run_id, app: r.app, loop, name: r.name, workflow_slug: r.workflow_slug }),
				// The row opens the RUN; asking about it is the secondary button.
				navTo: runHref(r.run_id),
				askVisible: true,
			} as IndexRow;
		});
		// Lumen: the filters are Segmented controls (they NARROW one list);
		// Refresh + Timeline are quiet buttons on the right.
		const toolbar = (
			<div className="flex flex-wrap items-center gap-2">
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
						{ value: "skipped", label: "Skipped" },
					]}
				/>
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
				<span className="ml-auto inline-flex items-center gap-1.5">
					<Button variant="ghost" size="sm" onClick={load} title="Refresh">
						<RefreshCw className="w-3.5 h-3.5" /> Refresh
					</Button>
					<Button variant="secondary" size="sm" onClick={() => setView("grid")} title="Cross-run timeline views (grid / gantt / calendar)">
						<BarChart3 className="w-3.5 h-3.5" /> Timeline
					</Button>
				</span>
			</div>
		);
		return (
			<IndexList
				title="Runs"
				rows={rows}
				search={rows.length > 6}
				searchPlaceholder="Search runs…"
				toolbar={toolbar}
				loading={runs === null && !err}
				error={runs === null && err ? new Error(err) : undefined}
				onRetry={load}
				emptyArt={<EmptyRuns />}
				emptyTitle="No runs in this window"
				empty="Runs appear here as your workflows execute. Widen the window, or start one from an app."
				footer={(runs?.length || 0) > INDEX_CAP
					? <div className="text-caption text-muted-foreground text-center">Showing {INDEX_CAP} of {runs?.length}. Open <button className="underline" onClick={() => setView("grid")}>Timeline</button> for all.</div>
					: undefined}
			/>
		);
	}

	// ── Timeline (escape hatch): the original 4 power views. ──
	return (
		<div className="max-w-[980px] mx-auto w-full space-y-4 px-1 py-2">
			<div className="flex items-center gap-2 flex-wrap">
				<Button variant="ghost" size="sm" onClick={() => setView("index")}>
					<ChevronLeft className="w-3.5 h-3.5" /> Back to list
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

				<div className="ml-auto text-caption tabular-nums text-ink-600">
					{runs?.length ?? 0} runs
				</div>
			</div>

			{runs === null ? (
				<div className="space-y-2" role="status" aria-label="Loading runs">
					{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
				</div>
			) : view === "list" ? (
				<RunsList runs={runs} onClick={(id) => navigate(runHref(id))} />
			) : view === "grid" ? (
				<RunsCrossGrid runs={runs} onCellClick={(id) => navigate(runHref(id))} />
			) : view === "gantt" ? (
				<AirflowGantt runs={runs} onClick={(id) => navigate(runHref(id))} />
			) : (
				<AirflowCalendar runs={runs} days={windowDays > 1 ? windowDays : 14} />
			)}
		</div>
	);
}

function ViewTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
	return (
		<button
			onClick={onClick}
			className={[
				"px-3 py-1 rounded-full text-xs transition-colors",
				active
					? "bg-ink-900 text-white"
					: "bg-card border border-ink-200 text-ink-700 hover:bg-ink-50",
			].join(" ")}
		>
			{label}
		</button>
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
