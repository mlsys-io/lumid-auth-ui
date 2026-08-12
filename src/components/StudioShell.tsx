// Lumid Studio shell — the unified workspace.
//
// One left nav, one top bar, one design language. Replaces the
// fragmented /app/* and /dashboard/* dual-shell pattern over time.
// Lives at /studio/* (path-based, see studio-plan.md decision S1).
//
// The Outlet renders the active workspace. Each workspace is a
// regular page component that just trusts it's inside this shell —
// no per-page nav reimplementation.

import { Link, NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import {
	Boxes,
	CirclePlus,
	PanelLeftClose,
	PanelLeftOpen,
	Store,
	Settings,
	Shield,
	BookOpen,
	LogOut,
	ChevronDown,
	ChevronRight,
	Key,
	Inbox,
	MessageSquare,
	Bot,
	Trash2,
	CalendarClock,
	Loader2,
	AlertCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useViewMode } from './ViewModeProvider';
import { cn } from '../lib/utils';
import { me } from '@/api/me';
import { useAppNav, iconFor, type AppNavItem } from './useAppNav';
import type { LucideIcon } from 'lucide-react';
import { useRecentChats, RECENT_CHATS_INVALIDATE, type RecentChatItem } from './useRecentChats';
import { writeAppChat } from './appChatMap';
import { ArtifactIconButton } from './ArtifactIconButton';
import { useStudioRefetch } from '@/hooks/useStudioRefetch';
import { useIsNarrow } from '@/hooks/useIsNarrow';
import { useCollapse } from '@/hooks/useCollapse';
import { formatRelative } from '@/lib/relative-time';
// StudioShell is now the single shell — it also hosts the /dashboard/* pages
// (admin, quant, lumilake, lqt, product). The ported Runmesh admin pages need
// these providers + the numeric-id bridge that AppLayout used to supply.
import { LanguageProvider } from '../runmesh/i18n';
import { EnterpriseTipProvider } from '../runmesh/components/EnterpriseTip';
import { useAuthStore } from '../runmesh/stores/useAuthStore';
import { httpUser } from '../runmesh/utils/axios';
// Phase S6a — persistent chat sidebar. AI is the primary interface
// for Studio; webforms in the main workspace area become the
// precision channel beside it.
// Mouse-picker overlay — sits at the document root so it can capture
// pointer events globally when the user clicks the Crosshair in the
// chat. Inactive (renders null) until startStudioPicking() is called.
import StudioPicker from './StudioPicker';
// StudioArtifactPanel — used to live here as a left-rail drawer.
// Moved into the chat header right group on 2026-05-29; rendered as
// a popover anchored to the ArtifactIconButton in StudioChat. The
// shell no longer mounts it.
// Top-bar status strip — page title + live activity pills (drafts,
// running, failing). Fills the gap left by removing the redundant
// "Ask anything" search input.
import TopStatusStrip from './TopStatusStrip';

interface NavItem {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	end?: boolean;
	badge?: number; // count pill on the right (e.g. pending drafts on Inbox)
	title?: string; // hover tooltip clarifying the surface
}

// Sidebar layout (post-refactor, 2026-05-29):
//   Intents          — the one work-surface. Everything the user
//                      tracks + manages lives inside their standing
//                      intents.
//
// Intents is the primary surface; the four secondary surfaces
// (Inbox / Workflows / Knowledge / Library) are listed directly below
// it, separated by a divider (no "More" collapse). Settings / Admin /
// API tokens live in the bottom avatar menu; "How it works" is a quiet
// footer docs link.
const TOP_NAV: NavItem[] = [
	// Fleet is merged into "Manage apps" (/studio/apps/all) — no separate entry.
	{ to: '/studio/library', label: 'Library', icon: Store, title: 'marketplace, skills, and experiments' },
	// "Scheduled" — the claude.ai counterpart of our workflow/loop runs. Points
	// at the unified runs surface (list/grid/gantt/calendar over every loop).
	{ to: '/studio/runs', label: 'Scheduled', icon: CalendarClock, title: 'scheduled workflows and loop runs' },
];
// Jobs/Activity/Inbox are folded into Apps — the Apps hero's "runs today" stat
// + the top-bar "Right now" ticker link into /studio/runs, so it's no longer a
// separate top-level destination.
// Route-chunk prefetch — on hover/focus of a nav item, warm the lazy chunk for
// its destination so the click navigates with the JS already downloaded (the
// chunk transfer over the FRP tunnel is the slow part of a first navigation).
// Vite dedupes these dynamic imports with App.tsx's lazy() — same chunk.
const ROUTE_PREFETCH: Record<string, () => Promise<unknown>> = {
	"/studio/library": () => import("@/pages/studio/library-tabs"),
	"/studio/runs": () => import("@/pages/studio/runs"),
	"/studio/portfolio": () => import("@/pages/studio/portfolio"),
};
const prefetched = new Set<string>();
function prefetchRoute(to: string) {
	const norm = to.split("?")[0];
	if (prefetched.has(norm)) return;
	prefetched.add(norm);
	const fn = ROUTE_PREFETCH[norm]
		// the workspace (front + per-app) shares the StudioWorkspace + apps chunks
		?? ((norm === "/studio/apps" || norm.startsWith("/studio/apps/") || norm.startsWith("/studio/a/"))
			? () => Promise.all([import("@/pages/studio/StudioWorkspace"), import("@/pages/studio/apps")])
			: undefined);
	fn?.().catch(() => prefetched.delete(norm));
}

function NavItemView({ to, label, icon: Icon, end, badge, title }: NavItem) {
	return (
		<NavLink
			to={to}
			end={end}
			title={title}
			onMouseEnter={() => prefetchRoute(to)}
			onFocus={() => prefetchRoute(to)}
			className={({ isActive }) =>
				cn(
					'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors relative',
					isActive
						? 'bg-black/[0.06] text-foreground font-medium'
						: 'text-foreground/60 hover:bg-black/[0.04] hover:text-foreground',
				)
			}
		>
			{({ isActive }) => (
				<>
					<Icon className={cn(
						'w-4 h-4 flex-shrink-0 transition-colors',
						isActive ? 'text-foreground/80' : 'text-foreground/45 group-hover:text-foreground/70',
					)} />
					<span>{label}</span>
					{badge != null && badge > 0 && (
						<span
							className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-gold-100 text-gold-700 text-[10px] font-semibold tabular-nums"
							title={`${badge} awaiting you`}
						>
							{badge}
						</span>
					)}
				</>
			)}
		</NavLink>
	);
}

// Uppercase section divider for app-contributed nav groups.
function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="mt-4 mb-1 px-3 text-[11px] font-medium text-muted-foreground">
			{children}
		</div>
	);
}

