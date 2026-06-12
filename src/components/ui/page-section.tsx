// PageSection — the uppercase 11px section label + optional aside,
// previously copy-pasted across apps.tsx, intents, knowledge, and the
// observability panel with drifting tracking/size values.

import { cn } from "@/lib/utils";

export function PageSection({
	title, aside, children, className,
}: {
	title: string;
	/** Right-aligned slot (count, "view all" link, filter). */
	aside?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section className={className}>
			<div className="flex items-center justify-between mb-2.5">
				<h2 className="text-[11px] tracking-[0.08em] font-medium text-slate-400 uppercase">
					{title}
				</h2>
				{aside}
			</div>
			{children}
		</section>
	);
}

/** Metric chips row (ports apps.tsx's HeroBar/StatChip pattern). */
export function MetricStrip({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("flex flex-wrap items-center gap-2", className)}>
			{children}
		</div>
	);
}
