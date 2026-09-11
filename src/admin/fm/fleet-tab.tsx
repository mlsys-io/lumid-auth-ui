// Fleet — the consolidated Sites + Nodes + Workers view.
//
// Those were three sibling tabs showing three slices of ONE tree: a site has
// nodes, a node has workers. Answering "is home healthy?" meant visiting all
// three and joining them by hand, and each slice repeated the others' context
// (Workers already printed the site and the node, Nodes already printed the
// site). One tree renders the relationship instead of asking the reader to
// reconstruct it.
//
// ACCESS. The HOME site is readable by any signed-in user; every other site is
// admin+. That split is enforced twice on purpose:
//   - here, by which sites we even ask for, and
//   - at the edge, where `/fm/api/v1/…` (the merged read) carries
//     auth_request /internal_admin_check while the per-site `/fm/<site>/…`
//     prefix does not.
// A non-admin therefore uses the per-site path (see listNodesForSite) and an
// admin uses the merged one. Reversing that gives a non-admin a 403 from nginx
// that renders exactly like an outage.

import { useMemo, useState } from "react";
import {
	FM_DEFAULT_COST_PER_HOUR,
	fanoutForSites,
	listNodes,
	listNodesForSite,
	listWorkers,
	listWorkersForSite,
	secondsSince,
	type FmNode,
	type FmWorker,
} from "../../api/fm";
import { Age, SiteBadge, SiteStrip, StatusPill, TabShell, useFanout } from "./shared";

// A registry row outlives its machine — a destroy is not a graceful UNREGISTER —
// so "present" is never the same question as "alive". Everything below judges on
// heartbeat age, not on the row existing.
const STALE_SEC = 300;

export const PUBLIC_SITE = "home";

function isLive(lastSeen?: string | null): boolean {
	const age = secondsSince(lastSeen ?? null);
	return age !== null && age < STALE_SEC;
}

function gpuLabel(w: FmWorker): string {
	const d = w.hardware?.gpu?.devices;
	if (!d?.length) return "—";
	const name = d[0].name ?? "GPU";
	return d.length > 1 ? `${d.length}× ${name}` : name;
}

