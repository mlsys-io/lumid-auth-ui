// A drop-in for React.lazy that survives a UI release in progress.
//
// The lumid-ui Rollout is a canary: for a few minutes some pods serve the new
// build and some the old. A page loaded from one can ask the other for a
// hashed chunk that does not exist there, and the dynamic import rejects —
// seen 2026-09-28 as doc pages crashing with "Cannot read properties of
// undefined (reading 'default')" during every canary (lumid-e2e doc-harnesses
// red, green on rerun). The chunk is not broken; the page is just stale.
//
// So: retry the import once (a different pod may answer), then reload the page
// ONCE to pick up a consistent build. The reload is guarded per URL in
// sessionStorage for a minute, so a chunk that is genuinely missing surfaces
// as a normal error instead of a reload loop.
import { lazy, type ComponentType } from "react";

const GUARD_KEY = "lumid.chunk-reload";
const GUARD_MS = 60_000;

export function isChunkLoadError(err: unknown): boolean {
	const msg = String((err as Error)?.message ?? err ?? "");
	return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed|reading 'default'/i.test(msg);
}

/** True when the page has not already reloaded for this URL in the last minute. */
export function claimReload(now = Date.now(), store: Pick<Storage, "getItem" | "setItem"> | null = safeSession()): boolean {
	if (!store) return false;
	const key = `${GUARD_KEY}:${typeof location !== "undefined" ? location.pathname : ""}`;
	const last = Number(store.getItem(key) || 0);
	if (last && now - last < GUARD_MS) return false;
	store.setItem(key, String(now));
	return true;
}

function safeSession(): Storage | null {
	try { return typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch { return null; }
}

export function reloadOnceForStaleBuild(err: unknown): boolean {
	if (!isChunkLoadError(err) || !claimReload()) return false;
	window.location.reload();
	return true;
}

export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
	return lazy(async () => {
		try {
			return await factory();
		} catch (first) {
			if (!isChunkLoadError(first)) throw first;
			try {
				return await factory();
			} catch (second) {
				if (reloadOnceForStaleBuild(second)) {
					// Keep Suspense showing its fallback while the page reloads.
					return new Promise<{ default: T }>(() => {});
				}
				throw second;
			}
		}
	});
}
