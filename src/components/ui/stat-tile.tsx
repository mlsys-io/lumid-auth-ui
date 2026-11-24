// StatTile — one headline number (Lumen). The number counts up on mount
// (useCountUp) unless the user prefers reduced motion; label is an eyebrow,
// hint a quiet caption. Use for 1-4 headline figures, not as a chart.

import { useEffect, useState } from "react";
import { useCountUp } from "@/lib/use-count-up";
import { cn } from "@/lib/utils";

function prefersReduced(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function StatTile({
	label, value, format, hint, tone, icon: Icon, className,
}: {
	label: string;
	value: number | null | undefined;
	/** Render the (animated) number; default: locale integer. */
	format?: (n: number) => string;
	hint?: React.ReactNode;
	/** Optional tone for the number: ok/attention/failing/running. */
	tone?: "ok" | "attention" | "failing" | "running";
	icon?: React.ComponentType<{ className?: string }>;
	className?: string;
}) {
	const [still] = useState(prefersReduced);
	const target = value ?? 0;
	const animated = useCountUp(still ? 0 : target);
	const [shown, setShown] = useState(target);
	useEffect(() => setShown(still ? target : animated), [still, target, animated]);
	const fmt = format ?? ((n: number) => Math.round(n).toLocaleString());
	const toneCls = {
		ok: "text-gold-700",
		attention: "text-ember-700",
		failing: "text-brick-700",
		running: "text-lagoon-700",
	} as const;
	return (
		<div className={cn("rounded-xl border border-border bg-card px-4 py-3.5 shadow-e1", className)}>
			<div className="flex items-center gap-1.5">
				{Icon && <Icon className="w-3.5 h-3.5 text-ink-500" />}
				<span className="eyebrow">{label}</span>
			</div>
			<div className={cn("mt-1.5 font-display text-h2 font-medium tabular-nums", tone ? toneCls[tone] : "text-ink-900")}>
				{value == null ? <span className="text-ink-400">—</span> : fmt(shown)}
			</div>
			{hint && <div className="mt-0.5 text-caption text-ink-600 truncate">{hint}</div>}
		</div>
	);
}
