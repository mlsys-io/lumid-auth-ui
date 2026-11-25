// The pictures a run produced. Pure and tested (run-images.test.ts); the
// Research Fleet "Your runs" panel only places them.
//
// A FlowMesh task's result names its files relative to the task's results
// directory, e.g. a diffusion task returns `images: [{path: "images/image_0.png"}]`
// (measured 2026-11-25, stabilityai/sd-turbo). The bytes are served per site at
// /fm/<site>/api/v1/results/<task_id>/files/<path>, behind the caller's own
// token — so the browser fetches them with its FlowMesh bearer, never a bare <img src>.

export interface RunImage {
	site: string;
	taskId: string;
	path: string;
	/** Short label: the file name. */
	name: string;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** Site of a Research Fleet id `<site>:<kind>:<native>` when it is a FlowMesh run. */
export function flowmeshSite(fleetId: string): string | null {
	const [site, kind] = fleetId.split(":");
	return site && kind === "fm" ? site : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Every image file a FlowMesh run's outputs name, in order, without duplicates. */
export function runImages(fleetId: string, outputs: unknown): RunImage[] {
	const site = flowmeshSite(fleetId);
	if (!site || !Array.isArray(outputs)) return [];
	const out: RunImage[] = [];
	const seen = new Set<string>();
	for (const step of outputs) {
		const s = asRecord(step);
		const taskId = typeof s?.task_id === "string" ? s.task_id : "";
		const result = asRecord(s?.result);
		if (!taskId || !result) continue;
		const candidates: unknown[] = [];
		if (Array.isArray(result.images)) candidates.push(...result.images);
		if (Array.isArray(result.artifacts)) candidates.push(...result.artifacts);
		for (const c of candidates) {
			const path = typeof c === "string" ? c : typeof asRecord(c)?.path === "string" ? (asRecord(c)!.path as string) : "";
			if (!path || !IMAGE_EXT.test(path) || path.includes("..") || path.startsWith("/")) continue;
			const key = `${taskId}/${path}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({ site, taskId, path, name: path.split("/").pop() || path });
		}
	}
	return out;
}

/** "1 picture" / "4 pictures". */
export function picturesLabel(n: number): string {
	return `${n} picture${n === 1 ? "" : "s"}`;
}

/** Path under /fm for one file (the API client adds the /fm base and the bearer). */
export function imageFilePath(img: RunImage): string {
	const file = img.path.split("/").map(encodeURIComponent).join("/");
	return `/${encodeURIComponent(img.site)}/api/v1/results/${encodeURIComponent(img.taskId)}/files/${file}`;
}
