// FlowMesh Host client for the /app/gpu-rentals feature.
//
// Hits the cloud Host via the lum.id nginx bridge at
// `/api/v1/flowmesh/*`, which strips the prefix and proxies to
// `https://kv.run:8000/flowmesh/`. Auth is a short-lived scoped
// bearer minted by GET /api/v1/session-bearer?audience=flowmesh;
// cached in memory, refreshed on expiry or 401 (mirroring the
// runmesh client in src/runmesh/utils/axios.ts).
//
// FlowMesh returns plain JSON (no LQA-style envelope), so we don't
// unwrap a `.data.data` here — responses surface verbatim.

import axios, { AxiosError, AxiosInstance } from "axios";

const FM_BASE = "/api/v1/flowmesh";

// ---- session-bearer cache ----

let cachedBearer: { token: string; expires_at: number } | null = null;
let bearerInFlight: Promise<string | null> | null = null;

async function fetchBearer(): Promise<string | null> {
	try {
		const r = await axios.get<{
			data: { token: string; expires_at: number };
		}>(`/api/v1/session-bearer?audience=flowmesh`, { withCredentials: true });
		const d = r.data?.data;
		if (d?.token) {
			cachedBearer = { token: d.token, expires_at: d.expires_at };
			return d.token;
		}
	} catch {
		// Caller will get a 401 from FlowMesh and surface a retry.
	}
	return null;
}

async function getBearer(forceRefresh = false): Promise<string | null> {
	const now = Math.floor(Date.now() / 1000);
	if (!forceRefresh && cachedBearer && cachedBearer.expires_at - 60 > now) {
		return cachedBearer.token;
	}
	if (!bearerInFlight) {
		bearerInFlight = fetchBearer().finally(() => {
			bearerInFlight = null;
		});
	}
	return bearerInFlight;
}

/**
 * Expose the cached bearer for the WebSocket helper — browser WebSocket
 * constructors can't set headers, so the token is appended as a
 * `?token=` query param that the FM Host accepts in addition to the
 * Authorization header.
 */
export async function getFlowmeshBearer(): Promise<string | null> {
	return getBearer();
}

