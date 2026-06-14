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
	| 'intent'
	| 'experiment';

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

// ─── ViewingContext (page→chat spine) ──────────────────────────────
//
// The structured "what is the user looking at" payload sent with every
// chat turn (replaces the old prose preamble that was prepended to the
// user's message content and polluted the stored transcript). The
// backend renders it into a per-request system block plus tool
// grounding hints ("'this run' → cycle_detail app=… loop=… ts=…").

export interface ViewingContext {
	path: string;
	/** Page family: apps | app | app-surface | runs | run-detail | inbox |
	 *  knowledge | knowledge-agent | marketplace | skills | experiments |
	 *  home | settings | admin | other */
	page: string;
	app?: string;
	loop?: string;
	run_id?: string;
	cycle?: { app: string; loop: string; ts: string };
	selection?: StudioSelection;
	picked?: StudioPickedTarget;
	/** Compact live-state summary for the agent-led app opener (frontend-
	 *  prefetched from cached workflows). Override-only — not derived here. */
	app_state?: { failing?: string[]; running?: string[]; lastRunRel?: string; loopCount?: number };
}

/**
 * Derive the ViewingContext from the current location. `search` is the
 * query string (location.search) — ?selected=<loop> and &cycle=<ts>
 * carry the open observability panel on /studio/apps/:app.
 * `override` (from a studio:ask event) wins field-by-field.
 */
export function buildViewingContext(
	pathname: string,
	search = '',
	override?: Partial<ViewingContext>,
): ViewingContext {
	const q = new URLSearchParams(search);
	const ctx: ViewingContext = { path: pathname + (search || ''), page: 'other' };

	let m: RegExpMatchArray | null;
	if ((m = pathname.match(/^\/studio\/apps\/([^/]+)/))) {
		ctx.page = 'app';
		ctx.app = decodeURIComponent(m[1]);
		const sel = q.get('selected');
		if (sel) ctx.loop = sel;
		const cy = q.get('cycle');
		if (cy && ctx.app && sel) ctx.cycle = { app: ctx.app, loop: sel, ts: cy };
	} else if (pathname.startsWith('/studio/apps')) {
		ctx.page = 'apps';
	} else if ((m = pathname.match(/^\/studio\/a\/([^/]+)/))) {
		ctx.page = 'app-surface';
		ctx.app = decodeURIComponent(m[1]);
	} else if ((m = pathname.match(/^\/studio\/runs\/([^/]+)/))) {
		ctx.page = 'run-detail';
		ctx.run_id = decodeURIComponent(m[1]);
	} else if (pathname.startsWith('/studio/runs')) {
		ctx.page = 'runs';
	} else if (pathname.startsWith('/studio/inbox')) {
		ctx.page = 'inbox';
	} else if ((m = pathname.match(/^\/studio\/knowledge\/([^/]+)/))) {
		ctx.page = 'knowledge-agent';
	} else if (pathname.startsWith('/studio/knowledge')) {
		ctx.page = 'knowledge';
	} else if (pathname.startsWith('/studio/library/skills') || pathname.startsWith('/studio/skills')) {
		ctx.page = 'skills';
	} else if (pathname.startsWith('/studio/library/experiments') || pathname.startsWith('/studio/experiments')) {
		ctx.page = 'experiments';
	} else if (pathname.startsWith('/studio/marketplace') || pathname.startsWith('/studio/library')) {
		ctx.page = 'marketplace';
	} else if (pathname.startsWith('/studio/intents') || pathname.startsWith('/studio/today')) {
		ctx.page = 'home';
	} else if (pathname.startsWith('/studio/settings') || pathname.startsWith('/studio/account')) {
		ctx.page = 'settings';
	} else if (pathname.startsWith('/studio/admin')) {
		ctx.page = 'admin';
	}

	// Fold in the page-declared selection + the user-pinned pick. The
	// pick is the explicit override ("this is what I'm pointing at"),
	// so it rides alongside, not instead of, the selection.
	if (current) ctx.selection = current;
	if (picked) ctx.picked = picked;

	return override ? { ...ctx, ...override } : ctx;
}
