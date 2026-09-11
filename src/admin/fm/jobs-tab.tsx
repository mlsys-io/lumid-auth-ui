// Jobs — workflows fanned out across every site, with per-site task drill-in.
//
// CORRECTION 2026-09-11: this header used to say "/api/v1/workflows is federated,
// so the top table is one merged call". That stopped being true when the path was
// removed from FM_LIST_PATHS (it was serving 463 workflow records to anonymous
// callers). The federator then fell through to its cloud-only passthrough, and
// because cloud runs ZERO workers, every row it returned had failed for want of
// one: 29 FAILED / 4 CANCELLED, rendered as the whole estate, while office was
// sitting on 376 DONE. The tab reported a total outage on a healthy fleet.
//
// Both tables are therefore per-site now, for DIFFERENT reasons:
//   workflows — client-side fan-out in listWorkflows(). Cheap (ids only, ~179 KB
//               for all five sites) and it keeps the anonymous hole closed,
//               because each call carries the caller's own token.
//   tasks     — cannot be federated at all: office alone is 13.8 MB (814 rows
//               each embedding the full raw_yaml) against the federator's 4 MiB
//               body cap, so the fan-out truncated mid-JSON and that site
//               silently contributed zero. Fetched only for the workflow the
//               operator actually opened.

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { isSessionExpired } from "../../api/client";
import {
	FM_TERMINAL_TASK_STATUSES,
	bundleUrl,
	getResult,
	listTasksForSite,
	listWorkflows,
	type FmTask,
	type FmWorkflow,
} from "../../api/fm";
import { SiteBadge, SiteStrip, StatusPill, TabShell, useFanout } from "./shared";

function when(iso?: string): string {
	if (!iso) return "—";
	const t = Date.parse(iso);
	return Number.isNaN(t) ? "—" : new Date(t).toLocaleString();
}