export default function FleetTab({ isAdmin }: { isAdmin: boolean }) {
	// Non-admins ask only for home, over the per-site prefix. Admins get the
	// merged read, which is the only one that can report a site being DOWN.
	const nodes = useFanout<FmNode>(
		() =>
			isAdmin
				? listNodes()
				: fanoutForSites([PUBLIC_SITE], listNodesForSite),
		30_000,
	);
	const workers = useFanout<FmWorker>(
		() =>
			isAdmin
				? listWorkers()
				: fanoutForSites([PUBLIC_SITE], listWorkersForSite),
		30_000,
	);

	const [showStale, setShowStale] = useState(false);

	const tree = useMemo(() => {
		const ns = nodes.data?.items ?? [];
		const ws = workers.data?.items ?? [];
		const byNode = new Map<string, FmWorker[]>();
		for (const w of ws) {
			const k = `${w.site ?? ""}:${w.node_id ?? ""}`;
			(byNode.get(k) ?? byNode.set(k, []).get(k)!).push(w);
		}
		const bySite = new Map<string, { node: FmNode; workers: FmWorker[] }[]>();
		for (const n of ns) {
			const site = n.site ?? "?";
			const entry = { node: n, workers: byNode.get(`${site}:${n.id}`) ?? [] };
			(bySite.get(site) ?? bySite.set(site, []).get(site)!).push(entry);
		}
		// Workers whose node row is missing entirely would otherwise vanish from a
		// node-keyed tree — surface them rather than lose them.
		const placed = new Set(ns.map((n) => `${n.site ?? "?"}:${n.id}`));
		for (const w of ws) {
			const k = `${w.site ?? "?"}:${w.node_id ?? ""}`;
			if (placed.has(k)) continue;
			const site = w.site ?? "?";
			const list = bySite.get(site) ?? bySite.set(site, []).get(site)!;
			let orphan = list.find((e) => e.node.id === w.node_id);
			if (!orphan) {
				orphan = { node: { id: w.node_id ?? "(unknown node)", site } as FmNode, workers: [] };
				list.push(orphan);
			}
			orphan.workers.push(w);
		}
		for (const [, list] of bySite) {
			list.sort((a, b) =>
				(a.node.alias ?? a.node.id ?? "").localeCompare(b.node.alias ?? b.node.id ?? ""),
			);
		}
		return [...bySite.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	}, [nodes.data, workers.data]);

	const counts = useMemo(() => {
		const ws = workers.data?.items ?? [];
		const live = ws.filter((w) => isLive(w.last_seen));
		return { live: live.length, total: ws.length, busy: live.filter((w) => w.status === "BUSY").length };
	}, [workers.data]);

	const loading = nodes.loading || workers.loading;
	const refresh = () => {
		nodes.refresh();
		workers.refresh();
	};

	return (
		<TabShell
			subtitle={
				`${counts.live} live worker(s)${counts.busy ? `, ${counts.busy} busy` : ""}` +
				`${counts.total > counts.live ? ` · ${counts.total - counts.live} stale row(s) excluded` : ""}` +
				(isAdmin ? " · every federated site" : " · home fleet") +
				". Refreshes every 30s."
			}
			loading={loading}
			error={nodes.error || workers.error}
			onRefresh={refresh}
		>
			<SiteStrip sites={nodes.data?.sites ?? []} />

			{!isAdmin && (
				<div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
					Showing the <strong>home</strong> fleet. The office, cloud, vast and NUS meshes are
					restricted to admins.
				</div>
			)}

			<label className="mb-3 flex items-center gap-2 text-xs text-slate-600">
				<input
					type="checkbox"
					checked={showStale}
					onChange={(e) => setShowStale(e.target.checked)}
					className="rounded border-slate-300"
				/>
				Show stale rows (heartbeat older than {STALE_SEC / 60} min — a destroyed machine leaves
				its registry row behind)
			</label>

			{tree.length === 0 && !loading && (
				<div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
					No nodes reachable.
				</div>
			)}

			<div className="space-y-4">
				{tree.map(([site, entries]) => {
					const siteLive = entries.reduce(
						(a, e) => a + e.workers.filter((w) => isLive(w.last_seen)).length,
						0,
					);
					return (
						<div key={site} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
							<div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
								<div className="flex items-center gap-2">
									<SiteBadge site={site} />
									<span className="text-xs text-slate-500">
										{entries.length} node(s) · {siteLive} live worker(s)
									</span>
								</div>
							</div>
							<table className="w-full text-sm">
								<tbody className="divide-y divide-slate-100">
									{entries.map((e) => {
										const nodeLive = isLive(e.node.last_seen);
										const shown = showStale
											? e.workers
											: e.workers.filter((w) => isLive(w.last_seen));
										if (!showStale && !nodeLive && shown.length === 0) return null;
										return (
											<tr key={`${site}:${e.node.id}`} className="align-top">
												<td className="px-3 py-2">
													<div className="flex flex-wrap items-baseline gap-2">
														<span className="font-medium text-slate-900">
															{e.node.alias ?? e.node.id}
														</span>
														<span className="font-mono text-xs text-slate-500">{e.node.id}</span>
														{!nodeLive && (
															<span className="rounded bg-amber-50 px-1 text-xs text-amber-700">
																stale
															</span>
														)}
														<span className="text-xs text-slate-400">
															<Age seconds={secondsSince(e.node.last_seen)} />
														</span>
													</div>

													{shown.length === 0 ? (
														<div className="mt-1 text-xs text-slate-400">
															no live workers
														</div>
													) : (
														<div className="mt-2 space-y-1">
															{shown.map((w) => (
																<div
																	key={`${w.site}:${w.id}`}
																	className={`flex flex-wrap items-center gap-2 rounded border border-slate-100 bg-slate-50/60 px-2 py-1 text-xs ${
																		isLive(w.last_seen) ? "" : "opacity-50"
																	}`}
																>
																	<StatusPill status={w.status} />
																	<span className="font-medium text-slate-800">
																		{w.alias ?? w.id}
																	</span>
																	<span className="font-mono text-slate-500">{w.id}</span>
																	<span className="text-slate-600">{gpuLabel(w)}</span>
																	{/* The 1.0 default is WORKER_COST_PER_HOUR, not a price —
																	    rendering it printed "$1.000" for boxes we own outright. */}
																	{w.cost_per_hour != null &&
																		w.cost_per_hour !== FM_DEFAULT_COST_PER_HOUR && (
																			<span className="text-slate-600">
																				${w.cost_per_hour.toFixed(3)}/hr
																			</span>
																		)}
																	{(w.tags ?? []).map((t) => (
																		<span
																			key={t}
																			className="rounded bg-slate-200/70 px-1 text-slate-600"
																		>
																			{t}
																		</span>
																	))}
																	<span className="ml-auto text-slate-400">
																		<Age seconds={secondsSince(w.last_seen)} />
																	</span>
																</div>
															))}
														</div>
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					);
				})}
			</div>
		</TabShell>
	);
}
