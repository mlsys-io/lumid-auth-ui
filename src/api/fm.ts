// mesh-federator client — the live, cross-site view of lum.id/fm.
//
// Distinct from `api/flowmesh.ts` on purpose: that one talks to `/api/v1/flowmesh`,
// the nginx bridge to the CLOUD FlowMesh host alone. This one talks to `/fm`, the
// mesh-federator, which fans a request out to every site (cloud, home, office,
// vast, nus) and merges the results. Auth machinery is imported from that module
// rather than duplicated — same session-bearer mint, same cache, same 401 refresh.
//
// ---------------------------------------------------------------------------
// ALWAYS ASK FOR `?shape=full`. THIS IS NOT A STYLE CHOICE.
// ---------------------------------------------------------------------------
// The federator's DEFAULT response is a bare merged array, kept that way because
// existing consumers (`sdk/ops/platform.py`, `api/cluster.ts`) index it directly
// and an object body silently collapses to zero rows for them. A bare array cannot
// express WHICH sites answered, so a dashboard rendering it cannot distinguish
// "office is unreachable" from "office has no workers" — which is the entire
// reason mesh-federator exists. `?shape=full` returns {items, sites[]} with
// per-site ok/count/ms/error. Every read here uses it and every view should
// surface `sites`.
//
// ---------------------------------------------------------------------------
// READ INVENTORY FROM THE MERGED ROUTES. NEVER FROM A PER-SITE CALL.
// ---------------------------------------------------------------------------
// Mesh reads are IDENTITY-SCOPED. The merged routes query each site with the
// federator's own credential and return the whole fleet. A per-site call
// (`/fm/<site>/…`) carries the CALLER's token, and an ordinary operator PAT gets
// **HTTP 200 with an empty array** — measured at the auth flip: the estate PAT saw
// 1 home / 6 office nodes where an ordinary PAT saw 0 and 0. Populating a list
// from a per-site call therefore renders "the fleet is down" for anyone who isn't
// an estate-PAT holder, with no error to explain it. Per-site calls here are
// reserved for things that are inherently per-task (results, logs), where an empty
// or 403 response must be surfaced as "not entitled", never as "nothing there".

import axios, { AxiosError, AxiosInstance } from "axios";
import { getFlowmeshBearer } from "./flowmesh";

const FM_BASE = "/fm";

/** Per-site outcome of one fan-out. `ok:false` means the site did not answer. */
export interface FmSiteStatus {
	site: string;
	ok: boolean;
	count: number;
	ms: number;
	error?: string;
}

/** Every merged read returns the rows AND who answered. Render both. */
export interface FmFanout<T> {
	items: T[];
	sites: FmSiteStatus[];
}

// Worker status vocabularies differ per endpoint and MUST NOT be unioned into
// one type. `/api/v1/workers` (the registry, fed by the worker's own heartbeat)
// is the only one that knows idleness. `/api/v1/stack/workers` (the supervisor
// adapter's view of what it did with the machine) reports RUNNING for a worker
// sitting idle and never emits IDLE at all — reading idleness off it is exactly
// the bug that left the vast fleet unable to scale to zero.
export type FmRegistryWorkerStatus = "UNKNOWN" | "STARTING" | "IDLE" | "BUSY";
export type FmAdapterWorkerStatus = "STARTING" | "RUNNING" | "STOPPING" | "STOPPED";

export interface FmNode {
	id: string;
	alias: string;
	namespace: string;
	cluster: string;
	version?: string | null;
	started_at?: string | null;
	/**
	 * Comma-joined STRING on the wire, not an array — `registries/node.py` has a
	 * `@field_serializer` that joins it. Worker.tags IS a real array. Use
	 * `nodeTags()` rather than assuming either shape.
	 */
	tags?: string | string[];
	last_seen?: string | null;
	max_gpu_count: number;
	current_gpu_count: number;
	/** Injected by the federator. Absent means the row came from a passthrough. */
	site?: string;
}

export interface FmWorker {
	id: string;
	alias?: string | null;
	namespace?: string;
	cluster?: string;
	node_id: string;
	node_alias?: string;
	version?: string | null;
	status: FmRegistryWorkerStatus;
	started_at?: string | null;
	last_seen?: string | null;
	tags?: string[];
	cached_models?: string[];
	cost_per_hour?: number | null;
	hardware?: FmWorkerHardware | null;
	site?: string;
}