function makeClient(): AxiosInstance {
	const c = axios.create({ baseURL: FM_BASE, timeout: 30_000 });
	c.interceptors.request.use(async (cfg) => {
		const t = await getBearer();
		if (t) {
			cfg.headers = cfg.headers ?? {};
			(cfg.headers as Record<string, string>).Authorization = `Bearer ${t}`;
		}
		return cfg;
	});
	c.interceptors.response.use(
		(res) => res,
		async (err: AxiosError) => {
			const cfg = err.config as
				| (typeof err.config & { _retried?: boolean })
				| undefined;
			if (err.response?.status === 401 && cfg && !cfg._retried) {
				cfg._retried = true;
				const fresh = await getBearer(true);
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

// Surface the FastAPI `{detail: "..."}` body in thrown errors so the
// UI can tell the user why the submit failed (e.g. "taskType invalid",
// "authorizedKeys required"). Without this the caller sees a bare
// "Request failed with status code 400" which is useless.
fm.interceptors.response.use(
	(r) => r,
	(err: AxiosError<{ detail?: string | unknown }>) => {
		if (err.response?.data) {
			const d = err.response.data;
			const detail =
				typeof d === "object" && d !== null && "detail" in d
					? (d as { detail: unknown }).detail
					: d;
			const text =
				typeof detail === "string" ? detail : JSON.stringify(detail);
			err.message = `${err.response.status}: ${text}`;
		}
		return Promise.reject(err);
	},
);

// ---- types ----

export type TaskStatus =
	| "PENDING"
	| "DISPATCHED"
	| "DONE"
	| "FAILED"
	| "CANCELLED";

export interface SshInfo {
	mode: "direct" | "proxy" | "forward";
	host: string;
	port: number;
	username: string;
	session_id: string;
	expires_at: string;
	directHost?: string;
	directPort?: number;
}

export interface Task {
	task_id: string;
	workflow_id?: string; // FM returns this on GET /tasks/:id
	status: TaskStatus;
	assigned_worker: string | null;
	topic?: string;
	depends_on?: string[];
	waiting_on?: string[];
	attempts?: number;
	latest_update?: {
		ssh?: SshInfo;
	} & Record<string, unknown>;
}

export interface SubmitResult {
	ok: boolean;
	workflow_id: string;
	count: number;
	tasks: Task[];
}

// ---- REST calls ----

export async function submitWorkflow(yaml: string): Promise<SubmitResult> {
	// Host accepts YAML as text/plain; JSON wrapper also works but plain
	// text is the documented canonical shape.
	const r = await fm.post<SubmitResult>("/api/v1/workflows", yaml, {
		headers: { "Content-Type": "text/plain" },
	});
	return r.data;
}

export async function getTask(taskId: string): Promise<Task> {
	const r = await fm.get<Task>(
		`/api/v1/tasks/${encodeURIComponent(taskId)}`,
	);
	return r.data;
}

/**
 * Cancel a rental. FlowMesh only exposes workflow-level cancel today,
 * so we accept a task id + optional workflow id. If workflowId is
 * missing (e.g. user opened the page on a fresh device with no
 * localStorage hit) we look it up from the task record first.
 */
export async function cancelRental(
	taskId: string,
	workflowId?: string,
): Promise<void> {
	let wf = workflowId;
	if (!wf) {
		const t = await getTask(taskId);
		wf = t.workflow_id;
		if (!wf) {
			throw new Error(
				"workflow_id not found on task — can't cancel this rental",
			);
		}
	}
	await fm.post(`/api/v1/workflows/${encodeURIComponent(wf)}/cancel`);
}

// ---- log streaming ----

export interface LogLine {
	ts?: string;
	level?: string;
	message: string;
	raw?: unknown;
}

/**
 * Subscribe to /api/v1/tasks/:id/logs/stream via EventSource. Returns
 * an `unsubscribe` function; caller must invoke it on unmount.
 *
 * `onState` fires on lifecycle transitions so the UI can distinguish
 * "connecting" / "open, no lines yet" / "ended" / "error". Interactive
 * SSH tasks emit no task-level logs (sshd runs silently), so FM sends
 * `event: eos` immediately and the pane would otherwise look stuck.
 */
export type LogStreamState =
	| "connecting"
	| "open"
	| "ended"
	| "error";

export async function streamTaskLogs(
	taskId: string,
	onLine: (l: LogLine) => void,
	onState?: (s: LogStreamState) => void,
): Promise<() => void> {
	const token = await getBearer();
	const url =
		`${FM_BASE}/api/v1/tasks/${encodeURIComponent(taskId)}/logs/stream` +
		(token ? `?token=${encodeURIComponent(token)}` : "");
	const es = new EventSource(url);
	onState?.("connecting");
	es.onopen = () => onState?.("open");
	es.addEventListener("log", (ev) => {
		try {
			const parsed = JSON.parse((ev as MessageEvent).data);
			onLine({
				ts: parsed.ts,
				level: parsed.level,
				message: parsed.message ?? parsed.text ?? String(parsed),
				raw: parsed,
			});
		} catch {
			onLine({ message: (ev as MessageEvent).data });
		}
	});
	es.addEventListener("eos", () => {
		onState?.("ended");
		es.close();
	});
	es.onerror = () => {
		// Browsers fire onerror on graceful stream close too; only flip to
		// the "error" state when readyState says it's actually closed from
		// an unexpected condition (not after our own eos handler ran).
		if (es.readyState === EventSource.CLOSED) {
			onState?.("ended");
		} else {
			onState?.("error");
		}
	};
	return () => es.close();
}

/**
 * Open the SSH proxy WebSocket. Used by the `proxy`-mode connect snippet;
 * the detail page doesn't consume the stream itself in this wave (no
 * embedded xterm). Caller is responsible for closing the socket.
 */
export async function openSshProxy(taskId: string): Promise<WebSocket> {
	const token = await getBearer();
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	const qs = token ? `?token=${encodeURIComponent(token)}` : "";
	const url = `${proto}//${window.location.host}${FM_BASE}/api/v1/ssh/tasks/${encodeURIComponent(
		taskId,
	)}/proxy${qs}`;
	return new WebSocket(url);
}

// ---- YAML builder ----

export interface RentalSpec {
	name: string;
	publicKey: string;
	user?: string;
	mode?: "direct" | "proxy" | "forward";
	ttlSeconds?: number;
	idleTimeoutSeconds?: number;
	gpu?: number;
	gpuMemoryGb?: number;
	cpu?: number;
	memoryGb?: number;
	image?: string;
	envPairs?: Record<string, string>;
}

/**
 * Build the YAML for an SSHTask workflow, matching the shape the CLI +
 * SDK produce. Kept minimal — no DAG wiring, no inputs/outputs mounts —
 * just an interactive rental container.
 */
export function buildSshTaskYaml(spec: RentalSpec): string {
	const user = spec.user || "flowmesh";
	const mode = spec.mode || "proxy";
	const ttl = clampInt(spec.ttlSeconds ?? 3600, 60, 28800);
	const idle = clampInt(spec.idleTimeoutSeconds ?? 900, 60, 28800);
	const gpu = Math.max(0, Math.floor(spec.gpu ?? 0));
	const cpu = Math.max(0, Math.floor(spec.cpu ?? 0));

	const lines: string[] = [];
	lines.push("apiVersion: flowmesh/v1");
	lines.push("kind: SSHTask");
	lines.push("metadata:");
	lines.push(`  name: ${yq(spec.name)}`);
	lines.push("spec:");
	lines.push("  taskType: ssh");
	lines.push(`  interactive: true`);
	lines.push(`  user: ${yq(user)}`);
	lines.push(`  accessMode: ${mode}`);
	lines.push(`  ttlSeconds: ${ttl}`);
	lines.push(`  idleTimeoutSeconds: ${idle}`);
	lines.push("  authorizedKeys:");
	lines.push(`    - ${yq(spec.publicKey.trim())}`);
	if (spec.image) lines.push(`  image: ${yq(spec.image)}`);
	if (spec.envPairs && Object.keys(spec.envPairs).length > 0) {
		lines.push("  env:");
		for (const [k, v] of Object.entries(spec.envPairs)) {
			lines.push(`    ${k}: ${yq(v)}`);
		}
	}
	if (gpu > 0 || cpu > 0 || spec.memoryGb || spec.gpuMemoryGb) {
		lines.push("  resources:");
		lines.push("    hardware:");
		if (cpu > 0) lines.push(`      cpu: ${cpu}`);
		if (spec.memoryGb) lines.push(`      memory: "${spec.memoryGb}Gi"`);
		if (gpu > 0) {
			lines.push("      gpu:");
			lines.push(`        count: ${gpu}`);
			if (spec.gpuMemoryGb) {
				lines.push(`        memory: "${spec.gpuMemoryGb}GB"`);
			}
		}
	}
	lines.push("");
	return lines.join("\n");
}

function clampInt(n: number, min: number, max: number): number {
	const i = Math.floor(n);
	if (i < min) return min;
	if (i > max) return max;
	return i;
}

// Minimal YAML scalar quoter. Quote when the value contains any YAML-
// significant character; otherwise emit bare. Not a complete YAML 1.2
// implementation — the shapes we emit stay inside the safe subset.
function yq(v: string): string {
	if (!/^[A-Za-z0-9_\-./@+ =:]+$/.test(v) || /^\s|\s$/.test(v)) {
		return JSON.stringify(v);
	}
	return v;
}

// ---- connect snippet rendering ----
//
// Direct + forward modes resolve to plain `ssh` — no extra tooling on
// the user's machine. Proxy mode needs a WebSocket⇄stdio bridge as a
// ProxyCommand; we offer two variants so users can pick based on what
// they already have installed:
//   * flowmesh CLI (batteries included — `flowmesh ssh connect`)
//   * websocat     (pure-SSH path — single 2MB static binary)

export interface ConnectVariant {
	label: string;
	command: string;
	needs?: string; // one-line prerequisite hint
}

export interface ConnectSnippet {
	mode: SshInfo["mode"];
	variants: ConnectVariant[];
	hint: string;
}

export function buildConnectSnippet(
	task: Task,
	taskId: string,
): ConnectSnippet | null {
	const ssh = task.latest_update?.ssh;
	if (!ssh) return null;
	const user = ssh.username;
	switch (ssh.mode) {
		case "direct":
			return {
				mode: "direct",
				variants: [
					{
						label: "OpenSSH",
						command: `ssh -p ${ssh.port} ${user}@${ssh.host}`,
					},
				],
				hint: "Direct TCP to the worker. Your machine needs network reachability to the worker host.",
			};
		case "forward":
			return {
				mode: "forward",
				variants: [
					{
						label: "OpenSSH",
						command: `ssh -p ${ssh.port} ${user}@${ssh.host}`,
					},
				],
				hint: "Host-managed forward port. Works over public internet; no worker-direct access needed.",
			};
		case "proxy": {
			// Browser can't reach kv.run's Host directly with Authorization
			// headers under `ws://`, so the CLI/websocat connect straight
			// to the upstream. The bearer is pulled from the user's
			// ~/.flowmesh-key (or any flm-* / lm_pat_live_* bearer).
			const wsUrl = `wss://kv.run:8000/flowmesh/api/v1/ssh/tasks/${taskId}/proxy`;
			return {
				mode: "proxy",
				variants: [
					{
						label: "flowmesh CLI",
						command: `flowmesh ssh connect ${taskId}`,
						needs:
							"flowmesh CLI (`pip install flowmesh-cli`) + a bearer in ~/.flowmesh-key or FLOWMESH_API_KEY",
					},
					{
						label: "OpenSSH + websocat",
						command:
							`ssh ${user}@${ssh.host} -o ProxyCommand='` +
							`websocat --binary ${wsUrl} ` +
							`-H "Authorization: Bearer $FLOWMESH_API_KEY"'`,
						needs:
							"websocat (`brew install websocat` / `cargo install websocat`) + FLOWMESH_API_KEY exported",
					},
				],
				hint:
					"Proxy mode routes bytes through the FlowMesh Host over WebSocket. " +
					"OpenSSH alone can't speak WS — pick either the flowmesh CLI (handles " +
					"auth from ~/.flowmesh-key) or websocat (plumbs auth via env). " +
					"For zero-tooling SSH, create a rental in direct or forward mode instead.",
			};
		}
	}
}
