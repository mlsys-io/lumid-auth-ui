// Shared store for the demo's "Pending your call" decisions. Both the
// Intents view (DecisionsPending) and the Inbox view (under DEMO_MODE)
// read from here so a reject on one is visible on the other — the
// "Pending your call" and "Inbox > Drafts" surfaces are linked, not
// separate hardcoded lists.
//
// Persistence: localStorage. A rejected/approved decision disappears
// from the Inbox (no longer pending action) but stays on the Intents
// page in its greyed/tagged state so the user can still publish the
// encoded principle to the Library.

export type DecisionStatus = 'pending' | 'approved' | 'rejected';
export type DecisionIconKind = 'mail' | 'flask';

export interface DemoDecision {
	id: string;
	app: string;        // owning app — surfaces in the Inbox row
	iconKind: DecisionIconKind;
	tag: string;        // meta line, e.g. "reply draft · to Aunt Mei · family"
	subject: string;    // short title for the Inbox draft row
	preview: string;    // full preview / body
	principleLabel: string; // shown by PublishToLibrary on rejected items
}

export const SEED: DemoDecision[] = [
	{
		id: 'aunt-mei-reply',
		app: 'personal-agent',
		iconKind: 'mail',
		tag: 'reply draft · to Aunt Mei · family',
		subject: 'Reply to Aunt Mei — family gathering',
		preview:
			'Dear Aunt Mei, I am writing in response to your kind message regarding the upcoming family gathering. I would be honored to attend and look forward to seeing everyone…',
		principleLabel: 'Family voice — casual register',
	},
	{
		id: 'nl2sql-next-batch',
		app: 'auto-sysresearch',
		iconKind: 'flask',
		tag: 'next-batch proposal · 4 variants · auto-sysresearch',
		subject: 'NL-to-SQL — next variant batch',
		preview:
			'Higher temperature + larger context window + retrieval re-rank — optimizer expects +1.8 pts accuracy, projected latency 240–280ms.',
		principleLabel: 'NL-to-SQL optimization preference',
	},
];

const STORAGE_KEY = 'studio:demo-decisions-v1';
export const DECISIONS_EVENT = 'studio:demo-decisions-changed';

type StatusMap = Record<string, DecisionStatus>;

function loadStatuses(): StatusMap {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as StatusMap) : {};
	} catch {
		return {};
	}
}

function saveStatuses(m: StatusMap): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
	} catch { /* ignore */ }
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(DECISIONS_EVENT));
	}
}

/** Returns every demo decision + its current status (defaults to 'pending'). */
export function loadDecisions(): Array<DemoDecision & { status: DecisionStatus }> {
	const m = loadStatuses();
	return SEED.map((d) => ({ ...d, status: m[d.id] ?? 'pending' }));
}

/** The subset of decisions still awaiting the user's call — surfaces in
 *  both "Pending your call" (Intents) and "Drafts" (Inbox). */
export function loadPendingDecisions(): DemoDecision[] {
	const m = loadStatuses();
	return SEED.filter((d) => (m[d.id] ?? 'pending') === 'pending');
}

export function setDecisionStatus(id: string, status: DecisionStatus): void {
	const m = loadStatuses();
	m[id] = status;
	saveStatuses(m);
}

/** Reset the demo decisions to the SEED state — useful for re-running pitches. */
export function resetDecisions(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch { /* ignore */ }
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(DECISIONS_EVENT));
	}
}
