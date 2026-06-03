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
import { ChevronRight, MessageSquarePlus, Send, Trash2, Loader2, Bot, User, Square, Globe, Telescope, Brain, ChevronDown, Paperclip, X, FileText, FileJson, Image as ImageIcon, Plus, Copy, RotateCcw, Mic, Volume2, Code2, Boxes, Download, ArrowLeft, Crosshair } from 'lucide-react';
import {
	buildSelectionPreamble,
	subscribeStudioPickedTarget,
	setStudioPickedTarget,
	getStudioPickedTarget,
	type StudioPickedTarget,
} from './StudioContext';
import { startStudioPicking, stopStudioPicking, isStudioPicking, subscribeStudioPicking } from './StudioPicker';
import { ChatMarkdown } from './ChatMarkdown';

type Role = 'user' | 'assistant';
// A file the user dropped into the input. Lives in pending state
// until send(). image → base64; text → raw string. PDFs deferred.
type Attachment =
	| { kind: 'image'; name: string; mime: string; dataB64: string; sizeBytes: number }
	| { kind: 'text'; name: string; text: string; sizeBytes: number }
	| { kind: 'document'; name: string; mime: string; dataB64: string; sizeBytes: number };

// Wire format for the request body — mirrors the backend chatAttachment.
type WireAttachment =
	| { kind: 'image'; name: string; mime: string; data_b64: string }
	| { kind: 'text'; name: string; text: string }
	| { kind: 'document'; name: string; mime: string; data_b64: string };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_BYTES = 500 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;

// Binary document mime types we hand off to the server-side extractor
// (poppler/pandoc/openpyxl). Match by exact mime OR by filename ext.
const DOCUMENT_MIMES = new Set([
	'application/pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'application/rtf',
	'text/rtf',
	'application/vnd.oasis.opendocument.text',
	'application/vnd.oasis.opendocument.spreadsheet',
	'application/vnd.oasis.opendocument.presentation',
	'application/epub+zip',
]);
const DOCUMENT_EXTS = ['.pdf', '.docx', '.xlsx', '.pptx', '.rtf', '.odt', '.ods', '.odp', '.epub'];
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
	// Marks the single consolidated "loop activity" note (studio:notify),
	// so repeated loop events update one message instead of spamming.
	notify?: boolean;
	notifyCount?: number;
};

