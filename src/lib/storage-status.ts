// Words for the Research Fleet "Storage" tab. Pure and tested (storage-status.test.ts); the tab only places them.
//
// Source: sandbox-control GET /api/storage per site, fed every 10 min by k8s-lift/storage-status. `public` is
// the site's shared folders + mirror + registry (everyone); `mine` is the caller's own usage rows; `all` is
// every user's rows (admins only).

export interface StorageFolder {
	kind: string;
	label: string;
	path: string;
	backing: string;
	ok: boolean;
	error?: string;
	total_bytes?: number;
	free_bytes?: number;
	used_bytes?: number;
}
export interface StorageService { name: string; url: string; ok: boolean; code?: number; ms?: number; error?: string }
export interface StorageNode { node: string; ok: boolean; error?: string }
export interface StoragePublic {
	site: string;
	checked_at: string;
	folders: StorageFolder[];
	services: StorageService[];
	nodes: StorageNode[];
}
export interface StorageUsage { user: string; kind: string; machine: string; used_bytes: number; limit_bytes: number }
export interface StorageStatus { public: StoragePublic | null; mine: StorageUsage[]; all?: StorageUsage[]; updated: string | null }

export type UsageTone = "ok" | "attention" | "failing";

/** 1536 -> "1.5 KB"; decimal-free above 100 of a unit. Binary units, labelled the way people read df. */
export function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "—";
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let i = 0, v = n;
	while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
	return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Share used, 0..100+ (over a hard limit is possible: data written before the cap). */
export function percentUsed(used: number, total: number): number {
	return total > 0 ? Math.round((used / total) * 100) : 0;
}

/** Full enough to say something: 90% attention, at/over the limit failing. */
export function usageTone(used: number, limit: number): UsageTone {
	if (limit <= 0) return "ok";
	if (used >= limit) return "failing";
	return used / limit >= 0.9 ? "attention" : "ok";
}

export const KIND_LABEL: Record<string, string> = {
	home: "Home",
	scratch: "Local disk (/scratch)",
	"sandbox-home": "Sandbox home",
};

/** What a usage row means for the person, in words. */
export function usageLine(u: StorageUsage): string {
	const where = u.kind === "sandbox-home" ? "your sandboxes" : u.machine;
	const base = `${formatBytes(u.used_bytes)} of ${formatBytes(u.limit_bytes)} on ${where}`;
	const t = usageTone(u.used_bytes, u.limit_bytes);
	if (t === "failing") return `${base} — over the limit: writes fail until you delete files`;
	if (t === "attention") return `${base} — nearly full`;
	return base;
}

/** "123 TB free of 200 TB", or why we do not know. */
export function folderLine(f: StorageFolder): string {
	if (!f.ok) return f.error === "did not answer in 15 s" ? "Not answering" : "Not reachable";
	return `${formatBytes(f.free_bytes ?? 0)} free of ${formatBytes(f.total_bytes ?? 0)}`;
}

/** How old the check is, honestly: the job runs every 10 min, so >30 min means it has stopped. */
export function checkedLine(iso: string | null | undefined, now = Date.now()): { text: string; stale: boolean } {
	if (!iso) return { text: "Not checked yet", stale: true };
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return { text: "Not checked yet", stale: true };
	const min = Math.max(0, Math.round((now - t) / 60000));
	const text = min < 1 ? "Checked just now" : min < 60 ? `Checked ${min} min ago` : `Checked ${Math.round(min / 60)} h ago`;
	return { text: min > 30 ? `${text} — the check has stopped running` : text, stale: min > 30 };
}

export function serviceLine(s: StorageService): string {
	if (!s.ok) return s.error === "unreachable" ? "Not reachable" : `Not working (HTTP ${s.code ?? "?"})`;
	return s.ms !== undefined ? `Working · ${s.ms} ms` : "Working";
}

/** Admin view: fullest first, so the people who cannot write any more lead. */
export function sortByFullness(rows: StorageUsage[]): StorageUsage[] {
	const r = (u: StorageUsage) => (u.limit_bytes > 0 ? u.used_bytes / u.limit_bytes : 0);
	return [...rows].sort((a, b) => r(b) - r(a) || a.user.localeCompare(b.user));
}
