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
	Compass,
	Settings,
	Shield,
	LogOut,
	ChevronDown,
	Key,
	Inbox,
	Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import { me } from '@/api/me';
import { useAppNav, iconFor } from './useAppNav';
import { useStudioRefetch } from '@/hooks/useStudioRefetch';
import { useIsNarrow } from '@/hooks/useIsNarrow';
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
	const isSuperAdmin = user?.role === 'super_admin';
	const { width: sidebarWidth, resizing, startResize, reset: resetSidebar } = useSidebarWidth();
	// App-driven nav: installed apps that declare ui.sidebar, grouped by section.
	const appNav = useAppNav();
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
		|| location.pathname.startsWith('/studio/claude-quota')
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
	// Per-app workspace (/studio/apps/:app): auto-hide the nav so the page reads
	// as just Observe + Chat. Same DERIVED-override philosophy as narrow — it
	// never writes the persisted pref, so the user's global choice survives
	// leaving the workspace; within it the header's expand control reveals the
	// nav for the session (appNavOpen), and it re-hides when switching apps.
	const inAppWorkspace = /^\/studio\/apps\/[^/]+/.test(location.pathname)
		&& location.pathname !== '/studio/apps/all';
	const [appNavOpen, setAppNavOpen] = useState(false);
	useEffect(() => { setAppNavOpen(false); }, [location.pathname]);
	const sidebarHidden = isNarrow ? !narrowNavOpen : (inAppWorkspace ? !appNavOpen : sidebarCollapsed);
	const hideSidebar = () => { if (isNarrow) setNarrowNavOpen(false); else if (inAppWorkspace) setAppNavOpen(false); else setSidebarCollapsed(true); };
	const showSidebar = () => { if (isNarrow) setNarrowNavOpen(true); else if (inAppWorkspace) setAppNavOpen(true); else setSidebarCollapsed(false); };

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
					{/* App-contributed sections — installed xpio apps that declare
					    ui.sidebar appear here, grouped by section. Data-driven via
					    useAppNav(); soft-fails to nothing if /me/apps is unreachable. */}
					{appNav.map((sec) => (
						<div key={sec.section}>
							<SectionLabel>{sec.section}</SectionLabel>
							{sec.items.map((it) => (
								<NavItemView
									key={it.app}
									to={`/studio/apps/${encodeURIComponent(it.app)}`}
									label={it.label}
									icon={iconFor(it.icon)}
									badge={it.badge_source === 'drafts' ? draftCount : undefined}
								/>
							))}
						</div>
					))}
				</nav>

				{/* Docs link — kept apart from the functional nav above so
				    "how it works" reads as reference, not a workspace. */}
				<NavLink
					to="/studio/how"
					className={({ isActive }) => cn(
						'mx-3 mb-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/[0.04]',
						isActive ? 'text-foreground/80' : 'text-foreground/45 hover:text-foreground/70',
					)}
				>
					<Compass className="w-3.5 h-3.5 flex-shrink-0" />
					<span>How it works</span>
				</NavLink>

				{/* Admin-only: internal CD runbook (Lumilake + FlowMesh plugin-image
				    releases). Opens the auth-gated /docs/plugin-image-cd doc in a new
				    tab. Hidden from non-admins; the edge gate (lumid-landing nginx)
				    enforces access server-side regardless. */}
				{isAdmin && (
					<a
						href="/docs/plugin-image-cd"
						target="_blank"
						rel="noreferrer"
						className="mx-3 mb-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-foreground/45 hover:text-foreground/70 hover:bg-black/[0.04]"
						title="Lumilake & FlowMesh plugin-image CD runbook (admin)"
					>
						<Shield className="w-3.5 h-3.5 flex-shrink-0" />
						<span>CD runbook</span>
					</a>
				)}

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
							{isSuperAdmin && (
								<Link to="/studio/claude-quota"
									onClick={() => setMenuOpen(false)}
									className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted">
									<Zap className="w-3.5 h-3.5 text-muted-foreground" />
									Claude quota
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
