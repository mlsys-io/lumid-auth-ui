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
	payload: {
		step_recap?: StepRecap[];
		cycle_dir?: string;
		score?: Record<string, unknown>;
		flags?: string[];
		drafts_pending?: Array<{ draft_id: string; skill_id?: string; role?: string; kind?: string }>;
		[k: string]: unknown;
	};
	posted_at: number;
	seen_at: number | null;
	/** Number of step instructions queued after user replies (client-side only). */
	_instructionsQueued?: number;
}

export interface ListMessagesParams {
	app?: string;
	since?: number;
	limit?: number;
	unread_only?: boolean;
	/** Comma-separated kind allowlist, e.g. "question,flag,draft_pending" —
	 *  surfaces attention-needed messages above the cycle_summary flood. */
	kind?: string;
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

export type ReplyKind = "approve" | "reject" | "text" | "override" | "step_instructions";

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

// ── Step-instructions reply (Theme F.x) ────────────────────────────

export interface StepInstructionsReply {
	step_id: string;
	instructions: string;
	scope: "next_cycle" | "persist";
	loop?: string;
	app?: string;
}

/** POST /api/v1/inbox/{message_id}/reply with kind=step_instructions —
 *  post a per-step operator instruction for the given message.
 *  scope="next_cycle" applies once; scope="persist" writes to xpcloud.yaml. */
export async function postStepInstructions(
	messageId: string,
	reply: StepInstructionsReply,
): Promise<{ reply_id: string; message_id: string; posted_at: number }> {
	const { data } = await inboxClient.post(`/${messageId}/reply`, {
		kind: "step_instructions",
		...reply,
	});
	return data;
}

export interface StepRecap {
	step_id: string;
	skill?: string;
	stage?: string;
	summary?: string;
	outcome?: string; // e.g. "ACCEPTED", "BLOCKED", "ok"
	current_instructions?: string;
}
