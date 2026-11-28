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

import { useEffect, useMemo, useState } from "react";
import { fleet, type FleetJob } from "../../api/fleet";
import { USER_SANDBOX_SITES } from "../../api/sandboxes";
import { countOf, fleetAccessNote } from "../../lib/fleet-view";
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
import { Age, SiteBadge, SiteStrip, StatusPill, TabShell, shortGpu, useFanout } from "./shared";
import VastEconomics from "./vast-economics";

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
	const name = shortGpu(d[0].name ?? "GPU");
	return d.length > 1 ? `${d.length}× ${name}` : name;
}

/** The one GPU label shared by every live worker at a site, or "" when mixed.
 *  A site whose workers all run the same card should say so ONCE in its header
 *  rather than repeating it down every row — at home that was the same 41-char
 *  string five times. */
function uniformGpu(workers: FmWorker[]): string {
	const labels = new Set(workers.filter((w) => w.hardware?.gpu?.devices?.length).map(gpuLabel));
	return labels.size === 1 ? [...labels][0] : "";
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

	// Where the person's own runs went (identity's records, one small read), so
	// the note can name the sites their work actually used.
	const [myJobs, setMyJobs] = useState<FleetJob[] | null>(null);
	useEffect(() => {
		if (isAdmin) return;
		let live = true;
		fleet.list({ limit: 30 }).then((r) => { if (live) setMyJobs(r.jobs ?? []); }).catch(() => {});
		return () => { live = false; };
	}, [isAdmin]);
	const accessNote = isAdmin
		? null
		: fleetAccessNote({ listed: PUBLIC_SITE, hidden: ["office", "cloud", "vast", "nus"], sandboxSites: USER_SANDBOX_SITES, jobs: myJobs });

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
				`${countOf(counts.live, "live worker")}${counts.busy ? `, ${counts.busy} busy` : ""}` +
				`${counts.total > counts.live ? ` · ${countOf(counts.total - counts.live, "stale row")} excluded` : ""}` +
				(isAdmin ? " · every federated site" : " · home fleet") +
				". Refreshes every 30s."
			}
			loading={loading}
			error={nodes.error || workers.error}
			onRefresh={refresh}
		>
			<SiteStrip sites={nodes.data?.sites ?? []} />

			{/* It used to say office was "restricted to admins" while every GPU
			    measurement the person ran had run there (2026-11-28 sweep). Only the
			    machine LISTS are admin-only; the note says where their work runs. */}
			{accessNote && (
				<div className="mb-3 space-y-0.5 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-700" data-testid="fleet-access-note">
					{accessNote.map((line, i) => <p key={i}>{line}</p>)}
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
				<div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
					<p className="text-sm font-medium text-slate-700">No nodes to show.</p>
					{/* "Empty" and "not allowed to see it" are the SAME RESPONSE on this
					    surface — per-site reads answer 200 with an empty array when the
					    caller owns nothing, which is exactly what a non-admin got before
					    the federator's public-read grant existed. It read as an outage.
					    If that ever regresses, say so here rather than implying the
					    fleet is down. */}
					<p className="mx-auto mt-1 max-w-prose text-xs text-slate-500">
						{isAdmin
							? "No site returned a node. Check the per-site status above — a site that errored is reported there, and an empty result from a healthy site means the mesh really has no nodes registered."
							: "Either the home fleet is genuinely empty, or your account cannot read it. This is not necessarily an outage — the per-site status above shows which sites answered."}
					</p>
				</div>
			)}

			{/* One section per site; inside it EACH MACHINE IS A BOX (operator, 2026-11-28: "each machine can be a
			    box not a row"), boxes flowing across the width (>= 260px each), one column on a phone. */}
			<div className="space-y-4">
				{tree.map(([site, entries]) => {
					const siteLive = entries.reduce(
						(a, e) => a + e.workers.filter((w) => isLive(w.last_seen)).length,
						0,
					);
					const siteGpu = uniformGpu(entries.flatMap((e) => e.workers));
					return (
						<div key={site} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
							<div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
								<div className="flex items-center gap-2">
									<SiteBadge site={site} />
									<span className="text-xs text-slate-500">
										{countOf(entries.length, "node")} · {countOf(siteLive, "live worker")}
										{siteGpu ? ` · ${siteGpu}` : ""}
									</span>
								</div>
							</div>
							{/* Vast is a site, so its rental economics render HERE rather than
							    in a tab of their own — the old Vast tab re-listed these same
							    workers and added only the money. */}
							{site === "vast" && (
								<VastEconomics
									workers={entries.flatMap((e) => e.workers)}
								/>
							)}
							<div className="grid gap-3 p-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
								{entries.map((e) => {
									const nodeLive = isLive(e.node.last_seen);
									const shown = showStale
										? e.workers
										: e.workers.filter((w) => isLive(w.last_seen));
									if (!showStale && !nodeLive && shown.length === 0) return null;
									const busy = shown.filter((w) => String(w.status).toUpperCase() !== "IDLE").length;
									return (
										<div
											key={`${site}:${e.node.id}`}
											data-node={e.node.alias ?? e.node.id}
											className={`flex flex-col rounded-md border bg-card p-3 text-sm shadow-e1 ${nodeLive ? "border-ink-200" : "border-ember-200/70 opacity-75"}`}
										>
											<div className="flex items-baseline justify-between gap-2">
												<span className="truncate font-medium text-ink-900" title={e.node.id}>
													{e.node.alias ?? e.node.id}
												</span>
												<span className="shrink-0 text-caption text-ink-600">
													<Age seconds={secondsSince(e.node.last_seen)} />
												</span>
											</div>
											<div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-ink-600">
												<span className="font-mono">{e.node.id}</span>
												<span>
													{shown.length} worker{shown.length === 1 ? "" : "s"}
													{busy ? ` · ${busy} busy` : ""}
												</span>
												{!nodeLive && <span className="rounded bg-ember-50 px-1 text-ember-700">stale</span>}
											</div>
											{shown.length === 0 ? (
												<div className="mt-2 text-caption text-ink-600">no live workers</div>
											) : (
												<div className="mt-2 space-y-1">
													{shown.map((w) => (
														<div
															key={`${w.site}:${w.id}`}
															className={`flex flex-wrap items-center gap-1.5 rounded border border-ink-100 bg-ink-50/60 px-2 py-1 text-caption ${
																isLive(w.last_seen) ? "" : "opacity-50"
															}`}
														>
															<StatusPill status={w.status} />
															<span className="font-medium text-ink-800">{w.alias ?? w.id}</span>
															{gpuLabel(w) !== siteGpu && <span className="text-ink-600">{gpuLabel(w)}</span>}
															{/* The 1.0 default is WORKER_COST_PER_HOUR, not a price —
															    rendering it printed "$1.000" for boxes we own outright. */}
															{w.cost_per_hour != null && w.cost_per_hour !== FM_DEFAULT_COST_PER_HOUR && (
																<span className="text-ink-600">${w.cost_per_hour.toFixed(3)}/hr</span>
															)}
															{(w.tags ?? []).map((t) => (
																<span key={t} className="rounded bg-ink-100 px-1 text-ink-600">{t}</span>
															))}
															<span className="ml-auto text-ink-600" title={w.id}>
																<Age seconds={secondsSince(w.last_seen)} />
															</span>
														</div>
													))}
												</div>
											)}
										</div>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</TabShell>
	);
}
