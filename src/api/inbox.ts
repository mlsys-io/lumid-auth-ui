// Inbox client. Hits xpcloud's /api/v1/inbox/* via the nginx proxy at
// /inbox-api/* (set up in lumid_landing_readdy/nginx.conf). The proxy
// forwards the lm_session cookie as a Bearer header so xpcloud's
// resolve_user introspects via lum.id and scopes by user.sub.
//
// Same axios apiClient as the rest of lumid_ui — no separate auth path,
// no scoped session-bearer needed for this surface.

import axios from "axios";

// Use a separate axios instance pointing at /inbox-api so we don't have
// to reconfigure the main apiClient's baseURL (which targets
// API_BASE_URL i.e. lum.id/api/v1/* for identity routes).
const inboxClient = axios.create({
	baseURL: "/inbox-api",
	timeout: 15000,
	withCredentials: true,
	headers: { "Content-Type": "application/json" },
});

export interface InboxMessage {
	id: string;
	app: string;
	loop: string;
	kind: "cycle_summary" | "draft_pending" | "question" | "flag" | string;
	payload: Record<string, unknown>;
	posted_at: number;
	seen_at: number | null;
}

export interface ListMessagesParams {
	app?: string;
	since?: number;
	limit?: number;
	unread_only?: boolean;
}

export interface ListMessagesResponse {
	messages: InboxMessage[];
	total: number;
	unread: number;
}

/** GET /api/v1/inbox/messages — list the user's inbox messages. */
export async function listInboxMessages(
	params: ListMessagesParams = {},
): Promise<ListMessagesResponse> {
	const { data } = await inboxClient.get("/messages", { params });
	return data;
}

/** POST /api/v1/inbox/{id}/seen — mark a message as read. */
export async function markSeen(messageId: string): Promise<void> {
	await inboxClient.post(`/${messageId}/seen`);
}

export type ReplyKind = "approve" | "reject" | "text" | "override";

export interface ReplyPayload {
	draft_id?: string;
	target_agent?: string;
	body?: string;
	comment?: string;
	reason?: string;
	[k: string]: unknown;
}

/** POST /api/v1/inbox/{id}/reply — human reply to an inbox message.
 *  Reply kinds are dispatched by the local cycle on next entry:
 *  approve → skill_apply / memory_apply, reject → discard, text → ingest. */
export async function postReply(
	messageId: string,
	kind: ReplyKind,
	payload: ReplyPayload = {},
): Promise<{ reply_id: string; posted_at: number }> {
	const { data } = await inboxClient.post(`/${messageId}/reply`, {
		kind,
		payload,
	});
	return data;
}
