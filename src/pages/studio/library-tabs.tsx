// /studio/library — one quiet destination for everything you can pull
// in or inspect as a building block: Marketplace (apps), Skills, and
// Experiments live here as tabs instead of three top-level nav entries
// (operator feedback 2026-06-12: "left nav too many — consolidate").
//
// Old top-level routes (/studio/marketplace, /studio/skills,
// /studio/experiments) redirect into the tabs so deep links and chat
// links keep working.
//
// Like the app workspace, the Library is a 2-panel page: the tabbed
// content on the left, a docked grounded chat on the right (collapsible,
// toggle portaled into the top strip). Only one StudioChat is mounted at
// a time (routes are mutually exclusive via <Outlet/>), so there's no
// conflict with the home / app-workspace chats.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet } from "react-router-dom";
import { Store, Puzzle, FlaskConical, PanelRightClose, MessageSquare } from "lucide-react";
import { StudioChat, LIBRARY_KEY } from "@/components/StudioChat";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import { cn } from "@/lib/utils";

const TABS = [
	{ to: "/studio/library/marketplace", label: "Marketplace", icon: Store },
	{ to: "/studio/library/skills", label: "Skills", icon: Puzzle },
	{ to: "/studio/library/experiments", label: "Experiments", icon: FlaskConical },
];

const CHAT_KEY = "studio_lib_chat_open";

export default function StudioLibraryTabs() {
	const [chatOpen, setChatOpen] = useState<boolean>(() => { try { return localStorage.getItem(CHAT_KEY) !== "0"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem(CHAT_KEY, chatOpen ? "1" : "0"); } catch { /* ignore */ } }, [chatOpen]);
	const chatTarget = usePortalTarget("topstrip-ws-right", true);

	return (
		<div className="flex flex-1 min-h-0 h-full">
			{/* LEFT — tabbed library content */}
			<div className="flex-1 min-w-0 flex flex-col border-r border-border">
				<div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
					<div className="space-y-4 max-w-5xl">
						<div className="flex items-center gap-1.5">
							{TABS.map(({ to, label, icon: Icon }) => (
								<NavLink
									key={to}
									to={to}
									className={({ isActive }) =>
										cn(
											"inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium rounded-lg border transition-colors",
											isActive
												? "border-gold-300 bg-gold-50 text-gold-900"
												: "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800",
										)
									}
								>
									<Icon className="w-3.5 h-3.5" />
									{label}
								</NavLink>
							))}
						</div>
						<Outlet />
					</div>
				</div>
			</div>

			{/* RIGHT — grounded chat (side panel, collapsible) */}
			{chatOpen && (
				<div className="w-[400px] xl:w-[460px] flex-shrink-0 flex flex-col min-h-0 bg-background">
					<div className="flex-1 min-h-0 flex flex-col px-3 py-3">
						<StudioChat docked groundApp={LIBRARY_KEY} />
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
