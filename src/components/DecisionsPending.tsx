// DecisionsPending — the "Pending your call" section in the Intents view.
// Each item offers Approve / Edit / Reject-with-reason. Reject is the
// demo's hero interaction: the reason is captured, POSTed (mock), and
// surfaced back as "encoded as a voice principle" — the visible
// cause→effect the next cycle reflects, and which shows up at the top of
// the Knowledge view. Matches the LumidOS design spec.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Pencil, X, Mail, FlaskConical, Upload, ArrowRight, type LucideIcon } from 'lucide-react';
import { rejectWithReason } from '@/lib/demo-actions';
import { PublishToLibrary } from '@/components/PublishToLibrary';
import { AXIS_META } from '@/lib/demo-intents';
import {
	loadDecisions, setDecisionStatus, DECISIONS_EVENT,
	type DemoDecision, type DecisionStatus, type DecisionIconKind,
} from '@/lib/demo-decisions';

type Status = DecisionStatus;

// The decision icon is rendered locally from a string kind (the shared
// store can't ship a React component reference through localStorage).
const ICON_BY_KIND: Record<DecisionIconKind, LucideIcon> = {
	mail: Mail,
	flask: FlaskConical,
};

export function DecisionsPending() {
	const [rows, setRows] = useState<Array<DemoDecision & { status: Status }>>(() => loadDecisions());
	useEffect(() => {
		const refresh = () => setRows(loadDecisions());
		window.addEventListener(DECISIONS_EVENT, refresh);
		return () => window.removeEventListener(DECISIONS_EVENT, refresh);
	}, []);

	return (
		<section>
			<div className="flex items-center justify-between gap-3 mb-2">
				<div className="text-[11px] tracking-[0.06em] text-slate-400">Pending your call</div>
				<Link
					to="/studio/inbox?filter=drafts"
					className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-800 hover:underline transition-colors"
				>
					See all in Inbox <ArrowRight className="w-3 h-3" />
				</Link>
			</div>
			<ul className="space-y-2">
				{rows.map((row) => (
					<DecisionRow key={row.id} item={row} status={row.status} />
				))}
			</ul>
		</section>
	);
}

