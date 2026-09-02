// protocol — the chat SSE stream parser + per-event reducer, extracted
// from StudioChat.tsx. One reader loop serves every send path (the old
// queueSend/dispatchTurn duplication meant `route`/`usage` events were
// handled on one path and silently dropped on the other).

import type { ComposedDraft } from '../workflow/AssemblyCard';
import { baseToolName, unwrapToolResult, type Message, type ToolCall } from './types';
import { dispatchToolEffects, toolLink, type DataScope } from './effects';
// The block state machine. handleEvent is a thin wire adapter over it: all
// ordering, nesting and correlation logic lives in ./blocks so it stays pure
// and replayable (e2e/blocks-replay.mjs).
import * as B from './blocks';
import { parseTurnStats, type TurnStats } from '../claude/TurnStats';

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>;

/** Sub-agent usage blob → a token count for the progress line. */
function subagentTokens(u: unknown): number | undefined {
	if (!u || typeof u !== 'object') return undefined;
	const o = u as Record<string, unknown>;
	const n = o.total_tokens ?? o.output_tokens;
	return typeof n === 'number' ? n : undefined;
}

export interface StreamMeta {
	onClaudeSession?: (sessionId: string) => void;
	onRoute?: (modelUsed: string, autoRouted: boolean) => void;
	onUsage?: (used: number, limit: number) => void;
	// Per-turn telemetry from the Claude Code `result` event (cost, durations,
	// steps, cache split). Distinct from onUsage, which is the per-user budget.
	onTurnStats?: (s: TurnStats) => void;
	// Sandbox-assigned id for this run; POST /me/agent/chat/interrupt targets it
	// to stop the turn cooperatively instead of tearing the stream.
	onTurnId?: (turnID: string) => void;
	// The session's tool/agent/skill/MCP surface, from system/init. Claude Code
	// shows this; we had been forwarding it and dropping it on the floor.
	onCapabilities?: (c: { model?: string; tools?: string[]; agents?: string[]; skills?: string[]; mcp?: unknown }) => void;
}

