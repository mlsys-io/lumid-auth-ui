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

import { useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ChatRail from "@/components/ChatRail";
import { useAppNav } from "@/components/useAppNav";
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

	return (
		<div className="flex flex-1 min-h-0 h-full">
			{/* LEFT + MIDDLE */}
			<div className="flex-1 min-w-0 flex flex-col border-r border-border">
				<div className="flex-1 min-h-0 overflow-y-auto">
					{app
						? <div className="px-5 py-5"><AppOverview app={app} embedded /></div>
						: <div className="px-5 py-10 text-sm text-muted-foreground">No apps installed yet — browse the marketplace from the Library.</div>}
				</div>
			</div>

			{/* RIGHT — grounded chat (side panel, collapsible; auto-hidden on narrow,
			    where it takes over full width when opened). */}
			<ChatRail groundApp={app} enabled={!!app} />
		</div>
	);
}
