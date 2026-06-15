// Phase S6a — persistent chat sidebar.
//
// AI is the primary interface; the workspace area becomes the
// artifact panel. Lives inside StudioShell on every Studio page.
//
// Uses /me/agent/chat/stream (SSE — fetch + ReadableStream because
// EventSource can't POST). Conversation history persists in
// sessionStorage so navigating between Studio pages keeps context.

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

import { CONNECT_ROUTE } from './studio/starters';
import { ChevronRight, MessageSquarePlus, Send, Trash2, Loader2, Bot, User, Square, Globe, Telescope, Brain, ChevronDown, Paperclip, X, FileText, FileJson, Image as ImageIcon, Plus, Copy, RotateCcw, Mic, Volume2, Code2, Boxes, Download, ArrowLeft, Crosshair, Lock, Cpu } from 'lucide-react';
import {
	buildViewingContext,
	subscribeStudioPickedTarget,
	setStudioPickedTarget,
	getStudioPickedTarget,
	setStudioSelection,
	type StudioPickedTarget,
	type ViewingContext,
} from './StudioContext';
import { appTitle, prefetchAppLabels } from './workflow/AppCard';
import { me, type MeWorkflowRow } from '@/api/me';
import { summarizeAppState, chipsForApp, openerLine } from './chat/appOpener';
import { startStudioPicking, stopStudioPicking, isStudioPicking, subscribeStudioPicking } from './StudioPicker';
import { ChatMarkdown } from './ChatMarkdown';
import AssemblyCard from './workflow/AssemblyCard';
import type { Attachment, WireAttachment, Message, ToolCall } from './chat/types';
import { readChatStream, withLastAssistant } from './chat/protocol';
import ChatEmptyState, { ChatHero } from './chat/ChatEmptyState';
import { entityCardFor } from './chat/entityCards';
import AppSurfaceCard from './chat/AppSurfaceCard';

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

const STORAGE_KEY = 'studio_chat_transcript_v1';
const CHAT_ID_KEY = 'studio_chat_active_id_v1';
// Per-app "latest session" map { app: chatId } so re-entering an app resumes
// its most-recent conversation instead of dumping into whatever was open.
const APP_CHAT_MAP_KEY = 'studio_app_chat_v1';
// Reserved chat-context key for the Library, so it gets the SAME per-context
// resume + grounded-opener behavior as an app (its own thread, resumed on
// re-entry) rather than a one-off fresh chat. Not a real installed app.
export const LIBRARY_KEY = 'lumid-library';
function readAppChatMap(): Record<string, string> {
	try { return JSON.parse(localStorage.getItem(APP_CHAT_MAP_KEY) || '{}') || {}; }
	catch { return {}; }
}
function writeAppChat(app: string, chatId: string | null) {
	if (!app) return;
	try {
		const m = readAppChatMap();
		if (chatId) m[app] = chatId; else delete m[app];
		localStorage.setItem(APP_CHAT_MAP_KEY, JSON.stringify(m));
	} catch { /* ignore */ }
}
// Forget a chatId everywhere it could be resumed from (per-app resume map +
// the persisted active id), so a DELETED conversation can't reappear when you
// re-enter the app. Without this, the prop-driven grounding resumes the
// per-app thread on every entry — including one you just deleted.
function forgetChatId(id: string) {
	if (!id) return;
	try {
		const m = readAppChatMap();
		let changed = false;
		for (const k of Object.keys(m)) if (m[k] === id) { delete m[k]; changed = true; }
		if (changed) localStorage.setItem(APP_CHAT_MAP_KEY, JSON.stringify(m));
	} catch { /* ignore */ }
	try { if (localStorage.getItem(CHAT_ID_KEY) === id) localStorage.removeItem(CHAT_ID_KEY); } catch { /* ignore */ }
}

// Persisted transcript shape: { user_sub: string, messages: Message[] }.
// Tagging with user_sub closes the "same browser tab, different user"
// leak — signing out + in as someone else used to render the prior
// user's conversation. AuthProvider also clears the slot on logout;
// this guard is belt-and-suspenders for cookie expiry / cross-tab
// session swaps where logout() never runs. Mirrors chat-widget.tsx.
function loadTranscript(currentSub: string | null | undefined): Message[] {
	if (!currentSub) return [];
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		// Legacy shape (an unwrapped array) predates the guard — discard
		// rather than risk rendering it under the wrong identity.
		if (Array.isArray(parsed)) {
			sessionStorage.removeItem(STORAGE_KEY);
			return [];
		}
		if (parsed?.user_sub !== currentSub || !Array.isArray(parsed.messages)) {
			sessionStorage.removeItem(STORAGE_KEY);
			return [];
		}
		const msgs = parsed.messages as Message[];
		// Scrub tools left pending from a previous session (hard refresh
		// mid-stream) — no live stream will ever resolve them.
		return msgs.map((m) =>
			m.tools?.some((t) => t.pending)
				? { ...m, tools: m.tools.map((t) => t.pending ? { ...t, pending: false, ok: false } : t) }
				: m
		);
	} catch {
		return [];
	}
}
const COLLAPSE_KEY = 'studio_chat_collapsed_v1';
const WIDTH_KEY = 'studio_chat_width_v1';
const MODEL_KEY = 'studio_chat_model_v1';
// Slash command palette — shorthand prompts for common LumidOS operations.
// Typing "/" at the start of input triggers filtering on this list.
const SLASH_COMMANDS = [
	{ label: '/loops',                    template: 'List all scheduled loops.' },
	{ label: '/xp ask [query]',           template: 'Search my knowledge base: ' },
	{ label: '/xp status',               template: 'Show knowledge base status.' },
	{ label: '/app list',                 template: 'List installed xpio apps.' },
	{ label: '/app push [name]',          template: 'Push app ' },
	{ label: '/app validate [name]',      template: 'Validate app ' },
	{ label: '/run loop [name]',          template: 'Run loop ' },
	{ label: '/loop status [name]',       template: 'Show status for loop ' },
	{ label: '/loop history [name]',      template: 'Show loop history for ' },
	{ label: '/read [path]',              template: 'Read file ' },
	{ label: '/edit [path]',              template: 'Read and edit ' },
	{ label: '/bash [command]',           template: 'Run: ' },
	{ label: '/workers',                  template: 'List FlowMesh compute workers.' },
];

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