// Read the fetch-SSE body to completion, dispatching every event.
// Meta events (claude_session / route / usage) go to the handlers;
// everything else goes through handleEvent into the message list.
export async function readChatStream(r: Response, setMessages: SetMessages, meta: StreamMeta = {}, signal?: AbortSignal): Promise<void> {
	if (!r.body) return;
	const reader = r.body.getReader();
	// Abort-aware: relying on fetch's signal to error the body stream is
	// unreliable through the nginx/FRP proxy chain — reader.read() can hang
	// pending forever, so the stop button never terminates the loop and
	// `streaming` stays true (dead stop button + stuck message queue). Cancel
	// the reader explicitly on abort so read() resolves promptly and the loop
	// exits; re-throw AbortError after so the caller shows "— stopped —".
	const onAbort = () => { reader.cancel().catch(() => { /* already closing */ }); };
	if (signal) {
		if (signal.aborted) { onAbort(); throw new DOMException('Aborted', 'AbortError'); }
		signal.addEventListener('abort', onAbort, { once: true });
	}
	const decoder = new TextDecoder();
	let buf = '';
	// Tracks whether the server's own terminal `done` event was actually
	// received, distinct from the fetch stream's `reader.read()` reporting
	// `done: true` (which just means the underlying TCP connection closed —
	// true both for a clean server-side finish AND for a proxy/network
	// cutoff mid-turn, e.g. an intermediary's read timeout). Before this,
	// readChatStream returned successfully either way: dispatchTurn's
	// `break; // success` never fired, an interrupted turn was
	// indistinguishable from a completed one, and the user was left staring
	// at a truncated answer with no error, no retry, nothing to say their
	// message + partial progress were saved and a follow-up would resume —
	// exactly the "stale chat" symptom reported after long tool-heavy turns.
	let sawDone = false;
	let sawError = false;
	// Delta coalescing: consecutive text/thinking deltas within one network
	// chunk collapse into ONE setMessages, so the render rate is capped at the
	// chunk arrival rate instead of the token rate. On a fast stream a chunk
	// carries dozens of tokens; dispatching each one re-rendered (and re-parsed
	// the markdown of) the live message once per token — the top term of the
	// "slower and slower as the reply grows" O(n²). Ordering is preserved: the
	// pending run is flushed before ANY other event kind is dispatched.
	let pend: { kind: 'text' | 'thinking'; delta: string; parent?: string; idx?: number } | null = null;
	const flushPending = () => {
		if (!pend) return;
		const p = pend;
		pend = null;
		setMessages((prev) => withLastAssistant(prev, (m) =>
			p.kind === 'text'
				? B.appendText(m, p.delta, p.parent, p.idx)
				: B.appendReasoning(m, p.delta, p.parent, p.idx)));
	};
	try {
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let nl: number;
		// Each event ends with \n\n; one or more "data: …\n" lines per event.
		while ((nl = buf.indexOf('\n\n')) >= 0) {
			const raw = buf.slice(0, nl);
			buf = buf.slice(nl + 2);
			for (const line of raw.split('\n')) {
				if (!line.startsWith('data: ')) continue;
				try {
					const evt = JSON.parse(line.slice(6));
					if ((evt.type === 'text' || evt.type === 'thinking') && typeof evt.delta === 'string') {
						const parent = typeof evt.parent_id === 'string' && evt.parent_id ? evt.parent_id : undefined;
						const idx = typeof evt.index === 'number' ? evt.index : undefined;
						if (pend && pend.kind === evt.type && pend.parent === parent && pend.idx === idx) {
							pend.delta += evt.delta;
						} else {
							flushPending();
							pend = { kind: evt.type, delta: evt.delta, parent, idx };
						}
						continue;
					}
					// Any non-delta event closes the pending run first so block
					// boundaries, tool events, and terminals keep arrival order.
					flushPending();
					if (evt.type === 'claude_session') {
						if (evt.session_id) meta.onClaudeSession?.(String(evt.session_id));
					} else if (evt.type === 'route') {
						meta.onRoute?.(String(evt.model_used || ''), !!evt.auto_routed);
					} else if (evt.type === 'capabilities') {
						meta.onCapabilities?.({
							model: evt.model, tools: evt.tools, agents: evt.agents,
							skills: evt.skills, mcp: evt.mcp_servers,
						});
					} else if (evt.type === 'turn_id') {
						if (evt.turn_id) meta.onTurnId?.(String(evt.turn_id));
					} else if (evt.type === 'turn_stats') {
						meta.onTurnStats?.(parseTurnStats(evt));
					} else if (evt.type === 'usage') {
						if (typeof evt.budget_used === 'number' && typeof evt.budget_limit === 'number') {
							meta.onUsage?.(evt.budget_used, evt.budget_limit);
						}
						// usage also carries model_used / auto_routed (in case
						// the stream caller missed the early route event).
						if (evt.model_used) meta.onRoute?.(String(evt.model_used), !!evt.auto_routed);
					} else {
						if (evt.type === 'done') sawDone = true;
						// The server already surfaces its own detected errors via
						// handleEvent's 'error' notice below -- don't ALSO throw the
						// generic "interrupted" notice on top of a specific one.
						else if (evt.type === 'error') sawError = true;
						handleEvent(evt, setMessages);
					}
				} catch { /* malformed line; skip */ }
			}
		}
		// End of chunk: paint what arrived rather than holding the tail for
		// the next network read (a stalled stream must not hide tokens).
		flushPending();
	}
	} finally {
		flushPending();
		if (signal) signal.removeEventListener('abort', onAbort);
	}
	// If we exited the loop because of an abort (reader was cancelled), surface
	// it as AbortError so the caller renders "— stopped —" and runs its finally
	// (resetting `streaming` → the queue can drain).
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	// The underlying connection closed without the server's own `done` (or an
	// already-surfaced `error`) event ever arriving — a genuine mid-turn
	// cutoff (proxy/network timeout, backend restart, etc.), not a normal
	// finish. Distinguishable by name so the caller can tell this apart from
	// both a clean completion and the pre-stream network-blip retry case.
	if (!sawDone && !sawError) {
		const err = new Error('stream ended without a terminal event');
		err.name = 'StreamInterrupted';
		throw err;
	}
}

