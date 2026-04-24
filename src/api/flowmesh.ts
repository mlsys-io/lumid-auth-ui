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

export async function cancelTask(taskId: string): Promise<void> {
	// FlowMesh exposes workflow-level cancel (not per-task). When a
	// rental is a single-task workflow, cancelling the workflow drops
	// the container — same effect the UI wants.
	await fm.post(
		`/api/v1/workflows/${encodeURIComponent(taskId)}/cancel`,
	);
}

export async function cancelWorkflow(workflowId: string): Promise<void> {
	await fm.post(
		`/api/v1/workflows/${encodeURIComponent(workflowId)}/cancel`,
	);
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
 * Browser EventSource doesn't expose a way to set headers, so we
 * append the scoped bearer as a `?token=` query param (FM Host accepts
 * either). Cache miss on expiry just breaks the stream — caller can
 * re-subscribe.
 */
export async function streamTaskLogs(
	taskId: string,
	onLine: (l: LogLine) => void,
): Promise<() => void> {
	const token = await getBearer();
	const url =
		`${FM_BASE}/api/v1/tasks/${encodeURIComponent(taskId)}/logs/stream` +
		(token ? `?token=${encodeURIComponent(token)}` : "");
	const es = new EventSource(url);
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
	es.addEventListener("eos", () => es.close());
	es.onerror = () => {
		// Leave the caller's onLine quiet; they observe the stream ending
		// via EventSource's readyState if they care.
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

export interface ConnectSnippet {
	mode: SshInfo["mode"];
	primary: string;
	fallback?: string;
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
				primary: `ssh -p ${ssh.port} ${user}@${ssh.host}`,
				hint: "Direct TCP to the worker. Your machine needs network reachability to the worker host.",
			};
		case "forward":
			return {
				mode: "forward",
				primary: `ssh -p ${ssh.port} ${user}@${ssh.host}`,
				hint: "Host-managed forward port. Works over public internet; no worker-direct access needed.",
			};
		case "proxy":
			return {
				mode: "proxy",
				primary: `flowmesh ssh connect ${taskId}`,
				fallback: `ssh ${user}@${ssh.host} -o ProxyCommand='flowmesh ssh proxy ${taskId}'`,
				hint: "Proxied via the FlowMesh Host. Needs the flowmesh CLI installed and authenticated (flm-* or lm_pat_live_* bearer).",
			};
	}
}
