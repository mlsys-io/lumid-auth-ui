// IntentJournal — the dashboard rewrite. Same export name as the
// editorial version so today.tsx doesn't change.
//
// Goal: one surface for show / track / manage of standing intents.
// No competing sections (no OutcomeRow tile strip, no global
// DecisionsPending list) — the per-intent card carries its own
// outcomes, pending drafts, and controls. Cards stack one per row
// at full width and expand inline.
//
// Card anatomy (Show mode):
//   ┌────────────────────────────────────────────────────────┐
//   │ ● live · common person · week 2     [⏸ pause] [↻ now] │
//   │ Handle my weekly inbox …                                │
//   │ This week: voice match 78→84%, 4 family drafts …       │
//   │ ┌── 4h 12m ──┐ ┌── 84% ──┐ ┌── 2 ──┐                  │
//   │ │ reclaimed  │ │ voice  │ │ pending│                  │
//   │ └────────────┘ └────────┘ └────────┘                  │
//   │ ● std 2  ● ex 4  ● mem 3  ● rules 1        Expand ▽   │
//   └────────────────────────────────────────────────────────┘
//
// Track mode (expanded inline): drafts pending · activity timeline.
// Manage mode (footer of expanded): pause / run now / rules / audit.

import { useState, useMemo, useEffect } from 'react';
import {
	Pause, Play, RotateCw, ScrollText, Sparkles, ChevronDown, Plus,
	Check, Pencil, X, Mail, FlaskConical, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
	type DemoIntent, type NarrativeBullet,
} from '@/lib/demo-intents';
import {
	loadDecisions, setDecisionStatus, DECISIONS_EVENT,
	type DemoDecision, type DecisionStatus, type DecisionIconKind,
} from '@/lib/demo-decisions';
import { rejectWithReason } from '@/lib/demo-actions';
import { setStudioSelection } from './StudioContext';

const DECISION_ICON: Record<DecisionIconKind, LucideIcon> = {
	mail:  Mail,
	flask: FlaskConical,
};

interface Props { intents: DemoIntent[]; }

