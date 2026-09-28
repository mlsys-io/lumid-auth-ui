// fleet-provenance — the two directions between a Studio run and the fleet
// work it launched.
//
//   run → fleet:  a run's compute_jobs (Lumilake job ids per site) → the
//                 FlowMesh workflow(s) each job dispatched, linked into
//                 Research Fleet → Jobs by URL (fleetJobsPath).
//   fleet → run:  a FlowMesh task names the Lumilake job that submitted it —
//                 Lumilake submits every workflow with task
//                 `metadata.name: "lumilake-<req-id>"` — and identity maps
//                 (site, req-id) back to the owning app/loop/run
//                 (me.computeJobSiblings).
//
// Pure functions, no React — unit-tested in fleet-provenance.test.ts.

// A Lumilake job id as the server issues them (mirrors computeJobRe in
// lumid_identity/internal/handler/me_compute_job.go — anything identity would
// reject is not worth asking it about).
const REQ_ID = "req-[A-Za-z0-9]{6,64}";
// The shapes a Lumilake-submitted task's NAME takes. Measured on the home mesh
// 2026-09-28 (30 tasks, all Lumilake): metadata.name is
//   lumilake-exec-<exec-id>:request_<req-id>_graph_0_<hash>_…
// and graph_node_name / local_name are the part after the colon. The bare
// `lumilake-<req-id>` form is kept for workflows submitted whole.
const NAME_RES = [
	new RegExp(`^lumilake-(${REQ_ID})$`),
	new RegExp(`^lumilake-exec-[A-Za-z0-9]+:request_(${REQ_ID})_`),
	new RegExp(`^request_(${REQ_ID})_`),
];
// `name: …` on its own line of a task's YAML, optionally quoted. Anchored to a
// `name:` key rather than matching the token anywhere: a YAML that merely
// MENTIONS another job (an env var, a comment, an input path) must not be read
// as having been submitted by it.
const YAML_NAME_RE = /^\s*name:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/gm;

function reqIdOfName(n: unknown): string | null {
	if (typeof n !== "string") return null;
	const v = n.trim();
	for (const re of NAME_RES) {
		const m = v.match(re);
		if (m) return m[1];
	}
	return null;
}

function reqIdOfYaml(y: unknown): string | null {
	if (typeof y !== "string" || !y) return null;
	for (const m of y.matchAll(YAML_NAME_RE)) {
		const id = reqIdOfName(m[1]);
		if (id) return id;
	}
	return null;
}

const nameOf = (o: unknown): unknown =>
	o && typeof o === "object" ? (o as { name?: unknown }).name : undefined;

/** A FlowMesh task, as far as provenance needs it. FlowMesh returns the task
 *  spec both structured (`task`) and as text (`source`; `raw_yaml` on older
 *  servers). */
export interface TaskNaming {
	raw_yaml?: string | null;
	source?: unknown;
	task?: unknown;
	metadata?: unknown;
	name?: unknown;
	graph_node_name?: unknown;
	local_name?: unknown;
}

/** The Lumilake job id a FlowMesh task names as its submitter, or null.
 *  Structured names first (task.metadata.name, metadata.name, the graph node
 *  name), then a `name:` key in the task's YAML. Never guesses: no match is
 *  null. */
export function lumilakeReqIdOfTask(task: TaskNaming | null | undefined): string | null {
	if (!task) return null;
	const spec = task.task && typeof task.task === "object" ? (task.task as { metadata?: unknown }) : null;
	for (const n of [nameOf(spec?.metadata), nameOf(task.metadata), task.name, task.graph_node_name, task.local_name]) {
		const id = reqIdOfName(n);
		if (id) return id;
	}
	return reqIdOfYaml(task.source) ?? reqIdOfYaml(task.raw_yaml);
}

/** The first task (in order) that names its Lumilake submitter, preferring
 *  `preferTaskId` when that task names one. */
export function lumilakeReqIdOfTasks<T extends TaskNaming & { task_id: string }>(
	tasks: readonly T[] | null | undefined, preferTaskId?: string | null,
): string | null {
	if (!tasks?.length) return null;
	if (preferTaskId) {
		const t = tasks.find((x) => x.task_id === preferTaskId);
		const id = lumilakeReqIdOfTask(t);
		if (id) return id;
	}
	for (const t of tasks) {
		const id = lumilakeReqIdOfTask(t);
		if (id) return id;
	}
	return null;
}

/** Research Fleet → Jobs with a workflow (and optionally a task) open. */
export function fleetJobsPath(site: string, workflow?: string | null, task?: string | null): string {
	const sp = new URLSearchParams();
	if (site) sp.set("site", site);
	if (workflow) sp.set("workflow", workflow);
	if (task) sp.set("task", task);
	const s = sp.toString();
	return `/studio/research-fleet/jobs${s ? `?${s}` : ""}`;
}

/** `req-FQ89FpUz6jnoyYyyjoPxxX` → `req-FQ89Fp…` (the full id stays in a title). */
export function shortJobId(id?: string | null): string {
	const s = String(id || "");
	return s.length > 14 ? `${s.slice(0, 12)}…` : s;
}