const STORAGE_KEY = 'studio_chat_transcript_v1';
const CHAT_ID_KEY = 'studio_chat_active_id_v1';
const COLLAPSE_KEY = 'studio_chat_collapsed_v1';
const WIDTH_KEY = 'studio_chat_width_v1';
const MODEL_KEY = 'studio_chat_model_v1';
const MODE_KEY = 'studio_chat_mode_v1';
const THINK_KEY = 'studio_chat_think_v1';
const AGENT_KEY = 'studio_chat_agent_v1';
const PERSONA_KEY = 'studio_chat_persona_v1';
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
	// Queued messages — sends typed while a turn is streaming get
	// stashed here and dispatched FIFO when streaming completes.
	// Captures attachments at queue-time so the next message goes
	// out with the files that were attached when the user pressed
	// Enter, not whatever's attached when the previous turn finishes.
	type QueuedMessage = { text: string; attachments: Attachment[] };
	const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
	// Ref mirror so the streaming useEffect can dequeue without
	// becoming a dependency cycle (it ALSO clears the head when
	// firing, so depending on state would re-trigger).
	const messageQueueRef = useRef<QueuedMessage[]>([]);
	useEffect(() => { messageQueueRef.current = messageQueue; }, [messageQueue]);
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
	// Optional xpio agent to chat with (empty = default behavior:
	// chat grounded in the user's me-prefs). When set, the system
	// prompt swaps for the agent's bank context.
	type AgentRow = {
		id: string;
		scope: 'tenant' | 'shared';
		row_count: number;
		last_memory_ts: number;
		// Role enrichment from xpcloud.yaml — present when the agent is
		// declared as a role in an installed xpio app.
		app?: string;
		role?: string;
		description?: string;
		default_model?: string;
	};
	const [agents, setAgents] = useState<AgentRow[]>([]);
	const [agentId, setAgentId] = useState<string>(() => {
		try { return localStorage.getItem(AGENT_KEY) || ''; }
		catch { return ''; }
	});
	// Custom personas — user-defined system prompts. Mutually
	// exclusive with agentId; picking one clears the other.
	type PersonaRow = { id: string; name: string; icon?: string; allowed_tools?: string[]; preferred_model?: string; prompt_len: number; updated_at: string };
	const [personas, setPersonas] = useState<PersonaRow[]>([]);
	const [personaId, setPersonaId] = useState<string>(() => {
		try { return localStorage.getItem(PERSONA_KEY) || ''; }
		catch { return ''; }
	});
	// Active chat thread id. null = unsaved thread; gets a server-minted
	// id after the first auto-save. Persists across reloads so refreshing
	// the page keeps you in the same thread.
	const [chatId, setChatId] = useState<string | null>(() => {
		try { return localStorage.getItem(CHAT_ID_KEY) || null; }
		catch { return null; }
	});
	// Recent threads for the history dropdown — populated lazily when
	// the user opens the menu; refreshed after every save.
	type HistoryRow = { id: string; title: string; updated_at: string; msg_count: number };
	const [history, setHistory] = useState<HistoryRow[]>([]);
	const [historyOpen, setHistoryOpen] = useState(false);

	// Token / $ meter — updated from the `usage` SSE event after each
	// turn. budget is the daily cap (50K tokens by default); used is
	// the rolling 24h consumed. costUsd is a coarse estimate computed
	// client-side from per-model pricing (server doesn't compute it).
	const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);
	// Voice input — Web Speech API. isListening becomes true while the
	// browser is actively dictating; recognized text is appended to
	// the textarea on each result. Null recognitionRef = unsupported.
	const recognitionRef = useRef<any>(null);
	const [isListening, setIsListening] = useState(false);
	const [voiceSupported, setVoiceSupported] = useState(false);
	// TTS — per-message Speak button uses window.speechSynthesis.
	// speakingId tracks which message is currently being read so the
	// button toggles correctly.
	const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
	// Surface auto-routing — set by the `route` SSE event at turn
	// start. Shows as a small "auto: claude" pill next to the model
	// picker when the agent overrode the user's selection.
	const [lastRoute, setLastRoute] = useState<{ modelUsed: string; autoRouted: boolean } | null>(null);

	// Mouse-picker state — `picking` mirrors the module-level flag in
	// StudioPicker so the icon button can render "armed"; `pickedTarget`
	// mirrors the held selection so the chip above the input shows what
	// the user has pinned. Both come from module subscriptions in
	// StudioContext / StudioPicker so any page can mutate them.
	const [picking, setPicking] = useState<boolean>(() => isStudioPicking());
	const [pickedTarget, setPickedTargetState] = useState<StudioPickedTarget | null>(() => getStudioPickedTarget());
	useEffect(() => subscribeStudioPicking(setPicking), []);
	useEffect(() => subscribeStudioPickedTarget(setPickedTargetState), []);

	// Staged attachments for the next send. Cleared after dispatch.
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [attachError, setAttachError] = useState<string>('');
	// Drag-and-drop state — true while files are being dragged over the
	// chat panel. Triggers the dashed-overlay on the textarea.
	const [dragOver, setDragOver] = useState(false);
	const dragDepthRef = useRef(0);
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

	// Persist active chat id.
	useEffect(() => {
		try {
			if (chatId) localStorage.setItem(CHAT_ID_KEY, chatId);
			else localStorage.removeItem(CHAT_ID_KEY);
		} catch { /* ignore */ }
	}, [chatId]);

	// Persist agent picker.
	useEffect(() => {
		try {
			if (agentId) localStorage.setItem(AGENT_KEY, agentId);
			else localStorage.removeItem(AGENT_KEY);
		} catch { /* ignore */ }
	}, [agentId]);

	// Persist persona picker.
	useEffect(() => {
		try {
			if (personaId) localStorage.setItem(PERSONA_KEY, personaId);
			else localStorage.removeItem(PERSONA_KEY);
		} catch { /* ignore */ }
	}, [personaId]);

	// Load installed xpio agents once. Sorted server-side
	// (newest-memory first); we just consume the array.
	useEffect(() => {
		(async () => {
			try {
				const r = await fetch('/api/v1/me/agents', { credentials: 'include' });
				if (!r.ok) return;
				const j = await r.json();
				const list: AgentRow[] = j?.data?.agents || [];
				setAgents(list);
			} catch { /* ignore */ }
		})();
	}, []);

	// Load user personas once. Re-fetched if the user edits them
	// elsewhere (future UI). Same shape as agents lookup.
	useEffect(() => {
		(async () => {
			try {
				const r = await fetch('/api/v1/me/personas', { credentials: 'include' });
				if (!r.ok) return;
				const j = await r.json();
				const list: PersonaRow[] = j?.data?.personas || [];
				setPersonas(list);
			} catch { /* ignore */ }
		})();
	}, []);

	// Mutually-exclusive guards — picking one clears the other so
	// the chat doesn't get a confused mix.
	const selectAgent = useCallback((id: string) => {
		setAgentId(id);
		if (id) setPersonaId('');
	}, []);
	const selectPersona = useCallback((id: string) => {
		setPersonaId(id);
		if (id) setAgentId('');
	}, []);

	// Auto-save after each turn settles. Triggers when streaming
	// transitions false and there's at least one assistant turn with
	// non-empty content (skips dispatch errors that left an empty
	// assistant placeholder). Debounced 600ms so a fast follow-up
	// turn doesn't fire two saves back-to-back.
	const saveTimerRef = useRef<number | null>(null);
	const lastSavedSigRef = useRef<string>('');
	useEffect(() => {
		if (streaming) return;
		if (messages.length < 2) return;
		const last = messages[messages.length - 1];
		if (last.role !== 'assistant' || !last.content) return;
		// Cheap signature so we don't re-POST when reordering UI bits.
		const sig = `${messages.length}:${last.content.length}:${(last.thinking||'').length}`;
		if (sig === lastSavedSigRef.current) return;

		if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
		saveTimerRef.current = window.setTimeout(async () => {
			try {
				const r = await fetch('/api/v1/me/chats', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({
						...(chatId ? { id: chatId } : {}),
						messages,
						model: model || undefined,
						mode: mode || undefined,
					}),
				});
				if (!r.ok) return;
				const j = await r.json();
				const newId: string | undefined = j?.data?.id;
				if (newId && newId !== chatId) setChatId(newId);
				lastSavedSigRef.current = sig;
			} catch { /* ignore */ }
		}, 600);
		return () => {
			if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
		};
	}, [messages, streaming, chatId, model, mode]);

	// Lazy-load history when the dropdown opens.
	const loadHistory = useCallback(async () => {
		try {
			const r = await fetch('/api/v1/me/chats', { credentials: 'include' });
			if (!r.ok) return;
			const j = await r.json();
			const rows: HistoryRow[] = j?.data?.chats || [];
			setHistory(rows);
		} catch { /* ignore */ }
	}, []);

	// Load one thread into the chat — replaces current messages +
	// chatId. Active session is overwritten; the previous thread is
	// already saved on disk, so the user can navigate back to it.
	const loadThread = useCallback(async (id: string) => {
		try {
			const r = await fetch('/api/v1/me/chats/' + encodeURIComponent(id), { credentials: 'include' });
			if (!r.ok) return;
			const j = await r.json();
			const rec = j?.data;
			if (!rec || !Array.isArray(rec.messages)) return;
			setMessages(rec.messages);
			setChatId(rec.id);
			lastSavedSigRef.current = '';
			setHistoryOpen(false);
		} catch { /* ignore */ }
	}, []);

	const newChat = useCallback(() => {
		if (streaming) return;
		setMessages([]);
		setChatId(null);
		lastSavedSigRef.current = '';
		try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
		setHistoryOpen(false);
	}, [streaming]);

	const deleteThread = useCallback(async (id: string) => {
		if (!confirm('Delete this conversation?')) return;
		try {
			await fetch('/api/v1/me/chats/' + encodeURIComponent(id), {
				method: 'DELETE',
				credentials: 'include',
			});
			if (id === chatId) newChat();
			loadHistory();
		} catch { /* ignore */ }
	}, [chatId, newChat, loadHistory]);

	// File picker handler — turns each selected file into an
	// Attachment, validates size + kind. Errors surface in a one-line
	// banner above the input.
	const onPickFiles = useCallback(async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		setAttachError('');
		const next: Attachment[] = [];
		for (const f of Array.from(files)) {
			const lowerName = f.name.toLowerCase();
			const isImage = f.type.startsWith('image/');
			const isDocument =
				DOCUMENT_MIMES.has(f.type) ||
				DOCUMENT_EXTS.some((ext) => lowerName.endsWith(ext));

			if (isImage) {
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
			} else if (isDocument) {
				if (f.size > MAX_DOC_BYTES) {
					setAttachError(`${f.name}: document > ${Math.round(MAX_DOC_BYTES / 1024 / 1024)}MB`);
					continue;
				}
				const buf = await f.arrayBuffer();
				const bytes = new Uint8Array(buf);
				let bin = '';
				for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
				const dataB64 = btoa(bin);
				// Best-effort mime fallback when the browser doesn't
				// label the file (e.g. some old systems for .docx).
				const mime = f.type || mimeFromExt(lowerName);
				next.push({ kind: 'document', name: f.name, mime, dataB64, sizeBytes: f.size });
			} else {
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

	// Voice input — initialise SpeechRecognition once on mount.
	// Chrome/Edge: webkitSpeechRecognition. Firefox: not supported
	// (we hide the mic button in that case). Safari: works since 14.
	useEffect(() => {
		const SR =
			(window as any).SpeechRecognition ||
			(window as any).webkitSpeechRecognition;
		if (!SR) return;
		const r = new SR();
		r.continuous = true;
		r.interimResults = true;
		r.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
		let baseInput = '';
		r.onstart = () => {
			baseInput = ''; // populated when toggleVoice() captures current input
		};
		r.onresult = (e: any) => {
			let interim = '';
			let final = '';
			for (let i = e.resultIndex; i < e.results.length; i++) {
				const res = e.results[i];
				if (res.isFinal) final += res[0].transcript;
				else interim += res[0].transcript;
			}
			const combined = (baseInput + ' ' + final + ' ' + interim).replace(/\s+/g, ' ').trim();
			setInput(combined);
		};
		r.onend = () => setIsListening(false);
		r.onerror = () => setIsListening(false);
		// Stash the baseInput setter so toggleVoice() can write into it.
		r.__setBase = (s: string) => { baseInput = s; };
		recognitionRef.current = r;
		setVoiceSupported(true);
		return () => {
			try { r.stop(); } catch { /* ignore */ }
		};
	}, []);

	const toggleVoice = useCallback(() => {
		const r = recognitionRef.current;
		if (!r) return;
		if (isListening) {
			try { r.stop(); } catch { /* ignore */ }
			setIsListening(false);
			return;
		}
		// Capture current input as the base; new dictation appends.
		r.__setBase(input);
		try { r.start(); setIsListening(true); } catch { /* already running */ }
	}, [isListening, input]);

	// TTS for assistant messages. Speaks via window.speechSynthesis;
	// click again on the same message to stop. Strips markdown
	// syntax characters so the engine doesn't read "asterisk
	// asterisk" etc.
	const toggleSpeak = useCallback((idx: number, content: string) => {
		const synth = window.speechSynthesis;
		if (!synth) return;
		if (speakingIdx === idx) {
			synth.cancel();
			setSpeakingIdx(null);
			return;
		}
		synth.cancel();
		const plain = content
			.replace(/```[\s\S]*?```/g, ' code block ')
			.replace(/`([^`]*)`/g, '$1')
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/\*([^*]+)\*/g, '$1')
			.replace(/\[\^?(\d+)\][:]?\s*(\S+)?/g, '') // strip footnote markers + defs
			.replace(/#+\s*/g, '')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/\s+/g, ' ')
			.trim();
		if (!plain) return;
		const u = new SpeechSynthesisUtterance(plain);
		u.rate = 1.05;
		u.onend = () => setSpeakingIdx(null);
		u.onerror = () => setSpeakingIdx(null);
		setSpeakingIdx(idx);
		synth.speak(u);
	}, [speakingIdx]);

	// Count of active per-turn toggles — surfaced as a small badge on
	// the [+] tools button so the user knows something is on without
	// opening the popover.
	const activeToolCount = (mode ? 1 : 0) + (think ? 1 : 0);

	// Click-outside to close the history dropdown.
	useEffect(() => {
		if (!historyOpen) return;
		const onClick = () => setHistoryOpen(false);
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHistoryOpen(false); };
		// One tick delay so the click that OPENED the menu doesn't
		// close it immediately.
		const t = window.setTimeout(() => {
			document.addEventListener('click', onClick);
			document.addEventListener('keydown', onKey);
		}, 0);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
		};
	}, [historyOpen]);

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

	// `studio:notify` — a page posts a passive note (e.g. a loop event
	// landed). Appended as an assistant message; does NOT expand or send,
	// so it's non-disruptive — it's just there when the user looks.
	useEffect(() => {
		const onNotify = (e: Event) => {
			const ce = e as CustomEvent<{ message?: string }>;
			const m = String(ce.detail?.message || '').trim();
			if (!m) return;
			// Consolidate: keep ONE loop-activity note, always at the bottom,
			// updated to the latest event with a running count — never append
			// a fresh message per event (that trashed the thread).
			setMessages((prev) => {
				const prior = prev.find((x) => x.notify);
				const count = (prior?.notifyCount || 0) + 1;
				const content = count > 1 ? `${m}  ·  +${count - 1} more recent` : m;
				return [...prev.filter((x) => !x.notify), { role: 'assistant', content, notify: true, notifyCount: count }];
			});
		};
		window.addEventListener('studio:notify', onNotify as EventListener);
		return () => window.removeEventListener('studio:notify', onNotify as EventListener);
	}, []);

	const queueSend = useCallback(async (text: string, baseMessages?: Message[]) => {
		if (!text || streaming) return;
		setInput('');
		const base = baseMessages ?? messages;
		const userMsg: Message = { role: 'user', content: text };
		const pageNote = buildSelectionPreamble(location.pathname);
		const wireMessages = [
			...base.map((m) => ({ role: m.role, content: m.content })),
			{ role: 'user' as const, content: `${pageNote}\n\n${text}` },
		];
		const assistantMsg: Message = { role: 'assistant', content: '', tools: [] };
		setMessages(() => [...base, userMsg, assistantMsg]);
		setStreaming(true);
		setLastRoute(null);
		// Stop dictation when a send fires so a long recording doesn't
		// stack with the new turn's input.
		if (isListening && recognitionRef.current) {
			try { recognitionRef.current.stop(); } catch { /* ignore */ }
		}
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
					...(personaId ? { persona_id: personaId } : agentId ? { agent_id: agentId } : {}),
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
							if (evt.type === 'route') {
								setLastRoute({
									modelUsed: String(evt.model_used || ''),
									autoRouted: !!evt.auto_routed,
								});
							} else if (evt.type === 'usage') {
								if (typeof evt.budget_used === 'number' && typeof evt.budget_limit === 'number') {
									setUsage({ used: evt.budget_used, limit: evt.budget_limit });
								}
								// usage also carries model_used / auto_routed (in case
								// the stream caller missed the early route event).
								if (evt.model_used) {
									setLastRoute({
										modelUsed: String(evt.model_used),
										autoRouted: !!evt.auto_routed,
									});
								}
							} else {
								handleEvent(evt, setMessages);
							}
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
	}, [messages, streaming, location.pathname, model, mode, think, agentId, personaId]);

	// Re-run a turn — drops the clicked assistant message + the user
	// message before it, then dispatches the original user text again
	// with the current model/mode/think settings (which may have
	// changed since the first run, the point of regen).
	const regenerate = useCallback((assistantIdx: number) => {
		if (streaming || assistantIdx < 1) return;
		const userIdx = assistantIdx - 1;
		const userMsg = messages[userIdx];
		if (!userMsg || userMsg.role !== 'user') return;
		const trimmed = messages.slice(0, userIdx);
		setMessages(trimmed);
		void queueSend(userMsg.content, trimmed);
	}, [messages, streaming, queueSend]);

	// Copy one message's content to the clipboard. Markdown is
	// preserved verbatim so paste into a doc-style editor keeps
	// formatting; readers that don't know markdown just see the raw
	// text. No toast — the assistant turn briefly flashes via title
	// state in MessageBubble.
	const copyMessage = useCallback((content: string) => {
		try { navigator.clipboard.writeText(content); } catch { /* ignore */ }
	}, []);

	// dispatchTurn — fire one chat turn with the given text + already-
	// snapshotted attachments. Pure of `input` and `attachments` state
	// (those reads happen in `send` / queue processor). Returns once
	// the SSE stream finishes (success or error).
	const dispatchTurn = useCallback(async (text: string, stagedAttachments: Attachment[]) => {
		const userMsg: Message = { role: 'user', content: text };
		// Include a tiny system note about the active page so the agent
		// can answer "what should I do here?" cohesively. Lightweight
		// page-context prefix — full Phase S6b adds selected-item refs.
		const pageNote = buildSelectionPreamble(location.pathname);
		const wireAttachments: WireAttachment[] = stagedAttachments.map((a) =>
			a.kind === 'image'
				? { kind: 'image', name: a.name, mime: a.mime, data_b64: a.dataB64 }
				: a.kind === 'document'
					? { kind: 'document', name: a.name, mime: a.mime, data_b64: a.dataB64 }
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
		setLastRoute(null);
		// Stop dictation when a send fires so a long recording doesn't
		// stack with the new turn's input.
		if (isListening && recognitionRef.current) {
			try { recognitionRef.current.stop(); } catch { /* ignore */ }
		}

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
					...(personaId ? { persona_id: personaId } : agentId ? { agent_id: agentId } : {}),
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
	}, [messages, location.pathname, model, mode, think, agentId, personaId]);

	// send() — user-initiated dispatch from the input. Reads input
	// + attachments state, validates, then either enqueues (if a
	// turn is in flight) or hands off to dispatchTurn.
	const send = useCallback(() => {
		const text = input.trim();
		if (!text) return;
		if (streaming) {
			// Stash for FIFO dispatch after the current turn finishes.
			setMessageQueue((q) => [...q, { text, attachments: [...attachments] }]);
			setInput('');
			setAttachments([]);
			setAttachError('');
			return;
		}
		const staged = attachments;
		setInput('');
		setAttachments([]);
		setAttachError('');
		void dispatchTurn(text, staged);
	}, [input, streaming, attachments, dispatchTurn]);

	// Queue processor — after each streaming turn settles, if the
	// queue has a head, pop and dispatch. Runs in a microtask so
	// React's state has fully flushed before the next turn kicks off.
	useEffect(() => {
		if (streaming) return;
		const head = messageQueueRef.current[0];
		if (!head) return;
		// Pop the head off the queue, then dispatch.
		setMessageQueue((q) => q.slice(1));
		// Microtask so the state update lands first.
		Promise.resolve().then(() => {
			void dispatchTurn(head.text, head.attachments);
		});
	}, [streaming, dispatchTurn, messageQueue.length]);

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
			data-studio-picker-chrome="1"
			style={{ width }}
			className={[
				// z-20 lifts the chat aside above the workspace shell header
				// (which is sticky top-0 z-10). Without this, header
				// popovers (artifact, history, context) paint UNDER the
				// shell header when they extend leftward into the
				// workspace area — the shell header's stacking context
				// otherwise wins despite later DOM order.
				'flex flex-col h-screen sticky top-0 flex-shrink-0 relative z-20',
				'bg-gradient-to-b from-white via-white to-emerald-50/30',
				'border-l border-slate-200/70 shadow-[inset_1px_0_0_0_rgb(255_255_255/0.8)]',
				resizing ? 'select-none' : '',
			].join(' ')}
			onDragEnter={(e) => {
				if (!e.dataTransfer?.types?.includes('Files')) return;
				e.preventDefault();
				dragDepthRef.current += 1;
				setDragOver(true);
			}}
			onDragOver={(e) => {
				if (e.dataTransfer?.types?.includes('Files')) {
					e.preventDefault();
					e.dataTransfer.dropEffect = 'copy';
				}
			}}
			onDragLeave={(e) => {
				if (!e.dataTransfer?.types?.includes('Files')) return;
				dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
				if (dragDepthRef.current === 0) setDragOver(false);
			}}
			onDrop={(e) => {
				if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
				e.preventDefault();
				dragDepthRef.current = 0;
				setDragOver(false);
				onPickFiles(e.dataTransfer.files);
			}}
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
			<header className="relative z-30 h-14 px-4 border-b border-slate-200/70 flex items-center justify-between flex-shrink-0 bg-white/80 backdrop-blur-sm gap-2">
				<div className="flex items-center gap-2.5 min-w-0 flex-1">
					<div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center shadow-sm shadow-emerald-200 flex-shrink-0">
						<Bot className="w-4 h-4" />
						{streaming && (
							<span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse" />
						)}
					</div>
					<div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
						<span className="text-sm font-semibold text-slate-900 tracking-tight">Just ask</span>
						<ModelChip
							streaming={streaming}
							models={models}
							model={model}
							setModel={setModel}
						/>
						{usage && usage.limit > 0 && (
							<span
								className={[
									'text-[10px] font-mono font-normal px-1.5 py-px rounded',
									usage.used >= usage.limit
										? 'bg-rose-100 text-rose-700'
										: usage.used > usage.limit * 0.8
											? 'bg-amber-100 text-amber-700'
											: 'bg-slate-100 text-slate-500',
								].join(' ')}
								title={`Daily token usage: ${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} (est. $${estimateCost(usage.used, model).toFixed(2)})`}
							>
								{formatTokens(usage.used)}/{formatTokens(usage.limit)}
							</span>
						)}
						{lastRoute?.autoRouted && lastRoute.modelUsed !== model && (
							<span
								className="text-[9.5px] font-normal px-1 py-px rounded bg-sky-100 text-sky-700 font-medium"
								title={`Auto-routed to ${lastRoute.modelUsed} (needed a capability your selected model lacks).`}
							>
								auto: {modelShortLabel(lastRoute.modelUsed)}
							</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-0.5 flex-shrink-0">
					<ContextIconButton
						streaming={streaming}
						agents={agents}
						agentId={agentId}
						selectAgent={selectAgent}
						personas={personas}
						personaId={personaId}
						selectPersona={selectPersona}
					/>
					<ArtifactIconButton />

					{/* History dropdown — anchored relative; popover below
					    shows recent threads + "New chat". Click outside to
					    close (window click handler below). */}
					<div className="relative">
						<button
							onClick={() => {
								const next = !historyOpen;
								setHistoryOpen(next);
								if (next) loadHistory();
							}}
							title="Conversation history"
							className={[
								'p-1.5 rounded-md transition-colors',
								historyOpen ? 'text-emerald-700 bg-emerald-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100',
							].join(' ')}
						>
							<MessageSquarePlus className="w-3.5 h-3.5" />
						</button>
						{historyOpen && (
							<div
								className="absolute right-0 top-full mt-1 z-50 w-72 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/40 p-1"
								onClick={(e) => e.stopPropagation()}
							>
								<button
									type="button"
									onClick={newChat}
									className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
								>
									<Plus className="w-3.5 h-3.5 text-emerald-600" />
									<span className="font-medium">New chat</span>
								</button>
								<div className="h-px bg-slate-100 my-1 mx-2" />
								{history.length === 0 && (
									<div className="px-2.5 py-1.5 text-[11px] text-slate-400 italic">
										No saved threads yet.
									</div>
								)}
								{history.map((h) => (
									<div
										key={h.id}
										className={[
											'group flex items-center gap-1 px-1 py-0.5 rounded-lg transition-colors',
											h.id === chatId ? 'bg-emerald-50/60' : 'hover:bg-slate-50',
										].join(' ')}
									>
										<button
											type="button"
											onClick={() => loadThread(h.id)}
											className="flex-1 min-w-0 text-left px-1.5 py-1"
										>
											<div className="text-[12.5px] font-medium text-slate-800 truncate">{h.title}</div>
											<div className="text-[10px] text-slate-500 flex items-center gap-1">
												<span>{h.msg_count} msg</span>
												<span>·</span>
												<span>{relativeTime(h.updated_at)}</span>
											</div>
										</button>
										<button
											type="button"
											onClick={() => deleteThread(h.id)}
											title="Delete"
											className="p-1 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition-all"
										>
											<Trash2 className="w-3 h-3" />
										</button>
									</div>
								))}
							</div>
						)}
					</div>
					{messages.length > 0 && (
						<button
							onClick={clear}
							title="Clear (without deleting from history)"
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
					<MessageBubble
					key={i}
					m={m}
					streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
					onCopy={m.role === 'assistant' && m.content ? () => copyMessage(m.content) : undefined}
					onRegenerate={m.role === 'assistant' && !streaming && i > 0 && messages[i - 1]?.role === 'user' ? () => regenerate(i) : undefined}
					onSpeak={m.role === 'assistant' && m.content && typeof window !== 'undefined' && 'speechSynthesis' in window ? () => toggleSpeak(i, m.content) : undefined}
					isSpeaking={speakingIdx === i}
				/>
				))}
			</div>

			<footer className="relative z-30 border-t border-slate-200/70 p-3 flex-shrink-0 bg-white/60 backdrop-blur-sm">
				{/* Queued messages. Shows the FIFO list of turns waiting
				    for the current stream to finish. Each row is
				    clickable to remove from the queue. Hidden when empty. */}
				{messageQueue.length > 0 && (
					<div className="mb-2 px-0.5 flex flex-col gap-1">
						<div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold flex items-center gap-1">
							<span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
							{messageQueue.length} message{messageQueue.length === 1 ? '' : 's'} queued
						</div>
						{messageQueue.map((q, i) => (
							<div
								key={i}
								className="flex items-center gap-1.5 text-[11px] bg-amber-50/70 border border-amber-200/60 rounded-lg px-2 py-1"
							>
								<span className="flex-1 truncate text-amber-900">{q.text}</span>
								{q.attachments.length > 0 && (
									<span className="text-[10px] text-amber-700 font-mono">+{q.attachments.length}</span>
								)}
								<button
									type="button"
									onClick={() => setMessageQueue((arr) => arr.filter((_, idx) => idx !== i))}
									className="text-amber-600 hover:text-rose-500 transition-colors"
									title="Cancel this queued message"
								>
									<X className="w-3 h-3" />
								</button>
							</div>
						))}
					</div>
				)}

				{/* Picked target chip — shown when the user has used the
				    Crosshair to pin a UI element. The chat preamble
				    folds this in at send-time (see buildSelectionPreamble).
				    Click X to clear; clicking the chip's label re-arms
				    the picker so the user can swap targets. */}
				{pickedTarget && (
					<div className="mb-2 px-0.5">
						{(() => {
							// Free-form picks (no declared affordances on the
							// element) get a sky chip to signal "text snapshot
							// only". Annotated picks keep the emerald chip.
							const isFreeform = !pickedTarget.affordances || pickedTarget.affordances.length === 0;
							const chipCls = isFreeform
								? 'inline-flex items-center gap-1.5 text-[11px] bg-sky-50 border border-sky-200 rounded-full pl-2 pr-1 py-0.5'
								: 'inline-flex items-center gap-1.5 text-[11px] bg-emerald-50 border border-emerald-200 rounded-full pl-2 pr-1 py-0.5';
							const iconCls   = isFreeform ? 'w-3 h-3 text-sky-600 flex-shrink-0'      : 'w-3 h-3 text-emerald-600 flex-shrink-0';
							const kindCls   = isFreeform ? 'text-sky-700 font-medium'                : 'text-emerald-700 font-medium';
							const labelCls  = isFreeform ? 'text-sky-800 max-w-[260px] truncate'     : 'text-emerald-800 max-w-[260px] truncate';
							const closeCls  = isFreeform ? 'text-sky-700/70 hover:text-rose-600 transition-colors flex-shrink-0' : 'text-emerald-700/70 hover:text-rose-600 transition-colors flex-shrink-0';
							return (
								<div className={chipCls}>
									<Crosshair className={iconCls} />
									<span className={kindCls}>{pickedTarget.kind}</span>
									<span className={labelCls}>{pickedTarget.label}</span>
									<button
										type="button"
										onClick={() => setStudioPickedTarget(null)}
										className={closeCls}
										title="Clear pinned target"
									>
										<X className="w-3 h-3" />
									</button>
								</div>
							);
						})()}
					</div>
				)}

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
									: a.kind === 'document'
										? <FileText className="w-3 h-3 text-violet-600" />
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
					className="flex items-center gap-1.5"
				>
					<input
						ref={fileInputRef}
						type="file"
						multiple
						accept="image/*,text/*,.md,.csv,.json,.tsv,.log,.yml,.yaml,.toml,.pdf,.docx,.xlsx,.pptx,.rtf,.odt,.ods,.odp,.epub"
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
								'relative h-[42px] w-[42px] flex items-center justify-center rounded-xl border transition-all',
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
							<div className="absolute bottom-full mb-2 left-0 z-50 min-w-[180px] p-1 rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
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
								{/* Agent + Persona pickers moved to the header — they're
								    persistent context (sticky across turns), not per-turn
								    tool-forcing toggles. See the chip row beside the model
								    select in the header subtitle. */}
								<div className="h-px bg-slate-100 my-1 mx-2" />
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] text-slate-700 hover:bg-slate-50 transition-colors"
								>
									<Paperclip className="w-3.5 h-3.5 text-slate-500" />
									<span className="font-medium flex-1 text-left">Attach file</span>
								</button>
								{voiceSupported && (
									<button
										type="button"
										onClick={() => {
											toggleVoice();
											setToolsOpen(false);
										}}
										className={[
											'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
											isListening
												? 'bg-rose-50 text-rose-700'
												: 'text-slate-700 hover:bg-slate-50',
										].join(' ')}
									>
										<Mic className={['w-3.5 h-3.5', isListening ? 'text-rose-600' : 'text-slate-500'].join(' ')} />
										<span className="font-medium flex-1 text-left">
											{isListening ? 'Stop dictating' : 'Voice input'}
										</span>
										{isListening && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />}
									</button>
								)}
							</div>
						)}
					</div>
					<div className="flex-1 relative group">
						<textarea
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								// Send: Enter (without modifiers) OR Cmd+Enter / Ctrl+Enter
								// from anywhere. Shift+Enter inserts newline as usual.
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									send();
									return;
								}
								if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									send();
									return;
								}
								// ↑ on an empty input repopulates the last user
								// turn so a typo can be fixed without retyping.
								if (e.key === 'ArrowUp' && input === '') {
									const lastUser = [...messages].reverse().find((m) => m.role === 'user');
									if (lastUser) {
										e.preventDefault();
										setInput(lastUser.content);
									}
								}
							}}
							placeholder={
								dragOver
									? 'Drop to attach'
									: streaming
										? 'Type next message — sends when current turn finishes'
										: 'Ask anything…'
							}
							rows={1}
							className={[
								'w-full px-3.5 py-2.5 text-sm rounded-xl border bg-white shadow-sm focus:outline-none focus:ring-4 focus:ring-emerald-400/15 focus:border-emerald-400 resize-none max-h-32 transition-all placeholder:text-slate-400',
								dragOver
									? 'border-emerald-400 border-dashed bg-emerald-50/40 placeholder:text-emerald-700'
									: 'border-slate-200',
							].join(' ')}
							style={{ minHeight: '42px' }}
						/>
					</div>
					{streaming && (
						<button
							type="button"
							onClick={() => abortRef.current?.abort()}
							title="Stop current turn"
							className="h-[42px] w-[42px] flex items-center justify-center rounded-xl flex-shrink-0 bg-rose-500 text-white hover:bg-rose-600 active:scale-95 shadow-sm shadow-rose-200 transition-all"
						>
							<Square className="w-3.5 h-3.5 fill-current" />
						</button>
					)}
					{/* Mouse-picker — arms StudioPicker so the user can
					    click any [data-pick-id] on the page and pin it
					    as the chat's referent. Sits left of Send so it
					    feels like a compose-time action, not a setting. */}
					<button
						type="button"
						onClick={() => (picking ? stopStudioPicking() : startStudioPicking())}
						title={picking ? 'Picking — click anything · Esc to cancel' : 'Pick a UI element on the page'}
						className={[
							'h-[42px] w-[42px] flex items-center justify-center rounded-xl flex-shrink-0 border transition-all active:scale-95',
							picking
								? 'border-emerald-300 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300'
								: pickedTarget
									? 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'
									: 'border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50',
						].join(' ')}
					>
						<Crosshair className="w-4 h-4" />
					</button>
					<button
						type="submit"
						disabled={!input.trim()}
						title={streaming
							? `Queue this message (sends when current turn finishes)${messageQueue.length > 0 ? ` — ${messageQueue.length} already queued` : ''}`
							: 'Send'}
						className={[
							'relative h-[42px] w-[42px] flex items-center justify-center rounded-xl transition-all flex-shrink-0',
							!input.trim()
								? 'bg-slate-100 text-slate-300 cursor-not-allowed'
								: streaming
									? 'bg-gradient-to-br from-sky-500 to-sky-600 text-white hover:from-sky-400 hover:to-sky-500 active:scale-95 shadow-sm shadow-sky-200'
									: 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white hover:from-emerald-400 hover:to-emerald-500 active:scale-95 shadow-sm shadow-emerald-200',
						].join(' ')}
					>
						<Send className="w-4 h-4" />
						{messageQueue.length > 0 && (
							<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white">
								{messageQueue.length}
							</span>
						)}
					</button>
				</form>
			</footer>
		</aside>
	);
}

function MessageBubble({
	m,
	streaming,
	onCopy,
	onRegenerate,
	onSpeak,
	isSpeaking,
}: {
	m: Message;
	streaming?: boolean;
	onCopy?: () => void;
	onRegenerate?: () => void;
	onSpeak?: () => void;
	isSpeaking?: boolean;
}) {
	const isUser = m.role === 'user';
	const [copied, setCopied] = useState(false);
	const showActions = !streaming && (onCopy || onRegenerate || onSpeak);
	return (
		<div className={['group flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200', isUser ? 'flex-row-reverse' : ''].join(' ')}>
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
				{!isUser && m.content && !streaming && (
					<div
						className="mt-0.5 text-[10px] text-slate-400 tabular-nums"
						title="estimated output tokens (~4 chars/token)"
					>
						{Math.max(1, Math.round(m.content.length / 4))} tokens
					</div>
				)}
				{showActions && (
					<div className={[
						'mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity',
						isUser ? 'justify-end' : '',
					].join(' ')}>
						{onCopy && (
							<button
								type="button"
								onClick={() => {
									onCopy();
									setCopied(true);
									setTimeout(() => setCopied(false), 1200);
								}}
								title={copied ? 'Copied' : 'Copy'}
								className={[
									'p-1 rounded text-[10px]',
									copied
										? 'text-emerald-700 bg-emerald-50'
										: 'text-slate-400 hover:text-slate-700 hover:bg-slate-100',
								].join(' ')}
							>
								<Copy className="w-3 h-3" />
							</button>
						)}
						{onRegenerate && (
							<button
								type="button"
								onClick={onRegenerate}
								title="Regenerate with current model + toggles"
								className="p-1 rounded text-[10px] text-slate-400 hover:text-emerald-700 hover:bg-emerald-50"
							>
								<RotateCcw className="w-3 h-3" />
							</button>
						)}
						{onSpeak && (
							<button
								type="button"
								onClick={onSpeak}
								title={isSpeaking ? 'Stop reading' : 'Read aloud'}
								className={[
									'p-1 rounded text-[10px]',
									isSpeaking
										? 'text-sky-700 bg-sky-50'
										: 'text-slate-400 hover:text-sky-700 hover:bg-sky-50',
								].join(' ')}
							>
								<Volume2 className="w-3 h-3" />
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

// ThinkingBlock — collapsible reasoning panel above the assistant's
// reply. Auto-expanded while streaming so the user sees the model
// Collapsed by default — the user clicks to peek at the reasoning. The
// label updates live ("Thinking… 142 tokens" → "Thought (412 tokens)")
// so they still see activity without the panel hijacking attention
// from the streaming answer. Token count is a ~4-chars/token estimate
// (we don't get a usage count for the streamed thinking deltas).
function ThinkingBlock({ thinking, done }: { thinking: string; done: boolean }) {
	const [open, setOpen] = useState<boolean>(false);
	const tokenCount = thinking.length ? Math.max(1, Math.round(thinking.length / 4)) : 0;
	const label = done
		? `Thought (${tokenCount} tokens)`
		: tokenCount > 0
			? `Thinking… ${tokenCount} tokens`
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
					Ask in plain English. I&apos;ll act.
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
			content: (m.content ? m.content + '\n\n' : '') + friendlyChatError(evt.message),
		})));
	}
	// 'usage' and 'done' events — no UI change needed for now.
}

// Turn a raw upstream error into something a user can act on. The most
// common one today is the kv.run LLM gateway being unconfigured
// (503 "FINDATA_LLM_BACKEND_URL is empty") — surface that as a calm
// "temporarily offline" line instead of dumping provider JSON.
function friendlyChatError(raw: string): string {
	const s = String(raw);
	if (/503|service unavailable|backend not configured|FINDATA_LLM_BACKEND_URL|no .*provider accepted/i.test(s)) {
		return '⚠️ The AI model is temporarily offline. Your message wasn’t lost — try again shortly.';
	}
	if (/401|sign in|unauthor/i.test(s)) {
		return '⚠️ Please sign in to use chat.';
	}
	if (/429|rate.?limit/i.test(s)) {
		return '⚠️ Rate limit reached — give it a moment and try again.';
	}
	return `⚠️ ${s}`;
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

// formatTokens — compact display: 12345 → "12.3K", 1234567 → "1.2M".
function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'K';
	return (n / 1_000_000).toFixed(1) + 'M';
}

// estimateCost — coarse $ estimate for the daily-budget tooltip.
// Per-1K-token rates approximated from current public pricing. The
// budget meter on the server tracks input+output tokens combined,
// so we use a blended midpoint per model. kv.run/MiniMax runs on
// owned hardware → marginal cost ≈ 0.
function estimateCost(tokens: number, modelId: string): number {
	const blendedPerK = (() => {
		switch (modelId) {
			case 'claude-haiku':   return 0.0025; // input $1/M + output $5/M, midpoint
			case 'kvrun-minimax':  return 0.0;     // owned GPUs — sunk cost
			default:               return 0.001;   // conservative fallback
		}
	})();
	return (tokens / 1000) * blendedPerK;
}

// modelShortLabel — pulls a 7-char label from a model id for the
// "auto: <model>" pill. Avoids the full display name overflowing.
function modelShortLabel(id: string): string {
	if (id === 'claude-haiku') return 'Claude';
	if (id === 'kvrun-minimax') return 'MiniMax';
	return id.length > 10 ? id.slice(0, 10) + '…' : id;
}

// ─── Header context chips + icon buttons ──────────────────────────
//
//   ModelChip          → inline pill next to "Just ask" in the title.
//   AgentIconButton    → icon-button in the right group; violet dot
//                        when active.
//   PersonaIconButton  → icon-button beside AgentIconButton;
//                        fuchsia dot when active.
//   ArtifactIconButton → icon-button beside PersonaIconButton.
//                        Dispatches `studio:artifact-panel-toggle`
//                        for the panel drawer to listen.
//
// Each manages its own popover open-state + click-outside handler
// via the shared useClickOutside hook below.

function useClickOutside(open: boolean, close: () => void) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onClick = (e: MouseEvent) => {
			if (!ref.current || ref.current.contains(e.target as Node)) return;
			close();
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
		const t = window.setTimeout(() => {
			document.addEventListener('mousedown', onClick);
			document.addEventListener('keydown', onKey);
		}, 0);
		return () => {
			window.clearTimeout(t);
			document.removeEventListener('mousedown', onClick);
			document.removeEventListener('keydown', onKey);
		};
	}, [open, close]);
	return ref;
}

function ModelChip({
	streaming, models, model, setModel,
}: {
	streaming: boolean;
	models: ModelOption[];
	model: string;
	setModel: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useClickOutside(open, () => setOpen(false));
	const current = models.find((m) => m.id === model);
	if (models.length === 0) return null;
	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				disabled={streaming}
				className={[
					'inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[10.5px] border transition-colors',
					open
						? 'bg-slate-100 border-slate-300 text-slate-800'
						: 'bg-white/60 border-slate-200/80 text-slate-600 hover:bg-slate-50 hover:border-slate-300',
					streaming ? 'opacity-50 cursor-not-allowed' : '',
				].join(' ')}
				title="LLM backend"
			>
				<Bot className="w-2.5 h-2.5 flex-shrink-0" />
				<span className="truncate max-w-[110px]">{current?.display_name || model || 'model'}</span>
				<ChevronDown className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
			</button>
			{open && (
				<div className="absolute top-full left-0 mt-1 z-50 min-w-[180px] p-1 rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
					{models.map((m) => (
						<button
							key={m.id}
							type="button"
							onClick={() => { setModel(m.id); setOpen(false); }}
							className={[
								'w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors',
								m.id === model ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50',
							].join(' ')}
						>
							<Bot className={['w-3 h-3', m.id === model ? 'text-emerald-600' : 'text-slate-400'].join(' ')} />
							<span className="font-medium flex-1">{m.display_name}</span>
							{m.id === model && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// ContextIconButton — combined agent + persona picker. Both are
// mutually-exclusive context overrides (`resolvePromptAndTools` in
// the server gives persona priority when both are set), so it makes
// sense to surface them under one button. The popover stacks both
// sections; picking one auto-clears the other via the selectAgent
// + selectPersona callbacks that the parent threads in.
//
// Active state: violet bg/dot when agent is active, fuchsia when
// persona is, neutral when neither.
function ContextIconButton({
	streaming,
	agents, agentId, selectAgent,
	personas, personaId, selectPersona,
}: {
	streaming: boolean;
	agents: Array<{ id: string; scope: 'tenant' | 'shared'; row_count: number; last_memory_ts: number; app?: string; role?: string; description?: string; default_model?: string }>;
	agentId: string;
	selectAgent: (id: string) => void;
	personas: Array<{ id: string; name: string; icon?: string; allowed_tools?: string[]; preferred_model?: string; prompt_len: number; updated_at: string }>;
	personaId: string;
	selectPersona: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useClickOutside(open, () => setOpen(false));
	const currentAgent   = agents.find((a) => a.id === agentId);
	const currentPersona = personas.find((p) => p.id === personaId);
	if (agents.length === 0 && personas.length === 0) return null;

	const agentGroups = (() => {
		const declared = agents.filter((a) => a.role && a.row_count > 0);
		const byApp: Record<string, typeof agents> = {};
		declared.forEach((a) => { const k = a.app || '(other)'; (byApp[k] = byApp[k] || []).push(a); });
		const bare = agents.filter((a) => !a.role && a.row_count > 0);
		const out: { label: string; rows: typeof agents }[] = [];
		Object.keys(byApp).sort().forEach((app) => out.push({ label: app, rows: byApp[app] }));
		if (bare.length > 0) out.push({ label: 'other banks', rows: bare });
		return out;
	})();

	const activeKind: 'agent' | 'persona' | null =
		agentId   ? 'agent'   :
		personaId ? 'persona' : null;
	const activeColors = (() => {
		switch (activeKind) {
			case 'agent':   return 'text-violet-700  bg-violet-50  hover:bg-violet-100';
			case 'persona': return 'text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100';
			default:        return open
				? 'text-slate-800 bg-slate-100'
				: 'text-slate-400 hover:text-slate-700 hover:bg-slate-100';
		}
	})();
	const activeDot = (() => {
		switch (activeKind) {
			case 'agent':   return 'bg-violet-500';
			case 'persona': return 'bg-fuchsia-500';
			default:        return null;
		}
	})();
	const titleText = currentAgent
		? `Talk to ${currentAgent.role || currentAgent.id} (click to change or clear)`
		: currentPersona
			? `Persona: ${currentPersona.name} (click to change or clear)`
			: 'Talk to an agent or apply a persona';

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				disabled={streaming}
				title={titleText}
				className={[
					'relative p-1.5 rounded-md transition-colors',
					activeColors,
					streaming ? 'opacity-50 cursor-not-allowed' : '',
				].join(' ')}
			>
				<User className="w-3.5 h-3.5" />
				{activeDot && (
					<span className={['absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ring-2 ring-white', activeDot].join(' ')} />
				)}
			</button>
			{open && (
				<div className="absolute top-full right-0 mt-1 z-50 w-[320px] max-h-[30rem] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">

					{/* ── Active strip ── shows current selection +
					    one-click clear. Always visible (rendered as
					    neutral when nothing's active). */}
					<div className={[
						'flex items-center gap-2 px-3 py-2 border-b',
						activeKind === 'agent'   ? 'bg-violet-50/70  border-violet-100'  :
						activeKind === 'persona' ? 'bg-fuchsia-50/70 border-fuchsia-100' :
						                           'bg-slate-50      border-slate-100',
					].join(' ')}>
						<div className={[
							'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
							activeKind === 'agent'   ? 'bg-violet-100  text-violet-700'  :
							activeKind === 'persona' ? 'bg-fuchsia-100 text-fuchsia-700' :
							                           'bg-white border border-slate-200 text-slate-400',
						].join(' ')}>
							{currentPersona?.icon
								? <span className="text-[14px] leading-none">{currentPersona.icon}</span>
								: <User className="w-3.5 h-3.5" />}
						</div>
						<div className="flex-1 min-w-0">
							<div className={[
								'text-[12px] font-semibold truncate',
								activeKind === 'agent'   ? 'text-violet-900'  :
								activeKind === 'persona' ? 'text-fuchsia-900' :
								                           'text-slate-700',
							].join(' ')}>
								{currentAgent
									? (currentAgent.role || currentAgent.id)
									: currentPersona
										? currentPersona.name
										: 'Default — chat as you'}
							</div>
							<div className="text-[10.5px] text-slate-500 truncate">
								{currentAgent
									? `agent · ${currentAgent.app || 'standalone'} · ${currentAgent.row_count} memories`
									: currentPersona
										? `persona · ${currentPersona.allowed_tools && currentPersona.allowed_tools.length > 0 ? `${currentPersona.allowed_tools.length} tool${currentPersona.allowed_tools.length===1?'':'s'}` : 'all tools'}`
										: 'me-prefs as context'}
							</div>
						</div>
						{(agentId || personaId) && (
							<button
								type="button"
								onClick={() => { selectAgent(''); selectPersona(''); setOpen(false); }}
								title="Clear context — back to default"
								className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white/80 transition-colors"
							>
								<X className="w-3.5 h-3.5" />
							</button>
						)}
					</div>

					<div className="p-1">

						{/* ── Agents section ── */}
						{agents.length > 0 && (
							<>
								<div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
									<span className="w-0.5 h-3 rounded-full bg-violet-500" />
									<span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-violet-700">Talk to agent</span>
									<span className="text-[10px] text-slate-400">grounds chat in agent's bank</span>
								</div>
								{agentGroups.map((g) => (
									<div key={g.label} className="mb-1">
										<div className="px-2.5 pt-1 pb-0.5 text-[9.5px] uppercase tracking-wider text-slate-400">
											{g.label}
										</div>
										{g.rows.map((a) => {
											const selected = a.id === agentId;
											const initial = (a.role || a.id).slice(0, 1).toUpperCase();
											return (
												<button
													key={a.id}
													type="button"
													onClick={() => { selectAgent(a.id); setOpen(false); }}
													className={[
														'w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors',
														selected ? 'bg-violet-50' : 'hover:bg-slate-50',
													].join(' ')}
												>
													<span className={[
														'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5',
														selected
															? 'bg-violet-200 text-violet-800'
															: 'bg-slate-100 text-slate-500',
													].join(' ')}>{initial}</span>
													<div className="flex-1 min-w-0">
														<div className="flex items-center gap-1.5">
															<span className={[
																'text-[12px] font-medium truncate',
																selected ? 'text-violet-900' : 'text-slate-800',
															].join(' ')}>
																{a.role || a.id}
															</span>
															<span className={[
																'ml-auto text-[9.5px] font-mono px-1.5 py-px rounded-full flex-shrink-0',
																selected
																	? 'bg-violet-100 text-violet-700'
																	: 'bg-slate-100 text-slate-500',
															].join(' ')}>{a.row_count}</span>
														</div>
														{a.description && (
															<div className="text-[10.5px] text-slate-500 leading-snug line-clamp-2 mt-0.5">
																{a.description}
															</div>
														)}
													</div>
												</button>
											);
										})}
									</div>
								))}
							</>
						)}

						{/* ── Personas section ── */}
						{personas.length > 0 && (
							<>
								{agents.length > 0 && <div className="h-px bg-slate-100 my-1 mx-2" />}
								<div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
									<span className="w-0.5 h-3 rounded-full bg-fuchsia-500" />
									<span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-fuchsia-700">Persona</span>
									<span className="text-[10px] text-slate-400">custom prompt + tool subset</span>
								</div>
								{personas.map((p) => {
									const selected = p.id === personaId;
									const restricted = p.allowed_tools && p.allowed_tools.length > 0;
									return (
										<button
											key={p.id}
											type="button"
											onClick={() => { selectPersona(p.id); setOpen(false); }}
											className={[
												'w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors',
												selected ? 'bg-fuchsia-50' : 'hover:bg-slate-50',
											].join(' ')}
										>
											<span className={[
												'w-6 h-6 rounded-full flex items-center justify-center text-[14px] leading-none flex-shrink-0',
												selected
													? 'bg-fuchsia-200'
													: 'bg-slate-100',
											].join(' ')}>{p.icon || '🎭'}</span>
											<span className={[
												'text-[12px] font-medium flex-1 truncate',
												selected ? 'text-fuchsia-900' : 'text-slate-800',
											].join(' ')}>{p.name}</span>
											{restricted && (
												<span
													className={[
														'text-[9px] px-1.5 py-px rounded-full flex-shrink-0',
														selected
															? 'bg-fuchsia-100 text-fuchsia-700'
															: 'bg-slate-100 text-slate-500',
													].join(' ')}
													title={`Restricted to ${p.allowed_tools!.length} tool${p.allowed_tools!.length===1?'':'s'}`}
												>{p.allowed_tools!.length}t</span>
											)}
										</button>
									);
								})}
							</>
						)}

						{/* Footer hint when only one section is populated */}
						{(agents.length === 0 || personas.length === 0) && (
							<div className="px-2.5 py-2 mt-1 border-t border-slate-100 text-[10.5px] text-slate-400 leading-snug">
								{agents.length === 0 && personas.length > 0 && (
									<>No xpio agents installed yet — try <span className="font-mono">app_install</span> a knowledge app.</>
								)}
								{personas.length === 0 && agents.length > 0 && (
									<>No personas yet — create one via <span className="font-mono">POST /me/personas</span>.</>
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ArtifactIconButton — full artifact panel embedded in a popover
// anchored to the icon. Replaces the old left-rail StudioArtifactPanel.
// Shows list + detail-on-click + per-item copy/download/delete in
// one ~420px wide popover. Auto-opens + selects when the agent
// dispatches `studio:artifact-saved`.
type ArtifactRow = {
	id: string;
	kind: 'markdown' | 'code' | 'json' | 'text';
	title: string;
	language?: string;
	source_tool?: string;
	created_at: string;
	bytes: number;
};
type ArtifactFull = ArtifactRow & { content: string };

function ArtifactIconButton() {
	const [open, setOpen] = useState(false);
	const ref = useClickOutside(open, () => setOpen(false));
	const [rows, setRows] = useState<ArtifactRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selected, setSelected] = useState<ArtifactFull | null>(null);
	const [selectedLoading, setSelectedLoading] = useState(false);
	const [copied, setCopied] = useState(false);

	const loadList = useCallback(async () => {
		setLoading(true);
		try {
			const r = await fetch('/api/v1/me/artifacts', { credentials: 'include' });
			if (!r.ok) return;
			const j = await r.json();
			setRows(Array.isArray(j?.data?.artifacts) ? j.data.artifacts : []);
		} catch { /* ignore */ } finally {
			setLoading(false);
		}
	}, []);

	const loadOne = useCallback(async (id: string) => {
		setSelectedId(id);
		setSelectedLoading(true);
		setSelected(null);
		try {
			const r = await fetch('/api/v1/me/artifacts/' + encodeURIComponent(id), { credentials: 'include' });
			if (!r.ok) return;
			const j = await r.json();
			if (j?.data) setSelected(j.data as ArtifactFull);
		} catch { /* ignore */ } finally {
			setSelectedLoading(false);
		}
	}, []);

	const deleteOne = useCallback(async (id: string) => {
		if (!confirm('Delete this artifact?')) return;
		try {
			await fetch('/api/v1/me/artifacts/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' });
			if (selectedId === id) { setSelected(null); setSelectedId(null); }
			loadList();
		} catch { /* ignore */ }
	}, [loadList, selectedId]);

	const copyContent = useCallback(() => {
		if (!selected) return;
		try {
			navigator.clipboard.writeText(selected.content);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch { /* ignore */ }
	}, [selected]);

	const downloadOne = useCallback(() => {
		if (!selected) return;
		const ext = selected.kind === 'markdown' ? 'md'
			: selected.kind === 'json' ? 'json'
			: selected.kind === 'code' ? (selected.language || 'txt')
			: 'txt';
		const safeTitle = selected.title.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || selected.id;
		const blob = new Blob([selected.content], { type: 'text/plain' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `${safeTitle}.${ext}`;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			document.body.removeChild(a);
			URL.revokeObjectURL(a.href);
		}, 100);
	}, [selected]);

	// Open via the chat header icon + auto-open on save event.
	useEffect(() => {
		const onSaved = (ev: Event) => {
			loadList();
			const ce = ev as CustomEvent<{ id?: string }>;
			if (ce.detail?.id) { setOpen(true); loadOne(ce.detail.id); }
		};
		const onToggle = () => setOpen((v) => !v);
		window.addEventListener('studio:artifact-saved', onSaved as EventListener);
		window.addEventListener('studio:artifact-panel-toggle', onToggle);
		return () => {
			window.removeEventListener('studio:artifact-saved', onSaved as EventListener);
			window.removeEventListener('studio:artifact-panel-toggle', onToggle);
		};
	}, [loadList, loadOne]);

	// Refresh list when the popover opens.
	useEffect(() => { if (open) loadList(); }, [open, loadList]);

	const KindIcon = ({ k }: { k: ArtifactRow['kind'] }) => {
		switch (k) {
			case 'markdown': return <FileText className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />;
			case 'code':     return <Code2 className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />;
			case 'json':     return <FileJson className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />;
			default:         return <FileText className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />;
		}
	};

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				title={rows.length > 0 ? `Artifacts (${rows.length})` : 'Artifacts'}
				className={[
					'relative p-1.5 rounded-md transition-colors',
					open ? 'text-emerald-700 bg-emerald-50' : 'text-slate-400 hover:text-emerald-700 hover:bg-emerald-50',
				].join(' ')}
			>
				<Boxes className="w-3.5 h-3.5" />
				{rows.length > 0 && (
					<span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 rounded-full bg-emerald-500 text-white text-[8.5px] font-bold flex items-center justify-center ring-2 ring-white leading-none">
						{rows.length > 99 ? '99+' : rows.length}
					</span>
				)}
			</button>
			{open && (
				<div className="absolute top-full right-0 mt-1 z-50 w-[420px] max-h-[32rem] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">

					{/* Header strip */}
					<div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
						{selected ? (
							<button
								type="button"
								onClick={() => { setSelected(null); setSelectedId(null); }}
								className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
								title="Back to list"
							>
								<ArrowLeft className="w-3.5 h-3.5" />
							</button>
						) : (
							<Boxes className="w-4 h-4 text-emerald-600 flex-shrink-0" />
						)}
						<div className="flex-1 min-w-0">
							<div className="text-[12.5px] font-semibold text-slate-900 truncate">
								{selected ? selected.title : 'Artifacts'}
							</div>
							<div className="text-[10.5px] text-slate-500 truncate">
								{selected
									? `${selected.kind}${selected.language ? ' · ' + selected.language : ''} · ${selected.content.length} chars`
									: `${rows.length} saved`}
							</div>
						</div>
						{selected && (
							<div className="flex items-center gap-0.5">
								<button
									type="button"
									onClick={copyContent}
									title={copied ? 'Copied' : 'Copy'}
									className={[
										'p-1.5 rounded-md transition-colors',
										copied ? 'text-emerald-700 bg-emerald-50' : 'text-slate-400 hover:text-slate-800 hover:bg-slate-100',
									].join(' ')}
								>
									<Copy className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={downloadOne}
									title="Download"
									className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors"
								>
									<Download className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={() => deleteOne(selected.id)}
									title="Delete"
									className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
								>
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
						)}
					</div>

					{/* Body — list mode or detail mode */}
					<div className="flex-1 min-h-0 overflow-y-auto">
						{!selected && (
							<>
								{loading && (
									<div className="px-3 py-3 text-[11px] text-slate-400 flex items-center gap-1.5">
										<Loader2 className="w-3 h-3 animate-spin" /> Loading…
									</div>
								)}
								{!loading && rows.length === 0 && (
									<div className="px-3 py-4 text-[11.5px] text-slate-400 italic leading-snug">
										No artifacts yet. The agent saves long-form output here when you ask — research briefs, code listings, anything worth keeping.
									</div>
								)}
								{rows.map((r) => (
									<button
										key={r.id}
										type="button"
										onClick={() => loadOne(r.id)}
										className="w-full text-left px-3 py-1.5 border-b border-slate-50 last:border-b-0 hover:bg-slate-50 transition-colors"
									>
										<div className="flex items-center gap-1.5">
											<KindIcon k={r.kind} />
											<span className="text-[12.5px] font-medium text-slate-800 truncate flex-1">{r.title}</span>
											<span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
												{Math.round(r.bytes / 1024)}KB
											</span>
										</div>
										<div className="flex items-center gap-1 mt-0.5 text-[10px] text-slate-500">
											<span>{r.kind}</span>
											{r.language && <span>· {r.language}</span>}
											{r.source_tool && <span>· {r.source_tool}</span>}
											<span className="ml-auto">{relativeTime(r.created_at)}</span>
										</div>
									</button>
								))}
							</>
						)}
						{selectedLoading && (
							<div className="px-3 py-3 text-[11px] text-slate-400 flex items-center gap-1.5">
								<Loader2 className="w-3 h-3 animate-spin" /> Loading…
							</div>
						)}
						{selected && !selectedLoading && (
							<div className="px-3 py-2.5 text-[12.5px]">
								{selected.kind === 'markdown' ? (
									<ChatMarkdown>{selected.content}</ChatMarkdown>
								) : selected.kind === 'code' ? (
									<pre className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11.5px] overflow-x-auto">
										<code>{selected.content}</code>
									</pre>
								) : selected.kind === 'json' ? (
									<pre className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11.5px] overflow-x-auto">
										<code>{(() => { try { return JSON.stringify(JSON.parse(selected.content), null, 2); } catch { return selected.content; } })()}</code>
									</pre>
								) : (
									<div className="whitespace-pre-wrap break-words text-slate-700">{selected.content}</div>
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function relativeTime(iso: string): string {
	try {
		const d = new Date(iso).getTime();
		const diff = (Date.now() - d) / 1000;
		if (diff < 60) return 'now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		return `${Math.floor(diff / 86400)}d`;
	} catch { return iso.slice(0, 10); }
}

// mimeFromExt — best-effort fallback when the browser/OS doesn't tag
// the file (rare on modern browsers; happens with .docx on some
// Linux distros). Maps the lowercase filename to the canonical mime
// the server-side extractor expects.
function mimeFromExt(lowerName: string): string {
	if (lowerName.endsWith('.pdf'))  return 'application/pdf';
	if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	if (lowerName.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
	if (lowerName.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
	if (lowerName.endsWith('.rtf'))  return 'application/rtf';
	if (lowerName.endsWith('.odt'))  return 'application/vnd.oasis.opendocument.text';
	if (lowerName.endsWith('.ods'))  return 'application/vnd.oasis.opendocument.spreadsheet';
	if (lowerName.endsWith('.odp'))  return 'application/vnd.oasis.opendocument.presentation';
	if (lowerName.endsWith('.epub')) return 'application/epub+zip';
	return 'application/octet-stream';
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
