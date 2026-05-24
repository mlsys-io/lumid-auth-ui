// Phase S6a — persistent chat sidebar.
//
// AI is the primary interface; the workspace area becomes the
// artifact panel. Lives inside StudioShell on every Studio page.
//
// Uses /me/agent/chat/stream (SSE — fetch + ReadableStream because
// EventSource can't POST). Conversation history persists in
// sessionStorage so navigating between Studio pages keeps context.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronRight, MessageSquarePlus, Send, Trash2, Loader2, Bot, User, Square } from 'lucide-react';
import { buildSelectionPreamble } from './StudioContext';

type Role = 'user' | 'assistant';
type Message = {
	role: Role;
	content: string;
	// Pretty-printed tool calls the agent ran on this turn (assistant only).
	tools?: Array<{ name: string; ok: boolean; summary?: string }>;
};

const STORAGE_KEY = 'studio_chat_transcript_v1';
const COLLAPSE_KEY = 'studio_chat_collapsed_v1';

export function StudioChat() {
	const location = useLocation();
	const [collapsed, setCollapsed] = useState<boolean>(() => {
		try { return sessionStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
	});
	const [messages, setMessages] = useState<Message[]>(() => {
		try {
			const raw = sessionStorage.getItem(STORAGE_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch {
			return [];
		}
	});
	const [input, setInput] = useState('');
	const [streaming, setStreaming] = useState(false);
	const transcriptRef = useRef<HTMLDivElement>(null);
	// Phase S6 polish — abort handle so the user can cut a runaway
	// stream short. Reset on every send/queueSend; set just before the
	// fetch; consumed by the Stop button.
	const abortRef = useRef<AbortController | null>(null);

	// Persist transcript + collapse state
	useEffect(() => {
		try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch { /* ignore */ }
	}, [messages]);
	useEffect(() => {
		try { sessionStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
	}, [collapsed]);

	// Auto-scroll on new content
	useEffect(() => {
		if (!transcriptRef.current) return;
		transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
	}, [messages, streaming]);

	// Phase S6d — listen for prompt suggestions from workspaces.
	// Any page can dispatch `window.dispatchEvent(new CustomEvent('studio:ask',
	// {detail: {prompt: '…', autosend: true}}))` to pre-fill or fire the chat.
	useEffect(() => {
		const onAsk = (e: Event) => {
			const ce = e as CustomEvent<{ prompt?: string; autosend?: boolean }>;
			const p = String(ce.detail?.prompt || '').trim();
			if (!p) return;
			setCollapsed(false);
			if (ce.detail?.autosend) {
				// Bypass the input box — drop straight into send().
				setInput(p);
				// Defer a tick so input state is committed before send reads it.
				setTimeout(() => {
					// `send()` reads `input` from closure; instead re-implement
					// the minimum to send directly without waiting on state.
					queueSend(p);
				}, 10);
			} else {
				setInput(p);
			}
		};
		window.addEventListener('studio:ask', onAsk as EventListener);
		return () => window.removeEventListener('studio:ask', onAsk as EventListener);
		// queueSend is defined inline below to keep deps stable
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const queueSend = useCallback(async (text: string) => {
		if (!text || streaming) return;
		setInput('');
		const userMsg: Message = { role: 'user', content: text };
		const pageNote = buildSelectionPreamble(location.pathname);
		const wireMessages = [
			...messages.map((m) => ({ role: m.role, content: m.content })),
			{ role: 'user' as const, content: `${pageNote}\n\n${text}` },
		];
		const assistantMsg: Message = { role: 'assistant', content: '', tools: [] };
		setMessages((prev) => [...prev, userMsg, assistantMsg]);
		setStreaming(true);
		const ctrl = new AbortController();
		abortRef.current = ctrl;
		try {
			const r = await fetch('/api/v1/me/agent/chat/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ messages: wireMessages }),
				signal: ctrl.signal,
			});
			if (!r.ok || !r.body) {
				const errText = r.status === 401 ? 'Sign in to use chat' : `error ${r.status}`;
				setMessages((prev) => withLastAssistant(prev, (m) => ({ ...m, content: errText })));
				return;
			}
			const reader = r.body.getReader();
			const decoder = new TextDecoder();
			let buf = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buf.indexOf('\n\n')) >= 0) {
					const raw = buf.slice(0, nl);
					buf = buf.slice(nl + 2);
					for (const line of raw.split('\n')) {
						if (!line.startsWith('data: ')) continue;
						try {
							const evt = JSON.parse(line.slice(6));
							handleEvent(evt, setMessages);
						} catch { /* skip */ }
					}
				}
			}
		} catch (e: any) {
			// User-initiated abort produces a DOMException with name="AbortError" —
			// don't render that as a scary error; just leave whatever partial
			// content was streamed.
			if (e?.name === 'AbortError') {
				setMessages((prev) => withLastAssistant(prev, (m) => ({
					...m,
					content: (m.content || '') + (m.content ? '\n\n_— stopped —_' : '_— stopped —_'),
				})));
			} else {
				setMessages((prev) => withLastAssistant(prev, (m) => ({
					...m,
					content: m.content || `Couldn't reach the assistant: ${String(e).slice(0, 100)}`,
				})));
			}
		} finally {
			setStreaming(false);
			abortRef.current = null;
		}
	}, [messages, streaming, location.pathname]);

	const send = useCallback(async () => {
		const text = input.trim();
		if (!text || streaming) return;
		setInput('');

		// Optimistic append of the user's turn + a placeholder assistant turn.
		const userMsg: Message = { role: 'user', content: text };
		// Include a tiny system note about the active page so the agent
		// can answer "what should I do here?" cohesively. Lightweight
		// page-context prefix — full Phase S6b adds selected-item refs.
		const pageNote = buildSelectionPreamble(location.pathname);
		const wireMessages = [
			...messages.map((m) => ({ role: m.role, content: m.content })),
			{ role: 'user' as const, content: `${pageNote}\n\n${text}` },
		];
		const assistantMsg: Message = { role: 'assistant', content: '', tools: [] };
		setMessages((prev) => [...prev, userMsg, assistantMsg]);
		setStreaming(true);

		const ctrl = new AbortController();
		abortRef.current = ctrl;
		try {
			const r = await fetch('/api/v1/me/agent/chat/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ messages: wireMessages }),
				signal: ctrl.signal,
			});
			if (!r.ok || !r.body) {
				const errText = r.status === 401 ? 'Sign in to use chat' : `error ${r.status}`;
				setMessages((prev) => withLastAssistant(prev, (m) => ({ ...m, content: errText })));
				return;
			}
			const reader = r.body.getReader();
			const decoder = new TextDecoder();
			let buf = '';
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
							handleEvent(evt, setMessages);
						} catch {
							/* malformed line; skip */
						}
					}
				}
			}
		} catch (e: any) {
			// User-initiated abort produces a DOMException with name="AbortError" —
			// don't render that as a scary error; just leave whatever partial
			// content was streamed.
			if (e?.name === 'AbortError') {
				setMessages((prev) => withLastAssistant(prev, (m) => ({
					...m,
					content: (m.content || '') + (m.content ? '\n\n_— stopped —_' : '_— stopped —_'),
				})));
			} else {
				setMessages((prev) => withLastAssistant(prev, (m) => ({
					...m,
					content: m.content || `Couldn't reach the assistant: ${String(e).slice(0, 100)}`,
				})));
			}
		} finally {
			setStreaming(false);
			abortRef.current = null;
		}
	}, [input, messages, streaming, location.pathname]);

	const clear = () => {
		if (streaming) return;
		setMessages([]);
		try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
	};

	// Collapsed: thin chevron-only rail
	if (collapsed) {
		return (
			<button
				onClick={() => setCollapsed(false)}
				title="Open chat"
				className="fixed right-0 top-1/2 -translate-y-1/2 z-20 px-2 py-3 rounded-l-lg bg-white border border-r-0 border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 transition-colors shadow-sm"
			>
				<MessageSquarePlus className="w-4 h-4 text-emerald-600" />
			</button>
		);
	}

	return (
		<aside className="w-96 flex flex-col h-screen bg-white border-l border-slate-200 sticky top-0 flex-shrink-0">
			<header className="h-14 px-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
				<div className="flex items-center gap-2">
					<div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
						<Bot className="w-3.5 h-3.5" />
					</div>
					<div>
						<div className="text-sm font-semibold">Just ask</div>
						<div className="text-[10px] text-slate-500">your AI knows where you are</div>
					</div>
				</div>
				<div className="flex items-center gap-1">
					{messages.length > 0 && (
						<button
							onClick={clear}
							title="Clear chat"
							className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
						>
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					)}
					<button
						onClick={() => setCollapsed(true)}
						title="Collapse"
						className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
					>
						<ChevronRight className="w-4 h-4" />
					</button>
				</div>
			</header>

			<div ref={transcriptRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
				{messages.length === 0 && <EmptyHint />}
				{messages.map((m, i) => (
					<MessageBubble key={i} m={m} streaming={streaming && i === messages.length - 1 && m.role === 'assistant'} />
				))}
			</div>

			<footer className="border-t border-slate-200 p-3 flex-shrink-0">
				<form
					onSubmit={(e) => { e.preventDefault(); send(); }}
					className="flex items-end gap-2"
				>
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								send();
							}
						}}
						placeholder="Ask anything — &quot;what's pending?&quot; or &quot;send Alice's draft&quot;"
						rows={1}
						disabled={streaming}
						className="flex-1 px-3 py-2 text-sm rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 resize-none max-h-32"
						style={{ minHeight: '38px' }}
					/>
					{streaming ? (
						<button
							type="button"
							onClick={() => abortRef.current?.abort()}
							title="Stop"
							className="p-2 rounded-md flex-shrink-0 bg-rose-500 text-white hover:bg-rose-600 transition-colors"
						>
							<Square className="w-3.5 h-3.5 fill-current" />
						</button>
					) : (
						<button
							type="submit"
							disabled={!input.trim()}
							className={[
								'p-2 rounded-md transition-colors flex-shrink-0',
								!input.trim()
									? 'bg-slate-200 text-slate-400 cursor-not-allowed'
									: 'bg-emerald-500 text-white hover:bg-emerald-600',
							].join(' ')}
						>
							<Send className="w-4 h-4" />
						</button>
					)}
				</form>
			</footer>
		</aside>
	);
}

