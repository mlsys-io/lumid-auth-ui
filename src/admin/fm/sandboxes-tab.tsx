// Sandboxes — a shell on the fleet, with your files still there next time.
//
// Not admin-gated, and the tab is the same shape as ssh-tab/fleet-tab for that
// reason: `home` is the site anyone may use, so a non-admin sees home and only
// home, while an admin fans out across every site. sandbox-control scopes
// everything to the caller's own identity (own namespace, own quota, own keys,
// own home), so this needs no gate of its own — hiding the tab would only hide a
// user's own work from them.
//
// ---------------------------------------------------------------------------
// TWO SOURCES, ONE LIST.
// ---------------------------------------------------------------------------
// A shell on home/office/NUS is a k8s pod from sandbox-control. A shell on
// `vast` is a FlowMesh SSH task read from `latest_update.ssh` — vast rents boxes
// by the hour and runs no k8s sandbox-control at all. Those are two mechanisms
// and one concept, so both normalise to ComputeShell (api/sandboxes.ts) and land
// in the same table. A user should not have to learn which plumbing produced
// their shell.
//
// Only `vast` is polled for SSH tasks, deliberately. `/fm/<site>/api/v1/tasks`
// is the ONLY tasks path and it has no server-side filter — office's list alone
// is 13.8 MB because every row embeds its full raw_yaml. Polling that here every
// 20s to find shells that are not there would be the most expensive request in
// the app. The sites that serve shells through FlowMesh are the sites listed
// below; everywhere else a shell is a sandbox.

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	PUBLIC_SANDBOX_SITE,
	SANDBOX_SITES,
	createSandbox,
	deleteSandbox,
	isSshTaskActive,
	listSandboxesForSite,
	sandboxToShell,
	sshCommandForSite,
	sshTaskToShell,
	syncKeys,
	type ComputeShell,
	type Sandbox,
} from "../../api/sandboxes";
import { fanoutForSites, listTasksForSite, type FmFanout, type FmTask } from "../../api/fm";
import { SiteBadge, SiteStrip, TabShell, useFanout } from "./shared";
import { PUBLIC_SITE } from "./fleet-tab";

/** Sites whose shells come from FlowMesh rather than sandbox-control. Admin-only:
 *  vast bills by the hour, which is exactly why it is not on the public tier. */
const SSH_TASK_SITES = ["vast"];

const EMPTY: FmFanout<FmTask> = { items: [], sites: [] };

/** Live first — a running shell is the only row anyone is looking for. */
function isLive(r: ComputeShell): boolean {
	if (r.kind === "sandbox") return r.state === "Running" || r.state === "Queued" || r.state === "Pending";
	return ["RUNNING", "DISPATCHED", "PENDING", "QUEUED"].includes(r.state);
}

function StatePill({ r }: { r: ComputeShell }) {
	const s = r.state;
	const tone =
		s === "Running" || s === "RUNNING" || s === "DISPATCHED" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
		: s === "Queued" || s === "QUEUED" || s === "Pending" || s === "PENDING" ? "bg-amber-50 text-amber-700 border-amber-200"
		: s === "Failed" || s === "FAILED" ? "bg-rose-50 text-rose-700 border-rose-200"
		// Terminating is its own state, not a failure: the user asked for this and
		// it takes ~30s. Muted rather than red so it does not read as an error.
		: s === "Terminating" ? "bg-slate-100 text-slate-500 border-slate-200"
		: "bg-slate-50 text-slate-600 border-slate-200";
	return (
		<span className={`rounded border px-1.5 py-0.5 text-xs ${tone}`} title={r.detail ?? undefined}>
			{s}
		</span>
	);
}

