// Research Fleet jobs — run / get / cancel against identity's /me/fleet/jobs.
//
// One client for work on the fleet, whichever backend runs it: a FlowMesh
// compute graph (kind "fm") or a Lumilake workflow ("ll"). Ids are
// "<site>:<kind>:<native>" and statuses are one vocabulary, so a caller never
// branches on the backend to read a job. The work runs upstream as the signed-in
// user; the browser never holds a FlowMesh or Lumilake credential.

import { meRequest } from "./me";

export type FleetStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type FleetFormat = "flowmesh" | "lumilake" | "auto";
export type FleetView = "status" | "result" | "logs" | "trace";

export const FLEET_TERMINAL: ReadonlySet<FleetStatus> = new Set(["succeeded", "failed", "canceled"]);

export interface FleetJob {
	id: string;
	site: string;
	kind: "fm" | "ll";
	format?: "flowmesh" | "lumilake";
	status: FleetStatus;
	terminal: boolean;
	name?: string;
	labels?: { study?: string; experiment?: string };
	created_at?: string;
}

export interface FleetJobStatus extends FleetJob {
	native_status: string;
	error?: unknown;
	progress?: Record<string, unknown>;
	tasks?: number;
}

export interface FleetJobResult {
	id: string;
	outputs: unknown;
	/** Merged metrics.json of every Python step — what an experiment records. */
	metrics: Record<string, number>;
}

export interface FleetRunRequest {
	workflow: string;
	format?: FleetFormat;
	site?: string;
	inputs?: Record<string, unknown>;
	dry_run?: boolean;
	name?: string;
	labels?: { study?: string; experiment?: string };
}

export interface FleetDryRun {
	dry_run: true;
	valid: boolean;
	format: "flowmesh" | "lumilake";
	site: string;
	detail?: unknown;
}

export const fleet = {
	run: (req: FleetRunRequest) => meRequest<FleetJob>("POST", "/fleet/jobs", req),
	validate: (req: FleetRunRequest) =>
		meRequest<FleetDryRun>("POST", "/fleet/jobs", { ...req, dry_run: true }),
	list: (filter: { study?: string; experiment?: string; status?: FleetStatus; limit?: number } = {}) => {
		const q = new URLSearchParams();
		for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== "") q.set(k, String(v));
		const qs = q.toString();
		return meRequest<{ jobs: FleetJob[] }>("GET", `/fleet/jobs${qs ? `?${qs}` : ""}`);
	},
	status: (id: string) => meRequest<FleetJobStatus>("GET", `/fleet/jobs/${encodeURIComponent(id)}`),
	result: (id: string) =>
		meRequest<FleetJobResult>("GET", `/fleet/jobs/${encodeURIComponent(id)}?view=result`),
	logs: (id: string) =>
		meRequest<{ id: string; logs: unknown }>("GET", `/fleet/jobs/${encodeURIComponent(id)}?view=logs`),
	trace: (id: string) =>
		meRequest<{ id: string; workflows: Array<{ id: string; status: FleetStatus }> }>(
			"GET", `/fleet/jobs/${encodeURIComponent(id)}?view=trace`),
	cancel: (id: string) =>
		meRequest<{ id: string; cancel_requested: boolean }>("POST", `/fleet/jobs/${encodeURIComponent(id)}/cancel`),
};
