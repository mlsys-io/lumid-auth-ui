// Phase S6b — workspace selection signaling for the chat agent.
//
// Each Studio page can declare what the user is currently focused on
// (the open draft, the app being edited, the agent whose memories are
// displayed). StudioChat reads this at send-time and folds it into
// the message preamble so the agent doesn't need the user to re-state
// "the one I'm looking at".
//
// Implementation: module-level state, not a React provider. We don't
// need rerenders here — the value is only read inside the chat send
// callback. This keeps pages lightweight (one useEffect to set, one
// to clear) and StudioChat doesn't have to subscribe to context.

export type StudioSelectionKind =
	| 'draft'
	| 'app'
	| 'loop'
	| 'cycle'
	| 'agent'
	| 'memory'
	| 'skill'
	| 'intent';

export interface StudioSelection {
	kind: StudioSelectionKind;
	/** Stable identifier the agent can pass back to tools (draft id, app slug, agent id, …). */
	id: string;
	/** Human-readable label. Shown in the chat preamble so the user sees what's in context. */
	label?: string;
	/** Verb hints — what tools the agent can call on this selection. e.g. ['send', 'edit', 'dismiss']. */
	affordances?: string[];
	/** Free-form extras the agent might find useful. Keep small — this goes into every chat turn. */
	meta?: Record<string, string | number | boolean>;
}

let current: StudioSelection | null = null;

export function setStudioSelection(s: StudioSelection | null): void {
	current = s;
}

export function getStudioSelection(): StudioSelection | null {
	return current;
}

// ─── Picked target (mouse-picker) ──────────────────────────────────
//
// `setStudioSelection` is page-declared (an open route says "the user
// is focused on intent X"). `setStudioPickedTarget` is user-declared
// via the chat's mouse-picker: the user clicked a pickable element on
// the page and pinned it as the active reference. The pick takes
// precedence over the page selection in the chat preamble — the user
// override is explicit, the page declaration is implicit.

export interface StudioPickedTarget {
	kind: string;        // free-form (mirrors data-pick-kind on the element)
	id: string;          // stable id from data-pick-id
	label: string;       // human-readable; falls back to truncated innerText
	affordances?: string[];
}

let picked: StudioPickedTarget | null = null;
const pickedListeners = new Set<(t: StudioPickedTarget | null) => void>();

export function setStudioPickedTarget(t: StudioPickedTarget | null): void {
	picked = t;
	pickedListeners.forEach((l) => l(t));
}

export function getStudioPickedTarget(): StudioPickedTarget | null {
	return picked;
}

/** React-friendly subscription so the chip above the chat input can re-render. */
export function subscribeStudioPickedTarget(l: (t: StudioPickedTarget | null) => void): () => void {
	pickedListeners.add(l);
	return () => { pickedListeners.delete(l); };
}

/**
 * Build the page-context preamble that StudioChat prepends to user
 * turns. Pure function; returns a single line string suitable for the
 * agent's user-content prefix. When a picked target is present it is
 * appended after the page-level selection.
 */
export function buildSelectionPreamble(pathname: string): string {
	const parts: string[] = [`(I'm on ${pathname}.`];

	const sel = current;
	if (sel) {
		parts.push(`Selection: ${sel.kind} id=${sel.id}`);
		if (sel.label) parts.push(`"${sel.label}"`);
		if (sel.affordances && sel.affordances.length > 0) {
			parts.push(`· can: ${sel.affordances.join(', ')}`);
		}
		if (sel.meta) {
			const flat = Object.entries(sel.meta)
				.map(([k, v]) => `${k}=${String(v)}`)
				.join(' ');
			if (flat) parts.push(`· ${flat}`);
		}
	}

	if (picked) {
		// User-pinned pick takes precedence — "this is what I'm
		// pointing at right now." The agent should treat the picked
		// target as the primary referent over the page selection.
		parts.push(`· I am pointing at: ${picked.kind} id=${picked.id}`);
		if (picked.label) parts.push(`"${picked.label}"`);
		if (picked.affordances && picked.affordances.length > 0) {
			parts.push(`(can: ${picked.affordances.join(', ')})`);
		}
	}

	return parts.join(' ') + ')';
}