export function IntentJournal({ intents }: Props) {
	const [openId, setOpenId] = useState<string | null>(null);

	const [decisions, setDecisions] = useState<Array<DemoDecision & { status: DecisionStatus }>>(
		() => loadDecisions(),
	);
	useEffect(() => {
		const refresh = () => setDecisions(loadDecisions());
		window.addEventListener(DECISIONS_EVENT, refresh);
		return () => window.removeEventListener(DECISIONS_EVENT, refresh);
	}, []);
	const decisionsByIntent = useMemo(() => {
		const out: Record<string, Array<DemoDecision & { status: DecisionStatus }>> = {};
		for (const d of decisions) {
			if (!d.intentId) continue;
			(out[d.intentId] ||= []).push(d);
		}
		return out;
	}, [decisions]);

	const openNewIntentChat = () =>
		window.dispatchEvent(new CustomEvent('studio:ask', {
			detail: {
				prompt: 'I want to set up a new intent. Walk me through what you want your AI to handle and what "done" looks like.',
				autosend: true,
			},
		}));

	return (
		<div className="space-y-4">
			{/* Header strip ───────────────────────────────── */}
			<div className="flex items-end justify-between gap-3">
				<div>
					<div className="flex items-baseline gap-2.5">
						<h1 className="text-[22px] font-semibold tracking-tight text-slate-900">Intents</h1>
						<span className="text-[12px] text-slate-500 tabular-nums">
							{intents.length} active
						</span>
					</div>
					<p className="text-[13px] text-slate-500 mt-0.5">
						Standing goals your AI is pursuing. Click a card to track its progress or manage it.
					</p>
				</div>
				<button
					onClick={openNewIntentChat}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98] transition-all shadow-sm shadow-emerald-100"
				>
					<Plus className="w-3.5 h-3.5" />
					New intent
				</button>
			</div>

			{/* Cards ───────────────────────────────────────── */}
			{intents.length === 0 ? (
				<EmptyDashboard onCompose={openNewIntentChat} />
			) : (
				<div className="space-y-3">
					{intents.map((intent) => (
						<IntentCard
							key={intent.id}
							intent={intent}
							decisions={decisionsByIntent[intent.id] || []}
							open={openId === intent.id}
							onToggle={() => setOpenId(openId === intent.id ? null : intent.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

// ── Card ──────────────────────────────────────────────────────────

function IntentCard({
	intent, decisions, open, onToggle,
}: {
	intent: DemoIntent;
	decisions: Array<DemoDecision & { status: DecisionStatus }>;
	open: boolean;
	onToggle: () => void;
}) {
	const pending = decisions.filter((d) => d.status === 'pending');
	const summary = intent.summary || intent.detail?.narrative?.[0]?.text || intent.latest;
	const live = intent.live ?? true;

	// Declare selection while open.
	useEffect(() => {
		if (!open) return;
		setStudioSelection({
			kind: 'intent',
			id: intent.id,
			label: intent.title,
			affordances: ['pause_intent', 'resume_intent', 'run_loop_now', 'inspect_last_result', 'give_feedback', 'intent_audit'],
		});
		return () => setStudioSelection(null);
	}, [open, intent]);

	const stats = useMemo(() => {
		const out: { label: string; value: string; tone?: 'amber' | 'emerald' | 'slate' }[] = [];
		if (intent.headline) {
			out.push({ label: intent.headline.label, value: intent.headline.value, tone: 'emerald' });
		}
		const std = intent.axisMovements?.find((m) => m.axis === 'standard');
		if (std && std.net !== undefined) {
			out.push({ label: 'standard ↑', value: `+${std.net}pp`, tone: 'emerald' });
		}
		if (pending.length > 0) {
			out.push({ label: pending.length === 1 ? 'draft pending' : 'drafts pending', value: String(pending.length), tone: 'amber' });
		} else {
			// When there's nothing pending, show "all clear" so the strip
			// never goes empty — keeps the card visually balanced.
			out.push({ label: 'all clear', value: '·', tone: 'slate' });
		}
		return out;
	}, [intent, pending.length]);

	return (
		<article
			className={[
				'group relative overflow-hidden',
				'rounded-2xl border border-slate-200/70 ring-1 ring-black/[0.03]',
				'bg-gradient-to-br from-white via-white to-slate-50/40',
				'hover:shadow-lg hover:shadow-slate-200/40 hover:-translate-y-[1px]',
				'transition-all duration-200',
			].join(' ')}
			data-pick-kind="intent"
			data-pick-id={intent.id}
			data-pick-label={intent.title}
			data-pick-affordances="pause,resume,rerun,inspect,give_feedback,intent_audit"
		>
			{/* Top status rail — emerald glow when live, slate when paused. */}
			<div
				className={[
					'absolute top-0 left-0 right-0 h-[2px] pointer-events-none',
					live ? 'intent-rail-live' : 'intent-rail-paused',
				].join(' ')}
				aria-hidden
			/>

			{/* Show — clickable header region ─────────────── */}
			<div className="px-6 pt-5 pb-5 cursor-pointer" onClick={onToggle}>
				{/* Status pill + persona + quick actions row */}
				<div className="flex items-center justify-between gap-3 mb-3.5">
					<div className="flex items-center gap-2.5">
						{live ? (
							<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/70 text-emerald-700 text-[10.5px] font-semibold tracking-[0.04em] uppercase">
								<span className="intent-live-dot" />
								live
							</span>
						) : (
							<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500 text-[10.5px] font-semibold tracking-[0.04em] uppercase">
								<span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
								paused
							</span>
						)}
						<span className="text-[12px] text-slate-500">{intent.persona}</span>
					</div>
					<div
						className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity"
						onClick={(e) => e.stopPropagation()}
					>
						<IconQuickAction
							icon={live ? Pause : Play}
							label={live ? 'Pause' : 'Resume'}
							onClick={() => toast.success(live ? 'Paused. Run again any time.' : 'Resumed.')}
						/>
						<IconQuickAction
							icon={RotateCw}
							label="Run now"
							onClick={() => toast.success('Queued — running this cycle now.')}
						/>
					</div>
				</div>

				{/* Title — hero typography of the card */}
				<h2 className="text-[19px] font-semibold text-slate-900 leading-[1.3] tracking-[-0.011em]">
					{intent.title}
				</h2>

				{/* Summary line */}
				<p className="text-[13.5px] text-slate-600 mt-2 leading-relaxed pr-2">
					<span className="text-emerald-700 font-medium italic">This week —</span>{' '}
					<span className="text-slate-700">{summary}</span>
				</p>

				{/* Stats strip — segmented widget, one widget, three cells.
				    Each cell uses gap-px + a hairline divider trick. */}
				{stats.length > 0 && (
					<div className="mt-4 flex items-stretch gap-px rounded-xl bg-slate-200/50 overflow-hidden ring-1 ring-slate-200/40">
						{stats.map((s) => (
							<StatCell key={s.label} label={s.label} value={s.value} tone={s.tone} />
						))}
					</div>
				)}

				{/* Footer — "n improvements this week" + expand. We
				    deliberately do NOT expose the six-axis vocab on
				    the card front — common users only need to know
				    "things got better, here's how many." The break-
				    down by axis lives in the expanded Track view for
				    power users. */}
				<div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
					{intent.axisMovements && intent.axisMovements.length > 0 ? (
						<span className="inline-flex items-center gap-2 text-[11px]">
							<Sparkles className="w-3 h-3 text-emerald-500" />
							<span className="text-slate-600">
								<span className="font-semibold text-slate-900 tabular-nums">
									{intent.axisMovements.reduce((acc, m) => acc + m.count, 0)}
								</span>
								<span className="text-slate-500 ml-1">improvements this week</span>
							</span>
						</span>
					) : (
						<span className="text-[11px] text-slate-400">no recorded changes yet</span>
					)}
					<button
						onClick={(e) => { e.stopPropagation(); onToggle(); }}
						className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700 transition-colors"
					>
						{open ? 'Collapse' : 'Track + manage'}
						<ChevronDown
							className={['w-3 h-3 transition-transform', open ? 'rotate-180' : ''].join(' ')}
						/>
					</button>
				</div>
			</div>

			{/* Track + Manage — smoothly collapsible ─────── */}
			<div className={['track-collapse', open ? 'open' : ''].join(' ')}>
				<div className="track-inner">
					<div className="border-t border-slate-200/70 bg-slate-50/50 px-6 py-5">
						<ExpandedBody intent={intent} pending={pending} />
					</div>
				</div>
			</div>
		</article>
	);
}

// Icon-only quick action for the card header. Discreet by default,
// fully visible on card hover.
function IconQuickAction({ icon: Icon, label, onClick }: {
	icon: LucideIcon; label: string; onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			title={label}
			className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all"
		>
			<Icon className="w-3.5 h-3.5" />
		</button>
	);
}

// ── Stat cell (segmented widget, hairline dividers via gap-px) ──

function StatCell({ label, value, tone }: {
	label: string;
	value: string;
	tone?: 'amber' | 'emerald' | 'slate';
}) {
	const valueColor =
		tone === 'amber'   ? 'text-amber-700'   :
		tone === 'emerald' ? 'text-emerald-700' :
		                     'text-slate-900';
	return (
		<div
			className="flex-1 bg-white px-3.5 py-2.5 hover:bg-slate-50/60 transition-colors"
			data-pick-kind="metric"
			data-pick-id={`stat:${label}`}
			data-pick-label={`${label}: ${value}`}
			data-pick-affordances="explain,intent_audit,give_feedback"
		>
			<div className={`text-[17px] font-semibold tabular-nums leading-none tracking-tight ${valueColor}`}>
				{value}
			</div>
			<div className="text-[10.5px] text-slate-500 mt-1.5 leading-none">{label}</div>
		</div>
	);
}

// ── Expanded body (Track + Manage) ────────────────────────────────

function ExpandedBody({
	intent,
	pending,
}: {
	intent: DemoIntent;
	pending: Array<DemoDecision & { status: DecisionStatus }>;
}) {
	const narrative = intent.detail?.narrative as NarrativeBullet[] | undefined;
	const activity = intent.detail?.body && 'activity' in intent.detail.body
		? intent.detail.body.activity : undefined;
	return (
		<div className="space-y-5">
			{/* What changed — plain bullets, no axis vocab. A small
			    colored dot hints at the type but the label doesn't
			    appear (kept off the everyday surface; still in the
			    audit endpoint for power users). */}
			{narrative && narrative.length > 0 && (
				<div>
					<SubLabel>What changed this week</SubLabel>
					<ul className="space-y-2">
						{narrative.map((b, i) => {
							const dotColor: Record<string, string> = {
								standard: 'bg-emerald-500',
								examples: 'bg-emerald-500',
								memory:   'bg-emerald-500',
								rules:    'bg-emerald-500',
								recipe:   'bg-emerald-500',
								pieces:   'bg-emerald-500',
							};
							return (
								<li key={i} className="flex items-baseline gap-2.5 text-[13.5px] text-slate-800 leading-relaxed">
									<span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor[b.axis]}`} />
									<span>{b.text}</span>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			{/* Drafts pending */}
			{pending.length > 0 && (
				<div>
					<SubLabel>Pending your call <span className="text-slate-400">({pending.length})</span></SubLabel>
					<ul className="space-y-2">
						{pending.map((d) => <DraftEntry key={d.id} decision={d} />)}
					</ul>
				</div>
			)}

			{/* Activity timeline */}
			{activity && activity.length > 0 && (
				<div>
					<SubLabel>Activity</SubLabel>
					<ul className="space-y-1">
						{activity.slice(0, 6).map((a, i) => (
							<li key={i} className="flex items-baseline gap-3 text-[12.5px] text-slate-700">
								<span className="text-[10.5px] text-slate-500 w-[78px] flex-shrink-0 tabular-nums">
									{a.when}
								</span>
								<span>{a.text}</span>
								{a.detail && (
									<span className="text-[11px] text-slate-400">{a.detail}</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Manage — controls strip */}
			<div className="pt-3 border-t border-slate-200 flex items-center gap-2 flex-wrap">
				<ManageBtn icon={ScrollText} label="Rules" onClick={() => {
					window.dispatchEvent(new CustomEvent('studio:ask', {
						detail: { prompt: `Show the rules currently encoded for "${intent.title}".`, autosend: true },
					}));
				}} />
				<ManageBtn icon={Sparkles} label="What changed" onClick={() => {
					window.dispatchEvent(new CustomEvent('studio:ask', {
						detail: { prompt: `What changed about "${intent.title}" this week?`, autosend: true },
					}));
				}} />
			</div>
		</div>
	);
}

function SubLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="text-[10.5px] uppercase tracking-[0.08em] text-slate-500 font-medium mb-2">
			{children}
		</div>
	);
}

function ManageBtn({ icon: Icon, label, onClick }: {
	icon: LucideIcon; label: string; onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded-md border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50 transition-colors"
		>
			<Icon className="w-3 h-3" />
			{label}
		</button>
	);
}

// ── Draft entry inside Pending ────────────────────────────────────

function DraftEntry({ decision }: { decision: DemoDecision & { status: DecisionStatus } }) {
	const [text, setText] = useState(decision.preview);
	const [editing, setEditing] = useState(false);
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState('');
	const [busy, setBusy] = useState(false);
	const Icon = DECISION_ICON[decision.iconKind];

	const setStatus = (s: DecisionStatus) => setDecisionStatus(decision.id, s);
	const approve = () => { setStatus('approved'); toast.success('Approved — sending now.'); };
	const saveEdit = () => { setEditing(false); toast.success('Saved.'); };
	const submitReject = async () => {
		const r = reason.trim();
		if (!r) { toast.error('Add a one-line reason so the AI can learn from it.'); return; }
		setBusy(true);
		try {
			await rejectWithReason(decision.id, r);
			setStatus('rejected');
			setRejecting(false);
			toast.success('Got it. Added to your Rules — next cycle will reflect this.');
		} catch { toast.error('Could not record the rejection — try again.'); }
		finally { setBusy(false); }
	};

	return (
		<li
			className="rounded-md border border-slate-200 bg-white px-3.5 py-2.5"
			data-pick-kind="decision"
			data-pick-id={`decision:${decision.id}`}
			data-pick-label={`Pending: ${decision.subject}`}
			data-pick-affordances="approve,edit,reject,explain,give_feedback"
		>
			<div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1.5">
				<Icon className="w-3.5 h-3.5 text-slate-400" />
				<span>{decision.tag}</span>
				{decision.status === 'approved' && (
					<span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">approved</span>
				)}
				{decision.status === 'rejected' && (
					<span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">learned as a Rule</span>
				)}
			</div>

			{editing ? (
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					rows={4}
					className="w-full text-[13px] rounded border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-300"
				/>
			) : (
				<p className="text-[13.5px] text-slate-800 leading-relaxed">{text}</p>
			)}

			{decision.status === 'pending' && !editing && !rejecting && (
				<div className="flex items-center gap-1.5 mt-2.5">
					<RowBtn icon={Check}  label="Approve"            onClick={approve} primary />
					<RowBtn icon={Pencil} label="Edit"               onClick={() => setEditing(true)} />
					<RowBtn icon={X}      label="Reject with reason" onClick={() => setRejecting(true)} />
				</div>
			)}

			{editing && (
				<div className="flex items-center gap-1.5 mt-2.5">
					<RowBtn icon={Check} label="Save"   onClick={saveEdit} primary />
					<RowBtn icon={X}     label="Cancel" onClick={() => { setEditing(false); setText(decision.preview); }} />
				</div>
			)}

			{rejecting && (
				<div className="mt-2.5">
					<textarea
						autoFocus
						value={reason}
						onChange={(e) => setReason(e.target.value.slice(0, 200))}
						rows={2}
						placeholder='e.g. too formal — write to family casually, never start with "Dear".'
						className="w-full text-[13px] rounded border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-300"
					/>
					<div className="flex items-center justify-between mt-1.5">
						<span className="text-[10.5px] text-slate-400 tabular-nums">{reason.length}/200</span>
						<div className="flex items-center gap-1.5">
							<RowBtn icon={X}     label="Cancel" onClick={() => { setRejecting(false); setReason(''); }} />
							<RowBtn icon={Check} label={busy ? 'Encoding…' : 'Submit'} onClick={submitReject} primary />
						</div>
					</div>
				</div>
			)}
		</li>
	);
}

function RowBtn({ icon: Icon, label, onClick, primary }: {
	icon: LucideIcon; label: string; onClick: () => void; primary?: boolean;
}) {
	return (
		<button
			onClick={onClick}
			className={[
				'inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] rounded-md transition-colors',
				primary
					? 'bg-emerald-500 text-white hover:bg-emerald-600'
					: 'border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50',
			].join(' ')}
		>
			<Icon className="w-3 h-3" />
			{label}
		</button>
	);
}

// ── Empty state ───────────────────────────────────────────────────

function EmptyDashboard({ onCompose }: { onCompose: () => void }) {
	return (
		<div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
			<Sparkles className="w-6 h-6 text-emerald-500 mx-auto mb-3" />
			<div className="text-[15px] font-medium text-slate-900">No intents yet.</div>
			<p className="text-[13px] text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
				An intent is a standing goal you hand to your AI — an inbox to triage, a research thread to track, a metric to chase. Describe one and we&rsquo;ll wire it up.
			</p>
			<button
				onClick={onCompose}
				className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
			>
				<Plus className="w-3.5 h-3.5" />
				Describe your first intent
			</button>
		</div>
	);
}

export default IntentJournal;
