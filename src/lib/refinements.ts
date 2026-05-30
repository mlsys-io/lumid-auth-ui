// Shared state for the Library "Your refinements" tab + the Knowledge
// view's publish callout. Persisted in localStorage so a publish in
// Knowledge survives a tab switch to Library — the loop the demo wants
// the audience to see ("the refined skill joins the marketplace").

export interface Refinement {
	id: string;
	name: string;
	version: string;
	refinedAt: string;
	source: string;
	status: 'local' | 'published';
	publishedTo?: number;
}

const STORAGE_KEY = 'studio:refinements-v1';
const TS_KEY = 'studio:refinements-published-at';
export const REFINEMENTS_EVENT = 'studio:refinements-changed';

const SEED: Refinement[] = [
	{
		id: 'family-voice',
		name: 'Family voice — casual register',
		version: 'v3 · forked from canonical v2',
		refinedAt: '2h ago',
		source: 'from Aunt Mei reply rejection',
		status: 'local',
	},
	{
		id: 'meeting-prep-prior-brief',
		name: 'Meeting prep · prefer 24h-prior brief',
		version: 'v2 · forked from canonical v1',
		refinedAt: '2d ago',
		source: 'from over-eager prep rejection',
		status: 'published',
		publishedTo: 1,
	},
	{
		id: 'vendor-quote-guard',
		name: 'Vendor-quote guardrail',
		version: 'v4 · forked from canonical v3',
		refinedAt: '1w ago',
		source: 'from care-coordination rejection',
		status: 'published',
		publishedTo: 2,
	},
];

export function loadRefinements(): Refinement[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return SEED;
		const parsed = JSON.parse(raw) as Refinement[];
		return Array.isArray(parsed) && parsed.length > 0 ? parsed : SEED;
	} catch {
		return SEED;
	}
}

export function lastPublishedAt(): number {
	try {
		const raw = localStorage.getItem(TS_KEY);
		const n = raw ? parseInt(raw, 10) : 0;
		return Number.isFinite(n) ? n : 0;
	} catch {
		return 0;
	}
}

/** Mark every currently-`local` refinement as published to `contactCount` allowlist contacts.
 *  Persists + dispatches REFINEMENTS_EVENT so the Library tab refreshes + highlights. */
export function publishAllLocal(contactCount: number): { changed: number } {
	const current = loadRefinements();
	let changed = 0;
	const next = current.map((r) => {
		if (r.status === 'local') {
			changed++;
			return { ...r, status: 'published' as const, publishedTo: contactCount, refinedAt: 'just now' };
		}
		return r;
	});
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		localStorage.setItem(TS_KEY, String(Date.now()));
	} catch { /* ignore */ }
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(REFINEMENTS_EVENT, { detail: { changed } }));
	}
	return { changed };
}

/** Reset to the demo seed — useful for re-running the pitch. */
export function resetRefinements(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
		localStorage.removeItem(TS_KEY);
	} catch { /* ignore */ }
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(REFINEMENTS_EVENT, { detail: { changed: 0 } }));
	}
}
