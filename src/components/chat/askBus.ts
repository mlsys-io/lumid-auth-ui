// askBus — make a `studio:ask` survive a page that has no chat mounted.
//
// THE BUG THIS EXISTS FOR. `studio:ask` is a fire-and-forget window event: a
// surface dispatches it and StudioChat, if it happens to be mounted, listens.
// On `/studio/a/:app/:surface` — the FULL-PAGE surface route — no chat rail is
// docked (only the workspace `/studio/apps/:app` and `/studio/data` mount one),
// so the event has no listener and vanishes without a trace. The Discuss button
// appears to work: it depresses, the handler completes, and nothing whatsoever
// happens.
//
// Measured 2026-09-04 by e2e 22 step 9-10: the page snapshot shows the row, the
// `Discuss` button [active] — so the click landed — and ZERO chat inputs. No
// chat row is ever written, and the failure surfaced four minutes later as a
// timeout blaming an unrelated identity fix.
//
// A dropped event cannot be detected by the dispatcher, so the fix is to make
// dispatch answer the question honestly: `askOrStash` returns false when nobody
// is listening, and parks the payload for the next chat that mounts.

// The `studio:ask` payload, mirrored from its dispatch sites (directives.tsx,
// CaseBrowser, ChatEmptyState, TrajectoryGraph). Declared here rather than
// imported because the event has never had a named type — it is assembled
// inline at each site, which is part of why a dropped one went unnoticed.
export type AskDetail = {
	prompt: string;
	autosend?: boolean;
	context?: {
		page?: string;
		app?: string;
		loop?: string;
		selection?: { kind: string; id: string; label: string };
	};
};

const KEY = "studio:pending-ask";

// Listener count rather than a boolean: /studio/data and the workspace can both
// mount and unmount around a navigation, and a boolean would be cleared by the
// OUTGOING chat's unmount after the incoming one had already registered.
let mounted = 0;

export function markChatMounted(): () => void {
	mounted += 1;
	return () => {
		mounted = Math.max(0, mounted - 1);
	};
}

export function isChatMounted(): boolean {
	return mounted > 0;
}

/** Park an ask for the next chat to mount. sessionStorage, so it does not
 *  outlive the tab and cannot resurrect days later on a different page. */
export function stashAsk(detail: AskDetail): void {
	try {
		sessionStorage.setItem(KEY, JSON.stringify(detail));
	} catch {
		/* private mode / quota — the caller already knows nobody listened */
	}
}

/** Take the parked ask, if any. Reads once: a stash that survived its
 *  navigation must not re-fire on every subsequent chat mount. */
export function drainAsk(): AskDetail | null {
	try {
		const raw = sessionStorage.getItem(KEY);
		if (!raw) return null;
		sessionStorage.removeItem(KEY);
		return JSON.parse(raw) as AskDetail;
	} catch {
		try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
		return null;
	}
}

/** Dispatch when a chat is listening; otherwise stash and report false so the
 *  caller can navigate somewhere that has one. */
export function askOrStash(detail: AskDetail): boolean {
	if (isChatMounted()) {
		window.dispatchEvent(new CustomEvent("studio:ask", { detail }));
		return true;
	}
	stashAsk(detail);
	return false;
}
