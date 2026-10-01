// Your runs — the jobs YOU ran on the fleet, from any surface (the workflow
// editor's Run, the Run dialog here, job_run from chat or the SDK).
//
// Read from identity's own records (api/fleet.ts), not fanned out across
// sites: one site's task list alone has measured 13.8 MB. Statuses are the last
// ones seen; a job that is still going is refreshed while this view is open.

import { useCallback, useEffect, useState } from "react";
import { failedSteps, fleet, type FleetJob, type FleetJobResult, type FleetStatus } from "../../api/fleet";

const TONE: Record<FleetStatus, string> = {
	queued: "bg-slate-100 text-slate-600",
	running: "bg-indigo-50 text-indigo-700",
	succeeded: "bg-emerald-50 text-emerald-700",
	failed: "bg-rose-50 text-rose-700",
	canceled: "bg-slate-100 text-slate-500",
};

export default function MyRuns() {
	const [jobs, setJobs] = useState<FleetJob[] | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [open, setOpen] = useState<{ id: string; result?: FleetJobResult; error?: string } | null>(null);

	const load = useCallback(async () => {
		try {
			const { jobs } = await fleet.list({ limit: 100 });
			// Refresh the ones still going, so a finished job does not keep
			// reading "running" until someone opens it.
			const fresh = await Promise.all(
				jobs.map(async (j) => {
					if (j.terminal) return j;
					try {
						const s = await fleet.status(j.id);
						return { ...j, status: s.status, terminal: s.terminal };
					} catch {
						return j;
					}
				}),
			);
			setJobs(fresh);
			setProblem(null);
		} catch (e) {
			setProblem((e as Error)?.message || "could not load your runs");
		}
	}, []);

	useEffect(() => {
		void load();
		const t = setInterval(() => void load(), 15_000);
		return () => clearInterval(t);
	}, [load]);

	const showResult = async (id: string) => {
		setOpen({ id });
		try {
			setOpen({ id, result: await fleet.result(id) });
		} catch (e) {
			setOpen({ id, error: (e as Error)?.message || "no result" });
		}
	};

	if (problem) return <p className="text-xs text-rose-600">{problem}</p>;
	if (!jobs) return <p className="text-xs text-slate-500">Loading your runs…</p>;
	if (jobs.length === 0) {
		return (
			<p className="text-xs text-slate-500">
				No runs yet. Run a compute graph from the workflow editor, or with{" "}
				<code>job_run</code> from chat.
			</p>
		);
	}
	return (
		<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
			<table className="w-full text-xs">
				<thead className="bg-slate-50 text-left text-slate-500">
					<tr>
						<th className="px-3 py-2">Job</th>
						<th className="px-3 py-2">Status</th>
						<th className="px-3 py-2">Study · experiment</th>
						<th className="px-3 py-2">Started</th>
						<th className="px-3 py-2" />
					</tr>
				</thead>
				<tbody>
					{jobs.map((j) => (
						<tr key={j.id} className="border-t border-slate-100 align-top">
							<td className="px-3 py-2">
								<div className="font-mono text-slate-800">{j.id}</div>
								{j.name && <div className="text-slate-500">{j.name}</div>}
							</td>
							<td className="px-3 py-2">
								<span className={`rounded px-1.5 py-0.5 ${TONE[j.status]}`}>{j.status}</span>
							</td>
							<td className="px-3 py-2 text-slate-600">
								{[j.labels?.study, j.labels?.experiment].filter(Boolean).join(" · ") || "—"}
							</td>
							<td className="px-3 py-2 text-slate-500">
								{j.created_at ? new Date(j.created_at).toLocaleString() : "—"}
							</td>
							<td className="px-3 py-2 text-right whitespace-nowrap">
								{/* A failed run has a result too: which step failed, and why. */}
								{(j.status === "succeeded" || j.status === "failed") && (
									<button className="text-indigo-600 hover:underline" onClick={() => void showResult(j.id)}>
										Result
									</button>
								)}
								{!j.terminal && (
									<button
										className="ml-2 text-slate-500 hover:text-slate-800"
										onClick={() => void fleet.cancel(j.id).then(load)}
									>
										Cancel
									</button>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{open && (
				<div className="border-t border-slate-200 bg-slate-50 p-3">
					<div className="mb-1 flex justify-between text-[11px] text-slate-500">
						<span className="font-mono">{open.id}</span>
						<button onClick={() => setOpen(null)} className="hover:text-slate-800">Close</button>
					</div>
					{open.error ? (
						<p className="text-rose-600">{open.error}</p>
					) : !open.result ? (
						<p className="text-slate-500">Loading…</p>
					) : (
						<>
							{failedSteps(open.result.outputs).map((o) => (
								<p key={o.task_id ?? o.name} className="mb-1 whitespace-pre-wrap font-mono text-[11px] text-rose-700">
									{o.name ? `${o.name} failed: ` : "Failed: "}
									{o.error}
								</p>
							))}
							{Object.keys(open.result.metrics ?? {}).length > 0 && (
								<p className="mb-1 text-slate-700">
									Metrics:{" "}
									{Object.entries(open.result.metrics).map(([k, v]) => `${k} = ${v}`).join(", ")}
								</p>
							)}
							<pre className="max-h-72 overflow-auto rounded bg-white p-2 text-[11px]">
								{JSON.stringify(open.result.outputs, null, 2)}
							</pre>
						</>
					)}
				</div>
			)}
		</div>
	);
}
