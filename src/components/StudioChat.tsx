// Phase S6a — persistent chat sidebar.
//
// AI is the primary interface; the workspace area becomes the
// artifact panel. Lives inside StudioShell on every Studio page.
//
// Uses /me/agent/chat/stream (SSE — fetch + ReadableStream because
// EventSource can't POST). Conversation history persists in
// sessionStorage so navigating between Studio pages keeps context.

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

import { CONNECT_ROUTE } from './studio/starters';
import { ThumbsDown, ChevronRight, MessageSquarePlus, Send, Trash2, Loader2, Bot, User, Square, Globe, Telescope, Brain, ChevronDown, Paperclip, X, FileText, FileJson, Image as ImageIcon, Plus, Copy, RotateCcw, Mic, Volume2, Code2, Boxes, Download, ArrowLeft, Crosshair, Lock, Cpu, Maximize2, Minimize2, AlertTriangle , GraduationCap } from 'lucide-react';
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
import { toast } from 'sonner';
import { summarizeAppState, chipsForApp, openerLine } from './chat/appOpener';
import { ChatMarkdown } from './ChatMarkdown';
import { ArtifactView, ArtifactKindIcon, artifactDownload, type ArtifactKind } from './ArtifactView';
import { ArtifactIconButton } from './ArtifactIconButton';
import { useClickOutside } from '@/hooks/useClickOutside';
import AssemblyCard from './workflow/AssemblyCard';
import type { Attachment, WireAttachment, Message, ToolCall, Block } from './chat/types';
import { readChatStream, withLastAssistant } from './chat/protocol';
import { claudeToolView, QuietToolPill } from './chat/toolViews';
import { blocksOf, failPendingTools, clearApproval, stripForPersist } from './chat/blocks';
import { BlockView, EntityCardBlock } from './chat/blockViews';
import { Appear, Collapse, StreamCaret, JumpToLatest, ThinkingDots, Working, useMotionOK, AnimatePresence } from './chat/motion';
import { TurnStatsFooter, type TurnStats } from './claude/TurnStats';
import { SessionStrip } from './claude/SessionStrip';
import { useViewMode } from './ViewModeProvider';
import { fetchCycleConversation, type CycleLogRow } from '@/api/trajectory';

// Map a running/finished cycle's session timeline (LLM turns + stage/tool
// events) onto the chat's own Message model, so the existing MessageBubble
// renders it natively — an LLM turn becomes an assistant bubble (response as
// content, prompt as collapsible reasoning); runs of stage events become one
// bubble carrying tool cards.
function sessionRowsToMessages(rows: CycleLogRow[]): Message[] {
	const out: Message[] = [];
	let tools: ToolCall[] = [];
	const flush = () => { if (tools.length) { out.push({ role: 'assistant', content: '', tools }); tools = []; } };
	for (const r of rows) {
		if (r.event === 'llm') {
			flush();
			// Response = the AI generation (bubble content); prompt = the
			// collapsible "thinking" block, reusing MessageBubble's existing UI.
			out.push({ role: 'assistant', content: r.response || '_…generating…_', thinking: r.prompt || undefined, thinkingDone: true });
		} else {
			const failed = r.status === 'fail' || r.status === 'failed';
			tools.push({
				name: `${r.stage || r.event || 'step'}${r.status ? ' · ' + r.status : ''}`,
				ok: !failed,
				resultSummary: String(r.variant_id || r.note || ''),
			});
		}
	}
	flush();
	return out;
}
import { ChatHero } from './chat/ChatEmptyState';
import { StudioWorkflowPanel } from './StudioWorkflowPanel';
import { Workflow as WorkflowIcon } from 'lucide-react';
// Parse an AI turn's raw output into something readable: tenant cycles emit
// machine JSON (often a single unformatted line), sometimes inside a ```json
// fence or after a thinking preamble. Pull the JSON out and pretty-print it;
// otherwise treat it as prose/markdown.
function parseTurn(resp: string): { kind: 'json' | 'md'; text: string; summary: string } {
	const raw = resp.trim();
	// Strip a ```json … ``` (or bare ```) fence if the whole thing is fenced.
	let body = raw;
	const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	if (fence) body = fence[1].trim();
	// Find the outermost {...} or [...] span and try to parse it.
	const first = body.search(/[[{]/);
	const last = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
	if (first >= 0 && last > first) {
		const candidate = body.slice(first, last + 1);
		try {
			const obj = JSON.parse(candidate);
			if (obj && typeof obj === 'object') {
				const keys = Array.isArray(obj) ? `${obj.length} items` : Object.keys(obj).slice(0, 4).join(', ');
				return { kind: 'json', text: JSON.stringify(obj, null, 2), summary: keys };
			}
		} catch { /* not valid JSON — fall through to prose */ }
	}
	return { kind: 'md', text: raw, summary: raw.replace(/\s+/g, ' ').slice(0, 120) };
}

// A single AI turn in the session transcript — collapsible so a long run's
// earlier turns fold away (the response is the full, un-clipped generation).
function SessionLlmTurn({ r, defaultOpen }: { r: CycleLogRow; defaultOpen: boolean }) {
	const [open, setOpen] = useState(defaultOpen);
	const [thinkOpen, setThinkOpen] = useState(false);
	const respRaw = String(r.response || '');
	// While a turn streams, the text is incomplete (often half a JSON) — render
	// it raw + progressive with a live cursor; only pretty-parse the final text.
	const streaming = r.partial === true;
	// JSON answers stream their reasoning first, then burst the JSON — show the
	// thinking meanwhile so the box doesn't look frozen.
	const thinking = String(r.thinking || '');
	const showThinking = streaming && !respRaw.trim() && !!thinking.trim();
	// Finished turn that captured reasoning → offer it as a collapsible block.
	const finishedThinking = !streaming && !!thinking.trim();
	const resp = streaming ? (respRaw.trim() ? respRaw : (thinking || '…')) : String(r.response || '…');
	const parsed = streaming ? { kind: 'md' as const, text: resp, summary: (showThinking ? 'thinking… ' : '') + resp.replace(/\s+/g, ' ').slice(0, 120) } : parseTurn(resp);
	return (
		<div className={['rounded-lg border overflow-hidden', streaming ? 'border-sky-300/70 bg-sky-50/40' : 'border-violet-200/60 bg-violet-50/40'].join(' ')}>
			<button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-violet-100/50 transition-colors">
				<ChevronRight className={['w-3 h-3 text-violet-400 flex-shrink-0 transition-transform', open ? 'rotate-90' : ''].join(' ')} />
				<Bot className={['w-3.5 h-3.5 flex-shrink-0', streaming ? 'text-sky-500' : 'text-violet-500'].join(' ')} />
				<span className={['text-[11px] font-semibold flex-shrink-0', streaming ? 'text-sky-700' : 'text-violet-700'].join(' ')}>{r.model || 'ai'}</span>
				{streaming ? <span className="text-[9px] font-medium uppercase tracking-wide text-sky-400 flex-shrink-0 animate-pulse">{showThinking ? 'thinking' : 'streaming'}</span> : parsed.kind === 'json' && <span className="text-[9px] font-medium uppercase tracking-wide text-violet-400 flex-shrink-0">json</span>}
				{!open && <span className="text-[11px] text-slate-400 truncate">{parsed.summary}</span>}
			</button>
			{open && (
				<>
					{finishedThinking && (
						<div className="px-2.5 pt-1">
							<button type="button" onClick={() => setThinkOpen((v) => !v)} className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-600 transition-colors">
								<ChevronRight className={['w-2.5 h-2.5 transition-transform', thinkOpen ? 'rotate-90' : ''].join(' ')} /> thinking
							</button>
							{thinkOpen && <div className="mt-1 text-[11px] text-slate-400 italic whitespace-pre-wrap break-words border-l-2 border-slate-200 pl-2">{thinking}</div>}
						</div>
					)}
					{streaming ? (
						<div className={['px-2.5 pb-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words font-mono', showThinking ? 'text-slate-400 italic' : 'text-slate-700'].join(' ')}>{resp}<span className="inline-block w-1.5 h-3.5 -mb-0.5 ml-0.5 bg-sky-500 animate-pulse" /></div>
					) : parsed.kind === 'json' ? (
						<pre className="mx-2.5 mb-2 px-2.5 py-2 rounded-md bg-slate-900/95 text-[11px] leading-relaxed text-slate-100 overflow-x-auto whitespace-pre">{parsed.text}</pre>
					) : (
						<div className="px-2.5 pb-2 text-[11.5px] leading-relaxed text-slate-700 break-words"><ChatMarkdown>{parsed.text}</ChatMarkdown></div>
					)}
				</>
			)}
		</div>
	);
}

import { entityCardFor } from './chat/entityCards';
import AppSurfaceCard from './chat/AppSurfaceCard';
import { CHAT_ID_KEY, readAppChatMap, writeAppChat, forgetChatId } from './appChatMap';

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

// The persisted transcript is scoped PER SURFACE. One shared key meant the
// app-less home chat restored whatever the docked app chat last held, so
// visiting an app and then clicking "New chat" showed that app's conversation
// and its grounded opener at /studio — contradicting "New chat = no default
// app, parallel to apps". Home and each app now keep their own slot.
const STORAGE_KEY_BASE = 'studio_chat_transcript_v1';
const transcriptKey = (scope: string) => `${STORAGE_KEY_BASE}:${scope}`;
// Reserved chat-context key for the Library, so it gets the SAME per-context
// resume + grounded-opener behavior as an app (its own thread, resumed on
// re-entry) rather than a one-off fresh chat. Not a real installed app.
export const LIBRARY_KEY = 'lumid-library';

// Persisted transcript shape: { user_sub: string, messages: Message[] }.
// Tagging with user_sub closes the "same browser tab, different user"
// leak — signing out + in as someone else used to render the prior
// user's conversation. AuthProvider also clears the slot on logout;
// this guard is belt-and-suspenders for cookie expiry / cross-tab
// session swaps where logout() never runs. Mirrors chat-widget.tsx.
function loadTranscript(currentSub: string | null | undefined, scope: string): Message[] {
	if (!currentSub) return [];
	try {
		const raw = sessionStorage.getItem(transcriptKey(scope));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		// Legacy shape (an unwrapped array) predates the guard — discard
		// rather than risk rendering it under the wrong identity.
		if (Array.isArray(parsed)) {
			sessionStorage.removeItem(transcriptKey(scope));
			return [];
		}
		if (parsed?.user_sub !== currentSub || !Array.isArray(parsed.messages)) {
			sessionStorage.removeItem(transcriptKey(scope));
			return [];
		}
		const msgs = parsed.messages as Message[];
		// Scrub tools left pending from a previous session (hard refresh
		// mid-stream) — no live stream will ever resolve them.
		// failPendingTools walks blocks (incl. sub-agent children) and falls
		// back to the legacy tools[] for pre-block persisted threads.
		return msgs.map(failPendingTools);
	} catch {
		return [];
	}
}

// loadSessionId restores the claude_session_id saved alongside the transcript,
// so the session pill + CLI --resume continuity survive a page refresh. Same
// user_sub guard as loadTranscript (never surface another account's session).
function loadSessionId(currentSub: string | null | undefined, scope: string): string | null {
	if (!currentSub) return null;
	try {
		const raw = sessionStorage.getItem(transcriptKey(scope));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) || parsed?.user_sub !== currentSub) return null;
		return (parsed.claude_session_id as string) || null;
	} catch {
		return null;
	}
}
const COLLAPSE_KEY = 'studio_chat_collapsed_v1';
// NOTE: chat-rail width/resize lives in pages/studio/StudioWorkspace.tsx —
// the rail is the parent element, and this component just fills what it is
// given. A full resize implementation used to sit HERE and was unreachable
// after the chat became a centered column: state, bounds, drag handler and
// persistence, rendered by nothing. It read as a working feature for anyone
// grepping this file, while the rail was hardcoded `w-[400px]`. Removed
// 2026-08-16; do not re-add it here.
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
// Working context (like picking a git repo): which xpio repo / FM cluster / lumid-data app.
const WS_REPO_KEY = 'studio_chat_ws_repo_v1';
const WS_CLUSTER_KEY = 'studio_chat_ws_cluster_v1';
const WS_DATA_KEY = 'studio_chat_ws_data_v1';

