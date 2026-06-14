// IntentNarrativeHero — "This week your AI…" card.
//
// Renders one line per six-axis narrative bullet + the AxisChips row
// at the bottom. The bullets are intent-specific text; the structure
// (one per axis, colored dot, axis label) is universal. This is the
// generic spine that lets every intent kind ship the same hero shape.
//
// Layout A from the chosen UX:
//   ┌─ This week your AI ─────────────────────────┐
//   │ ● Standard  Voice match raised 78% → 84%   │
//   │ ● Examples  4 of your edits became examples │
//   │ …                                           │
//   │                                             │
//   │ [Standard·2] [Examples·4] [Memory·3] …     │
//   └─────────────────────────────────────────────┘

import { AxisChips } from './AxisChips';
import { AXIS_META, type AxisMovement, type NarrativeBullet } from '@/lib/demo-intents';

export function IntentNarrativeHero({
	narrative,
	movements,
}: {
	narrative?: NarrativeBullet[];
	movements?: AxisMovement[];
}) {
	const hasNarr = !!(narrative && narrative.length > 0);
	const hasMov  = !!(movements && movements.length > 0);
	if (!hasNarr && !hasMov) return null;

	return (
		<section className="rounded-xl border border-slate-200/70 bg-gradient-to-br from-amber-50/30 via-white to-white px-5 py-4">
			<div className="text-[11px] tracking-[0.06em] text-slate-400 mb-3">This week your AI</div>

			{hasNarr && (
				<ul className="space-y-1.5 mb-3">
					{narrative!.map((b, i) => {
						const meta = AXIS_META[b.axis];
						// Pull the dot color out of the tone string ("text-violet-700 bg-violet-50 …")
						// — first className token controls the dot.
						const dotColor = meta?.tone.split(' ').find((c) => c.startsWith('text-')) || 'text-slate-500';
						return (
							<li key={i} className="flex items-start gap-2.5 text-[13px] leading-snug text-slate-800">
								<span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor.replace('text-', 'bg-')}`} />
								<span className="flex-1 min-w-0">
									{meta && (
										<span className={`inline-block w-[68px] text-[11px] uppercase tracking-wide ${dotColor} font-medium`}>
											{meta.label}
										</span>
									)}
									<span>{b.text}</span>
								</span>
							</li>
						);
					})}
				</ul>
			)}

			{hasMov && <AxisChips movements={movements!} variant="detail" />}
		</section>
	);
}
