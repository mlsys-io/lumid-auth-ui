// ResearchHome — the top of an app's home:
//
//   [Start] [Designs] [Experiments] [Grade] [Exercises]        ← the app's own pages, once
//   RESEARCH  what this app is exploring, and what to try next
//   ┌──────────── research map (3D), full width ────────────┐
//   │ experiments → versions, suggestions                    │
//   └────────────────────────────────────────────────────────┘
//   For your approval …  /  the selected experiment
//
// The app's pages are named FIRST so they are never buried under the map, and
// only here: the surface below hides its own copy of the same tabs. Running
// work lives in the chat rail's Running panel only — the home doesn't repeat
// it beside the map when the rail is hidden ("not wanted", user 2026-11-25).

import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { appPages, pageHref } from "@/lib/app-pages";

const ResearchMap = lazy(() => import("@/components/research/ResearchMap"));

export default function ResearchHome({ app, pages }: { app: string; pages?: Array<{ surface: string; label?: string }> }) {
	const tabs = appPages(pages);
	return (
		<div className="space-y-3">
			{tabs.length > 1 && (
				// Same pills as the app's own tab bar (AppSurface), which the home hides.
				// The first is this page, lit, so every other page can lead back here.
				<nav aria-label="This app's pages" className="flex flex-wrap gap-1 -ml-2.5">
					{tabs.map((t) => (
						<Link key={t.surface} to={pageHref(app, t, true)} aria-current={t.home ? "page" : undefined}
							className={t.home
								? "px-2.5 py-1 rounded-lg text-caption bg-ink-800 text-white"
								: "px-2.5 py-1 rounded-lg text-caption text-ink-700 hover:text-ink-900 hover:bg-ink-100 transition-colors"}>
							{t.label}
						</Link>
					))}
				</nav>
			)}
			<Suspense fallback={null}><ResearchMap app={app} /></Suspense>
		</div>
	);
}
