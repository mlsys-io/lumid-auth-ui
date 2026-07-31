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
	// The claude CLI's TYPED result, forwarded by the bridge alongside the
	// flattened `result`. Bash → {stdout, stderr, interrupted, isImage};
	// Task/Agent → {totalTokens, totalToolUseCount, toolStats, status}. Only
	// present for the MAIN agent's calls — the CLI omits it on the user
	// messages it forwards for a sub-agent.
	resultTyped?: Record<string, unknown>;
	summary?: string;
	resultSummary?: string;
	// `pending` = received tool_start but no tool_call yet (in-flight).
	pending?: boolean;
	// `approvalRequired` = backend emitted tool_approval_required; user must Allow/Deny.
	approvalRequired?: boolean;
	approvalId?: string;  // the approval_id to send to /tool-approve
	link?: { to: string; label: string };
};

// ── Block model ─────────────────────────────────────────────────────────────
// An assistant turn is an ORDERED list of blocks, mirroring the provider's
// content-block stream: arrival order IS render order. The older shape
// (content + thinking + tools[]) could not express text→tool→text ordering,
// held only one thinking block, and had no parent/child — so a sub-agent's
// tool calls rendered as the main agent's own siblings.
//
// Block ids are DETERMINISTIC (never a random or global counter): tool and
// sub-agent blocks key off the wire tool_use_id, text/reasoning blocks off
// their ordinal within their scope. Re-running a reducer on the same base
// state therefore yields identical ids — safe under StrictMode's
// double-invoked updaters, and stable as React keys.
export type BlockId = string;

export type TextBlock = {
	kind: 'text';
	id: BlockId;
	text: string;
	idx?: number;    // wire content-block index, when known
	done?: boolean;  // content_block_stop seen
};

// Named ReasoningBlock, not ThinkingBlock: StudioChat already owns the
// identifier `ThinkingBlock` for the collapsible component.
export type ReasoningBlock = {
	kind: 'reasoning';
	id: BlockId;
	text: string;
	idx?: number;
	done?: boolean;
	startedAt?: number;  // for "thought for Ns"
	endedAt?: number;
	// The CLI's own reasoning-token count (system/thinking_tokens). When absent
	// the renderer falls back to a ~4-chars/token estimate.
	tokens?: number;
};

// Wraps the EXISTING ToolCall verbatim so every renderer in toolViews.tsx and
// entityCards.tsx (all typed `{ t: ToolCall }`) keeps working untouched.
export type ToolBlock = {
	kind: 'tool';
	id: BlockId;
	tool: ToolCall;
	partialJson?: string;  // input_json_delta accumulator, pre-parse
};

export type SubagentStatus = 'running' | 'ok' | 'error' | 'cancelled';

// A Task tool call plus the sub-agent's own ordered blocks.
//
// Correlation carries BOTH keys on purpose: sub-agent data arrives on two
// unordered channels — assistant/user messages tagged with parent_tool_use_id,
// and system/task_* events keyed by task_id — and task_updated ships task_id
// with NO tool_use_id (verified against a real CLI capture). Every creation
// path must go through ensureSubagent() so either key finds the same block.
export type SubagentBlock = {
	kind: 'subagent';
	id: BlockId;
	tool: ToolCall;          // the parent Task/Agent tool_use
	toolUseId?: string;      // children arrive with parent_id === this
	taskId?: string;         // key for system/task_* events
	subagentType?: string;   // 'general-purpose', 'Explore', …
	description?: string;
	prompt?: string;
	status: SubagentStatus;
	startedAt: number;
	endedAt?: number;
	lastToolName?: string;   // live progress line
	tokens?: number;
	summary?: string;
	children: Block[];
};

// Non-stream artifacts that used to be fixed JSX slots. Modeled as blocks so
// they hold a POSITION in the turn instead of a hardcoded z-order.
export type CardBlock = {
	kind: 'card';
	id: BlockId;
	card:
		| { type: 'assembly'; draft: ComposedDraft }
		| { type: 'appSurface'; app: string; surface?: string }
		| { type: 'entity'; tool: ToolCall };
};

export type ChipsBlock = {
	kind: 'chips';
	id: BlockId;
	chips: Array<{ label: string; prompt: string; context?: { app: string; loop?: string } }>;
};

// Stream-level notes that must sit in order (errors, compaction, stopped).
export type NoticeBlock = {
	kind: 'notice';
	id: BlockId;
	level: 'error' | 'info';
	text: string;
	detail?: string;
};

export type Block =
	| TextBlock | ReasoningBlock | ToolBlock | SubagentBlock
	| CardBlock | ChipsBlock | NoticeBlock;

export type Message = {
	role: Role;
	// FLATTENED text. For block-produced assistant turns this is a MIRROR: the
	// '\n\n'-joined text of TOP-LEVEL TextBlocks only (sub-agent text excluded,
	// so it never leaks into wire history, TTS or copy). It stays materialized
	// because it is a hard external contract — dispatchTurn builds the request
	// history from m.content, and identity's inferTitle reads
	// m["content"].(string) when persisting a thread. Read it for
	// copy/TTS/regenerate/wire; never RENDER from it when `blocks` is present.
	content: string;
	// Ordered content blocks. Absent on user turns, notify notes, app-opener
	// messages, and every thread persisted before the block model — those render
	// via legacyBlocks() in ./blocks.
	blocks?: Block[];

	// Files the user attached to THIS turn. Kept on the message so they render as
	// chips on the bubble, survive a reload, and get re-sent as history so a
	// follow-up ("summarize it again") still sees them. stripForPersist drops the
	// heavy base64/text bodies before persisting — the chip (kind/name/mime) stays.
	attachments?: Attachment[];

	// ── legacy, read-only ────────────────────────────────────────────────────
	// Still written by pre-block producers and present in persisted threads;
	// consumed ONLY by legacyBlocks(). Do not add new readers.
	/** @deprecated use a ReasoningBlock */
	thinking?: string;
	/** @deprecated use a ReasoningBlock */
	thinkingDone?: boolean;
	/** @deprecated use ToolBlock */
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
	// Suggested next-step chips rendered under an agent-led app opener. Each
	// fires a grounded studio:ask turn. Set by openAppInChat; not persisted.
	chips?: Array<{ label: string; prompt: string; context?: { app: string; loop?: string } }>;
};

// LumidOS tools reach the chat stream as Claude-Code MCP names
// `mcp__<server>__<tool>` (e.g. `mcp__lumid__optimize_workflow`), but the
// entity-card RENDERERS and the workflow-panel dispatch key on the BARE tool
// name (`optimize_workflow`). Strip a leading `mcp__<server>__` so both the
// hosted MCP form and native bare tools resolve to the same key. Native tools
// (no `mcp__` prefix) pass through unchanged.
export function baseToolName(name: string): string {
	if (!name || !name.startsWith('mcp__')) return name;
	const parts = name.split('__');
	return parts.slice(2).join('__') || name;
}
