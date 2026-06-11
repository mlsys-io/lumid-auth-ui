// SummaryCard — toned metric tile (uppercase label, large value, hint).
// Lifted from the pre-migration dashboard/loops.tsx for the hero/metric feel.

import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
	emerald: "text-emerald-700",
	slate: "text-slate-700",
	indigo: "text-indigo-700",
	rose: "text-rose-700",
	amber: "text-amber-700",
	sky: "text-sky-700",
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
		<div className={cn("rounded-lg border border-slate-200 bg-white px-4 py-3", className)}>
			<div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
			<div className={cn("mt-1 text-2xl font-semibold tabular-nums truncate", TONE[tone])} title={value}>
				{value}
			</div>
			{hint && <div className="mt-0.5 text-xs text-slate-400 truncate">{hint}</div>}
		</div>
	);
}
