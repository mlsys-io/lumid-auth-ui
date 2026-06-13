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
import {
	Boxes,
	CirclePlus,
	Store,
	Compass,
	Settings,
	Shield,
	LogOut,
	ChevronDown,
	Key,
	ListChecks,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import { me } from '@/api/me';
import { useAppNav, iconFor } from './useAppNav';
import { useStudioRefetch } from '@/hooks/useStudioRefetch';
import { appTitle } from '@/components/workflow/AppCard';
import { fireAsk } from '@/components/studio/IndexList';
import { askApp } from '@/lib/grounded-asks';
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
	{ to: '/studio/apps',    label: 'Apps',    icon: Boxes, title: 'your apps + anything needing attention' },
	{ to: '/studio/library', label: 'Library', icon: Store, title: 'marketplace, skills, and experiments' },
];
// Activity + Inbox folded into Home's status bar (the "runs today" and
// "inbox" chips link there; the top-strip drafts pill covers other
// pages). My Jobs is the quieter destination below the fold.
const SECONDARY_NAV: NavItem[] = [
	{ to: '/studio/runs', label: 'Jobs', icon: ListChecks, title: 'your recent runs — open any to ask about it' },
];
function NavItemView({ to, label, icon: Icon, end, badge, title }: NavItem) {
	return (
		<NavLink
			to={to}
			end={end}
			title={title}
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
							className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold tabular-nums"
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
		<div className="mt-4 mb-1 px-3 text-[11px] font-medium text-foreground/45">
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
	const { width: sidebarWidth, resizing, startResize, reset: resetSidebar } = useSidebarWidth();
	// App-driven nav: installed apps that declare ui.sidebar, grouped by section.
	const appNav = useAppNav();
	const location = useLocation();
	// Hosted /dashboard pages, app surfaces, and management need full width
	// (admin tables, dataset explorers); core Studio pages stay narrow.
	const chatHome = location.pathname === '/studio';
	const wideMain = location.pathname.startsWith('/dashboard')
		|| location.pathname.startsWith('/studio/a/')
		|| location.pathname.startsWith('/studio/manage')
		// App detail hosts the pipeline canvas + master-detail panel —
		// the narrow column left a dead gutter beside the chat rail.
		|| /^\/studio\/apps\/[^/]+/.test(location.pathname);
	// Bridge lum.id → Runmesh auth store (numeric sys_user.user_id) for the
	// ported Runmesh admin pages now hosted in this shell. Ported from AppLayout.
	const setRunmeshUser = useAuthStore((s) => s.setUser);
	useEffect(() => {
		// Only admins reach the ported Runmesh pages that need the numeric-id
		// bridge — skip the /runmesh profile fetch for everyone else.
		if (!user || !isAdmin) return;
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
	}, [user, isAdmin, setRunmeshUser]);

	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

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

	// Recents — claude.ai-style plain-text list of the most recently
	// active apps (max last_run_ts across each app's workflows).
	const [recents, setRecents] = useState<Array<{ app: string; label: string }>>([]);
	const tickRecents = useCallback(() => {
		me.listWorkflows()
			.then((r) => {
				const latest = new Map<string, number>();
				for (const w of r.workflows || []) {
					if (!w.app || !(w.tenant || w.showcase)) continue;
					latest.set(w.app, Math.max(latest.get(w.app) || 0, w.last_run_ts || 0));
				}
				const top = [...latest.entries()]
					.filter(([, ts]) => ts > 0)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 5)
					.map(([app]) => ({ app, label: appTitle(app) }));
				setRecents(top);
			})
			.catch(() => { /* list just stays as-is */ });
	}, []);
	useEffect(() => {
		tickRecents();
		const id = window.setInterval(tickRecents, 60_000);
		return () => window.clearInterval(id);
	}, [tickRecents]);
	useStudioRefetch(["workflows", "runs", "apps"], tickRecents);
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

	// studio:ask bridge — the chat only mounts at /studio now, so asks
	// fired from other pages stash their detail and navigate; StudioChat
	// consumes the stash on mount. When already on /studio, the chat's
	// own listener handles the event directly.
	useEffect(() => {
		const onAsk = (e: Event) => {
			if (window.location.pathname === '/studio') return;
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
			<aside
				data-studio-picker-chrome="1"
				style={{ width: sidebarWidth }}
				className="relative flex flex-col h-screen flex-shrink-0 bg-sidebar border-r border-sidebar-border sticky top-0"
			>
				<Link to="/studio" className="px-4 py-4 flex items-baseline">
					<span className="font-display text-[18px] font-semibold tracking-tight text-foreground">Lumid Studio</span>
				</Link>

				<nav className="flex-1 overflow-y-auto px-2 py-3 space-y-px">
					{/* Primary action — a quiet claude-style row, not a button. */}
					<button
						onClick={newChat}
						className="w-full mb-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-black/[0.04] transition-colors"
					>
						<CirclePlus className="w-4 h-4 text-foreground/55" /> New chat
					</button>
					{TOP_NAV.map((item) => <NavItemView key={item.to} {...item} />)}
					{SECONDARY_NAV.map((item) => (
					<NavItemView key={item.to} {...item} />
				))}
					{/* App-contributed sections — installed xpio apps that declare
					    ui.sidebar appear here, grouped by section. Data-driven via
					    useAppNav(); soft-fails to nothing if /me/apps is unreachable. */}
					{appNav.map((sec) => (
						<div key={sec.section}>
							<SectionLabel>{sec.section}</SectionLabel>
							{sec.items.map((it) => (
								<NavItemView
									key={it.app}
									to={`/studio/a/${encodeURIComponent(it.app)}`}
									label={it.label}
									icon={iconFor(it.icon)}
									badge={it.badge_source === 'drafts' ? draftCount : undefined}
								/>
							))}
						</div>
					))}
					{recents.length > 0 && (
						<div>
							<SectionLabel>Your apps</SectionLabel>
							{recents.map((r) => (
								// Recents open the grounded chat (the conversational
								// interface), honoring the landing preference — not the
								// dense observability dashboard, which stays a "details →"
								// click away on the Apps index.
								<button
									key={r.app}
									onClick={() => fireAsk(askApp(r.app))}
									className="w-full text-left block px-3 py-1.5 rounded-lg text-[13px] text-foreground/60 hover:bg-black/[0.04] hover:text-foreground truncate transition-colors"
								>
									{r.label}
								</button>
							))}
						</div>
					)}
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
								<div className="text-[10px] text-foreground/50 truncate">
									{user?.role === 'super_admin' ? 'super admin' : 'admin'}
								</div>
							) : (
								<div className="text-[10px] text-foreground/40 truncate">{user?.email}</div>
							)}
						</div>
						<ChevronDown className={[
							'w-3.5 h-3.5 text-slate-400 transition-transform flex-shrink-0',
							menuOpen ? 'rotate-180' : '',
						].join(' ')} />
					</button>

					{menuOpen && (
						<div className="absolute left-3 right-3 bottom-full mb-1 rounded-xl border border-border bg-card shadow-lg py-1 z-30">
							<Link to="/studio/settings"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-muted">
								<Settings className="w-3.5 h-3.5 text-slate-500" />
								Settings
							</Link>
							<Link to="/studio/account/tokens"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-muted">
								<Key className="w-3.5 h-3.5 text-slate-500" />
								API tokens
							</Link>
							{isAdmin && (
								<Link to="/studio/manage"
									onClick={() => setMenuOpen(false)}
									className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-muted">
									<Shield className="w-3.5 h-3.5 text-slate-500" />
									Management
								</Link>
							)}
							<button
								onClick={onLogout}
								className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 border-t border-slate-100 mt-1 pt-2">
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

			{/* Main column ─────────────────────────────────────────── */}
			{/* On the chat route the column is locked to the viewport height
			    (overflow-hidden) so the composer pins to the SCREEN bottom and
			    only the transcript scrolls — never the page. Other routes keep
			    the natural min-h-screen growth + body scroll. */}
			<div className={cn('flex-1 flex flex-col min-w-0', chatHome && 'h-screen overflow-hidden')}>
				{/* Top bar — page header lives in TopStatusStrip; account
				    surfaces moved to the sidebar user menu. */}
				<header data-studio-picker-chrome="1" className="min-h-[64px] py-2.5 bg-background/85 backdrop-blur-md border-b border-border sticky top-0 z-10 flex items-center px-6 gap-4">
					<TopStatusStrip />
				</header>

				{/* Workspace. /studio = the chat as the main surface (claude.ai
				    layout): a flex column pinned to the viewport so the
				    transcript scrolls internally and the composer stays low. */}
				<main className={cn(
					'flex-1 w-full',
					chatHome
						? 'flex flex-col min-h-0 px-6 pb-4'
						: cn('px-6 py-6', !wideMain && 'max-w-5xl'),
				)}>
					<Outlet />
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
