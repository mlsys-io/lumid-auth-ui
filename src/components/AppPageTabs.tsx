// AppPageTabs — the app's ONE tab row: Graph (the research graph, the app's
// home) + the app's own pages (`pages` / `ui.nav`). The same row, the same
// style and the same source (the installed app's nav) on the home, on every
// page (?surface=) and above every workflow — so the tabs never change shape
// while you click around (user, 2026-11-26: "some tabs are inconsistent").
// `current`: "home", a surface id, or null (a workflow — nothing lit, Graph
// leads back).

import { Link } from "react-router-dom";
import { appPages, pageHref } from "@/lib/app-pages";
import { cn } from "@/lib/utils";

export default function AppPageTabs({ app, nav, current, embedded = true, className }: {
	app: string;
	nav?: Array<{ surface: string; label?: string }>;
	current: string | null;
	embedded?: boolean;
	className?: string;
}) {
	const tabs = appPages(nav);
	return (
		<nav aria-label="This app's pages" className={cn("flex flex-wrap gap-1", className)}>
			{tabs.map((t) => {
				const active = current != null && (t.home ? current === "home" : t.surface === current);
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
