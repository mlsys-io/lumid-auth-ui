// SessionStrip — Claude Code session context rendered above the composer
// whenever a claude-code-* model is selected:
//   • session pill: the CLI session backing this thread (short id) with a
//     clear button that starts the next turn fresh. Resume happens through
//     the normal chat-thread history — each thread persists its
//     claude_session_id, so reopening a thread resumes its CLI session.
//     (Pool transcript cards on /claude-sessions are keyed by conv_key, a
//     recording key — they are NOT resumable, so no dropdown here.)
//   • one-time recording notice (sessions are recorded by default; opt-out
//     lives on /claude-sessions), dismissed into localStorage.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Circle } from 'lucide-react';

const NOTICE_KEY = 'cc_recording_notice_v1';

export function SessionStrip({
	session,
	streaming,
	pool,
	onClear,
}: {
	session: string | null;
	streaming: boolean;
	// pool=true for pooled-Anthropic models (recorded on /claude-sessions,
	// pool quota applies); false for lumid-llm-backed models (own GPUs — no
	// pool recording, so no transcripts link / recording notice).
	pool: boolean;
	onClear: () => void;
}) {
	const [noticeDismissed, setNoticeDismissed] = useState(() => {
		try { return localStorage.getItem(NOTICE_KEY) === '1'; } catch { return true; }
	});

	const dismissNotice = () => {
		setNoticeDismissed(true);
		try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* ignore */ }
	};

	return (
		<div className="flex items-center gap-2 flex-wrap px-1 pb-1 text-[11px]">
			{session ? (
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
			) : (
				<span className="text-muted-foreground">new Claude Code session — runs in your sandbox workspace</span>
			)}
			{pool && (
				<Link to="/claude-sessions" className="text-indigo-600 hover:underline">
					transcripts →
				</Link>
			)}
			{pool && !noticeDismissed && (
				<span className="inline-flex items-center gap-1.5 text-muted-foreground">
					<span>
						Sessions are <Link to="/claude-sessions" className="underline">recorded</Link> by
						default (opt-out there).
					</span>
					<button onClick={dismissNotice} className="opacity-50 hover:opacity-100" title="Dismiss">
						<X className="w-3 h-3" />
					</button>
				</span>
			)}
		</div>
	);
}
