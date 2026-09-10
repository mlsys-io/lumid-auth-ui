// Workers — the compute inventory, with the rented-fleet burn rate.

import { useMemo, useState } from "react";
import {
	fleetCostPerHour,
	listWorkers,
	secondsSince,
	type FmWorker,
} from "../../api/fm";
import { Age, SiteBadge, SiteStrip, StatusPill, TabShell, useFanout } from "./shared";

function gpuLabel(w: FmWorker): string {
	const d = w.hardware?.gpu?.devices;
	if (!d?.length) return "—";
	const name = d[0].name ?? "GPU";
	return d.length > 1 ? `${d.length}× ${name}` : name;
}

export default function WorkersTab() {
	const { data, loading, error, refresh } = useFanout<FmWorker>(() => listWorkers(), 20_000);
	const [status, setStatus] = useState<string>("all");

	const rows = useMemo(() => {
		const items = data?.items ?? [];
		const filtered = status === "all" ? items : items.filter((w) => w.status === status);
		return [...filtered].sort(
			(a, b) =>
				(a.site ?? "").localeCompare(b.site ?? "") ||
				(a.alias ?? a.id).localeCompare(b.alias ?? b.id),
		);
	}, [data, status]);

	// `priced` counts workers whose cost is not FlowMesh's WORKER_COST_PER_HOUR default
	// of 1.0. A total built from that default is a fabricated number — it once rendered
	// "$2.000/hr" for a fleet renting nothing — so it is not shown at all.
	const burn = useMemo(() => fleetCostPerHour(data?.items ?? []), [data]);

	return (
		<TabShell
			title="Workers"
			subtitle={`${data?.items.length ?? 0} worker(s) · ${
				burn.priced > 0
					? `$${burn.total.toFixed(3)}/hr across ${burn.priced} priced worker(s)`
					: "no per-worker cost reported"
			}`}
			loading={loading}
			error={error}
			onRefresh={refresh}
		>
			<SiteStrip sites={data?.sites ?? []} />

			<div className="mb-3 flex gap-2">
				{["all", "IDLE", "BUSY", "STARTING", "UNKNOWN"].map((s) => (
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
							<th className="px-3 py-2">Worker</th>
							<th className="px-3 py-2">Node</th>
							<th className="px-3 py-2">Status</th>
							<th className="px-3 py-2">GPU</th>
							<th className="px-3 py-2">Tags</th>
							<th className="px-3 py-2">$/hr</th>
							<th className="px-3 py-2">Last seen</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.map((w) => (
							<tr key={`${w.site}:${w.id}`} className="hover:bg-slate-50">
								<td className="px-3 py-2">
									<SiteBadge site={w.site} />
								</td>
								<td className="px-3 py-2">
									<div className="font-medium text-slate-900">{w.alias ?? w.id}</div>
									<div className="font-mono text-xs text-slate-500">{w.id}</div>
								</td>
								<td className="px-3 py-2 text-xs text-slate-600">
									{w.node_alias ?? w.node_id}
								</td>
								<td className="px-3 py-2">
									{/* Registry status (IDLE/BUSY) — the only endpoint that knows
									    idleness. The supervisor adapter reports RUNNING instead and
									    must never be used for this. */}
									<StatusPill status={w.status} />
								</td>
								<td className="px-3 py-2 text-xs text-slate-700">{gpuLabel(w)}</td>
								<td className="px-3 py-2">
									<div className="flex flex-wrap gap-1">
										{(w.tags ?? []).map((t) => (
											<span
												key={t}
												className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
											>
												{t}
											</span>
										))}
									</div>
								</td>
								<td className="px-3 py-2 text-xs">
									{w.cost_per_hour != null ? `$${w.cost_per_hour.toFixed(3)}` : "—"}
								</td>
								<td className="px-3 py-2 text-xs">
									<Age seconds={secondsSince(w.last_seen)} />
								</td>
							</tr>
						))}
						{!rows.length && !loading && (
							<tr>
								<td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
									No workers match.
									{/* Registry rows can outlive the machine: a destroy is not a
									    graceful UNREGISTER, so a stale IDLE row lingers until its
									    heartbeat TTL expires. Cross-check "Last seen" before
									    treating a row as live capacity. */}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</TabShell>
	);
}
