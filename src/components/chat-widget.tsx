// Floating chat widget — the natural-interaction surface for /app/*.
//
// v2 features:
//   - ⌘K / Ctrl+K toggles open/close globally
//   - Esc closes when focused
//   - Conversation persists in sessionStorage (survives reload)
//   - Stop button mid-stream (AbortController)
//   - Clickable quick-action chips on empty state (no blank-page anxiety)
//   - Follow-up suggestion chips after each agent response
//   - Friendlier tool-call pills ("Installed personal-agent" not "✓ install_app")
//   - Clear-conversation button in header
//   - Custom-event bridge: any page can dispatch
//       window.dispatchEvent(new CustomEvent("lumid:open-chat", {detail:{prompt:"..."}}))
//     to summon the widget AND send a message in one shot.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Send, X, Sparkles, Loader2, CheckCircle2, AlertCircle,
  Square, Trash2, Command,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE_URL } from "@/config/env";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCallSummary[];
}

interface ToolCallSummary {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  ok: boolean;
}

const STORAGE_KEY = "lumid:chat:v1";
const MAX_PERSISTED_MESSAGES = 40;

// Initial chips shown when the conversation is empty. Clicking sends
// the prompt immediately rather than filling the textbox — fewer clicks,
// more conversational.
const STARTER_PROMPTS: { label: string; prompt: string }[] = [
  { label: "What ran today?",        prompt: "Show me a digest of what my loops produced today, with the most interesting result first." },
  { label: "Install something",      prompt: "Help me pick something useful to install — ask me what I want automated." },
  { label: "Search my knowledge",    prompt: "Search across what I already know and surface the 3 most relevant memories to today." },
  { label: "What should I do next?", prompt: "Look at my recent cycles and suggest one concrete next action I should take." },
];

// After an agent response, infer 2-3 sensible follow-ups from which
// tool was last called. Server-agnostic — pure client-side rules.
const TOOL_FOLLOWUPS: Record<string, string[]> = {
  list_apps:           ["Run a one-shot now",    "Install something new",         "What's each one for?"],
  list_recent_cycles:  ["Show the latest result", "Rate the most recent one",     "Run another now"],
  query_my_knowledge:  ["Search for something else", "What apps do I have?",      "What ran today?"],
  list_marketplace:    ["Install one of these",  "Show me what's trending",       "What's similar to what I have?"],
  install_app:         ["Run a one-shot now",    "What does it do?",              "List my apps"],
  uninstall_app:       ["What's left installed?", "Install something else",       "What should I run now?"],
  give_feedback:       ["What's next?",          "Show cycles waiting for review", "Run a new cycle"],
  run_loop_now:        ["Show me the result when it's done", "What else can I run?", "List recent cycles"],
  subscribe_to_bank:   ["What memories did I just inherit?", "Run a cycle to use them", "Search my knowledge"],
};
const DEFAULT_FOLLOWUPS = ["What can you do?", "Show me what I have", "What's next?"];

// Map raw tool name + result into a human-readable pill label.
// Keeps the pill ≤ 1 line; full result toggle below shows the JSON.
function pillLabel(tc: ToolCallSummary): string {
  const r = tc.result || {};
  switch (tc.name) {
    case "list_apps": {
      const n = (r.count as number | undefined) ?? (Array.isArray(r.apps) ? r.apps.length : 0);
      return `Listed your apps (${n})`;
    }
    case "install_app": {
      const name = (r.name as string) || (tc.args.slug as string) || "app";
      return tc.ok ? `Installed ${name}` : `Install failed: ${name}`;
    }
    case "uninstall_app": {
      const name = (tc.args.app as string) || "app";
      return tc.ok ? `Uninstalled ${name}` : `Uninstall failed: ${name}`;
    }
    case "run_loop_now": {
      const app = (tc.args.app as string) || "?";
      const loop = (tc.args.loop as string) || "?";
      return tc.ok ? `Queued ${app}/${loop}` : `Couldn't queue ${app}/${loop}`;
    }
    case "give_feedback": {
      const rating = (tc.args.rating as number | undefined) ?? "?";
      return tc.ok ? `Recorded rating (${rating}/5)` : `Couldn't record rating`;
    }
    case "list_recent_cycles": {
      const cycles = Array.isArray(r.cycles) ? r.cycles : [];
      return `Found ${cycles.length} recent cycle${cycles.length === 1 ? "" : "s"}`;
    }
    case "list_marketplace": {
      const apps = Array.isArray(r.apps) ? r.apps : [];
      return `Found ${apps.length} marketplace app${apps.length === 1 ? "" : "s"}`;
    }
    case "query_my_knowledge": {
      const hits = Array.isArray(r.hits) ? r.hits : [];
      return `Found ${hits.length} memor${hits.length === 1 ? "y" : "ies"}`;
    }
    case "subscribe_to_bank": {
      const src = (tc.args.source_slug as string) || "bank";
      return tc.ok ? `Subscribed to ${src}` : `Subscribe failed: ${src}`;
    }
    default:
      return tc.name; // fallback: just the raw verb
  }
}

