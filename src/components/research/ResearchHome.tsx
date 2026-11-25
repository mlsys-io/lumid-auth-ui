// ResearchHome — the top of an app's home:
//
//   This app's pages: Start · Designs · Experiments · Grade · Exercises
//   ┌──────────── research map (3D) ────────────┐ ┌── Compute ──┐
//   │ experiments → versions, suggestions        │ │ machines    │
//   └────────────────────────────────────────────┘ │ running     │
//   For your approval …                            │ waiting     │
//                                                  └─────────────┘
//
// The app's own pages are named FIRST so they are never buried under the map
// (MLSys Research's Start page used to sit a screen below 20 "not run yet"
// cards). Compute sits beside the map when the column is wide enough (it is
// measured, not the viewport: the chat rail takes ~430px), else above it.

import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

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
				<nav aria-label="This app's pages" className="flex items-center gap-x-1 gap-y-1 flex-wrap text-meta">
					<span className="text-ink-600 mr-1">This app's pages:</span>
					{named.map((p, i) => (
						<span key={p.surface} className="inline-flex items-center gap-1">
							{i > 0 && <span className="text-ink-300" aria-hidden>·</span>}
							<Link to={`/studio/apps/${encodeURIComponent(app)}?surface=${encodeURIComponent(p.surface)}`} className="text-gold-700 hover:underline font-medium">
								{p.label || p.surface}
							</Link>
						</span>
					))}
				</nav>
			)}
			<div className={cn("grid gap-4 items-start", side ? "grid-cols-[minmax(0,1fr)_19rem]" : "grid-cols-1")}>
				{side ? (
					<>
						<Suspense fallback={null}><ResearchMap app={app} /></Suspense>
						<Suspense fallback={null}><ComputePanel app={app} className="sticky top-2" /></Suspense>
					</>
				) : (
					<>
						<Suspense fallback={null}><ComputePanel app={app} compact /></Suspense>
						<Suspense fallback={null}><ResearchMap app={app} /></Suspense>
					</>
				)}
			</div>
		</div>
	);
}