// app_tools: does this model get the app's tool catalog (casebook, scoring,
// review)? The claude-code path is handed no tools, so inside an app it
// quietly becomes a different product — same voice, no data. Older servers
// omit the field; treat undefined as capable so nothing regresses to a
// permanent warning.
type ModelOption = { id: string; display_name: string; default: boolean; app_tools?: boolean };
const modelHasAppTools = (m?: ModelOption) => m?.app_tools !== false;
// Mutually-exclusive tool-forcing modes. '' = let the agent decide.
type ChatMode = '' | 'search' | 'deep_research';

export function StudioChat({ docked = false, groundApp, threadId }: { docked?: boolean; groundApp?: string | null; threadId?: string } = {}) {
	const location = useLocation();
	// View mode: in simple (default) mode the chat runs "clean" — engineer
	// telemetry (cost/tokens/session), the slash palette, and the model picker
	// are hidden. `verbose` is the advanced-mode signal these gate on.
	const { advanced: verbose } = useViewMode();
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
	// One slot per surface: the app-less home, and one per grounded app. Sharing
	// a slot is what let an app's conversation reappear at /studio.
	// Scope from the ROUTE, not the prop. groundApp arrives a render late after a
	// reload, so keying on it made the docked chat briefly scope to `app:none` —
	// it then loaded (and persisted to) a different slot than the one it had just
	// saved, so a reloaded conversation came back empty and the composer's turns
	// went to a transcript nobody was reading. The path is correct on the very
	// first render, which is the whole point.
	const routeApp = (() => {
		const m = /^\/studio\/apps\/([^/?#]+)/.exec(location.pathname);
		return m ? decodeURIComponent(m[1]) : '';
	})();
	const chatScope = docked ? `app:${groundApp || routeApp || 'none'}` : 'home';
	// The strategy this thread is about, when it was opened from a strategy
	// row's "Discuss". Mirrors how `app` grounds a thread, one level finer.
	// Sticky on purpose: later turns in the same thread stay about the same
	// strategy, and a save that omitted it would unground the thread.
	const groundedStrategyRef = useRef<string>('');
	// The app a `studio:ask` came FROM, latched for the same reason as the
	// strategy above. workspaceApp() only matches /studio/apps/:app, but config
	// surfaces live at /studio/a/:app/:surface — so a Discuss raised there can
	// reach the save with no app at all, and the per-strategy Sessions table
	// (which filters on app AND strategy) drops every row. Used only as the
	// last fallback, so it can never override a live workspace grounding.
	const groundedAppRef = useRef<string>('');
	const [messages, setMessages] = useState<Message[]>(() => loadTranscript(userSub, chatScope));
	const [input, setInput] = useState('');
	const [slashSuggestions, setSlashSuggestions] = useState<{ label: string; template: string }[]>([]);
	const [slashIdx, setSlashIdx] = useState(0);
	// Queued messages — sends typed while a turn is streaming get
	// stashed here and dispatched FIFO when streaming completes.
	// Captures attachments at queue-time so the next message goes
	// out with the files that were attached when the user pressed
	// Enter, not whatever's attached when the previous turn finishes.
	// The queue carries the WHOLE dispatch, not just the text. It used to hold
	// {text, attachments} only, so anything queued lost its tool_choice and its
	// viewing context on the way out -- which is why a correction could not be
	// queued: it would have gone as an ordinary prose turn, routed nowhere near
	// app_feedback, and staged no draft. Carrying the params is what lets a
	// forced-tool turn wait its turn instead of being dropped.
	type QueuedMessage = {
		text: string;
		attachments: Attachment[];
		ctxOverride?: Partial<ViewingContext>;
		modelOverride?: string;
		toolChoice?: string;
	};
	const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
	// Embedded session viewer — a running/selected cycle's conversation rendered
	// in THIS chatbox with the chat's own MessageBubble. Opened via
	// `studio:open-session` {app, loop, ts}. ts="latest" → the running cycle.
	const [session, setSession] = useState<{ app: string; loop: string; ts: string } | null>(null);
	const [sessionMsgs, setSessionMsgs] = useState<Message[] | null>(null);
	const [sessionRows, setSessionRows] = useState<CycleLogRow[] | null>(null);
	const [sessionRunning, setSessionRunning] = useState(false);
	const [sessionExpanded, setSessionExpanded] = useState(false);
	const sessionScrollRef = useRef<HTMLDivElement | null>(null);
	// Auto-scroll the session feed to the newest turn as it streams.
	useEffect(() => {
		const el = sessionScrollRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
	}, [sessionMsgs, sessionExpanded]);
	useEffect(() => {
		const onOpen = (e: Event) => {
			const d = (e as CustomEvent).detail || {};
			if (d.app && d.loop && d.ts) { setSession({ app: d.app, loop: d.loop, ts: d.ts }); setSessionExpanded(false); setCollapsed(false); }
		};
		window.addEventListener('studio:open-session', onOpen as EventListener);
		return () => window.removeEventListener('studio:open-session', onOpen as EventListener);
	}, []);
	// The session box always corresponds to the SELECTED workflow. When the user
	// switches workflow: an open box re-binds to the new wf's LIVE run if it's
	// running, otherwise it CLOSES (we never show another workflow's run). A box
	// closed (or pinned to a history run of the SAME wf) is left as-is. Detail
	// carries `running` so we know whether there's a live session to follow.
	useEffect(() => {
		const onSel = (e: Event) => {
			const d = (e as CustomEvent<{ app?: string; loop?: string; running?: boolean }>).detail || {};
			if (!d.app || !d.loop) return;
			setSession((cur) => {
				if (!cur) return cur;                                      // closed → stays closed
				if (cur.app === d.app && cur.loop === d.loop) return cur;  // same wf → unchanged (keeps a pinned history run)
				return d.running ? { app: d.app!, loop: d.loop!, ts: 'latest' } : null; // follow live, else close
			});
		};
		window.addEventListener('studio:workflow-selected', onSel as EventListener);
		return () => window.removeEventListener('studio:workflow-selected', onSel as EventListener);
	}, []);
	const sessionSigRef = useRef('');
	useEffect(() => {
		if (!session) { setSessionMsgs(null); setSessionRows(null); sessionSigRef.current = ''; return; }
		// New binding → drop the previous run's content immediately so we never
		// flash another workflow's session while the first fetch is in flight.
		setSessionMsgs(null); setSessionRows(null); sessionSigRef.current = '';
		let live = true; let timer: number | undefined;
		const tick = async () => {
			// Pause polling for a backgrounded tab — recheck shortly.
			if (typeof document !== 'undefined' && document.hidden) { timer = window.setTimeout(tick, 1500); return; }
			const { rows, running } = await fetchCycleConversation(session.app, session.loop, session.ts);
			if (!live) return;
			// Skip the heavy re-map + re-render when nothing changed (the poll
			// returns the full timeline each tick; only churn on real updates).
			const last = rows[rows.length - 1] as CycleLogRow | undefined;
			const sig = `${rows.length}|${last?.ts ?? ''}|${(last?.response ?? last?.status ?? '').length}|${(last?.thinking ?? '').length}|${running}`;
			if (sig !== sessionSigRef.current) {
				sessionSigRef.current = sig;
				setSessionRows(rows);
				setSessionMsgs(sessionRowsToMessages(rows));
				setSessionRunning(running);
			}
			// Poll fast while working so the partial text streams in; stop once done.
			if (running) timer = window.setTimeout(tick, 600);
		};
		tick();
		return () => { live = false; if (timer) window.clearTimeout(timer); };
	}, [session]);
	// Ref mirror so the streaming useEffect can dequeue without
	// becoming a dependency cycle (it ALSO clears the head when
	// firing, so depending on state would re-trigger).
	const messageQueueRef = useRef<QueuedMessage[]>([]);
	// Re-trigger for the queue drain when a dispatch is refused, plus a bound
	// so a wedged turn cannot spin the retry forever (60 x 800ms ~ 48s).
	const [queueTick, setQueueTick] = useState(0);
	const queueRetriesRef = useRef(0);
	// One drain at a time. Not a cancellation flag — see the drain effect.
	const drainingRef = useRef(false);
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
	// "Ask the app" — route this turn through the grounded app's analyst instead
	// of answering generically. ON by default in an app workspace: you opened the
	// app to talk to IT, and the model does not make that choice on its own
	// (measured across gemma and Sonnet). Off for administrative asks like
	// "list my cases" or "run the workflow".
	const [askApp, setAskApp] = useState<boolean>(true);
	// Interview mode — WHO sits in which seat for this conversation.
	//   train_ai : the AI answers, you interview it   (default)
	//   free     : open question, no case, no ground truth
	//   coach    : YOU answer, the AI interviews and scores you
	// Persisted per app so returning to an app resumes how you were working.
	// The server derives the model's ROLE from this; it never accepts a role.
	const modeKey = `studio_interview_mode_v1:${groundApp || 'none'}`;
	const [interviewMode, setInterviewMode] = useState<'train_ai' | 'free' | 'coach'>(() => {
		try {
			const v = localStorage.getItem(modeKey);
			if (v === 'free' || v === 'coach' || v === 'train_ai') return v;
		} catch { /* ignore */ }
		return 'train_ai';
	});
	// The case the user picked rides only the FIRST turn: it arrives on the
	// studio:ask event, and buildViewingContext rebuilds from the URL after that
	// — and the URL has no case in it. So every later turn in an open case was
	// sent with no case_id, and anything reading it server-side (the mode
	// directive block, a staged correction's context) saw a conversation about
	// nothing in particular. Sticky for the conversation, cleared on reset, the
	// same shape interviewModeRef already uses for the mode.
	const caseIdRef = useRef<string>('');
	const interviewModeRef = useRef(interviewMode);
	useEffect(() => {
		interviewModeRef.current = interviewMode;
		try { localStorage.setItem(modeKey, interviewMode); } catch { /* ignore */ }
	}, [interviewMode, modeKey]);
	// dispatchTurn's body is built inside a callback that must not re-create on
	// every toggle, so read the flag through a ref (same pattern as
	// dispatchTurnRef).
	const askAppRef = useRef(askApp);
	useEffect(() => { askAppRef.current = askApp; }, [askApp]);
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
	// ── Working context (xpio repo / FM cluster / lumid-data app) ──
	type WsOption = { id: string; label: string };
	const [wsRepos, setWsRepos] = useState<WsOption[]>([]);
	const [wsClusters, setWsClusters] = useState<WsOption[]>([]);
	const [wsDataApps, setWsDataApps] = useState<WsOption[]>([]);
	const lsGet = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
	const [wsRepo, setWsRepo] = useState<string>(() => lsGet(WS_REPO_KEY));
	const [wsCluster, setWsCluster] = useState<string>(() => lsGet(WS_CLUSTER_KEY));
	const [wsDataApp, setWsDataApp] = useState<string>(() => lsGet(WS_DATA_KEY));
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
	const claudeSessionRef = useRef<string | null>(loadSessionId(userSub, chatScope));
	// State mirror of claudeSessionRef so the composer can render the
	// session pill (the ref alone never re-renders). Always write through
	// setCCSession so both stay in sync. Seeded from the persisted transcript
	// so a page refresh keeps the session pill (and --resume) instead of
	// dropping it to null.
	const [claudeSession, setClaudeSession] = useState<string | null>(() => loadSessionId(userSub, chatScope));
	// Capabilities of the live CC session (tools/agents/skills/MCP), surfaced
	// in the SessionStrip like Claude Code's own context header.
	const [claudeCaps, setClaudeCaps] = useState<{ model?: string; tools?: string[]; agents?: string[]; skills?: string[]; mcp?: unknown } | null>(null);
	// Sandbox turn id for the run in flight. Lets Stop go through the CLI's own
	// interrupt instead of just aborting the fetch (which SIGKILLed the process
	// and threw away partial work).
	const turnIdRef = useRef<string | null>(null);
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

	// right away instead of waiting for its 2-min poll.
	// Per-turn telemetry (cost/duration/steps/cache) from the Claude Code
	// `result` event. Keyed to the turn index so it renders under that turn only.
	const [turnStats, setTurnStats] = useState<TurnStats | null>(null);
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

	// `pickedTarget` mirrors the held selection so the chip above the input
	// shows what the user has pinned (still surfaced by other pages via the
	// StudioContext subscription; the composer's own picker button was removed).
	const [pickedTarget, setPickedTargetState] = useState<StudioPickedTarget | null>(() => getStudioPickedTarget());
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
	// Mirrored into state so the jump-to-latest button can render. The ref
	// stays authoritative for the auto-scroll effect (no re-render per delta).
	const [atBottom, setAtBottom] = useState(true);
	const motionOK = useMotionOK();
	// Phase S6 polish — abort handle so the user can cut a runaway
	// stream short. Reset on every send/queueSend; set just before the
	// fetch; consumed by the Stop button.
	const abortRef = useRef<AbortController | null>(null);

	// If the auth context flips identity mid-tab (cookie refresh that
	// returned a different user, or a session swap), drop the in-memory
	// transcript before it can be rendered/persisted under the new user.
	useEffect(() => {
		setMessages((cur) => (cur.length === 0 ? cur : loadTranscript(userSub, chatScope)));
	}, [userSub]);

	// Persist transcript tagged with the current user_sub. No identity →
	// no persistence (nothing to bind it to, so nothing can leak).
	// Throttled: this used to serialize the whole transcript on every `messages`
	// change — once per streamed token — against a ~5 MB quota, with tool
	// results stored uncapped. stripForPersist clamps them; the timer keeps a
	// long turn from stringifying the transcript hundreds of times.
	useEffect(() => {
		if (!userSub) return;
		const write = () => {
			try {
				sessionStorage.setItem(transcriptKey(chatScope), JSON.stringify({
					user_sub: userSub, messages: stripForPersist(messages),
					claude_session_id: claudeSessionRef.current || null,
				}));
			} catch { /* quota or serialization — nothing actionable */ }
		};
		if (!streaming) { write(); return; }   // flush immediately once idle
		const id = window.setTimeout(write, 500);
		return () => window.clearTimeout(id);
	}, [messages, userSub, streaming]);
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

	// Persist the 3 working-context selectors.
	useEffect(() => { try { wsRepo ? localStorage.setItem(WS_REPO_KEY, wsRepo) : localStorage.removeItem(WS_REPO_KEY); } catch { /* ignore */ } }, [wsRepo]);
	useEffect(() => { try { wsCluster ? localStorage.setItem(WS_CLUSTER_KEY, wsCluster) : localStorage.removeItem(WS_CLUSTER_KEY); } catch { /* ignore */ } }, [wsCluster]);
	useEffect(() => { try { wsDataApp ? localStorage.setItem(WS_DATA_KEY, wsDataApp) : localStorage.removeItem(WS_DATA_KEY); } catch { /* ignore */ } }, [wsDataApp]);

	// Load working-context options once (repos = knowledge banks; clusters = FM
	// fleet; data apps = lumid-data). Each source already exists; all best-effort.
	useEffect(() => {
		(async () => {
			// xpio repos — the user's accessible knowledge banks (kind=memory).
			try {
				const r = await fetch('/api/v1/repos?kind=memory&mine=1', { credentials: 'include' });
				if (r.ok) {
					const j = await r.json();
					const repos = j?.repos || j?.data?.repos || [];
					setWsRepos(repos.map((x: any) => ({ id: x.name, label: x.display_name || x.name })));
				}
			} catch { /* ignore */ }
			// FM clusters — slim selectable list (default row added in the picker).
			try {
				const { listSelectableClusters } = await import('../api/cluster');
				const cs = await listSelectableClusters();
				setWsClusters(cs.map((c) => ({ id: c.id, label: c.name + (c.region ? ` · ${c.region}` : '') })));
			} catch { /* ignore */ }
			// lumid-data apps — the /dataapp-proxy federation allowlist.
			try {
				const r = await fetch('/dataapp-proxy/_sources', { credentials: 'include' });
				if (r.ok) {
					const j = await r.json();
					setWsDataApps((j?.sources || []).map((s: any) => ({ id: s.id, label: s.label || s.id })));
				}
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

		// EARLY SAVE — create the row as soon as the user's turn exists, before
		// the assistant has replied.
		//
		// The guards below only persist a COMPLETED turn (not streaming, >=2
		// messages, last is a non-empty assistant message). On Claude that is
		// almost invisible. On deepseek it is not: TTFT carries an ~18k-token
		// tool-schema prefix, so a turn runs for a minute or more, and if the
		// user looks away — or the request is cancelled — NOTHING is written.
		// Measured: `[me-agent] stream turn failed provider=deepseek-v4-flash
		// err=context canceled` after 1m12s, and no chat row at all. That is why
		// ZERO chats in the whole table have ever carried a strategy_id: the
		// grounding was fine, the row was never created.
		//
		// So: if this thread has no id yet and the user has spoken, write it now.
		// The completed-turn save below still runs and updates the same row (it
		// sends `id`), so this only ever ADDS the early row -- and it carries the
		// same app/strategy grounding, which is what makes an app's Sessions
		// list populate the moment Discuss is clicked.
		if (!chatId && messages.length >= 1 && messages[0]?.role === 'user') {
			const seedApp = (workspaceApp() || currentAppRef.current || groundedAppRef.current) || undefined;
			const seedStrategy = groundedStrategyRef.current || undefined;
			if (seedStrategy || seedApp) {
				void (async () => {
					try {
						const r = await fetch('/api/v1/me/chats', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							credentials: 'include',
							body: JSON.stringify({
								messages: stripForPersist(messages),
								model: model || undefined,
								mode: mode || undefined,
								app: seedApp,
								strategy_id: seedStrategy,
							}),
						});
						if (!r.ok) return;
						const j = await r.json();
						const seededId: string | undefined = j?.data?.id;
						if (seededId) {
							setChatId(seededId);
							if (seedApp) writeAppChat(seedApp, seededId);
						}
					} catch { /* best-effort: the completed-turn save still runs */ }
				})();
			}
		}

		if (streaming) return;
		if (messages.length < 2) return;
		const last = messages[messages.length - 1];
		if (last.role !== 'assistant' || !last.content) return;
		// Cheap signature so we don't re-POST when reordering UI bits.
		// blocks.length covers reasoning/tools now that they aren't flat fields.
		const sig = `${messages.length}:${last.content.length}:${last.blocks?.length ?? 0}:${(last.thinking||'').length}`;
		if (sig === lastSavedSigRef.current) return;

		saveTimerRef.current = window.setTimeout(async () => {
			try {
				const r = await fetch('/api/v1/me/chats', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({
						...(chatId ? { id: chatId } : {}),
						// Clamp huge tool results before they hit the DB too.
						messages: stripForPersist(messages),
						model: model || undefined,
						mode: mode || undefined,
						claude_session_id: claudeSessionRef.current || undefined,
						app: (workspaceApp() || currentAppRef.current || groundedAppRef.current) || undefined,
						strategy_id: groundedStrategyRef.current || undefined,
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
				window.dispatchEvent(new CustomEvent('studio:recent-invalidate'));
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
			// Both failure paths below used to return false with NO signal at
			// all — from the sidebar that reads as a dead click. Say something.
			if (!r.ok) {
				console.warn(`[studio] could not open conversation ${id}: HTTP ${r.status}`);
				return false;
			}
			const j = await r.json();
			const rec = j?.data;
			if (!rec || !Array.isArray(rec.messages)) {
				console.warn(`[studio] conversation ${id} has no messages array`, rec);
				return false;
			}
			setMessages(rec.messages);
			setChatId(rec.id);
			claudeSessionRef.current = rec.claude_session_id || null; setClaudeSession(rec.claude_session_id || null);
			// Adopt this thread's OWN grounding — including the empty case. An
			// ungrounded thread opened after a grounded one would otherwise
			// inherit the stale latch and be re-filed under that strategy on
			// its next save.
			groundedStrategyRef.current = (rec.strategy_id as string) || '';
			groundedAppRef.current = (rec.app as string) || '';
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
		claudeSessionRef.current = null; setClaudeSession(null);
		lastSavedSigRef.current = '';
		currentAppRef.current = null;   // generic new chat = home (app-less)
		openedAppRef.current = null;
		// Drop the strategy grounding too. The latch survives to the SAVE by
		// design, so leaving it set here would file the NEXT, unrelated thread
		// under whichever strategy was last discussed — the per-strategy
		// Sessions table would then attribute a foreign conversation to it,
		// which is the failure the table's fail-closed filter exists to avoid.
		groundedStrategyRef.current = '';
		groundedAppRef.current = '';
		try { sessionStorage.removeItem(transcriptKey(chatScope)); } catch { /* ignore */ }
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
			window.dispatchEvent(new CustomEvent('studio:recent-invalidate'));
		} catch { /* ignore */ }
	}, [chatId, newChat, loadHistory]);

	// Recent-row clicks arrive two ways, because the sidebar lives in a
	// different component tree:
	//   - route CHANGES (or a fresh mount) → sessionStorage stash, read here.
	//     Keyed on pathname, not mount: navigating /studio/apps/A → …/B keeps
	//     this component mounted, so a mount-only read would never fire.
	//   - route UNCHANGED (already on the target) → studio:open-chat event,
	//     since navigate() to the current path is a no-op and nothing remounts.
	//     This is the same split the studio:ask bridge already makes.
	useEffect(() => {
		const consume = (id: string, app?: string | null) => {
			currentAppRef.current = app || null;
			openedAppRef.current = app || null;
			void loadThread(id);
		};
		try {
			const raw = sessionStorage.getItem('studio_open_chat_v1');
			if (raw) {
				sessionStorage.removeItem('studio_open_chat_v1');
				const { id, app } = JSON.parse(raw);
				if (id) consume(id, app);
			}
		} catch { /* stale/invalid stash — ignore */ }
		const onOpenChat = (e: Event) => {
			const d = (e as CustomEvent<{ id?: string; app?: string | null }>).detail;
			if (d?.id) consume(d.id, d.app);
		};
		window.addEventListener('studio:open-chat', onOpenChat as EventListener);
		return () => window.removeEventListener('studio:open-chat', onOpenChat as EventListener);
	}, [location.pathname, loadThread]);

	// /studio/chat/:id — a thread addressed by URL. The two paths above both
	// need a live sender (a sidebar click, an already-mounted component); a
	// route gives a thread a durable address instead, which is what a link
	// from another surface needs: the per-strategy Sessions table renders
	// `row_href: /studio/chat/{id}`, and until this existed that link fell
	// through to the catch-all route. It also lets two threads on the same
	// strategy be open in two tabs — thread identity was localStorage-only,
	// so they used to fight over one slot.
	useEffect(() => {
		if (!threadId || threadId === chatId) return;
		void loadThread(threadId);
	}, [threadId, chatId, loadThread]);

	// The sidebar's Recent list owns deletion now (the in-chat Conversations
	// popover it replaced used to). If it deleted the thread this chat has
	// open, reset to a fresh one so we're not editing a row that's gone.
	useEffect(() => {
		const onDeleted = (e: Event) => {
			const id = (e as CustomEvent<{ id?: string }>).detail?.id;
			if (!id) return;
			forgetChatId(id);
			if (id === chatId) newChat();
		};
		window.addEventListener('studio:chat-deleted', onDeleted as EventListener);
		return () => window.removeEventListener('studio:chat-deleted', onDeleted as EventListener);
	}, [chatId, newChat]);

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
	//
	// rAF-throttled, and self-induced scrolls are flagged: the container has
	// CSS scroll-smooth, so a bare per-delta `scrollTop =` assignment ANIMATES
	// — mid-animation the measured position lags the target, the onScroll
	// handler reads it, concludes the user scrolled up, and auto-follow
	// silently disengages ("Jump to latest" popping up unasked).
	const scrollRaf = useRef(0);
	const selfScrollUntil = useRef(0);
	useEffect(() => {
		if (!atBottomRef.current) return;
		if (scrollRaf.current) return; // one queued frame is enough
		scrollRaf.current = requestAnimationFrame(() => {
			scrollRaf.current = 0;
			const el = transcriptRef.current;
			if (!el || !atBottomRef.current) return;
			// Instant jump for stream-follow; smooth stays for user actions.
			selfScrollUntil.current = Date.now() + 200;
			el.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
		});
	}, [messages, streaming]);
	useEffect(() => () => { if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current); }, []);

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
			const ce = e as CustomEvent<{ prompt?: string; autosend?: boolean; context?: Partial<ViewingContext>; model?: string }>;
			const p = String(ce.detail?.prompt || '').trim();
			if (!p) return;
			// Latch a strategy grounding so it survives to the SAVE. The event's
			// `context` is a per-TURN override — it never reaches the persisted
			// row — so without this the thread is stored with `app` only and the
			// per-strategy Sessions table (which fails closed) stays empty.
			const sel = ce.detail?.context?.selection;
			if (sel && sel.kind === 'strategy' && sel.id) {
				groundedStrategyRef.current = String(sel.id);
			}
			const askApp = ce.detail?.context?.app;
			if (askApp) groundedAppRef.current = String(askApp);
			setCollapsed(false);
			if (ce.detail?.autosend) {
				setInput('');
				void dispatchTurnRef.current?.(p, [], undefined, ce.detail?.context, ce.detail?.model);
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
		modelOverride?: string,
		// Force a specific tool for THIS turn (see tool_choice in
		// lumid-identity). Used by "Correct this", where routing to the app's
		// feedback path is the user's stated intent, not the model's guess.
		toolChoice?: string,
	) => {
		// Returns whether the turn was actually DISPATCHED. A silent early
		// return is fine for the composer (the text stays in the box, so the
		// user can see nothing happened) but not for a programmatic caller
		// like "Correct this", which has already collected the user's words in
		// a prompt() and would otherwise drop them with no trace.
		if (!text || streaming || inFlightRef.current) return false;
		inFlightRef.current = true;
		const base = baseMessages ?? messages;
		const userMsg: Message = {
			role: 'user', content: text,
			...(stagedAttachments.length > 0 ? { attachments: stagedAttachments } : {}),
		};
		// Structured "what the user is looking at" payload — replaces the
		// old prose preamble (which polluted the stored transcript and
		// re-sent stale page notes on every history replay). The backend
		// renders this into a per-request system block.
		const context = buildViewingContext(location.pathname, location.search, ctxOverride);
		// A newly-picked case replaces the remembered one; turns that carry none
		// inherit it.
		if (ctxOverride && typeof ctxOverride.case_id === 'string' && ctxOverride.case_id) {
			caseIdRef.current = ctxOverride.case_id;
		}
		// One attachment → wire mapping, used for both the current turn and prior
		// turns' history. Returns null when the heavy body was already dropped
		// (stripForPersist on a reloaded thread), so we never re-send an empty
		// blob the server would choke on.
		const toWire = (a: Attachment): WireAttachment | null =>
			a.kind === 'image'
				? (a.dataB64 ? { kind: 'image', name: a.name, mime: a.mime, data_b64: a.dataB64 } : null)
				: a.kind === 'document'
					? (a.dataB64 ? { kind: 'document', name: a.name, mime: a.mime, data_b64: a.dataB64 } : null)
					: (a.text ? { kind: 'text', name: a.name, text: a.text } : null);
		const wireOf = (atts?: Attachment[]): WireAttachment[] =>
			(atts || []).map(toWire).filter((w): w is WireAttachment => w !== null);
		const wireAttachments = wireOf(stagedAttachments);
		const wireMessages = [
			// Re-send prior turns' still-loaded attachments so a follow-up
			// ("summarize it again") still sees the file it referenced earlier.
			...base.map((m) => {
				const wa = wireOf(m.attachments);
				return wa.length > 0
					? { role: m.role, content: m.content, attachments: wa }
					: { role: m.role, content: m.content };
			}),
			wireAttachments.length > 0
				? { role: 'user' as const, content: text, attachments: wireAttachments }
				: { role: 'user' as const, content: text },
		];
		setTurnStats(null);
		turnIdRef.current = null;
		const assistantMsg: Message = { role: 'assistant', content: '', blocks: [] };
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
							// The mode rides on the context the server already reads. It
							// selects an experience, not a privilege — the role it maps to
							// is decided server-side.
							context: context
								? {
										...context,
										mode: interviewModeRef.current,
										...(context.case_id || caseIdRef.current
											? { case_id: (context.case_id as string) || caseIdRef.current }
											: {}),
									}
								: context,
							// Per-turn model override (e.g. a grounded "Ask about this
							// run/step" turn requests a tool-capable model so the
							// observability tools fire). Falls back to the user's
							// selected model. Backend still re-checks role permissions
							// (an over-tier override degrades to the role default).
							...((modelOverride || model) ? { model: modelOverride || model } : {}),
							...(mode ? { mode } : {}),
							...(think ? { think: true } : {}),
							...(personaId ? { persona_id: personaId } : agentId ? { agent_id: agentId } : {}),
							...(wsRepo ? { xpio_repo: wsRepo } : {}),
							...(wsCluster ? { cluster_id: wsCluster } : {}),
							...(wsDataApp ? { data_app: wsDataApp } : {}),
							...(claudeSessionRef.current ? { claude_session_id: claudeSessionRef.current } : {}),
							// "Ask the app" — the user has said this turn is a domain
							// question for THIS app, so don't leave it to tool selection.
							// Measured: neither gemma nor Sonnet picks app_answer on its
							// own, so a free-form question gets answered by the generic
							// assistant while the app's voice, rubric and
							// grounded/ungrounded distinction go unused. Stating the
							// intent beats inferring it.
							...(toolChoice
								? { tool_choice: toolChoice }
								: askAppRef.current && (workspaceApp() || currentAppRef.current)
									? { tool_choice: 'app_answer' } : {}),
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
						onClaudeSession: (id) => { claudeSessionRef.current = id; setClaudeSession(id); },
						onRoute: (modelUsed, autoRouted) => setLastRoute({ modelUsed, autoRouted }),
						onUsage: (used, limit) => setUsage({ used, limit }),
						onTurnStats: setTurnStats,
						onTurnId: (id) => { turnIdRef.current = id; },
						onCapabilities: setClaudeCaps,
					}, ctrl.signal);
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
			setMessages((prev) => withLastAssistant(prev, failPendingTools));
		}
		return true;
	}, [messages, streaming, location.pathname, location.search, model, mode, think, agentId, personaId]);

	// Latest-send-path ref for the studio:ask listener (registered once).
	const dispatchTurnRef = useRef<typeof dispatchTurn | null>(null);
	useEffect(() => { dispatchTurnRef.current = dispatchTurn; }, [dispatchTurn]);
	// Same escape hatch as dispatchTurnRef: the window-listener effect below is
	// mount-only ([]), so it must read these through refs or it captures the
	// first render's values forever.
	const dockedRef = useRef(docked);
	useEffect(() => { dockedRef.current = docked; }, [docked]);

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
			// The app's own opener, when it declares one.
			me.listApps().then((r) => (r.apps || []).find((a) => a.name === app)?.ui?.opener).catch(() => undefined),
		]).then(([, rows, opener]) => {
			setStudioSelection({ kind: 'app', id: app, label: appTitle(app), affordances: ['app_action', 'app_read', 'run_loop_now', 'list_loops'] });
			// An app-DECLARED opener wins. The default below is operator-shaped
			// ("N workflows, last run 1h ago" + "run a workflow"), which is right
			// for an app you OPERATE and wrong for one you USE — someone opening
			// mbb-consultant to practise a case was greeted with workflow
			// telemetry they could do nothing with. Opt-in, so every ops app the
			// default was written for is unchanged.
			if (opener?.line) {
				setMessages((prev) => [...prev, {
					role: 'assistant',
					content: opener.line as string,
					// Carry the chip's declared MODE as context. A chip is a fixed
					// workflow the user picked by clicking, so leaving the setup in
					// the prompt text makes the model re-derive what the click
					// already settled — and prose about who plays which role is
					// easy to misread. Observed: a chip that said both "interview
					// me" and "you're the interviewer and I'm the candidate" sent
					// the model off reasoning about whether those contradicted,
					// then it announced it would fetch the cases and stopped
					// without calling anything.
					chips: (opener.chips || []).slice(0, 4).map((c) => ({
						label: c.label,
						prompt: c.prompt,
						context: { app, ...(c.mode ? { mode: c.mode } : {}) },
					})),
				}]);
				return;
			}
			const st = summarizeAppState(app, rows);
			setMessages((prev) => [...prev, { role: 'assistant', content: openerLine(app, st), chips: chipsForApp(app, rows) }]);
		});
	}, []);
	// Clear the in-memory session (keeps currentAppRef binding).
	const clearSession = useCallback(() => {
		setMessages([]);
		setChatId(null);
		claudeSessionRef.current = null; setClaudeSession(null);
		lastSavedSigRef.current = '';
		try { sessionStorage.removeItem(transcriptKey(chatScope)); } catch { /* ignore */ }
	}, []);

	// Deliberate "start a SECOND conversation in this app" (the sidebar folder's
	// + button). openAppInChat() can't serve this: it early-returns when the app
	// is already grounded — correct for re-entry, wrong here, where the app being
	// current is exactly the case we must still act on. Skips the resume map
	// entirely and opens a fresh grounded thread.
	const newAppChat = useCallback((app: string) => {
		if (!app) return;
		if (inFlightRef.current) return; // don't yank the session mid-stream
		writeAppChat(app, null);         // don't resume the thread we're leaving
		currentAppRef.current = app;
		openedAppRef.current = null;     // let the opener fire for the new thread
		caseIdRef.current = '';          // a new thread is not still in the old case
		clearSession();
		emitAppOpener(app);
	}, [clearSession, emitAppOpener]);
	// Set while a thread resume is in flight for an app, so a re-render of the
	// grounding effect cannot paste an opener over the loading transcript.
	// Set while a thread resume is in flight for an app, so a re-render of the
	// grounding effect cannot paste an opener over the loading transcript.
	const resumingRef = useRef<string | null>(null);
	const newAppChatRef = useRef<typeof newAppChat | null>(null);
	useEffect(() => { newAppChatRef.current = newAppChat; }, [newAppChat]);

	const openAppInChat = useCallback((d: { app: string; surface?: string }) => {
		if (!d?.app) return;
		const app = d.app;
		// Already on this app's session (opener emitted) → nothing to do.
		if (openedAppRef.current === app && currentAppRef.current === app) return;
		if (inFlightRef.current) return; // don't yank the session mid-stream

		const wasApp = currentAppRef.current;
		currentAppRef.current = app;

		// A resume for THIS app is already in flight — do nothing. Without this
		// the effect below re-runs whenever its callback deps change identity,
		// and by then currentAppRef is already `app`, so the `wasApp === app`
		// branch fired and appended the opener ON TOP of the thread still being
		// loaded. On a page refresh that is exactly what you saw: the
		// conversation came back and "Pick a mode and a case…" was pasted over
		// it, which reads as the thread having been lost.
		if (resumingRef.current === app) return;

		// Same app, session already present (e.g. opener not yet emitted on this
		// mount) — just emit the opener into the existing thread.
		if (wasApp === app) { emitAppOpener(app); return; }

		// Switching apps → resume this app's latest saved session if any, else
		// start a fresh session and emit the opener. Never append into the
		// previous app's / the home session.
		const saved = readAppChatMap()[app];
		if (saved) {
			resumingRef.current = app;
			void loadThread(saved)
				.then((res) => {
					if (res === false) { writeAppChat(app, null); clearSession(); emitAppOpener(app); }
					else { openedAppRef.current = app; } // resumed — the opener has already had its turn
				})
				.finally(() => { if (resumingRef.current === app) resumingRef.current = null; });
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
				claudeSessionRef.current = null; setClaudeSession(null);
				currentAppRef.current = null;
				openedAppRef.current = null;
				// A stale app-open stash (written by the workspace before nav) would
				// otherwise re-ground this fresh chat with the app's opener — drop it.
				sessionStorage.removeItem(transcriptKey(chatScope));
				sessionStorage.removeItem('studio_open_app_v1');
			}
			const raw = sessionStorage.getItem('studio_pending_ask_v1');
			if (raw) {
				sessionStorage.removeItem('studio_pending_ask_v1');
				const detail = JSON.parse(raw);
				if (detail?.prompt) {
					// Latch the grounding BEFORE dispatching — the same latch the
					// live `studio:ask` listener does.
					//
					// It has to happen on BOTH paths. `context` is a per-TURN
					// override and never reaches the persisted row, so a thread
					// started this way was stored with `app` only. This path is the
					// one an app surface actually takes: StudioChat is mounted at
					// /studio and /studio/apps/:app, but an app SURFACE lives at
					// /studio/a/:app/… where it is NOT mounted — so the shell
					// stashes and navigates here, the in-place listener never runs,
					// and the latch was silently skipped. Net effect: no chat has
					// ever been saved with a strategy_id (0 rows, whole table), and
					// lqt-mailbox's "Sessions" table — which fails closed on
					// strategy_id — read empty for every strategy.
					const sel = detail?.context?.selection;
					if (sel && sel.kind === 'strategy' && sel.id) {
						groundedStrategyRef.current = String(sel.id);
					}
					if (detail?.context?.app) groundedAppRef.current = String(detail.context.app);
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
			// Recent-sidebar row click: stashed by the shell before navigating to
			// either / (home) or /studio/apps/:app (docked) — whichever mounts
			// picks it up and resumes that exact thread.
			// (studio_open_chat_v1 is consumed by its own path-keyed effect
			// below — a mount-only read misses same-route and param-only
			// navigations, where this component never remounts.)
		} catch { /* stale/invalid stash — ignore */ }
		const onNew = () => {
			setMessages([]);
			setChatId(null);
			claudeSessionRef.current = null; setClaudeSession(null);
			currentAppRef.current = null;
			openedAppRef.current = null;
			try {
				sessionStorage.removeItem(transcriptKey(chatScope));
				sessionStorage.removeItem('studio_new_chat_v1');
				sessionStorage.removeItem('studio_open_app_v1');
			} catch { /* ignore */ }
		};
		const onOpenApp = (e: Event) => {
			const d = (e as CustomEvent).detail;
			if (d?.app) openAppInChat(d);
		};
		// Sidebar app-folder "+" — only the DOCKED chat may serve it; the home
		// chat is app-less by definition and would otherwise silently steal a
		// grounded thread onto /studio.
		const onNewAppChat = (e: Event) => {
			const app = (e as CustomEvent<{ app?: string }>).detail?.app;
			if (app && dockedRef.current) newAppChatRef.current?.(app);
		};
		window.addEventListener('studio:new-chat', onNew);
		window.addEventListener('studio:open-app', onOpenApp as EventListener);
		window.addEventListener('studio:new-app-chat', onNewAppChat as EventListener);
		return () => {
			window.removeEventListener('studio:new-chat', onNew);
			window.removeEventListener('studio:open-app', onOpenApp as EventListener);
			window.removeEventListener('studio:new-app-chat', onNewAppChat as EventListener);
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
		// Walks blocks (including sub-agent children) as well as the legacy
		// tools[]; a flat map would miss an approval raised inside a Task.
		setMessages((prev) => prev.map((m) => clearApproval(m, approvalId)));
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

	// Queue processor — after each streaming turn settles, dispatch the head.
	//
	// It used to POP FIRST and dispatch into a microtask, ignoring the result.
	// dispatchTurn refuses on `streaming || inFlightRef.current` while this
	// effect only gates on `streaming`, so there is a real window where the
	// drain believes it is safe and the dispatch still declines -- and the
	// message, already removed from the queue, was destroyed. Silent loss, one
	// layer below the click site.
	//
	// The other half is that nothing re-triggers this effect after a refusal:
	// the deps do not change, so a queued item that misses its window sits
	// there forever. The browser gate caught exactly that -- "queue indicator
	// present: true", zero requests sent, draft count unmoved.
	//
	// So: dispatch FIRST, remove only on success, and schedule a retry when it
	// declines. Bounded, so a permanently-wedged turn cannot spin forever; the
	// item stays visible in the queue rather than vanishing.
	useEffect(() => {
		if (streaming) return;
		const head = messageQueueRef.current[0];
		if (!head) return;
		// A CONCURRENCY guard, not a cancel-on-cleanup.
		//
		// The first version cancelled the in-flight attempt from the effect's
		// cleanup. dispatchTurn is a useCallback keyed on `messages`, so its
		// identity changes on every message update and this effect re-runs
		// constantly -- each re-run cancelling the previous attempt, and the
		// post-await `if (cancelled) return` discarding BOTH the success path
		// and the retry scheduling. Nothing ever drained: the browser gate saw
		// "queued: true" at click and the item still queued at failure.
		//
		// Cancelling was the wrong tool. All that is needed is "do not start a
		// second drain while one is running"; the attempt itself must always be
		// allowed to finish and record its outcome.
		if (drainingRef.current) return;
		drainingRef.current = true;
		void (async () => {
			try {
				const sent = await dispatchTurn(head.text, head.attachments, undefined,
					head.ctxOverride, head.modelOverride, head.toolChoice);
				if (sent) {
					setMessageQueue((q) => q.slice(1));
					queueRetriesRef.current = 0;
					return;
				}
				// Refused — still in flight. Nudge the effect to run again rather
				// than waiting for an unrelated dep to change.
				if (queueRetriesRef.current < 60) {
					queueRetriesRef.current += 1;
					setTimeout(() => setQueueTick((t) => t + 1), 800);
				}
			} finally {
				drainingRef.current = false;
			}
		})();
	}, [streaming, dispatchTurn, messageQueue.length, queueTick]);

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
		claudeSessionRef.current = null; setClaudeSession(null);
		lastSavedSigRef.current = '';
		openedAppRef.current = null;
		try { sessionStorage.removeItem(transcriptKey(chatScope)); } catch { /* ignore */ }
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
			{/* Artifacts — back in the chat's top-right icon group (2026-08-26).
			    They are per-conversation output, so the trigger belongs beside
			    the conversation's other controls rather than being a standing
			    destination in the shell rail. The popover anchors here and
			    opens downward; nothing else about the panel changed. */}
			<ArtifactIconButton />
			{/* Workflow-viz side panel toggle. Auto-opens when an optimize_workflow/
			    run_workflow tool completes (chat/protocol.ts); this button re-opens
			    it. The panel itself (a fixed right drawer) is mounted below. */}
			<button
				onClick={() => window.dispatchEvent(new CustomEvent('studio:workflow-panel-toggle'))}
				title="Workflow" aria-label="Workflow visualization"
				className="p-1.5 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
			>
				<WorkflowIcon className="w-4 h-4" />
			</button>
			<StudioWorkflowPanel />
			{/* The Conversations picker moved to the shell's left sidebar
			    ("Recent") on 2026-08-10 — one list, always visible, instead of
			    a popover buried in the chat header. Artifacts moved with it. */}
			{/* New conversation, grounded on the SAME app.
			    The docked chat had only Delete, so the only way to start fresh on
			    an app page was to destroy the thread you were looking at — you
			    lost the transcript to get a clean one. (Clicking the app in the
			    sidebar also starts a new thread, but nothing says so, and you are
			    already on the app's page.) newAppChat has existed all along and
			    listens on studio:new-app-chat; it just had no button. Docked only:
			    the home chat has "New chat" in the sidebar. */}
			{docked && messages.length > 0 && (
				<button
					onClick={() => {
						const app = workspaceApp() || currentAppRef.current;
						if (app) window.dispatchEvent(new CustomEvent('studio:new-app-chat', { detail: { app } }));
					}}
					title="New conversation" aria-label="New conversation"
					className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
				>
					<MessageSquarePlus className="w-4 h-4" />
				</button>
			)}
			{messages.length > 0 && (
				<button onClick={clear} title="Delete this conversation" aria-label="Delete this conversation"
					className="p-1.5 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-colors">
					<Trash2 className="w-3.5 h-3.5" />
				</button>
			)}
		</div>
	);

	// ── live activity: what is Claude doing RIGHT NOW ─────────────────────
	// A long Bash run or sub-agent used to be invisible unless you spotted the
	// small pulsing chip in the transcript — a working turn "looked stuck".
	// This walks the streaming reply's blocks (incl. sub-agent children, in
	// arrival order so the LAST unfinished thing wins) and feeds the slim
	// status line above the composer.
	const activity = useMemo((): { kind: 'tool'; name: string; summary?: string } | { kind: 'thinking' } | { kind: 'working' } | null => {
		if (!streaming) return null;
		const last = messages[messages.length - 1];
		// Turn dispatched but the assistant placeholder hasn't landed yet.
		if (!last || last.role !== 'assistant') return { kind: 'working' };
		let found: { kind: 'tool'; name: string; summary?: string } | { kind: 'thinking' } | null =
			// Legacy non-block path: thinking streamed onto the message itself.
			last.thinking && !last.thinkingDone ? { kind: 'thinking' } : null;
		const walk = (bs?: Block[]) => {
			for (const b of bs ?? []) {
				if (b.kind === 'tool' && b.tool.pending && !b.tool.approvalRequired) {
					found = { kind: 'tool', name: b.tool.name, summary: b.tool.summary };
				} else if (b.kind === 'reasoning' && !b.done) {
					found = { kind: 'thinking' };
				} else if (b.kind === 'subagent') {
					walk(b.children);
				}
			}
		};
		walk(last.blocks);
		// While a turn streams there is ALWAYS a line: session boot, the gap
		// between a tool result and the model's next step, and long API
		// latency all fall through to a generic "Working…" — the chat must
		// never look stuck with no explanation.
		return found ?? { kind: 'working' };
	}, [streaming, messages]);
	// Index of the latest assistant reply — the SessionStrip renders as that
	// reply's header (top of the current response).
	const lastAssistantIdx = (() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === 'assistant') return i;
		}
		return -1;
	})();

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
			{/* Floating session conversation — a running/selected cycle's session
			    rendered with the chat's own MessageBubble (AI turns + tool/stage
			    cards). Opened via studio:open-session; floats over the chat. */}
			{session && (
				<div
					className={sessionExpanded ? 'fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8 bg-slate-900/40 backdrop-blur-sm duration-150' : 'contents'}
					onClick={sessionExpanded ? (e) => { if (e.target === e.currentTarget) setSessionExpanded(false); } : undefined}
				>
				<div className={['flex flex-col rounded-2xl border border-slate-200/70 bg-white/95 backdrop-blur-sm overflow-hidden ring-1 ring-black/5 duration-200', sessionExpanded ? 'w-full max-w-3xl h-[82vh] shadow-2xl shadow-slate-900/30' : 'absolute left-3 right-3 top-3 z-40 h-1/3 max-h-[38%] shadow-[0_12px_40px_-8px_rgba(15,23,42,0.28)]'].join(' ')}>
					<div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-100 flex-shrink-0 bg-gradient-to-b from-slate-50/80 to-transparent">
						<span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-violet-100 text-violet-600 flex-shrink-0"><Bot className="w-3.5 h-3.5" /></span>
						<span className="text-[13px] font-medium text-slate-900 truncate">Session · {session.loop}</span>
						{sessionRunning ? (
							<span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-sky-600 bg-sky-50 rounded-full px-1.5 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-sky-500 running-glow" /> live</span>
						) : (
							<span className="text-[10.5px] text-slate-400 bg-slate-50 rounded-full px-1.5 py-0.5">finished</span>
						)}
						{sessionRunning && (
							<button
								onClick={async () => { try { await me.stopLoop(session.app, session.loop); setSessionRunning(false); } catch { /* toast handled elsewhere */ } }}
								title="Stop this run (marks it interrupted)"
								className="inline-flex items-center gap-1 text-[10.5px] font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-full px-1.5 py-0.5 transition-colors">
								<Square className="w-2.5 h-2.5" /> stop
							</button>
						)}
						<button onClick={() => setSessionExpanded((v) => !v)} title={sessionExpanded ? 'Shrink' : 'Pop out'} className="ml-auto p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">{sessionExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}</button>
						<button onClick={() => setSession(null)} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><X className="w-4 h-4" /></button>
					</div>
					<div ref={sessionScrollRef} className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-3 py-3 space-y-3 [&_*]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap">
						{sessionMsgs === null ? (
							<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Connecting to the session…</div>
						) : (sessionRows?.length ?? 0) === 0 ? (
							<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400">
								<Bot className="w-6 h-6 text-slate-300" />
								<div className="text-sm text-slate-500">{sessionRunning ? 'Session starting…' : 'No conversation captured for this run.'}</div>
							</div>
												) : (
							// Transcript: collapsible AI turns + compact stage lines. The latest
							// AI turn is open; earlier turns fold away (click the header).
							<div className="space-y-1">
								{(() => {
									const rows = sessionRows || [];
									let lastLlm = -1;
									rows.forEach((r, i) => { if (r.event === 'llm') lastLlm = i; });
									return rows.map((r, i) => {
										if (r.event === 'llm') return <SessionLlmTurn key={i} r={r} defaultOpen={i === lastLlm} />;
										const stopped = r.status === 'stopped' || r.status === 'interrupted';
										if (stopped) return (
											<div key={i} className="flex items-center gap-1.5 text-[11px] font-medium text-rose-600 bg-rose-50 rounded-md px-2 py-1"><Square className="w-2.5 h-2.5" /> Interrupted — stopped by user</div>
										);
										const bad = r.status === 'fail' || r.status === 'failed';
										return (
											<div key={i} className={['font-mono text-[11px] leading-relaxed pl-1', bad ? 'text-rose-500' : 'text-slate-400'].join(' ')}>
												<span className="text-slate-300">·</span> {r.stage || r.event}{r.status ? ' ' + r.status : ''}{r.variant_id || r.note ? ' — ' + String(r.variant_id || r.note).slice(0, 60) : ''}
											</div>
										);
									});
								})()}
								{sessionRunning && <div className="flex items-center gap-2 text-slate-400 pt-1 font-mono text-[11px]"><Loader2 className="w-3 h-3 animate-spin" /> <span className="animate-pulse">streaming…</span></div>}
							</div>
						)}
					</div>
				</div>
				</div>
			)}
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
					// Ignore scroll events our own stream-follow just caused —
					// measuring mid-jump mis-reads as "user scrolled up" and
					// turns auto-follow off while they never touched anything.
					if (Date.now() < selfScrollUntil.current) return;
					const el = e.currentTarget;
					// "near bottom" = within 80px of the end. Toggles whether new
					// content sticks to the bottom or leaves the user where they are.
					atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
					if (atBottomRef.current !== atBottom) setAtBottom(atBottomRef.current);
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
							<Fragment key={i}>
							{/* Claude Code session context — pill + capability chip
							    + transcripts link, only when a claude-code-* model
							    is selected. Sits at the TOP of the current response
							    (above the latest assistant reply, where the mode
							    notice used to be) so it reads as that reply's
							    session header and scrolls with the transcript.
							    pool=true for every pool-proxy-backed model —
							    Anthropic (sonnet/opus/fable) AND the oaicompat
							    externals (kimi/glm), which are recorded +
							    cost-metered. false only for the lumid-llm-backed
							    entries (qwen). */}
							{verbose && model.startsWith('claude-code') && m.role === 'assistant' && i === lastAssistantIdx && (
								<div className="pl-[38px]">
									<SessionStrip
										session={claudeSession}
										streaming={streaming}
										caps={claudeCaps}
										onClear={() => { claudeSessionRef.current = null; setClaudeSession(null); }}
									/>
								</div>
							)}
							<MessageBubble
							m={m}
							streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
							onCopy={m.role === 'assistant' && m.content ? () => copyMessage(m.content) : undefined}
							onRegenerate={m.role === 'assistant' && !streaming && i > 0 && messages[i - 1]?.role === 'user' ? () => regenerate(i) : undefined}
							// Only in a grounded app chat — a correction needs an app to
							// belong to. Forces give_feedback rather than trusting the model
							// to route it, the same reason "Ask the app" forces app_answer.
							onCorrect={m.role === 'assistant' && !streaming && docked && (workspaceApp() || currentAppRef.current)
								? async () => {
									const what = window.prompt('What was wrong with this answer?');
									if (!what) return;
									// Carry the app EXPLICITLY. The forced-tool path grounds on
									// context.app and returns nothing without it, so a correction
									// sent context-less produced an empty turn and no draft — the
									// button looked like it did nothing.
									const correctionApp = workspaceApp() || currentAppRef.current || undefined;
									const send = () => dispatchTurnRef.current?.(
										`Record a correction against this app: ${what}`,
										// app_feedback, not give_feedback: the latter scores a
										// scheduled CYCLE and needs a loop + timestamp, which an
										// interactive answer does not have.
										[], undefined,
										correctionApp ? { page: 'app', app: correctionApp } : undefined,
										undefined, 'app_feedback',
									);
									// dispatchTurn refuses while a turn is still in flight, and
									// this button becomes clickable the instant `streaming`
									// flips -- before inFlightRef clears in the previous turn's
									// finally. Clicking in that window used to discard the
									// correction the user had ALREADY TYPED, with no error and
									// no draft: the browser gate saw the prompt open and zero
									// requests leave.
									//
									// A timed retry was not enough -- the gate still caught a
									// run where both attempts were refused, because the window
									// is however long the previous turn takes, not a fixed
									// 1.2s. So QUEUE it instead: the same FIFO the composer
									// uses, which now carries tool_choice and context so a
									// forced-tool turn survives the trip. No timing window
									// left to lose the correction in.
									if (await send()) return;
									setMessageQueue((q) => [...q, {
										text: `Record a correction against this app: ${what}`,
										attachments: [],
										ctxOverride: correctionApp ? { page: 'app', app: correctionApp } : undefined,
										toolChoice: 'app_feedback',
									}]);
									toast('Correction queued — it will send when the current answer finishes.');
								}
								: undefined}
							onSpeak={m.role === 'assistant' && m.content && typeof window !== 'undefined' && 'speechSynthesis' in window ? () => toggleSpeak(i, m.content) : undefined}
							isSpeaking={speakingIdx === i}
							onToolApprove={handleToolApprove}
						/>
							</Fragment>
						))}
						{/* Turn telemetry from the Claude Code `result` event —
						    cost, wall/API duration, time-to-first-token, steps and
						    the cache hit split. Attached to the finished reply. */}
						{verbose && turnStats && !streaming && messages[messages.length - 1]?.role === 'assistant' && (
							<div className="pl-[38px]"><TurnStatsFooter s={turnStats} /></div>
						)}
					</div>
				)}
			</div>

			<footer className="relative z-30 flex-shrink-0 px-4 pt-1 pb-4">
				{/* Jump to latest — the transcript had no way back down once you
				    scrolled up, and auto-scroll deliberately stops following you. */}
				<AnimatePresence>
					{!atBottom && messages.length > 0 && (
						<JumpToLatest onClick={() => {
							const el = transcriptRef.current;
							if (el) el.scrollTo({ top: el.scrollHeight, behavior: motionOK ? 'smooth' : 'auto' });
							atBottomRef.current = true; setAtBottom(true);
						}} />
					)}
				</AnimatePresence>
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
				{/* Live activity — pinned above the composer so a working turn
				    never "looks stuck": names the running tool (or thinking)
				    with a ticking elapsed counter. Own component so its 1 Hz
				    tick re-renders ~20 nodes, not the whole chat root. */}
				{activity && <ActivityLine activity={activity} />}
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
								{/* Ask the app — only meaningful when a grounded app is in
								    context. Explicit beats inferred: the model does not pick
								    the app's analyst on its own, so this is how the user says
								    "answer as this app" rather than hoping. Turn it OFF for
								    administrative asks ("list my cases", "run the workflow"). */}
								{docked && (
									<>
										<div className="h-px bg-muted my-1 mx-2" />
										<button
											type="button"
											onClick={() => setAskApp((v) => !v)}
											title="Answer using this app's analyst, prompts and scoring rubric"
											className={[
												'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
												askApp ? 'bg-emerald-50 text-emerald-700' : 'text-foreground hover:bg-muted/60',
											].join(' ')}
										>
											<Boxes className={['w-3.5 h-3.5', askApp ? 'text-emerald-600' : 'text-muted-foreground'].join(' ')} />
											<span className="font-medium flex-1 text-left">Ask the app</span>
											{askApp && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
										</button>
										{/* Interview mode — who sits in which seat. Switching mid-case
										    inverts the roles halfway through a conversation, which
										    reads as the assistant losing the plot, so a switch starts
										    a fresh thread. */}
										<div className="h-px bg-muted my-1 mx-2" />
										<div className="px-2.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
											Interview mode
										</div>
										{([
											{ id: 'train_ai', label: 'Train the AI', hint: 'You interview, the AI answers and is scored' },
											{ id: 'free', label: 'Free answering', hint: 'Ask anything — score is indicative, no ground truth' },
											{ id: 'coach', label: 'Train me', hint: 'The AI interviews YOU and scores your answers' },
										] as const).map((m) => (
											<button
												key={m.id}
												type="button"
												onClick={() => {
													if (m.id === interviewMode) return;
													setInterviewMode(m.id);
													// A fresh thread: the seats just swapped.
													window.dispatchEvent(new CustomEvent('studio:new-app-chat', {
														detail: { app: groundApp || undefined },
													}));
												}}
												title={m.hint}
												className={[
													'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors',
													interviewMode === m.id ? 'bg-sky-50 text-sky-800' : 'text-foreground hover:bg-muted/60',
												].join(' ')}
											>
												<GraduationCap className={['w-3.5 h-3.5', interviewMode === m.id ? 'text-sky-600' : 'text-muted-foreground'].join(' ')} />
												<span className="font-medium flex-1 text-left">{m.label}</span>
												{interviewMode === m.id && <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
											</button>
										))}
									</>
								)}
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
								if (verbose && v.startsWith('/')) {
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
							// Fresh chat keeps the roomy 64px hero box; once the
							// conversation is going the composer shrinks to a single
							// line so the transcript owns the vertical space.
							// field-sizing:content lets it grow with the draft (up
							// to max-h-48) on browsers that support it.
							style={{
								minHeight: messages.length === 0 ? '64px' : '34px',
								outline: 'none', boxShadow: 'none',
								...({ fieldSizing: 'content' } as Record<string, string>),
							}}
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
							onClick={async () => {
								// Cooperative stop: the CLI finishes its current tool,
								// flushes a real result, and persists session state, so
								// the turn stays resumable. Aborting the fetch alone
								// SIGKILLed the process and discarded partial work.
								const turn = turnIdRef.current;
								if (turn) {
									try {
										const r = await fetch('/api/v1/me/agent/chat/interrupt', {
											method: 'POST',
											credentials: 'include',
											headers: { 'Content-Type': 'application/json' },
											body: JSON.stringify({ turn_id: turn }),
										});
										if (r.ok) {
											// The stream should now end itself with `stopped`. Don't
											// trust it blindly: if the CLI can't service the
											// interrupt, `streaming` would stay true forever and the
											// button would be dead. Hard-abort as a backstop.
											const ac = abortRef.current;
											setTimeout(() => { if (abortRef.current === ac) ac?.abort(); }, 8000);
											return;
										}
									} catch { /* fall through to the hard abort */ }
								}
								abortRef.current?.abort();
							}}
							title="Stop current turn"
							aria-label="Stop generating"
							className="order-5 h-8 w-8 flex items-center justify-center rounded-full flex-shrink-0 bg-rose-500 text-white hover:bg-rose-600 active:scale-95 shadow-sm shadow-rose-200 transition-all"
						>
							<Square className="w-3 h-3 fill-current" />
						</button>
					)}
					{/* Right-side group: model picker (moved from the header) then
					    the round black send.
					    The pool-quota pill used to sit here; it was noise in the
					    composer and the same numbers live on lum.id/code. */}
					<div className="order-3 flex-1 min-w-[8px]" />
					{verbose && (
					<div className="order-4 flex-shrink-0 flex items-center gap-1">
						{/* The "Context · N" chip (WorkspaceChip) used to sit here. Removed
						    from the composer: it exposed xpio repo / FlowMesh cluster /
						    lumid-data app pickers — engineer-facing choices a researcher
						    has no basis to make, occupying prime space next to the input.
						    The component and its state (wsRepo/wsCluster/wsDataApp) are
						    intentionally KEPT and still sent with the turn, so defaults
						    are unchanged and a settings surface can expose them again
						    without rebuilding the mechanism. */}
						<ModelChip
							streaming={streaming}
							models={models}
							model={model}
							setModel={setModel}
							groundApp={groundApp}
						/>
					</div>
					)}
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
				</div>
			</footer>
		</div>
	);
}

