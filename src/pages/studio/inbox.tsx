// /studio/inbox — Phase S5+ unified feed.
//
// One chronological list of everything that needs (or wants) the
// user's attention: pending drafts the AI proposed, recent cycle
// outcomes (incl. failures), external API calls the AI made on
// the user's behalf, and platform notices (quota paused, free tier
// reached, etc.).
//
// No new backend — aggregates three existing endpoints:
//   - /me/drafts                       (pending drafts to approve)
//   - /me/today                        (headlines + cycle history)
//   - /me/audit?kind=external_api      (read-only audit trail)
//
// Filter chips switch which kinds are visible; the underlying feed
// stays sorted newest-first across types so the user sees a true
// timeline rather than per-source columns.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
	Mail, CheckCircle2, AlertCircle, Send, X, Edit2,
	Sparkles, Loader2, ChevronRight, RefreshCw, Lock,
	Plus, Filter as FilterIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { me, MeApiError } from '@/api/me';
import apiClient from '@/api/client';
import PageHints from '@/components/PageHints';
import { setStudioSelection } from '@/components/StudioContext';
import { useStudioRefetch } from '@/hooks/useStudioRefetch';
import { IntentFeedbackRow } from '@/components/IntentFeedbackRow';
import { AXIS_META } from '@/lib/demo-intents';

type Filter = 'all' | 'drafts' | 'activity' | 'audit' | 'notices';

type FeedItem =
	| {
			kind: 'draft';
			id: string;
			ts: string;
			app: string;
			subject: string;
			to: string;
			body: string;
	  }
	| {
			kind: 'cycle';
			id: string;
			ts: string;
			app: string;
			loop: string;
			ok: boolean;
			skipped?: boolean;
			skipReason?: string;
			lastError?: string;
	  }
	| {
			kind: 'audit';
			id: string;
			ts: string;
			endpoint: string;
			model?: string;
	  }
	| {
			kind: 'notice';
			id: string;
			ts: string;
			summary: string;
			detail?: string;
			noticeKind: 'quota_paused' | 'brief' | 'cycle_failed';
	  };

const FILTERS: { id: Filter; label: string; matches: (k: FeedItem['kind']) => boolean }[] = [
	{ id: 'all',      label: 'All',       matches: () => true },
	{ id: 'drafts',   label: 'Drafts',    matches: (k) => k === 'draft' },
	{ id: 'activity', label: 'Activity',  matches: (k) => k === 'cycle' },
	{ id: 'notices',  label: 'Notices',   matches: (k) => k === 'notice' },
	{ id: 'audit',    label: 'Audit',     matches: (k) => k === 'audit' },
];