export function StudioChat({ docked = false, groundApp }: { docked?: boolean; groundApp?: string | null } = {}) {
	const location = useLocation();
	// `id` is the user_sub on the UserInfo shape from /api/v1/user; used
	// to tag the persisted transcript so it can't leak across accounts.
	const { user } = useAuth();
	const userSub = user?.id ?? null;
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
	const [messages, setMessages] = useState<Message[]>(() => loadTranscript(userSub));
	const [input, setInput] = useState('');
	const [slashSuggestions, setSlashSuggestions] = useState<{ label: string; template: string }[]>([]);
	const [slashIdx, setSlashIdx] = useState(0);
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
	// Synchronous in-flight latch. `streaming` is async state, so two rapid
	// dispatchTurn calls (queue processor microtask racing a manual send, or
	// StrictMode double-invoke) can both observe streaming===false and fire the
	// same turn twice. This ref flips synchronously inside dispatchTurn so the
	// second call is a no-op.
	const inFlightRef = useRef(false);
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
	// Claude CLI session backing this thread (claude-code providers).
	// Captured from the stream's claude_session event, echoed back as
	// claude_session_id on every turn so the backend resumes the same
	// CLI session (prior tool results + context carry over), and saved
	// into the chat record so reloads keep continuity. Ref, not state —
	// read at fetch time, never rendered.
	const claudeSessionRef = useRef<string | null>(null);
	const navigate = useNavigate();
	// App the active session is grounded on (Studio workspace slug). Drives
	// per-app session switching + tags saves so the picker can group/route by app.
	const currentAppRef = useRef<string | null>(null);
	// Last app whose opener was emitted into THIS session — dedupes the
	// stash+event double-fire and prevents re-opening on same-app re-entry.
	const openedAppRef = useRef<string | null>(null);
	// Recent threads for the history dropdown — populated lazily when
	// the user opens the menu; refreshed after every save.
	type HistoryRow = { id: string; title: string; updated_at: string; msg_count: number; app?: string };
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
	// Stick-to-bottom only when the user is ALREADY near the bottom. Once they
	// scroll up (e.g. to watch an inline AssemblyCard build itself), we stop
	// yanking them down on every stream delta. Updated by the transcript's
	// onScroll; seeded true so the first turn pins as expected.
	const atBottomRef = useRef(true);
	// Phase S6 polish — abort handle so the user can cut a runaway
	// stream short. Reset on every send/queueSend; set just before the
	// fetch; consumed by the Stop button.
	const abortRef = useRef<AbortController | null>(null);

	// If the auth context flips identity mid-tab (cookie refresh that
	// returned a different user, or a session swap), drop the in-memory
	// transcript before it can be rendered/persisted under the new user.
	useEffect(() => {
		setMessages((cur) => (cur.length === 0 ? cur : loadTranscript(userSub)));
	}, [userSub]);

	// Persist transcript tagged with the current user_sub. No identity →
	// no persistence (nothing to bind it to, so nothing can leak).
	useEffect(() => {
		if (!userSub) return;
		try {
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ user_sub: userSub, messages }));
		} catch { /* ignore */ }
	}, [messages, userSub]);
	// Persist collapse state across reloads.
	useEffect(() => {
		try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
	}, [collapsed]);

	// The workspace URL is the source of truth for which app a DOCKED session
	// belongs to (the docked chat only renders on an app page). We read it at
	// SAVE time for tagging — NOT into currentAppRef, because clobbering that
	// ref pre-empts openAppInChat's app-switch detection (it would see
	// "already on B" and skip switching the session). Kept fresh each render.
	const pathnameRef = useRef(location.pathname);
	pathnameRef.current = location.pathname;
	const workspaceApp = (): string | null => {
		if (!docked) return null;
		const m = pathnameRef.current.match(/^\/studio\/apps\/([^/?]+)/);
		return m && m[1] !== 'all' ? decodeURIComponent(m[1]) : null;
	};

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
		// Cancel any pending save FIRST. If the transcript was just reset
		// (delete / New chat → messages=[]), a previously-scheduled debounced
		// save would otherwise fire with the OLD closure messages and RESURRECT
		// the just-deleted conversation as a new chat (re-adding it to resume).
		if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
		if (streaming) return;
		if (messages.length < 2) return;
		const last = messages[messages.length - 1];
		if (last.role !== 'assistant' || !last.content) return;
		// Cheap signature so we don't re-POST when reordering UI bits.
		const sig = `${messages.length}:${last.content.length}:${(last.thinking||'').length}`;
		if (sig === lastSavedSigRef.current) return;

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
						claude_session_id: claudeSessionRef.current || undefined,
						app: (workspaceApp() || currentAppRef.current) || undefined,
					}),
				});
				if (!r.ok) return;
				const j = await r.json();
				const newId: string | undefined = j?.data?.id;
				if (newId && newId !== chatId) setChatId(newId);
				// Remember this as the app's latest session for resume-on-reentry.
				const tagApp = workspaceApp() || currentAppRef.current;
				if (newId && tagApp) writeAppChat(tagApp, newId);
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
	const loadThread = useCallback(async (id: string): Promise<string | null | false> => {
		try {
			const r = await fetch('/api/v1/me/chats/' + encodeURIComponent(id), { credentials: 'include' });
			if (!r.ok) return false;
			const j = await r.json();
			const rec = j?.data;
			if (!rec || !Array.isArray(rec.messages)) return false;
			setMessages(rec.messages);
			setChatId(rec.id);
			claudeSessionRef.current = rec.claude_session_id || null;
			const app = (rec.app as string) || null;
			currentAppRef.current = app;
			openedAppRef.current = app; // an app's loaded thread shouldn't re-fire its opener
			if (app) writeAppChat(app, rec.id);
			lastSavedSigRef.current = '';
			setHistoryOpen(false);
			return app;
		} catch { return false; }
	}, []);

	const newChat = useCallback(() => {
		if (streaming) return;
		setMessages([]);
		setChatId(null);
		claudeSessionRef.current = null;
		lastSavedSigRef.current = '';
		currentAppRef.current = null;   // generic new chat = home (app-less)
		openedAppRef.current = null;
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
			forgetChatId(id);          // never resume a deleted thread on re-entry
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
				// Adopt the server's default if model is empty or stale (no longer in list).
				if (!model || !list.find((m) => m.id === model)) {
					const def = list.find((m) => m.default) || list[0];
					if (def) setModel(def.id);
				}
			} catch { /* ignore */ }
		})();
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Auto-scroll on new content — but ONLY if the user is already pinned near
	// the bottom. If they've scrolled up (to read, or to watch an inline
	// workflow-assembly card animate), don't drag them back down on every
	// delta. That repeated yank is what made the assembly "jump".
	useEffect(() => {
		const el = transcriptRef.current;
		if (!el || !atBottomRef.current) return;
		el.scrollTop = el.scrollHeight;
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
	// {detail: {prompt: '…', autosend: true, context: {...}}}))` to pre-fill
	// or fire the chat. `context` (optional, Partial<ViewingContext>) lets
	// the dispatching surface override the derived page context — e.g. an
	// "ask about this step" button passes the exact cycle + step.
	//
	// Dispatches through a ref so the handler always calls the LATEST send
	// path — the old version captured the first render's closure (empty
	// deps), so autosent prompts ran against an empty history and wiped
	// the visible conversation.
	useEffect(() => {
		const onAsk = (e: Event) => {
			const ce = e as CustomEvent<{ prompt?: string; autosend?: boolean; context?: Partial<ViewingContext> }>;
			const p = String(ce.detail?.prompt || '').trim();
			if (!p) return;
			setCollapsed(false);
			if (ce.detail?.autosend) {
				setInput('');
				void dispatchTurnRef.current?.(p, [], undefined, ce.detail?.context);
			} else {
				setInput(p);
			}
		};
		window.addEventListener('studio:ask', onAsk as EventListener);
		return () => window.removeEventListener('studio:ask', onAsk as EventListener);
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

	// dispatchTurn — the ONE send path. Fires a chat turn with the given
	// text, staged attachments, optional history override (regenerate),
	// and optional ViewingContext override (studio:ask events). The old
	// split (queueSend vs dispatchTurn) handled route/usage events on one
	// path and dropped them on the other; unifying fixes that.
	const dispatchTurn = useCallback(async (
		text: string,
		stagedAttachments: Attachment[] = [],
		baseMessages?: Message[],
		ctxOverride?: Partial<ViewingContext>,
	) => {
		if (!text || streaming || inFlightRef.current) return;
		inFlightRef.current = true;
		const base = baseMessages ?? messages;
		const userMsg: Message = { role: 'user', content: text };
		// Structured "what the user is looking at" payload — replaces the
		// old prose preamble (which polluted the stored transcript and
		// re-sent stale page notes on every history replay). The backend
		// renders this into a per-request system block.
		const context = buildViewingContext(location.pathname, location.search, ctxOverride);
		const wireAttachments: WireAttachment[] = stagedAttachments.map((a) =>
			a.kind === 'image'
				? { kind: 'image', name: a.name, mime: a.mime, data_b64: a.dataB64 }
				: a.kind === 'document'
					? { kind: 'document', name: a.name, mime: a.mime, data_b64: a.dataB64 }
					: { kind: 'text', name: a.name, text: a.text }
		);
		const wireMessages = [
			...base.map((m) => ({ role: m.role, content: m.content })),
			wireAttachments.length > 0
				? { role: 'user' as const, content: text, attachments: wireAttachments }
				: { role: 'user' as const, content: text },
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
		// Retry once on a PRE-STREAM network error (server restart / blip): the
		// rapid-deploy / identity-restart window otherwise surfaced as a scary
		// "Couldn't reach the assistant" even though nothing had streamed yet.
		// `started` guards against retrying mid-stream (which would duplicate).
		try {
			for (let attempt = 0; ; attempt++) {
				let started = false;
				try {
					const r = await fetch('/api/v1/me/agent/chat/stream', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						credentials: 'include',
						body: JSON.stringify({
							messages: wireMessages,
							context,
							...(model ? { model } : {}),
							...(mode ? { mode } : {}),
							...(think ? { think: true } : {}),
							...(personaId ? { persona_id: personaId } : agentId ? { agent_id: agentId } : {}),
							...(claudeSessionRef.current ? { claude_session_id: claudeSessionRef.current } : {}),
						}),
						signal: ctrl.signal,
					});
					if (!r.ok || !r.body) {
						const errText = r.status === 401 ? 'Sign in to use chat' : `error ${r.status}`;
						setMessages((prev) => withLastAssistant(prev, (m) => ({ ...m, content: errText })));
						return;
					}
					started = true;
					await readChatStream(r, setMessages, {
						onClaudeSession: (id) => { claudeSessionRef.current = id; },
						onRoute: (modelUsed, autoRouted) => setLastRoute({ modelUsed, autoRouted }),
						onUsage: (used, limit) => setUsage({ used, limit }),
					});
					break; // success
				} catch (e: any) {
					if (e?.name === 'AbortError') throw e; // handled by outer catch
					const networkish = /network|failed to fetch|load failed/i.test(String(e?.message || e));
					if (!started && networkish && attempt < 1) {
						await new Promise((res) => setTimeout(res, 800));
						continue; // one quiet retry for a connection blip
					}
					throw e;
				}
			}
		} catch (e: any) {
			if (e?.name === 'AbortError') {
				setMessages((prev) => withLastAssistant(prev, (m) => ({
					...m,
					content: (m.content || '') + (m.content ? '\n\n_— stopped —_' : '_— stopped —_'),
				})));
			} else {
				const networkish = /network|failed to fetch|load failed/i.test(String(e?.message || e));
				const msg = networkish
					? '⚠️ Couldn’t reach the assistant — connection hiccup. Try again in a moment.'
					: `Couldn't reach the assistant: ${String(e).slice(0, 100)}`;
				setMessages((prev) => withLastAssistant(prev, (m) => ({ ...m, content: m.content || msg })));
			}
		} finally {
			inFlightRef.current = false;
			setStreaming(false);
			abortRef.current = null;
			// Clear any tools that received tool_start but no tool_call (stream
			// ended or errored before the result landed — leave them as failed).
			setMessages((prev) => withLastAssistant(prev, (m) => {
				if (!m.tools?.some((t) => t.pending)) return m;
				return { ...m, tools: m.tools.map((t) => t.pending ? { ...t, pending: false, ok: false } : t) };
			}));
		}
	}, [messages, streaming, location.pathname, location.search, model, mode, think, agentId, personaId]);

	// Latest-send-path ref for the studio:ask listener (registered once).
	const dispatchTurnRef = useRef<typeof dispatchTurn | null>(null);
	useEffect(() => { dispatchTurnRef.current = dispatchTurn; }, [dispatchTurn]);

	// openAppInChat — ground the chat on an app and open with an agent-led,
	// progressive opener: ONE deterministic live-state line (instant, no LLM
	// round-trip, no fake user turn) + 2–3 next-step chips. The conversation
	// goes LLM-driven the moment the user clicks a chip or types. NO surface
	// dump — the structured details live in the workspace's middle panel.
	// Emit the deterministic opener line + chips for `app` (appended to the
	// current — usually just-cleared — transcript). Marks the app as opened.
	const emitAppOpener = useCallback((app: string) => {
		openedAppRef.current = app;
		// Talk to THIS app's agents by default — drop any manual agent/persona
		// so the app context (sent with every turn) drives retrieval/routing.
		setAgentId(''); setPersonaId('');
		// Library context — no workflows; a marketplace/skills/experiments opener.
		if (app === LIBRARY_KEY) {
			setStudioSelection(null);
			setMessages((prev) => [...prev, {
				role: 'assistant',
				content: "Your **Library** — the marketplace, your skills, and experiments. What are you after?",
				chips: [
					{ label: 'find an app to install', prompt: 'What apps in the marketplace fit how I work? Recommend a few and say why.' },
					{ label: 'which skills need updating?', prompt: 'Do any of my installed skills have newer versions or are flagged broken?' },
					{ label: 'recent experiment results', prompt: 'Summarize my recent experiments — is there a winning variant worth adopting?' },
				],
			}]);
			return;
		}
		void Promise.all([
			prefetchAppLabels(),
			me.listWorkflows('scheduled').then((r) => r.workflows || []).catch(() => [] as MeWorkflowRow[]),
		]).then(([, rows]) => {
			setStudioSelection({ kind: 'app', id: app, label: appTitle(app), affordances: ['app_action', 'app_read', 'run_loop_now', 'list_loops'] });
			const st = summarizeAppState(app, rows);
			setMessages((prev) => [...prev, { role: 'assistant', content: openerLine(app, st), chips: chipsForApp(app, rows) }]);
		});
	}, []);
	// Clear the in-memory session (keeps currentAppRef binding).
	const clearSession = useCallback(() => {
		setMessages([]);
		setChatId(null);
		claudeSessionRef.current = null;
		lastSavedSigRef.current = '';
		try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
	}, []);

	const openAppInChat = useCallback((d: { app: string; surface?: string }) => {
		if (!d?.app) return;
		const app = d.app;
		// Already on this app's session (opener emitted) → nothing to do.
		if (openedAppRef.current === app && currentAppRef.current === app) return;
		if (inFlightRef.current) return; // don't yank the session mid-stream

		const wasApp = currentAppRef.current;
		currentAppRef.current = app;

		// Same app, session already present (e.g. opener not yet emitted on this
		// mount) — just emit the opener into the existing thread.
		if (wasApp === app) { emitAppOpener(app); return; }

		// Switching apps → resume this app's latest saved session if any, else
		// start a fresh session and emit the opener. Never append into the
		// previous app's / the home session.
		const saved = readAppChatMap()[app];
		if (saved) {
			void loadThread(saved).then((res) => {
				if (res === false) { writeAppChat(app, null); clearSession(); emitAppOpener(app); }
			});
		} else {
			clearSession();
			emitAppOpener(app);
		}
	}, [loadThread, emitAppOpener, clearSession]);

	// Deterministic grounding: the docked chat is driven by the `groundApp`
	// prop (the workspace's selected app), NOT by event/stash races — those
	// could leave the chat showing a stale app (e.g. open gpu-rentals, see
	// mbb-coach). Whenever the selected app changes, re-ground on it.
	useEffect(() => {
		if (docked && groundApp) openAppInChat({ app: groundApp });
	}, [docked, groundApp, openAppInChat]);

	// "New chat" — starts a fresh session. In an app context it stays bound to
	// the app (a NEW session for that app) and re-emits the opener; on the home
	// it's a plain empty chat. (Distinct from loadThread / resuming.)
	const newAppSession = useCallback(() => {
		if (inFlightRef.current) return;
		const app = currentAppRef.current;
		clearSession();
		setHistoryOpen(false);
		if (app) {
			writeAppChat(app, null); // don't auto-resume the old one
			openedAppRef.current = null;
			emitAppOpener(app);
		}
	}, [clearSession, emitAppOpener]);

	// Pick a thread from the session picker. Loads it and, if it belongs to a
	// DIFFERENT app than the workspace currently shows, switches the middle
	// panel to that app too (the session and the workspace stay in lockstep).
	const pickThread = useCallback((h: HistoryRow) => {
		setHistoryOpen(false);
		// Set the app binding synchronously so the studio:open-app fired by the
		// upcoming navigation early-returns instead of resuming the app default.
		currentAppRef.current = h.app || null;
		openedAppRef.current = h.app || null;
		void loadThread(h.id);
		if (h.app) navigate(`/studio/apps/${encodeURIComponent(h.app)}`);
	}, [loadThread, navigate]);

	// The chat mounts only at /studio now — asks fired elsewhere are
	// stashed by the shell (studio_pending_ask_v1) before navigating
	// here; the New-chat row stashes studio_new_chat_v1. Consume both
	// on mount; also honor live studio:new-chat events while mounted.
	useEffect(() => {
		try {
			if (sessionStorage.getItem('studio_new_chat_v1')) {
				sessionStorage.removeItem('studio_new_chat_v1');
				setMessages([]);
				setChatId(null);
				claudeSessionRef.current = null;
				currentAppRef.current = null;
				openedAppRef.current = null;
				// A stale app-open stash (written by the workspace before nav) would
				// otherwise re-ground this fresh chat with the app's opener — drop it.
				sessionStorage.removeItem(STORAGE_KEY);
				sessionStorage.removeItem('studio_open_app_v1');
			}
			const raw = sessionStorage.getItem('studio_pending_ask_v1');
			if (raw) {
				sessionStorage.removeItem('studio_pending_ask_v1');
				const detail = JSON.parse(raw);
				if (detail?.prompt) {
					setTimeout(() => {
						if (detail.autosend) void dispatchTurnRef.current?.(String(detail.prompt), [], undefined, detail.context);
						else setInput(String(detail.prompt));
					}, 50);
				}
			}
			// Open-app intent (stashed by the workspace when you enter an app):
			// ground the docked app chat with the opener. The HOME chat (!docked)
			// is app-less — it must never consume this, or a leftover stash would
			// re-ground it with a stale app opener after "New chat"/brand click.
			const openRaw = sessionStorage.getItem('studio_open_app_v1');
			if (openRaw) {
				if (docked) {
					sessionStorage.removeItem('studio_open_app_v1');
					openAppInChat(JSON.parse(openRaw));
				} else {
					// Home chat: discard a stray stash so it can't ground later.
					sessionStorage.removeItem('studio_open_app_v1');
				}
			}
		} catch { /* stale/invalid stash — ignore */ }
		const onNew = () => {
			setMessages([]);
			setChatId(null);
			claudeSessionRef.current = null;
			currentAppRef.current = null;
			openedAppRef.current = null;
			try {
				sessionStorage.removeItem(STORAGE_KEY);
				sessionStorage.removeItem('studio_new_chat_v1');
				sessionStorage.removeItem('studio_open_app_v1');
			} catch { /* ignore */ }
		};
		const onOpenApp = (e: Event) => {
			const d = (e as CustomEvent).detail;
			if (d?.app) openAppInChat(d);
		};
		window.addEventListener('studio:new-chat', onNew);
		window.addEventListener('studio:open-app', onOpenApp as EventListener);
		return () => {
			window.removeEventListener('studio:new-chat', onNew);
			window.removeEventListener('studio:open-app', onOpenApp as EventListener);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
		void dispatchTurn(userMsg.content, [], trimmed);
	}, [messages, streaming, dispatchTurn]);

	// Copy one message's content to the clipboard. Markdown is
	// preserved verbatim so paste into a doc-style editor keeps
	// formatting; readers that don't know markdown just see the raw
	// text. No toast — the assistant turn briefly flashes via title
	// state in MessageBubble.
	const copyMessage = useCallback((content: string) => {
		try { navigator.clipboard.writeText(content); } catch { /* ignore */ }
	}, []);

	const handleToolApprove = useCallback(async (approvalId: string, approved: boolean, always?: boolean, tool?: string) => {
		// Optimistically clear the approval state in the UI immediately.
		setMessages((prev) => prev.map((m) => ({
			...m,
			tools: m.tools?.map((t) =>
				t.approvalId === approvalId
					? { ...t, approvalRequired: false, approvalId: undefined }
					: t
			),
		})));
		try {
			await fetch('/api/v1/me/agent/chat/tool-approve', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					approval_id: approvalId,
					approved,
					...(always ? { always: true, tool: tool || '' } : {}),
				}),
			});
		} catch { /* stream will receive a timeout denial */ }
	}, []);


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

	// Delete the ACTIVE conversation for real — server record + every local
	// resume source (transcript, active-id, per-app map) — so it can't come
	// back on refresh or re-entry. (Was a view-only "clear" that left the
	// server thread + chatId behind, so a reload restored it.) Unsaved chats
	// (no id) just reset. In an app context, re-emit the fresh opener.
	const clear = useCallback(async () => {
		if (streaming) return;
		const id = chatId;
		const app = currentAppRef.current;
		if (id && !confirm('Delete this conversation?')) return;
		setMessages([]);
		setChatId(null);
		claudeSessionRef.current = null;
		lastSavedSigRef.current = '';
		openedAppRef.current = null;
		try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
		if (id) {
			forgetChatId(id);
			try { await fetch('/api/v1/me/chats/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' }); } catch { /* best-effort */ }
			loadHistory();
		}
		if (app) emitAppOpener(app);
	}, [streaming, chatId, loadHistory, emitAppOpener]);

	// Chat action icons render INTO the shell top bar (one aligned row with the
	// status pills) via this slot — so the chat column has no second header bar.
	const [stripSlot, setStripSlot] = useState<HTMLElement | null>(null);
	useEffect(() => { setStripSlot(document.getElementById('topstrip-app-slot')); }, []);

	// Group saved conversations by app for the picker — current app first, other
	// apps alphabetically, app-less ("General") last.
	const historyGroups = (() => {
		const byApp = new Map<string, HistoryRow[]>();
		for (const h of history) {
			const k = h.app || '';
			const arr = byApp.get(k);
			if (arr) arr.push(h); else byApp.set(k, [h]);
		}
		const cur = currentAppRef.current || '';
		const keys = [...byApp.keys()].sort((a, b) => {
			if (a === b) return 0;
			if (a === cur) return -1; if (b === cur) return 1;
			if (a === '') return 1; if (b === '') return -1;
			return appTitle(a).localeCompare(appTitle(b));
		});
		return keys.map((k) => ({ app: k, label: k ? appTitle(k) : 'General', rows: byApp.get(k)! }));
	})();

	// Chat chrome (context · artifacts · session picker · clear). Rendered into
	// the top strip on the home (!docked) and inline at the top of the docked
	// app chat — so the session picker is ALWAYS available (it had vanished in
	// docked mode). The picker groups by app and switches the workspace when a
	// session for another app is chosen.
	const chromeEl = (
		<div data-studio-picker-chrome="1" className="flex items-center gap-0.5">
			{/* Agent/persona picker removed — when an app is selected the chat
			    talks to THAT app's agents by default (app context drives the
			    routing; see emitAppOpener clearing any manual selection). */}
			<ArtifactIconButton align={docked ? 'right' : 'left'} />
			<div className="relative">
				<button
					onClick={() => { const next = !historyOpen; setHistoryOpen(next); if (next) loadHistory(); }}
					title="Conversations" aria-label="Conversations" aria-expanded={historyOpen}
					className={['p-1.5 rounded-md transition-colors', historyOpen ? 'text-gold-700 bg-gold-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted'].join(' ')}
				>
					<MessageSquarePlus className="w-3.5 h-3.5" />
				</button>
				{historyOpen && (
					<div className={['absolute top-full mt-1 z-50 w-72 max-h-96 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg shadow-foreground/5 p-1', docked ? 'right-0' : 'left-0'].join(' ')} onClick={(e) => e.stopPropagation()}>
						<button type="button" onClick={newAppSession}
							className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] text-foreground hover:bg-gold-50 hover:text-gold-800 transition-colors">
							<Plus className="w-3.5 h-3.5 text-gold-600" />
							<span className="font-medium">New chat{currentAppRef.current ? ` · ${appTitle(currentAppRef.current)}` : ''}</span>
						</button>
						<div className="h-px bg-muted my-1 mx-2" />
						{history.length === 0 && (
							<div className="px-2.5 py-1.5 text-[11px] text-muted-foreground italic">No saved conversations yet.</div>
						)}
						{historyGroups.map((g) => (
							<div key={g.app || '__general'} className="mb-0.5">
								<div className="px-2.5 pt-1.5 pb-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground truncate">
									{g.label}
								</div>
								{g.rows.map((h) => (
									<div key={h.id} className={['group flex items-center gap-1 px-1 py-0.5 rounded-lg transition-colors', h.id === chatId ? 'bg-gold-50/60' : 'hover:bg-muted/60'].join(' ')}>
										<button type="button" onClick={() => pickThread(h)} className="flex-1 min-w-0 text-left px-1.5 py-1">
											<div className="text-[12.5px] font-medium text-foreground truncate">{h.title}</div>
											<div className="text-[10px] text-muted-foreground flex items-center gap-1">
												<span>{h.msg_count} msg</span>
												<span>·</span>
												<span>{relativeTime(h.updated_at)}</span>
											</div>
										</button>
										<button type="button" onClick={() => deleteThread(h.id)} title="Delete"
											className="p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600 transition-all">
											<Trash2 className="w-3 h-3" />
										</button>
									</div>
								))}
							</div>
						))}
					</div>
				)}
			</div>
			{messages.length > 0 && (
				<button onClick={clear} title="Delete this conversation" aria-label="Delete this conversation"
					className="p-1.5 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors">
					<Trash2 className="w-3.5 h-3.5" />
				</button>
			)}
		</div>
	);

	// The chat IS the main surface now (claude.ai layout) — mounted as
	// the /studio route's page content, a centered column that fills the
	// area under the shell header. The old right-rail collapse/resize
	// chrome is gone; transcript scrolls internally, composer pins low.
	return (
		<div
			data-studio-picker-chrome="1"
			className={['relative z-20 flex flex-col flex-1 min-h-0 w-full', docked ? '' : 'max-w-[780px] mx-auto', messages.length === 0 && !docked ? 'justify-center' : ''].join(' ')}
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
			{/* Home: chrome renders into the shell top bar. Docked (app page):
			    chrome renders inline at the top of the chat column, so the session
			    picker is always available. */}
			{!docked && stripSlot && createPortal(chromeEl, stripSlot)}
			{docked && (
				<div className="flex items-center justify-end gap-0.5 px-2 pt-1.5 pb-1 flex-shrink-0">
					{chromeEl}
				</div>
			)}

			<div
				ref={transcriptRef}
				onScroll={(e) => {
					const el = e.currentTarget;
					// "near bottom" = within 80px of the end. Toggles whether new
					// content sticks to the bottom or leaves the user where they are.
					atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
				}}
				className={messages.length === 0
					? 'flex-none px-4 pb-4'
					: 'flex-1 overflow-y-auto px-4 py-4 scroll-smooth'}
			>
				{messages.length === 0 ? (
					// Empty state — the greeting hero sits above the composer. In the
					// docked (3-panel app) chat we DON'T print the "Good morning, …"
					// hero + spiral icon; the app opener already grounds the convo.
					!docked ? (
						<div className="max-w-[640px] mx-auto w-full">
							<EmptyHint />
						</div>
					) : null
				) : (
					<div className="space-y-3.5">
						{messages.map((m, i) => (
							<MessageBubble
							key={i}
							m={m}
							streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
							onCopy={m.role === 'assistant' && m.content ? () => copyMessage(m.content) : undefined}
							onRegenerate={m.role === 'assistant' && !streaming && i > 0 && messages[i - 1]?.role === 'user' ? () => regenerate(i) : undefined}
							onSpeak={m.role === 'assistant' && m.content && typeof window !== 'undefined' && 'speechSynthesis' in window ? () => toggleSpeak(i, m.content) : undefined}
							isSpeaking={speakingIdx === i}
							onToolApprove={handleToolApprove}
						/>
						))}
					</div>
				)}
			</div>

			<footer className="relative z-30 flex-shrink-0 px-4 pt-1 pb-4">
				<div className="w-full mx-auto max-w-[640px]">
				{/* Queued messages. Shows the FIFO list of turns waiting
				    for the current stream to finish. Each row is
				    clickable to remove from the queue. Hidden when empty. */}
				{messageQueue.length > 0 && (
					<div className="mb-2 px-0.5 flex flex-col gap-1">
						<div className="text-[10px] uppercase tracking-wider text-gold-700 font-semibold flex items-center gap-1">
							<span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse" />
							{messageQueue.length} message{messageQueue.length === 1 ? '' : 's'} queued
						</div>
						{messageQueue.map((q, i) => (
							<div
								key={i}
								className="flex items-center gap-1.5 text-[11px] bg-gold-50/70 border border-gold-200/60 rounded-lg px-2 py-1"
							>
								<span className="flex-1 truncate text-gold-900">{q.text}</span>
								{q.attachments.length > 0 && (
									<span className="text-[10px] text-gold-700 font-mono">+{q.attachments.length}</span>
								)}
								<button
									type="button"
									onClick={() => setMessageQueue((arr) => arr.filter((_, idx) => idx !== i))}
									className="text-gold-600 hover:text-rose-500 transition-colors"
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
								: 'inline-flex items-center gap-1.5 text-[11px] bg-gold-50 border border-gold-200 rounded-full pl-2 pr-1 py-0.5';
							const iconCls   = isFreeform ? 'w-3 h-3 text-sky-600 flex-shrink-0'      : 'w-3 h-3 text-gold-600 flex-shrink-0';
							const kindCls   = isFreeform ? 'text-sky-700 font-medium'                : 'text-gold-700 font-medium';
							const labelCls  = isFreeform ? 'text-sky-800 max-w-[260px] truncate'     : 'text-gold-800 max-w-[260px] truncate';
							const closeCls  = isFreeform ? 'text-sky-700/70 hover:text-rose-600 transition-colors flex-shrink-0' : 'text-gold-700/70 hover:text-rose-600 transition-colors flex-shrink-0';
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
								className="inline-flex items-center gap-1.5 text-[11px] bg-muted border border-border rounded-full pl-2 pr-1 py-0.5"
								title={`${a.name} · ${(a.sizeBytes / 1024).toFixed(1)} KB`}
							>
								{a.kind === 'image'
									? <ImageIcon className="w-3 h-3 text-sky-600" />
									: a.kind === 'document'
										? <FileText className="w-3 h-3 text-violet-600" />
										: <FileText className="w-3 h-3 text-muted-foreground" />}
								<span className="font-medium max-w-[120px] truncate">{a.name}</span>
								<span className="opacity-60">{Math.round(a.sizeBytes / 1024)}KB</span>
								<button
									type="button"
									onClick={() => removeAttachment(i)}
									className="text-muted-foreground hover:text-rose-500 transition-colors"
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
				{/* The composer card — one rounded white card (claude style):
				    chromeless textarea on top, then a bottom action row laid
				    out via flex order: ⊕ tools + ⌖ picker left, model picker
				    + stop + round black send right. */}
				<form
					onSubmit={(e) => { e.preventDefault(); send(); }}
					className={[
						'flex flex-wrap items-center gap-1 rounded-2xl border bg-card px-2.5 pt-2 pb-2 transition-all duration-150',
						// Elegant focus: a soft sage ring + lift, never a hard black
						// outline. (Was focus-within:border-foreground/25 — near-black.)
						dragOver
							? 'border-coral border-dashed ring-2 ring-coral/20'
							: 'border-border shadow-sm focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15 focus-within:shadow-md',
					].join(' ')}
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
					<div ref={toolsAnchorRef} className="relative flex-shrink-0 order-1">
						<button
							type="button"
							onClick={() => setToolsOpen((v) => !v)}
							disabled={streaming}
							title="Tools — Search / Deep research / Think"
							aria-label="Tools and options"
							aria-expanded={toolsOpen}
							aria-haspopup="menu"
							className={[
								'relative h-8 w-8 flex items-center justify-center rounded-full transition-all',
								toolsOpen
									? 'bg-foreground text-background'
									: activeToolCount > 0
										? 'text-gold-700 bg-gold-50 hover:bg-gold-100'
										: 'text-muted-foreground hover:text-foreground hover:bg-muted',
								streaming ? 'opacity-50 cursor-not-allowed' : '',
							].join(' ')}
						>
							<Plus className={['w-4 h-4 transition-transform', toolsOpen ? 'rotate-45' : ''].join(' ')} />
							{activeToolCount > 0 && !toolsOpen && (
								<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-gold-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white">
									{activeToolCount}
								</span>
							)}
						</button>
						{toolsOpen && (
							<div className="absolute bottom-full mb-2 left-0 z-50 min-w-[180px] p-1 rounded-xl border border-border bg-popover shadow-lg shadow-foreground/5">
								<button
									type="button"
									onClick={() => setMode(mode === 'search' ? '' : 'search')}
									className={[
										'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
										mode === 'search'
											? 'bg-sky-50 text-sky-700'
											: 'text-foreground hover:bg-muted/60',
									].join(' ')}
								>
									<Globe className={['w-3.5 h-3.5', mode === 'search' ? 'text-sky-600' : 'text-muted-foreground'].join(' ')} />
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
											: 'text-foreground hover:bg-muted/60',
									].join(' ')}
								>
									<Telescope className={['w-3.5 h-3.5', mode === 'deep_research' ? 'text-violet-600' : 'text-muted-foreground'].join(' ')} />
									<span className="font-medium flex-1 text-left">Deep research</span>
									{mode === 'deep_research' && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
								</button>
								<div className="h-px bg-muted my-1 mx-2" />
								<button
									type="button"
									onClick={() => setThink((v) => !v)}
									className={[
										'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
										think
											? 'bg-gold-50 text-gold-700'
											: 'text-foreground hover:bg-muted/60',
									].join(' ')}
								>
									<Brain className={['w-3.5 h-3.5', think ? 'text-gold-600' : 'text-muted-foreground'].join(' ')} />
									<span className="font-medium flex-1 text-left">Show thinking</span>
									{think && <span className="w-1.5 h-1.5 rounded-full bg-gold-500" />}
								</button>
								{/* Agent + Persona pickers moved to the header — they're
								    persistent context (sticky across turns), not per-turn
								    tool-forcing toggles. See the chip row beside the model
								    select in the header subtitle. */}
								<div className="h-px bg-muted my-1 mx-2" />
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] text-foreground hover:bg-muted/60 transition-colors"
								>
									<Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
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
												: 'text-foreground hover:bg-muted/60',
										].join(' ')}
									>
										<Mic className={['w-3.5 h-3.5', isListening ? 'text-rose-600' : 'text-muted-foreground'].join(' ')} />
										<span className="font-medium flex-1 text-left">
											{isListening ? 'Stop dictating' : 'Voice input'}
										</span>
										{isListening && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />}
									</button>
								)}
							</div>
						)}
					</div>
					<div className="order-first w-full relative group">
						<textarea
							aria-label="Message the assistant"
							value={input}
							onChange={(e) => {
								const v = e.target.value;
								setInput(v);
								if (v.startsWith('/')) {
									const q = v.toLowerCase();
									const matches = SLASH_COMMANDS.filter((c) => c.label.toLowerCase().startsWith(q));
									setSlashSuggestions(matches);
									setSlashIdx(0);
								} else {
									setSlashSuggestions([]);
								}
							}}
							onKeyDown={(e) => {
								// Slash command palette navigation
								if (slashSuggestions.length > 0) {
									if (e.key === 'ArrowDown') {
										e.preventDefault();
										setSlashIdx((i) => (i + 1) % slashSuggestions.length);
										return;
									}
									if (e.key === 'ArrowUp') {
										e.preventDefault();
										setSlashIdx((i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length);
										return;
									}
									if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
										e.preventDefault();
										const chosen = slashSuggestions[slashIdx];
										setInput(chosen.template);
										setSlashSuggestions([]);
										return;
									}
									if (e.key === 'Escape') {
										setSlashSuggestions([]);
										return;
									}
								}
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
							onPaste={(e) => {
								const items = e.clipboardData?.items;
								if (!items) return;
								const imageFiles: File[] = [];
								for (let i = 0; i < items.length; i++) {
									if (items[i].type.startsWith('image/')) {
										const f = items[i].getAsFile();
										if (f) imageFiles.push(f);
									}
								}
								if (imageFiles.length > 0) {
									e.preventDefault();
									const dt = new DataTransfer();
									imageFiles.forEach((f) => dt.items.add(f));
									onPickFiles(dt.files);
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
								'w-full px-2 pt-1.5 pb-1 text-[15px] leading-relaxed bg-transparent border-0 outline-none shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none resize-none max-h-48 transition-all',
								dragOver ? 'placeholder:text-coral' : 'placeholder:text-muted-foreground',
							].join(' ')}
							style={{ minHeight: '64px', outline: 'none', boxShadow: 'none' }}
						/>
						{slashSuggestions.length > 0 && (
							<div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
								{slashSuggestions.map((s, i) => (
									<button
										key={i}
										type="button"
										className={[
											'w-full text-left px-3 py-1.5 text-[12px] font-mono hover:bg-muted/60 transition-colors',
											i === 0 && i === slashSuggestions.length - 1 ? 'rounded-xl' : i === 0 ? 'rounded-t-xl' : i === slashSuggestions.length - 1 ? 'rounded-b-xl' : '',
											i === slashIdx ? 'bg-gold-50' : '',
										].join(' ')}
										onMouseDown={(e) => {
											e.preventDefault();
											setInput(s.template);
											setSlashSuggestions([]);
										}}
									>
										<span className="text-gold-700 font-semibold">{s.label}</span>
										{s.label !== s.template && (
											<span className="text-muted-foreground ml-2 truncate">{s.template.slice(s.label.length)}</span>
										)}
									</button>
								))}
							</div>
						)}
					</div>
					{streaming && (
						<button
							type="button"
							onClick={() => abortRef.current?.abort()}
							title="Stop current turn"
							aria-label="Stop generating"
							className="order-5 h-8 w-8 flex items-center justify-center rounded-full flex-shrink-0 bg-rose-500 text-white hover:bg-rose-600 active:scale-95 shadow-sm shadow-rose-200 transition-all"
						>
							<Square className="w-3 h-3 fill-current" />
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
						aria-label={picking ? 'Stop picking a UI element' : 'Pick a UI element on the page'}
						aria-pressed={picking}
						className={[
							'order-2 h-8 w-8 flex items-center justify-center rounded-full flex-shrink-0 transition-all active:scale-95',
							picking
								? 'bg-gold-50 text-gold-700 ring-1 ring-gold-300'
								: pickedTarget
									? 'text-gold-700 hover:bg-gold-50'
									: 'text-muted-foreground hover:text-foreground hover:bg-muted',
						].join(' ')}
					>
						<Crosshair className="w-4 h-4" />
					</button>
					{/* Right-side group: model picker (moved from the header)
					    then the round black send. */}
					<div className="order-3 flex-1 min-w-[8px]" />
					<div className="order-4 flex-shrink-0">
						<ModelChip
							streaming={streaming}
							models={models}
							model={model}
							setModel={setModel}
						/>
					</div>
					<button
						type="submit"
						disabled={!input.trim()}
						aria-label={streaming ? 'Queue message' : 'Send message'}
						title={streaming
							? `Queue this message (sends when current turn finishes)${messageQueue.length > 0 ? ` — ${messageQueue.length} already queued` : ''}`
							: 'Send'}
						className={[
							'order-6 relative h-8 w-8 flex items-center justify-center rounded-full transition-all flex-shrink-0',
							!input.trim()
								? 'bg-muted text-muted-foreground/50 cursor-not-allowed'
								: 'bg-primary text-primary-foreground hover:bg-primary/85 active:scale-95 shadow-sm',
						].join(' ')}
					>
						<Send className="w-3.5 h-3.5" />
						{messageQueue.length > 0 && (
							<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-gold-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white">
								{messageQueue.length}
							</span>
						)}
					</button>
				</form>
				{/* Suggestions + live digest sit BELOW the composer (claude.ai
				    style) so the greeting+box are the centered focal point and
				    nothing tall opens a gap above the box. */}
				{messages.length === 0 && (
					<div className="mt-3"><ChatEmptyState /></div>
				)}
				</div>
			</footer>
		</div>
	);
}

const MessageBubble = memo(function MessageBubble({
	m,
	streaming,
	onCopy,
	onRegenerate,
	onSpeak,
	isSpeaking,
	onToolApprove,
}: {
	m: Message;
	streaming?: boolean;
	onCopy?: () => void;
	onRegenerate?: () => void;
	onSpeak?: () => void;
	isSpeaking?: boolean;
	onToolApprove?: (approvalId: string, approved: boolean, always?: boolean, tool?: string) => void;
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
					: 'bg-gradient-to-br from-gold-400 to-gold-600 text-white shadow-gold-100',
			].join(' ')}>
				{isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
			</div>
			<div className={['min-w-0 flex-1', isUser ? 'text-right' : ''].join(' ')}>
				{!isUser && m.thinking !== undefined && (
					<ThinkingBlock thinking={m.thinking} done={!!m.thinkingDone} />
				)}
				{/* When this turn composed a workflow, the AssemblyCard is the
				    artifact and renders FIRST — above the text + tool chips.
				    Anything the agent streams afterwards grows BELOW it, so the
				    card stays anchored and the reveal doesn't get shoved around
				    (the "flipping" the user saw when text rendered above it). */}
				{!isUser && m.composed && <AssemblyCard draft={m.composed} />}
				{/* App surface inline — the app's page (stats/tables/forms) lives
				    in the conversation. Set by the open-app bridge + show_app_surface. */}
				{!isUser && m.appSurface && (
					<div className="mb-2"><AppSurfaceCard app={m.appSurface.app} surface={m.appSurface.surface} /></div>
				)}
				{/* Entity cards — observability tool results (apps, workflow
				    health, runs) render as inline cards with the same state
				    dots + deep links the old middle pane had, so "how are my
				    apps doing?" answers visually inside the conversation. */}
				{!isUser && m.tools && m.tools.map((t, i) => {
					const card = entityCardFor(t);
					return card ? <div key={`ec-${t.id || i}`} className="mb-2">{card}</div> : null;
				})}
				{/* Text bubble — skip entirely when there's nothing to show (an
				    empty bubble under a composed card reads as a stray box). */}
				{(m.content || (streaming && !m.composed)) && (
					<div className={[
						'inline-block max-w-full text-[13.5px] rounded-2xl px-3.5 py-2.5 leading-relaxed text-left shadow-sm',
						m.composed ? 'mt-2' : '',
						isUser
							? 'bg-primary text-primary-foreground rounded-tr-md'
							: 'bg-card text-foreground border border-border rounded-tl-md',
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
						) : (
							<span className="inline-flex gap-1 items-center">
								<span className="w-1.5 h-1.5 bg-gold-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
								<span className="w-1.5 h-1.5 bg-gold-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
								<span className="w-1.5 h-1.5 bg-gold-400 rounded-full animate-bounce" />
							</span>
						)}
					</div>
				)}
				{/* Agent-led opener chips — the top of a progressive drill-down.
				    Each fires a grounded studio:ask turn. */}
				{!isUser && !streaming && m.chips && m.chips.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{m.chips.map((c) => (
							<button key={c.label}
								onClick={() => window.dispatchEvent(new CustomEvent('studio:ask', { detail: { prompt: c.prompt, autosend: true, context: c.context } }))}
								className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
								{c.label}
							</button>
						))}
					</div>
				)}
				{!isUser && !streaming && m.content && connectHintFor(m.content) && (
					<div className="mt-1.5">
						<Link
							to={CONNECT_ROUTE[connectHintFor(m.content)!]}
							className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gold-300 bg-gold-50 text-gold-800 text-[12px] hover:bg-gold-100 transition-colors"
						>
							<Lock className="w-3.5 h-3.5" />
							Connect {connectHintFor(m.content) === 'google' ? 'Google' : 'Microsoft'} to continue
						</Link>
					</div>
				)}
				{m.tools && m.tools.length > 0 && (
					<div className={['mt-2 flex flex-col gap-1', isUser ? 'items-end' : 'items-start'].join(' ')}>
						{m.tools.map((t, i) => (
							<ToolChip
								key={i}
								t={t}
								onApprove={t.approvalRequired && t.approvalId && onToolApprove
									? (approved, always) => onToolApprove(t.approvalId!, approved, always, t.name)
									: undefined}
							/>
						))}
					</div>
				)}
				{!isUser && m.content && !streaming && (
					<div
						className="mt-0.5 text-[10px] text-muted-foreground tabular-nums"
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
										? 'text-gold-700 bg-gold-50'
										: 'text-muted-foreground hover:text-foreground hover:bg-muted',
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
								className="p-1 rounded text-[10px] text-muted-foreground hover:text-gold-700 hover:bg-gold-50"
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
										: 'text-muted-foreground hover:text-sky-700 hover:bg-sky-50',
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
}, (a, b) =>
	// Skip re-render unless the MESSAGE changed. The call site passes fresh
	// inline callbacks every render, so default memo never holds; compare only
	// meaningful fields. Stops every keystroke/poll from re-parsing the whole
	// transcript — the cause of the "fast at first, slower and slower" lag.
	a.m.role === b.m.role &&
	a.m.content === b.m.content &&
	a.m.tools === b.m.tools &&
	a.m.composed === b.m.composed &&
	a.m.appSurface === b.m.appSurface &&
	a.m.chips === b.m.chips &&
	a.streaming === b.streaming &&
	a.isSpeaking === b.isSpeaking)

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
				className="inline-flex items-center gap-1 text-[11px] text-gold-700 bg-gold-50/80 hover:bg-gold-100/80 border border-gold-200 rounded-full px-2 py-0.5 transition-colors"
			>
				<Brain className="w-3 h-3" />
				<span>{label}</span>
				<ChevronDown
					className={['w-3 h-3 transition-transform', open ? 'rotate-180' : ''].join(' ')}
				/>
			</button>
			{open && (
				<div className="mt-1.5 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground bg-gold-50/40 border border-gold-100 rounded-xl whitespace-pre-wrap break-words">
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
// tool_call event lands. Destructive tools show Allow/Deny buttons when
// approvalRequired=true.
function ToolChip({ t, onApprove }: { t: ToolCall; onApprove?: (approved: boolean, always?: boolean) => void }) {
	const [argsOpen, setArgsOpen] = useState(false);
	const Icon =
		t.name === 'web_search' ? Globe
		: t.name === 'deep_research' ? Telescope
		: t.name === 'web_fetch' ? Globe
		: t.name === 'bash_exec' ? Code2
		: t.name === 'read_file' || t.name === 'write_file' || t.name === 'edit_file' ? FileText
		: t.name.startsWith('xp_') ? Brain
		: t.name.startsWith('app_') || t.name === 'list_loops' || t.name === 'run_loop' ? Boxes
		: null;
	const hasArgs = t.args && Object.keys(t.args).length > 0;
	return (
		<div className="flex flex-col gap-0.5 max-w-full">
			<div className="inline-flex items-center gap-1.5 flex-wrap">
				<div className={[
					'text-[11px] inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border max-w-full',
					t.approvalRequired
						? 'bg-gold-50/80 border-gold-300 text-gold-900'
						: t.pending
							? 'bg-sky-50/80 border-sky-200 text-sky-800'
							: t.ok
								? 'bg-gold-50/80 border-gold-200 text-gold-800'
								: 'bg-rose-50/80 border-rose-200 text-rose-800',
				].join(' ')}>
					{t.approvalRequired
						? <span className="text-[10px]">⚠</span>
						: t.pending
							? <Loader2 className="w-3 h-3 animate-spin" />
							: Icon
								? <Icon className="w-3 h-3" />
								: <span className="text-[10px]">{t.ok ? '✓' : '✗'}</span>}
					<span className="font-mono font-medium">{t.name}</span>
					{t.summary && <span className="opacity-70 truncate max-w-[180px]">· {t.summary}</span>}
					{hasArgs && !t.approvalRequired && !t.pending && (
						<button
							onClick={() => setArgsOpen(!argsOpen)}
							className="opacity-50 hover:opacity-100 transition-opacity"
							title="Toggle args"
						>
							<ChevronDown className={['w-3 h-3 transition-transform', argsOpen ? 'rotate-180' : ''].join(' ')} />
						</button>
					)}
				</div>
				{t.link && (
					<Link
						to={t.link.to}
						className="text-[11px] inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-popover border border-gold-300 text-gold-700 hover:bg-gold-50 transition-colors"
					>
						{t.link.label} →
					</Link>
				)}
				{t.approvalRequired && onApprove && (
					<>
						<button
							onClick={() => onApprove(true)}
							className="text-[11px] px-2 py-0.5 rounded-full bg-gold-600 text-white hover:bg-gold-700 transition-colors font-medium"
						>
							Allow
						</button>
						<button
							onClick={() => onApprove(true, true)}
							title={`Always allow ${t.name} without asking (revoke later in settings)`}
							className="text-[11px] px-2 py-0.5 rounded-full bg-gold-50 border border-gold-300 text-gold-700 hover:bg-gold-100 transition-colors font-medium"
						>
							Always
						</button>
						<button
							onClick={() => onApprove(false)}
							className="text-[11px] px-2 py-0.5 rounded-full bg-popover border border-border text-foreground hover:bg-muted/60 transition-colors"
						>
							Deny
						</button>
					</>
				)}
			</div>
			{/* Args JSON — shown on demand after a completed tool call */}
			{argsOpen && hasArgs && (
				<div className="ml-5 mt-0.5 p-2 rounded-md bg-muted/60 border border-border text-[10px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
					{JSON.stringify(t.args, null, 2)}
				</div>
			)}
			{/* Args shown inline when approval is required (user needs to see what will run) */}
			{t.approvalRequired && hasArgs && (
				<div className="ml-5 mt-0.5 p-2 rounded-md bg-gold-50 border border-gold-200 text-[10px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
					{JSON.stringify(t.args, null, 2)}
				</div>
			)}
			{t.resultSummary && !t.pending && (
				<div className="text-[10px] text-muted-foreground pl-5 truncate max-w-[280px]">
					{t.resultSummary}
				</div>
			)}
		</div>
	);
}

// connectHintFor scans assistant text for a missing-integration signal and
// returns which provider to offer a Connect button for, or null. Drives the
// failed-compose recovery affordance.
function connectHintFor(text: string): ('google' | 'microsoft') | null {
	const t = text.toLowerCase();
	const needsConnect = /\b(not connected|isn['’]?t connected|connect your|need(s)? (you to )?(connect|to connect)|no .* grant|haven['’]?t connected|requires? .* access)\b/.test(t);
	if (!needsConnect) return null;
	if (/\b(google|gmail|calendar)\b/.test(t)) return 'google';
	if (/\b(microsoft|outlook|office\s?365|graph)\b/.test(t)) return 'microsoft';
	return null;
}

// EmptyHint — the greeting block above the composer (claude home).
// The digest + prompt pills render separately BELOW the composer —
// see the ChatEmptyState block after the footer.
function EmptyHint() {
	return <ChatHero />;
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
	if (id === 'claude-code-opus') return 'Opus';
	if (id === 'claude-code-sonnet') return 'Sonnet';
	if (id === 'kvrun-gemma4') return 'Gemma4';
	if (id === 'kvrun-minimax') return 'MiniMax';
	if (id === 'claude-haiku') return 'Haiku';
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
					'inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full border text-[11px] transition-colors',
					open
						? 'bg-muted border-foreground/25 text-foreground'
						: 'bg-card border-border text-foreground/70 hover:text-foreground hover:border-foreground/25',
					streaming ? 'opacity-50 cursor-not-allowed' : '',
				].join(' ')}
				title="Choose the AI model"
			>
				<Cpu className="w-3 h-3 flex-shrink-0 opacity-70" />
				<span className="truncate max-w-[120px]">{current ? modelShortLabel(current.id) : (model || 'Model')}</span>
				<ChevronDown className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
			</button>
			{open && (
				<div className="absolute bottom-full right-0 mb-1 z-50 min-w-[180px] p-1 rounded-xl border border-border bg-card shadow-lg shadow-foreground/5">
					{models.map((m) => (
						<button
							key={m.id}
							type="button"
							onClick={() => { setModel(m.id); setOpen(false); }}
							className={[
								'w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors',
								m.id === model ? 'bg-gold-50 text-gold-800' : 'text-foreground hover:bg-muted/60',
							].join(' ')}
						>
							<Bot className={['w-3 h-3', m.id === model ? 'text-gold-600' : 'text-muted-foreground'].join(' ')} />
							<span className="font-medium flex-1">{m.display_name}</span>
							{m.id === model && <span className="w-1.5 h-1.5 rounded-full bg-gold-500" />}
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
				? 'text-foreground bg-muted'
				: 'text-muted-foreground hover:text-foreground hover:bg-muted';
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
				<div className="absolute top-full right-0 mt-1 z-50 w-[320px] max-h-[30rem] overflow-y-auto rounded-xl border border-border bg-popover shadow-xl shadow-foreground/10">

					{/* ── Active strip ── shows current selection +
					    one-click clear. Always visible (rendered as
					    neutral when nothing's active). */}
					<div className={[
						'flex items-center gap-2 px-3 py-2 border-b',
						activeKind === 'agent'   ? 'bg-violet-50/70  border-violet-100'  :
						activeKind === 'persona' ? 'bg-fuchsia-50/70 border-fuchsia-100' :
						                           'bg-muted/60      border-border/60',
					].join(' ')}>
						<div className={[
							'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
							activeKind === 'agent'   ? 'bg-violet-100  text-violet-700'  :
							activeKind === 'persona' ? 'bg-fuchsia-100 text-fuchsia-700' :
							                           'bg-popover border border-border text-muted-foreground',
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
								                           'text-foreground',
							].join(' ')}>
								{currentAgent
									? (currentAgent.role || currentAgent.id)
									: currentPersona
										? currentPersona.name
										: 'Default — chat as you'}
							</div>
							<div className="text-[10.5px] text-muted-foreground truncate">
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
								className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-popover/80 transition-colors"
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
									<span className="text-[10px] text-muted-foreground">grounds chat in agent's bank</span>
								</div>
								{agentGroups.map((g) => (
									<div key={g.label} className="mb-1">
										<div className="px-2.5 pt-1 pb-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground">
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
														selected ? 'bg-violet-50' : 'hover:bg-muted/60',
													].join(' ')}
												>
													<span className={[
														'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5',
														selected
															? 'bg-violet-200 text-violet-800'
															: 'bg-muted text-muted-foreground',
													].join(' ')}>{initial}</span>
													<div className="flex-1 min-w-0">
														<div className="flex items-center gap-1.5">
															<span className={[
																'text-[12px] font-medium truncate',
																selected ? 'text-violet-900' : 'text-foreground',
															].join(' ')}>
																{a.role || a.id}
															</span>
															<span className={[
																'ml-auto text-[9.5px] font-mono px-1.5 py-px rounded-full flex-shrink-0',
																selected
																	? 'bg-violet-100 text-violet-700'
																	: 'bg-muted text-muted-foreground',
															].join(' ')}>{a.row_count}</span>
														</div>
														{a.description && (
															<div className="text-[10.5px] text-muted-foreground leading-snug line-clamp-2 mt-0.5">
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
								{agents.length > 0 && <div className="h-px bg-muted my-1 mx-2" />}
								<div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
									<span className="w-0.5 h-3 rounded-full bg-fuchsia-500" />
									<span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-fuchsia-700">Persona</span>
									<span className="text-[10px] text-muted-foreground">custom prompt + tool subset</span>
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
												selected ? 'bg-fuchsia-50' : 'hover:bg-muted/60',
											].join(' ')}
										>
											<span className={[
												'w-6 h-6 rounded-full flex items-center justify-center text-[14px] leading-none flex-shrink-0',
												selected
													? 'bg-fuchsia-200'
													: 'bg-muted',
											].join(' ')}>{p.icon || '🎭'}</span>
											<span className={[
												'text-[12px] font-medium flex-1 truncate',
												selected ? 'text-fuchsia-900' : 'text-foreground',
											].join(' ')}>{p.name}</span>
											{restricted && (
												<span
													className={[
														'text-[9px] px-1.5 py-px rounded-full flex-shrink-0',
														selected
															? 'bg-fuchsia-100 text-fuchsia-700'
															: 'bg-muted text-muted-foreground',
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
							<div className="px-2.5 py-2 mt-1 border-t border-border/60 text-[10.5px] text-muted-foreground leading-snug">
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

function ArtifactIconButton({ align = 'right' }: { align?: 'left' | 'right' }) {
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
			case 'markdown': return <FileText className="w-3.5 h-3.5 text-gold-600 flex-shrink-0" />;
			case 'code':     return <Code2 className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />;
			case 'json':     return <FileJson className="w-3.5 h-3.5 text-gold-600 flex-shrink-0" />;
			default:         return <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />;
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
					open ? 'text-gold-700 bg-gold-50' : 'text-muted-foreground hover:text-gold-700 hover:bg-gold-50',
				].join(' ')}
			>
				<Boxes className="w-3.5 h-3.5" />
				{rows.length > 0 && (
					<span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 rounded-full bg-gold-500 text-white text-[8.5px] font-bold flex items-center justify-center ring-2 ring-white leading-none">
						{rows.length > 99 ? '99+' : rows.length}
					</span>
				)}
			</button>
			{open && (
				<div className={['absolute top-full mt-1 z-50 w-[420px] max-h-[32rem] flex flex-col rounded-xl border border-border bg-popover shadow-xl shadow-foreground/10', align === 'left' ? 'left-0' : 'right-0'].join(' ')}>

					{/* Header strip */}
					<div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
						{selected ? (
							<button
								type="button"
								onClick={() => { setSelected(null); setSelectedId(null); }}
								className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
								title="Back to list"
							>
								<ArrowLeft className="w-3.5 h-3.5" />
							</button>
						) : (
							<Boxes className="w-4 h-4 text-gold-600 flex-shrink-0" />
						)}
						<div className="flex-1 min-w-0">
							<div className="text-[12.5px] font-semibold text-foreground truncate">
								{selected ? selected.title : 'Artifacts'}
							</div>
							<div className="text-[10.5px] text-muted-foreground truncate">
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
										copied ? 'text-gold-700 bg-gold-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
									].join(' ')}
								>
									<Copy className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={downloadOne}
									title="Download"
									className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
								>
									<Download className="w-3.5 h-3.5" />
								</button>
								<button
									type="button"
									onClick={() => deleteOne(selected.id)}
									title="Delete"
									className="p-1.5 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors"
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
									<div className="px-3 py-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
										<Loader2 className="w-3 h-3 animate-spin" /> Loading…
									</div>
								)}
								{!loading && rows.length === 0 && (
									<div className="px-3 py-4 text-[11.5px] text-muted-foreground italic leading-snug">
										No artifacts yet. The agent saves long-form output here when you ask — research briefs, code listings, anything worth keeping.
									</div>
								)}
								{rows.map((r) => (
									<button
										key={r.id}
										type="button"
										onClick={() => loadOne(r.id)}
										className="w-full text-left px-3 py-1.5 border-b border-border/40 last:border-b-0 hover:bg-muted/60 transition-colors"
									>
										<div className="flex items-center gap-1.5">
											<KindIcon k={r.kind} />
											<span className="text-[12.5px] font-medium text-foreground truncate flex-1">{r.title}</span>
											<span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
												{Math.round(r.bytes / 1024)}KB
											</span>
										</div>
										<div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
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
							<div className="px-3 py-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
								<Loader2 className="w-3 h-3 animate-spin" /> Loading…
							</div>
						)}
						{selected && !selectedLoading && (
							<div className="px-3 py-2.5 text-[12.5px]">
								{selected.kind === 'markdown' ? (
									<ChatMarkdown>{selected.content}</ChatMarkdown>
								) : selected.kind === 'code' ? (
									<pre className="bg-muted/60 border border-border rounded-lg p-2 text-[11.5px] overflow-x-auto">
										<code>{selected.content}</code>
									</pre>
								) : selected.kind === 'json' ? (
									<pre className="bg-muted/60 border border-border rounded-lg p-2 text-[11.5px] overflow-x-auto">
										<code>{(() => { try { return JSON.stringify(JSON.parse(selected.content), null, 2); } catch { return selected.content; } })()}</code>
									</pre>
								) : (
									<div className="whitespace-pre-wrap break-words text-foreground">{selected.content}</div>
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

export default StudioChat;