function loadPersisted(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(loadPersisted);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [followups, setFollowups] = useState<string[]>([]);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Persist trimmed history. Avoid persisting the empty-assistant
  // placeholder mid-stream — strip trailing empties on save.
  useEffect(() => {
    try {
      const trimmed = messages.filter((m, i) =>
        !(i === messages.length - 1 && m.role === "assistant" && !m.content && !(m.tool_calls?.length))
      );
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(trimmed.slice(-MAX_PERSISTED_MESSAGES)),
      );
    } catch { /* quota full / disabled — non-fatal */ }
  }, [messages]);

  // Auto-scroll to bottom on new content. Could fight the user if
  // they scroll up mid-stream; let it for now — most chats are short.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Streaming send. Wrapped in useCallback so the custom-event bridge
  // (and the ?ask=… effect) can call it with the latest closure.
  const send = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || busy) return;

    // Clear follow-ups + draft, snapshot user message into history,
    // then append an empty assistant message we'll mutate as deltas land.
    setFollowups([]);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError(null);

    setMessages((cur) => [...cur, { role: "assistant", content: "", tool_calls: [] }]);
    const appendDelta = (delta: string) =>
      setMessages((cur) => {
        const out = [...cur];
        const last = out[out.length - 1];
        out[out.length - 1] = { ...last, content: (last.content || "") + delta };
        return out;
      });
    let lastToolName: string | null = null;
    const appendToolCall = (tc: ToolCallSummary) =>
      setMessages((cur) => {
        const out = [...cur];
        const last = out[out.length - 1];
        out[out.length - 1] = {
          ...last,
          tool_calls: [...(last.tool_calls || []), tc],
        };
        lastToolName = tc.name;
        return out;
      });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const resp = await fetch(`${API_BASE_URL}/api/v1/me/agent/chat/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          const j = await resp.json();
          msg = j.message || msg;
        } catch { /* non-JSON body — keep msg */ }
        throw new Error(msg);
      }
      if (!resp.body) throw new Error("no response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = pending.indexOf("\n\n")) >= 0) {
          const chunk = pending.slice(0, nl);
          pending = pending.slice(nl + 2);
          if (!chunk.startsWith("data: ")) continue;
          const raw = chunk.slice(6).trim();
          if (!raw) continue;
          try {
            const evt = JSON.parse(raw);
            switch (evt.type) {
              case "text":
                if (evt.delta) appendDelta(evt.delta);
                break;
              case "tool_call":
                appendToolCall(evt as ToolCallSummary);
                break;
              case "error":
                throw new Error(evt.message || "stream error");
              case "done":
              case "usage":
              default:
                break;
            }
          } catch (e) {
            console.warn("chat stream parse:", e, raw);
          }
        }
      }
      // Decide follow-up chips. Prefer the last tool's specific suggestions;
      // fall back to defaults if no tool fired (pure-text response).
      setFollowups(lastToolName ? (TOOL_FOLLOWUPS[lastToolName] ?? DEFAULT_FOLLOWUPS) : DEFAULT_FOLLOWUPS);
    } catch (e) {
      // AbortError is the user clicking Stop — show "stopped" inline,
      // don't blow away the partial assistant response.
      const aborted = (e instanceof DOMException && e.name === "AbortError")
        || (e instanceof Error && /aborted/i.test(e.message));
      if (aborted) {
        appendDelta("\n\n_(stopped)_");
      } else {
        setError(e instanceof Error ? e.message : String(e));
        // Drop the empty-assistant placeholder if we never got any content.
        setMessages((cur) => {
          const last = cur[cur.length - 1];
          if (last?.role === "assistant" && !last.content && !(last.tool_calls?.length)) {
            return cur.slice(0, -1);
          }
          return cur;
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [draft, busy, messages]);

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setFollowups([]);
    setError(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  // Global keyboard: ⌘K / Ctrl+K toggles open. Esc closes when open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open && !busy) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  // Custom-event bridge: any page can dispatch
  //   window.dispatchEvent(new CustomEvent("lumid:open-chat", {detail:{prompt:"..."}}))
  // to open + send in one shot. Used by Home's quick-launch chips.
  useEffect(() => {
    const onEvt = (e: Event) => {
      const ce = e as CustomEvent<{ prompt?: string }>;
      setOpen(true);
      const prompt = ce.detail?.prompt;
      if (prompt) {
        // Defer so the panel opens before the send freezes the layout.
        setTimeout(() => send(prompt), 80);
      }
    };
    window.addEventListener("lumid:open-chat", onEvt as EventListener);
    return () => window.removeEventListener("lumid:open-chat", onEvt as EventListener);
  }, [send]);

  // ?ask=… preload (legacy bridge — wizards still use it).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ask = params.get("ask");
    if (!ask || messages.length > 0) return;
    setOpen(true);
    params.delete("ask");
    const cleanSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: cleanSearch ? `?${cleanSearch}` : "" },
      { replace: true },
    );
    setTimeout(() => send(ask), 100);
  }, [location.search, location.pathname, messages.length, navigate, send]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Collapsed pill — show ⌘K hint on hover so users learn the shortcut.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 group inline-flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all"
        title="Ask Lumid (⌘K)"
      >
        <Sparkles className="w-4 h-4" />
        <span className="text-sm font-medium">Ask Lumid</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[10px] rounded bg-white/20 group-hover:bg-white/30">
          <Command className="w-3 h-3" />K
        </kbd>
      </button>
    );
  }

  const showStarters = messages.length === 0;
  const showFollowups = !busy && followups.length > 0 && messages.length > 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-2rem)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200/60 bg-gradient-to-br from-indigo-50 to-purple-50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <div className="font-semibold text-sm">Lumid</div>
            <div className="text-[10px] text-slate-500">
              {busy ? "thinking…" : `${messages.length === 0 ? "ready — try a chip below" : "ready"}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && !busy && (
            <button
              onClick={clearConversation}
              className="p-1 rounded hover:bg-white/60 text-slate-500 hover:text-slate-700"
              title="Clear conversation"
              aria-label="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-white/60"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {showStarters && (
          <div className="space-y-3">
            <div className="text-slate-500 text-[13px]">
              Tell me what you'd like done. Pick a starter or just type.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => send(p.prompt)}
                  className="px-2.5 py-1 rounded-full text-xs border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-400 pt-1">
              Tip: press <kbd className="px-1 rounded bg-slate-100 border border-slate-200 text-slate-600">⌘K</kbd> to open me anywhere.
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-900",
              )}
            >
              {m.content || (m.role === "assistant" && busy ? "…" : "")}
            </div>
            {m.tool_calls && m.tool_calls.length > 0 && (
              <div className="mt-1.5 space-y-1 max-w-[95%]">
                {m.tool_calls.map((tc, j) => {
                  const key = `${i}-${j}`;
                  const isExpanded = expandedTool === key;
                  return (
                    <div key={j}>
                      <button
                        onClick={() => setExpandedTool(isExpanded ? null : key)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition",
                          tc.ok
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100",
                        )}
                        title={`Click to ${isExpanded ? "hide" : "see"} raw result`}
                      >
                        {tc.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        <span>{pillLabel(tc)}</span>
                      </button>
                      {isExpanded && (
                        <pre className="mt-1 ml-2 p-2 rounded border border-slate-200 bg-slate-50 text-[10px] text-slate-700 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(tc.result, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">thinking…</span>
          </div>
        )}
        {error && (
          <div className="rounded border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs">
            {error}
          </div>
        )}
        {showFollowups && (
          <div className="pt-1">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Next</div>
            <div className="flex flex-wrap gap-1.5">
              {followups.map((f) => (
                <button
                  key={f}
                  onClick={() => send(f)}
                  className="px-2 py-0.5 rounded-full text-[11px] border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700 transition"
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="border-t border-slate-200/60 p-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={busy ? "thinking…" : "Tell me what to do…"}
            rows={1}
            disabled={busy}
            className="flex-1 resize-none rounded-md border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-slate-50"
          />
          {busy ? (
            <button
              onClick={stop}
              className="p-2 rounded-md bg-slate-200 text-slate-700 hover:bg-slate-300"
              title="Stop"
              aria-label="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!draft.trim()}
              className="p-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
              aria-label="Send"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="px-1 pt-1 text-[10px] text-slate-400 flex items-center justify-between">
          <span>Enter to send · Shift+Enter for newline</span>
          <span>⌘K toggle</span>
        </div>
      </footer>
    </div>
  );
}
