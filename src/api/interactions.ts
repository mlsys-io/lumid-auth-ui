// Studio surface interaction capture — POST /api/v1/me/interaction-events.
//
// Fire-and-forget by construction. Analytics must never break, block, or slow
// the page someone is using: every call swallows its own failure, and nothing
// awaits it. If the endpoint is down the user sees nothing at all, which is the
// correct trade for a telemetry channel.
//
// The vocabulary is CLOSED and mirrored from the server, which rejects anything
// outside it. Keeping the union here means a typo is a type error rather than a
// 400 discovered in production.

import apiClient from './client';

export type InteractionAction = 'surface_view' | 'form_submit' | 'row_action' | 'nav';

export interface InteractionEvent {
	app: string;
	action: InteractionAction;
	surface?: string;
	widget?: string;
	/** A NAME — a loop, an action label. Never a value the user typed. */
	target?: string;
	ok?: boolean;
	duration_ms?: number;
}

export function recordInteraction(ev: InteractionEvent): void {
	if (!ev.app) return; // an unattributed event answers nothing
	void apiClient
		.post('/api/v1/me/interaction-events', { events: [ev] })
		.catch(() => {
			/* deliberately silent — see the header */
		});
}
