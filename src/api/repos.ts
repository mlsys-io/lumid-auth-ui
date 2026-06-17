// Minimal READ-ONLY xpcloud repos client for Studio (ported from xp_ui).
// Hits the same-origin /api/v1/repos proxy (anon-capable on lum.id); attaches a
// session bearer when the user is signed in so private repos resolve too.
// Powers the StudioRepo page that replaces the retired xp_ui repo browser.
import { bearerHeader } from "@/api/session-bearer";

export type RepoKind = "app" | "skill" | "agent" | "dataset" | "workflow";

export interface Repo {
	owner_sub: string;
	name: string;
	kind?: string;
	display_name?: string;
	summary?: string;
	tags?: string[];
	version?: string;
	visibility?: string;
	stars?: number;
	downloads?: number;
	forks?: number;
	fork_of?: string | null;
	head_ref?: string;
	head_sha?: string;
	updated_at?: number;
}

export interface Branch { name: string; sha: string; is_default?: boolean }
export interface TreeEntry { name: string; type: "blob" | "tree" | "commit"; sha: string; size: number; mode: string }
export interface Blob { path: string; ref: string; content: string }
export interface PR {
	number: number;
	state: "open" | "merged" | "closed";
	base_branch: string;
	head_owner: string;
	head_name: string;
	head_branch: string;
	title: string;
	body: string;
	opened_at: number;
	merged_at: number | null;
	closed_at: number | null;
}
export interface PRDiff {
	base_sha: string;
	head_sha: string;
	files: { path: string; added: number; deleted: number }[];
	unified_diff: string;
}

const enc = encodeURIComponent;
const pathEnc = (p: string) => p.split("/").map(enc).join("/");

async function get<T>(url: string): Promise<T | null> {
	const auth = await bearerHeader().catch(() => ({}));
	const r = await fetch(url, { credentials: "same-origin", headers: auth });
	if (r.status === 404) return null;
	if (!r.ok) throw new Error(`${r.status} ${url}`);
	return (await r.json()) as T;
}

const root = (o: string, n: string) => `/api/v1/repos/${enc(o)}/${enc(n)}`;

export const getRepo = (o: string, n: string) => get<Repo>(root(o, n));
export const listBranches = (o: string, n: string) =>
	get<{ branches: Branch[] }>(`${root(o, n)}/branches`).then((d) => d?.branches ?? []);
export const getTree = (o: string, n: string, ref: string, path = "") =>
	get<{ entries: TreeEntry[] }>(
		path ? `${root(o, n)}/tree/${enc(ref)}/${pathEnc(path)}` : `${root(o, n)}/tree/${enc(ref)}`,
	).then((d) => d?.entries ?? []);
export const getBlob = (o: string, n: string, ref: string, path: string) =>
	get<Blob>(`${root(o, n)}/blob/${enc(ref)}/${pathEnc(path)}`);
export const listPulls = (o: string, n: string, state: "all" | "open" | "merged" | "closed" = "all") =>
	get<{ pulls: PR[] }>(`${root(o, n)}/pulls?state=${state}`).then((d) => d?.pulls ?? []);
export const getPull = (o: string, n: string, num: number) => get<PR>(`${root(o, n)}/pulls/${num}`);
export const getPullDiff = (o: string, n: string, num: number) => get<PRDiff>(`${root(o, n)}/pulls/${num}/diff`);
export const getProvenance = (o: string, n: string) =>
	get<{ is_fork: boolean; fork_of?: string; fork_root?: string; verified?: boolean | null }>(`${root(o, n)}/provenance`);
