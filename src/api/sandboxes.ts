// Client for sandbox-control — SSH sandboxes, now on every k8s sandbox site.
//
// Reuses the SAME flowmesh session-bearer fm.ts already mints: lum.id's
// /oauth/userinfo does not check the audience, and sandbox-control introspects
// there. Verified before building this, because the alternative — teaching
// identity a new audience — would have been a much larger change for no gain.
//
// sandbox-control must SEE the caller's own token: it reads that user's SSH keys
// AS them, so there is no service credential anywhere in this path and no way for
// one user's request to touch another's keys. That is also why the office/nus
// routes go through mesh-federator rather than lumid_cluster's ClusterProxy —
// the latter deliberately deletes the caller's Authorization and substitutes a
// per-cluster operator key, which would provision as somebody else.
//
// ---------------------------------------------------------------------------
// HOME IS `/sbx`, NOT `/sbx/home`. THIS IS NOT AN INCONSISTENCY TO TIDY.
// ---------------------------------------------------------------------------
// nginx serves the bare `/sbx/` location straight to home's sandbox-control with
// NO auth_request, because home is the site any signed-in user may use and
// sandbox-control authenticates every request itself. `^/sbx/(office|nus)/` is a
// separate, admin-gated regex location that proxies to mesh-federator. So the
// two shapes are two different access boundaries wearing one prefix — and
// `/sbx/home/...` is NOT a route: it would fall through to the bare location and
// reach home's service as the path `/home/api/...`, which 404s. Always build the
// URL with sbxUrl().

import axios, { AxiosError, type AxiosInstance } from "axios";
import { getFlowmeshBearer } from "./flowmesh";
import type { FmSshInfo, FmTask } from "./fm";

const SBX_BASE = "/sbx";

/** The site whose sandboxes every signed-in user may use. */
export const PUBLIC_SANDBOX_SITE = "home";

/** Sites that run a sandbox-control. `vast` is deliberately absent — see ComputeShell. */
export const SANDBOX_SITES = ["home", "office", "nus"];

/**
 * Request path for a site.
 *
 * home -> `/sbx/...` (public location), everything else -> `/sbx/<site>/...`
 * (admin-gated, via mesh-federator).
 */
export function sbxUrl(site: string, path: string): string {
	return site === PUBLIC_SANDBOX_SITE ? `${SBX_BASE}${path}` : `${SBX_BASE}/${site}${path}`;
}

export interface Sandbox {
	name: string;
	pod: string;
	/** Running | Pending | Queued | Terminating | Succeeded | Failed */
	phase: string;
	node?: string | null;
	image?: string | null;
	gpu: number;
	/** Epoch seconds, as a string — it is a pod annotation. */
	expires_at?: string | null;
	created?: string | null;
	/** Set when phase is Queued — what the scheduler is waiting for. */
	waiting_for?: string;
	/** "free/total" across sandbox-capable nodes, when the site reports one. */
	gpus_free?: string;
	/** Injected by this client so a merged list stays actionable. */
	site?: string;
}

/**
 * What GPU a site actually has, and how many ONE sandbox may have.
 *
 * `max_per_sandbox` is the field that matters and the one `gpus_free` could never express.
 * A sandbox is a single Pod, and a Pod runs on a single node — so the ceiling for one
 * sandbox is `max(per-node GPUs)`, not the site total. Home has FOUR GPUs and a ceiling of
 * ONE, because they sit one-per-machine in four separate minis. Rendering "4 free" next to a
 * selector offering "2" told users they could have something that can never be scheduled.
 *
 * `model`/`memory_gb`/`driver` come from gpu-feature-discovery and are OPTIONAL: a site that
 * does not run GFD reports counts only. Treat every one of them as possibly absent.
 * `models`/`drivers` (plural) appear instead when the pool is NOT uniform — a mixed pool must
 * not be described by one name.
 */
export interface GpuProfile {
	total: number;
	max_per_sandbox: number;
	nodes: number;
	model?: string;
	models?: string[];
	memory_gb?: number;
	driver?: string;
	drivers?: string[];
}

