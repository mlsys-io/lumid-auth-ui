// OutcomeTile — a single metric the AI tracks about its own work.
// In the six-axis design, every metric is part of the Standard axis
// ("how it judges itself"). The eyebrow label + the tile's left-edge
// accent are tinted using AXIS_META.standard so the user reads these
// numbers as "this is what my AI is optimizing for," not just stats.
//
// OutcomeRow renders the 3-tile strip in the Intents view, between
// the IntentRail and DecisionsPending. Tiles are pickable
// (data-pick-kind=metric) so the chat picker can pin one and ask
// "why did this go up?" / "raise the floor on this".

import { AXIS_META } from '@/lib/demo-intents';

export interface Outcome {
	label: string;
	value: string; // pre-formatted (e.g. "4h 12m", "84%", "14")
	delta?: string; // chip after the number (e.g. "+48m vs last week")
	deltaTone?: 'up' | 'neutral';
}

export function OutcomeTile({ outcome }: { outcome: Outcome }) {
	const tone = outcome.deltaTone ?? 'up';
	const deltaClass = tone === 'up' ? 'text-emerald-700' : 'text-slate-500';
	return (
		<div
			className="relative rounded-lg border border-slate-200/70 bg-white px-4 py-3 hover:border-slate-300 transition-colors overflow-hidden"
			data-pick-kind="metric"
			data-pick-id={`outcome:${outcome.label}`}
			data-pick-label={`${outcome.label}: ${outcome.value}${outcome.delta ? ' (' + outcome.delta + ')' : ''}`}
			data-pick-affordances="explain,intent_audit,give_feedback"
		>
			{/* Standard-axis accent stripe — same violet as AXIS_META.standard. */}
			<span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-violet-300/70" />
			<div className="pl-1.5">
				<div className="text-[12px] text-slate-500">{outcome.label}</div>
				<div className="mt-1 text-[22px] font-medium text-slate-900 leading-none tracking-tight">
					{outcome.value}
				</div>
				{outcome.delta && (
					<div className={`mt-1.5 text-[11px] ${deltaClass}`}>{outcome.delta}</div>
				)}
			</div>
		</div>
	);
}

export function OutcomeRow({ outcomes }: { outcomes: Outcome[] }) {
	if (!outcomes.length) return null;
	const std = AXIS_META.standard;
	return (
		<section>
			<div className="flex items-baseline gap-2 mb-2">
				<span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium ${std.tone}`}>
					{std.label}
				</span>
				<span className="text-[11px] tracking-[0.06em] text-slate-400">
					how your AI judges itself
				</span>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
				{outcomes.map((o) => (
					<OutcomeTile key={o.label} outcome={o} />
				))}
			</div>
		</section>
	);
}