// "Recent" — the user's most recent chat threads, each opening back into
// the exact right-pane context it was started in: a bare chatbox at
// /studio ('chat' kind) or an app-grounded, docked chat at
// /studio/apps/:app ('agent' kind). Both are the same StudioChat
// component; the kind only decides where we navigate before it mounts.
// Titles collide by construction: both server title stages read only the opening
// exchange, and an app's threads are all opened by the same templated prompt.
// End-truncation then renders every row identically ("Case_019_Beta…") — the
// distinguishing part is at the END, which is exactly what gets cut. Keep both.
// Compact age for a dense rail. "18 hours ago" cost ~70px per row, which came
// straight out of the title and put every row back to "Case_01…".
function compactAge(value: string | number | null | undefined): string {
	const ms = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
	if (!isFinite(ms)) return '';
	const s = Math.max(0, (Date.now() - ms) / 1000);
	if (s < 60) return 'now';
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
	return `${Math.floor(s / (86400 * 7))}w`;
}

function middleTruncate(s: string, max = 30): string {
	if (s.length <= max) return s;
	const head = Math.ceil((max - 1) * 0.55);
	return `${s.slice(0, head)}…${s.slice(s.length - (max - 1 - head))}`;
}

function RecentRow({ item, navigate, appIcon }: {
	item: RecentChatItem;
	navigate: (to: string) => void;
	appIcon?: LucideIcon;
}) {
	// The app's OWN icon carries the grouping now the list is flat, so each app
	// stays visually distinct without a folder per app.
	const Icon = appIcon || (item.kind === 'agent' ? Bot : MessageSquare);
	const open = () => {
		const target = item.app ? `/studio/apps/${encodeURIComponent(item.app)}` : '/studio';
		if (window.location.pathname === target) {
			// Already there: navigate() would be a no-op and the chat would
			// never remount, so hand it the thread directly instead.
			window.dispatchEvent(new CustomEvent('studio:open-chat', {
				detail: { id: item.id, app: item.app || null },
			}));
			return;
		}
		try {
			sessionStorage.setItem('studio_open_chat_v1', JSON.stringify({ id: item.id, app: item.app }));
		} catch { /* ignore */ }
		navigate(target);
	};
	// Delete lived in the chat's Conversations popover, which this section
	// replaced — so it has to live here now, or the capability is simply gone.
	const del = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!confirm('Delete this conversation?')) return;
		try {
			await fetch('/api/v1/me/chats/' + encodeURIComponent(item.id), {
				method: 'DELETE',
				credentials: 'include',
			});
			// Tell a mounted chat to reset if this was the thread it had open.
			window.dispatchEvent(new CustomEvent('studio:chat-deleted', { detail: { id: item.id } }));
			window.dispatchEvent(new CustomEvent(RECENT_CHATS_INVALIDATE));
		} catch { /* ignore */ }
	};
	// Title-only row, claude.ai-style — the relative time was noise at this
	// density. It survives as the hover tooltip, where it costs nothing.
	return (
		<div className="group relative flex items-center">
			<button
				onClick={open}
				title={`${item.title || 'Untitled chat'} · ${formatRelative(item.updatedAt)}`}
				className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground/60 hover:bg-black/[0.04] hover:text-foreground transition-colors text-left"
			>
				<Icon className="w-4 h-4 flex-shrink-0 text-foreground/45" />
				<span className="flex-1 min-w-0 truncate">{middleTruncate(item.title || 'Untitled chat')}</span>
				<span className="flex-shrink-0 text-[10px] text-muted-foreground/50 tabular-nums">
					{compactAge(item.updatedAt)}
				</span>
			</button>
			<button
				onClick={del}
				title="Delete conversation"
				aria-label="Delete conversation"
				className="absolute right-1 p-1 rounded-md opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 transition-all"
			>
				<Trash2 className="w-3 h-3" />
			</button>
		</div>
	);
}