function expiresIn(ms: number | null): string {
	if (ms === null) return "—";
	const secs = Math.floor((ms - Date.now()) / 1000);
	if (secs <= 0) return "expired";
	const h = Math.floor(secs / 3600);
	return h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(secs / 60))}m`;
}

export default function SandboxesTab({ isAdmin }: { isAdmin: boolean }) {
	const sites = isAdmin ? SANDBOX_SITES : [PUBLIC_SITE];
	const [target, setTarget] = useState(PUBLIC_SANDBOX_SITE);
	const [busy, setBusy] = useState(false);
	const [name, setName] = useState("dev");
	const [gpu, setGpu] = useState(0);
	const [ttl, setTtl] = useState(8);

	const boxes = useFanout<Sandbox>(() => fanoutForSites(sites, listSandboxesForSite), 20_000);
	const shells = useFanout<FmTask>(
		() => (isAdmin ? fanoutForSites(SSH_TASK_SITES, listTasksForSite) : Promise.resolve(EMPTY)),
		20_000,
	);

	const refresh = useCallback(() => {
		boxes.refresh();
		shells.refresh();
	}, [boxes, shells]);

	const rows = useMemo(() => {
		// A task list is history as well as state, so filter BEFORE mapping: only
		// sessions that could still be connected to belong beside a live sandbox.
		const live = (shells.data?.items ?? []).filter((t) => t.task_type === "ssh" && isSshTaskActive(t));
		const merged = [
			...(boxes.data?.items ?? []).map(sandboxToShell),
			...live.map(sshTaskToShell),
		];
		return merged.sort((a, b) => {
			const d = Number(isLive(b)) - Number(isLive(a));
			if (d !== 0) return d;
			return (a.site + a.name).localeCompare(b.site + b.name);
		});
	}, [boxes.data, shells.data]);

	// One strip over both sources: a site that did not answer must be VISIBLE as
	// unanswered, or an empty table and a 403 look identical.
	const siteStatus = useMemo(
		() => [...(boxes.data?.sites ?? []), ...(shells.data?.sites ?? [])],
		[boxes.data, shells.data],
	);

	const gpusFree = (boxes.data?.items ?? []).find((s) => s.site === target)?.gpus_free ?? "";

	async function onCreate() {
		setBusy(true);
		try {
			await createSandbox(target, { name, gpu, ttl_hours: ttl });
			toast.success(`creating ${name} on ${target}`);
			boxes.refresh();
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? `could not create the sandbox on ${target}`);
		} finally { setBusy(false); }
	}

	async function onDelete(r: ComputeShell) {
		// Say what is NOT destroyed. Deleting a container people have files in is
		// exactly where a confirmation should state the blast radius.
		if (!confirm(`Delete sandbox "${r.name}" on ${r.site}?\n\nYour /home is kept — only the container goes.`)) return;
		try {
			await deleteSandbox(r.site, r.name);
			toast.success(`deleted ${r.name} — your home is kept`);
			boxes.refresh();
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? "could not delete");
		}
	}

	async function onSyncKeys() {
		try {
			const r = await syncKeys(target);
			toast.success(r.keys_authorized
				? `${r.keys_authorized} key(s) authorized on ${target}`
				: "no SSH keys on your account yet — add one in account settings");
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? "key sync failed");
		}
	}

	const connectHint = sshCommandForSite(target);

	return (
		<TabShell
			subtitle={`A shell with a home directory that outlives the container.${
				isAdmin ? " Every site." : " On home."
			}${gpusFree ? ` ${gpusFree} GPUs free on ${target}.` : ""} Refreshes every 20s.`}
			loading={boxes.loading || shells.loading}
			error={boxes.error ?? shells.error}
			onRefresh={refresh}
		>
			<SiteStrip sites={siteStatus} />

			<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
				<div className="flex flex-wrap items-end gap-3">
					{/* Only an admin picks a site; a non-admin has exactly one and a
					    disabled select would just be furniture. */}
					{isAdmin && (
						<label className="text-xs text-slate-600">
							Site
							<select value={target} onChange={(e) => setTarget(e.target.value)}
								className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm">
								{SANDBOX_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
							</select>
						</label>
					)}
					<label className="text-xs text-slate-600">
						Name
						<input value={name} onChange={(e) => setName(e.target.value)}
							className="mt-1 block w-32 rounded-md border border-slate-300 px-2 py-1 text-sm" />
					</label>
					<label className="text-xs text-slate-600">
						GPUs
						<select value={gpu} onChange={(e) => setGpu(Number(e.target.value))}
							className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm">
							<option value={0}>none</option>
							<option value={1}>1</option>
							<option value={2}>2</option>
						</select>
					</label>
					<label className="text-xs text-slate-600">
						Expires after
						<select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}
							className="mt-1 block rounded-md border border-slate-300 px-2 py-1 text-sm">
							<option value={2}>2h</option><option value={8}>8h</option>
							<option value={24}>24h</option><option value={72}>3d</option>
						</select>
					</label>
					<button onClick={onCreate} disabled={busy || !name}
						className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
						{busy ? "creating…" : "Create sandbox"}
					</button>
					<button onClick={onSyncKeys}
						title={`Re-read your SSH keys from your lum.id account into ${target}'s gateway`}
						className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
						Sync my SSH keys
					</button>
				</div>
				<p className="mt-2 text-xs text-slate-500">
					{connectHint ? (
						<>
							Connect with <code className="rounded bg-white px-1">{connectHint}</code> — one port per
							site for everyone; your key decides which sandbox you land in. Add keys in your account
							settings.{" "}
						</>
					) : (
						<>
							<strong>{target}</strong> has no SSH gateway yet — sandboxes there are reachable with{" "}
							<code className="rounded bg-white px-1">kubectl exec</code> only.{" "}
						</>
					)}
					Files under <code className="rounded bg-white px-1">/home</code> survive deleting a
					sandbox, and homes are <em>per site</em> — your home on office is a different directory
					from your home on home.
				</p>
			</div>

			<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
						<tr>
							<th className="px-3 py-2">Site</th>
							<th className="px-3 py-2">Shell</th>
							<th className="px-3 py-2">State</th>
							<th className="px-3 py-2">Connect</th>
							<th className="px-3 py-2">Owner</th>
							<th className="px-3 py-2">Expires in</th>
							<th className="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.map((r) => (
							<tr key={r.key} className={`hover:bg-slate-50 ${isLive(r) ? "" : "opacity-60"}`}>
								<td className="px-3 py-2"><SiteBadge site={r.site} /></td>
								<td className="px-3 py-2">
									<div className="font-medium text-slate-900">{r.name}</div>
									<div className="font-mono text-xs text-slate-500">
										{r.kind === "sandbox" ? r.sandbox?.pod : "flowmesh ssh task"}
										{r.gpu ? ` · ${r.gpu} GPU` : ""}
										{r.node ? ` · ${r.node}` : ""}
									</div>
								</td>
								<td className="px-3 py-2">
									<StatePill r={r} />
									{/* A queued sandbox says what it is waiting for. Leaving it as a
									    bare "Pending" with no reason is the thing this avoids. */}
									{(r.state === "Queued" || r.state === "Pending") && r.detail && (
										<div className="mt-0.5 max-w-xs text-xs text-amber-700">{r.detail}</div>
									)}
								</td>
								<td className="px-3 py-2 font-mono text-xs text-slate-700">{r.connect ?? "—"}</td>
								<td className="px-3 py-2 text-xs text-slate-600">{r.owner ?? "you"}</td>
								<td className="px-3 py-2 text-xs text-slate-600">{expiresIn(r.expiresAt)}</td>
								<td className="px-3 py-2 text-right">
									{r.kind === "sandbox" ? (
										/* Deleting twice is the natural thing to do when the row is still
										   there after the first click, and the second one 404s. The row
										   stays visible (so the shutdown is legible) but is not clickable. */
										<button onClick={() => onDelete(r)}
											disabled={r.state === "Terminating"}
											title={r.state === "Terminating" ? "shutting down — this takes about 30s" : undefined}
											className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 enabled:hover:bg-rose-50 enabled:hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40">
											{r.state === "Terminating" ? "Deleting…" : "Delete"}
										</button>
									) : (
										/* A vast shell is a FlowMesh TASK. Cancelling it is a job action
										   and lives on Jobs; offering a Delete here that did something
										   subtly different would be worse than offering none. */
										<a className="text-xs text-indigo-600 hover:underline" href="/studio/compute/jobs">
											manage in Jobs
										</a>
									)}
								</td>
							</tr>
						))}
						{!rows.length && !boxes.loading && (
							<tr>
								<td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
									No sandboxes yet — create one above.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</TabShell>
	);
}
