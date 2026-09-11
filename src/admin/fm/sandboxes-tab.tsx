// Sandboxes — a shell on the home fleet, with your files still there next time.
//
// Not admin-gated: home is the fleet anyone may use, and sandbox-control scopes
// everything to the caller's own identity (own namespace, own quota, own keys).

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	SSH_COMMAND,
	createSandbox,
	deleteSandbox,
	listSandboxes,
	syncKeys,
	type Sandbox,
	type SandboxList,
} from "../../api/sandboxes";
import { TabShell } from "./shared";

function Phase({ s }: { s: Sandbox }) {
	const tone =
		s.phase === "Running" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
		: s.phase === "Queued" ? "bg-amber-50 text-amber-700 border-amber-200"
		: s.phase === "Failed" ? "bg-rose-50 text-rose-700 border-rose-200"
		// Terminating is its own state, not a failure: the user asked for this and
		// it takes ~30s. Muted rather than red so it does not read as an error.
		: s.phase === "Terminating" ? "bg-slate-100 text-slate-500 border-slate-200"
		: "bg-slate-50 text-slate-600 border-slate-200";
	return (
		<span className={`rounded border px-1.5 py-0.5 text-xs ${tone}`} title={s.waiting_for ?? undefined}>
			{s.phase}
		</span>
	);
}

function expiresIn(ts?: string | null): string {
	if (!ts) return "—";
	const secs = Number(ts) - Math.floor(Date.now() / 1000);
	if (Number.isNaN(secs)) return "—";
	if (secs <= 0) return "expired";
	const h = Math.floor(secs / 3600);
	return h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(secs / 60))}m`;
}

export default function SandboxesTab() {
	const [data, setData] = useState<SandboxList | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [name, setName] = useState("dev");
	const [gpu, setGpu] = useState(0);
	const [ttl, setTtl] = useState(8);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			setData(await listSandboxes());
			setError(null);
		} catch (e: any) {
			setError(e?.response?.data?.detail ?? e?.message ?? "could not reach sandbox-control");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
		// A sandbox takes tens of seconds to pull an image and schedule, so a slow
		// poll is enough; this is not a dashboard.
		const t = setInterval(() => { if (!document.hidden) void refresh(); }, 20_000);
		return () => clearInterval(t);
	}, [refresh]);

	async function onCreate() {
		setBusy(true);
		try {
			await createSandbox({ name, gpu, ttl_hours: ttl });
			toast.success(`creating ${name}`);
			await refresh();
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? "could not create the sandbox");
		} finally { setBusy(false); }
	}

	async function onDelete(s: Sandbox) {
		// Say what is NOT destroyed. Deleting a container people have files in is
		// exactly where a confirmation should state the blast radius.
		if (!confirm(`Delete sandbox "${s.name}"?\n\nYour /home is kept — only the container goes.`)) return;
		try {
			await deleteSandbox(s.name);
			toast.success(`deleted ${s.name} — your home is kept`);
			await refresh();
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? "could not delete");
		}
	}

	async function onSyncKeys() {
		try {
			const r = await syncKeys();
			toast.success(r.keys_authorized
				? `${r.keys_authorized} key(s) authorized`
				: "no SSH keys on your account yet — add one in account settings");
		} catch (e: any) {
			toast.error(e?.response?.data?.detail ?? "key sync failed");
		}
	}

	const rows = data?.sandboxes ?? [];

	return (
		<TabShell
			subtitle={`A shell on the home fleet, with a home directory that outlives the container.${
				data?.gpus_free ? ` ${data.gpus_free} GPUs free.` : ""
			}`}
			loading={loading}
			error={error}
			onRefresh={refresh}
		>
			<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
				<div className="flex flex-wrap items-end gap-3">
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
						title="Re-read your SSH keys from your lum.id account"
						className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
						Sync my SSH keys
					</button>
				</div>
				<p className="mt-2 text-xs text-slate-500">
					Connect with <code className="rounded bg-white px-1">{SSH_COMMAND}</code> — one port for
					everyone; your key decides which sandbox you land in. Add keys in your account settings.
					Files under <code className="rounded bg-white px-1">/home</code> survive deleting a
					sandbox; <code className="rounded bg-white px-1">/datasets</code> is shared and read-only.
				</p>
			</div>

			<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
						<tr>
							<th className="px-3 py-2">Sandbox</th>
							<th className="px-3 py-2">State</th>
							<th className="px-3 py-2">GPU</th>
							<th className="px-3 py-2">Node</th>
							<th className="px-3 py-2">Expires in</th>
							<th className="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.map((s) => (
							<tr key={s.pod} className="hover:bg-slate-50">
								<td className="px-3 py-2">
									<div className="font-medium text-slate-900">{s.name}</div>
									<div className="font-mono text-xs text-slate-500">{s.pod}</div>
								</td>
								<td className="px-3 py-2">
									<Phase s={s} />
									{/* A queued sandbox says what it is waiting for. Leaving it as a
									    bare "Pending" with no reason is the thing this avoids. */}
									{s.phase === "Queued" && (
										<div className="mt-0.5 max-w-xs text-xs text-amber-700">
											{s.gpus_free ? `${s.gpus_free} GPUs free. ` : ""}{s.waiting_for}
										</div>
									)}
								</td>
								<td className="px-3 py-2 text-xs text-slate-700">{s.gpu || "—"}</td>
								<td className="px-3 py-2 text-xs text-slate-600">{s.node ?? "—"}</td>
								<td className="px-3 py-2 text-xs text-slate-600">{expiresIn(s.expires_at)}</td>
								<td className="px-3 py-2 text-right">
									{/* Deleting twice is the natural thing to do when the row is still
									    there after the first click, and the second one 404s. The row
									    stays visible (so the shutdown is legible) but is not clickable. */}
									<button onClick={() => onDelete(s)}
										disabled={s.phase === "Terminating"}
										title={s.phase === "Terminating" ? "shutting down — this takes about 30s" : undefined}
										className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 enabled:hover:bg-rose-50 enabled:hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40">
										{s.phase === "Terminating" ? "Deleting…" : "Delete"}
									</button>
								</td>
							</tr>
						))}
						{!rows.length && !loading && (
							<tr>
								<td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
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
