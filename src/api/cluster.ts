// lumid_cluster admin client. Hits /api/v1/cluster/* via the same
// lum.id nginx bridge as identity — same-origin + lm_session cookie
// auth means AdminGuard is the only gate we need on the frontend.

import apiClient from "./client";
import type { DataResponse } from "./types";

// ---- types ----

export type ClusterStatus = "active" | "disabled" | "pending";

export interface Cluster {
	id: string;
	name: string;
	region?: string;
	tags?: Record<string, unknown> | string[] | null;
	status: ClusterStatus;
	owner_user_id: string;
	billing_vendor_id?: string | null;
	created_at: string;
	updated_at: string;
}

export interface ClusterServer {
	id: string;
	cluster_id: string;
	role: "flowmesh" | "lumilake";
	host_url: string;
	storage_json?: Record<string, unknown> | null;
	status: string;
	last_seen?: string | null;
	created_at: string;
	updated_at: string;
}

export interface Node {
	id: string;
	cluster_id: string;
	hostname: string;
	address: string;
	ssh_user?: string;
	cpu_cores: number;
	memory_gb: number;
	gpu_count: number;
	gpu_type?: string;
	gpu_memory_gb: number;
	disk_gb: number;
	status: "active" | "draining" | "offline";
	labels?: Record<string, unknown> | null;
	last_seen?: string | null;
	created_at: string;
	updated_at: string;
}

export interface Worker {
	id: string;
	node_id: string;
	cluster_id: string;
	role: "flowmesh" | "lumilake";
	type: "cpu" | "gpu";
	gpu_index?: number | null;
	memory_limit_gb: number;
	// Supplier-side rate (what the platform pays the GPU owner).
	cost_per_hour: number;
	// User-facing rate (what we charge end users). Profit = sell - cost.
	selling_price_per_hour: number;
	status: "starting" | "idle" | "busy" | "stopping" | "stopped" | "lost";
	version?: string;
	cached_models?: string[] | Record<string, unknown> | null;
	last_heartbeat?: string | null;
	created_at: string;
	updated_at: string;
}

// ---- clusters ----

export interface ListClustersParams {
	status?: ClusterStatus | "all";
	q?: string;
	page?: number;
	page_size?: number;
}
export interface ListClustersResponse {
	clusters: Cluster[];
	total: number;
	page: number;
	page_size: number;
}

export async function listClusters(
	params: ListClustersParams = {},
): Promise<ListClustersResponse> {
	const r = await apiClient.get<DataResponse<ListClustersResponse>>(
		"/api/v1/cluster/clusters",
		{ params },
	);
	return r.data.data;
}

// Slim, secret-free cluster list for the Workspace picker — any authenticated
// user (the admin listClusters() above is RequireAdmin → 403 for normal users).
export interface SelectableCluster {
	id: string;
	name: string;
	region?: string;
	status: ClusterStatus;
}
export async function listSelectableClusters(): Promise<SelectableCluster[]> {
	const r = await apiClient.get<DataResponse<{ clusters: SelectableCluster[] }>>(
		"/api/v1/cluster/clusters/selectable",
	);
	return r.data.data.clusters || [];
}

export async function getCluster(id: string): Promise<Cluster> {
	const r = await apiClient.get<DataResponse<{ cluster: Cluster }>>(
		`/api/v1/cluster/clusters/${encodeURIComponent(id)}`,
	);
	return r.data.data.cluster;
}

export interface CreateClusterRequest {
	name: string;
	region?: string;
	tags?: Record<string, unknown> | string[];
	billing_vendor_id?: string | null;
}
export async function createCluster(
	req: CreateClusterRequest,
): Promise<Cluster> {
	const r = await apiClient.post<DataResponse<{ cluster: Cluster }>>(
		"/api/v1/cluster/clusters",
		req,
	);
	return r.data.data.cluster;
}

export interface PatchClusterRequest {
	name?: string;
	region?: string;
	status?: ClusterStatus;
	tags?: Record<string, unknown> | string[];
	billing_vendor_id?: string | null;
}
export async function patchCluster(
	id: string,
	req: PatchClusterRequest,
): Promise<Cluster> {
	const r = await apiClient.patch<DataResponse<{ cluster: Cluster }>>(
		`/api/v1/cluster/clusters/${encodeURIComponent(id)}`,
		req,
	);
	return r.data.data.cluster;
}

