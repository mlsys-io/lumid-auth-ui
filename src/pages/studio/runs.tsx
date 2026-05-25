// /studio/runs — the unified runs surface (W1).
//
// Four views via top toggle:
//   List      — Prefect-style table (default).
//   Grid      — cross-workflow Airflow grid.
//   Gantt     — per-run time bars (good for "stuck" detection).
//   Calendar  — heatmap of day × hour.
//
// SSE stream (/me/runs/stream) pushes state transitions live; the
// page subscribes on mount and updates the rows in place.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Filter, RefreshCw } from "lucide-react";
import { me, streamRuns, MeApiError, type MeRunRow } from "@/api/me";
import AirflowGrid, { type GridCell, type GridState } from "@/components/AirflowGrid";
import AirflowGantt from "@/components/AirflowGantt";
import AirflowCalendar from "@/components/AirflowCalendar";
import PageHints from "@/components/PageHints";

type View = "list" | "grid" | "gantt" | "calendar";

export default function StudioRuns() {
	const navigate = useNavigate();
	const [view, setView] = useState<View>("list");
	const [stateFilter, setStateFilter] = useState<string>("");
	const [windowDays, setWindowDays] = useState<number>(1);
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

	if (err) return <div className="text-rose-700 text-sm">{err}</div>;

	return (
		<div className="space-y-4">
			{/* Page identity in StudioShell top-bar. */}
			<header className="flex items-center justify-end">
				<button
					onClick={load}
					className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border border-slate-200 hover:bg-slate-50 text-slate-700"
				>
					<RefreshCw className="w-3 h-3" /> Refresh
				</button>
			</header>

			<PageHints prompts={[
				"what failed today?",
				"what's running right now?",
				"how did my morning brief do this week?",
			]} />

			<div className="flex items-center gap-2 flex-wrap">
				<ViewTab active={view === "list"}     onClick={() => setView("list")}     label="List" />
				<ViewTab active={view === "grid"}     onClick={() => setView("grid")}     label="Grid" />
				<ViewTab active={view === "gantt"}    onClick={() => setView("gantt")}    label="Gantt" />
				<ViewTab active={view === "calendar"} onClick={() => setView("calendar")} label="Calendar" />

				<div className="ml-3 flex items-center gap-1 text-xs text-slate-500">
					<Filter className="w-3 h-3" />
					<select
						value={stateFilter}
						onChange={(e) => setStateFilter(e.target.value)}
						className="text-xs bg-transparent border-0 focus:outline-none cursor-pointer"
					>
						<option value="">All states</option>
						<option value="succeeded">Succeeded</option>
						<option value="failed">Failed</option>
						<option value="running">Running</option>
						<option value="skipped">Skipped</option>
					</select>
					<select
						value={windowDays}
						onChange={(e) => setWindowDays(Number(e.target.value))}
						className="text-xs bg-transparent border-0 focus:outline-none cursor-pointer ml-1"
					>
						<option value={1}>Last 24h</option>
						<option value={7}>Last 7 days</option>
						<option value={14}>Last 14 days</option>
						<option value={30}>Last 30 days</option>
					</select>
				</div>

				<div className="ml-auto text-xs text-slate-500">
					{runs?.length ?? 0} runs
				</div>
			</div>

			{runs === null ? (
				<div className="text-sm text-slate-500 italic py-4">Loading…</div>
			) : view === "list" ? (
				<RunsList runs={runs} onClick={(id) => navigate(`/studio/runs/${encodeURIComponent(id)}`)} />
			) : view === "grid" ? (
				<RunsCrossGrid runs={runs} onCellClick={(id) => navigate(`/studio/runs/${encodeURIComponent(id)}`)} />
			) : view === "gantt" ? (
				<AirflowGantt runs={runs} onClick={(id) => navigate(`/studio/runs/${encodeURIComponent(id)}`)} />
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
					? "bg-gray-900 text-white"
					: "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
			].join(" ")}
		>
			{label}
		</button>
	);
}

function RunsList({ runs, onClick }: { runs: MeRunRow[]; onClick: (runId: string) => void }) {
	if (runs.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
				No runs in the selected window.
			</div>
		);
	}
	return (
		<div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
			<table className="min-w-full text-sm">
				<thead className="bg-slate-50/60 border-b border-slate-200">
					<tr>
						<th className="text-left px-4 py-2.5 font-semibold text-slate-700">Workflow</th>
						<th className="text-left px-3 py-2.5 font-semibold text-slate-700">State</th>
						<th className="text-left px-3 py-2.5 font-semibold text-slate-700">Started</th>
						<th className="text-left px-3 py-2.5 font-semibold text-slate-700">Duration</th>
						<th className="text-left px-3 py-2.5 font-semibold text-slate-700">Detail</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((r) => (
						<tr
							key={r.run_id}
							onClick={() => onClick(r.run_id)}
							className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40 transition-colors cursor-pointer"
						>
							<td className="px-4 py-2 font-medium text-slate-800">{r.workflow_slug}</td>
							<td className="px-3 py-2"><StateChip state={r.state} /></td>
							<td className="px-3 py-2 text-xs text-slate-600 font-mono">
								{new Date(r.started_at * 1000).toLocaleString(undefined, {
									month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
								})}
							</td>
							<td className="px-3 py-2 text-xs text-slate-600">
								{r.duration_s ? `${r.duration_s.toFixed(1)}s` : "—"}
							</td>
							<td className="px-3 py-2 text-xs text-slate-600 truncate max-w-md">
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
	const cfg: Record<string, { label: string; className: string }> = {
		succeeded: { label: "succeeded", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
		failed:    { label: "failed",    className: "bg-rose-50 text-rose-800 border-rose-200" },
		running:   { label: "running",   className: "bg-amber-50 text-amber-800 border-amber-200" },
		skipped:   { label: "skipped",   className: "bg-slate-50 text-slate-600 border-slate-200" },
		canceled:  { label: "canceled",  className: "bg-slate-50 text-slate-600 border-slate-200" },
	};
	const c = cfg[state] || { label: state, className: "bg-slate-100 text-slate-700 border-slate-200" };
	return (
		<span className={["text-[10px] px-2 py-0.5 rounded-full border font-medium", c.className].join(" ")}>
			{c.label}
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
