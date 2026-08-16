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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import { PanelRightClose, MessageSquare } from "lucide-react";
import { StudioChat } from "@/components/StudioChat";
import { useAppNav } from "@/components/useAppNav";
import { usePortalTarget } from "@/hooks/usePortalTarget";
import { useIsNarrow } from "@/hooks/useIsNarrow";
import { cn } from "@/lib/utils";
import { AppOverview } from "@/pages/studio/apps";

const FEATURED_KEY = "studio_featured_app";
const CHAT_KEY = "studio_ws_chat_open";

// Chat rail width. The rail was hardcoded `w-[400px] xl:w-[460px]` and could
// not be resized — while StudioChat carried a full, unreachable resize
// implementation (width state, bounds, drag handler, persistence) that nothing
// rendered, left behind when the chat became a centered column. So the feature
// looked implemented, in the wrong component, and did nothing.
//
// The width belongs HERE, because this is the element that has it: the rail is
// the parent, and StudioChat fills whatever it is given. Same storage key and
// bounds as the orphaned code, so anyone who had dragged it before the layout
// change gets their width back.
const WIDTH_KEY = "studio_chat_width_v1";
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 460;

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

	// Low-width: auto-hide the chat panel so the center has room (derived
	// override — never writes the persisted pref). On narrow it starts hidden;
	// the toggle opens it for the session (it then takes over, full width).
	const isNarrow = useIsNarrow(1024);
	const [narrowChatOpen, setNarrowChatOpen] = useState(false);
	useEffect(() => { if (!isNarrow) setNarrowChatOpen(false); }, [isNarrow]);
	const chatVisible = !!app && (isNarrow ? narrowChatOpen : chatOpen);
	const toggleChat = () => { if (isNarrow) setNarrowChatOpen((v) => !v); else setChatOpen((v) => !v); };

	// Chat-panel toggle lives in the top strip (single header row).
	const chatTarget = usePortalTarget("topstrip-ws-right", !!app);

	// Rail width + drag-to-resize.
	const [width, setWidth] = useState<number>(() => {
		try {
			const n = parseInt(localStorage.getItem(WIDTH_KEY) || "", 10);
			return Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
		} catch { return DEFAULT_WIDTH; }
	});
	const [resizing, setResizing] = useState(false);
	useEffect(() => {
		// Persist on release, not on every pointermove — a drag is ~100 events
		// and localStorage writes are synchronous.
		if (resizing) return;
		try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
	}, [resizing, width]);

	const startResize = useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		setResizing(true);
		const startX = e.clientX;
		const startW = width;
		const onMove = (ev: PointerEvent) => {
			// Handle sits on the rail's LEFT edge and the rail is right-anchored,
			// so dragging left GROWS it — hence startX - clientX, not the reverse.
			setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + (startX - ev.clientX))));
		};
		const onUp = () => {
			setResizing(false);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}, [width]);

	// Double-click the handle restores the default — the only way back from a
	// width dragged to an extreme without hunting for the pixel.
	const resetWidth = useCallback(() => setWidth(DEFAULT_WIDTH), []);

	// While dragging, hold the resize cursor and kill text selection GLOBALLY.
	// Without this the cursor reverts the moment the pointer leaves the 3px
	// handle — which it does immediately — and the drag selects the transcript
	// text it passes over. Cleanup restores both, including on unmount mid-drag.
	useEffect(() => {
		if (!resizing) return;
		const { body } = document;
		const prevCursor = body.style.cursor;
		const prevSelect = body.style.userSelect;
		body.style.cursor = "col-resize";
		body.style.userSelect = "none";
		return () => {
			body.style.cursor = prevCursor;
			body.style.userSelect = prevSelect;
		};
	}, [resizing]);

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
			{chatVisible && (
				<div
					className={cn("relative flex-shrink-0 flex flex-col min-h-0 bg-background", isNarrow && "w-full")}
					// Inline width, not a class: the value is a dragged number, and
					// Tailwind cannot generate arbitrary classes at runtime. On narrow
					// the rail takes over full width, so the drag width does not apply.
					style={isNarrow ? undefined : { width }}
				>
					{!isNarrow && (
						<div
							onPointerDown={startResize}
							onDoubleClick={resetWidth}
							role="separator"
							aria-orientation="vertical"
							aria-label="Resize chat panel (double-click to reset)"
							title="Drag to resize · double-click to reset"
							// 3px of hit area straddling the border, pulled left by half
							// its width so it sits ON the seam rather than beside it.
							// Wider than it looks: a 1px target is unhittable.
							className={cn(
								"absolute left-0 top-0 h-full w-[3px] -ml-[1px] z-10 cursor-col-resize",
								"hover:bg-foreground/20 transition-colors",
								resizing && "bg-foreground/30",
							)}
						/>
					)}
					<div className="flex-1 min-h-0 flex flex-col px-3 py-3">
						<StudioChat docked groundApp={app} />
					</div>
				</div>
			)}

			{/* Chat toggle, portaled into the top strip's right cluster. */}
			{chatTarget && createPortal(
				<button onClick={toggleChat} title={chatVisible ? "Hide chat" : "Show chat"}
					className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
					{chatVisible ? <PanelRightClose className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
				</button>,
				chatTarget,
			)}
		</div>
	);
}
