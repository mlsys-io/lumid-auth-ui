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
// here and from AppOverview, so the app shows a single header row.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { PanelRightClose, MessageSquare } from "lucide-react";
import { StudioChat } from "@/components/StudioChat";
import { useAppNav } from "@/components/useAppNav";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import { AppOverview } from "@/pages/studio/apps";

const FEATURED_KEY = "studio_featured_app";
const CHAT_KEY = "studio_ws_chat_open";

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

	const [chatOpen, setChatOpen] = useState<boolean>(() => { try { return localStorage.getItem(CHAT_KEY) !== "0"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem(CHAT_KEY, chatOpen ? "1" : "0"); } catch { /* ignore */ } }, [chatOpen]);

	// Chat-panel toggle lives in the top strip (single header row).
	const chatTarget = usePortalTarget("topstrip-ws-right", !!app);

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

			{/* RIGHT — grounded chat (side panel, collapsible) */}
			{chatOpen && app && (
				<div className="w-[400px] xl:w-[460px] flex-shrink-0 flex flex-col min-h-0 bg-background">
					<div className="flex-1 min-h-0 flex flex-col px-3 py-3">
						<StudioChat docked groundApp={app} />
					</div>
				</div>
			)}

			{/* Chat toggle, portaled into the top strip's right cluster. */}
			{chatTarget && createPortal(
				<button onClick={() => setChatOpen((v) => !v)} title={chatOpen ? "Hide chat" : "Show chat"}
					className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
					{chatOpen ? <PanelRightClose className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
				</button>,
				chatTarget,
			)}
		</div>
	);
}