// Per-list cap, applied AFTER grouping — "Recent" and each app folder each
// get their own depth. 20, not 8: every debounced save fires
// studio:recent-invalidate, so the open thread keeps bumping to the top and a
// short list visibly pushes older rows off the end mid-session.
const RECENT_PER_LIST = 20;

// The header is ALWAYS rendered once loaded — an absent section is
// indistinguishable from a broken one, which is exactly how this first
// read to the user. Empty state says so in words instead.
//
// Scope: app-LESS threads only. App-grounded conversations now live under
// their own app folder below, so a conversation appears in exactly one
// place. Before this split, "Recent" mixed both and an app's threads were
// only reachable by scrolling a global list that other apps kept pushing
// them off of.
function RecentSection({ items, loaded, navigate, iconForApp }: {
	items: RecentChatItem[];
	loaded: boolean;
	navigate: (to: string) => void;
	iconForApp: (app?: string | null) => LucideIcon | undefined;
}) {
	const [showAll, setShowAll] = useState(false);
	if (!loaded) return null;
	const shown = showAll ? items : items.slice(0, RECENT_PER_LIST);
	return (
		<div>
			<SectionLabel>Conversations</SectionLabel>
			{items.length === 0 ? (
				<div className="px-3 py-2 text-xs text-muted-foreground/70">No conversations yet</div>
			) : (
				<>
					{shown.map((item) => (
						<RecentRow key={item.id} item={item} navigate={navigate} appIcon={iconForApp(item.app)} />
					))}
					{items.length > shown.length && (
						<button
							onClick={() => setShowAll(true)}
							className="w-full px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
						>
							Show {items.length - shown.length} more
						</button>
					)}
				</>
			)}
		</div>
	);
}

