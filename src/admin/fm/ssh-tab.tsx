// SSH — interactive shells on the GPU fleet.
//
// There is NO sessions API. A session is an ordinary task (`kind: SSHTask`,
// task_type "ssh") and its connection details are published through that task's
// own `latest_update.ssh` by the worker
// (worker/executors/ssh_executor.py: emit_update(task_id, {"ssh": …})). So this
// tab reads tasks and projects the SSH ones — do not go looking for
// /api/v1/ssh/sessions, it does not exist.
//
// Per-site by necessity: `/fm/<site>/api/v1/tasks` is the only tasks path, there
// is no merged one, and worker ids repeat across sites.

import { useMemo } from "react";
import { listTasksForSite, fanoutForSites, secondsSince, type FmTask } from "../../api/fm";
import { Age, SiteBadge, SiteStrip, StatusPill, TabShell, useFanout } from "./shared";
import { PUBLIC_SITE } from "./fleet-tab";

const ADMIN_SITES = ["home", "office", "cloud", "vast", "nus"];

function sshOf(t: FmTask) {
	return t.latest_update?.ssh ?? null;
}

/** A session is usable only while its task is live AND its lease has not expired. */
function isActive(t: FmTask): boolean {
	if (!["RUNNING", "DISPATCHED", "PENDING", "QUEUED"].includes(String(t.status))) return false;
	const exp = sshOf(t)?.expires_at;
	if (!exp) return true;
	const ms = Date.parse(exp);
	return Number.isNaN(ms) ? true : ms > Date.now();
}

/**
 * `embedded` renders the content WITHOUT its own TabShell, because SSH is no
 * longer a tab — it is a filter inside Jobs. An SSH session IS a task
 * (task_type "ssh"), so it was never a separate place, just a separate query
 * over the same rows. Same prop pattern as pages/studio/portfolio.tsx.
 */
export default function SshTab({ isAdmin, embedded = false }: { isAdmin: boolean; embedded?: boolean }) {
	const sites = isAdmin ? ADMIN_SITES : [PUBLIC_SITE];
	const { data, loading, error, refresh } = useFanout<FmTask>(
		() => fanoutForSites(sites, listTasksForSite),
		30_000,
	);

	const rows = useMemo(() => {
		const ssh = (data?.items ?? []).filter((t) => t.task_type === "ssh");
		// Active first, then most recent — a live shell is the only row anyone is
		// looking for; the rest is history.
		return ssh.sort((a, b) => {
			const d = Number(isActive(b)) - Number(isActive(a));
			return d !== 0 ? d : (b.submitted_ts ?? 0) - (a.submitted_ts ?? 0);
		});
	}, [data]);

	const active = rows.filter(isActive);

	const content = (
		<>
			<SiteStrip sites={data?.sites ?? []} />

			<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
				<p className="font-medium text-slate-700">Opening a shell</p>
				<p className="mt-1">
					Submit an <code className="rounded bg-white px-1">SSHTask</code> (Compute → Submit, or
					the API) and the worker publishes the connection details onto the task. You then
					connect to the site's relay, not to the box:
				</p>
				<pre className="mt-2 overflow-x-auto rounded bg-white p-2 font-mono text-[11px] text-slate-800">
{`ssh -p <port> <username>@<host>   # values come from the row below`}
				</pre>
				<p className="mt-2">
					Sessions carry a lease and expire on their own. Full reference —{" "}
					<a className="text-indigo-600 hover:underline" href="/studio/docs/flowmesh-ssh">
						FlowMesh SSH tasks
					</a>
					.
				</p>
			</div>

			<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
						<tr>
							<th className="px-3 py-2">Site</th>
							<th className="px-3 py-2">Status</th>
							<th className="px-3 py-2">Connect</th>
							<th className="px-3 py-2">Worker</th>
							<th className="px-3 py-2">Task</th>
							<th className="px-3 py-2">Expires</th>
							<th className="px-3 py-2">Age</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.map((t) => {
							const s = sshOf(t);
							const live = isActive(t);
							return (
								<tr
									key={`${t.site}:${t.task_id}`}
									className={`hover:bg-slate-50 ${live ? "" : "opacity-60"}`}
								>
									<td className="px-3 py-2">
										<SiteBadge site={t.site} />
									</td>
									<td className="px-3 py-2">
										<StatusPill status={t.status} />
									</td>
									<td className="px-3 py-2 font-mono text-xs text-slate-700">
										{s?.host && s?.port
											? `ssh -p ${s.port} ${s.username ?? "flowmesh"}@${s.host}`
											: "—"}
										{s?.mode && (
											<span className="ml-2 rounded bg-slate-100 px-1 text-[11px] text-slate-500">
												{s.mode}
											</span>
										)}
									</td>
									<td className="px-3 py-2 text-xs text-slate-600">
										{t.assigned_worker ?? "—"}
									</td>
									<td className="px-3 py-2 font-mono text-xs text-slate-500">
										{t.task_id.slice(0, 16)}…
									</td>
									<td className="px-3 py-2 text-xs text-slate-600">
										{s?.expires_at ? new Date(s.expires_at).toLocaleString() : "—"}
									</td>
									<td className="px-3 py-2 text-xs">
										<Age seconds={secondsSince(t.submitted_at)} />
									</td>
								</tr>
							);
						})}
						{!rows.length && !loading && (
							<tr>
								<td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
									No SSH sessions on record.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</>
	);

	if (embedded) return content;

	return (
		<TabShell
			subtitle={`${active.length} active session(s) of ${rows.length} on record${
				isAdmin ? " across every site" : " on home"
			}. Refreshes every 30s.`}
			loading={loading}
			error={error}
			onRefresh={refresh}
		>
			{content}
		</TabShell>
	);
}
