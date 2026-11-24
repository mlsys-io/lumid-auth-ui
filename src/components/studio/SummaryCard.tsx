// SummaryCard — toned metric tile (uppercase label, large value, hint).
// Lifted from the pre-migration dashboard/loops.tsx for the hero/metric feel.

import { cn } from "@/lib/utils";

// Legacy colour keys -> Lumen tones (see src/lib/tones.ts). amber used to
// render the same gold as emerald, so "needs attention" read as "healthy".
const TONE: Record<string, string> = {
	emerald: "text-gold-700",
	slate: "text-ink-800",
	indigo: "text-plum-700",
	rose: "text-brick-700",
	amber: "text-ember-700",
	sky: "text-lagoon-700",
};

export function SummaryCard({
	label, value, hint, tone = "slate", className,
}: {
	label: string;
	value: string;
	hint?: string;
	tone?: keyof typeof TONE;
	className?: string;
}) {
	return (
		<div className={cn("rounded-xl border border-border bg-card px-4 py-3 shadow-e1", className)}>
			<div className="eyebrow">{label}</div>
			<div className={cn("mt-1 text-h2 font-semibold tabular-nums truncate", TONE[tone])} title={value}>
				{value}
			</div>
			{hint && <div className="mt-0.5 text-caption text-ink-600 truncate">{hint}</div>}
		</div>
	);
}
