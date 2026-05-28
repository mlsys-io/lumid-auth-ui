// Phase S6a — persistent chat sidebar.
//
// AI is the primary interface; the workspace area becomes the
// artifact panel. Lives inside StudioShell on every Studio page.
//
// Uses /me/agent/chat/stream (SSE — fetch + ReadableStream because
// EventSource can't POST). Conversation history persists in
// sessionStorage so navigating between Studio pages keeps context.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, MessageSquarePlus, Send, Trash2, Loader2, Bot, User, Square, Globe, Telescope, Brain, ChevronDown, Paperclip, X, FileText, Image as ImageIcon, Plus } from 'lucide-react';
import { buildSelectionPreamble } from './StudioContext';
import { ChatMarkdown } from './ChatMarkdown';

type Role = 'user' | 'assistant';
// A file the user dropped into the input. Lives in pending state
// until send(). image → base64; text → raw string. PDFs deferred.
type Attachment =
	| { kind: 'image'; name: string; mime: string; dataB64: string; sizeBytes: number }
	| { kind: 'text'; name: string; text: string; sizeBytes: number };

// Wire format for the request body — mirrors the backend chatAttachment.
type WireAttachment =
	| { kind: 'image'; name: string; mime: string; data_b64: string }
	| { kind: 'text'; name: string; text: string };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 500 * 1024;
type ToolCall = {
	name: string;
	ok: boolean;
	summary?: string;
	resultSummary?: string;
	// `pending` = received tool_start but no tool_call yet (in-flight).
	pending?: boolean;
	link?: { to: string; label: string };
};
type Message = {
	role: Role;
	content: string;
	// Live-streamed reasoning from extended thinking. Rendered in a
	// collapsible block above the main reply.
	thinking?: string;
	thinkingDone?: boolean;
	// Pretty-printed tool calls the agent ran on this turn (assistant only).
	tools?: ToolCall[];
};

const STORAGE_KEY = 'studio_chat_transcript_v1';
const COLLAPSE_KEY = 'studio_chat_collapsed_v1';
const WIDTH_KEY = 'studio_chat_width_v1';
const MODEL_KEY = 'studio_chat_model_v1';
const MODE_KEY = 'studio_chat_mode_v1';
const THINK_KEY = 'studio_chat_think_v1';
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 400;

type ModelOption = { id: string; display_name: string; default: boolean };
// Mutually-exclusive tool-forcing modes. '' = let the agent decide.
type ChatMode = '' | 'search' | 'deep_research';