export async function deleteCluster(id: string): Promise<void> {
	await apiClient.delete(
		`/api/v1/cluster/clusters/${encodeURIComponent(id)}`,
	);
}

// ---- per-cluster servers ----

export async function listServers(
	clusterId: string,
): Promise<ClusterServer[]> {
	const r = await apiClient.get<DataResponse<{ servers: ClusterServer[] }>>(
		`/api/v1/cluster/clusters/${encodeURIComponent(clusterId)}/servers`,
	);
	return r.data.data.servers || [];
}

export interface UpsertServerRequest {
	host_url: string;
	storage?: Record<string, unknown>;
}
export async function upsertServer(
	clusterId: string,
	role: "flowmesh" | "lumilake",
	req: UpsertServerRequest,
): Promise<ClusterServer> {
	const r = await apiClient.put<DataResponse<{ server: ClusterServer }>>(
		`/api/v1/cluster/clusters/${encodeURIComponent(clusterId)}/server/${role}`,
		req,
	);
	return r.data.data.server;
}

export async function deleteServer(
	clusterId: string,
	role: "flowmesh" | "lumilake",
): Promise<void> {
	await apiClient.delete(
		`/api/v1/cluster/clusters/${encodeURIComponent(clusterId)}/server/${role}`,
	);
}

// ---- per-cluster proxy ----
//
// Forward a request to the cluster's registered FlowMesh / Lumilake host.
// `path` is appended verbatim to the cluster's `host_url`. The lumid-cluster
// proxy strips our session bearer and injects the operator key from
// `cluster_servers.storage_json.api_key` before forwarding.

export async function clusterProxyPost<T = unknown>(
	clusterId: string,
	path: string,
	body: BodyInit | string,
	opts?: { role?: "flowmesh" | "lumilake"; contentType?: string },
): Promise<T> {
	const role = opts?.role ?? "flowmesh";
	const headers: Record<string, string> = {
		"Content-Type": opts?.contentType || "application/json",
	};
	const url =
		`/api/v1/cluster/clusters/${encodeURIComponent(clusterId)}/proxy${
			path.startsWith("/") ? path : "/" + path
		}?role=${role}`;
	const r = await apiClient.post<T>(url, body, { headers });
	return r.data;
}

export async function clusterProxyGet<T = unknown>(
	clusterId: string,
	path: string,
	opts?: { role?: "flowmesh" | "lumilake" },
): Promise<T> {
	const role = opts?.role ?? "flowmesh";
	const url =
		`/api/v1/cluster/clusters/${encodeURIComponent(clusterId)}/proxy${
			path.startsWith("/") ? path : "/" + path
		}?role=${role}`;
	const r = await apiClient.get<T>(url);
	return r.data;
}

// ---- nodes ----

export interface ListNodesParams {
	cluster_id?: string;
	status?: Node["status"] | "all";
	page?: number;
	page_size?: number;
}
export interface ListNodesResponse {
	nodes: Node[];
	total: number;
	page: number;
	page_size: number;
}

export async function listNodes(
	params: ListNodesParams = {},
): Promise<ListNodesResponse> {
	const r = await apiClient.get<DataResponse<ListNodesResponse>>(
		"/api/v1/cluster/nodes",
		{ params },
	);
	return r.data.data;
}

export async function getNode(id: string): Promise<Node> {
	const r = await apiClient.get<DataResponse<{ node: Node }>>(
		`/api/v1/cluster/nodes/${encodeURIComponent(id)}`,
	);
	return r.data.data.node;
}

export interface PatchNodeRequest {
	hostname?: string;
	address?: string;
	ssh_user?: string;
	status?: Node["status"];
	labels?: Record<string, unknown>;
}
export async function patchNode(
	id: string,
	req: PatchNodeRequest,
): Promise<Node> {
	const r = await apiClient.patch<DataResponse<{ node: Node }>>(
		`/api/v1/cluster/nodes/${encodeURIComponent(id)}`,
		req,
	);
	return r.data.data.node;
}

export async function deleteNode(id: string): Promise<void> {
	await apiClient.delete(`/api/v1/cluster/nodes/${encodeURIComponent(id)}`);
}

export interface MintBootstrapRequest {
	cluster_id: string;
	ttl_minutes?: number;
}
export interface MintBootstrapResponse {
	token: string;
	token_id: string;
	expires_at: string;
	install_cmd: string;
}
export async function mintBootstrapToken(
	req: MintBootstrapRequest,
): Promise<MintBootstrapResponse> {
	const r = await apiClient.post<DataResponse<MintBootstrapResponse>>(
		"/api/v1/cluster/nodes/bootstrap-token",
		req,
	);
	return r.data.data;
}

