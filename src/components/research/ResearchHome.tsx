// ResearchHome — the top of an app's home:
//
//   [Start] [Designs] [Experiments] [Grade] [Exercises]        ← the app's own pages, once
//   RESEARCH  what this app is exploring, and what to try next
//   ┌──────────── research map (3D) ────────────┐┌── Compute ──┐   ← one row: same top,
//   │ experiments → versions, suggestions        ││ machines …  │     same height
//   └────────────────────────────────────────────┘└─────────────┘
//   For your approval …  /  the selected experiment            ← full width
//
// The app's pages are named FIRST so they are never buried under the map, and
// only here: the surface below hides its own copy of the same tabs. Compute
// sits in the map's row when the column is wide enough (measured, not the
// viewport: the chat rail takes ~430px), else as a one-line strip above it.

import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appPages, pageHref } from "@/lib/app-pages";
import { useRailTopVisible } from "@/lib/rail-top";

const ResearchMap = lazy(() => import("@/components/research/ResearchMap"));
const ComputePanel = lazy(() => import("@/components/compute/ComputePanel"));

const SIDE_BY_SIDE_PX = 980;

export default function ResearchHome({ app, pages }: { app: string; pages?: Array<{ surface: string; label?: string }> }) {
	const ref = useRef<HTMLDivElement>(null);
	const [w, setW] = useState(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	// The chat rail shows the global Running panel beside this page; then the
	// home doesn't repeat it (one running panel, not two) and the map gets the room.
	const railHasIt = useRailTopVisible();
	const side = w >= SIDE_BY_SIDE_PX;
	const tabs = appPages(pages);
	return (
		<div ref={ref} className="space-y-3">
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
			{railHasIt ? (
				<Suspense fallback={null}><ResearchMap app={app} /></Suspense>
			) : side ? (
				<Suspense fallback={null}>
					<ResearchMap app={app} aside={<Suspense fallback={null}><ComputePanel app={app} className="max-h-full overflow-y-auto" /></Suspense>} />
				</Suspense>
			) : (
				<div className="space-y-3">
					<Suspense fallback={null}><ComputePanel app={app} compact /></Suspense>
					<Suspense fallback={null}><ResearchMap app={app} /></Suspense>
				</div>
			)}
		</div>
	);
}
