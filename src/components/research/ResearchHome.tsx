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
	const side = w >= SIDE_BY_SIDE_PX;
	const named = (pages || []).filter((p) => p.surface);
	return (
		<div ref={ref} className="space-y-3">
			{named.length > 1 && (
				// Same pills as the app's own tab bar (AppSurface), which the home hides.
				<nav aria-label="This app's pages" className="flex flex-wrap gap-1 -ml-2.5">
					{named.map((p) => (
						<Link key={p.surface} to={`/studio/apps/${encodeURIComponent(app)}?surface=${encodeURIComponent(p.surface)}`}
							className="px-2.5 py-1 rounded-lg text-caption text-ink-700 hover:text-ink-900 hover:bg-ink-100 transition-colors">
							{p.label || p.surface}
						</Link>
					))}
				</nav>
			)}
			{side ? (
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