/**
 * A data source a sandbox can be ATTACHED to — not a dataset to copy.
 *
 * Selecting one injects the env a client needs to reach a live store; it mounts
 * nothing and materialises nothing. FinData is a warehouse, so the useful thing
 * is to run the query there and bring back a result, not to drag a corpus into
 * the sandbox where it is stale on arrival and has lost its lineage.
 *
 * Served per-site: the address differs (home reaches the data primary on the
 * LAN, office over the tailnet), so this is never hardcoded here.
 */
export interface DataSource {
	id: string;
	label?: string;
	note?: string;
	hint?: string;
}

export interface SandboxList {
	sandboxes: Sandbox[];
	gpus_free: string;
	/** Absent on a site whose GPU gate is shut (NUS), and on any site not yet upgraded. */
	gpu?: GpuProfile;
	/** Absent on a site not yet running a build that serves a catalog. */
	images?: SiteImages;
	/** Absent on a site not yet running a build that serves sources. */
	data_sources?: DataSource[];
}

// ---------------------------------------------------------------------------
// PER-SITE GPU FACTS MUST NOT RIDE ON A SANDBOX ROW.
// ---------------------------------------------------------------------------
// `gpus_free` used to be read back off whichever row happened to carry it, which meant a user
// with NO sandboxes saw nothing — precisely the person deciding what to rent. The envelope
// carries this, not the rows, so it is stashed here as the list is flattened and read by site.
// Refreshed by the same 20 s poll that drives the table; no extra request.
export type SiteGpuInfo = GpuProfile & { gpus_free: string };

const gpuProfiles = new Map<string, SiteGpuInfo>();

export function gpuProfileForSite(site: string): SiteGpuInfo | undefined {
	return gpuProfiles.get(site);
}

/**
 * The images a site offers, served by that site rather than hardcoded here.
 *
 * A shortlist, NOT an allowlist — sandbox-control still accepts any reference, so the "custom"
 * escape hatch in the form is real. Sites answer for themselves because the right menu differs
 * per site (a site with an arm64 node in its sandbox pool cannot offer the amd64-only PyTorch
 * image), and because a table hardcoded in the UI is a table that silently goes stale.
 */
export interface ImageChoice {
	ref: string;
	label?: string;
	gpu?: boolean;
	note?: string;
}

export interface SiteImages {
	catalog: ImageChoice[];
	default_cpu: string;
	default_gpu: string;
}

const siteImages = new Map<string, SiteImages>();

export function imagesForSite(site: string): SiteImages | undefined {
	return siteImages.get(site);
}

const siteSources = new Map<string, DataSource[]>();

export function dataSourcesForSite(site: string): DataSource[] {
	return siteSources.get(site) ?? [];
}

export interface CreateSandboxRequest {
	name: string;
	/** Ids from dataSourcesForSite(). Attaching injects env only — no mount. */
	data_sources?: string[];
	image?: string;
	cpu?: number;
	memory_gi?: number;
	gpu?: number;
	ttl_hours?: number;
}

function makeClient(): AxiosInstance {
	// No baseURL: sbxUrl() builds the whole path, because the home/other split
	// above is not expressible as one prefix.
	const c = axios.create({ timeout: 180_000 });
	c.interceptors.request.use(async (cfg) => {
		const t = await getFlowmeshBearer();
		if (t) {
			cfg.headers = cfg.headers ?? {};
			(cfg.headers as Record<string, string>).Authorization = `Bearer ${t}`;
		}
		return cfg;
	});
	// Same single 401 retry fm.ts uses. A sandbox create can take tens of seconds
	// (it waits out the caller's own terminating pods), which is long enough for a
	// session bearer minted at page load to age out mid-request.
	c.interceptors.response.use(
		(res) => res,
		async (err: AxiosError) => {
			const cfg = err.config as (typeof err.config & { _retried?: boolean }) | undefined;
			if (err.response?.status === 401 && cfg && !cfg._retried) {
				cfg._retried = true;
				const fresh = await getFlowmeshBearer(true);
				if (fresh) {
					cfg.headers = cfg.headers ?? {};
					(cfg.headers as Record<string, string>).Authorization = `Bearer ${fresh}`;
					return c.request(cfg);
				}
			}
			return Promise.reject(err);
		},
	);
	return c;
}

