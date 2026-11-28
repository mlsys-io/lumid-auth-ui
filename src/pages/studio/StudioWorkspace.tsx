// StudioWorkspace — the app page (/studio/apps[/:app]). The MAIN page
// (/studio) is untouched (the chat home); this layout is for an app only:
//
//   [ workflow list (left) ] [ details (middle) ] [ grounded chat (right) ]
//
// Structured content lives in the left/middle panels (never dumped into chat);
// the right chat is the agent-led, progressive conversation grounded on the app.
//
// There is no per-column sub-header bar: the panel toggles (hide workflow list /
// hide chat) are merged into the top strip (TopStatusStrip), portaled in from
// here, from AppOverview and from ChatRail, so the app shows a single header row.
//
// The chat rail itself (width, drag-to-resize, narrow-viewport takeover, the
// portaled toggle) lives in @/components/ChatRail — /studio/data docks the same
// rail, and a second copy of that logic would drift.

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import ChatRail from "@/components/ChatRail";
import RunningNow from "@/components/RunningNow";
// The spine (/studio/apps with nothing selected) used to pass enabled={!!app},
// so the ONE place a user lands before choosing an app had no assistance at all.
// It now grounds on the generic Apps scope; a real app still wins.
import { APPS_KEY } from "@/components/StudioChat";
import { APP_NAV_INVALIDATE, useAppNav } from "@/components/useAppNav";
import { pendingInstallNames } from "@/lib/just-installed";
import { appTitle } from "@/components/workflow/AppCard";
import { AppOverview } from "@/pages/studio/apps";

const FEATURED_KEY = "studio_featured_app";

export default function StudioWorkspace() {
	const { app: paramApp } = useParams<{ app?: string }>();
	const navigate = useNavigate();
	const appNav = useAppNav();
	const installed = useMemo(() => appNav.flatMap((s) => s.items.map((i) => i.app)), [appNav]);

	const stored = (() => { try { return localStorage.getItem(FEATURED_KEY) || ""; } catch { return ""; } })();
	const app = paramApp || stored || installed[0] || "";

	// Stash the CURRENT app for the docked chat SYNCHRONOUSLY (during render),
	// before the child StudioChat mounts. React runs child mount effects before
	// the parent's, so a useEffect stash lands too late — the freshly-mounted
	// chat would read a STALE stash (the previous app) and ground on it. Writing
	// it in render (guarded to once-per-app) makes the chat ground on THIS app.
	const stashedAppRef = useRef("");
	if (app && stashedAppRef.current !== app) {
		stashedAppRef.current = app;
		try { sessionStorage.setItem("studio_open_app_v1", JSON.stringify({ app })); } catch { /* ignore */ }
	}

	// Clean URL: /studio/apps with no param but a resolved default → go to it.
	useEffect(() => {
		if (!paramApp && app) navigate(`/studio/apps/${encodeURIComponent(app)}`, { replace: true });
	}, [paramApp, app, navigate]);

	// Persist the pick + open the app in the docked chat (the event drives the
	// LIVE switch when the chat is already mounted; the render-time stash above
	// handles the fresh-mount case). openAppInChat dedupes the two.
	useEffect(() => {
		if (!app) return;
		try { localStorage.setItem(FEATURED_KEY, app); } catch { /* ignore */ }
		window.dispatchEvent(new CustomEvent("studio:open-app", { detail: { app } }));
	}, [app]);

	// An install from the Library lands in ~10-60 s, but the app list refreshes
	// every 5 min: until it shows, say so and re-read it every 5 s (≤ 3 min),
	// instead of "No apps installed yet" (round 10 gap, 2026-11-28).
	const [pending] = useState(() => pendingInstallNames().filter((n) => !installed.includes(n)));
	const waiting = !app && pending.length > 0;
	useEffect(() => {
		if (!waiting) return;
		const t0 = Date.now();
		const id = window.setInterval(() => {
			if (Date.now() - t0 > 180_000) { window.clearInterval(id); return; }
			window.dispatchEvent(new Event(APP_NAV_INVALIDATE));
		}, 5_000);
		return () => window.clearInterval(id);
	}, [waiting]);

	return (
		<div className="flex flex-1 min-h-0 h-full">
			{/* LEFT + MIDDLE */}
			<div className="flex-1 min-w-0 flex flex-col border-r border-border">
				{/* overflow-x-hidden: a 3D space's labels near the edge must never put a
				    sideways scrollbar under the page ("no scroll bar", 2026-11-27);
				    wide tables scroll inside their own containers. */}
				<div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
					{app
						? <div className="px-5 py-5"><AppOverview app={app} embedded /></div>
						: waiting
							? <div className="px-5 py-10 flex items-center gap-2 text-body text-ink-700" role="status">
								<Loader2 className="h-4 w-4 animate-spin text-lagoon-600" aria-hidden />
								Installing {pending.map((n) => appTitle(n)).join(", ")}… it usually takes under a minute, and opens here when it&apos;s ready.
							</div>
							: <div className="px-5 py-10 text-sm text-muted-foreground">No apps installed yet — browse the Marketplace to add one.</div>}
				</div>
			</div>

			{/* RIGHT — grounded chat (side panel, collapsible; auto-hidden on narrow,
			    where it takes over full width when opened). */}
			<ChatRail groundApp={app || APPS_KEY} top={<RunningNow app={app || undefined} />} />
		</div>
	);
}
