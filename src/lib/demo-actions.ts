// Mock backends for the demo's judgment + publish loops. Each POSTs to a
// real-shaped endpoint and falls back to a local mock on any failure, so
// the visible cause→effect works whether or not the backend route exists
// yet. Swap the fallbacks out once /api/judgment + /api/library ship.
import apiClient from '../api/client';

export interface RejectResult {
	ok: boolean;
	nextCycleId: string;
}

export async function rejectWithReason(itemId: string, reason: string): Promise<RejectResult> {
	try {
		const r = await apiClient.post('/api/judgment/reject', { itemId, reason });
		const data = (r as any)?.data?.data ?? (r as any)?.data ?? {};
		if (data?.nextCycleId) return { ok: true, nextCycleId: String(data.nextCycleId) };
	} catch {
		// fall through to mock
	}
	// Mock: pretend the principle was encoded and a fresh cycle is queued.
	await new Promise((res) => setTimeout(res, 250));
	return { ok: true, nextCycleId: `cycle_${Date.now().toString(36)}` };
}

export interface PublishResult {
	ok: boolean;
	published: number;
}

export async function publishToLibrary(skillIds: string[], allowlist: string[]): Promise<PublishResult> {
	try {
		const r = await apiClient.post('/api/library/publish', { skillIds, allowlist });
		if ((r as any)?.status === 200 || (r as any)?.data) {
			return { ok: true, published: skillIds.length };
		}
	} catch {
		// fall through to mock
	}
	await new Promise((res) => setTimeout(res, 250));
	return { ok: true, published: skillIds.length };
}
