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
