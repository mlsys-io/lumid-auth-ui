// Sites — the landing view. Answers "is anything down" before it answers
// anything else, which is the first question during an incident.

import { useMemo } from "react";
import { listNodes, listWorkers, type FmNode, type FmWorker } from "../../api/fm";
import { Age, SiteStrip, TabShell, useFanout } from "./shared";
import { secondsSince } from "../../api/fm";

export default function SitesTab() {
	const nodes = useFanout<FmNode>(() => listNodes(), 30_000);
	const workers = useFanout<FmWorker>(() => listWorkers(), 30_000);

	const rows = useMemo(() => {
		// Union of sites seen by BOTH fan-outs. A site can answer one endpoint and
		// fail the other, and collapsing that to a single "up/down" would hide it.
		const names = new Set<string>();
		nodes.data?.sites.forEach((s) => names.add(s.site));
		workers.data?.sites.forEach((s) => names.add(s.site));
		return [...names].sort().map((site) => {
			const ns = nodes.data?.sites.find((s) => s.site === site);
			const ws = workers.data?.sites.find((s) => s.site === site);
			const siteNodes = (nodes.data?.items ?? []).filter((n) => n.site === site);
			const siteWorkers = (workers.data?.items ?? []).filter((w) => w.site === site);
			const gpus = siteNodes.reduce((a, n) => a + (n.max_gpu_count ?? 0), 0);
			const idle = siteWorkers.filter((w) => w.status === "IDLE").length;
			const busy = siteWorkers.filter((w) => w.status === "BUSY").length;
			const freshest = siteNodes
				.map((n) => secondsSince(n.last_seen))
				.filter((v): v is number => v !== null)
				.sort((a, b) => a - b)[0];
			return {
				site,
				nodesOk: ns?.ok ?? false,
				workersOk: ws?.ok ?? false,
				nodeCount: siteNodes.length,
				workerCount: siteWorkers.length,
				gpus,
				idle,
				busy,
				ms: Math.max(ns?.ms ?? 0, ws?.ms ?? 0),
				error: ns?.error || ws?.error,
				freshest: freshest ?? null,
			};
		});
	}, [nodes.data, workers.data]);

	const loading = nodes.loading || workers.loading;

	return (
		<TabShell
			subtitle="Live federation across every mesh behind lum.id/fm. Refreshes every 30s."
			loading={loading}
			error={nodes.error || workers.error}
			onRefresh={() => {
				nodes.refresh();
				workers.refresh();
			}}
		>
			{loading && !rows.length ? (
				<p className="text-sm text-slate-500">Loading…</p>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{rows.map((r) => {
						const degraded = !r.nodesOk || !r.workersOk;
						return (
							<div
								key={r.site}
								className={`rounded-lg border p-4 ${
									degraded ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-white"
								}`}
							>
								<div className="flex items-center justify-between">
									<h3 className="font-semibold text-slate-900">{r.site}</h3>
									<span
										className={`inline-flex items-center gap-1.5 text-xs ${
											degraded ? "text-red-700" : "text-emerald-700"
										}`}
									>
										<span
											className={`inline-block h-2 w-2 rounded-full ${
												degraded ? "bg-red-500" : "bg-emerald-500"
											}`}
										/>
										{degraded ? "degraded" : "reachable"}
									</span>
								</div>

								<dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
									<div>
										<dt className="text-xs text-slate-500">Nodes</dt>
										<dd className="font-medium text-slate-900">{r.nodeCount}</dd>
									</div>
									<div>
										<dt className="text-xs text-slate-500">Workers</dt>
										<dd className="font-medium text-slate-900">{r.workerCount}</dd>
									</div>
									<div>
										<dt className="text-xs text-slate-500">GPUs</dt>
										<dd className="font-medium text-slate-900">{r.gpus}</dd>
									</div>
								</dl>

								<p className="mt-2 text-xs text-slate-600">
									{r.idle} idle · {r.busy} busy · {r.ms}ms
								</p>
								<p className="mt-1 text-xs">
									newest heartbeat <Age seconds={r.freshest} />
								</p>

								{/* A site with zero workers is a normal, legible state — it is NOT
								    the same as a site that failed to answer, and the card must not
								    let the two look alike. */}
								{!degraded && r.workerCount === 0 && (
									<p className="mt-2 text-xs text-slate-500">
										Reachable with no workers — expected for an idle elastic site.
									</p>
								)}
								{degraded && (
									<p className="mt-2 text-xs text-red-700">
										{!r.nodesOk && "nodes "}
										{!r.workersOk && "workers "}
										unavailable{r.error ? ` — ${r.error}` : ""}. Counts shown are
										incomplete.
									</p>
								)}
							</div>
						);
					})}
				</div>
			)}
			<div className="mt-6">
				<SiteStrip sites={nodes.data?.sites ?? []} />
			</div>
		</TabShell>
	);
}
