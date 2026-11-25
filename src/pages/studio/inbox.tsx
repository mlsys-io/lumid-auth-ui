// Workflow feed pieces for Activity's Needs you / What your apps said (pages/account/inbox.tsx).
//
// This was its own page, "Drafts" (/studio/drafts), with a five-chip filter
// row — an inbox beside the Inbox. The two merged in 2026-11; /studio/drafts
// now redirects. What lives here is the feed it aggregated from three existing
// endpoints, and its cards:
//   - /me/drafts                       (pending drafts to approve)
//   - /me/today                        (headlines + cycle history)
//   - /me/audit?kind=external_api      (read-only audit trail)

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Mail, CheckCircle2, AlertCircle, Send, X, Edit2,
	Sparkles, Loader2, ChevronRight, Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { me, MeApiError } from '@/api/me';
import apiClient from '@/api/client';
import { setStudioSelection } from '@/components/StudioContext';
import { useStudioRefetch } from '@/hooks/useStudioRefetch';
import { IntentFeedbackRow } from '@/components/IntentFeedbackRow';
import { AXIS_META } from '@/lib/demo-intents';
import { appTitle } from '@/components/workflow/AppCard';

export type FeedItem =
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

/** Epoch ms for sorting a feed item against inbox messages. */
export function feedItemMs(i: FeedItem): number {
	const t = Date.parse(i.ts);
	return Number.isNaN(t) ? 0 : t;
}

/** The workflow feed: pending drafts, cycle outcomes, platform notices and
 *  the external-API audit trail. Polls every 30 s while the tab is visible. */
export function useWorkflowFeed() {
	const [items, setItems] = useState<FeedItem[] | null>(null);
	const [busy, setBusy] = useState<Record<string, boolean>>({});

	const load = useCallback(async () => {
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
		setItems(next.filter((i) => {
			if (seen.has(i.id)) return false;
			seen.add(i.id);
			return true;
		}));
	}, []);

	useEffect(() => { load(); }, [load]);
	// Chat→page bus: draft sends/edits/dismissals from chat reflect immediately.
	useStudioRefetch(["drafts"], load);

	// Auto-refresh every 30 s while the tab is visible; refresh at once on return.
	useEffect(() => {
		let timer: number | null = null;
		const start = () => { if (timer == null) timer = window.setInterval(load, 30_000); };
		const stop = () => { if (timer != null) { window.clearInterval(timer); timer = null; } };
		const onVisibility = () => {
			if (document.visibilityState === 'visible') { load(); start(); } else stop();
		};
		start();
		document.addEventListener('visibilitychange', onVisibility);
		return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
	}, [load]);

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

	return { items, load, busy, onDraftAction };
}

/** One feed item, rendered by kind. */
export function FeedCard({
	item, busy, onDraftAction,
}: {
	item: FeedItem;
	busy: Record<string, boolean>;
	onDraftAction: (id: string, action: 'send' | 'edit' | 'dismiss', body?: string) => Promise<void>;
}) {
	if (item.kind === 'draft') return <DraftCard item={item} busy={!!busy[item.id.slice(6)]} onAction={(a, body) => onDraftAction(item.id.slice(6), a, body)} />;
	if (item.kind === 'cycle') return <CycleCard item={item} />;
	if (item.kind === 'audit') return <AuditCard item={item} />;
	return <NoticeCard item={item} />;
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
		// Legacy colour keys -> Lumen tones (src/lib/tones.ts).
		emerald: 'border-gold-200 bg-gold-50/40 hover:border-gold-300',
		slate:   'border-border bg-card hover:border-ink-300',
		amber:   'border-ember-200 bg-ember-50/40 hover:border-ember-300',
		rose:    'border-brick-200 bg-brick-50/40 hover:border-brick-300',
		indigo:  'border-plum-200 bg-plum-50/30 hover:border-plum-300',
	}[tone];
	const iconCls = {
		emerald: 'text-gold-600',
		slate:   'text-ink-500',
		amber:   'text-ember-600',
		rose:    'text-brick-600',
		indigo:  'text-plum-600',
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
						<div className="text-sm font-medium text-ink-900 truncate">{title}</div>
						<div className="flex items-center gap-2 flex-shrink-0">
							{feedback && (
								<span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
									{feedback}
								</span>
							)}
							<div className="text-micro text-ink-600 tabular-nums">
								{formatRelative(ts)}
							</div>
						</div>
					</div>
					{sub && <div className="text-xs text-ink-600 mt-0.5">{sub}</div>}
					{body && <div className="mt-2 text-sm text-ink-700 leading-relaxed">{body}</div>}
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
				sub={item.to ? <>To <span className="font-medium text-ink-700">{item.to}</span> · {appTitle(item.app)}</> : appTitle(item.app)}
				body={
					<textarea
						value={text}
						onChange={(e) => setText(e.target.value)}
						rows={6}
						className="w-full text-sm border border-ink-300 rounded p-2 font-sans"
					/>
				}
				actions={
					<>
						<button onClick={() => setEditing(false)}
							className="px-3 py-1 text-xs rounded border border-ink-200 bg-card hover:bg-ink-50">
							Cancel
						</button>
						<button onClick={() => { onAction('edit', text); setEditing(false); }}
							disabled={busy}
							className="px-3 py-1 text-xs rounded bg-gold-700 text-white hover:bg-gold-800 disabled:opacity-50">
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
			sub={item.to ? <>To <span className="font-medium text-ink-700">{item.to}</span> · {appTitle(item.app)}</> : appTitle(item.app)}
			body={<div className="whitespace-pre-wrap line-clamp-4">{item.body || '(empty)'}</div>}
			actions={
				<>
					<button onClick={() => onAction('send')} disabled={busy}
						className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded border border-gold-200 bg-gold-50 text-gold-800 hover:bg-gold-100 disabled:opacity-50">
						{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send
					</button>
					<button onClick={() => setEditing(true)} disabled={busy}
						className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded border border-ink-200 hover:bg-ink-50 disabled:opacity-50">
						<Edit2 className="w-3 h-3" /> Edit
					</button>
					<button onClick={() => onAction('dismiss')} disabled={busy} title="Dismiss"
						className="inline-flex items-center px-2 py-1 text-xs rounded border border-ink-200 hover:bg-ink-50 disabled:opacity-50">
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
					<span className="text-xs text-brick-800 font-mono truncate block">{item.lastError.slice(0, 200)}</span>
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
						<span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-nano font-medium ${axis.tone}`}>
							{axis.label}
						</span>
						<span className="text-ink-600">{axis.phrase}</span>
					</span>
				) : undefined
			}
			body={item.detail ? <span className="text-sm text-ink-600">{item.detail}</span> : undefined}
			link={item.noticeKind === 'quota_paused' ? { to: '/studio/settings#secrets', label: 'Upgrade' } : undefined}
		/>
	);
}

// ── Helpers ────────────────────────────────────────────────────────

// Cycle-ts shape is YYYYMMDDTHHMMSS (15 chars, no separators) — convert
// to ISO for the timeline sorter.
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
