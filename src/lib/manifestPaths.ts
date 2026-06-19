// Dual-read path resolver for an app/repo bundle's platform files.
//
// Canonical names are migrating to dotfiles so platform files start with
// a leading '.':
//
//   spec:     xpcloud.yaml          -> .xpcloud.yaml
//   manifest: manifest.json / .yaml -> .manifest.json
//
// READS must tolerate both (a bundle on disk / in a repo may still carry the
// legacy name), preferring the new dotfile. WRITES always target the canonical
// dotfile so new content migrates forward.
//
// This module is bundle-context agnostic: it has no fs/path dependency. The
// caller supplies how paths are joined and how existence is tested (a Set of
// known entries, a fetched directory listing, fs.existsSync, etc.), so it works
// in the browser (Vite) and in node tooling alike.

// Preference order is "new dotfile first, then legacy". The first entry of each
// list is also the canonical write target.
export const SPEC_CANDIDATES = [".xpcloud.yaml", "xpcloud.yaml"] as const;
export const MANIFEST_CANDIDATES = [".manifest.json", "manifest.json", "manifest.yaml"] as const;

/** The canonical dotfile names used for writes. */
export const CANONICAL_SPEC = SPEC_CANDIDATES[0];
export const CANONICAL_MANIFEST = MANIFEST_CANDIDATES[0];

/** Tests whether a path exists. Sync (`Set.has`, `fs.existsSync`) or async. */
export type ExistsFn = (path: string) => boolean | Promise<boolean>;

/** Joins a bundle directory and a filename. Defaults to POSIX-style "/" join. */
export type JoinFn = (dir: string, name: string) => string;

const defaultJoin: JoinFn = (dir, name) =>
	dir.endsWith("/") || dir === "" ? `${dir}${name}` : `${dir}/${name}`;

/** Build the ordered candidate paths for one file family within `dir`. */
function candidatePaths(dir: string, names: readonly string[], join: JoinFn): string[] {
	return names.map((name) => join(dir, name));
}

/**
 * Resolve the first existing path from an ordered candidate list, preferring
 * the dotfile. Returns the path or `null` if none exist. Resolves
 * synchronously when `exists` is sync, otherwise returns a Promise.
 */
function resolveExisting(
	candidates: string[],
	exists: ExistsFn,
): string | null | Promise<string | null> {
	let i = 0;
	const step = (): string | null | Promise<string | null> => {
		if (i >= candidates.length) return null;
		const path = candidates[i++];
		const hit = exists(path);
		if (hit instanceof Promise) return hit.then((ok) => (ok ? path : step()));
		return hit ? path : step();
	};
	return step();
}

// ---------------------------------------------------------------------------
// READ resolvers — preferring the dotfile, falling back to legacy.
// ---------------------------------------------------------------------------

/**
 * Resolve the spec file for reads in `dir`: prefers `.xpcloud.yaml`, falls back
 * to legacy `xpcloud.yaml`. Returns the path that EXISTS, or `null` if neither
 * does. Async iff `exists` is async.
 */
export function resolveSpecPath(
	dir: string,
	exists: ExistsFn,
	join: JoinFn = defaultJoin,
): string | null | Promise<string | null> {
	return resolveExisting(candidatePaths(dir, SPEC_CANDIDATES, join), exists);
}

/**
 * Resolve the manifest file for reads in `dir`: prefers `.manifest.json`, falls
 * back to legacy `manifest.json` then `manifest.yaml`. Returns the path that
 * EXISTS, or `null` if none do. Async iff `exists` is async.
 */
export function resolveManifestPath(
	dir: string,
	exists: ExistsFn,
	join: JoinFn = defaultJoin,
): string | null | Promise<string | null> {
	return resolveExisting(candidatePaths(dir, MANIFEST_CANDIDATES, join), exists);
}

// ---------------------------------------------------------------------------
// WRITE helpers — always the canonical dotfile.
// ---------------------------------------------------------------------------

/** Canonical dotfile path to WRITE the spec to (`<dir>/.xpcloud.yaml`). */
export function specWritePath(dir: string, join: JoinFn = defaultJoin): string {
	return join(dir, CANONICAL_SPEC);
}

/** Canonical dotfile path to WRITE the manifest to (`<dir>/.manifest.json`). */
export function manifestWritePath(dir: string, join: JoinFn = defaultJoin): string {
	return join(dir, CANONICAL_MANIFEST);
}
