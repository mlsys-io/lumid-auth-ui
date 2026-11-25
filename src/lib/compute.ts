// compute — the words behind the Compute panel: what machines exist, how many
// are in use, and where this app's waiting runs stand. Pure and tested.
//
// Generic on purpose: every research app sends experiments to compute and gets
// feedback; compute is limited, so runs queue. Which machines an app's runs
// need is app-specific, so the panel shows the fleet as it is and the app's
// own queue — it never guesses which machine a run will get.

export interface ComputeCapacity { site: string; kind: string; total: number; busy: number; idle: number }
export interface QueueRow {
	req_id: string; loop: string; experiment_id?: string | null; state: string;
	remaining?: number; ran?: number; priority?: number;
	submitted_at?: number | string; updated_at?: number | string;
	last_error?: string | null; branch_label?: string | null; variant_id?: string | null; position?: number | null;
}

/** "NVIDIA GeForce RTX 5080" → "RTX 5080"; "NVIDIA RTX PRO 4000 Blackwell SFF Edition" → "RTX PRO 4000". */
export function shortKind(kind: string): string {
	if (/^cpu$/i.test(kind.trim())) return "CPU";
	let k = kind.replace(/^NVIDIA\s+/i, "").replace(/^GeForce\s+/i, "").replace(/\s+(Generation|Edition|SFF|Blackwell)\b.*$/i, "");
	k = k.replace(/\s+Ada$/i, " Ada").trim();
	return k || kind;
}

export interface CapacityRow { kind: string; label: string; gpu: boolean; total: number; busy: number; sites: string[] }

/** Machines by kind across sites; GPUs first (largest first), CPU last. */
export function capacityRows(cap: ComputeCapacity[]): CapacityRow[] {
	const by = new Map<string, CapacityRow>();
	for (const c of cap) {
		const label = shortKind(c.kind);
		const row = by.get(label) ?? { kind: c.kind, label, gpu: label !== "CPU", total: 0, busy: 0, sites: [] };
		row.total += c.total;
		row.busy += c.busy;
		if (!row.sites.includes(c.site)) row.sites.push(c.site);
		by.set(label, row);
	}
	return [...by.values()].filter((r) => r.total > 0).sort((a, b) => Number(b.gpu) - Number(a.gpu) || b.total - a.total || a.label.localeCompare(b.label));
}

export function capacityLine(r: CapacityRow): string {
	if (r.busy >= r.total) return `all ${r.total} in use`;
	if (r.busy === 0) return `${r.total} free`;
	return `${r.busy} of ${r.total} in use`;
}

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export interface QueueItem { key: string; loop: string; version: string | null; state: "waiting" | "running" | "done" | "failed" | "cancelled"; line: string; position: number | null }

/** Queue rows in words: waiting ones in drain order with their place in line. */
export function queueItems(rows: QueueRow[]): { waiting: QueueItem[]; running: QueueItem[] } {
	const waiting: QueueItem[] = [], running: QueueItem[] = [];
	for (const r of rows) {
		const version = r.variant_id || r.branch_label || null;
		const left = Math.max(0, r.remaining ?? 0), ran = Math.max(0, r.ran ?? 0);
		const runsWord = (n: number) => `${n} run${n === 1 ? "" : "s"}`;
		if (r.state === "queued") {
			const pos = r.position ?? null;
			const parts = [pos ? (pos === 1 ? "next in line" : `#${pos} in line`) : "waiting"];
			if (left > 1) parts.push(`${runsWord(left)} to go`);
			if (r.last_error) parts.push("retrying after an error");
			waiting.push({ key: r.req_id, loop: r.loop, version, state: "waiting", line: parts.join(" · "), position: pos });
		} else if (r.state === "running") {
			running.push({ key: r.req_id, loop: r.loop, version, state: "running", line: left > 0 ? `${ran} done, ${runsWord(left)} to go` : "running", position: null });
		}
	}
	waiting.sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
	return { waiting, running };
}

export const versionLabel = (v: string | null) => (v ? humanize(v) : null);
