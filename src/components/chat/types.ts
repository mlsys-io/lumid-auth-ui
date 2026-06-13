// Chat wire + UI types, extracted from StudioChat.tsx so the protocol
// module (SSE parsing), effects map, and the chat component share one
// vocabulary without circular imports.

import type { ComposedDraft } from '../workflow/AssemblyCard';

export type Role = 'user' | 'assistant';

// A file the user dropped into the input. Lives in pending state
// until send(). image → base64; text → raw string.
export type Attachment =
	| { kind: 'image'; name: string; mime: string; dataB64: string; sizeBytes: number }
	| { kind: 'text'; name: string; text: string; sizeBytes: number }
	| { kind: 'document'; name: string; mime: string; dataB64: string; sizeBytes: number };

// Wire format for the request body — mirrors the backend chatAttachment.
export type WireAttachment =
	| { kind: 'image'; name: string; mime: string; data_b64: string }
	| { kind: 'text'; name: string; text: string }
	| { kind: 'document'; name: string; mime: string; data_b64: string };

export type ToolCall = {
	id?: string;     // tool_use_id from the LLM, used to correlate tool_start → tool_call
	name: string;
	ok: boolean;
	args?: Record<string, unknown>;      // from tool_call SSE event (already emitted by backend)
	result?: Record<string, unknown>;    // from tool_call SSE event
	summary?: string;
	resultSummary?: string;
	// `pending` = received tool_start but no tool_call yet (in-flight).
	pending?: boolean;
	// `approvalRequired` = backend emitted tool_approval_required; user must Allow/Deny.
	approvalRequired?: boolean;
	approvalId?: string;  // the approval_id to send to /tool-approve
	link?: { to: string; label: string };
};

export type Message = {
	role: Role;
	content: string;
	// Live-streamed reasoning from extended thinking. Rendered in a
	// collapsible block above the main reply.
	thinking?: string;
	thinkingDone?: boolean;
	// Pretty-printed tool calls the agent ran on this turn (assistant only).
	tools?: ToolCall[];
	// Marks the single consolidated "loop activity" note (studio:notify),
	// so repeated loop events update one message instead of spamming.
	notify?: boolean;
	notifyCount?: number;
	// Rich draft from a compose_workflow tool call. When present, the bubble
	// renders an inline AssemblyCard (the workflow being assembled, search by
	// search) instead of popping a modal.
	composed?: ComposedDraft;
	// When set, the bubble renders an inline AppSurfaceCard — the app's home
	// surface (stats/tables/forms) live inside the conversation. Set by the
	// open-app bridge (navigating to an app) and by show_app_surface results.
	appSurface?: { app: string; surface?: string };
};
