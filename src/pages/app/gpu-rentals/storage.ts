// Per-user localStorage registry of submitted rentals. FlowMesh doesn't
// yet expose a user-scoped workflow listing, so the UI tracks its own
// IDs and polls GET /tasks/:id for live status.

export interface LocalRental {
	name: string;
	workflow_id: string;
	task_id: string;
	created_at: number; // unix seconds
	spec_summary: {
		gpu: number;
		gpuMemoryGb?: number;
		cpu?: number;
		memoryGb?: number;
		mode: "direct" | "proxy" | "forward";
		ttlSeconds: number;
		ssh_key_id?: number;
	};
}

function storageKey(userId: string): string {
	return `lm.gpu-rentals.${userId}`;
}

export function getLocalRentals(userId: string): LocalRental[] {
	try {
		const raw = localStorage.getItem(storageKey(userId));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed as LocalRental[];
	} catch {
		return [];
	}
}

export function saveLocalRental(userId: string, r: LocalRental): void {
	const existing = getLocalRentals(userId);
	// Dedupe by task_id; newest-first ordering for the list page.
	const next = [r, ...existing.filter((e) => e.task_id !== r.task_id)];
	try {
		localStorage.setItem(storageKey(userId), JSON.stringify(next));
	} catch {
		/* quota exceeded — silently drop */
	}
}

export function removeLocalRental(userId: string, taskId: string): void {
	const existing = getLocalRentals(userId);
	try {
		localStorage.setItem(
			storageKey(userId),
			JSON.stringify(existing.filter((e) => e.task_id !== taskId)),
		);
	} catch {
		/* ignore */
	}
}
