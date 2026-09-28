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
const NAME_RE = new RegExp(`^lumilake-(${REQ_ID})$`);
// `name: lumilake-req-…` on its own line, optionally quoted. Anchored to a
// `name:` key rather than matching the token anywhere: a YAML that merely
// MENTIONS another job (an env var, a comment, an input path) must not be read
// as having been submitted by it.
const YAML_NAME_RE = new RegExp(`^\\s*name:\\s*["']?lumilake-(${REQ_ID})["']?\\s*(?:#.*)?$`, "m");

/** The Lumilake job id a FlowMesh task names as its submitter, or null.
 *  Reads a structured `metadata.name` / `name` first, then the task's
 *  raw_yaml. Never guesses: no match is null. */
export function lumilakeReqIdOfTask(task: {
	raw_yaml?: string | null;
	name?: unknown;
	metadata?: unknown;
} | null | undefined): string | null {
	if (!task) return null;
	const meta = task.metadata && typeof task.metadata === "object" ? (task.metadata as { name?: unknown }) : null;
	for (const n of [meta?.name, task.name]) {
		if (typeof n === "string") {
			const m = n.trim().match(NAME_RE);
			if (m) return m[1];
		}
	}
	const y = typeof task.raw_yaml === "string" ? task.raw_yaml : "";
	const m = y.match(YAML_NAME_RE);
	return m ? m[1] : null;
}

/** The first task (in order) that names its Lumilake submitter, preferring
 *  `preferTaskId` when that task names one. */
export function lumilakeReqIdOfTasks<T extends { task_id: string; raw_yaml?: string | null }>(
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

