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
import { Loader2, RefreshCw, ChevronRight, Shield, Trash2, Download, Search, X } from 'lucide-react';
import { StandaloneFrame } from '@/components/studio/StandaloneFrame';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StrandMark } from '@/components/illustrations/StrandMark';
import { EmptyRuns, NoMatches } from '@/components/illustrations/scenes';
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

const ALL_USERS = '__all__';

function fmtTs(iso: string): string {
	if (!iso || iso.startsWith('0001')) return '—';
	return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Json({ value }: { value: unknown }) {
	if (value === null || value === undefined) return <span className="text-ink-600 text-xs italic">none</span>;
	let text: string;
	if (typeof value === 'string') text = value;
	else text = JSON.stringify(value, null, 2);
	return (
		<pre className="text-micro font-mono bg-ink-900 text-ink-200 rounded-[8px] px-3 py-2.5 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
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
			<div className="text-micro text-ember-700 bg-ember-50 border border-ember-200 rounded px-3 py-2">
				Compressed recording (pre-v0.1.5 proxy) — raw bytes not displayable.
				<button onClick={() => setShowRaw((v) => !v)} className="ml-2 underline text-ember-600">
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
						<div className="rounded border border-plum-100 bg-plum-50">
							<button
								onClick={() => setShowThinking((v) => !v)}
								className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-nano text-plum-600 hover:bg-plum-100"
							>
								<span className="font-medium">thinking block</span>
								<span className="ml-auto opacity-60">{showThinking ? '▲' : '▼'}</span>
							</button>
							{showThinking && (
								<pre className="text-micro font-mono bg-plum-900 text-plum-200 rounded-b px-3 py-2 overflow-x-auto max-h-72 overflow-y-auto whitespace-pre-wrap break-words">
									{parsed.thinking}
								</pre>
							)}
						</div>
					)}
					<pre className="text-micro font-mono bg-ink-900 text-ink-200 rounded px-3 py-2 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
						{parsed.text || <span className="text-ink-600 italic">(no text blocks)</span>}
					</pre>
					<button onClick={() => setShowRaw((v) => !v)} className="text-nano text-ink-600 hover:text-ink-700">
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
		<div className={`rounded-[10px] border bg-card transition-[border-color,box-shadow] duration-180 ${open ? 'border-ink-300 shadow-e1' : 'border-border hover:border-ink-300'}`}>
			<button
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
			>
				<ChevronRight className={`w-3.5 h-3.5 text-ink-500 transition-transform duration-180 ${open ? 'rotate-90' : ''}`} />
				<span className="text-meta font-medium tabular-nums text-ink-900">Turn {turn.turn_index + 1}</span>
				<span className="text-caption text-ink-600">{turn.model}</span>
				{turn.stream && <span className="rounded-full bg-ink-100 px-1.5 text-nano font-medium text-ink-700">SSE</span>}
				{turn.tool_use_count > 0 && (
					<span className="rounded-full bg-plum-50 px-1.5 text-nano font-medium text-plum-700">{turn.tool_use_count} tool</span>
				)}
				{turn.truncated && <span className="rounded-full bg-ember-50 px-1.5 text-nano font-medium text-ember-700">truncated</span>}
				<span className="ml-auto font-mono text-caption tabular-nums text-ink-600">
					{fmtTokens(turn.input_tokens)} in · {fmtTokens(turn.output_tokens)} out · {(turn.duration_ms / 1000).toFixed(1)}s
				</span>
			</button>
			{open && (
				<div className="px-3 pb-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-180">
					<div>
						<div className="eyebrow mb-1.5">
							new messages this turn
						</div>
						<Json value={turn.new_messages} />
					</div>
					<div>
						<div className="eyebrow mb-1.5">
							request params (system / tools / sampling)
						</div>
						<Json value={turn.request_meta} />
					</div>
					<div>
						<div className="eyebrow mb-1.5">response</div>
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
	const [loadingEarlier, setLoadingEarlier] = useState(false);
	const [downloading, setDownloading] = useState(false);
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
		// Probe admin view availability. TIGHTENED 2026-09-02 (security audit
		// finding): the backend route now requires super_admin, not admin+ —
		// a plain admin's probe 403s and falls through to the catch below,
		// same as role=user always did. No UI change needed here: this was
		// already a graceful probe-and-degrade, not a hard role check, so a
		// plain admin just sees their own sessions instead of the all-users
		// view, with no visible error.
		// If the probe succeeds, default to the all-users view so admins see everything on load.
		fetchClaudeSessions(true).then(() => { setCanAdmin(true); setAdmin(true); }).catch(() => setCanAdmin(false));
	}, []);

	const openSession = (convKey: string) => {
		setDetailLoading(true);
		setSelected(null);
		// Newest window only. Fetching a whole transcript was a 72 MB / 48s
		// response for a 517-turn session — past the client's 30s timeout, and
		// far more than a browser should parse.
		fetchClaudeSession(convKey, admin)
			.then(setSelected)
			.catch((e) => setError(String(e?.message || e)))
			.finally(() => setDetailLoading(false));
	};

	// Walk backwards through a long transcript, prepending older turns.
	const loadEarlier = () => {
		if (!selected || loadingEarlier) return;
		const key = selected.session.conv_key;
		const before = selected.oldest_turn_index;
		if (before === undefined) return;
		setLoadingEarlier(true);
		fetchClaudeSession(key, admin, { before })
			.then((older) => {
				setSelected((cur) => {
					// Guard against a different session having been opened meanwhile.
					if (!cur || cur.session.conv_key !== key) return cur;
					return {
						...cur,
						turns: [...older.turns, ...cur.turns],
						oldest_turn_index: older.oldest_turn_index,
						has_more: older.has_more,
						remaining: older.remaining,
					};
				});
			})
			.catch((e) => setError(String(e?.message || e)))
			.finally(() => setLoadingEarlier(false));
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
		<StandaloneFrame>
			<PageHeader
				title="Claude pool sessions"
				subtitle={<>Conversations recorded through <code className="font-mono text-meta text-ink-800">lum.id/claude</code> — full context, tools, and responses.</>}
				actions={
					<>
						{recording !== null && (
							<button
								type="button"
								role="switch"
								aria-checked={recording}
								onClick={toggleRecording}
								className="lumen-press inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card pl-1 pr-3 text-meta font-medium text-ink-800 shadow-e1 transition-colors duration-180 hover:border-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
								title="Recording is on by default; turn it off to stop storing your sessions."
							>
								<span className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors duration-180 ${recording ? 'bg-gold-600' : 'bg-ink-300'}`}>
									<span className={`absolute h-5 w-5 rounded-full bg-card shadow-e1 transition-transform duration-180 ${recording ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
								</span>
								Recording {recording ? 'on' : 'off'}
							</button>
						)}
						{canAdmin && (
							<Button
								variant="secondary"
								size="sm"
								aria-pressed={admin}
								onClick={() => { setSelected(null); setSearch(''); setUserFilter(''); setAdmin((a) => !a); }}
								className={admin ? 'border-plum-300 bg-plum-50 text-plum-700 hover:bg-plum-100' : ''}
							>
								<Shield className="w-3.5 h-3.5" />
								{admin ? 'All users' : 'My sessions'}
							</Button>
						)}
						<Button variant="secondary" size="sm" onClick={load} disabled={loading}>
							<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
						</Button>
					</>
				}
			/>

			{error && sessions !== null && (
				<div role="alert" className="mb-4 flex items-start gap-2 rounded-[10px] border border-brick-200 bg-brick-50 px-3 py-2 text-meta text-brick-800">
					<span className="min-w-0 flex-1 break-words">{error}</span>
					<button type="button" onClick={() => setError(null)} className="shrink-0 text-brick-700 hover:text-brick-900" aria-label="Dismiss">
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			)}

			{/* Search + user filter */}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="relative w-full max-w-sm">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-500 pointer-events-none" />
					<input
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search title, model, user…"
						aria-label="Search sessions"
						className="h-9 w-full rounded-[8px] border border-border bg-card pl-8 pr-3 text-body text-ink-900 shadow-e1 placeholder:text-ink-500 transition-[border-color,box-shadow] duration-180 hover:border-ink-300 focus:outline-none focus-visible:border-gold-400 focus-visible:ring-2 focus-visible:ring-ring/30"
					/>
				</div>
				{admin && userOptions.length > 0 && (
					<Select value={userFilter || ALL_USERS} onValueChange={(v) => setUserFilter(v === ALL_USERS ? '' : v)}>
						<SelectTrigger size="sm" className="w-60" aria-label="Filter by user">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={ALL_USERS}>All users</SelectItem>
							{userOptions.map((u) => (
								<SelectItem key={u} value={u}>{u}</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				{(search || userFilter) && (
					<Button variant="ghost" size="sm" onClick={() => { setSearch(''); setUserFilter(''); }}>
						Clear
					</Button>
				)}
				{filtered && filtered.length > 0 && (
					<span className="ml-auto text-caption tabular-nums text-ink-600">
						{filtered.length} session{filtered.length === 1 ? '' : 's'}
					</span>
				)}
			</div>

			{error && sessions === null ? (
				<ErrorState error={new Error(error)} what="your sessions" onRetry={load} />
			) : (
			<div className="grid grid-cols-1 md:grid-cols-[minmax(0,380px)_1fr] gap-5">
				{/* session list — title + time on one line, facts on the next with
				    dot separators; facts never wrap mid-token ("2 / turns"). */}
				<div className="rounded-[12px] border border-border bg-card shadow-e1 divide-y divide-ink-100 max-h-[72vh] overflow-y-auto">
					{filtered === null ? (
						<div className="space-y-0 divide-y divide-ink-100" aria-busy="true" aria-label="Loading sessions">
							{Array.from({ length: 6 }).map((_, i) => (
								<div key={i} className="space-y-2 px-4 py-3">
									<Skeleton className="h-4 w-3/4 rounded" />
									<Skeleton className="h-3 w-1/2 rounded" />
								</div>
							))}
						</div>
					) : filtered.length === 0 ? (
						sessions?.length === 0 ? (
							<EmptyState
								framed={false}
								size="sm"
								art={<EmptyRuns />}
								title="No recorded sessions yet"
								body="Use the pool from your terminal and each conversation appears here."
							/>
						) : (
							<EmptyState
								framed={false}
								size="sm"
								art={<NoMatches />}
								title="Nothing matches"
								body="Try a different word, or clear the filter."
								actionLabel="Clear filter"
								onAction={() => { setSearch(''); setUserFilter(''); }}
							/>
						)
					) : (
						filtered.map((s, i) => {
							const active = selected?.session.conv_key === s.conv_key;
							return (
							<div
								key={s.conv_key}
								className={`group relative flex items-start gap-2 px-4 py-3 transition-colors duration-120 animate-lumen-rise ${active ? 'bg-gold-50' : 'hover:bg-ink-50'}`}
								style={{ animationDelay: `${Math.min(i, 7) * 30}ms` }}
							>
								<span aria-hidden className={`absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-gold-500 transition-opacity duration-180 ${active ? 'opacity-100' : 'opacity-0'}`} />
								<button
									onClick={() => openSession(s.conv_key)}
									aria-current={active ? 'true' : undefined}
									className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
								>
									<div className="flex items-baseline gap-3">
										<span className="min-w-0 flex-1 truncate text-body font-medium text-ink-900">{s.title || '(untitled)'}</span>
										<span className="shrink-0 whitespace-nowrap text-caption tabular-nums text-ink-600">{fmtTs(s.last_ts)}</span>
									</div>
									<div className="mt-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-caption text-ink-600">
										{(s.user_email || s.user_sub) && (
											<><span className="min-w-0 max-w-[140px] truncate font-medium text-ink-700">{s.user_email || s.user_sub}</span><span aria-hidden>·</span></>
										)}
										<span className="min-w-0 truncate">{s.model}</span>
										<span aria-hidden>·</span>
										<span className="tabular-nums">{s.turn_count} turn{s.turn_count === 1 ? '' : 's'}</span>
										<span aria-hidden>·</span>
										<span className="tabular-nums">{fmtTokens(s.input_tokens + s.output_tokens)} tok</span>
									</div>
								</button>
								<button
									onClick={() => removeSession(s.conv_key)}
									className="mt-0.5 shrink-0 rounded p-0.5 text-ink-500 opacity-0 transition-[opacity,color] duration-120 hover:text-brick-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100"
									title="Delete session"
									aria-label="Delete session"
								>
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
							);
						})
					)}
				</div>

				{/* detail */}
				<div className="min-w-0">
					{detailLoading ? (
						<div className="space-y-2" aria-busy="true" aria-label="Loading transcript">
							<Skeleton className="mb-3 h-6 w-2/3 rounded" />
							{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-[10px]" />)}
						</div>
					) : selected ? (
						<div className="space-y-2 animate-lumen-rise">
							<div className="mb-3 flex items-start justify-between gap-3">
								<div className="min-w-0">
									<h2 className="font-display text-h3 font-medium text-ink-900 line-clamp-2 break-words">{selected.session.title || '(untitled)'}</h2>
									<div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-meta text-ink-600">
										<span>{selected.session.model}</span>
										<span aria-hidden>·</span>
										<span className="tabular-nums">{selected.session.turn_count} turns</span>
										<span aria-hidden>·</span>
										<span className="tabular-nums">{fmtTokens(selected.session.input_tokens)} in / {fmtTokens(selected.session.output_tokens)} out</span>
										{selected.session.tool_use_count > 0 && <><span aria-hidden>·</span><span className="tabular-nums">{selected.session.tool_use_count} tool calls</span></>}
									</div>
								</div>
								<button
									onClick={async () => {
										// The view holds only a WINDOW of turns, so exporting
										// `selected` would quietly produce a partial transcript.
										// Re-fetch the whole thing for the download instead.
										setDownloading(true);
										try {
											const total = selected.total_turns ?? selected.turns.length;
											const full = selected.has_more
												? await fetchClaudeSession(selected.session.conv_key, admin, { limit: Math.max(total, 200) })
												: selected;
											const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
											const url = URL.createObjectURL(blob);
											const a = document.createElement('a');
											a.href = url;
											a.download = `session-${selected.session.conv_key.slice(0, 8)}.json`;
											a.click();
											URL.revokeObjectURL(url);
										} catch (e: any) {
											setError(String(e?.message || e));
										} finally {
											setDownloading(false);
										}
									}}
									disabled={downloading}
									className="lumen-press shrink-0 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-meta font-medium text-ink-800 shadow-e1 transition-colors duration-120 hover:border-ink-300 hover:bg-ink-50 disabled:opacity-50"
									title="Download the FULL session as JSON"
								>
									{downloading
										? <Loader2 className="w-3.5 h-3.5 animate-spin" />
										: <Download className="w-3.5 h-3.5" />} JSON
								</button>
							</div>
							{/* Long transcripts load newest-first; walk backwards on demand. */}
							{selected.has_more && (
								<div className="mb-2 flex items-center justify-center gap-3 text-meta">
									<button
										type="button"
										onClick={loadEarlier}
										disabled={loadingEarlier}
										className="lumen-press inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 font-medium text-ink-800 shadow-e1 hover:border-ink-300 hover:bg-ink-50 disabled:opacity-50"
									>
										{loadingEarlier
											? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> loading…</>
											: <>Load earlier turns</>}
									</button>
									<span className="text-ink-600">
										showing {selected.turns.length} of {selected.total_turns ?? selected.turns.length}
										{selected.remaining ? ` · ${selected.remaining} older` : ''}
									</span>
								</div>
							)}
							{selected.turns.map((t) => <TurnBlock key={t.turn_index} turn={t} />)}
						</div>
					) : (
						<EmptyState
							art={<StrandMark size={44} />}
							title="Pick a session"
							body="Its full transcript opens here — the context, tools, and every response."
						/>
					)}
				</div>
			</div>
			)}
		</StandaloneFrame>
	);
}