// Force a re-push of every node in the cluster to Runmesh's supplier
// tables. No-op if the Runmesh bridge isn't configured server-side;
// the response .nodes count tells the caller how many were queued.
export async function remirrorCluster(
	id: string,
): Promise<{ nodes: number }> {
	const r = await apiClient.post<DataResponse<{ nodes: number }>>(
		`/api/v1/cluster/clusters/${encodeURIComponent(id)}/remirror`,
	);
	return r.data.data;
}

// Runmesh vendor view for the Commercial tab. `linked=false` means no
// node has ever registered for this cluster, so no vendor row exists yet.
export interface VendorView {
	linked: boolean;
	vendorId?: string;
	vendorName?: string;
	shortName?: string;
	brand?: string;
	country?: string;
	contactPerson?: string;
	contactPhone?: string;
	contactEmail?: string;
	supportLevel?: string;
	website?: string;
	address?: string;
	remark?: string;
	status?: string;
}

export async function getClusterVendor(id: string): Promise<VendorView> {
	const r = await apiClient.get<DataResponse<{ vendor: VendorView }>>(
		`/api/v1/cluster/clusters/${encodeURIComponent(id)}/vendor`,
	);
	return r.data.data.vendor;
}

// Commercial-fields patch. Identity fields (id, short_name, vendor_type)
// are bridge-managed and not exposed here.
export interface VendorPatchRequest {
	contact_person?: string;
	contact_phone?: string;
	contact_email?: string;
	support_level?: string;
	website?: string;
	address?: string;
	remark?: string;
}

export async function patchClusterVendor(
	id: string,
	req: VendorPatchRequest,
): Promise<void> {
	await apiClient.patch(
		`/api/v1/cluster/clusters/${encodeURIComponent(id)}/vendor`,
		req,
	);
}

// ---- workers ----

export interface ListWorkersParams {
	cluster_id?: string;
	node_id?: string;
	role?: "flowmesh" | "lumilake";
	type?: "cpu" | "gpu";
	status?: Worker["status"] | "all";
	page?: number;
	page_size?: number;
}
export interface ListWorkersResponse {
	workers: Worker[];
	total: number;
	page: number;
	page_size: number;
}

export async function listWorkers(
	params: ListWorkersParams = {},
): Promise<ListWorkersResponse> {
	const r = await apiClient.get<DataResponse<ListWorkersResponse>>(
		"/api/v1/cluster/workers",
		{ params },
	);
	return r.data.data;
}

// V2 FlowMesh's wire shape for /api/v1/workers. Lower-cased status is needed
// to feed back into our Worker.status union; the rest of V2's shape is mapped
// best-effort into lumid_cluster's Worker type so the admin UI can render
// both registry-registered (legacy cluster-agent enrolment) and V2-spawned
// (supervisor-managed) workers from one table.
interface V2Worker {
	id: string;
	alias?: string;
	namespace?: string;
	cluster?: string;
	node_id: string;
	node_alias?: string;
	status: string;
	hardware?: {
		cpu?: { logical_cores?: number } | null;
		memory?: { total_bytes?: number } | null;
		gpu?: { devices?: Array<{ index?: number; memory_total_bytes?: number }> | null } | null;
	} | null;
	cost_per_hour?: number;
	// Set by FM redis side-channel (lumid_cluster/scripts/apply_worker_pricing.sh
	// writes this into the worker hash; FlowMesh Host v0.1.2 doesn't serialize
	// it back out yet — pending FM Host patch). When missing, v2ToWorker
	// falls back to cost * 1.25 (operator default margin).
	selling_price_per_hour?: number;
	started_at?: string;
	last_seen?: string;
}