export default function JobsTab() {
	const { data, loading, error, refresh } = useFanout<FmWorkflow>(() => listWorkflows(), 20_000);
	const [status, setStatus] = useState("all");
	const [open, setOpen] = useState<FmWorkflow | null>(null);
	const [tasks, setTasks] = useState<FmTask[] | null>(null);
	const [tasksErr, setTasksErr] = useState<string | null>(null);

	// Result viewer. Until now the ONLY way to see a task's output was the bundle
	// download — `getResult()` existed in the client with zero callers, so an
	// operator asking "where do I view results?" had no answer in the UI at all.
	const [resultOf, setResultOf] = useState<string | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const [resultErr, setResultErr] = useState<string | null>(null);
	const [resultLoading, setResultLoading] = useState(false);

	const viewResult = useCallback(async (site: string, taskId: string) => {
		setResultOf(taskId);
		setResult(null);
		setResultErr(null);
		setResultLoading(true);
		try {
			const r = await getResult<unknown>(site, taskId);
			setResult(JSON.stringify(r, null, 2));
		} catch (e) {
			if (isSessionExpired(e)) return;
			const msg = (e as Error)?.message || "unreadable";
			// Two very different causes wear the same 404, and conflating them sends
			// the reader to the wrong place:
			//   - the site restarted: results live on the container filesystem with no
			//     volume, while task metadata survives in Redis, so a DONE task can
			//     legitimately have no result body (measured on `vast`, 2026-09-11);
			//   - entitlement: per-site reads carry YOUR token, and a site you are not
			//     entitled on answers empty rather than forbidden.
			setResultErr(
				/404|not found/i.test(msg)
					? `No stored result for this task. Results are not persisted across a site restart (task metadata is, which is why the task still reads terminal). Original error: ${msg}`
					: msg,
			);
		} finally {
			setResultLoading(false);
		}
	}, []);

	const rows = useMemo(() => {
		const items = data?.items ?? [];
		const filtered = status === "all" ? items : items.filter((w) => w.status === status);
		return [...filtered].sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
	}, [data, status]);

	const openWorkflow = useCallback(async (wf: FmWorkflow) => {
		setOpen(wf);
		setTasks(null);
		setTasksErr(null);
		if (!wf.site) {
			// No site tag means the row came from the cloud-only passthrough rather
			// than a fan-out — we cannot know which mesh owns its tasks.
			setTasksErr("This workflow has no site tag, so its tasks cannot be located.");
			return;
		}
		try {
			const all = await listTasksForSite(wf.site);
			setTasks(all.filter((t) => t.workflow_id === wf.workflow_id));
		} catch (e) {
			if (isSessionExpired(e)) return;
			// A per-site read carries the CALLER's token and is entitlement-scoped:
			// an empty or refused response means "you may not see this", never
			// "there is nothing here". Say so rather than rendering an empty table.
			const msg = e instanceof Error ? e.message : "request failed";
			setTasksErr(
				`Could not read tasks from site "${wf.site}" (${msg}). Per-site reads use your own credential — an empty result may mean your token is not entitled on that mesh.`,
			);
			toast.error(`tasks: ${msg}`);
		}
	}, []);

	return (
		<TabShell
			title="Jobs"
			subtitle={`${data?.items.length ?? 0} workflow(s) across the federation`}
			loading={loading}
			error={error}
			onRefresh={refresh}
		>
			<SiteStrip sites={data?.sites ?? []} />

			<div className="mb-3 flex gap-2">
				{["all", "PENDING", "DISPATCHED", "DONE", "FAILED", "CANCELLED"].map((s) => (
					<button
						key={s}
						onClick={() => setStatus(s)}
						className={`rounded-md border px-2.5 py-1 text-xs ${
							status === s
								? "border-indigo-300 bg-indigo-50 text-indigo-700"
								: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
						}`}
					>
						{s}
					</button>
				))}
			</div>

			<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
						<tr>
							<th className="px-3 py-2">Site</th>
							<th className="px-3 py-2">Workflow</th>
							<th className="px-3 py-2">Status</th>
							<th className="px-3 py-2">Tasks</th>
							<th className="px-3 py-2">Submitted</th>
							<th className="px-3 py-2" />
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.slice(0, 200).map((w) => (
							<tr key={`${w.site}:${w.workflow_id}`} className="hover:bg-slate-50">
								<td className="px-3 py-2">
									<SiteBadge site={w.site} />
								</td>
								<td className="px-3 py-2 font-mono text-xs text-slate-700">
									{w.workflow_id}
								</td>
								<td className="px-3 py-2">
									<StatusPill status={w.status} />
								</td>
								<td className="px-3 py-2 text-xs text-slate-600">
									{w.task_ids?.length ?? 0}
									{w.failed_tasks?.length ? (
										<span className="ml-1 text-red-600">({w.failed_tasks.length} failed)</span>
									) : null}
								</td>
								<td className="px-3 py-2 text-xs text-slate-600">{when(w.submitted_at)}</td>
								<td className="px-3 py-2 text-right">
									<button
										onClick={() => void openWorkflow(w)}
										className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
									>
										Tasks
									</button>
								</td>
							</tr>
						))}
						{!rows.length && !loading && (
							<tr>
								<td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
									No workflows match.
								</td>
							</tr>
						)}
					</tbody>
				</table>
				{rows.length > 200 && (
					<p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
						Showing 200 of {rows.length}. FlowMesh list endpoints have no server-side
						pagination, so the full set is already in memory — narrow with the filters above.
					</p>
				)}
			</div>

			{open && (
				<div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
					<div className="mb-3 flex items-center justify-between">
						<div>
							<h3 className="font-semibold text-slate-900">
								Tasks · <span className="font-mono text-sm">{open.workflow_id}</span>
							</h3>
							<p className="text-xs text-slate-500">site {open.site ?? "unknown"}</p>
						</div>
						<button
							onClick={() => setOpen(null)}
							className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
						>
							Close
						</button>
					</div>

					{tasksErr ? (
						<p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
							{tasksErr}
						</p>
					) : !tasks ? (
						<p className="text-sm text-slate-500">Loading tasks…</p>
					) : (
						<table className="w-full text-sm">
							<thead className="text-left text-xs uppercase text-slate-500">
								<tr>
									<th className="py-1">Task</th>
									<th className="py-1">Status</th>
									<th className="py-1">Worker</th>
									<th className="py-1">Attempts</th>
									<th className="py-1">Error</th>
									<th className="py-1" />
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{tasks.map((t) => {
									const terminal = FM_TERMINAL_TASK_STATUSES.has(t.status);
									return (
										<tr key={t.task_id}>
											<td className="py-1.5 font-mono text-xs">{t.task_id.slice(0, 18)}…</td>
											<td className="py-1.5">
												<StatusPill status={t.status} />
											</td>
											<td className="py-1.5 text-xs text-slate-600">
												{t.assigned_worker ?? "—"}
											</td>
											<td className="py-1.5 text-xs">
												{t.attempts}/{t.max_attempts}
											</td>
											<td className="py-1.5 text-xs text-red-700">
												{t.error ? t.error.slice(0, 60) : ""}
											</td>
											<td className="py-1.5 text-right">
												{/* The bundle endpoint returns 409 unless the task is
												    terminal, so the link is disabled until then rather
												    than offering a download that cannot succeed. */}
												<a
													href={terminal && open.site ? bundleUrl(open.site, t.task_id) : undefined}
													className={`text-xs ${
														terminal && open.site
															? "text-indigo-600 hover:underline"
															: "cursor-not-allowed text-slate-300"
													}`}
													title={
														terminal
															? "Download results + artifacts"
															: "Available once the task reaches a terminal state"
													}
												>
													Bundle
												</a>
												<button
													type="button"
													disabled={!terminal || !open.site}
													onClick={() => open.site && viewResult(open.site, t.task_id)}
													className={`ml-3 text-xs ${
														terminal && open.site
															? "text-indigo-600 hover:underline"
															: "cursor-not-allowed text-slate-300"
													}`}
													title={
														terminal
															? "View the executor result inline"
															: "Available once the task reaches a terminal state"
													}
												>
													Result
												</button>
											</td>
										</tr>
									);
								})}
								{!tasks.length && (
									<tr>
										<td colSpan={6} className="py-4 text-center text-xs text-slate-500">
											No tasks returned for this workflow.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					)}

					{/* Result body, inline. Rendered raw rather than pretty-printed into
					    fields: executor output is task-type-specific (an inference task
					    returns items[]/usage, a training task something else entirely),
					    so any fixed schema here would silently hide whatever it did not
					    anticipate. The bundle link remains for artifacts and logs. */}
					{resultOf && (
						<div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
							<div className="mb-2 flex items-center justify-between">
								<p className="text-xs font-medium text-slate-700">
									Result · <span className="font-mono">{resultOf.slice(0, 24)}…</span>
								</p>
								<button
									type="button"
									onClick={() => {
										setResultOf(null);
										setResult(null);
										setResultErr(null);
									}}
									className="text-xs text-slate-500 hover:text-slate-800"
								>
									Close
								</button>
							</div>
							{resultLoading && <p className="text-xs text-slate-500">Loading…</p>}
							{resultErr && (
								<p className="whitespace-pre-wrap text-xs text-amber-700">{resultErr}</p>
							)}
							{result && (
								<pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs leading-relaxed text-slate-800">
									{result}
								</pre>
							)}
						</div>
					)}
				</div>
			)}
		</TabShell>
	);
}
