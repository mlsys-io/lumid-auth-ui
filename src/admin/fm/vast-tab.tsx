// Vast — the rented GPU fleet: what is running, what it costs, and against
// which caps.
//
// READ-ONLY BY DESIGN, FOR NOW. Rent/destroy from a browser would go through
// `/fm/<site>/…`, the only federator route that proxies non-GET methods — and
// mesh-federator's own header says it "should stay behind the edge's super_admin
// auth subrequest and never be given write paths to fan out". As of 2026-09-08
// the per-site prefix had no such subrequest; FEDERATOR_REQUIRE_SITE_AUTH=true
// closed the anonymous hole but there is still no super_admin gate. Adding spend
// buttons before that gate exists would put money-moving calls on a route the
// service explicitly says should not carry them. The controls stay out until the
// gate lands — see the plan's Step 4.

import { useMemo } from "react";
import {
	listWorkers,
	secondsSince,
	type FmWorker,
} from "../../api/fm";
import { Age, SiteStrip, StatusPill, TabShell, useFanout } from "./shared";

// Mirrors the vast-autoscaler CronJob env. Shown so an operator can see what the
// loop is enforcing without reading a manifest. Display-only: the authoritative
// values live in k8s-lift/vast-autoscaler/vast-autoscaler.yaml, and editing them
// from here would need the same write path the note above is waiting on.
const CAPS = {
	maxPerInstance: 0.35,
	maxFleet: 1.0,
	maxInstances: 3,
	minInstances: 0,
	idleTtlSec: 900,
	gpu: "RTX 5080",
};

export default function VastTab() {
	const { data, loading, error, refresh } = useFanout<FmWorker>(
		() => listWorkers(["vast"]),
		15_000,
	);

	const workers = useMemo(() => data?.items ?? [], [data]);
	const burn = useMemo(
		() => workers.reduce((a, w) => a + (w.cost_per_hour ?? w.hardware?.gpu?.cost_per_hour ?? 0), 0),
		[workers],
	);
	const pctFleet = Math.min(100, (burn / CAPS.maxFleet) * 100);

	return (
		<TabShell
			title="Vast — rented GPUs"
			subtitle="Elastic capacity rented from vast.ai on demand and destroyed when idle. Refreshes every 15s."
			loading={loading}
			error={error}
			onRefresh={refresh}
		>
			<SiteStrip sites={data?.sites ?? []} />

			<div className="mb-4 grid gap-3 sm:grid-cols-3">
				<div className="rounded-lg border border-slate-200 bg-white p-4">
					<p className="text-xs text-slate-500">Rented workers</p>
					<p className="mt-1 text-2xl font-semibold text-slate-900">
						{workers.length}
						<span className="ml-1 text-sm font-normal text-slate-500">
							/ {CAPS.maxInstances} cap
						</span>
					</p>
					<p className="mt-1 text-xs text-slate-500">floor {CAPS.minInstances} — scales to zero</p>
				</div>
				<div className="rounded-lg border border-slate-200 bg-white p-4">
					<p className="text-xs text-slate-500">Burn rate</p>
					<p className="mt-1 text-2xl font-semibold text-slate-900">
						${burn.toFixed(3)}
						<span className="ml-1 text-sm font-normal text-slate-500">/hr</span>
					</p>
					<div className="mt-2 h-1.5 w-full rounded bg-slate-100">
						<div
							className={`h-1.5 rounded ${pctFleet > 80 ? "bg-red-500" : "bg-emerald-500"}`}
							style={{ width: `${pctFleet}%` }}
						/>
					</div>
					<p className="mt-1 text-xs text-slate-500">cap ${CAPS.maxFleet.toFixed(2)}/hr fleet</p>
				</div>
				<div className="rounded-lg border border-slate-200 bg-white p-4">
					<p className="text-xs text-slate-500">Autoscaler policy</p>
					<ul className="mt-1 space-y-0.5 text-xs text-slate-600">
						<li>≤ ${CAPS.maxPerInstance.toFixed(2)}/hr per instance</li>
						<li>idle {CAPS.idleTtlSec / 60} min → destroy</li>
						<li>{CAPS.gpu} only</li>
					</ul>
				</div>
			</div>

			{workers.length === 0 && !loading ? (
				<div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
					<p className="text-sm font-medium text-slate-700">No rented capacity right now.</p>
					<p className="mt-1 text-xs text-slate-500">
						This is the normal idle state — the fleet floor is zero, so an idle day costs
						nothing but the in-cluster supervisor. Queue GPU work and the autoscaler rents
						within a minute.
					</p>
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
					<table className="w-full text-sm">
						<thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
							<tr>
								<th className="px-3 py-2">Worker</th>
								<th className="px-3 py-2">Status</th>
								<th className="px-3 py-2">GPU</th>
								<th className="px-3 py-2">$/hr</th>
								<th className="px-3 py-2">Last seen</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{workers.map((w) => (
								<tr key={w.id} className="hover:bg-slate-50">
									<td className="px-3 py-2">
										<div className="font-medium text-slate-900">{w.alias ?? w.id}</div>
										<div className="font-mono text-xs text-slate-500">{w.id}</div>
									</td>
									<td className="px-3 py-2">
										<StatusPill status={w.status} />
									</td>
									<td className="px-3 py-2 text-xs text-slate-700">
										{w.hardware?.gpu?.devices?.[0]?.name ?? "—"}
									</td>
									<td className="px-3 py-2 text-xs">
										{w.cost_per_hour != null ? `$${w.cost_per_hour.toFixed(3)}` : "—"}
									</td>
									<td className="px-3 py-2 text-xs">
										<Age seconds={secondsSince(w.last_seen)} />
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
				<strong>A stale row is possible here.</strong> Destroying a worker is not a graceful
				unregister, so a registry row can outlive its machine until the heartbeat TTL expires.
				Check “Last seen” before treating a row as live capacity — and note the vast.ai console
				is the authority on what is actually billing.
			</div>
		</TabShell>
	);
}
