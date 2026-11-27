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
import AppPageTabs from "@/components/AppPageTabs";

const ResearchMap = lazy(() => import("@/components/research/ResearchMap"));

export default function ResearchHome({ app, pages, hasSurface }: { app: string; pages?: Array<{ surface: string; label?: string }>; hasSurface?: boolean }) {
	return (
		<div className="space-y-3">
			{/* The app's one tab row (AppPageTabs), the same on every page of the app. */}
			<AppPageTabs app={app} nav={pages} hasSurface={hasSurface} current="research" className="-ml-2.5" />
			<Suspense fallback={null}><ResearchMap app={app} /></Suspense>
		</div>
	);
}
