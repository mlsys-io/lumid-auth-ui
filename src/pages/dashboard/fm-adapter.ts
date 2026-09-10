// Adapts the live mesh-federator view (`/fm`) into the registry-shaped types the
// admin overview tiles already consume.
//
// WHY AN ADAPTER RATHER THAN A REWRITE. The tiles (ClusterStat, NodeStat,
// WorkerStat, ClusterBreakdown in overview.tsx) are correct and well-tested
// against `Cluster`/`Node`/`Worker` from api/cluster.ts. The only thing wrong
// with them was their DATA SOURCE: the lumid_cluster mirror, a MySQL copy
// refreshed by a CronJob every 4 minutes and covering one site only. Mapping at
// the boundary keeps the rendering untouched and makes the source swappable.
//
// WHY IT MATTERS THAT THIS EXISTS AT ALL. Retiring `fm-registry-sync` does not
// freeze those tables, it EMPTIES them: lumid-cluster's sweeper flips workers to
// `lost` after 5 minutes without a heartbeat, nodes to `offline` after 15, and
// DELETEs them 24h later. Mirrored rows have no heartbeat of their own, so the
// sync is the only thing keeping them alive. Until this page reads `/fm`, the
// admin landing page is a hard blocker on retiring the mirror.
//
// THE VOCABULARIES DIFFER AND THE DIFFERENCE IS LOAD-BEARING:
//   registry: lowercase `idle|busy|starting|stopping|stopped|lost`, `last_heartbeat`
//   /fm:      uppercase `IDLE|BUSY|STARTING|UNKNOWN`,                `last_seen`
// Mapping them by hand here — rather than loosening the tile types — keeps the
// mismatch in one reviewable place.

import type { Cluster, Node, Worker } from "../../api/cluster";
import { nodeTags, type FmNode, type FmSiteStatus, type FmWorker } from "../../api/fm";

/** Synthetic id for a federated site, so tiles can join nodes/workers to it. */
function siteId(site: string): string {
	return `site:${site}`;
}

/**
 * Each federated site becomes one "cluster" row.
 *
 * `ok` maps to `active`, and an unreachable site to `disabled` rather than
 * `pending` — ClusterStat renders a warn tone when zero are active, which is the
 * signal we want when a mesh is down. A site that is reachable with no workers
 * stays `active`: that is a normal idle state for an elastic site, not a fault.
 */
export function sitesToClusters(sites: FmSiteStatus[]): Cluster[] {
	const now = new Date().toISOString();
	return sites.map((s) => ({
		id: siteId(s.site),
		name: s.site,
		status: (s.ok ? "active" : "disabled") as Cluster["status"],
		owner_user_id: "",
		created_at: now,
		updated_at: now,
	}));
}

/**
 * FlowMesh nodes have no explicit lifecycle status — liveness is heartbeat
 * freshness — so derive one. 300s matches the staleness threshold the tiles
 * already use via `isStale(n.last_seen, 300)`.
 */
export function fmNodesToNodes(nodes: FmNode[]): Node[] {
	const now = new Date().toISOString();
	return nodes.map((n) => {
		const age = n.last_seen ? (Date.now() - Date.parse(n.last_seen)) / 1000 : Infinity;
		const status: Node["status"] = Number.isFinite(age) && age < 900 ? "active" : "offline";
		const tags = nodeTags(n);
		return {
			id: n.id,
			cluster_id: siteId(n.site ?? "cloud"),
			hostname: n.alias,
			address: "",
			cpu_cores: 0,
			memory_gb: 0,
			gpu_count: n.max_gpu_count ?? 0,
			gpu_type: tags.find((t) => t !== "gpu"),
			gpu_memory_gb: 0,
			disk_gb: 0,
			status,
			last_seen: n.last_seen ?? null,
			created_at: n.started_at ?? now,
			updated_at: now,
		};
	});
}

/**
 * Registry statuses the tiles count. `UNKNOWN` maps to `lost` because that is
 * what it means operationally — the worker exists in the registry but is not
 * reporting — and `lost` is the bucket the tiles already surface as a problem.
 */
const WORKER_STATUS: Record<string, Worker["status"]> = {
	IDLE: "idle",
	BUSY: "busy",
	STARTING: "starting",
	UNKNOWN: "lost",
};

export function fmWorkersToWorkers(workers: FmWorker[]): Worker[] {
	const now = new Date().toISOString();
	return workers.map((w) => {
		const gpuCount = w.hardware?.gpu?.devices?.length ?? 0;
		const cost = w.cost_per_hour ?? w.hardware?.gpu?.cost_per_hour ?? 0;
		return {
			id: w.id,
			node_id: w.node_id,
			cluster_id: siteId(w.site ?? "cloud"),
			role: "flowmesh" as const,
			type: (gpuCount > 0 || (w.tags ?? []).includes("gpu") ? "gpu" : "cpu") as Worker["type"],
			memory_limit_gb: 0,
			cost_per_hour: cost,
			// The registry stores an operator-set margin; /fm has no such field, so
			// this is left equal to cost rather than invented. Any profit column fed
			// from here would be reporting a number nobody set.
			selling_price_per_hour: cost,
			status: WORKER_STATUS[String(w.status).toUpperCase()] ?? "lost",
			version: w.version ?? undefined,
			cached_models: w.cached_models ?? null,
			// /fm exposes one freshness field; the tiles read `last_heartbeat` for
			// workers and `last_seen` for nodes. Same underlying signal.
			last_heartbeat: w.last_seen ?? null,
			created_at: w.started_at ?? now,
			updated_at: now,
		};
	});
}