export interface FmWorkerHardware {
	cpu?: { logical_cores?: number | null; model?: string | null } | null;
	memory?: { total_bytes?: number | null } | null;
	gpu?: {
		driver_version?: string | null;
		cuda_version?: string | null;
		devices?: Array<{ index?: number; name?: string; memory_total_bytes?: number }> | null;
		cost_per_hour?: number | null;
	} | null;
	network?: { public_ipaddr?: string | null; geolocation?: string | null } | null;
}

export type FmWorkflowStatus = "PENDING" | "DISPATCHED" | "FAILED" | "CANCELLED" | "DONE";

export interface FmWorkflow {
	workflow_id: string;
	task_ids: string[];
	submitted_at: string;
	updated_at?: string;
	status: FmWorkflowStatus;
	dispatched_tasks?: string[];
	completed_tasks?: string[];
	failed_tasks?: string[];
	cancelled_tasks?: string[];
	site?: string;
}

export type FmTaskStatus =
	| "PENDING"
	| "DISPATCHED"
	| "CANCELLING"
	| "FAILED"
	| "CANCELLED"
	| "DONE";

/** Terminal states. The results bundle 409s unless the task is one of these. */
export const FM_TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
	"DONE",
	"FAILED",
	"CANCELLED",
]);

export interface FmSshInfo {
	session_id?: string;
	/** "forward" (through the site's relay) or a direct hop. */
	mode?: string;
	/** Relay-side address — what a user actually connects to. */
	host?: string;
	port?: number;
	/** The worker-side address behind the relay; useful for debugging, not for users. */
	directHost?: string;
	directPort?: number;
	username?: string;
	expires_at?: string;
}

export interface FmTask {
	task_id: string;
	workflow_id: string;
	status: FmTaskStatus;
	task_type?: string | null;
	assigned_worker?: string | null;
	submitted_at: string;
	submitted_ts: number;
	dispatched_ts?: number | null;
	started_ts?: number | null;
	finished_ts?: number | null;
	attempts: number;
	max_attempts: number;
	error?: string | null;
	site?: string;

	// The list endpoint returns considerably more than the fields above, and the
	// detail panel is the reason to type them. Optional throughout: these are
	// populated by the server, not guaranteed, and a missing one must render as
	// "—" rather than crash the row.
	last_queue_ts?: number | null;
	last_error?: string | null;
	last_failed_worker?: string | null;
	category?: string | null;
	owner_id?: string | null;
	supplier_id?: string | null;
	topic?: string | null;
	raw_yaml?: string | null;
	// SSH sessions publish their connection details through the task's own
	// `latest_update`, not a dedicated endpoint — the worker calls
	// emit_update(task_id, {"ssh": ...}) (worker/executors/ssh_executor.py). That
	// is the ONLY place host/port/username/expiry appear, so the SSH surface reads
	// tasks rather than some sessions API that does not exist.
	latest_update?: { ssh?: FmSshInfo | null } | null;
	next_retry_at?: number | string | null;
	depends_on?: string[] | null;
	pending_dependencies?: string[] | null;
	/** Set when FlowMesh BATCHED this task into another's execution — same model +
	 *  inference config yields the same merge_key. The parent's result carries
	 *  this task's output under `children`, so a merged task legitimately has no
	 *  result of its own and that is not a failure. */
	merged_parent_id?: string | null;
	merged_children?: string[] | null;
	usages?: Array<{
		started_at?: string;
		finished_at?: string;
		runtime_sec?: number;
		hardware?: { gpu?: { devices?: Array<{ name?: string }> } };
	}> | null;
}

// ---- client ----

