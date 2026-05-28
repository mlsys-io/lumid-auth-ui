// DecisionsPending — the "Pending your call" section in the Intents view.
// Each item offers Approve / Edit / Reject-with-reason. Reject is the
// demo's hero interaction: the reason is captured, POSTed (mock), and
// surfaced back as "encoded as a voice principle" — the visible
// cause→effect the next cycle reflects, and which shows up at the top of
// the Knowledge view. Matches the LumidOS design spec.

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Pencil, X, Mail, FlaskConical, MessageSquareOff, Upload, type LucideIcon } from 'lucide-react';
import { rejectWithReason } from '@/lib/demo-actions';
import { PublishToLibrary } from '@/components/PublishToLibrary';

type Status = 'pending' | 'approved' | 'rejected';

interface DecisionItem {
	id: string;
	icon: LucideIcon;
	tag: string; // full meta line, e.g. "reply draft · to Aunt Mei · family"
	preview: string;
	principleLabel: string; // label used when publishing the encoded principle
}

const SEED: DecisionItem[] = [
	{
		id: 'aunt-mei-reply',
		icon: Mail,
		tag: 'reply draft · to Aunt Mei · family',
		preview:
			'Dear Aunt Mei, I am writing in response to your kind message regarding the upcoming family gathering. I would be honored to attend and look forward to seeing everyone…',
		principleLabel: 'Family voice — casual register',
	},
	{
		id: 'nl2sql-next-batch',
		icon: FlaskConical,
		tag: 'next-batch proposal · 4 variants · auto-sysresearch',
		preview:
			'Higher temperature + larger context window + retrieval re-rank — optimizer expects +1.8 pts accuracy, projected latency 240–280ms.',
		principleLabel: 'NL-to-SQL optimization preference',
	},
];

export function DecisionsPending() {
	const [items, setItems] = useState<Record<string, Status>>(
		Object.fromEntries(SEED.map((i) => [i.id, 'pending'])),
	);
	const setStatus = (id: string, s: Status) => setItems((m) => ({ ...m, [id]: s }));

	return (
		<section>
			<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">Pending your call</div>
			<ul className="space-y-2">
				{SEED.map((item) => (
					<DecisionRow
						key={item.id}
						item={item}
						status={items[item.id]}
						onStatus={(s) => setStatus(item.id, s)}
					/>
				))}
			</ul>
		</section>
	);
}

function DecisionRow({
	item,
	status,
	onStatus,
}: {
	item: DecisionItem;
	status: Status;
	onStatus: (s: Status) => void;
}) {
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState('');
	const [editing, setEditing] = useState(false);
	const [preview, setPreview] = useState(item.preview);
	const [busy, setBusy] = useState(false);
	const [publishOpen, setPublishOpen] = useState(false);
	const [published, setPublished] = useState(false);
	const Icon = item.icon;

	const submitReject = async () => {
		const trimmed = reason.trim();
		if (!trimmed) {
			toast.error('Add a one-line reason so the AI can learn from it.');
			return;
		}
		setBusy(true);
		try {
			await rejectWithReason(item.id, trimmed);
			onStatus('rejected');
			setRejecting(false);
			toast.success('Got it. Encoded as a voice principle. Next cycle will reflect this.');
		} catch {
			toast.error('Could not record the rejection — try again.');
		} finally {
			setBusy(false);
		}
	};

	const rejected = status === 'rejected';
	const approved = status === 'approved';

	return (
		<li
			className={[
				'rounded-lg border bg-white px-4 py-3 transition-colors',
				rejected ? 'border-slate-200 opacity-60' : 'border-slate-200',
			].join(' ')}
		>
			<div className="flex items-center gap-2">
				<Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
				<span className="text-[11px] text-slate-400">{item.tag}</span>
				{rejected && (
					<span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
						<MessageSquareOff className="w-3 h-3" /> rejected with reason
					</span>
				)}
				{approved && (
					<span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">approved</span>
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
						onClick={() => { onStatus('approved'); toast.success('Approved — sending now.'); }}
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
						title="Publish this voice principle"
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