const sbx = makeClient();

export async function whoami(site = PUBLIC_SANDBOX_SITE): Promise<{ email: string; user: string; admin: boolean }> {
	return (await sbx.get(sbxUrl(site, "/api/whoami"))).data;
}

/**
 * One site's sandboxes, shaped for `fanoutForSites` (fm.ts).
 *
 * Returns the rows, not the envelope: the site's `gpus_free` is copied onto each
 * row so nothing is lost by flattening. Rows are tagged with `site`, which is
 * what makes a merged list actionable — a delete has to go back to the site it
 * came from.
 */
export async function listSandboxesForSite(site: string): Promise<Sandbox[]> {
	const r = await sbx.get<SandboxList>(sbxUrl(site, "/api/sandboxes"));
	const gpusFree = r.data?.gpus_free ?? "";
	// Envelope-level, so it survives a site with zero sandboxes. See gpuProfiles above.
	if (r.data?.gpu && typeof r.data.gpu.max_per_sandbox === "number") {
		gpuProfiles.set(site, { ...r.data.gpu, gpus_free: gpusFree });
	}
	if (r.data?.images?.catalog?.length) siteImages.set(site, r.data.images);
	if (r.data?.data_sources) siteSources.set(site, r.data.data_sources);
	return (r.data?.sandboxes ?? []).map((s) => ({ ...s, site, gpus_free: s.gpus_free ?? gpusFree }));
}

export async function createSandbox(site: string, req: CreateSandboxRequest): Promise<Sandbox> {
	return (await sbx.post(sbxUrl(site, "/api/sandboxes"), req)).data;
}

export async function deleteSandbox(site: string, name: string): Promise<void> {
	await sbx.delete(sbxUrl(site, `/api/sandboxes/${encodeURIComponent(name)}`));
}

/** Re-mirror the caller's lum.id SSH keys into that site's gateway. Per-site: each
 *  site's gateway holds its own authorized_keys Secret. */
export async function syncKeys(site: string): Promise<{ user: string; keys_authorized: number; hint?: string | null }> {
	return (await sbx.post(sbxUrl(site, "/api/keys/sync"))).data;
}

/**
 * What a user types to get in, per site. One port per site for everyone; the key
 * decides whose pod.
 *
 * `null` means the site has no published SSH entry point and the only way in is
 * `kubectl exec` — saying so is better than printing a command that cannot work.
 *
 * KEEP THIS IN STEP WITH ts-egress-sites.yaml. Every entry here is a socat
 * sidecar plus a nodePort on the cloud `site-sshfwd` Service; if a port moves
 * there and not here, the UI hands users a command that silently fails.
 */
const SITE_SSH: Record<string, string | null> = {
	// site-sshfwd nodePort 31223 -> socat -> home k3s 31223 -> sandbox-gateway sshd.
	home: "ssh -p 31223 gw@lum.id",
	// nus-waypoint's nus-gateway-ssh NodePort 31222 -> ssh -L -> the container-gateway.
	nus: "ssh -p 31222 gw@lum.id",
	// CORRECTED 2026-09-13. This was `null`, with a comment claiming office had
	// "a sandbox-control but no gateway of its own". That has not been true
	// since office's gateway went in: lumid-sandboxes/sandbox-gateway-ssh is a
	// nodePort 31226, relayed by socat-office-sbxssh (ts-egress-sites.yaml) to
	// lum.id:31226, and verified end to end — `ssh-keyscan -p 31226 lum.id`
	// answers, and the e2e suite runs its whole office matrix through it
	// (deploy_infra k8s-lift/sandbox-control/e2e).
	//
	// The stale `null` told every office user their only option was kubectl,
	// for a working SSH path. A wrong "this is impossible" is worse than a
	// missing entry: nobody tries again.
	//
	// 31226 and not 31223: each socat here shares ONE pod, so two sites cannot
	// both bind the same listener port. office is 31225/31226 (control/ssh),
	// clear of home's 31223/31224.
	office: "ssh -p 31226 gw@lum.id",
};

