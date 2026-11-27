// AppPageTabs — the app's ONE tab row: Research (the research space, every
// app's first tab) + the app's own pages (`pages` / `ui.nav`, and "Overview"
// for an app that declares a page but no nav). The same row, the same
// style and the same source (the installed app's nav) on the home, on every
// page (?surface=) and above every workflow — so the tabs never change shape
// while you click around (user, 2026-11-26: "some tabs are inconsistent").
// `current`: "research", a surface id ("home" = the app's own home page), or
// null (a workflow — nothing lit, Research leads back).

import { Link } from "react-router-dom";
import { appPages, pageHref, RESEARCH_TAB } from "@/lib/app-pages";
import { cn } from "@/lib/utils";

export default function AppPageTabs({ app, nav, hasSurface = false, current, embedded = true, className }: {
	app: string;
	nav?: Array<{ surface: string; label?: string }>;
	/** The app declares a page of its own (its "Overview" tab even without a nav). */
	hasSurface?: boolean;
	current: string | null;
	embedded?: boolean;
	className?: string;
}) {
	const tabs = appPages(nav, hasSurface);
	return (
		<nav aria-label="This app's pages" className={cn("flex flex-wrap gap-1", className)}>
			{tabs.map((t) => {
				const active = current != null && (t.home ? current === RESEARCH_TAB : t.surface === current);
				return (
					<Link key={t.surface} to={pageHref(app, t, embedded)} aria-current={active ? "page" : undefined}
						className={active
							? "px-2.5 py-1 rounded-lg text-caption bg-ink-800 text-white"
							: "px-2.5 py-1 rounded-lg text-caption text-ink-700 hover:text-ink-900 hover:bg-ink-100 transition-colors"}>
						{t.label}
					</Link>
				);
			})}
		</nav>
	);
}