function v2ToWorker(v: V2Worker, clusterId: string): Worker {
	const devs = v.hardware?.gpu?.devices ?? [];
	const status = (v.status || "").toLowerCase();
	const validStatus =
		(["starting", "idle", "busy", "stopping", "stopped", "lost"] as const)
			.find((s) => s === status) ?? "starting";
	// Extract GPU index from alias when possible (worker_gpu_0 → 0, worker_gpu_1 → 1).
	// worker_gpu_all means the worker spans every GPU on the node; treat as 0 for display.
	// Falls back to hardware.gpu.devices[0].index, else 0 / null for CPU.
	let gpuIndex: number | null = null;
	if (devs.length > 0) {
		const m = v.alias?.match(/^worker_gpu_(\d+)$/);
		if (m) gpuIndex = Number.parseInt(m[1], 10);
		else if (typeof devs[0]?.index === "number") gpuIndex = devs[0].index;
		else gpuIndex = 0;
	}
	return {
		id: v.id,
		node_id: v.node_id,
		cluster_id: clusterId,
		role: "flowmesh",
		type: devs.length > 0 ? "gpu" : "cpu",
		gpu_index: gpuIndex,
		memory_limit_gb: Math.floor(
			(v.hardware?.memory?.total_bytes ?? 0) / (1024 * 1024 * 1024),
		),
		cost_per_hour: v.cost_per_hour ?? 0,
		// Fallback: when FM Host doesn't expose selling_price_per_hour, derive
		// from cost using the 25% operator-default margin. See V2Worker comment.
		selling_price_per_hour:
			v.selling_price_per_hour ?? Math.round((v.cost_per_hour ?? 0) * 1.25 * 1000) / 1000,
		status: validStatus,
		version: undefined,
		cached_models: null,
		last_heartbeat: v.last_seen ?? null,
		created_at: v.started_at ?? new Date().toISOString(),
		updated_at: v.last_seen ?? v.started_at ?? new Date().toISOString(),
	};
}

interface V2Node {
	id: string;        // FM node id, e.g. "nde-6"
	alias?: string;    // hostname, e.g. "luyao0"
	last_seen?: string;
}

// Fetch the live worker + node list from the cluster's upstream V2 FlowMesh
// Server. Returns workers with node_id REMAPPED to the cluster-registry
// node UUID (via alias↔hostname match), plus a fresh `last_seen` overlay
// keyed by cluster-registry node id. Without the remap, the dashboard's
// nodes table can't join workers (V2 node_id is "nde-N", registry id is
// UUID) — Workers column shows 0 and the Node column in the workers
// table shows a truncated FM id instead of the hostname.
export async function listV2WorkersForCluster(
	clusterId: string,
	clusterNodes: Node[] = [],
): Promise<{ workers: Worker[]; nodeLastSeenByClusterId: Map<string, string> }> {
	const fallback = { workers: [], nodeLastSeenByClusterId: new Map<string, string>() };
	try {
		const [rawWorkers, rawNodes] = await Promise.all([
			clusterProxyGet<V2Worker[]>(clusterId, "/api/v1/workers"),
			clusterProxyGet<V2Node[]>(clusterId, "/api/v1/nodes").catch(() => [] as V2Node[]),
		]);
		if (!Array.isArray(rawWorkers)) return fallback;

		// FM-id (nde-N) → cluster-registry UUID, via alias↔hostname
		const aliasToClusterId = new Map<string, string>();
		clusterNodes.forEach((n) => { if (n.hostname) aliasToClusterId.set(n.hostname, n.id); });
		const fmIdToClusterId = new Map<string, string>();
		const nodeLastSeenByClusterId = new Map<string, string>();
		(rawNodes ?? []).forEach((v) => {
			const cid = v.alias ? aliasToClusterId.get(v.alias) : undefined;
			if (cid) {
				fmIdToClusterId.set(v.id, cid);
				if (v.last_seen) nodeLastSeenByClusterId.set(cid, v.last_seen);
			}
		});

		const workers = rawWorkers.map((v) => {
			const w = v2ToWorker(v, clusterId);
			const mapped = fmIdToClusterId.get(v.node_id);
			if (mapped) w.node_id = mapped;
			return w;
		});
		return { workers, nodeLastSeenByClusterId };
	} catch {
		return fallback;
	}
}

export async function deleteWorker(id: string): Promise<void> {
	await apiClient.delete(`/api/v1/cluster/workers/${encodeURIComponent(id)}`);
}

export interface PatchWorkerRequest {
	cost_per_hour?: number;
	selling_price_per_hour?: number;
	memory_limit_gb?: number;
}

export async function patchWorker(
	id: string,
	req: PatchWorkerRequest,
): Promise<Worker> {
	const r = await apiClient.patch<DataResponse<{ worker: Worker }>>(
		`/api/v1/cluster/workers/${encodeURIComponent(id)}`,
		req,
	);
	return r.data.data.worker;
}