export function handleEvent(
	evt: { type: string; [k: string]: any },
	setMessages: SetMessages,
) {
	const parent: string | undefined = typeof evt.parent_id === 'string' && evt.parent_id
		? evt.parent_id : undefined;
	const wireIdx: number | undefined = typeof evt.index === 'number' ? evt.index : undefined;

	if (evt.type === 'text' && typeof evt.delta === 'string') {
		setMessages((prev) => withLastAssistant(prev, (m) => B.appendText(m, evt.delta, parent, wireIdx)));
	} else if (evt.type === 'thinking_start') {
		// A NEW reasoning block every time — a turn can think more than once,
		// and the old reducer's `thinking || ''` concatenated the second one
		// onto the first with no separator.
		setMessages((prev) => withLastAssistant(prev, (m) => B.openReasoning(m, parent, wireIdx)));
	} else if (evt.type === 'thinking' && typeof evt.delta === 'string') {
		setMessages((prev) => withLastAssistant(prev, (m) => B.appendReasoning(m, evt.delta, parent, wireIdx)));
	} else if (evt.type === 'thinking_stop') {
		setMessages((prev) => withLastAssistant(prev, (m) => B.closeReasoning(m, parent, wireIdx)));
	} else if (evt.type === 'block_stop') {
		// Close the block so the next delta of that kind starts a fresh one.
		setMessages((prev) => withLastAssistant(prev, (m) => (
			evt.kind === 'thinking' ? B.closeReasoning(m, parent, wireIdx) : B.closeText(m, parent, wireIdx)
		)));
	} else if (evt.type === 'tool_start') {
		// args arrive complete here (the bridge builds tool_start from the
		// finished assistant message), so the pending chip can name its target
		// instead of rendering an empty `$ (bash)`.
		const args = evt.args && typeof evt.args === 'object' ? evt.args as Record<string, unknown> : undefined;
		setMessages((prev) => withLastAssistant(prev, (m) => B.startTool(m, {
			id: String(evt.id || '') || undefined,
			name: String(evt.name || 'tool'),
			args,
			summary: args ? summarizeToolArgs(args) : undefined,
		}, parent)));
	} else if (evt.type === 'tool_args_delta' && typeof evt.partial_json === 'string') {
		setMessages((prev) => withLastAssistant(prev, (m) => B.appendToolArgs(m, String(evt.id || ''), evt.partial_json, parent)));
	} else if (evt.type === 'subagent_start') {
		setMessages((prev) => withLastAssistant(prev, (m) => B.startSubagent(m, {
			taskId: evt.task_id ? String(evt.task_id) : undefined,
			toolUseId: evt.tool_use_id ? String(evt.tool_use_id) : undefined,
			subagentType: evt.subagent_type ? String(evt.subagent_type) : undefined,
			description: evt.description ? String(evt.description) : undefined,
			prompt: evt.prompt ? String(evt.prompt) : undefined,
		})));
	} else if (evt.type === 'subagent_progress') {
		setMessages((prev) => withLastAssistant(prev, (m) => B.progressSubagent(m, {
			taskId: evt.task_id ? String(evt.task_id) : undefined,
			toolUseId: evt.tool_use_id ? String(evt.tool_use_id) : undefined,
			description: evt.description ? String(evt.description) : undefined,
			lastToolName: evt.last_tool_name ? String(evt.last_tool_name) : undefined,
			tokens: subagentTokens(evt.usage),
			status: evt.status ? String(evt.status) : undefined,
		})));
	} else if (evt.type === 'subagent_done') {
		setMessages((prev) => withLastAssistant(prev, (m) => B.doneSubagent(m, {
			taskId: evt.task_id ? String(evt.task_id) : undefined,
			toolUseId: evt.tool_use_id ? String(evt.tool_use_id) : undefined,
			status: evt.status ? String(evt.status) : undefined,
			summary: evt.summary ? String(evt.summary) : undefined,
			tokens: subagentTokens(evt.usage),
		})));
	} else if (evt.type === 'thinking_tokens') {
		// The CLI's own reasoning-token count, replacing the ~4-chars/token
		// estimate. Applies to the newest open reasoning block.
		if (typeof evt.tokens === 'number') {
			setMessages((prev) => withLastAssistant(prev, (m) => B.setReasoningTokens(m, evt.tokens, parent)));
		}
	} else if (evt.type === 'stopped') {
		// User pressed Stop. An ordered notice, NOT an error — the turn did what
		// was asked of it.
		setMessages((prev) => withLastAssistant(prev, (m) => B.pushNotice(m, 'info', 'Stopped')));
	} else if (evt.type === 'compaction') {
		setMessages((prev) => withLastAssistant(prev, (m) => B.pushNotice(
			m, 'info', 'Context compacted',
			evt.pre ? `was ${evt.pre} tokens` : undefined,
		)));
	} else if (evt.type === 'tool_approval_required') {
		// Backend paused; update the pending chip to show approval buttons.
		setMessages((prev) => withLastAssistant(prev, (m) => B.markApproval(m, {
			id: String(evt.id || '') || undefined,
			name: evt.name ? String(evt.name) : undefined,
			approvalId: String(evt.approval_id || ''),
			args: evt.args as Record<string, unknown> | undefined,
		})));
	} else if (evt.type === 'tool_call') {
		const ok = evt.ok !== false;
		const result = (evt.result || undefined) as Record<string, unknown> | undefined;
		const completed: ToolCall = {
			id: String(evt.id || ''),
			name: String(evt.name || 'tool'),
			ok,
			args: evt.args as Record<string, unknown> | undefined,
			result,
			resultTyped: (evt.result_typed && typeof evt.result_typed === 'object')
				? evt.result_typed as Record<string, unknown> : undefined,
			summary: summarizeToolArgs(evt.args),
			resultSummary: summarizeToolResult(evt.name, evt.result),
			pending: false,
			approvalRequired: false,
			// Map-driven deep link on the chip (effects.ts) — "Open →" is
			// what closes the install/run loop without leaving the chat.
			link: ok ? toolLink(String(evt.name || ''), result, evt.args as Record<string, unknown> | undefined) : undefined,
		};
		// Correlation is SCOPED by parent_id. The old flat version fell back to
		// "last pending with the same name" across the whole list, so a
		// sub-agent's Bash result would complete the PARENT's pending Bash.
		setMessages((prev) => withLastAssistant(prev, (m) => B.completeTool(m, completed, parent)));
		// Chat→page bus: a successful mutating tool invalidates the data
		// scopes it touched; pages re-fetch via useStudioRefetch instead of
		// waiting out their polling interval. The server emits the authoritative
		// scope list on the event (me_agent_scopes.go); fall back to the local
		// map for older servers / not-yet-mapped tools.
		if (ok) {
			const serverScopes = Array.isArray(evt.scopes) ? (evt.scopes as DataScope[]) : undefined;
			dispatchToolEffects(String(evt.name || ''), evt.args as Record<string, unknown> | undefined, result, serverScopes);
		}
		// Surface compose_workflow results INLINE — attach the rich draft to
		// this assistant message so the bubble renders an AssemblyCard (the
		// workflow assembling itself, search by search). No modal: the build
		// IS the conversation.
		if (evt.name === 'compose_workflow' && ok && evt.result) {
			const r = evt.result as Record<string, any>;
			const draft: ComposedDraft = {
				slug: String(r.draft_slug || ''),
				intent: String(r.intent || ''),
				skills: Array.isArray(r.skills_picked) ? r.skills_picked : [],
				skill_summaries: Array.isArray(r.skill_summaries) ? r.skill_summaries : undefined,
				for_app: String(r.for_app || ''),
				kind: r.kind ? String(r.kind) : undefined,
				steps: Array.isArray(r.steps) ? r.steps : undefined,
				schedule: r.schedule ? String(r.schedule) : undefined,
				schedule_human: r.schedule_human ? String(r.schedule_human) : undefined,
				goal: r.goal || undefined,
				risk_agent: r.risk_agent ? String(r.risk_agent) : undefined,
				mode: r.mode ? String(r.mode) : undefined,
				assembly_trace: r.assembly_trace || undefined,
			};
			if (draft.slug) {
				// An ordered card block, so the AssemblyCard lands where
				// compose_workflow actually completed instead of being forced
				// to the top of the turn.
				setMessages((prev) => withLastAssistant(prev, (m) => B.pushCard(m, { type: 'assembly', draft }, draft.slug)));
			}
		}
		// Auto-open the artifact panel when the agent saves a new artifact.
		// StudioArtifactPanel listens for this event, refreshes the list,
		// and selects the new id.
		if (evt.name === 'save_artifact' && ok && evt.result && evt.result.id) {
			window.dispatchEvent(new CustomEvent('studio:artifact-saved', {
				detail: { id: String(evt.result.id) },
			}));
		}
		// Open the workflow-viz side panel when a Lumilake workflow tool
		// completes — StudioWorkflowPanel renders the DAG (parsed from the
		// tool's `workflow_yaml` arg) + the HALO plan (the result) as overlay.
		// Tools arrive over the MCP wire as `mcp__lumid__optimize_workflow`; the
		// panel dispatch keys on the bare name, so normalize first (was silently
		// never matching → the DAG/HALO side panel never opened from chat).
		const wfName = baseToolName(String(evt.name || ''));
		if ((wfName === 'optimize_workflow' || wfName === 'run_workflow') && ok && evt.result) {
			const a = (evt.args && typeof evt.args === 'object')
				? evt.args as Record<string, unknown>
				: (() => { try { return JSON.parse(String(evt.args)); } catch { return {}; } })();
			const wfYaml = typeof a.workflow_yaml === 'string' ? a.workflow_yaml : '';
			if (wfYaml.trim()) {
				window.dispatchEvent(new CustomEvent('studio:workflow-open', {
					detail: {
						workflow_yaml: wfYaml,
						plan: unwrapToolResult(evt.result),
						title: wfName === 'run_workflow' ? 'Workflow run' : 'Workflow · HALO plan',
					},
				}));
			}
		}
	} else if (evt.type === 'error' && evt.message) {
		// An ordered block, not text glued onto the reply — so the error sits
		// where it happened and never pollutes m.content (which is the wire
		// history the next turn replays).
		setMessages((prev) => withLastAssistant(prev, (m) => B.pushNotice(m, 'error', friendlyChatError(evt.message))));
	} else if (evt.type === 'notice' && evt.message) {
		// Operator-facing note attached to the turn (admin/super_admin only).
		// Was emitted by the server and silently dropped here.
		setMessages((prev) => withLastAssistant(prev, (m) => B.pushNotice(m, 'info', String(evt.message))));
	}
	// 'done' — no UI change needed.
	// 'ping' — SSE heartbeat that keeps idle intermediaries from dropping a
	//   long tool call; carries no state.
	// 'block_start'/'block_stop'/'tool_args_delta'/'subagent_*'/'capabilities'/
	//   'status'/'compaction'/'turn_stats' — forwarded by the Claude Code
	//   bridge and consumed once the block model lands.
}