// A finished, successful, card-less tool step is "quiet" — in Simple mode a
// run of these collapses into one QuietGroup line instead of a wall of pills.
// Pending / failed / approval-needed / card-bearing tools are NEVER absorbed
// (progress, errors, and entity cards must stay visible).
function isQuietToolBlock(b: Block): boolean {
	return b.kind === 'tool' && !b.tool.pending && b.tool.ok === true && !b.tool.approvalRequired && !entityCardFor(b.tool);
}
type RenderUnit = { kind: 'block'; block: Block } | { kind: 'group'; blocks: Block[] };
function groupQuietBlocks(blocks: Block[], enabled: boolean): RenderUnit[] {
	if (!enabled) return blocks.map((block) => ({ kind: 'block', block }));
	const units: RenderUnit[] = [];
	let run: Block[] = [];
	const flush = () => {
		if (run.length >= 2) units.push({ kind: 'group', blocks: run });
		else run.forEach((block) => units.push({ kind: 'block', block }));
		run = [];
	};
	for (const b of blocks) {
		if (isQuietToolBlock(b)) { run.push(b); continue; }
		flush();
		units.push({ kind: 'block', block: b });
	}
	flush();
	return units;
}
// QuietGroup — a collapsed 'Worked through N steps ✓' line that expands to the
// individual (friendly-labeled) tool pills. Keeps a busy turn to one calm row.
function QuietGroup({ members, render }: { members: Block[]; render: (b: Block) => JSX.Element }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="mt-1 flex flex-col items-start">
			<button
				onClick={() => setOpen((o) => !o)}
				className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border/60 bg-muted/40 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
			>
				<span className="text-[10px] text-emerald-600">✓</span>
				<span>Worked through {members.length} steps</span>
				<ChevronDown className={['w-3 h-3 opacity-50 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			{open && <div className="mt-1 flex flex-col gap-1 pl-2 border-l border-border/50">{members.map(render)}</div>}
		</div>
	);
}

const MessageBubble = memo(function MessageBubble({
	m,
	streaming,
	onCopy,
	onRegenerate,
	onCorrect,
	onSpeak,
	isSpeaking,
	onToolApprove,
}: {
	m: Message;
	streaming?: boolean;
	onCopy?: () => void;
	onRegenerate?: () => void;
	onCorrect?: () => void;
	onSpeak?: () => void;
	isSpeaking?: boolean;
	onToolApprove?: (approvalId: string, approved: boolean, always?: boolean, tool?: string) => void;
}) {
	const isUser = m.role === 'user';
	const [copied, setCopied] = useState(false);
	// Simple mode coalesces a run of finished tool steps into one calm line.
	const { advanced } = useViewMode();
	const showActions = !streaming && (onCopy || onRegenerate || onSpeak);

	// Blocks in ARRIVAL order. Legacy messages (persisted threads, the
	// studio:notify note, app-opener turns, xpio cycle rows) have no `blocks`,
	// so blocksOf() synthesizes them in the exact order this component used to
	// hardcode — those render byte-identically to before.
	const blocks = useMemo(() => blocksOf(m), [
		m.blocks, m.content, m.thinking, m.thinkingDone, m.tools,
		m.composed, m.appSurface, m.chips, m.role,
	]);
	// The typing placeholder belongs to the BUBBLE, not to a block: while
	// streaming, an empty text block simply doesn't exist yet.
	const noTextYet = !blocks.some((b) => b.kind === 'text' && b.text);
	// An "agentic" turn interleaves tools/reasoning/sub-agents with narration.
	// There, each text block is a one-sentence aside between steps, and wrapping
	// every one in a chunky card produced a stack of 7 bubbles that dominated
	// the transcript. Claude Code renders that narration as light flowing text,
	// so on agentic turns assistant text drops the card. A plain chat answer
	// (single text block, no tools) keeps its bubble.
	const agentic = blocks.some((b) => b.kind === 'tool' || b.kind === 'subagent' || b.kind === 'reasoning');

	const blockProps = {
		isUser, streaming, onToolApprove,
		// Tool rows sit tight (mt-1) rather than mt-2: a turn can fire seven in a
		// row, and a full gap between each read as scattered debris rather than
		// one sequence of steps. A running tool pulses so it's findable in a
		// dense transcript.
		renderTool: (t: ToolCall, onApprove?: (approved: boolean, always?: boolean) => void) => {
			const row = (
				<div className={['mt-1 flex flex-col', isUser ? 'items-end' : 'items-start'].join(' ')}>
					<ToolChip t={t} onApprove={onApprove} />
				</div>
			);
			return t.pending && !t.approvalRequired ? <Working>{row}</Working> : row;
		},
		// `live` marks the block currently being written, so the caret sits at
		// the true end of the stream. Before this, the three bouncing dots
		// vanished on the first token and the text then grew with nothing
		// marking the live edge.
		renderText: (text: string, done?: boolean) => {
			// Light narration on agentic assistant turns; keep the bubble for
			// user messages and plain chat answers.
			if (!isUser && agentic) {
				return (
					<div className="max-w-full text-[13.5px] leading-relaxed text-left px-1 mt-2 first:mt-0 text-foreground/90">
						<ChatMarkdown>{text}</ChatMarkdown>
						{streaming && !done && <StreamCaret />}
					</div>
				);
			}
			return (
				<div className={[
					'inline-block max-w-full text-[13.5px] rounded-2xl px-3.5 py-2.5 leading-relaxed text-left shadow-sm mt-2 first:mt-0',
					isUser
						? 'bg-primary text-primary-foreground rounded-tr-md'
						: 'bg-card text-foreground border border-border rounded-tl-md',
				].join(' ')}>
					{isUser
						? <div className="whitespace-pre-wrap break-words">{text}</div>
						: <ChatMarkdown>{text}</ChatMarkdown>}
					{!isUser && streaming && !done && <StreamCaret />}
				</div>
			);
		},
		renderReasoning: (text: string, done: boolean, elapsedMs?: number, tokens?: number) => (
			<ThinkingBlock thinking={text} done={done} elapsedMs={elapsedMs} tokens={tokens} />
		),
		renderCard: (card: Extract<Block, { kind: 'card' }>['card']) => {
			if (card.type === 'assembly') return <AssemblyCard draft={card.draft} />;
			if (card.type === 'appSurface') {
				return <div className="mb-2"><AppSurfaceCard app={card.app} surface={card.surface} /></div>;
			}
			return <EntityCardBlock tool={card.tool} />;
		},
		renderChips: (chips: NonNullable<Message['chips']>) => (
			<div className="mt-2 flex flex-wrap gap-1.5">
				{chips.map((c) => (
					<button key={c.label}
						onClick={() => window.dispatchEvent(new CustomEvent('studio:ask', { detail: { prompt: c.prompt, autosend: true, context: c.context } }))}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
						{c.label}
					</button>
				))}
			</div>
		),
	};

	return (
		<Appear className={['group flex gap-2.5', isUser ? 'flex-row-reverse' : ''].join(' ')}>
			<div className={[
				'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm',
				isUser
					? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white'
					: 'bg-gradient-to-br from-gold-400 to-gold-600 text-white shadow-gold-100',
			].join(' ')}>
				{isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
			</div>
			<div className={['min-w-0 flex-1', isUser ? 'text-right' : ''].join(' ')}>
				{/* Blocks in arrival order. Text→tool→text now renders as it
				    happened instead of all text above all tools, and a
				    sub-agent's calls nest under the Task that spawned them.
				    NOTE a deliberate behavior change: the AssemblyCard used to
				    be forced FIRST; it now lands where compose_workflow
				    actually completed. The original anti-flicker reason still
				    holds because blocks only ever append. */}
				{groupQuietBlocks(blocks, !advanced && !streaming).map((unit, i) => {
					if (unit.kind === 'group') {
						return (
							<Appear key={unit.blocks[0].id}>
								<QuietGroup members={unit.blocks} render={(mb) => <BlockView key={mb.id} {...blockProps} b={mb} />} />
							</Appear>
						);
					}
					const b = unit.block;
					// Visual attention: while a turn is streaming, the newest block
					// is the live one — earlier steps recede to ~55% so the eye
					// tracks the current action instead of the whole wall. Once the
					// turn settles, everything returns to full weight.
					const settled = streaming && i < blocks.length - 1;
					return (
						<Appear key={b.id}>
							<div className={['transition-opacity duration-500', settled ? 'opacity-55 hover:opacity-100' : ''].join(' ')}>
								<BlockView {...blockProps} b={b} />
							</div>
						</Appear>
					);
				})}
				{/* Files the user attached to this turn — a chip per file so the
				    upload stays visible on the bubble + across reloads (the body
				    is stripped on persist; the chip is not). */}
				{isUser && m.attachments && m.attachments.length > 0 && (
					<div className="mt-1.5 flex flex-wrap gap-1.5 justify-end">
						{m.attachments.map((a, ai) => (
							<span key={ai} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-[11px] max-w-[220px]">
								{a.kind === 'image' ? <ImageIcon className="w-3 h-3 flex-shrink-0" />
									: a.kind === 'document' ? <FileText className="w-3 h-3 flex-shrink-0" />
										: <Paperclip className="w-3 h-3 flex-shrink-0" />}
								<span className="truncate">{a.name}</span>
							</span>
						))}
					</div>
				)}
				{/* Pre-first-token placeholder — bubble-level, see noTextYet. */}
				{noTextYet && streaming && !m.composed && (
					<div className={[
						'inline-block max-w-full rounded-2xl px-3.5 py-2.5 shadow-sm mt-2',
						'bg-card text-foreground border border-border rounded-tl-md',
					].join(' ')}>
						<span className="inline-flex gap-1 items-center">
							<span className="w-1.5 h-1.5 bg-gold-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
							<span className="w-1.5 h-1.5 bg-gold-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
							<span className="w-1.5 h-1.5 bg-gold-400 rounded-full animate-bounce" />
						</span>
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
				{/* Tool chips are blocks now (rendered above, in order) — the old
				    flat trailing list would double-render them.
				    The crude ~4-chars/token per-message estimate that used to sit
				    here is gone: the turn footer (TurnStatsFooter) now shows the
				    real output-token count for Claude Code turns, and a guessed
				    number next to an accurate one just read as a contradiction. */}
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
						{/* Correct this — the deliberate counterpart to Regenerate. Regenerate
						    asks for a different answer; this says the answer was WRONG and
						    routes that judgement to the app so it is staged for review and
						    can improve later turns. Typing "that was wrong" in the composer
						    does not do it: the model does not route a free-form correction
						    to the app's feedback path on its own. */}
						{onCorrect && (
							<button
								type="button"
								onClick={onCorrect}
								title="Mark this answer wrong and record a correction for review"
								className="p-1 rounded text-[10px] text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
							>
								<ThumbsDown className="w-3 h-3" />
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
		</Appear>
	);
}, (a, b) =>
	// Skip re-render unless the MESSAGE changed. The call site passes fresh
	// inline callbacks every render, so default memo never holds; compare only
	// meaningful fields. Stops every keystroke/poll from re-parsing the whole
	// transcript — the cause of the "fast at first, slower and slower" lag.
	a.m.role === b.m.role &&
	// `blocks` is the primary identity for block-produced messages. Every
	// mutator in ./chat/blocks returns a NEW array along the mutated path
	// (including inside SubagentBlock.children) — a missed clone there shows up
	// as "sub-agent output freezes mid-stream".
	a.m.blocks === b.m.blocks &&
	a.m.content === b.m.content &&
	// thinking/thinkingDone MUST be compared. A thinking delta changes only
	// these two fields, so omitting them made the comparator report "equal"
	// and the bubble never re-rendered — reasoning sat invisible until some
	// other field moved (first text delta, a tool_start, or end of turn).
	a.m.thinking === b.m.thinking &&
	a.m.thinkingDone === b.m.thinkingDone &&
	a.m.tools === b.m.tools &&
	a.m.composed === b.m.composed &&
	a.m.appSurface === b.m.appSurface &&
	a.m.chips === b.m.chips &&
	a.streaming === b.streaming &&
	a.isSpeaking === b.isSpeaking)

// ActivityLine — the "what is Claude doing right now" strip above the
// composer. Owns its own elapsed-seconds state so the 1 Hz tick re-renders
// only this subtree; the chat root re-renders only when the ACTIVITY changes.
function ActivityLine({ activity }: {
	activity: { kind: 'tool'; name: string; summary?: string } | { kind: 'thinking' } | { kind: 'working' };
}) {
	const key = activity.kind === 'tool' ? `t:${activity.name}:${activity.summary ?? ''}` : activity.kind;
	const [elapsed, setElapsed] = useState(0);
	useEffect(() => {
		const started = Date.now();
		setElapsed(0);
		const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
		return () => clearInterval(t);
	}, [key]);
	return (
		<div className="flex items-center gap-1.5 px-2 pb-1 text-[11px] text-gold-700" aria-live="polite">
			<Loader2 className="w-3 h-3 animate-spin" />
			{activity.kind === 'tool' ? (
				<span className="truncate">
					Running <span className="font-mono font-medium">{activity.name}</span>
					{activity.summary && <span className="opacity-70"> · {activity.summary.slice(0, 70)}</span>}
					{elapsed >= 3 && <span className="opacity-60"> — {elapsed}s</span>}
				</span>
			) : (
				<span>
					{activity.kind === 'thinking' ? 'Thinking…' : 'Working…'}
					{elapsed >= 3 && <span className="opacity-60"> — {elapsed}s</span>}
				</span>
			)}
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
function ThinkingBlock({ thinking, done, elapsedMs, tokens }: { thinking: string; done: boolean; elapsedMs?: number; tokens?: number }) {
	// Auto-open while the model streams a VISIBLE trace so you can watch it,
	// then auto-collapse once it's done so the finished answer isn't buried
	// under a wall of reasoning. Starts closed (encrypted-reasoning models
	// never produce text, and their explainer shouldn't pop open unasked).
	// Sticky against a user who clicked either way.
	const [open, setOpen] = useState(false);
	const touched = useRef(false);
	const wasStreaming = useRef(!done);
	useEffect(() => {
		if (!done && thinking && !touched.current) setOpen(true);
		if (wasStreaming.current && done && !touched.current) setOpen(false);
		wasStreaming.current = !done;
	}, [done, thinking]);
	// Prefer the provider's own count (system/thinking_tokens); the ~4-chars
	// estimate is the fallback for providers that don't report one.
	const tokenCount = tokens ?? (thinking.length ? Math.max(1, Math.round(thinking.length / 4)) : 0);
	// The CLI reports thinking tokens in ~50-token quanta, which made the live
	// label jump 0 → 50 → 95 → …. Tick the DISPLAYED count toward the latest
	// report so it reads as a live counter; snap once the block is done.
	// Fixed ~100ms cadence with an adaptive step (not +1 per tick): a +1/15ms
	// version was ~66 renders/s and still needed 75s to catch a 5K-token
	// report it was chasing.
	const [shownCount, setShownCount] = useState(tokenCount);
	useEffect(() => {
		if (done || shownCount > tokenCount) { setShownCount(tokenCount); return; }
		if (shownCount === tokenCount) return;
		const diff = tokenCount - shownCount;
		const t = setTimeout(
			() => setShownCount((s) => Math.min(tokenCount, s + Math.max(1, Math.ceil(diff / 12)))),
			100,
		);
		return () => clearTimeout(t);
	}, [done, shownCount, tokenCount]);
	const liveCount = done ? tokenCount : shownCount;
	// 1000+ reads as 1.1K / 2.5K — the raw figure gets long and the precision
	// is meaningless past a thousand (the count is an estimate anyway).
	const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}K` : String(n));
	// Duration comes from the block's own start/end stamps when available
	// (block model); legacy messages have none and keep the token-only label.
	const secs = elapsedMs !== undefined && elapsedMs > 900 ? Math.round(elapsedMs / 1000) : 0;
	// A reasoning block with no content and no tokens is noise — the CLI opens
	// one speculatively on many turns, which rendered as a stray
	// "Thought (0 tokens)" pill.
	if (done && !thinking && !tokenCount) return null;
	const label = done
		? (tokenCount
			? (secs ? `Thought for ${secs}s (${fmt(tokenCount)} tokens)` : `Thought (${fmt(tokenCount)} tokens)`)
			: (secs ? `Thought for ${secs}s` : 'Thought'))
		: liveCount > 0
			? `Thinking… ${fmt(liveCount)} tokens`
			: 'Thinking…';
	// Current Claude models return reasoning ENCRYPTED — only a signature and
	// a token count ever reach us, so the text stays empty for the whole turn.
	// The pill stays clickable either way: with text it expands the trace;
	// without text it expands a one-line explanation of WHY there is no trace
	// (a dead pill read as a bug, and "(no content yet)" read as a worse one).
	// Real traces come back the moment a provider streams reasoning text
	// (lumid-llm <think> models, legacy Anthropic thinking).
	return (
		<div className="mb-1.5">
			<button
				type="button"
				onClick={() => { touched.current = true; setOpen((v) => !v); }}
				className="inline-flex items-center gap-1 text-[11px] text-gold-700 bg-gold-50/80 hover:bg-gold-100/80 border border-gold-200 rounded-full px-2 py-0.5 transition-colors"
			>
				<Brain className="w-3 h-3" />
				<span>{label}</span>
				{!done && <ThinkingDots />}
				<ChevronDown
					className={['w-3 h-3 transition-transform', open ? 'rotate-180' : ''].join(' ')}
				/>
			</button>
			<Collapse open={open}>
				<div className="mt-1.5 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground bg-gold-50/40 border border-gold-100 rounded-xl whitespace-pre-wrap break-words">
					{thinking || (
						<span className="italic">
							Claude keeps its reasoning private — the API returns it encrypted, so only
							the duration and token count are visible. Models that stream open reasoning
							(e.g. the qwen entries) show their full trace here.
						</span>
					)}
				</div>
			</Collapse>
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
	const [ccExpanded, setCcExpanded] = useState(false);
	// Simple mode hushes the low-level mechanics: Claude Code tool views
	// (terminal blocks, diffs, checklists, raw JSON) collapse to one calm
	// QuietToolPill the user can click to expand. Advanced shows them verbatim.
	const { advanced } = useViewMode();
	// Claude Code tool names (Bash, Edit, TodoWrite, …) arrive verbatim from
	// the claude-sandbox stream and get claude.ai/code-style rich views.
	// Approval never applies to them (the CLI runs its own tools), so the
	// dispatch is safe ahead of the approval branch below.
	// Simple mode: if this tool renders its own entity card (a separate 'card'
	// block carries the meaning), drop the redundant pill entirely — this must
	// run BEFORE the CCView branch, else mcp__ tools show a stray "Worked on
	// it" QuietToolPill above their card.
	if (!advanced && !t.pending && t.ok && !t.approvalRequired && entityCardFor(t)) return null;
	const CCView = !t.approvalRequired ? claudeToolView(t.name) : null;
	if (CCView) {
		if (!advanced && !ccExpanded) return <QuietToolPill t={t} onExpand={() => setCcExpanded(true)} />;
		return <CCView t={t} />;
	}
	// In Simple mode, when this tool renders its own entity card (chart,
	// leaderboard, app surface, list…), the card carries the meaning — so drop
	// the redundant tool-name pill above it. Keep the pill while pending or on
	// failure so progress and errors stay visible.
	if (!advanced && !t.pending && t.ok && entityCardFor(t)) return null;
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
	// id is historical (see me_agent.go) — it now serves DeepSeek-V4-Flash on the
	// GB10 pair, not Gemma-4 (and not Qwen3.8, which it served in between).
	if (id === 'kvrun-gemma4') return 'DeepSeek';
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
// via the shared useClickOutside hook (src/hooks/useClickOutside.ts).


function ModelChip({
	streaming, models, model, setModel, groundApp,
}: {
	streaming: boolean;
	models: ModelOption[];
	model: string;
	setModel: (id: string) => void;
	groundApp?: string | null;
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
				{groundApp && !modelHasAppTools(current) && (
					<AlertTriangle className="w-3 h-3 flex-shrink-0 text-amber-500" />
				)}
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
							{groundApp && !modelHasAppTools(m) && (
								<span className="text-[10px] text-amber-600 whitespace-nowrap">no app tools</span>
							)}
							{m.id === model && <span className="w-1.5 h-1.5 rounded-full bg-gold-500" />}
						</button>
					))}
					{groundApp && models.some((m) => !modelHasAppTools(m)) && (
						<p className="px-2.5 pt-1.5 pb-1 text-[10px] leading-snug text-muted-foreground border-t border-border mt-1">
							Models marked <span className="text-amber-600">no app tools</span> can’t read
							this app’s data or score answers.
						</p>
					)}
				</div>
			)}
		</div>
	);
}

// WorkspaceChip — the session working context (like picking a git repo): which
// xpio repo the knowledge tools default to, which FlowMesh cluster compute runs
// on (sandbox is the mandatory runtime; cluster is optional — default = in-cluster),
// and which lumid-data app data tools query. Sent as xpio_repo/cluster_id/data_app.
function WorkspaceChip({
	repos, clusters, dataApps, repo, setRepo, cluster, setCluster, dataApp, setDataApp,
}: {
	repos: { id: string; label: string }[];
	clusters: { id: string; label: string }[];
	dataApps: { id: string; label: string }[];
	repo: string; setRepo: (v: string) => void;
	cluster: string; setCluster: (v: string) => void;
	dataApp: string; setDataApp: (v: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useClickOutside(open, () => setOpen(false));
	const active = [repo, cluster, dataApp].filter(Boolean).length;
	const sel = 'w-full text-[12px] rounded-lg border border-border bg-card px-2 py-1 text-foreground focus:outline-none focus:border-foreground/25';
	const hdr = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1';
	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={[
					'inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full border text-[11px] transition-colors',
					open || active
						? 'bg-muted border-foreground/25 text-foreground'
						: 'bg-card border-border text-foreground/70 hover:text-foreground hover:border-foreground/25',
				].join(' ')}
				title="Working context — xpio repo, FlowMesh cluster, lumid-data app"
			>
				<Boxes className="w-3 h-3 flex-shrink-0 opacity-70" />
				<span className="truncate max-w-[110px]">{active ? `Context · ${active}` : 'Context'}</span>
				<ChevronDown className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
			</button>
			{open && (
				<div className="absolute bottom-full right-0 mb-1 z-50 w-[264px] p-2.5 rounded-xl border border-border bg-card shadow-lg shadow-foreground/5 space-y-2.5">
					<div>
						<div className={hdr}>xpio repo</div>
						<select className={sel} value={repo} onChange={(e) => setRepo(e.target.value)}>
							<option value="">All my knowledge (default)</option>
							{repos.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
						</select>
					</div>
					<div>
						<div className={hdr}>FlowMesh cluster</div>
						<select className={sel} value={cluster} onChange={(e) => setCluster(e.target.value)}>
							<option value="">Scheduler + sandbox (in-cluster)</option>
							{clusters.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
						</select>
					</div>
					<div>
						<div className={hdr}>lumid-data app</div>
						<select className={sel} value={dataApp} onChange={(e) => setDataApp(e.target.value)}>
							<option value="">Default data instance</option>
							{dataApps.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
						</select>
					</div>
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