function makeClient(): AxiosInstance {
	const c = axios.create({ baseURL: FM_BASE, timeout: 30_000 });
	c.interceptors.request.use(async (cfg) => {
		const t = await getFlowmeshBearer();
		if (t) {
			cfg.headers = cfg.headers ?? {};
			(cfg.headers as Record<string, string>).Authorization = `Bearer ${t}`;
		}
		return cfg;
	});
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

const fm = makeClient();

/**
 * Tolerate both federator response shapes.
 *
 * `?shape=full` gives {items, sites}. A bare array comes back from any path that
 * is NOT in the federator's FM_LIST_PATHS — those fall through to the cloud-only
 * passthrough, which is a materially different thing and must not be silently
 * presented as a fleet-wide answer. When that happens we synthesise a single
 * `cloud` site row marked with an error so the UI can say so out loud.
 */
function asFanout<T>(body: unknown, path: string): FmFanout<T> {
	if (Array.isArray(body)) {
		return {
			items: body as T[],
			sites: [
				{
					site: "cloud",
					ok: true,
					count: body.length,
					ms: 0,
					error: `${path} is not federated (FM_LIST_PATHS) — cloud only`,
				},
			],
		};
	}
	const o = (body ?? {}) as { items?: T[]; sites?: FmSiteStatus[] };
	return { items: o.items ?? [], sites: o.sites ?? [] };
}

async function merged<T>(path: string, sites?: string[]): Promise<FmFanout<T>> {
	const params: Record<string, string> = { shape: "full" };
	if (sites?.length) params.site = sites.join(",");
	const r = await fm.get(path, { params });
	return asFanout<T>(r.data, path);
}

export function listNodes(sites?: string[]) {
	return merged<FmNode>("/api/v1/nodes", sites);
}

export function listWorkers(sites?: string[]) {
	return merged<FmWorker>("/api/v1/workers", sites);
}

/**
 * Workflows, fanned out PER SITE by this client — not by the federator.
 *
 * `/api/v1/workflows` is deliberately NOT in FM_LIST_PATHS: federating it exposed
 * 463 workflow records to anonymous callers (the merged routes answer with the
 * federator's own credential, so there is no caller token to check), and it was
 * pulled back out on 2026-09-10. The federator therefore falls through to the
 * cloud-only passthrough for this path.
 *
 * The consequence is not cosmetic. Cloud runs ZERO workers, so every cloud
 * workflow fails for want of one: measured 2026-09-11, cloud was 29 FAILED /
 * 4 CANCELLED while office held 376 DONE, vast 13, home 21, nus 3. A Jobs tab
 * reading the passthrough shows an all-red estate that is in fact healthy.
 *
 * Fanning out here restores the fleet-wide answer without re-opening the
 * anonymous hole, because these calls carry the CALLER's token and each site
 * applies its own entitlement. It is affordable precisely where tasks are not:
 * a workflow row carries ids only, no `raw_yaml` — all five sites total ~179 KB,
 * against 13.8 MB for office's tasks alone.
 *
 * The roster comes from a genuinely federated path rather than a literal, so
 * adding a site stays an env-only change on the federator (FEDERATOR_SITES).
 */
export async function listWorkflows(sites?: string[]): Promise<FmFanout<FmWorkflow>> {
	const roster = sites?.length ? sites : (await listWorkers()).sites.map((s) => s.site);
	const per = await Promise.all(
		roster.map(async (site) => {
			const t0 = Date.now();
			try {
				const r = await fm.get<FmWorkflow[]>(`/${site}/api/v1/workflows`);
				const items = (r.data ?? []).map((w) => ({ ...w, site }));
				return {
					status: { site, ok: true, count: items.length, ms: Date.now() - t0 },
					items,
				};
			} catch (e) {
				// One unreachable site must not blank the others — report it in the
				// strip and keep the rows we did get. That distinction is the whole
				// reason `sites[]` exists.
				return {
					status: {
						site,
						ok: false,
						count: 0,
						ms: Date.now() - t0,
						error: (e as Error)?.message || "unreachable",
					},
					items: [] as FmWorkflow[],
				};
			}
		}),
	);
	return { items: per.flatMap((p) => p.items), sites: per.map((p) => p.status) };
}

/**
 * Tasks, per site.
 *
 * NOT merged, and not an oversight: `/api/v1/tasks` was federated and pulled back
 * out the same hour. Office's task list is 13.8 MB — 814 rows each embedding the
 * task's full `raw_yaml` — against the federator's 4 MiB `io.LimitReader`, so the
 * body arrives truncated mid-JSON and that site reports `unparseable body` and
 * contributes ZERO tasks. Federating it made the merged view worse than leaving
 * it alone: confidently complete-looking while missing the busiest site. Nor can
 * a filter rescue it — the federator builds its own upstream request and does not
 * forward the caller's query string, so `?status=` never arrives.
 *
 * So callers walk the sites they care about. Use `listWorkflows()` as the
 * cross-site index and fetch tasks for the sites actually on screen.
 */
/**
 * Per-site node/worker reads, for viewers who are NOT admins.
 *
 * Two different edge gates are in play and the difference is the whole reason
 * these exist. `/fm/api/v1/…` — what `merged()` uses — carries
 * `auth_request /internal_admin_check` in lum-id-landing.conf, so a regular user
 * gets 403 from nginx before the federator is ever reached. The per-site prefix
 * `/fm/<site>/…` has no edge gate; mesh-federator runs it with
 * FEDERATOR_REQUIRE_SITE_AUTH=true, so it is authenticated but not admin-only
 * and the rows come back scoped to the caller's identity.
 *
 * That is what lets the Compute fleet view show the HOME site to any signed-in
 * user while every other site stays admin+. Do NOT "simplify" a non-admin path
 * onto merged() — it will 403 at the edge, which reads like an outage.
 */
export async function listNodesForSite(site: string): Promise<FmNode[]> {
	const r = await fm.get<FmNode[]>(`/${site}/api/v1/nodes`);
	return (r.data ?? []).map((n) => ({ ...n, site }));
}

export async function listWorkersForSite(site: string): Promise<FmWorker[]> {
	const r = await fm.get<FmWorker[]>(`/${site}/api/v1/workers`);
	return (r.data ?? []).map((w) => ({ ...w, site }));
}

/** Shape a per-site read like a fan-out so the same components render both. */
export async function fanoutForSites<T>(
	sites: string[],
	one: (site: string) => Promise<T[]>,
): Promise<FmFanout<T>> {
	const per = await Promise.all(
		sites.map(async (site) => {
			const t0 = Date.now();
			try {
				const items = await one(site);
				return { items, status: { site, ok: true, count: items.length, ms: Date.now() - t0 } };
			} catch (e: any) {
				// A site that refuses must be VISIBLE as refused, not silently absent —
				// an empty table and a 403 look identical otherwise.
				return {
					items: [] as T[],
					status: {
						site,
						ok: false,
						count: 0,
						ms: Date.now() - t0,
						error: String(e?.response?.status ?? "") === "403"
							? "forbidden (admin only)"
							: String(e?.message ?? e),
					},
				};
			}
		}),
	);
	return { items: per.flatMap((p) => p.items), sites: per.map((p) => p.status) };
}

export async function listTasksForSite(site: string): Promise<FmTask[]> {
	const r = await fm.get<FmTask[]>(`/${site}/api/v1/tasks`);
	return (r.data ?? []).map((t) => ({ ...t, site }));
}

/**
 * Submit a workflow to ONE site.
 *
 * Per-site by necessity, not preference: there is no cross-site submit. Each site
 * runs its own FlowMesh server, Redis and dispatcher, and worker ids are per-site
 * (`wkr-18` exists on BOTH home and office), so no scheduler can place one task on
 * office and another on vast. `POST /fm/api/v1/workflows` — the merged prefix — is
 * refused (400): mesh-federator federates LIST reads only, and its own header says
 * it must never be given write paths to fan out. Submitting to two sites means two
 * calls, which is exactly what this does one site at a time.
 *
 * Unlike the merged reads, this carries the CALLER's token, so the target site
 * applies its own authorization and entitlement — a submit cannot borrow the
 * federator's credential.
 *
 * The body is raw YAML (`text/plain`); the endpoint also accepts `{"yaml": "..."}`
 * as JSON. Returns the created workflow and its tasks, already dispatched or
 * pending depending on whether a matching worker was free.
 */
export interface FmSubmitResult {
	ok?: boolean;
	workflow_id: string;
	count?: number;
	tasks: Array<{
		task_id: string;
		status: string;
		assigned_worker: string | null;
		topic?: string | null;
	}>;
}

export async function submitWorkflow(site: string, yaml: string): Promise<FmSubmitResult> {
	const r = await fm.post<FmSubmitResult>(`/${site}/api/v1/workflows`, yaml, {
		headers: { "Content-Type": "text/plain" },
	});
	return r.data;
}

/** One task's executor result. Per-site: the caller's own entitlement applies. */
export async function getResult<T = unknown>(site: string, taskId: string): Promise<T> {
	const r = await fm.get<T>(`/${site}/api/v1/results/${encodeURIComponent(taskId)}`);
	return r.data;
}

/**
 * Download URL for a task's artifact bundle.
 *
 * `include` is a REPEATED query param, not the comma list docs/API.md shows — a
 * comma string is rejected with a 400. The endpoint also returns **409** unless
 * the task is terminal, so gate the button on `FM_TERMINAL_TASK_STATUSES`.
 */
export function bundleUrl(
	site: string,
	taskId: string,
	include: Array<"results" | "artifacts" | "logs"> = ["results", "artifacts"],
): string {
	const q = include.map((i) => `include=${encodeURIComponent(i)}`).join("&");
	return `${FM_BASE}/${site}/api/v1/results/${encodeURIComponent(taskId)}/bundle?${q}`;
}

/**
 * Archived logs for one task.
 *
 * The SSE stream below is TTL-bounded — it 404s with "log stream not found" once
 * the window has passed — so anything older than that must come from here. This
 * is the endpoint a detail view wants by default: a finished task's logs are
 * history, not a stream.
 */
export async function getTaskLogs(site: string, taskId: string): Promise<string> {
	const r = await fm.get(`/${site}/api/v1/results/${encodeURIComponent(taskId)}/logs`, {
		responseType: "text",
		transformResponse: [(d) => d],
	});
	return typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
}

/**
 * Live task logs over SSE.
 *
 * EventSource cannot set headers, so the bearer rides as `?token=` — the edge's
 * `$effective_auth` promotes it back to an Authorization header, and `/fm/` is
 * configured with the upgrade headers and 3600s timeouts SSE needs.
 *
 * ACCEPTED EXPOSURE: a token in a query string lands in nginx access logs. It is
 * unavoidable for EventSource and matches the existing `flowmesh.ts` WebSocket
 * precedent. It is tolerable only because this is a SHORT-LIVED session bearer
 * minted per-session from /api/v1/session-bearer, never a PAT — do not "simplify"
 * this by letting a user's pinned long-lived key flow through here.
 *
 * Two failure modes the caller MUST handle rather than render as an error:
 *  - **404 "log stream not found"** — Redis log streams are bounded and expire
 *    `LOG_STREAM_TTL_SEC` after close, so an older task simply has none. Fall
 *    back to the archived `GET /results/<id>/logs`.
 *  - a silent stall — the server sends a `: keep-alive` comment every 15s; if
 *    those stop arriving the connection is dead even though `onerror` never fired.
 */
export async function streamTaskLogs(
	site: string,
	taskId: string,
	onEvent: (payload: unknown) => void,
	onEnd?: (reason: "eos" | "error") => void,
): Promise<EventSource | null> {
	const token = await getFlowmeshBearer();
	const qs = token ? `?token=${encodeURIComponent(token)}` : "";
	const url = `${FM_BASE}/${site}/api/v1/tasks/${encodeURIComponent(taskId)}/logs/stream${qs}`;
	const es = new EventSource(url);
	es.addEventListener("log", (e) => {
		try {
			onEvent(JSON.parse((e as MessageEvent).data));
		} catch {
			onEvent((e as MessageEvent).data);
		}
	});
	es.addEventListener("eos", () => {
		es.close();
		onEnd?.("eos");
	});
	es.onerror = () => {
		es.close();
		onEnd?.("error");
	};
	return es;
}

// ---- helpers ----

/** Node tags are comma-joined on the wire; worker tags are a real array. */
export function nodeTags(n: FmNode): string[] {
	if (Array.isArray(n.tags)) return n.tags;
	if (typeof n.tags === "string" && n.tags.trim()) return n.tags.split(",").map((t) => t.trim());
	return [];
}

/** Seconds since a heartbeat, or null when the field is absent/unparseable. */
export function secondsSince(iso?: string | null): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return null;
	return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/**
 * Summed $/hr across workers that report a REAL cost.
 *
 * `cost_per_hour` is FlowMesh's WORKER_COST_PER_HOUR, whose default is 1.0 — and on
 * sites that never set it every worker reports exactly $1.000 regardless of what the
 * machine costs. Summing it blindly produced a "$2.000/hr" headline for a fleet that
 * was renting nothing. Workers reporting exactly the default are treated as unpriced,
 * and the caller is told how many were counted so it can decline to show a total it
 * cannot stand behind.
 */
export const FM_DEFAULT_COST_PER_HOUR = 1;

export function fleetCostPerHour(workers: FmWorker[]): { total: number; priced: number } {
	const priced = workers.filter((w) => {
		const c = w.cost_per_hour ?? w.hardware?.gpu?.cost_per_hour;
		return c != null && c !== FM_DEFAULT_COST_PER_HOUR;
	});
	return {
		total: priced.reduce(
			(sum, w) => sum + (w.cost_per_hour ?? w.hardware?.gpu?.cost_per_hour ?? 0),
			0,
		),
		priced: priced.length,
	};
}