// Turn a raw upstream error into something a user can act on. The most
// common one today is the kv.run LLM gateway being unconfigured
// (503 "FINDATA_LLM_BACKEND_URL is empty") — surface that as a calm
// "temporarily offline" line instead of dumping provider JSON.
export function friendlyChatError(raw: string): string {
	const s = String(raw);
	if (/loading model|model.*unavailable|cold|warming/i.test(s)) {
		return '⚠️ The model is warming up (cold GPU). Give it ~30s and try again — your message wasn’t lost.';
	}
	if (/503|service unavailable|backend not configured|FINDATA_LLM_BACKEND_URL|no .*provider accepted/i.test(s)) {
		return '⚠️ The AI model is temporarily offline. Your message wasn’t lost — try again shortly.';
	}
	if (/401|sign in|unauthor/i.test(s)) {
		return '⚠️ Please sign in to use chat.';
	}
	if (/daily.*budget|budget exhausted/i.test(s)) {
		return '⚠️ You’ve hit today’s chat token budget. It resets in 24h — or ask an admin to raise it.';
	}
	// Claude pool quota (claude-code models) — windows roll continuously;
	// reset times live on the composer quota pill and lum.id/code.
	if (/pooled claude quota|pool quota/i.test(s)) {
		return '⚠️ Your Claude pool quota is used up for now. It rolls back as older usage ages out — reset times are on the quota pill or lum.id/code.';
	}
	if (/sandbox is at capacity/i.test(s)) {
		return '⚠️ The Claude Code sandbox is at capacity — give it a minute and try again.';
	}
	if (/429|rate.?limit|too many requests/i.test(s)) {
		return '⚠️ Going a little fast — give it a few seconds and try again.';
	}
	return `⚠️ ${s}`;
}

