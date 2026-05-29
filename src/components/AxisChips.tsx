// AxisChips — the six-axis improvement row. Rendered identically by
// the IntentRail card (compact, just label + dot-count) and by the
// intent-detail hero (with the most-recent label on hover).
//
// Six axes — the user-facing vocabulary for "what improved":
//   standard  · how it judges itself        (metrics / rubric)
//   examples  · what it learns from         (dataset / casebook)
//   memory    · what it remembers about you (banks)
//   rules     · patterns it figured out     (knowledge)
//   recipe    · the steps it takes          (workflow)
//   pieces    · how it does each step       (skills)
//
// Shape mirrors the production /me/intents/:id/audit response so the
// demo and live data render through the same component.

import { AXIS_META, type AxisMovement } from '@/lib/demo-intents';

export function AxisChips({
	movements,
	variant = 'compact',
}: {
	movements: AxisMovement[];
	variant?: 'compact' | 'detail';
}) {
	if (!movements || movements.length === 0) return null;
	// Compact = card row (tiny, one-line). Detail = hero (slightly
	// roomier with hover-revealed latest label).
	const pillBase =
		variant === 'compact'
			? 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium'
			: 'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium';
	return (
		<div className={variant === 'compact' ? 'flex items-center gap-1 flex-wrap' : 'flex items-center gap-1.5 flex-wrap'}>
			{movements.map((m) => {
				const meta = AXIS_META[m.axis];
				if (!meta) return null;
				const title = m.latest ? `${meta.label} · ${meta.phrase} — ${m.latest}` : `${meta.label} · ${meta.phrase}`;
				return (
					<span
						key={m.axis}
						className={`${pillBase} ${meta.tone}`}
						title={title}
						data-pick-kind="axis"
						data-pick-id={`axis:${m.axis}`}
						data-pick-label={`${meta.label} — ${meta.phrase}${m.latest ? ` (${m.latest})` : ''}`}
						data-pick-affordances="explain,intent_audit,give_feedback"
					>
						<span>{meta.label}</span>
						<span className="opacity-60">·</span>
						<span className="tabular-nums">{m.count}</span>
					</span>
				);
			})}
		</div>
	);
}
