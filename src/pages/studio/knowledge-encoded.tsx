// /studio/knowledge — "you, encoded": the ledger of what the system has
// learned about you (voice principles, optimization preferences, decision
// heuristics), audited and portable. Distinct from the per-agent bank
// browser at /studio/knowledge/:agent (StudioKnowledge).
//
// Title + subtitle come from TopStatusStrip (studio convention). This
// view adds the sharing tag, metric tiles, the recently-encoded ledger
// with "applied N times since" counters, and the publish callout.
// Matches the LumidOS design spec. Read-only this week.

import { useState } from 'react';
import { MessageCircle, Target, ShieldCheck, type LucideIcon } from 'lucide-react';
import { PublishToLibrary } from '@/components/PublishToLibrary';

interface Metric {
	label: string;
	value: string;
	context: string;
	neutral?: boolean;
}

const METRICS: Metric[] = [
	{ label: 'Ledger entries', value: '47', context: '+6 this week' },
	{ label: 'Voice principles', value: '8', context: '+2 this week' },
	{ label: 'Learned domains', value: '3', context: 'family · work · research', neutral: true },
];

interface Encoded {
	icon: LucideIcon;
	type: string;
	time: string;
	fresh?: boolean;
	principle: string;
	source: string;
	applied: string;
}

const RECENT: Encoded[] = [
	{
		icon: MessageCircle,
		type: 'voice principle',
		time: 'just now',
		fresh: true,
		principle: "Write to family in a warm, casual register — never start with 'Dear'.",
		source: 'from Aunt Mei reply rejection',
		applied: 'applied 4 times since',
	},
	{
		icon: Target,
		type: 'optimization preference',
		time: '5h ago',
		principle: 'Favor latency under 200ms even at 2% accuracy cost.',
		source: 'from NL-to-SQL batch rejection',
		applied: 'applied 2 times since',
	},
	{
		icon: ShieldCheck,
		type: 'decision heuristic',
		time: '1d ago',
		principle: 'Exclude vendor quotes above $2000/mo unless explicitly approved.',
		source: 'from care-coordination rejection',
		applied: 'applied 1 time since',
	},
];

export default function StudioKnowledgeEncoded() {
	const [publishOpen, setPublishOpen] = useState(false);
	const [published, setPublished] = useState(false);

	return (
		<div className="max-w-4xl mx-auto px-1 py-2 space-y-6">
			{/* Sharing posture — title/subtitle come from the top strip. */}
			<div className="flex justify-end">
				<span className="text-[11px] text-slate-500">local · 3 in allowlist</span>
			</div>

			{/* Metric tiles (secondary surface) */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
				{METRICS.map((m) => (
					<div key={m.label} className="rounded-lg border border-slate-200/70 bg-[#f7f7f5] px-4 py-3">
						<div className="text-[12px] text-slate-500">{m.label}</div>
						<div className="mt-1 text-[22px] font-medium text-slate-900 leading-none tracking-tight">{m.value}</div>
						<div className={`mt-1.5 text-[11px] ${m.neutral ? 'text-slate-500' : 'text-emerald-700'}`}>{m.context}</div>
					</div>
				))}
			</div>

			{/* Recently encoded */}
			<section>
				<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">Recently encoded — your judgment, captured</div>
				<ul className="space-y-2">
					{RECENT.map((e) => {
						const Icon = e.icon;
						return (
							<li key={e.principle} className="rounded-lg border border-slate-200/70 bg-white px-4 py-3 flex items-start gap-3">
								<div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
									<Icon className="w-3.5 h-3.5" />
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="text-[11px] text-slate-400">{e.type}</span>
										<span className={`text-[10px] ${e.fresh ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
											{e.fresh ? '● ' : ''}{e.time}
										</span>
									</div>
									<div className="text-sm text-slate-800 mt-0.5 leading-snug">{e.principle}</div>
									<div className="flex items-center justify-between gap-3 mt-1">
										<span className="text-[11px] text-slate-400">{e.source}</span>
										<span className="text-[11px] text-slate-500 flex-shrink-0">{e.applied}</span>
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			</section>

			{/* Publish callout */}
			<div className="rounded-xl border border-blue-100 bg-[#eff6ff] px-4 py-3.5 flex items-center justify-between gap-3">
				<div className="min-w-0">
					{published ? (
						<div className="text-sm text-blue-700">All caught up — no pending refinements to publish.</div>
					) : (
						<>
							<div className="text-sm font-medium text-blue-700">3 refined skills ready to publish</div>
							<div className="text-[11px] text-blue-700/80 mt-0.5">
								Share with your allowlist (3 contacts) · revoke anytime · stays local for everyone else.
							</div>
						</>
					)}
				</div>
				{!published && (
					<button
						onClick={() => setPublishOpen(true)}
						className="inline-flex items-center px-3.5 py-1.5 text-sm rounded-lg border border-blue-200 bg-white text-blue-700 hover:bg-[#f0f7ff] transition-colors flex-shrink-0"
					>
						Review
					</button>
				)}
			</div>

			<PublishToLibrary
				open={publishOpen}
				onClose={() => setPublishOpen(false)}
				onPublished={() => { setPublished(true); setPublishOpen(false); }}
			/>
		</div>
	);
}