export function withLastAssistant(
	prev: Message[],
	patch: (m: Message) => Message,
): Message[] {
	if (prev.length === 0) return prev;
	const last = prev[prev.length - 1];
	if (last.role !== 'assistant') return prev;
	return [...prev.slice(0, -1), patch(last)];
}

export function summarizeToolArgs(args: unknown): string {
	if (!args || typeof args !== 'object') return '';
	const a = args as Record<string, unknown>;
	const keys = Object.keys(a);
	if (keys.length === 0) return '';
	// Show 1-2 representative values
	const pick = keys.slice(0, 2).map((k) => {
		const v = a[k];
		const s = typeof v === 'string' ? v : JSON.stringify(v);
		return `${k}=${s.slice(0, 30)}${s.length > 30 ? '…' : ''}`;
	});
	return pick.join(' · ');
}

// Short human-readable summary of a tool's result, used for the chip
// subtitle line. Per-tool because the interesting field is different
// for each (search → result count; fetch → page title; etc).
export function summarizeToolResult(name: unknown, result: unknown): string | undefined {
	if (!result || typeof result !== 'object') return undefined;
	const r = result as Record<string, any>;
	if (r.error) return String(r.error).slice(0, 80);
	const n = String(name || '');
	if (n === 'web_search' || n === 'deep_research') {
		const count = Array.isArray(r.results) ? r.results.length : 0;
		const ans = typeof r.answer === 'string' ? r.answer.length : 0;
		const parts: string[] = [];
		if (count) parts.push(`${count} result${count === 1 ? '' : 's'}`);
		if (ans) parts.push('answer ready');
		return parts.length ? parts.join(' · ') : undefined;
	}
	if (n === 'web_fetch') {
		const title = typeof r.title === 'string' ? r.title : '';
		const len = typeof r.content === 'string' ? r.content.length : 0;
		if (title) return `${title.slice(0, 50)} (${len} chars)`;
		if (len) return `${len} chars`;
		return undefined;
	}
	if (n === 'bash_exec') {
		const out = typeof r.output === 'string' ? r.output.trim() : '';
		const firstLine = out.split('\n')[0] || '';
		return firstLine ? firstLine.slice(0, 80) : `exit ${r.exit_code ?? '?'}`;
	}
	if (n === 'read_file') {
		const bytes = typeof r.size === 'number' ? r.size : 0;
		return `${bytes} bytes${r.truncated ? ' (truncated)' : ''}`;
	}
	if (n === 'write_file' || n === 'edit_file') {
		return typeof r.path === 'string' ? r.path.split('/').pop() : undefined;
	}
	return undefined;
}
