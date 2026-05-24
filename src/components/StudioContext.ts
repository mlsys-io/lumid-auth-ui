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
	| 'skill';

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

/**
 * Build the page-context preamble that StudioChat prepends to user
 * turns. Pure function; returns a single line string suitable for the
 * agent's user-content prefix.
 */
export function buildSelectionPreamble(pathname: string): string {
	const sel = current;
	if (!sel) {
		return `(I'm on Studio page ${pathname})`;
	}
	const parts: string[] = [
		`(I'm on ${pathname}.`,
		`Selection: ${sel.kind} id=${sel.id}`,
	];
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
	return parts.join(' ') + ')';
}