// One installed app = one LAUNCHER row. It used to be an expandable folder
// holding that app's conversations, which is what crowded the rail: N apps x
// their threads, nested and truncated to ~14 characters. Conversations now live
// in the single flat list above, identified by this app's icon; this row exists
// to open the app and to start a fresh thread in it.
function AppFolder({
	item, navigate, badge,
}: {
	item: AppNavItem;
	navigate: (to: string) => void;
	badge?: number;
}) {
	const location = useLocation();
	const to = `/studio/apps/${encodeURIComponent(item.app)}`;
	const active = location.pathname === to;
	const Icon = iconFor(item.icon);
	const installing = item.status === 'installing';
	const failed = item.status === 'failed';

	// Fresh thread inside this app: drop the app's resume pointer FIRST, then
	// land on it. openAppInChat() resumes readAppChatMap()[app] when present,
	// so without the clear this would just reopen the previous conversation —
	// the exact bug that made per-app chat feel single-threaded.
	const newAppChat = (e: React.MouseEvent) => {
		e.stopPropagation();
		writeAppChat(item.app, null);
		// A queued row-click stash would otherwise load that thread on arrival
		// and undo the fresh start.
		try { sessionStorage.removeItem('studio_open_chat_v1'); } catch { /* ignore */ }
		if (window.location.pathname === to) {
			// Already in the app: nothing remounts and the app is already
			// grounded, so only the dedicated event forces a new thread.
			window.dispatchEvent(new CustomEvent('studio:new-app-chat', { detail: { app: item.app } }));
		} else {
			// Arriving fresh: the cleared resume pointer above is enough —
			// grounding starts a new thread because there's nothing to resume.
			navigate(to);
		}
	};

	return (
		<div>
			<div className={cn(
				'group relative flex items-center rounded-lg transition-colors',
				active ? 'bg-black/[0.06]' : 'hover:bg-black/[0.04]',
			)}>
				<button
					onClick={() => navigate(to)}
					title={failed ? `${item.label} — install failed` : item.label}
					className={cn(
						'flex-1 min-w-0 flex items-center gap-2 pl-3 pr-2 py-2 text-sm text-left',
						active ? 'text-foreground font-medium' : 'text-foreground/70 hover:text-foreground',
					)}
				>
					<Icon className="w-4 h-4 flex-shrink-0 text-foreground/45" />
					<span className="flex-1 min-w-0 truncate">{item.label}</span>
					{installing && <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin text-muted-foreground" />}
					{failed && <AlertCircle className="w-3 h-3 flex-shrink-0 text-rose-500" />}
					{badge != null && badge > 0 && (
						<span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/70">{badge}</span>
					)}
				</button>
				<button
					onClick={newAppChat}
					title={`New chat in ${item.label}`}
					aria-label={`New chat in ${item.label}`}
					className="absolute right-1 p-1 rounded-md opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-black/[0.06] transition-all"
				>
					<CirclePlus className="w-3.5 h-3.5" />
				</button>
			</div>
		</div>
	);
}

// Drag-resizable sidebar width, persisted to localStorage. Mirrors the
// StudioChat right-panel pattern (pointer events, clamp, persist on drag-end)
// so both rails behave identically. (2026-05-30)
const SIDEBAR_WIDTH_KEY = 'studio_sidebar_width_v1';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 224; // == the old w-56

function useSidebarWidth() {
	const [width, setWidth] = useState<number>(() => {
		try {
			const v = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '', 10);
			if (!Number.isNaN(v)) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v));
		} catch { /* ignore */ }
		return SIDEBAR_DEFAULT;
	});
	const [resizing, setResizing] = useState(false);

	// Persist only when a drag ends — keeps localStorage writes off the hot path.
	useEffect(() => {
		if (resizing) return;
		try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width)); } catch { /* ignore */ }
	}, [resizing]); // eslint-disable-line react-hooks/exhaustive-deps

	const startResize = (e: React.PointerEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startW = width;
		setResizing(true);
		const onMove = (ev: PointerEvent) => {
			const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
			setWidth(next);
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			setResizing(false);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	};

	const reset = () => setWidth(SIDEBAR_DEFAULT);
	return { width, resizing, startResize, reset };
}

