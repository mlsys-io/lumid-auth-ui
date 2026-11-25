// The files a Research Fleet run produced, for its Files list. Pure and tested
// (run-files.test.ts); my-runs.tsx only places them.
//
// Every file is read through identity — GET /api/v1/me/fleet/jobs/<id>?view=file
// &path=<p> — which serves the run's OWNER only and fetches upstream as them:
//   FlowMesh: p = "<task_id>/<path>" for each file a task's result names
//             (images[].path, artifacts[]).
//   Lumilake: p = an artifact URI found anywhere in the result (it contains
//             "/artifacts/"; generated images are saved as job artifacts).
// The session cookie authenticates the request, so a plain <img src>/<a href> works.

export type FileKind = "image" | "text" | "data" | "other";

export interface RunFile {
	/** What view=file takes. */
	path: string;
	/** Short display name. */
	name: string;
	kind: FileKind;
}

const IMG = /\.(png|jpe?g|webp|gif)$/i;
const TEXT = /\.(txt|md|log|csv|tsv)$/i;
const DATA = /\.(json|jsonl|parquet|npy|npz|pt|safetensors)$/i;

export function fileKind(name: string): FileKind {
	if (IMG.test(name)) return "image";
	if (TEXT.test(name)) return "text";
	if (DATA.test(name)) return "data";
	return "other";
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function safeRel(p: string): boolean {
	return !!p && !p.startsWith("/") && !p.includes("\\") && p.split("/").every((s) => s && s !== "." && s !== "..");
}

/** Lumilake artifact URIs anywhere in a result (also inside JSON-encoded strings). */
function collectArtifacts(v: unknown, out: Set<string>, depth = 0): void {
	if (depth > 8 || v == null) return;
	if (typeof v === "string") {
		const t = v.trim();
		// JSON-encoded (Lumilake's per-row outputs): look inside, never take the
		// encoded string itself as a path.
		if ((t.startsWith("{") || t.startsWith("[")) && t.length < 2_000_000) {
			try {
				collectArtifacts(JSON.parse(t), out, depth + 1);
				return;
			} catch {
				/* not JSON after all */
			}
		}
		if (t.includes("/artifacts/") && t.length <= 2048 && !/[\s"{}]/.test(t)) out.add(t);
		return;
	}
	if (Array.isArray(v)) {
		for (const x of v) collectArtifacts(x, out, depth + 1);
		return;
	}
	const r = asRecord(v);
	if (r) for (const x of Object.values(r)) collectArtifacts(x, out, depth + 1);
}

/** Every file a run's result names, in order, no duplicates. */
export function runFiles(fleetId: string, outputs: unknown): RunFile[] {
	const kind = fleetId.split(":")[1];
	const files: RunFile[] = [];
	const seen = new Set<string>();
	const add = (path: string, name: string) => {
		if (seen.has(path)) return;
		seen.add(path);
		files.push({ path, name, kind: fileKind(name) });
	};
	if (kind === "fm" && Array.isArray(outputs)) {
		for (const step of outputs) {
			const s = asRecord(step);
			const task = typeof s?.task_id === "string" ? s.task_id : "";
			const result = asRecord(s?.result);
			if (!/^tsk-[A-Za-z0-9-]{1,64}$/.test(task) || !result) continue;
			const names: unknown[] = [
				...(Array.isArray(result.images) ? result.images : []),
				...(Array.isArray(result.artifacts) ? result.artifacts : []),
			];
			for (const n of names) {
				const rel = typeof n === "string" ? n : typeof asRecord(n)?.path === "string" ? (asRecord(n)!.path as string) : "";
				if (safeRel(rel)) add(`${task}/${rel}`, rel.split("/").pop() || rel);
			}
		}
	} else if (kind === "ll") {
		const uris = new Set<string>();
		collectArtifacts(outputs, uris);
		for (const u of uris) add(u, u.split("/").pop() || u);
	}
	return files;
}

/** The URL identity serves one file at (session cookie authenticates it). */
export function runFileUrl(meBase: string, fleetId: string, path: string): string {
	return `${meBase.replace(/\/$/, "")}/api/v1/me/fleet/jobs/${encodeURIComponent(fleetId)}?view=file&path=${encodeURIComponent(path)}`;
}

/** "1 file" / "5 files". */
export function filesLabel(n: number): string {
	return `${n} file${n === 1 ? "" : "s"}`;
}
