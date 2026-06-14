// StudioWorkspace — the morphing shell used by /studio (front) and
// /studio/apps[/:app] (an app). The chat is ALWAYS the right panel; the left
// morphs (home context ↔ app nav+details); the middle (app details) exists
// only when an app is featured.
//
//   front  (/studio)            : [ HomePanel ] [ chat ]
//   app    (/studio/apps/:app)  : [ AppOverview (nav + details) ] [ chat ]   + switcher header
//
// Structured content lives in the left/middle panels (never dumped into chat);
// the chat stays conversational + grounded on the featured app.

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, MessageSquare } from "lucide-react";
import { StudioChat } from "@/components/StudioChat";
import { setStudioSelection } from "@/components/StudioContext";
import { useAppNav } from "@/components/useAppNav";
import HomePanel from "@/components/studio/HomePanel";
import AppSwitcher from "@/components/studio/AppSwitcher";
import { AppOverview } from "@/pages/studio/apps";

const FEATURED_KEY = "studio_featured_app";
const LEFT_KEY = "studio_ws_left_hidden";
const CHAT_KEY = "studio_ws_chat_open";

export default function StudioWorkspace({ front }: { front?: boolean }) {
	const { app: paramApp } = useParams<{ app?: string }>();
	const navigate = useNavigate();
	const appNav = useAppNav();
	const installed = useMemo(() => appNav.flatMap((s) => s.items.map((i) => i.app)), [appNav]);

	// Resolve the featured app (app mode only). param > last-featured > first installed.
	const stored = (() => { try { return localStorage.getItem(FEATURED_KEY) || ""; } catch { return ""; } })();
	const app = front ? "" : (paramApp || stored || installed[0] || "");

	// Clean URL: app mode with no param but a resolved default → redirect to it.
	useEffect(() => {
		if (!front && !paramApp && app) navigate(`/studio/apps/${encodeURIComponent(app)}`, { replace: true });
	}, [front, paramApp, app, navigate]);

	// Persist the pick + open the app in the docked chat with an agent-led
	// opener (no surface dump — details live in the middle panel). The stash is
	// consumed by the chat on (re)mount; the event handles live app switches.
	// openAppInChat dedupes the two and skips re-opening the same app.
	useEffect(() => {
		if (!app) { setStudioSelection(null); return; }
		try {
			localStorage.setItem(FEATURED_KEY, app);
			sessionStorage.setItem("studio_open_app_v1", JSON.stringify({ app }));
		} catch { /* ignore */ }
		window.dispatchEvent(new CustomEvent("studio:open-app", { detail: { app } }));
	}, [app]);

	const [leftHidden, setLeftHidden] = useState<boolean>(() => { try { return localStorage.getItem(LEFT_KEY) === "1"; } catch { return false; } });
	const [chatOpen, setChatOpen] = useState<boolean>(() => { try { return localStorage.getItem(CHAT_KEY) !== "0"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem(LEFT_KEY, leftHidden ? "1" : "0"); } catch { /* ignore */ } }, [leftHidden]);
	useEffect(() => { try { localStorage.setItem(CHAT_KEY, chatOpen ? "1" : "0"); } catch { /* ignore */ } }, [chatOpen]);

	return (
		<div className="flex flex-1 min-h-0 h-full">
			{/* LEFT + MIDDLE. On the FRONT page the chat is the wide main and Home
			    is a narrow rail; on an APP page the details are the wide main and
			    the chat is a side panel. */}
			<div className={(front ? "w-[340px] flex-shrink-0" : "flex-1 min-w-0") + " flex flex-col border-r border-border"}>
				{/* Workspace header — the app switcher owns identity (app mode), plus
				    the left-hide + chat toggles. */}
				<div className="flex items-center gap-2 px-4 h-12 border-b border-border flex-shrink-0">
					{app && (
						<button onClick={() => setLeftHidden((v) => !v)} title={leftHidden ? "Show panel" : "Hide panel"}
							className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
							{leftHidden ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
						</button>
					)}
					{app
						? <AppSwitcher app={app} />
						: <span className="font-display text-[16px] font-medium text-foreground px-1">Home</span>}
					{!chatOpen && (
						<button onClick={() => setChatOpen(true)} title="Show chat"
							className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
							<MessageSquare className="w-3.5 h-3.5" /> Chat
						</button>
					)}
				</div>
				<div className="flex-1 min-h-0 overflow-y-auto">
					{app
						? <div className="px-5 py-5"><AppOverview app={app} embedded hideLeft={leftHidden} /></div>
						: <HomePanel />}
				</div>
			</div>

			{/* RIGHT — grounded chat. Wide main on the front page; side panel on an app. */}
			{chatOpen && (
				<div className={(front ? "flex-1 min-w-0" : "w-[400px] xl:w-[460px] flex-shrink-0") + " flex flex-col min-h-0 relative bg-background"}>
					<div className="flex items-center justify-end h-12 px-3 border-b border-border flex-shrink-0">
						<button onClick={() => setChatOpen(false)} title="Hide chat"
							className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
							<PanelRightClose className="w-4 h-4" />
						</button>
					</div>
					<div className="flex-1 min-h-0 flex flex-col px-3 pb-3">
						<StudioChat docked />
					</div>
				</div>
			)}
		</div>
	);
}
