// StudioWorkspace — the 3-panel app page (/studio/apps[/:app]). The MAIN page
// (/studio) is untouched (the chat home); this layout is for an app only:
//
//   [ app nav (left, hide button) ] [ details (middle) ] [ grounded chat (right) ]
//
// Structured content lives in the left/middle panels (never dumped into chat);
// the right chat is the agent-led, progressive conversation grounded on the app.

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, MessageSquare } from "lucide-react";
import { StudioChat } from "@/components/StudioChat";
import { useAppNav } from "@/components/useAppNav";
import { AppOverview } from "@/pages/studio/apps";

const FEATURED_KEY = "studio_featured_app";
const LEFT_KEY = "studio_ws_left_hidden";
const CHAT_KEY = "studio_ws_chat_open";

export default function StudioWorkspace() {
	const { app: paramApp } = useParams<{ app?: string }>();
	const navigate = useNavigate();
	const appNav = useAppNav();
	const installed = useMemo(() => appNav.flatMap((s) => s.items.map((i) => i.app)), [appNav]);

	const stored = (() => { try { return localStorage.getItem(FEATURED_KEY) || ""; } catch { return ""; } })();
	const app = paramApp || stored || installed[0] || "";

	// Clean URL: /studio/apps with no param but a resolved default → go to it.
	useEffect(() => {
		if (!paramApp && app) navigate(`/studio/apps/${encodeURIComponent(app)}`, { replace: true });
	}, [paramApp, app, navigate]);

	// Persist the pick + open the app in the docked chat with the agent-led
	// opener (stash for chat mount, event for live switches; openAppInChat dedupes).
	useEffect(() => {
		if (!app) return;
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
			{/* LEFT + MIDDLE */}
			<div className="flex-1 min-w-0 flex flex-col border-r border-border">
				<div className="flex items-center gap-2 px-4 h-12 border-b border-border flex-shrink-0">
					<button onClick={() => setLeftHidden((v) => !v)} title={leftHidden ? "Show panel" : "Hide panel"}
						className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
						{leftHidden ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
					</button>
					{/* App identity lives in the top strip (AppSwitcher in the "App"
					    place) — this sub-header keeps only the panel toggles. */}
					{!app && <span className="font-display text-[16px] font-medium text-foreground px-1">No apps installed</span>}
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
						: <div className="px-5 py-10 text-sm text-muted-foreground">No apps installed yet — browse the marketplace from the Library.</div>}
				</div>
			</div>

			{/* RIGHT — grounded chat (side panel, collapsible) */}
			{chatOpen && app && (
				<div className="w-[400px] xl:w-[460px] flex-shrink-0 flex flex-col min-h-0 relative bg-background">
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