export default function StudioInbox() {
	const [searchParams, setSearchParams] = useSearchParams();
	// "Your AI" tab retired — knowledge has its own nav entry at
	// /studio/knowledge. If somebody still has a bookmarked ?tab=your-ai
	// URL, strip the param + send them to /studio/knowledge implicitly
	// (we just drop the param here; the StudioKnowledge surface lives
	// at the dedicated route now).
	useEffect(() => {
		if (searchParams.has('tab')) {
			setSearchParams((sp) => {
				const next = new URLSearchParams(sp);
				next.delete('tab');
				return next;
			}, { replace: true });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const [items, setItems] = useState<FeedItem[] | null>(null);
	// Honor ?filter=drafts (and the other Filter ids) so "See all in Inbox"
	// on the Intents page lands the user on the right tab. Falls back to
	// 'all' for unknown values.
	const initialFilter = (() => {
		const f = searchParams.get('filter') as Filter | null;
		return f === 'drafts' || f === 'activity' || f === 'audit' || f === 'notices' || f === 'all'
			? f : 'all';
	})();
	const [filter, setFilter] = useState<Filter>(initialFilter);
	const [busy, setBusy] = useState<Record<string, boolean>>({});
	const [refreshing, setRefreshing] = useState(false);
	const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
	const [, setTick] = useState(0);

	// Tick so the "Updated Xs ago" chip counts up between auto-refreshes.
	// 15s (was 5s) — re-rendering this view every 5s is needless churn; the
	// relative-time chip reads the same to a human at 15s granularity.
	useEffect(() => {
		const t = window.setInterval(() => setTick((x) => x + 1), 15_000);
		return () => window.clearInterval(t);
	}, []);

	const load = useCallback(async () => {
		setRefreshing(true);
		const [drafts, today, audit] = await Promise.allSettled([
			me.listDrafts({ state: 'pending' }),
			me.today(),
			apiClient
				.get('/api/v1/me/audit?kind=external_api&since_hours=168&limit=50')
				.then((r: any) => r.data.data),
		]);

		const next: FeedItem[] = [];

		if (drafts.status === 'fulfilled') {
			for (const d of drafts.value.drafts) {
				next.push({
					kind:    'draft',
					id:      `draft:${d.id}`,
					ts:      d.cycle_ts ? cycleTsToIso(d.cycle_ts) : new Date().toISOString(),
					app:     d.app,
					subject: d.subject || '(no subject)',
					to:      d.to || '',
					body:    d.body || '',
				});
			}
		}


		if (today.status === 'fulfilled') {
			for (const c of today.value.cycles) {
				next.push({
					kind:       'cycle',
					id:         `cycle:${c.app}:${c.loop}:${c.ts}`,
					ts:         c.ts,
					app:        c.app,
					loop:       c.loop,
					ok:         c.ok,
					skipped:    c.skipped,
					skipReason: c.skip_reason,
					lastError:  c.last_error,
				});
			}
			for (const h of today.value.headlines) {
				if (h.kind === 'drafts') continue; // already in drafts section
				next.push({
					kind:       'notice',
					id:         `notice:${h.kind}:${h.app || ''}:${h.loop || ''}:${h.ts || ''}`,
					ts:         h.ts || new Date().toISOString(),
					summary:    h.summary,
					detail:     h.detail,
					noticeKind: h.kind as any,
				});
			}
		}

		if (audit.status === 'fulfilled') {
			for (const e of audit.value.events) {
				next.push({
					kind:     'audit',
					id:       `audit:${e.ts}:${e.endpoint}`,
					ts:       e.ts,
					endpoint: e.endpoint || 'unknown',
					model:    e.model,
				});
			}
		}

		// De-dup defensively (drafts can also surface as notices etc.).
		const seen = new Set<string>();
		const unique = next.filter((i) => {
			if (seen.has(i.id)) return false;
			seen.add(i.id);
			return true;
		});
		unique.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
		setItems(unique);
		setRefreshing(false);
		setLastRefresh(Date.now());
	}, []);

	useEffect(() => { load(); }, [load]);
	// Chat→page bus: draft sends/edits/dismissals from chat reflect immediately.
	useStudioRefetch(["drafts"], load);

	// Auto-refresh — every 30s while the tab is visible. Pauses while the
	// tab is hidden so we don't burn the rate limit on background users.
	// Refreshes immediately when the user comes back to the tab. The AI
	// is doing things in the background; the feed should feel alive.
	useEffect(() => {
		let timer: number | null = null;
		const tick = () => { load(); };
		const start = () => {
			if (timer != null) return;
			timer = window.setInterval(tick, 30_000);
		};
		const stop = () => {
			if (timer != null) { window.clearInterval(timer); timer = null; }
		};
		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				load();
				start();
			} else {
				stop();
			}
		};
		start();
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			stop();
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [load]);

	const visible = useMemo(() => {
		if (!items) return [];
		const f = FILTERS.find((x) => x.id === filter)!;
		return items.filter((i) => f.matches(i.kind));
	}, [items, filter]);

	const counts = useMemo(() => {
		const out: Record<Filter, number> = { all: 0, drafts: 0, activity: 0, audit: 0, notices: 0 };
		if (!items) return out;
		for (const i of items) {
			out.all++;
			if (i.kind === 'draft') out.drafts++;
			if (i.kind === 'cycle') out.activity++;
			if (i.kind === 'audit') out.audit++;
			if (i.kind === 'notice') out.notices++;
		}
		return out;
	}, [items]);

	const onDraftAction = async (
		draftId: string, action: 'send' | 'dismiss' | 'edit', body?: string,
	) => {
		setBusy((b) => ({ ...b, [draftId]: true }));
		try {
			if (action === 'send')     await me.sendDraft(draftId);
			if (action === 'dismiss')  await me.dismissDraft(draftId);
			if (action === 'edit')     await me.editDraft(draftId, { body });
			toast.success(
				action === 'send'    ? 'Draft sent' :
				action === 'dismiss' ? 'Dismissed'  :
				                       'Saved'
			);
			await load();
		} catch (e) {
			toast.error(`Failed: ${e instanceof MeApiError ? e.message : String(e)}`);
		} finally {
			setBusy((b) => ({ ...b, [draftId]: false }));
		}
	};

	return (
		<div className="space-y-4">
			{/* Inbox = a pure feed. The "Your AI" tab was retired — the
			    Knowledge surface has its own nav entry at /studio/knowledge. */}
			<div className="flex items-center justify-end gap-2">
				<span className="hidden md:inline text-[11px] text-slate-400" title={`Last refreshed at ${new Date(lastRefresh).toLocaleTimeString()}`}>
					{refreshing ? "Updating…" : `Updated ${secondsAgo(lastRefresh)}`}
				</span>
				<button
					onClick={load}
					disabled={refreshing}
					className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-50 transition-colors"
				>
					<RefreshCw className={[
						"w-3 h-3 transition-transform",
						refreshing ? "animate-spin text-gold-600" : "",
					].join(" ")} />
					Refresh
				</button>
			</div>

			<InboxFeedBody
				items={items}
				filter={filter}
				setFilter={setFilter}
				counts={counts}
				visible={visible}
				busy={busy}
				onDraftAction={onDraftAction}
			/>
		</div>
	);
}

function InboxFeedBody({
	items, filter, setFilter, counts, visible, busy, onDraftAction,
}: {
	items: FeedItem[] | null;
	filter: Filter;
	setFilter: (f: Filter) => void;
	counts: Record<Filter, number>;
	visible: FeedItem[];
	busy: Record<string, boolean>;
	onDraftAction: (id: string, action: 'send' | 'edit' | 'dismiss', body?: string) => Promise<void>;
}) {
	return (
		<div className="space-y-4">
			<PageHints prompts={[
				'show my pending drafts',
				"send any obvious replies",
				'what should I act on first?',
			]} />

			<nav className="flex items-center gap-1.5 flex-wrap">
				{FILTERS.map((f) => {
					const active = filter === f.id;
					const n = counts[f.id];
					return (
						<button
							key={f.id}
							onClick={() => setFilter(f.id)}
							className={[
								'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition-colors',
								active
									? 'bg-slate-900 text-white shadow-sm'
									: 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300',
							].join(' ')}
						>
							{f.label}
							{n > 0 && (
								<span className={['text-[10px]', active ? 'text-white/70' : 'text-slate-500'].join(' ')}>
									{n}
								</span>
							)}
						</button>
					);
				})}
			</nav>

			{items === null && (
				<div className="text-sm text-slate-500 italic inline-flex items-center gap-1.5">
					<Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
				</div>
			)}

			{items !== null && visible.length === 0 && (
				items.length === 0
					? <InboxZeroState />
					: <FilterEmptyState filter={filter} onReset={() => setFilter('all')} />
			)}

			<ul className="space-y-2">
				{visible.map((item) => (
					<li key={item.id}>
						{item.kind === 'draft'  && <DraftCard item={item}  busy={!!busy[item.id.slice(6)]} onAction={(a, body) => onDraftAction(item.id.slice(6), a, body)} />}
						{item.kind === 'cycle'  && <CycleCard item={item} />}
						{item.kind === 'audit'  && <AuditCard item={item} />}
						{item.kind === 'notice' && <NoticeCard item={item} />}
					</li>
				))}
			</ul>
		</div>
	);
}

// ── Empty states ───────────────────────────────────────────────────

// InboxZeroState — the user has *nothing* in their inbox. This is a
// genuine inbox-zero moment, not a filter quirk. Treat as a calm
// celebration plus a nudge toward the natural next step (a workflow
// that produces drafts the user can act on).
function InboxZeroState() {
	const openComposer = () => {
		// The ?compose=1 host is /studio/apps/all (pages/studio/apps.tsx reads
		// the param and opens NewWorkflowFlow).
		//
		// This used to point at /studio/workflows?compose=1 and the button did
		// NOTHING. WorkflowsListRedirect does forward the query — its comment
		// still says "?compose=1 must reach the apps page's composer host" — but
		// the host moved out from under it: /studio/apps is StudioWorkspace,
		// which never reads the param and then self-redirects to
		// /studio/apps/<app> with no search string, dropping it. So the redirect
		// was faithful and the destination had changed, which is why nothing
		// looked broken from either side.
		window.location.href = '/studio/apps/all?compose=1';
	};
	const askAgent = () => {
		window.dispatchEvent(new CustomEvent('studio:ask', {
			detail: { prompt: 'What kind of workflow would fit my day?', autosend: true },
		}));
	};
	return (
		<div className="rounded-2xl border border-gold-100 bg-gradient-to-br from-gold-50/40 to-white py-10 px-6 text-center">
			<div className="w-14 h-14 mx-auto rounded-2xl bg-gold-100/60 flex items-center justify-center mb-4 shadow-inner shadow-gold-50">
				<CheckCircle2 className="w-7 h-7 text-gold-600" />
			</div>
			<div className="text-base font-medium text-slate-900">Inbox zero.</div>
			<p className="text-sm text-slate-600 mt-1.5 max-w-md mx-auto leading-relaxed">
				When your workflows produce something for you — a draft, a
				summary, a heads-up — it lands here for review.
			</p>
			<div className="flex items-center justify-center gap-2 mt-5">
				<button
					onClick={openComposer}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gold-500 text-white hover:bg-gold-600 transition-colors shadow-sm shadow-gold-100"
				>
					<Plus className="w-3.5 h-3.5" />
					New workflow
				</button>
				<button
					onClick={askAgent}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
				>
					<Sparkles className="w-3.5 h-3.5 text-gold-600" />
					Ask for ideas
				</button>
			</div>
		</div>
	);
}

// FilterEmptyState — items exist but none match the current filter.
// Quieter than InboxZero; the obvious action is to clear the filter.
function FilterEmptyState({ filter, onReset }: { filter: Filter; onReset: () => void }) {
	return (
		<div className="rounded-xl border border-dashed border-slate-200 bg-white/60 py-8 px-6 text-center">
			<FilterIcon className="w-5 h-5 mx-auto text-slate-400" />
			<div className="text-sm text-slate-700 mt-2.5">
				Nothing in <span className="font-medium">{filter}</span> right now.
			</div>
			<button
				onClick={onReset}
				className="mt-3 text-xs text-gold-700 hover:text-gold-800 hover:underline transition-colors"
			>
				Show everything
			</button>
		</div>
	);
}

// ── Card primitives ────────────────────────────────────────────────

function FeedRow({
	icon: Icon, tone, ts, title, sub, body, actions, link, feedback, pick,
}: {
	icon: typeof Mail;
	tone: 'emerald' | 'slate' | 'amber' | 'rose' | 'indigo';
	ts: string;
	title: React.ReactNode;
	sub?: React.ReactNode;
	body?: React.ReactNode;
	actions?: React.ReactNode;
	link?: { to: string; label: string };
	/** Optional hover-revealed feedback row (👍/✏️/👎) appearing top-right. */
	feedback?: React.ReactNode;
	/** Optional mouse-picker annotations. When provided, the row becomes pickable. */
	pick?: { kind: string; id: string; label: string; affordances?: string };
}) {
	const toneCls = {
		emerald: 'border-gold-200 bg-gold-50/40 hover:border-gold-300',
		slate:   'border-slate-200 bg-white hover:border-slate-300',
		amber:   'border-gold-200 bg-gold-50/40 hover:border-gold-300',
		rose:    'border-rose-200 bg-rose-50/40 hover:border-rose-300',
		indigo:  'border-indigo-200 bg-indigo-50/30 hover:border-indigo-300',
	}[tone];
	const iconCls = {
		emerald: 'text-gold-600',
		slate:   'text-slate-500',
		amber:   'text-gold-600',
		rose:    'text-rose-600',
		indigo:  'text-indigo-600',
	}[tone];
	const pickAttrs = pick
		? {
			'data-pick-kind':        pick.kind,
			'data-pick-id':          pick.id,
			'data-pick-label':       pick.label,
			'data-pick-affordances': pick.affordances,
		}
		: {};
	return (
		<div className={['group rounded-lg border px-3 py-2.5 transition-colors', toneCls].join(' ')} {...pickAttrs}>
			<div className="flex items-start gap-3">
				<Icon className={['w-4 h-4 mt-0.5 flex-shrink-0', iconCls].join(' ')} />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-3">
						<div className="text-sm font-medium text-slate-900 truncate">{title}</div>
						<div className="flex items-center gap-2 flex-shrink-0">
							{feedback && (
								<span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
									{feedback}
								</span>
							)}
							<div className="text-[11px] text-slate-500 tabular-nums">
								{formatRelative(ts)}
							</div>
						</div>
					</div>
					{sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
					{body && <div className="mt-2 text-sm text-slate-700 leading-relaxed">{body}</div>}
					{(actions || link) && (
						<div className="mt-2.5 flex items-center justify-end gap-2 flex-wrap">
							{link && (
								<Link to={link.to} className="text-xs text-gold-700 hover:underline inline-flex items-center gap-0.5">
									{link.label} <ChevronRight className="w-3 h-3" />
								</Link>
							)}
							{actions}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Per-kind cards ─────────────────────────────────────────────────

function DraftCard({
	item, busy, onAction,
}: {
	item: Extract<FeedItem, { kind: 'draft' }>;
	busy: boolean;
	onAction: (a: 'send' | 'dismiss' | 'edit', body?: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [text, setText] = useState(item.body);

	// Phase S6b — when the user opens a draft for edit, declare it as
	// the active selection so the chat agent knows "send it" / "edit it"
	// refers to this draft.
	useEffect(() => {
		if (!editing) return;
		setStudioSelection({
			kind: 'draft',
			id: item.id.slice(6),
			label: `to ${item.to} — ${item.subject}`,
			affordances: ['send_draft', 'edit_draft', 'dismiss_draft'],
		});
		return () => setStudioSelection(null);
	}, [editing, item.id, item.to, item.subject]);

	const draftPick = {
		kind: 'draft',
		id: `draft:${item.id.slice(6)}`,
		label: `${item.subject} → ${item.to}`,
		affordances: 'send_draft,edit_draft,dismiss_draft,explain',
	};
	if (editing) {
		return (
			<FeedRow
				icon={Mail}
				tone="indigo"
				ts={item.ts}
				pick={draftPick}
				title={item.subject}
				sub={<>To <span className="font-medium text-slate-700">{item.to}</span> · {item.app}</>}
				body={
					<textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						rows={6}
						className="w-full text-sm border border-slate-300 rounded p-2 font-sans"
					/>
				}
				actions={
					<>
						<button onClick={() => setEditing(false)}
							className="px-3 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50">
							Cancel
						</button>
						<button onClick={() => { onAction('edit', text); setEditing(false); }}
							disabled={busy}
							className="px-3 py-1 text-xs rounded bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50">
							Save
						</button>
					</>
				}
			/>
		);
	}
	return (
		<FeedRow
			icon={Mail}
			tone="indigo"
			ts={item.ts}
			pick={draftPick}
			title={item.subject}
			sub={<>To <span className="font-medium text-slate-700">{item.to}</span> · {item.app}</>}
			body={<div className="whitespace-pre-wrap line-clamp-4">{item.body || '(empty)'}</div>}
			actions={
				<>
					<button onClick={() => onAction('send')} disabled={busy}
						className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded border border-gold-200 bg-gold-50 text-gold-800 hover:bg-gold-100 disabled:opacity-50">
						{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
					</button>
					<button onClick={() => setEditing(true)} disabled={busy}
						className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
						<Edit2 className="w-3 h-3" /> Edit
					</button>
					<button onClick={() => onAction('dismiss')} disabled={busy} title="Dismiss"
						className="inline-flex items-center px-2 py-1 text-xs rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50">
						<X className="w-3 h-3" />
					</button>
				</>
			}
		/>
	);
}

function CycleCard({ item }: { item: Extract<FeedItem, { kind: 'cycle' }> }) {
	const failing = !item.ok && !item.skipped;
	const Icon = failing ? AlertCircle : item.skipped ? AlertCircle : CheckCircle2;
	const tone = failing ? 'rose' : item.skipped ? 'amber' : 'slate';
	const verb = failing ? 'failed' : item.skipped ? 'skipped' : 'ran';
	// Cycle ts in the journal is ISO; the existing convention for the
	// cycle dir name is YYYYMMDDTHHMMSSZ (15 chars). Use the same shape
	// for /me/cycles/feedback (via IntentFeedbackRow) so the ledger row
	// can join back to the cycle artifact.
	const cycleTs = item.ts.replace(/[-:]/g, '').replace('T', 'T').slice(0, 15) + 'Z';
	return (
		<FeedRow
			icon={Icon}
			tone={tone}
			ts={item.ts}
			pick={{
				kind: 'cycle',
				id: `cycle:${item.app}:${item.loop}:${cycleTs}`,
				label: `${humanizeLoop(item.loop)} ${verb} — ${item.app}`,
				affordances: 'give_feedback,explain,rerun,inspect',
			}}
			title={<>{humanizeLoop(item.loop)} {verb}</>}
			sub={item.app}
			body={
				item.skipReason ? (
					<span className="text-xs text-gold-800">{item.skipReason}</span>
				) : item.lastError ? (
					<span className="text-xs text-rose-800 font-mono truncate block">{item.lastError.slice(0, 200)}</span>
				) : undefined
			}
			// Successful cycles get the 👍/✏️/👎 row so the user can
			// teach the loop right where the outcome surfaces. Failed/
			// skipped cycles skip feedback (no output to evaluate; the
			// user goes to Inspect instead).
			feedback={
				item.ok && !item.skipped
					? <IntentFeedbackRow app={item.app} loop={item.loop} cycleTs={cycleTs} outputId={`cycle:${cycleTs}`} dense />
					: undefined
			}
			link={{ to: `/studio/intents/cycle/${encodeURIComponent(item.app)}/${encodeURIComponent(item.loop)}/${encodeURIComponent(cycleTs)}`, label: 'Inspect' }}
		/>
	);
}

function AuditCard({ item }: { item: Extract<FeedItem, { kind: 'audit' }> }) {
	return (
		<FeedRow
			icon={Lock}
			tone="slate"
			ts={item.ts}
			pick={{
				kind: 'audit',
				id: `audit:${item.ts}:${item.endpoint}`,
				label: `API call · ${item.endpoint}${item.model ? ' · ' + item.model : ''}`,
				affordances: 'explain',
			}}
			title={<>API call · <span className="font-mono">{item.endpoint}</span></>}
			sub={item.model ? `model=${item.model}` : 'external request from your AI'}
		/>
	);
}

function NoticeCard({ item }: { item: Extract<FeedItem, { kind: 'notice' }> }) {
	const tone = item.noticeKind === 'quota_paused' ? 'amber'
		: item.noticeKind === 'cycle_failed' ? 'rose'
		: 'emerald';
	const Icon = item.noticeKind === 'brief' ? Sparkles : AlertCircle;
	// Briefs are an Examples-axis output (something the AI produced
	// for you). Failures are a Standard-axis signal (the AI's own
	// scorecard registering trouble). The axis chip in the row sub
	// communicates this in the same language used everywhere else.
	const axis =
		item.noticeKind === 'brief'        ? AXIS_META.examples :
		item.noticeKind === 'cycle_failed' ? AXIS_META.standard :
		                                     null;
	return (
		<FeedRow
			icon={Icon}
			tone={tone}
			ts={item.ts}
			pick={{
				kind: 'notice',
				id: `notice:${item.id}`,
				label: item.summary,
				affordances: 'explain,give_feedback,intent_audit',
			}}
			title={item.summary}
			sub={
				axis ? (
					<span className="inline-flex items-center gap-1.5">
						<span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${axis.tone}`}>
							{axis.label}
						</span>
						<span className="text-slate-500">{axis.phrase}</span>
					</span>
				) : undefined
			}
			body={item.detail ? <span className="text-sm text-slate-600">{item.detail}</span> : undefined}
			link={item.noticeKind === 'quota_paused' ? { to: '/studio/settings#secrets', label: 'Upgrade' } : undefined}
		/>
	);
}

// ── Helpers ────────────────────────────────────────────────────────

// Cycle-ts shape is YYYYMMDDTHHMMSS (15 chars, no separators) — convert
// to ISO for the timeline sorter.
// secondsAgo — compact relative-time for the auto-refresh chip.
function secondsAgo(ms: number): string {
	const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
	if (s < 5) return 'just now';
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	return `${Math.floor(s / 3600)}h ago`;
}

function cycleTsToIso(ts: string): string {
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
	if (!m) return new Date().toISOString();
	const [, y, mo, d, h, mi, s] = m;
	return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

function humanizeLoop(loop: string): string {
	const map: Record<string, string> = {
		morning_brief:     'Morning brief',
		hourly_triage:     'Hourly triage',
		weekly_reflection: 'Weekly reflection',
		cc_watcher:        'Claude Code watcher',
	};
	return map[loop] || loop.replace(/_/g, ' ');
}

function formatRelative(ts: string): string {
	const t = new Date(ts).getTime();
	if (!t) return ts;
	const diff = Date.now() - t;
	if (diff < 0) return 'scheduled';
	const min = Math.floor(diff / 60_000);
	if (min < 1) return 'just now';
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h`;
	const d = Math.floor(hr / 24);
	return `${d}d`;
}
