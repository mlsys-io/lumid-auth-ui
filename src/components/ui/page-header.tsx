// PageHeader — the page's own title block (Lumen).
//
// The top strip shows WHERE you are (breadcrumb + live status); this shows
// WHAT the page is: a serif title, one line of subtitle, actions on the right,
// and optionally underline tabs for sibling views. Rendering the title in
// both places is what made Runs / Inbox / the app workspace say their name
// twice.

import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

export interface PageTab {
	to: string;
	label: React.ReactNode;
	/** Match the route exactly (NavLink `end`). */
	end?: boolean;
	count?: number;
}

export function PageHeader({
	title, subtitle, eyebrow, actions, tabs, className,
}: {
	title: React.ReactNode;
	subtitle?: React.ReactNode;
	/** Tiny uppercase kicker above the title (e.g. the app or section). */
	eyebrow?: React.ReactNode;
	actions?: React.ReactNode;
	tabs?: PageTab[];
	className?: string;
}) {
	return (
		<header className={cn("pt-8 pb-5", tabs && "pb-0", className)}>
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="min-w-0">
					{eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
					<h1 className="font-display text-h2 font-medium text-ink-900 text-balance">{title}</h1>
					{subtitle && <p className="mt-1 max-w-[68ch] text-body text-ink-600 text-pretty">{subtitle}</p>}
				</div>
				{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
			</div>
			{tabs && (
				<nav className="mt-5 -mb-px flex gap-6 border-b border-border" aria-label="Sections">
					{tabs.map((t) => (
						<NavLink
							key={t.to}
							to={t.to}
							end={t.end}
							className={({ isActive }) =>
								cn(
									"relative -mb-px inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-body font-medium transition-colors duration-180",
									isActive
										? "border-gold-500 text-ink-900"
										: "border-transparent text-ink-600 hover:text-ink-900 hover:border-ink-300",
								)
							}
						>
							{t.label}
							{t.count != null && <span className="tabular-nums text-caption text-ink-500">{t.count}</span>}
						</NavLink>
					))}
				</nav>
			)}
		</header>
	);
}