function DecisionRow({
	item,
	status,
}: {
	item: DemoDecision;
	status: Status;
}) {
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState('');
	const [editing, setEditing] = useState(false);
	const [preview, setPreview] = useState(item.preview);
	const [busy, setBusy] = useState(false);
	const [publishOpen, setPublishOpen] = useState(false);
	const [published, setPublished] = useState(false);
	const Icon = ICON_BY_KIND[item.iconKind];
	// Status changes go through the shared store so the Inbox view + any
	// other listener (PublishToLibrary callout) stay in sync.
	const setStatus = (s: Status) => setDecisionStatus(item.id, s);

	const submitReject = async () => {
		const trimmed = reason.trim();
		if (!trimmed) {
			toast.error('Add a one-line reason so the AI can learn from it.');
			return;
		}
		setBusy(true);
		try {
			await rejectWithReason(item.id, trimmed);
			setStatus('rejected');
			setRejecting(false);
			toast.success('Got it. Added to your Rules — the next run will reflect this.');
		} catch {
			toast.error('Could not record the rejection — try again.');
		} finally {
			setBusy(false);
		}
	};

	const rejected = status === 'rejected';
	const approved = status === 'approved';

	const rulesTone    = AXIS_META.rules.tone;
	const examplesTone = AXIS_META.examples.tone;
	return (
		<li
			className={[
				'rounded-lg border bg-white px-4 py-3 transition-colors hover:border-slate-300',
				rejected ? 'border-slate-200 opacity-70' : 'border-slate-200',
			].join(' ')}
			data-pick-kind="decision"
			data-pick-id={`decision:${item.id}`}
			data-pick-label={`Pending: ${item.principleLabel}`}
			data-pick-affordances="approve,edit,reject,explain,give_feedback"
		>
			<div className="flex items-center gap-2 flex-wrap">
				<Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
				<span className="text-[11px] text-slate-400">{item.tag}</span>
				{rejected && (
					// Reject = a Rules-axis improvement ("patterns it figured out").
					// The chip carries the same vocabulary as everywhere else
					// the AXIS_META renders.
					<span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${rulesTone}`}>
						{AXIS_META.rules.label} · learned
					</span>
				)}
				{approved && (
					// Approve = an Examples-axis improvement ("what it learns from").
					<span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${examplesTone}`}>
						{AXIS_META.examples.label} · accepted
					</span>
				)}
			</div>

			{editing ? (
				<div className="mt-2">
					<textarea
						value={preview}
						onChange={(e) => setPreview(e.target.value)}
						rows={3}
						className="w-full text-[13px] rounded-md border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-300"
					/>
					<div className="mt-1.5 flex gap-2">
						<button
							onClick={() => { setEditing(false); toast.success('Draft updated.'); }}
							className="px-2.5 py-1 text-xs rounded-md bg-emerald-500 text-white hover:bg-emerald-600"
						>
							Save
						</button>
						<button
							onClick={() => { setPreview(item.preview); setEditing(false); }}
							className="px-2.5 py-1 text-xs rounded-md border border-slate-200 hover:bg-slate-50"
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<p className="text-sm text-slate-800 mt-1.5 leading-relaxed">{preview}</p>
			)}

			{!rejected && !approved && !editing && (
				<div className="mt-2.5 flex items-center gap-2">
					<button
						onClick={() => { setStatus('approved'); toast.success('Approved — sending now.'); }}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
					>
						<Check className="w-3.5 h-3.5" /> Approve
					</button>
					<button
						onClick={() => setEditing(true)}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
					>
						<Pencil className="w-3.5 h-3.5" /> Edit
					</button>
					<div className="relative">
						<button
							onClick={() => setRejecting((v) => !v)}
							className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
						>
							<X className="w-3.5 h-3.5" /> Reject with reason
						</button>
						{rejecting && (
							<RejectPopover
								reason={reason}
								setReason={setReason}
								busy={busy}
								onSubmit={submitReject}
								onCancel={() => { setRejecting(false); setReason(''); }}
							/>
						)}
					</div>
				</div>
			)}

			{rejected && (
				<div className="mt-2 flex items-center gap-2">
					{published ? (
						<span className="text-[11px] text-emerald-700">Published to your allowlist.</span>
					) : (
						<button
							onClick={() => setPublishOpen(true)}
							className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-sky-200 bg-sky-50/70 text-sky-700 hover:bg-sky-100"
						>
							<Upload className="w-3 h-3" /> Publish to Library
						</button>
					)}
					<PublishToLibrary
						open={publishOpen}
						onClose={() => setPublishOpen(false)}
						onPublished={() => { setPublished(true); setPublishOpen(false); }}
						title="Publish this rule"
						skills={[{ id: item.id, label: `${item.principleLabel} — encoded principle` }]}
					/>
				</div>
			)}
		</li>
	);
}

function RejectPopover({
	reason,
	setReason,
	busy,
	onSubmit,
	onCancel,
}: {
	reason: string;
	setReason: (v: string) => void;
	busy: boolean;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	const MAX = 200;
	return (
		<div className="absolute z-20 mt-1.5 left-0 w-80 rounded-lg border border-slate-200 bg-white shadow-lg p-3">
			<div className="text-xs font-medium text-slate-700 mb-1.5">Why are you rejecting this?</div>
			<textarea
				autoFocus
				value={reason}
				maxLength={MAX}
				onChange={(e) => setReason(e.target.value.slice(0, MAX))}
				rows={3}
				placeholder="e.g. too formal — write to family casually, never start with 'Dear'."
				className="w-full text-[13px] rounded-md border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-300 resize-none"
			/>
			<div className="flex items-center justify-between mt-1.5">
				<span className="text-[10px] text-slate-400">{reason.length}/{MAX}</span>
				<div className="flex gap-2">
					<button onClick={onCancel} className="px-2.5 py-1 text-xs rounded-md border border-slate-200 hover:bg-slate-50">
						Cancel
					</button>
					<button
						onClick={onSubmit}
						disabled={busy}
						className="px-2.5 py-1 text-xs rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
					>
						{busy ? 'Encoding…' : 'Submit'}
					</button>
				</div>
			</div>
		</div>
	);
}
