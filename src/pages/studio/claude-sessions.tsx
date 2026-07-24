// Claude account-pool session transcripts (lum.id/claude recording).
//
// Owner view: your own recorded sessions from the pool. super_admin can flip
// to the all-users view. Recording is on by default; toggle it here.
//
// Each session is a conversation (grouped server-side by model + first user
// message). Selecting one reconstructs the turn-by-turn transcript: the
// request context/tools/params, the messages added each turn, and the full
// response (including tool_use / API calls).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, Loader2, RefreshCw, ChevronRight, Shield, Circle, Trash2, Download, Search } from 'lucide-react';
import {
	fetchClaudeSessions,
	fetchClaudeSession,
	deleteClaudeSession,
	fetchClaudeRecording,
	setClaudeRecording,
	type ClaudeSessionCard,
	type ClaudeSessionDetail,
} from '@/api/super-admin';

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

function fmtTs(iso: string): string {
	if (!iso || iso.startsWith('0001')) return '—';
	return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Json({ value }: { value: unknown }) {
	if (value === null || value === undefined) return <span className="text-slate-400 text-xs italic">none</span>;
	let text: string;
	if (typeof value === 'string') text = value;
	else text = JSON.stringify(value, null, 2);
	return (
		<pre className="text-[11px] font-mono bg-slate-900 text-slate-200 rounded px-3 py-2 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
			{text}
		</pre>
	);
}

// Extract text from an SSE string (the raw SSE body stored for streaming turns).
// Returns rendered text blocks, or null if parsing fails / not SSE-shaped.
function parseSseText(raw: string): { text: string; thinking: string | null } | null {
	if (!raw.startsWith('data:')) return null;
	const textParts: string[] = [];
	let thinking = '';
	let inThinking = false;
	for (const line of raw.split('\n')) {
		if (!line.startsWith('data:')) continue;
		const payload = line.slice(5).trim();
		if (!payload || payload === '[DONE]') continue;
		try {
			const ev = JSON.parse(payload);
			if (ev.type === 'content_block_start') {
				inThinking = ev.content_block?.type === 'thinking';
			}
			if (ev.type === 'content_block_delta') {
				const d = ev.delta;
				if (d?.type === 'text_delta') {
					if (inThinking) thinking += d.text;
					else textParts.push(d.text);
				} else if (d?.type === 'thinking_delta') {
					thinking += d.thinking;
				}
			}
		} catch { /* skip malformed */ }
	}
	if (!textParts.length && !thinking) return null;
	return { text: textParts.join(''), thinking: thinking || null };
}

function ResponseView({ response, stream }: { response: unknown; stream: boolean }) {
	const [showRaw, setShowRaw] = useState(false);
	const [showThinking, setShowThinking] = useState(false);

	// Detect gzip-corrupted blob: proxy pre-v0.1.5 forwarded Accept-Encoding,
	// causing Anthropic to compress SSE; json.Marshal(string(gzipBytes)) replaced
	// bytes > 127 with U+FFFD. The first byte of gzip magic (0x1f) is still intact.
	if (typeof response === 'string' && response.charCodeAt(0) === 0x1f) {
		return (
			<div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
				Compressed recording (pre-v0.1.5 proxy) — raw bytes not displayable.
				<button onClick={() => setShowRaw((v) => !v)} className="ml-2 underline text-amber-600">
					{showRaw ? 'hide' : 'show raw'}
				</button>
				{showRaw && <Json value={response} />}
			</div>
		);
	}

	// For streaming turns, try to parse SSE events and render text.
	if (stream && typeof response === 'string') {
		const parsed = parseSseText(response);
		if (parsed) {
			return (
				<div className="space-y-2">
					{parsed.thinking && (
						<div className="rounded border border-indigo-100 bg-indigo-50">
							<button
								onClick={() => setShowThinking((v) => !v)}
								className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[10px] text-indigo-600 hover:bg-indigo-100"
							>
								<span className="font-medium">thinking block</span>
								<span className="ml-auto opacity-60">{showThinking ? '▲' : '▼'}</span>
							</button>
							{showThinking && (
								<pre className="text-[11px] font-mono bg-indigo-900 text-indigo-200 rounded-b px-3 py-2 overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap break-words">
									{parsed.thinking}
								</pre>
							)}
						</div>
					)}
					<pre className="text-[11px] font-mono bg-slate-900 text-slate-200 rounded px-3 py-2 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
						{parsed.text || <span className="text-slate-500 italic">(no text blocks)</span>}
					</pre>
					<button onClick={() => setShowRaw((v) => !v)} className="text-[10px] text-slate-400 hover:text-slate-700">
						{showRaw ? 'hide raw SSE ▲' : 'show raw SSE ▼'}
					</button>
					{showRaw && <Json value={response} />}
				</div>
			);
		}
	}

	return <Json value={response} />;
}

function TurnBlock({ turn }: { turn: ClaudeSessionDetail['turns'][number] }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="rounded border border-slate-200">
			<button
				onClick={() => setOpen((o) => !o)}
				className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
			>
				<ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
				<span className="text-xs font-medium text-slate-700">turn {turn.turn_index + 1}</span>
				<span className="text-[10px] text-slate-400">{turn.model}</span>
				{turn.stream && <span className="text-[10px] bg-slate-100 text-slate-500 px-1 rounded">SSE</span>}
				{turn.tool_use_count > 0 && (
					<span className="text-[10px] bg-indigo-50 text-indigo-500 px-1 rounded">{turn.tool_use_count} tool</span>
				)}
				<span className="ml-auto text-[10px] font-mono text-slate-500">
					{turn.input_tokens}in / {turn.output_tokens}out · {turn.duration_ms}ms
				</span>
				{turn.truncated && <span className="text-[10px] text-amber-500">truncated</span>}
			</button>
			{open && (
				<div className="px-3 pb-3 space-y-2">
					<div>
						<div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
							new messages this turn
						</div>
						<Json value={turn.new_messages} />
					</div>
					<div>
						<div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
							request params (system / tools / sampling)
						</div>
						<Json value={turn.request_meta} />
					</div>
					<div>
						<div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">response</div>
						<ResponseView response={turn.response} stream={turn.stream} />
					</div>
				</div>
			)}
		</div>
	);
}