export function StudioChat() {
	const location = useLocation();
	// Default collapsed to a thin handle so the workspace (Intents,
	// Knowledge, …) is the focus; the user opens chat on demand. State
	// persists across reloads in localStorage (COLLAPSE_KEY). A
	// `studio:ask` event still force-expands so prompt-chips work.
	const [collapsed, setCollapsed] = useState<boolean>(() => {
		try {
			const raw = localStorage.getItem(COLLAPSE_KEY);
			return raw === null ? true : raw === '1';
		} catch { return true; }
	});
	const [width, setWidth] = useState<number>(() => {
		try {
			const raw = localStorage.getItem(WIDTH_KEY);
			const n = raw ? parseInt(raw, 10) : NaN;
			return Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
		} catch { return DEFAULT_WIDTH; }
	});
	const [resizing, setResizing] = useState(false);
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
	// LLM model selector. Persists across reloads; populated from
	// /me/agent/models so backend can add providers without UI changes.
	const [models, setModels] = useState<ModelOption[]>([]);
	const [model, setModel] = useState<string>(() => {
		try {
			return localStorage.getItem(MODEL_KEY) || '';
		} catch { return ''; }
	});
	// Search / Deep Research toggles. Mutually exclusive; '' = let the
	// agent decide based on the question. Sticky across turns + reloads
	// so the user doesn't have to re-arm for follow-up questions.
	const [mode, setMode] = useState<ChatMode>(() => {
		try {
			const v = localStorage.getItem(MODE_KEY);
			return (v === 'search' || v === 'deep_research') ? v : '';
		} catch { return ''; }
	});
	// Independent Think toggle — combines with mode. When on, Claude
	// (and any Anthropic-shape provider) gets extended thinking enabled.
	// kv.run/MiniMax thinks by default; this flag is a no-op there but
	// keeps the chip visible so the user knows reasoning is on display.
	const [think, setThink] = useState<boolean>(() => {
		try { return localStorage.getItem(THINK_KEY) === '1'; }
		catch { return false; }
	});
	// Staged attachments for the next send. Cleared after dispatch.
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [attachError, setAttachError] = useState<string>('');
	const fileInputRef = useRef<HTMLInputElement>(null);
	// Tools popover open/close. Anchored above the [+] button to the
	// left of the textarea. Click-outside + escape close it.
	const [toolsOpen, setToolsOpen] = useState(false);
	const toolsAnchorRef = useRef<HTMLDivElement>(null);
	const transcriptRef = useRef<HTMLDivElement>(null);
	// Phase S6 polish — abort handle so the user can cut a runaway
	// stream short. Reset on every send/queueSend; set just before the
	// fetch; consumed by the Stop button.
	const abortRef = useRef<AbortController | null>(null);

	// Persist transcript + collapse state
	useEffect(() => {
		try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch { /* ignore */ }
	}, [messages]);
	// Persist collapse state across reloads.
	useEffect(() => {
		try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
	}, [collapsed]);

	// Persist selected model.
	useEffect(() => {
		try {
			if (model) localStorage.setItem(MODEL_KEY, model);
		} catch { /* ignore */ }
	}, [model]);

	// Persist tool-mode toggle.
	useEffect(() => {
		try {
			if (mode) localStorage.setItem(MODE_KEY, mode);
			else localStorage.removeItem(MODE_KEY);
		} catch { /* ignore */ }
	}, [mode]);

	// Persist think toggle.
	useEffect(() => {
		try {
			if (think) localStorage.setItem(THINK_KEY, '1');
			else localStorage.removeItem(THINK_KEY);
		} catch { /* ignore */ }
	}, [think]);

	// File picker handler — turns each selected file into an
	// Attachment, validates size + kind. Errors surface in a one-line
	// banner above the input.
	const onPickFiles = useCallback(async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		setAttachError('');
		const next: Attachment[] = [];
		for (const f of Array.from(files)) {
			if (f.type.startsWith('image/')) {
				if (f.size > MAX_IMAGE_BYTES) {
					setAttachError(`${f.name}: image > ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB`);
					continue;
				}
				const buf = await f.arrayBuffer();
				// base64 encode (atob/btoa would corrupt binary)
				const bytes = new Uint8Array(buf);
				let bin = '';
				for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
				const dataB64 = btoa(bin);
				next.push({ kind: 'image', name: f.name, mime: f.type, dataB64, sizeBytes: f.size });
			} else {
				// Treat as text. Includes .txt/.md/.csv/.json/.log/.tsv plus
				// anything else with a reasonable mime. PDFs are NOT supported
				// here yet — they'd need a server-side extraction pass.
				if (f.type === 'application/pdf') {
					setAttachError(`${f.name}: PDF upload not supported yet`);
					continue;
				}
				if (f.size > MAX_TEXT_BYTES) {
					setAttachError(`${f.name}: text > ${Math.round(MAX_TEXT_BYTES / 1024)}KB`);
					continue;
				}
				const text = await f.text();
				next.push({ kind: 'text', name: f.name, text, sizeBytes: f.size });
			}
		}
		if (next.length > 0) {
			setAttachments((prev) => [...prev, ...next]);
		}
	}, []);

	const removeAttachment = useCallback((i: number) => {
		setAttachments((prev) => prev.filter((_, idx) => idx !== i));
	}, []);

	// Count of active per-turn toggles — surfaced as a small badge on
	// the [+] tools button so the user knows something is on without
	// opening the popover.
	const activeToolCount = (mode ? 1 : 0) + (think ? 1 : 0);

	// Click-outside + Escape to close the tools popover.
	useEffect(() => {
		if (!toolsOpen) return;
		const onClick = (e: MouseEvent) => {
			if (!toolsAnchorRef.current) return;
			if (!toolsAnchorRef.current.contains(e.target as Node)) {
				setToolsOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setToolsOpen(false);
		};
		document.addEventListener('mousedown', onClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onClick);
			document.removeEventListener('keydown', onKey);
		};
	}, [toolsOpen]);

	// Load available LLM providers once. Falls through silently on
	// failure — server defaults to Claude when the request body omits
	// `model`, so the chat still works without the dropdown.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const r = await fetch('/api/v1/me/agent/models', { credentials: 'include' });
				if (!r.ok) return;
				const j = await r.json();
				const list: ModelOption[] = j?.data?.models || j?.models || [];
				if (cancelled || !Array.isArray(list) || list.length === 0) return;
				setModels(list);
				// Adopt the server's default the first time we see this user;
				// don't overwrite a user-chosen selection on reload.
				if (!model) {
					const def = list.find((m) => m.default) || list[0];
					if (def) setModel(def.id);
				}
			} catch { /* ignore */ }
		})();
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Auto-scroll on new content
	useEffect(() => {
		if (!transcriptRef.current) return;
		transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
	}, [messages, streaming]);

	// Persist width once the user releases the drag (not on every
	// mousemove tick — keeps localStorage writes off the hot path).
	useEffect(() => {
		if (resizing) return;
		try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
	}, [resizing, width]);

	// Resize drag — pointer events handle both mouse and touch.
	const startResize = useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		setResizing(true);
		const startX = e.clientX;
		const startW = width;
		const onMove = (ev: PointerEvent) => {
			// Drag handle is on the LEFT edge of a right-anchored panel,
			// so moving the cursor left grows the panel.
			const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + (startX - ev.clientX)));
			setWidth(next);
		};
		const onUp = () => {
			setResizing(false);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}, [width]);

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
				body: JSON.stringify({
					messages: wireMessages,
					...(model ? { model } : {}),
					...(mode ? { mode } : {}),
					...(think ? { think: true } : {}),
				}),
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
	}, [messages, streaming, location.pathname, model, mode, think]);

	const send = useCallback(async () => {
		const text = input.trim();
		if (!text || streaming) return;
		setInput('');

		// Snapshot + clear staged attachments. Doing it before the
		// optimistic append means a fast-clicking user can stage new
		// files for the next turn while this one is still streaming.
		const stagedAttachments = attachments;
		setAttachments([]);
		setAttachError('');

		// Optimistic append of the user's turn + a placeholder assistant turn.
		const userMsg: Message = { role: 'user', content: text };
		// Include a tiny system note about the active page so the agent
		// can answer "what should I do here?" cohesively. Lightweight
		// page-context prefix — full Phase S6b adds selected-item refs.
		const pageNote = buildSelectionPreamble(location.pathname);
		const wireAttachments: WireAttachment[] = stagedAttachments.map((a) =>
			a.kind === 'image'
				? { kind: 'image', name: a.name, mime: a.mime, data_b64: a.dataB64 }
				: { kind: 'text', name: a.name, text: a.text }
		);
		const wireMessages = [
			...messages.map((m) => ({ role: m.role, content: m.content })),
			wireAttachments.length > 0
				? { role: 'user' as const, content: `${pageNote}\n\n${text}`, attachments: wireAttachments }
				: { role: 'user' as const, content: `${pageNote}\n\n${text}` },
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
				body: JSON.stringify({
					messages: wireMessages,
					...(model ? { model } : {}),
					...(mode ? { mode } : {}),
					...(think ? { think: true } : {}),
				}),
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
	}, [input, messages, streaming, location.pathname, model, mode, think, attachments]);

	const clear = () => {
		if (streaming) return;
		setMessages([]);
		try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
	};

	// Collapsed: a discreet full-height 32px handle with a vertical
	// "Ask" label + faint green accent. Part of the layout flow (not
	// fixed/floating), so the workspace naturally reclaims the width.
	if (collapsed) {
		return (
			<button
				onClick={() => setCollapsed(false)}
				title="Open AI chat"
				aria-label="Open AI chat"
				className="group w-8 flex-shrink-0 h-screen sticky top-0 flex flex-col items-center justify-center gap-3 border-l border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50 transition-colors"
			>
				<MessageSquarePlus className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
				<span className="text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-700/80 [writing-mode:vertical-rl] rotate-180">
					Ask
				</span>
			</button>
		);
	}

	return (
		<aside
			style={{ width }}
			className={[
				'flex flex-col h-screen sticky top-0 flex-shrink-0 relative',
				'bg-gradient-to-b from-white via-white to-emerald-50/30',
				'border-l border-slate-200/70 shadow-[inset_1px_0_0_0_rgb(255_255_255/0.8)]',
				resizing ? 'select-none' : '',
			].join(' ')}
		>
			{/* Drag handle — 8px hit zone with a 1px visible rule that
			    glows on hover/drag. Lives on the left edge so dragging
			    left grows the panel. */}
			<div
				onPointerDown={startResize}
				className={[
					'absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10',
					'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-px',
					'before:bg-slate-200 hover:before:bg-emerald-400 before:transition-colors',
					resizing ? 'before:bg-emerald-500' : '',
				].join(' ')}
				title="Drag to resize"
			/>
			<header className="h-14 px-4 border-b border-slate-200/70 flex items-center justify-between flex-shrink-0 bg-white/80 backdrop-blur-sm gap-2">
				<div className="flex items-center gap-2.5 min-w-0 flex-1">
					<div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center shadow-sm shadow-emerald-200 flex-shrink-0">
						<Bot className="w-4 h-4" />
						{streaming && (
							<span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse" />
						)}
					</div>
					<div className="min-w-0">
						<div className="text-sm font-semibold text-slate-900 tracking-tight">Just ask</div>
						{/* Model picker moved here — set-once choice, paired
						    with the title so it reads as part of identity
						    rather than per-turn config. Hidden when only
						    one provider is available. */}
						{models.length > 1 ? (
							<select
								value={model}
								onChange={(e) => setModel(e.target.value)}
								disabled={streaming}
								className="text-[10.5px] text-slate-500 hover:text-slate-700 bg-transparent border-0 p-0 -ml-0.5 max-w-[160px] truncate focus:outline-none focus:ring-0 cursor-pointer disabled:opacity-50"
								title="LLM backend used for replies"
							>
								{models.map((m) => (
									<option key={m.id} value={m.id}>{m.display_name}</option>
								))}
							</select>
						) : (
							<div className="text-[10.5px] text-slate-500">your AI knows where you are</div>
						)}
					</div>
				</div>
				<div className="flex items-center gap-0.5 flex-shrink-0">
					{messages.length > 0 && (
						<button
							onClick={clear}
							title="Clear chat"
							className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
						>
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					)}
					<button
						onClick={() => setCollapsed(true)}
						title="Collapse panel"
						className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
					>
						<ChevronRight className="w-4 h-4" />
					</button>
				</div>
			</header>

			<div ref={transcriptRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 scroll-smooth">
				{messages.length === 0 && <EmptyHint />}
				{messages.map((m, i) => (
					<MessageBubble key={i} m={m} streaming={streaming && i === messages.length - 1 && m.role === 'assistant'} />
				))}
			</div>

			<footer className="border-t border-slate-200/70 p-3 flex-shrink-0 bg-white/60 backdrop-blur-sm">
				{/* Staged attachments. Stays above the input row so the file
				    chips never crowd the typing space. Hidden when empty. */}
				{(attachments.length > 0 || attachError) && (
					<div className="mb-2 px-0.5 flex flex-wrap gap-1.5 items-center">
						{attachments.map((a, i) => (
							<div
								key={i}
								className="inline-flex items-center gap-1.5 text-[11px] bg-slate-100 border border-slate-200 rounded-full pl-2 pr-1 py-0.5"
								title={`${a.name} · ${(a.sizeBytes / 1024).toFixed(1)} KB`}
							>
								{a.kind === 'image'
									? <ImageIcon className="w-3 h-3 text-sky-600" />
									: <FileText className="w-3 h-3 text-slate-600" />}
								<span className="font-medium max-w-[120px] truncate">{a.name}</span>
								<span className="opacity-60">{Math.round(a.sizeBytes / 1024)}KB</span>
								<button
									type="button"
									onClick={() => removeAttachment(i)}
									className="text-slate-400 hover:text-rose-500 transition-colors"
									title="Remove"
								>
									<X className="w-3 h-3" />
								</button>
							</div>
						))}
						{attachError && (
							<span className="text-[11px] text-rose-600">{attachError}</span>
						)}
					</div>
				)}
				<form
					onSubmit={(e) => { e.preventDefault(); send(); }}
					className="flex items-end gap-1.5"
				>
					<input
						ref={fileInputRef}
						type="file"
						multiple
						accept="image/*,text/*,.md,.csv,.json,.tsv,.log,.yml,.yaml,.toml"
						className="hidden"
						onChange={(e) => {
							onPickFiles(e.target.files);
							if (fileInputRef.current) fileInputRef.current.value = '';
						}}
					/>
					{/* Tools popover anchor. Clicking [+] toggles a small
					    floating menu with the three per-turn toggles
					    (Search / Deep research / Think). Active-toggle
					    count surfaces as a tiny badge on the button. */}
					<div ref={toolsAnchorRef} className="relative flex-shrink-0">
						<button
							type="button"
							onClick={() => setToolsOpen((v) => !v)}
							disabled={streaming}
							title="Tools — Search / Deep research / Think"
							className={[
								'relative p-2.5 rounded-xl border transition-all',
								toolsOpen
									? 'bg-slate-900 text-white border-slate-900'
									: activeToolCount > 0
										? 'bg-white text-emerald-700 border-emerald-300 hover:border-emerald-400'
										: 'bg-white text-slate-500 border-slate-200 hover:text-slate-700 hover:border-slate-300',
								streaming ? 'opacity-50 cursor-not-allowed' : '',
							].join(' ')}
						>
							<Plus className={['w-4 h-4 transition-transform', toolsOpen ? 'rotate-45' : ''].join(' ')} />
							{activeToolCount > 0 && !toolsOpen && (
								<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white">
									{activeToolCount}
								</span>
							)}
						</button>
						{toolsOpen && (
							<div className="absolute bottom-full mb-2 left-0 z-10 min-w-[180px] p-1 rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
								<button
									type="button"
									onClick={() => setMode(mode === 'search' ? '' : 'search')}
									className={[
										'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
										mode === 'search'
											? 'bg-sky-50 text-sky-700'
											: 'text-slate-700 hover:bg-slate-50',
									].join(' ')}
								>
									<Globe className={['w-3.5 h-3.5', mode === 'search' ? 'text-sky-600' : 'text-slate-500'].join(' ')} />
									<span className="font-medium flex-1 text-left">Search the web</span>
									{mode === 'search' && <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
								</button>
								<button
									type="button"
									onClick={() => setMode(mode === 'deep_research' ? '' : 'deep_research')}
									className={[
										'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
										mode === 'deep_research'
											? 'bg-violet-50 text-violet-700'
											: 'text-slate-700 hover:bg-slate-50',
									].join(' ')}
								>
									<Telescope className={['w-3.5 h-3.5', mode === 'deep_research' ? 'text-violet-600' : 'text-slate-500'].join(' ')} />
									<span className="font-medium flex-1 text-left">Deep research</span>
									{mode === 'deep_research' && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
								</button>
								<div className="h-px bg-slate-100 my-1 mx-2" />
								<button
									type="button"
									onClick={() => setThink((v) => !v)}
									className={[
										'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
										think
											? 'bg-amber-50 text-amber-700'
											: 'text-slate-700 hover:bg-slate-50',
									].join(' ')}
								>
									<Brain className={['w-3.5 h-3.5', think ? 'text-amber-600' : 'text-slate-500'].join(' ')} />
									<span className="font-medium flex-1 text-left">Show thinking</span>
									{think && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
								</button>
								<div className="h-px bg-slate-100 my-1 mx-2" />
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] text-slate-700 hover:bg-slate-50 transition-colors"
								>
									<Paperclip className="w-3.5 h-3.5 text-slate-500" />
									<span className="font-medium flex-1 text-left">Attach file</span>
								</button>
							</div>
						)}
					</div>
					<div className="flex-1 relative group">
						<textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									send();
								}
							}}
							placeholder='Ask anything — "what&apos;s pending?" or "send Alice&apos;s draft"'
							rows={1}
							disabled={streaming}
							className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 bg-white shadow-sm focus:outline-none focus:ring-4 focus:ring-emerald-400/15 focus:border-emerald-400 resize-none max-h-32 transition-all placeholder:text-slate-400"
							style={{ minHeight: '42px' }}
						/>
					</div>
					{streaming ? (
						<button
							type="button"
							onClick={() => abortRef.current?.abort()}
							title="Stop"
							className="p-2.5 rounded-xl flex-shrink-0 bg-rose-500 text-white hover:bg-rose-600 active:scale-95 shadow-sm shadow-rose-200 transition-all"
						>
							<Square className="w-3.5 h-3.5 fill-current" />
						</button>
					) : (
						<button
							type="submit"
							disabled={!input.trim()}
							className={[
								'p-2.5 rounded-xl transition-all flex-shrink-0',
								!input.trim()
									? 'bg-slate-100 text-slate-300 cursor-not-allowed'
									: 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 active:scale-95 shadow-sm shadow-emerald-200',
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
		<div className={['flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200', isUser ? 'flex-row-reverse' : ''].join(' ')}>
			<div className={[
				'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm',
				isUser
					? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white'
					: 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-emerald-100',
			].join(' ')}>
				{isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
			</div>
			<div className={['min-w-0 flex-1', isUser ? 'text-right' : ''].join(' ')}>
				{!isUser && m.thinking !== undefined && (
					<ThinkingBlock thinking={m.thinking} done={!!m.thinkingDone} />
				)}
				<div className={[
					'inline-block max-w-full text-[13.5px] rounded-2xl px-3.5 py-2.5 leading-relaxed text-left shadow-sm',
					isUser
						? 'bg-slate-900 text-white rounded-tr-md'
						: 'bg-white text-slate-800 border border-slate-200/70 rounded-tl-md',
				].join(' ')}>
					{m.content ? (
						// User turns are short and rarely markdown-rich;
						// render plain so URLs / commands they type stay
						// intact. Assistant turns go through full markdown —
						// tables, code blocks, lists, links, images.
						isUser ? (
							<div className="whitespace-pre-wrap break-words">{m.content}</div>
						) : (
							<ChatMarkdown>{m.content}</ChatMarkdown>
						)
					) : streaming ? (
						<span className="inline-flex gap-1 items-center">
							<span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
							<span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
							<span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" />
						</span>
					) : ''}
				</div>
				{m.tools && m.tools.length > 0 && (
					<div className={['mt-2 flex flex-col gap-1', isUser ? 'items-end' : 'items-start'].join(' ')}>
						{m.tools.map((t, i) => <ToolChip key={i} t={t} />)}
					</div>
				)}
			</div>
		</div>
	);
}

// ThinkingBlock — collapsible reasoning panel above the assistant's
// reply. Auto-expanded while streaming so the user sees the model
// "think out loud"; auto-collapsed once thinking_stop arrives so the
// final answer stays the focus.
function ThinkingBlock({ thinking, done }: { thinking: string; done: boolean }) {
	const [open, setOpen] = useState<boolean>(!done);
	// When the stream transitions to done, collapse automatically (only
	// the first time — the user can re-open it).
	const wasDone = useRef(done);
	useEffect(() => {
		if (done && !wasDone.current) {
			setOpen(false);
			wasDone.current = true;
		}
	}, [done]);
	const charCount = thinking.length;
	const label = done
		? `Thought (${charCount} chars)`
		: 'Thinking…';
	return (
		<div className="mb-1.5">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50/80 hover:bg-amber-100/80 border border-amber-200 rounded-full px-2 py-0.5 transition-colors"
			>
				<Brain className="w-3 h-3" />
				<span>{label}</span>
				<ChevronDown
					className={['w-3 h-3 transition-transform', open ? 'rotate-180' : ''].join(' ')}
				/>
			</button>
			{open && (
				<div className="mt-1.5 px-3 py-2 text-[12px] leading-relaxed text-slate-600 bg-amber-50/40 border border-amber-100 rounded-xl whitespace-pre-wrap break-words">
					{thinking || (
						<span className="opacity-50 italic">(no content yet)</span>
					)}
				</div>
			)}
		</div>
	);
}

// ToolChip — one row per tool call. Shows the tool name with a
// matching icon, the arg summary, an inline result summary when
// available, and an optional follow-up link (e.g. "Open →" for
// install_app). Pending state shows a spinner instead of ✓/✗ until the
// tool_call event lands.
function ToolChip({ t }: { t: ToolCall }) {
	const Icon =
		t.name === 'web_search' ? Globe
		: t.name === 'deep_research' ? Telescope
		: t.name === 'web_fetch' ? Globe
		: null;
	return (
		<div className="inline-flex flex-col gap-0.5 max-w-full">
			<div className="inline-flex items-center gap-1.5">
				<div className={[
					'text-[11px] inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border max-w-full',
					t.pending
						? 'bg-sky-50/80 border-sky-200 text-sky-800'
						: t.ok
							? 'bg-emerald-50/80 border-emerald-200 text-emerald-800'
							: 'bg-rose-50/80 border-rose-200 text-rose-800',
				].join(' ')}>
					{t.pending
						? <Loader2 className="w-3 h-3 animate-spin" />
						: Icon
							? <Icon className="w-3 h-3" />
							: <span className="text-[10px]">{t.ok ? '✓' : '✗'}</span>}
					<span className="font-mono font-medium">{t.name}</span>
					{t.summary && <span className="opacity-70 truncate max-w-[180px]">· {t.summary}</span>}
				</div>
				{t.link && (
					<Link
						to={t.link.to}
						className="text-[11px] inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors"
					>
						{t.link.label} →
					</Link>
				)}
			</div>
			{t.resultSummary && (
				<div className="text-[10px] text-slate-500 pl-5 truncate max-w-[280px]">
					{t.resultSummary}
				</div>
			)}
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
		<div className="pt-8 text-center text-xs text-slate-500 space-y-3">
			<div className="relative inline-block">
				<div className="absolute inset-0 bg-emerald-400/20 blur-2xl rounded-full" />
				<div className="relative w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-200">
					<Bot className="w-6 h-6" />
				</div>
			</div>
			<div className="space-y-1">
				<div className="text-sm font-semibold text-slate-900">Hi — I&apos;m your AI.</div>
				<p className="text-[11.5px] leading-relaxed max-w-[260px] mx-auto">
					Ask anything in plain English. I can act on what you see in Studio;
					webforms are still there for precision.
				</p>
			</div>
			<div className="pt-3 space-y-1.5 text-left max-w-xs mx-auto">
				{samples.map((s) => (
					<button
						key={s}
						onClick={() => window.dispatchEvent(new CustomEvent('studio:ask', { detail: { prompt: s, autosend: true } }))}
						className="w-full text-left px-3 py-1.5 rounded-lg bg-white/60 border border-slate-200/60 text-slate-600 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-900 transition-colors"
					>
						{s}
					</button>
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
				{ name: String(evt.name || 'tool'), ok: true, pending: true },
			],
		})));
	} else if (evt.type === 'tool_call') {
		// Surface a clickable "Open →" link on the tool chip for any
		// install/compose that yields a tenant-side app. Other tools
		// stay plain text. The link is what closes the install loop —
		// without it, the user has no way back to their new workflow
		// without leaving the chat.
		let link: { to: string; label: string } | undefined;
		if (evt.ok !== false) {
			const result = (evt.result || {}) as Record<string, unknown>;
			const appName = String(
				result.app ||
				result.installed_as ||
				result.draft_slug ||
				result.for_app ||
				''
			);
			if (appName && (evt.name === 'install_app' || evt.name === 'compose_workflow')) {
				link = { to: `/studio/workflows?selected=${encodeURIComponent(appName)}`, label: 'Open' };
			}
		}
		const completed: ToolCall = {
			name: String(evt.name || 'tool'),
			ok: evt.ok !== false,
			summary: summarizeToolArgs(evt.args),
			resultSummary: summarizeToolResult(evt.name, evt.result),
			pending: false,
			link,
		};
		setMessages((prev) => withLastAssistant(prev, (m) => {
			const tools = m.tools ? [...m.tools] : [];
			// Replace the latest pending entry of the same name; else push.
			const pendIdx = tools.findLastIndex
				? tools.findLastIndex((t) => t.pending && t.name === completed.name)
				: (() => { for (let i = tools.length - 1; i >= 0; i--) if (tools[i].pending && tools[i].name === completed.name) return i; return -1; })();
			if (pendIdx >= 0) tools[pendIdx] = completed;
			else tools.push(completed);
			return { ...m, tools };
		}));
		// W5 — surface compose_workflow results to the composer modal
		// so it can switch into "review + install" mode. The chat
		// already runs the tool; we just relay the result via a
		// window event for cross-component pickup.
		if (evt.name === 'compose_workflow' && evt.ok !== false && evt.result) {
			window.dispatchEvent(new CustomEvent('studio:composed', {
				detail: {
					slug: String(evt.result.draft_slug || ''),
					intent: String(evt.result.intent || ''),
					skills: Array.isArray(evt.result.skills_picked) ? evt.result.skills_picked : [],
					skill_summaries: Array.isArray(evt.result.skill_summaries) ? evt.result.skill_summaries : undefined,
					for_app: String(evt.result.for_app || ''),
				},
			}));
		}
		// Auto-open the artifact panel when the agent saves a new artifact.
		// StudioArtifactPanel listens for this event, refreshes the list,
		// and selects the new id.
		if (evt.name === 'save_artifact' && evt.ok !== false && evt.result && evt.result.id) {
			window.dispatchEvent(new CustomEvent('studio:artifact-saved', {
				detail: { id: String(evt.result.id) },
			}));
		}
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

// Short human-readable summary of a tool's result, used for the chip
// subtitle line. Per-tool because the interesting field is different
// for each (search → result count; fetch → page title; etc).
function summarizeToolResult(name: unknown, result: unknown): string | undefined {
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
	return undefined;
}

export default StudioChat;