export function StudioShell() {
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
	// View mode: simple (default, chat-first) hides the whole shell chrome and
	// runs the chatbox full-bleed; advanced renders the current Studio verbatim.
	const { advanced, setMode } = useViewMode();
	const simple = !advanced;
	const { width: sidebarWidth, resizing, startResize, reset: resetSidebar } = useSidebarWidth();
	// App-driven nav: every installed app, grouped by section.
	const appNav = useAppNav();
	const [agentsCollapsed, toggleAgents] = useCollapse('studio_sidebar_agents_v1', false);
	// ONE fetch feeds both the app-less "Recent" list and every app folder, so
	// the two can't drift apart between polls. Uncapped on purpose — each list
	// is capped below, AFTER grouping, so a chatty app can't crowd out Recent.
	const { items: recentChats, loaded: chatsLoaded } = useRecentChats(0);
	// FLAT and recency-ranked: one entry per conversation, app-grounded or not.
	// Folders per app buried the list (11 nested rows, all truncated to the same
	// 14 characters) and split "what did I just do" across N collapsed sections.
	// The app is carried by the row's icon instead.
	const allChats = useMemo(
		() => [...recentChats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
		[recentChats],
	);
	const iconForApp = useCallback((app?: string | null): LucideIcon | undefined => {
		if (!app) return undefined;
		for (const sec of appNav) for (const it of sec.items) if (it.app === app) return iconFor(it.icon);
		return undefined;
	}, [appNav]);
	const location = useLocation();
	// Hosted /dashboard pages, app surfaces, and management need full width
	// (admin tables, dataset explorers); core Studio pages stay narrow.
	// Main page = the chat home (centered chat, height-locked). The app pages
	// are the full-bleed 3-panel workspace (its own panels own padding/scroll).
	// /studio/apps/all is the plain grid → neither.
	const chatHome = location.pathname === '/studio';
	const appWorkspace = location.pathname === '/studio/apps'
		|| (/^\/studio\/apps\/[^/]+/.test(location.pathname) && location.pathname !== '/studio/apps/all');
	// The Library carries its own docked chat (same 2-panel as the app
	// workspace), so it needs the full-bleed, height-locked main too.
	const libWorkspace = location.pathname.startsWith('/studio/library');
	const fullBleed = appWorkspace || libWorkspace;
	const wideMain = location.pathname.startsWith('/dashboard')
		|| location.pathname.startsWith('/studio/a/')
		|| location.pathname.startsWith('/studio/manage')
		|| location.pathname === '/studio/apps/all';
	// Bridge lum.id → Runmesh auth store (numeric sys_user.user_id) for the
	// ported Runmesh admin pages now hosted in this shell. Ported from AppLayout.
	const setRunmeshUser = useAuthStore((s) => s.setUser);
	useEffect(() => {
		// Only admins on a /dashboard route reach the ported Runmesh pages that
		// need the numeric-id bridge. Gating to /dashboard avoids a needless
		// (and session-only) /runmesh profile fetch on every /studio chat page.
		if (!user || !isAdmin || !location.pathname.startsWith('/dashboard')) return;
		(async () => {
			try {
				const profile = await httpUser.get<{ user?: Record<string, unknown> } & Record<string, unknown>>('/runmesh/system/user/profile');
				const ru = (profile?.user ?? profile) as Record<string, unknown> | undefined;
				if (ru?.userId != null) {
					setRunmeshUser({
						id: ru.userId,
						username: (ru.userName as string) || user.username || '',
						nickname: (ru.nickName as string) || user.username || '',
						email: (ru.email as string) || user.email || '',
						role: (user.role as string) || 'user',
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
					} as any);
				}
			} catch { /* best-effort — pages needing this show their own error */ }
		})();
	}, [user, isAdmin, setRunmeshUser, location.pathname]);

	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	// Simple-mode header account dropdown (the sidebar user menu is hidden there).
	const [acctOpen, setAcctOpen] = useState(false);
	const acctRef = useRef<HTMLDivElement>(null);

	// Sidebar collapse — the resize control lives at the sidebar's top-right and
	// is always visible (when collapsed it moves to the header's far left).
	const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
		try { return localStorage.getItem('studio_sidebar_collapsed_v1') === '1'; } catch { return false; }
	});
	useEffect(() => {
		try { localStorage.setItem('studio_sidebar_collapsed_v1', sidebarCollapsed ? '1' : '0'); } catch { /* ignore */ }
	}, [sidebarCollapsed]);

	// Low-width: auto-hide the sidebar so the center isn't crushed. This is a
	// DERIVED override — it never writes the persisted pref, so the user's wide
	// preference survives. On narrow, the sidebar starts hidden; the header's
	// expand control opens it for the session (narrowNavOpen).
	const isNarrow = useIsNarrow(1024);
	const [narrowNavOpen, setNarrowNavOpen] = useState(false);
	useEffect(() => { if (!isNarrow) setNarrowNavOpen(false); }, [isNarrow]);
	// Per-app workspace (/studio/apps/:app). The nav used to auto-hide here so
	// the page read as just Observe + Chat, but hiding it on the one route where
	// you most want to move between apps and conversations cost more than the
	// focus it bought — and it re-hid on every app switch, so the reveal never
	// stuck. The sidebar now follows the SAME persisted preference as everywhere
	// else: collapse it if you want it gone, and that choice holds.
	const inAppWorkspace = /^\/studio\/apps\/[^/]+/.test(location.pathname)
		&& location.pathname !== '/studio/apps/all';
	// Simple mode: no sidebar at all — the chatbox is the whole surface.
	const sidebarHidden = isNarrow ? !narrowNavOpen : sidebarCollapsed;
	const hideSidebar = () => { if (isNarrow) setNarrowNavOpen(false); else setSidebarCollapsed(true); };
	const showSidebar = () => { if (isNarrow) setNarrowNavOpen(true); else setSidebarCollapsed(false); };

	// Pending-drafts count → app-contributed nav badges (badge_source:
	// 'drafts'). The Inbox nav entry folded into Home's status bar; the
	// Inbox surface (moved off the My Apps hero), so the count belongs here.
	const [draftCount, setDraftCount] = useState(0);
	const tickDrafts = useCallback(() => {
		me.listDrafts({ state: "pending" })
			.then((r) => setDraftCount(r.drafts?.length || 0))
			.catch(() => { /* soft-fail; badge just stays hidden */ });
	}, []);
	useEffect(() => {
		tickDrafts();
		const id = window.setInterval(tickDrafts, 60_000);
		return () => window.clearInterval(id);
	}, [tickDrafts]);
	// Chat→page bus: badge updates the moment chat sends/dismisses a draft.
	useStudioRefetch(["drafts"], tickDrafts);

	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
			if (!acctRef.current?.contains(e.target as Node)) setAcctOpen(false);
		};
		document.addEventListener('mousedown', onClick);
		return () => document.removeEventListener('mousedown', onClick);
	}, []);

	const onLogout = async () => {
		try { await logout(); } catch { /* cookie cleared server-side */ }
		navigate('/auth/login');
	};

	// "⊕ New chat" — the chat IS the main surface (/studio). Flag a fresh
	// conversation and land there; StudioChat consumes the flag on mount.
	const newChat = () => {
		try { sessionStorage.setItem('studio_new_chat_v1', '1'); } catch { /* ignore */ }
		if (location.pathname === '/studio') {
			window.dispatchEvent(new Event('studio:new-chat'));
		} else {
			navigate('/studio');
		}
	};

	// studio:ask bridge — the chat is mounted on /studio (home) AND on every app
	// workspace page (the docked right panel). When it's mounted, its OWN
	// listener handles the ask in place — so we must NOT navigate (doing so on an
	// app page yanked the user off the workspace, e.g. clicking an opener chip
	// made the middle panel vanish). Only stash+navigate from pages WITHOUT a
	// chat (Library, Jobs, …), where StudioChat consumes the stash on mount.
	useEffect(() => {
		const chatIsMounted = (path: string) =>
			path === '/studio' ||
			(/^\/studio\/apps\/[^/]+/.test(path) && path !== '/studio/apps/all');
		const onAsk = (e: Event) => {
			if (chatIsMounted(window.location.pathname)) return; // local chat handles it
			const detail = (e as CustomEvent).detail;
			if (!detail?.prompt) return;
			try { sessionStorage.setItem('studio_pending_ask_v1', JSON.stringify(detail)); } catch { /* ignore */ }
			navigate('/studio');
		};
		window.addEventListener('studio:ask', onAsk as EventListener);
		return () => window.removeEventListener('studio:ask', onAsk as EventListener);
	}, [navigate]);

	return (
		<LanguageProvider>
		<EnterpriseTipProvider>
		<div className={cn(
			'min-h-screen bg-background flex',
			resizing && 'select-none cursor-ew-resize',
		)}>
			{/* Sidebar ─────────────────────────────────────────────── */}
			{!sidebarHidden && (
			<aside
				data-studio-picker-chrome="1"
				style={{ width: sidebarWidth }}
				className="relative flex flex-col h-screen flex-shrink-0 bg-sidebar border-r border-sidebar-border sticky top-0"
			>
				<div className="flex items-center justify-between pr-1.5">
					<button onClick={newChat} title="New chat" className="px-4 py-4 flex items-baseline text-left flex-1 min-w-0">
						<span className="font-display text-[18px] font-semibold tracking-tight text-foreground truncate">Lumid Studio</span>
					</button>
					<button
						onClick={hideSidebar}
						title="Collapse sidebar"
						aria-label="Collapse sidebar"
						className="flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/[0.05] transition-colors"
					>
						<PanelLeftClose className="w-4 h-4" />
					</button>
				</div>

				<nav className="flex-1 overflow-y-auto px-2 py-3 space-y-px">
					{/* Primary action — a quiet claude-style row, not a button. */}
					<button
						onClick={newChat}
						className="w-full mb-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-black/[0.04] transition-colors"
					>
						<CirclePlus className="w-4 h-4 text-foreground/55" /> New chat
					</button>
					{TOP_NAV.map((item) => <NavItemView key={item.to} {...item} />)}
					{appNav.length > 0 && (
						<div>
							<button
								onClick={toggleAgents}
								className="mt-4 mb-1 w-full flex items-center gap-1 px-3 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
							>
								<ChevronRight className={cn('w-3 h-3 transition-transform', !agentsCollapsed && 'rotate-90')} />
								Applications
							</button>
							{!agentsCollapsed && appNav.map((sec) => (
								<div key={sec.section}>
									{sec.section !== 'Agents' && <SectionLabel>{sec.section}</SectionLabel>}
									{sec.items.map((it) => (
										<AppFolder
											key={it.app}
											item={it}
											navigate={navigate}
											badge={it.badge_source === 'drafts' ? draftCount : undefined}
										/>
									))}
								</div>
							))}
						</div>
					)}
					{/* Recent — app-LESS threads only. Anything grounded in an app
					    lives under that app's folder below, so "New chat" above and
					    the app folders are siblings, not a hierarchy. */}
					<RecentSection items={allChats} loaded={chatsLoaded} navigate={navigate} iconForApp={iconForApp} />
					{/* Installed apps — EVERY installed app gets a folder here
					    (ui.sidebar is an optional label/icon override, not the
					    admission price), each expanding to its own conversations.
					    Data-driven via useAppNav(); soft-fails to nothing if
					    /me/apps is unreachable. */}
				</nav>

				{/* Artifacts — moved out of the chat header (2026-08-10) so it sits
				    with the other persistent surfaces. Deliberately OUTSIDE the
				    scrolling <nav>: its 420px panel is absolutely positioned and
				    would be clipped by that container's overflow-y-auto. */}
				<div className="px-2 pb-1">
					<ArtifactIconButton variant="sidebar" />
				</div>

				{/* Documentation panel — replaces the old per-doc footer links
				    (How it works, Claude guide, CD runbook): the tour and every
				    guide/runbook/contract live behind one in-shell index at
				    /studio/docs. Auth-gated docs stay enforced server-side by
				    the edge gate regardless. */}
				<NavLink
					to="/studio/docs"
					className={({ isActive }) => cn(
						'mx-3 mb-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/[0.04]',
						isActive ? 'text-foreground/80' : 'text-foreground/45 hover:text-foreground/70',
					)}
					title="Guides, contracts, and runbooks"
				>
					<BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
					<span>Documentation</span>
				</NavLink>

				{/* User menu — pinned bottom-left, opens upward. Holds
				    everything the top-right avatar dropdown used to
				    (Settings, API tokens, Admin, Sign out) so account
				    surfaces live in one place. */}
				<div ref={menuRef} className="p-3 border-t border-sidebar-border relative">
					<button
						onClick={() => setMenuOpen((v) => !v)}
						className={[
							'w-full px-1.5 py-1.5 rounded-lg flex items-center gap-2 min-w-0 transition-colors group',
							menuOpen ? 'bg-black/[0.06]' : 'hover:bg-black/[0.04]',
						].join(' ')}
						title="Account menu"
					>
						<div className="w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold flex-shrink-0">
							{(user?.email?.[0] || '?').toUpperCase()}
						</div>
						<div className="flex-1 min-w-0 text-left">
							<div className="text-[12px] font-medium truncate text-foreground">
								{user?.username || user?.email?.split('@')[0] || 'there'}
							</div>
							{isAdmin ? (
								<div className="text-[10px] text-muted-foreground truncate">
									{user?.role === 'super_admin' ? 'super admin' : 'admin'}
								</div>
							) : (
								<div className="text-[10px] text-muted-foreground truncate">{user?.email}</div>
							)}
						</div>
						<ChevronDown className={[
							'w-3.5 h-3.5 text-muted-foreground transition-transform flex-shrink-0',
							menuOpen ? 'rotate-180' : '',
						].join(' ')} />
					</button>

					{menuOpen && (
						<div className="absolute left-3 right-3 bottom-full mb-1 rounded-xl border border-border bg-card shadow-lg py-1 z-30">
							<Link to="/studio/apps/all"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted">
								<Boxes className="w-3.5 h-3.5 text-muted-foreground" />
								Manage agents
							</Link>
							<Link to="/studio/inbox"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted">
								<Inbox className="w-3.5 h-3.5 text-muted-foreground" />
								Inbox
							</Link>
							<Link to="/studio/settings"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted">
								<Settings className="w-3.5 h-3.5 text-muted-foreground" />
								Settings
							</Link>
							<Link to="/studio/account/tokens"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted">
								<Key className="w-3.5 h-3.5 text-muted-foreground" />
								API tokens
							</Link>
							{isAdmin && (
								<Link to="/studio/manage"
									onClick={() => setMenuOpen(false)}
									className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted">
									<Shield className="w-3.5 h-3.5 text-muted-foreground" />
									Management
								</Link>
							)}
							<button
								onClick={onLogout}
								className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 border-t border-border/60 mt-1 pt-2">
								<LogOut className="w-3.5 h-3.5" />
								Sign out
							</button>
						</div>
					)}
				</div>

				{/* Drag-to-resize handle on the right edge — double-click resets */}
				<div
					onPointerDown={startResize}
					onDoubleClick={resetSidebar}
					title="Drag to resize · double-click to reset"
					className={cn(
						'absolute top-0 right-0 z-30 h-full w-1.5 cursor-ew-resize group/resize',
						'hover:bg-black/5 transition-colors',
						resizing && 'bg-black/10',
					)}
				>
					<span className={cn(
						'absolute right-0 top-0 h-full w-px transition-colors',
						'bg-transparent group-hover/resize:bg-foreground/30',
						resizing && '!bg-foreground/40',
					)} />
				</div>
			</aside>
			)}

			{/* Main column ─────────────────────────────────────────── */}
			{/* On the chat route the column is locked to the viewport height
			    (overflow-hidden) so the composer pins to the SCREEN bottom and
			    only the transcript scrolls — never the page. Other routes keep
			    the natural min-h-screen growth + body scroll. */}
			<div className={cn('flex-1 flex flex-col min-w-0', (chatHome || fullBleed) && 'h-screen overflow-hidden')}>
				{/* Top bar — page header lives in TopStatusStrip; account
				    surfaces moved to the sidebar user menu. */}
				<header data-studio-picker-chrome="1" className="min-h-[64px] py-2.5 bg-background/85 backdrop-blur-md border-b border-border sticky top-0 z-10 flex items-center px-3 sm:px-6 gap-2 sm:gap-4">
					{/* When the sidebar is collapsed, its expand control lives here at
					    the header's far left — so the resize icon is always visible. */}
					{sidebarHidden && (
						<button
							onClick={showSidebar}
							title="Show sidebar"
							aria-label="Show sidebar"
							className="flex-shrink-0 -ml-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
						>
							<PanelLeftOpen className="w-4 h-4" />
						</button>
					)}
					<TopStatusStrip />
					<div className="ml-auto flex items-center gap-2 flex-shrink-0">
						{/* Simple / Advanced toggle — the one mode control, in both modes */}
						<div className="flex items-center rounded-full border border-border bg-muted/40 p-0.5 text-[11px]">
							<button
								onClick={() => setMode('simple')}
								title="Simple, chat-first view"
								className={cn('px-2.5 py-1 rounded-full transition-colors', simple ? 'bg-background text-foreground font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
							>
								Simple
							</button>
							<button
								onClick={() => setMode('advanced')}
								title="The full Advanced Studio"
								className={cn('px-2.5 py-1 rounded-full transition-colors', advanced ? 'bg-background text-foreground font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}
							>
								Advanced
							</button>
						</div>
						{/* Account — only when the sidebar (which carries the user
						    menu) is hidden, so we never show two account entries. */}
						{simple && sidebarHidden && (
							<div ref={acctRef} className="relative">
								<button
									onClick={() => setAcctOpen((o) => !o)}
									title={user?.username || 'Account'}
									className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold"
								>
									{(user?.username || user?.email || '?').slice(0, 1).toUpperCase()}
								</button>
								{acctOpen && (
									<div className="absolute right-0 mt-1.5 w-44 rounded-lg border border-border bg-popover shadow-lg py-1 z-20 text-sm">
										<button onClick={() => { setAcctOpen(false); navigate('/studio/settings'); }} className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2">
											<Settings className="w-3.5 h-3.5" /> Settings
										</button>
										<button onClick={onLogout} className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-muted-foreground">
											<LogOut className="w-3.5 h-3.5" /> Sign out
										</button>
									</div>
								)}
							</div>
						)}
					</div>
				</header>

				{/* Workspace. /studio = the chat as the main surface (claude.ai
				    layout): a flex column pinned to the viewport so the
				    transcript scrolls internally and the composer stays low. */}
				<main className={cn(
					'flex-1 w-full',
					chatHome
						? 'flex flex-col min-h-0 px-6 pb-4'  // centered chat home (unchanged main page)
						: fullBleed
							? 'flex flex-col min-h-0'        // full-bleed; the panels own padding
							: cn('px-6 py-6', !wideMain && 'max-w-5xl'),
				)}>
					<ErrorBoundary resetKey={location.pathname}>
						<Outlet />
					</ErrorBoundary>
				</main>
			</div>

			{/* Artifact panel was a left-rail drawer here, but it
			    moved into the chat header right group on 2026-05-29
			    (see StudioChat.tsx::ArtifactIconButton). Removed
			    from the layout so the workspace reclaims the width. */}

			{/* Mouse-picker overlay (no-op until armed). Mounted here
			    so it can layer above the workspace + chat. */}
			<StudioPicker />
		</div>
		</EnterpriseTipProvider>
		</LanguageProvider>
	);
}

export default StudioShell;
