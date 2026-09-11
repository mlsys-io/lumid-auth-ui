// Client for sandbox-control (home SSH sandboxes), served at lum.id/sbx/.
//
// Reuses the SAME flowmesh session-bearer fm.ts already mints: lum.id's
// /oauth/userinfo does not check the audience, and sandbox-control introspects
// there. Verified before building this, because the alternative — teaching
// identity a new audience — would have been a much larger change for no gain.
//
// sandbox-control must SEE the caller's own token: it reads that user's SSH keys
// AS them, so there is no service credential anywhere in this path and no way for
// one user's request to touch another's keys.

import axios, { type AxiosInstance } from "axios";
import { getFlowmeshBearer } from "./flowmesh";

const SBX_BASE = "/sbx";

export interface Sandbox {
	name: string;
	pod: string;
	/** Running | Pending | Queued | Succeeded | Failed */
	phase: string;
	node?: string | null;
	gpu: number;
	expires_at?: string | null;
	/** Set when phase is Queued — what the scheduler is waiting for. */
	waiting_for?: string;
	/** "free/total" across sandbox-capable nodes, when a GPU was asked for. */
	gpus_free?: string;
}

export interface SandboxList {
	sandboxes: Sandbox[];
	gpus_free: string;
}

export interface CreateSandboxRequest {
	name: string;
	image?: string;
	cpu?: number;
	memory_gi?: number;
	gpu?: number;
	ttl_hours?: number;
}

function client(): AxiosInstance {
	const c = axios.create({ baseURL: SBX_BASE, timeout: 180_000 });
	c.interceptors.request.use(async (cfg) => {
		const t = await getFlowmeshBearer();
		if (t) {
			cfg.headers = cfg.headers ?? {};
			(cfg.headers as Record<string, string>).Authorization = `Bearer ${t}`;
		}
		return cfg;
	});
	return c;
}

const sbx = client();

export async function whoami(): Promise<{ email: string; user: string; admin: boolean }> {
	return (await sbx.get("/api/whoami")).data;
}

export async function listSandboxes(): Promise<SandboxList> {
	const r = await sbx.get<SandboxList>("/api/sandboxes");
	return { sandboxes: r.data?.sandboxes ?? [], gpus_free: r.data?.gpus_free ?? "" };
}

export async function createSandbox(req: CreateSandboxRequest): Promise<Sandbox> {
	return (await sbx.post("/api/sandboxes", req)).data;
}

export async function deleteSandbox(name: string): Promise<void> {
	await sbx.delete(`/api/sandboxes/${encodeURIComponent(name)}`);
}

/** Re-mirror the caller's lum.id SSH keys into the gateway. */
export async function syncKeys(): Promise<{ user: string; keys_authorized: number; hint?: string | null }> {
	return (await sbx.post("/api/keys/sync")).data;
}

/** What a user types to get in. One port for everyone; the key decides whose pod. */
export const SSH_COMMAND = "ssh -p 31223 gw@lum.id";
