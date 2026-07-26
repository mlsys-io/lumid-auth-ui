// SessionStrip — Claude Code session context rendered above the composer
// whenever a claude-code-* model is selected:
//   • session pill: the CLI session backing this thread (short id) with a
//     clear button that starts the next turn fresh. Resume happens through
//     the normal chat-thread history — each thread persists its
//     claude_session_id, so reopening a thread resumes its CLI session.
//     (Pool transcript cards on /claude-sessions are keyed by conv_key, a
//     recording key — they are NOT resumable, so no dropdown here.)
//   • transcripts link for pool-recorded models (the "sessions are recorded"
//     notice was retired 2026-07-25 — it read as an alarming card; the
//     /claude-sessions page itself documents recording + opt-out).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Circle, Wrench, Bot, Sparkles, Plug } from 'lucide-react';

type Caps = { model?: string; tools?: string[]; agents?: string[]; skills?: string[]; mcp?: unknown };

// Compact "what this session can do" chip, mirroring Claude Code's context
// header. Populated from system/init on the first turn; sub-agents (the
// built-in claude persona doesn't count as a dispatchable agent) and MCP
// status are the parts users actually ask about.
function CapChip({ caps }: { caps: Caps }) {
	const [open, setOpen] = useState(false);
	const tools = caps.tools?.length ?? 0;
	// The built-in "claude" catch-all isn't a dispatchable sub-agent type.
	const agents = (caps.agents ?? []).filter((a) => a !== 'claude');
	const skills = caps.skills ?? [];
	const mcpCount = Array.isArray(caps.mcp) ? caps.mcp.length
		: caps.mcp && typeof caps.mcp === 'object' ? Object.keys(caps.mcp).length : 0;
	if (!tools && !agents.length && !skills.length) return null;
	return (
		<span className="relative">
			<button
				onClick={() => setOpen((v) => !v)}
				className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full border border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
				title="What this Claude Code session can use"
			>
				<span className="inline-flex items-center gap-1"><Wrench className="w-3 h-3" />{tools}</span>
				{!!agents.length && <span className="inline-flex items-center gap-1"><Bot className="w-3 h-3" />{agents.length}</span>}
				{!!skills.length && <span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3" />{skills.length}</span>}
				<span className="inline-flex items-center gap-1" title={mcpCount ? `${mcpCount} MCP server(s)` : 'no MCP servers configured'}>
					<Plug className={['w-3 h-3', mcpCount ? '' : 'opacity-40'].join(' ')} />{mcpCount || '—'}
				</span>
			</button>
			{open && (
				<div className="absolute bottom-full left-0 mb-1 z-30 w-64 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg p-2.5 text-[11px] space-y-2 text-foreground">
					{!!agents.length && (
						<div>
							<div className="font-medium mb-0.5 flex items-center gap-1"><Bot className="w-3 h-3" /> sub-agents</div>
							<div className="flex flex-wrap gap-1">{agents.map((a) => (
								<span key={a} className="px-1.5 py-px rounded bg-indigo-50 text-indigo-700 border border-indigo-100">{a}</span>
							))}</div>
						</div>
					)}
					{!!skills.length && (
						<div>
							<div className="font-medium mb-0.5 flex items-center gap-1"><Sparkles className="w-3 h-3" /> skills ({skills.length})</div>
							<div className="flex flex-wrap gap-1">{skills.slice(0, 24).map((sk) => (
								<span key={sk} className="px-1.5 py-px rounded bg-muted text-muted-foreground">{sk}</span>
							))}</div>
						</div>
					)}
					<div className="text-muted-foreground">
						{mcpCount
							? `${mcpCount} MCP server(s) connected`
							: 'No MCP servers configured in this sandbox.'}
					</div>
				</div>
			)}
		</span>
	);
}

export function SessionStrip({
	session,
	streaming,
	pool,
	caps,
	onClear,
}: {
	session: string | null;
	streaming: boolean;
	// pool=true for pooled-Anthropic models (recorded on /claude-sessions,
	// pool quota applies); false for lumid-llm-backed models (own GPUs — no
	// pool recording, so no transcripts link / recording notice).
	pool: boolean;
	caps?: Caps | null;
	onClear: () => void;
}) {
	// Nothing to show before the CLI session exists — the old "new Claude Code
	// session — runs in your sandbox workspace" hint + transcripts link row was
	// noise on every fresh turn (removed 2026-07-26 by operator request).
	if (!session) return null;
	return (
		<div className="flex items-center gap-2 flex-wrap px-1 pb-1 text-[11px]">
			<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50/70 text-indigo-800">
				<Circle className="w-2 h-2 fill-indigo-500 text-indigo-500" />
				<span className="font-mono" title="Claude Code session backing this thread — reopening the thread later resumes it">
					session {session.slice(0, 8)}
				</span>
				<button
					onClick={onClear}
					disabled={streaming}
					title="Start a fresh Claude Code session on the next turn"
					className="opacity-50 hover:opacity-100 disabled:opacity-25"
				>
					<X className="w-3 h-3" />
				</button>
			</span>
			{caps && <CapChip caps={caps} />}
			{pool && (
				<Link to="/claude-sessions" className="text-indigo-600 hover:underline">
					transcripts →
				</Link>
			)}
		</div>
	);
}