export function sshCommandForSite(site?: string): string | null {
	return SITE_SSH[site ?? PUBLIC_SANDBOX_SITE] ?? null;
}

/** Back-compat: home's command, which is what every existing caller meant. */
export const SSH_COMMAND = SITE_SSH.home as string;

// ---------------------------------------------------------------------------
// ONE ROW SHAPE FOR TWO SOURCES
// ---------------------------------------------------------------------------
// A shell on home/office/NUS is a k8s pod from sandbox-control. A shell on vast
// is a FlowMesh SSH task — there is no sessions API, so its connection details
// are published through the task's own `latest_update.ssh` by the worker
// (worker/executors/ssh_executor.py: emit_update(task_id, {"ssh": …})).
//
// Those are two mechanisms and ONE user-facing concept. Rendering them as two
// lists would make the user learn our plumbing, so both normalise to this.

export type ShellKind = "sandbox" | "flowmesh-ssh";

export interface ComputeShell {
	/** Stable across polls and unique across sites. */
	key: string;
	site: string;
	kind: ShellKind;
	name: string;
	/** Lowercased-vocabulary-free: whatever the source calls it. Render via a pill. */
	state: string;
	/** The command to type, or null when the source published none. */
	connect: string | null;
	/** Epoch MILLISECONDS, normalised from a pod annotation (epoch seconds, as a
	 *  string) or a task's ISO timestamp. */
	expiresAt: number | null;
	/** null means "you" — the sandbox API only ever returns the caller's own. */
	owner: string | null;
	/** One line of context: why it is queued, which worker, which pod. */
	detail: string | null;
	gpu: number | null;
	node: string | null;
	/** Only set for kind "sandbox"; the delete button needs it. */
	sandbox?: Sandbox;
}

function epochFromSeconds(v?: string | null): number | null {
	if (!v) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n * 1000 : null;
}

function epochFromIso(v?: string | null): number | null {
	if (!v) return null;
	const t = Date.parse(v);
	return Number.isNaN(t) ? null : t;
}

export function sandboxToShell(s: Sandbox): ComputeShell {
	const site = s.site ?? PUBLIC_SANDBOX_SITE;
	return {
		key: `${site}:${s.pod}`,
		site,
		kind: "sandbox",
		name: s.name,
		state: s.phase,
		connect: sshCommandForSite(site),
		expiresAt: epochFromSeconds(s.expires_at),
		owner: null,
		detail: s.phase === "Queued" ? [s.gpus_free && `${s.gpus_free} GPUs free.`, s.waiting_for]
			.filter(Boolean).join(" ") || null : s.pod,
		gpu: s.gpu || null,
		node: s.node ?? null,
		sandbox: s,
	};
}

/** A FlowMesh SSH session is usable only while its task is live AND its lease has
 *  not expired — the same test ssh-tab applies. */
export function isSshTaskActive(t: FmTask): boolean {
	if (!["RUNNING", "DISPATCHED", "PENDING", "QUEUED"].includes(String(t.status))) return false;
	const exp = t.latest_update?.ssh?.expires_at;
	if (!exp) return true;
	const ms = Date.parse(exp);
	return Number.isNaN(ms) ? true : ms > Date.now();
}

export function sshTaskToShell(t: FmTask): ComputeShell {
	const s: FmSshInfo = t.latest_update?.ssh ?? {};
	const site = t.site ?? "vast";
	return {
		key: `${site}:${t.task_id}`,
		site,
		kind: "flowmesh-ssh",
		name: t.task_id.slice(0, 12),
		state: String(t.status),
		connect: s.host && s.port ? `ssh -p ${s.port} ${s.username ?? "flowmesh"}@${s.host}` : null,
		expiresAt: epochFromIso(s.expires_at),
		owner: t.owner_id ?? null,
		detail: [t.assigned_worker, s.mode].filter(Boolean).join(" · ") || null,
		gpu: null,
		node: t.assigned_worker ?? null,
	};
}

/** Only SSH tasks, only the ones this view should show. */
export function sshTasksToShells(tasks: FmTask[]): ComputeShell[] {
	return tasks.filter((t) => t.task_type === "ssh").map(sshTaskToShell);
}
