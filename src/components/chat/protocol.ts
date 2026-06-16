// protocol — the chat SSE stream parser + per-event reducer, extracted
// from StudioChat.tsx. One reader loop serves every send path (the old
// queueSend/dispatchTurn duplication meant `route`/`usage` events were
// handled on one path and silently dropped on the other).

import type { ComposedDraft } from '../workflow/AssemblyCard';
import type { Message, ToolCall } from './types';
import { dispatchToolEffects, toolLink } from './effects';

type SetMessages = React.Dispatch<React.SetStateAction<Message[]>>;

export interface StreamMeta {
	onClaudeSession?: (sessionId: string) => void;
	onRoute?: (modelUsed: string, autoRouted: boolean) => void;
	onUsage?: (used: number, limit: number) => void;
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
					if (evt.type === 'claude_session') {
						if (evt.session_id) meta.onClaudeSession?.(String(evt.session_id));
					} else if (evt.type === 'route') {
						meta.onRoute?.(String(evt.model_used || ''), !!evt.auto_routed);
					} else if (evt.type === 'usage') {
						if (typeof evt.budget_used === 'number' && typeof evt.budget_limit === 'number') {
							meta.onUsage?.(evt.budget_used, evt.budget_limit);
						}
						// usage also carries model_used / auto_routed (in case
						// the stream caller missed the early route event).
						if (evt.model_used) meta.onRoute?.(String(evt.model_used), !!evt.auto_routed);
					} else {
						handleEvent(evt, setMessages);
					}
				} catch { /* malformed line; skip */ }
			}
		}
	}
	} finally {
		if (signal) signal.removeEventListener('abort', onAbort);
	}
	// If we exited the loop because of an abort (reader was cancelled), surface
	// it as AbortError so the caller renders "— stopped —" and runs its finally
	// (resetting `streaming` → the queue can drain).
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export function handleEvent(
	evt: { type: string; [k: string]: any },
	setMessages: SetMessages,
) {
	if (evt.type === 'text' && typeof evt.delta === 'string') {
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m, content: (m.content || '') + evt.delta,
		})));
	} else if (evt.type === 'thinking_start') {
		// Open an empty thinking block. Deltas append; thinking_stop closes.
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m,
			thinking: m.thinking || '',
			thinkingDone: false,
		})));
	} else if (evt.type === 'thinking' && typeof evt.delta === 'string') {
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m,
			thinking: (m.thinking || '') + evt.delta,
		})));
	} else if (evt.type === 'thinking_stop') {
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m,
			thinkingDone: true,
		})));
	} else if (evt.type === 'tool_start') {
		// Agent declared a tool call before args/results stream in. Show a
		// spinner-style chip so the user sees activity immediately.
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m,
			tools: [
				...(m.tools || []),
				{ id: String(evt.id || ''), name: String(evt.name || 'tool'), ok: true, pending: true },
			],
		})));
	} else if (evt.type === 'tool_approval_required') {
		// Backend paused; update the pending chip to show approval buttons.
		const approvalId = String(evt.approval_id || '');
		const toolId = String(evt.id || '');
		setMessages((prev) => withLastAssistant(prev, (m) => {
			const tools = (m.tools || []).map((t) =>
				(toolId && t.id === toolId) || (!toolId && t.pending && t.name === evt.name)
					? { ...t, approvalRequired: true, approvalId, args: evt.args as Record<string, unknown> }
					: t
			);
			return { ...m, tools };
		}));
	} else if (evt.type === 'tool_call') {
		const ok = evt.ok !== false;
		const result = (evt.result || undefined) as Record<string, unknown> | undefined;
		const completed: ToolCall = {
			id: String(evt.id || ''),
			name: String(evt.name || 'tool'),
			ok,
			args: evt.args as Record<string, unknown> | undefined,
			result,
			summary: summarizeToolArgs(evt.args),
			resultSummary: summarizeToolResult(evt.name, evt.result),
			pending: false,
			approvalRequired: false,
			// Map-driven deep link on the chip (effects.ts) — "Open →" is
			// what closes the install/run loop without leaving the chat.
			link: ok ? toolLink(String(evt.name || ''), result, evt.args as Record<string, unknown> | undefined) : undefined,
		};
		setMessages((prev) => withLastAssistant(prev, (m) => {
			const tools = m.tools ? [...m.tools] : [];
			// Replace the latest pending entry matching by id or name; else push.
			const pendIdx = (() => {
				for (let i = tools.length - 1; i >= 0; i--) {
					const t = tools[i];
					if ((completed.id && t.id === completed.id) || (t.pending && t.name === completed.name)) return i;
				}
				return -1;
			})();
			if (pendIdx >= 0) tools[pendIdx] = completed;
			else tools.push(completed);
			return { ...m, tools };
		}));
		// Chat→page bus: a successful mutating tool invalidates the data
		// scopes it touched; pages re-fetch via useStudioRefetch instead of
		// waiting out their polling interval.
		if (ok) dispatchToolEffects(String(evt.name || ''), evt.args as Record<string, unknown> | undefined, result);
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
				setMessages((prev) => withLastAssistant(prev, (m) => ({ ...m, composed: draft })));
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
	} else if (evt.type === 'error' && evt.message) {
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m,
			content: (m.content ? m.content + '\n\n' : '') + friendlyChatError(evt.message),
		})));
	}
	// 'done' — no UI change needed for now.
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