export default function StudioClaudeSessions() {
	const [admin, setAdmin] = useState(false);
	const [canAdmin, setCanAdmin] = useState(false);
	const [sessions, setSessions] = useState<ClaudeSessionCard[] | null>(null);
	const [selected, setSelected] = useState<ClaudeSessionDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [detailLoading, setDetailLoading] = useState(false);
	const [recording, setRecording] = useState<boolean | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [userFilter, setUserFilter] = useState('');

	const load = useCallback(() => {
		setLoading(true);
		fetchClaudeSessions(admin)
			.then((s) => { setSessions(s); setError(null); })
			.catch((e) => setError(String(e?.response?.data?.message || e?.message || e)))
			.finally(() => setLoading(false));
	}, [admin]);

	// Unique user emails available in the current session list (admin view only).
	const userOptions = useMemo(() => {
		if (!admin || !sessions) return [];
		const seen = new Set<string>();
		const out: string[] = [];
		for (const s of sessions) {
			const label = s.user_email || s.user_sub || '';
			if (label && !seen.has(label)) { seen.add(label); out.push(label); }
		}
		return out.sort();
	}, [admin, sessions]);

	const filtered = useMemo(() => {
		if (!sessions) return sessions;
		const q = search.trim().toLowerCase();
		return sessions.filter((s) => {
			if (userFilter && s.user_email !== userFilter && s.user_sub !== userFilter) return false;
			if (!q) return true;
			return (
				s.title?.toLowerCase().includes(q) ||
				s.model?.toLowerCase().includes(q) ||
				s.user_email?.toLowerCase().includes(q) ||
				s.account?.toLowerCase().includes(q)
			);
		});
	}, [sessions, search, userFilter]);

	useEffect(() => { load(); }, [load]);

	useEffect(() => {
		fetchClaudeRecording().then(setRecording).catch(() => {});
		// Probe admin view availability (requires admin or super_admin — role=user gets 403).
		// If the probe succeeds, default to the all-users view so admins see everything on load.
		fetchClaudeSessions(true).then(() => { setCanAdmin(true); setAdmin(true); }).catch(() => setCanAdmin(false));
	}, []);

	const openSession = (convKey: string) => {
		setDetailLoading(true);
		setSelected(null);
		fetchClaudeSession(convKey, admin)
			.then(setSelected)
			.catch((e) => setError(String(e?.message || e)))
			.finally(() => setDetailLoading(false));
	};

	const toggleRecording = async () => {
		if (recording === null) return;
		const next = !recording;
		setRecording(next);
		try { await setClaudeRecording(next); } catch { setRecording(!next); }
	};

	const removeSession = async (convKey: string) => {
		try {
			await deleteClaudeSession(convKey, admin);
			setSessions((prev) => prev?.filter((s) => s.conv_key !== convKey) ?? null);
			if (selected?.session.conv_key === convKey) setSelected(null);
		} catch (e: any) {
			setError(String(e?.message || e));
		}
	};

	return (
		<div className="space-y-3 max-w-5xl mx-auto">
			<header className="flex items-center justify-between">
				<div>
					<h1 className="text-base font-medium flex items-center gap-2">
						<MessageSquare className="w-4 h-4 text-gold-600" />
						Claude pool sessions
					</h1>
					<p className="text-xs text-slate-400 mt-0.5">
						Conversations recorded through <code className="font-mono">lum.id/claude</code> — full context, tools, and responses.
					</p>
				</div>
				<div className="flex items-center gap-3">
					{recording !== null && (
						<button
							onClick={toggleRecording}
							className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900"
							title="Recording is on by default; turn it off to stop storing your sessions."
						>
							<Circle className={`w-3 h-3 ${recording ? 'fill-emerald-500 text-emerald-500' : 'fill-slate-300 text-slate-300'}`} />
							recording {recording ? 'on' : 'off'}
						</button>
					)}
					{canAdmin && (
						<button
							onClick={() => { setSelected(null); setSearch(''); setUserFilter(''); setAdmin((a) => !a); }}
							className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${admin ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
						>
							<Shield className="w-3.5 h-3.5" />
							{admin ? 'all users' : 'my sessions'}
						</button>
					)}
					<button onClick={load} disabled={loading}
						className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-gold-700 disabled:opacity-50">
						<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> refresh
					</button>
				</div>
			</header>

			{error && (
				<div className="text-sm rounded border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">{error}</div>
			)}

			{/* Search + user filter */}
			<div className="flex items-center gap-2">
				<div className="relative flex-1 max-w-sm">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search title, model…"
						className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-300 bg-white"
					/>
				</div>
				{admin && userOptions.length > 0 && (
					<select
						value={userFilter}
						onChange={(e) => setUserFilter(e.target.value)}
						className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300 max-w-[200px] truncate"
					>
						<option value="">All users</option>
						{userOptions.map((u) => (
							<option key={u} value={u}>{u}</option>
						))}
					</select>
				)}
				{(search || userFilter) && (
					<button
						onClick={() => { setSearch(''); setUserFilter(''); }}
						className="text-xs text-slate-400 hover:text-slate-700"
					>
						clear
					</button>
				)}
			</div>

			<div className="grid grid-cols-1 md:grid-cols-[minmax(0,340px)_1fr] gap-4">
				{/* session list */}
				<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
					{filtered === null ? (
						<div className="p-4 text-sm text-slate-500 flex items-center gap-2">
							<Loader2 className="w-3.5 h-3.5 animate-spin" /> loading…
						</div>
					) : filtered.length === 0 ? (
						<div className="p-6 text-center text-sm text-slate-500">
							{sessions?.length === 0
								? "No recorded sessions yet. Use the pool from your terminal and they'll appear here."
								: 'No sessions match your filter.'}
						</div>
					) : (
						filtered.map((s) => (
							<div
								key={s.conv_key}
								className={`group flex items-start gap-1 px-3 py-2 hover:bg-slate-50 border-l-2 transition-colors ${selected?.session.conv_key === s.conv_key ? 'bg-gold-50 border-gold-400' : 'border-transparent'}`}
							>
								<button onClick={() => openSession(s.conv_key)} className="flex-1 min-w-0 text-left">
									<div className="text-xs font-medium text-slate-800 truncate">{s.title || '(untitled)'}</div>
									<div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
										{(s.user_email || s.user_sub) && (
											<span className="truncate max-w-[130px] text-slate-500 font-medium">{s.user_email || s.user_sub}</span>
										)}
										<span>{s.model}</span>
										<span>{s.turn_count} turns</span>
										<span>{fmtTokens(s.input_tokens + s.output_tokens)} tok</span>
										<span className="ml-auto">{fmtTs(s.last_ts)}</span>
									</div>
								</button>
								<button
									onClick={() => removeSession(s.conv_key)}
									className="shrink-0 mt-0.5 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
									title="Delete session"
								>
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
						))
					)}
				</div>

				{/* detail */}
				<div className="min-w-0">
					{detailLoading ? (
						<div className="p-4 text-sm text-slate-500 flex items-center gap-2">
							<Loader2 className="w-3.5 h-3.5 animate-spin" /> loading transcript…
						</div>
					) : selected ? (
						<div className="space-y-2">
							<div className="flex items-center justify-between gap-2">
								<div className="text-xs text-slate-500 min-w-0">
									<span className="font-medium text-slate-700">{selected.session.title || '(untitled)'}</span>
									{' · '}{selected.session.model}{' · '}{selected.session.turn_count} turns{' · '}
									{fmtTokens(selected.session.input_tokens)} in / {fmtTokens(selected.session.output_tokens)} out
									{selected.session.tool_use_count > 0 && ` · ${selected.session.tool_use_count} tool calls`}
								</div>
								<button
									onClick={() => {
										const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
										const url = URL.createObjectURL(blob);
										const a = document.createElement('a');
										a.href = url;
										a.download = `session-${selected.session.conv_key.slice(0, 8)}.json`;
										a.click();
										URL.revokeObjectURL(url);
									}}
									className="shrink-0 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-2 py-1"
									title="Download session as JSON"
								>
									<Download className="w-3.5 h-3.5" /> JSON
								</button>
							</div>
							{selected.turns.map((t) => <TurnBlock key={t.turn_index} turn={t} />)}
						</div>
					) : (
						<div className="p-6 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg">
							Select a session to view its full transcript.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