function MessageBubble({ m, streaming }: { m: Message; streaming?: boolean }) {
	const isUser = m.role === 'user';
	return (
		<div className={['flex gap-2', isUser ? 'flex-row-reverse' : ''].join(' ')}>
			<div className={[
				'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
				isUser ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700',
			].join(' ')}>
				{isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
			</div>
			<div className={['min-w-0 flex-1', isUser ? 'text-right' : ''].join(' ')}>
				<div className={[
					'inline-block max-w-full text-sm rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed text-left',
					isUser ? 'bg-slate-100 text-slate-800' : 'bg-emerald-50 text-slate-800 border border-emerald-200/50',
				].join(' ')}>
					{m.content || (streaming ? <span className="opacity-60">…</span> : '')}
				</div>
				{m.tools && m.tools.length > 0 && (
					<div className="mt-1.5 space-y-1">
						{m.tools.map((t, i) => (
							<div key={i} className="text-[11px] text-slate-500 inline-flex items-center gap-1">
								<span className={t.ok ? 'text-emerald-600' : 'text-rose-600'}>{t.ok ? '✓' : '✗'}</span>
								<span className="font-mono">{t.name}</span>
								{t.summary && <span className="text-slate-400">· {t.summary}</span>}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function EmptyHint() {
	const samples = [
		'what should I do next?',
		"what's pending in my inbox?",
		'send any obvious replies',
		'pause cc_watcher for the weekend',
		'what did you learn about me this week?',
	];
	return (
		<div className="pt-6 text-center text-xs text-slate-500 space-y-2">
			<Bot className="w-8 h-8 text-emerald-200 mx-auto" />
			<p className="leading-relaxed">
				Your AI can act on anything you see in Studio — ask in plain English.
				Webforms are still there for precision.
			</p>
			<div className="pt-2 space-y-1 text-left max-w-xs mx-auto">
				{samples.map((s) => (
					<div key={s} className="text-slate-400 italic">→ {s}</div>
				))}
			</div>
		</div>
	);
}

// ── Stream handling helpers ────────────────────────────────────────

function handleEvent(
	evt: { type: string; [k: string]: any },
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
) {
	if (evt.type === 'text' && typeof evt.delta === 'string') {
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m, content: (m.content || '') + evt.delta,
		})));
	} else if (evt.type === 'tool_call') {
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m,
			tools: [
				...(m.tools || []),
				{
					name: String(evt.name || 'tool'),
					ok: evt.ok !== false,
					summary: summarizeToolArgs(evt.args),
				},
			],
		})));
	} else if (evt.type === 'error' && evt.message) {
		setMessages((prev) => withLastAssistant(prev, (m) => ({
			...m,
			content: (m.content ? m.content + '\n\n' : '') + `⚠️ ${evt.message}`,
		})));
	}
	// 'usage' and 'done' events — no UI change needed for now.
}

function withLastAssistant(
	prev: Message[],
	patch: (m: Message) => Message,
): Message[] {
	if (prev.length === 0) return prev;
	const last = prev[prev.length - 1];
	if (last.role !== 'assistant') return prev;
	return [...prev.slice(0, -1), patch(last)];
}

function summarizeToolArgs(args: unknown): string {
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

export default StudioChat;
