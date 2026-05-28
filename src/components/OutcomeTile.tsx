// OutcomeTile — a single "what you reclaimed" metric (label · big number
// · delta). OutcomeRow renders the 3-tile strip in the Intents view,
// between the IntentRail and the decisions list. Tiles sit on the
// secondary surface (#f7f7f5); positive deltas use success green,
// neutral deltas use secondary text. Matches the LumidOS design spec.

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
		<div className="rounded-lg border border-slate-200/70 bg-[#f7f7f5] px-4 py-3">
			<div className="text-[12px] text-slate-500">{outcome.label}</div>
			<div className="mt-1 text-[22px] font-medium text-slate-900 leading-none tracking-tight">
				{outcome.value}
			</div>
			{outcome.delta && (
				<div className={`mt-1.5 text-[11px] ${deltaClass}`}>{outcome.delta}</div>
			)}
		</div>
	);
}

export function OutcomeRow({ outcomes }: { outcomes: Outcome[] }) {
	if (!outcomes.length) return null;
	return (
		<section>
			<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-2">Today — what you reclaimed</div>
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
				{outcomes.map((o) => (
					<OutcomeTile key={o.label} outcome={o} />
				))}
			</div>
		</section>
	);
}
