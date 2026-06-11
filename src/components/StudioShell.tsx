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
	Plus,
	Inbox,
	Store,
	Compass,
	Settings,
	Shield,
	LogOut,
	ChevronDown,
	Hexagon,
	Key,
	ListChecks,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import { me } from '@/api/me';
import { useAppNav, iconFor } from './useAppNav';
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
import { StudioChat } from './StudioChat';
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
	{ to: '/studio/apps',    label: 'My Apps',  icon: Boxes },
	{ to: '/dashboard/jobs', label: 'My Jobs',  icon: ListChecks, title: 'background runs and compute jobs' },
];
// Workflows fold into each app's overview. Inbox + Knowledge both moved
// into the bottom user menu, leaving My Apps + My Jobs as the top-level
// surfaces. GPU Rentals is now an xpio app (arrives via useAppNav).
const SECONDARY_NAV: NavItem[] = [];
function NavItemView({ to, label, icon: Icon, end, badge, title }: NavItem) {
	return (
		<NavLink
			to={to}
			end={end}
			title={title}
			className={({ isActive }) =>
				cn(
					'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all relative',
					isActive
						? 'bg-gradient-to-r from-emerald-50 to-emerald-50/30 text-emerald-900 font-medium shadow-sm shadow-emerald-100/50'
						: 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
				)
			}
		>
			{({ isActive }) => (
				<>
					{isActive && (
						<span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-emerald-500" />
					)}
					<Icon className={cn(
						'w-4 h-4 flex-shrink-0 transition-colors',
						isActive ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-700',
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
		<div className="mt-3 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
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
	const wideMain = location.pathname.startsWith('/dashboard')
		|| location.pathname.startsWith('/studio/a/')
		|| location.pathname.startsWith('/studio/manage');
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

	// Pending-drafts count → badge on the Inbox nav item. Drafts live in the
	// Inbox surface (moved off the My Apps hero), so the count belongs here.
	const [draftCount, setDraftCount] = useState(0);
	useEffect(() => {
		let live = true;
		const tick = () => me.listDrafts({ state: "pending" })
			.then((r) => { if (live) setDraftCount(r.drafts?.length || 0); })
			.catch(() => { /* soft-fail; badge just stays hidden */ });
		tick();
		const id = window.setInterval(tick, 30_000);
		return () => { live = false; window.clearInterval(id); };
	}, []);
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

	// "+ New app" — launches the GUIDED CONVERSATIONAL create flow in the
	// chat: the AI rolls out the procedure step by step (ask what it should do
	// → compose → present the pipeline clearly → install). Replaces the old
	// ad-hoc modal that pre-filled a fixed "crypto momentum trader". Lands on
	// My Apps so the new app surfaces there once installed, then kicks the chat.
	const newIntent = () => {
		navigate('/studio/apps');
		setTimeout(() => window.dispatchEvent(new CustomEvent('studio:ask', {
			detail: { prompt: 'I want to set up a new app. Ask me what it should do for me, then assemble it step by step.', autosend: true },
		})), 60);
	};

	return (
		<LanguageProvider>
		<EnterpriseTipProvider>
		<div className={cn(
			'min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex',
			resizing && 'select-none cursor-ew-resize',
		)}>
			{/* Sidebar ─────────────────────────────────────────────── */}
			<aside
				data-studio-picker-chrome="1"
				style={{ width: sidebarWidth }}
				className="relative flex flex-col h-screen flex-shrink-0 bg-white/70 backdrop-blur-sm border-r border-slate-200/70 sticky top-0"
			>
				<Link to="/studio" className="px-4 py-4 border-b border-slate-200/60 flex items-center gap-2.5 hover:bg-slate-50/50 transition-colors">
					<div className="relative">
						<div className="absolute inset-0 bg-emerald-400/30 blur-md rounded-full" />
						<Hexagon className="relative w-5 h-5 text-emerald-600 fill-emerald-50" strokeWidth={1.5} />
					</div>
					<span className="font-semibold text-[15px] tracking-tight text-slate-900">Lumid Studio</span>
				</Link>

				<nav className="flex-1 overflow-y-auto px-2 py-3 space-y-px">
					{/* Primary create action — always visible, the streamlined
					    "start a new app" entry. */}
					<button
						onClick={newIntent}
						className="w-full mb-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98] shadow-sm shadow-emerald-200/70 transition-all"
					>
						<Plus className="w-4 h-4" /> New app
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
					{/* Management lives in the bottom user menu (role-gated). */}
					<div className="my-2 mx-3 h-px bg-slate-200/60" />
					{/* Marketplace — in-Studio browse + install (apps/skills/datasets). */}
					<NavItemView to="/studio/marketplace" label="Marketplace" icon={Store} />
				</nav>

				{/* Docs link — kept apart from the functional nav above so
				    "how it works" reads as reference, not a workspace. */}
				<NavLink
					to="/studio/how"
					className={({ isActive }) => cn(
						'mx-3 mb-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors',
						isActive ? 'text-emerald-700' : 'text-slate-400 hover:text-slate-600',
					)}
				>
					<Compass className="w-3.5 h-3.5 flex-shrink-0" />
					<span>How it works</span>
				</NavLink>

				{/* User menu — pinned bottom-left, opens upward. Holds
				    everything the top-right avatar dropdown used to
				    (Settings, API tokens, Admin, Sign out) so account
				    surfaces live in one place. */}
				<div ref={menuRef} className="p-3 border-t border-slate-200/60 relative">
					<button
						onClick={() => setMenuOpen((v) => !v)}
						className={[
							'w-full px-1.5 py-1.5 rounded-lg flex items-center gap-2 min-w-0 transition-colors group',
							menuOpen ? 'bg-slate-100/70' : 'hover:bg-slate-100/70',
						].join(' ')}
						title="Account menu"
					>
						<div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0 shadow-sm shadow-emerald-100">
							{(user?.email?.[0] || '?').toUpperCase()}
						</div>
						<div className="flex-1 min-w-0 text-left">
							<div className="text-[12px] font-medium truncate text-slate-900">
								{user?.username || user?.email?.split('@')[0] || 'there'}
							</div>
							{isAdmin ? (
								<div className="text-[10px] uppercase tracking-wide text-emerald-700 truncate">
									{user?.role === 'super_admin' ? 'super admin' : 'admin'}
								</div>
							) : (
								<div className="text-[10px] text-slate-400 truncate">{user?.email}</div>
							)}
						</div>
						<ChevronDown className={[
							'w-3.5 h-3.5 text-slate-400 transition-transform flex-shrink-0',
							menuOpen ? 'rotate-180' : '',
						].join(' ')} />
					</button>

					{menuOpen && (
						<div className="absolute left-3 right-3 bottom-full mb-1 rounded-lg border border-slate-200 bg-white shadow-lg py-1 z-30">
							<Link to="/studio/settings"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
								<Settings className="w-3.5 h-3.5 text-slate-500" />
								Settings
							</Link>
							<Link to="/studio/account/tokens"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
								<Key className="w-3.5 h-3.5 text-slate-500" />
								API tokens
							</Link>
							{isAdmin && (
								<Link to="/studio/manage"
									onClick={() => setMenuOpen(false)}
									className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
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
						'hover:bg-emerald-200/30 transition-colors',
						resizing && 'bg-emerald-200/40',
					)}
				>
					<span className={cn(
						'absolute right-0 top-0 h-full w-px transition-colors',
						'bg-transparent group-hover/resize:bg-emerald-400',
						resizing && '!bg-emerald-500',
					)} />
				</div>
			</aside>

			{/* Main column ─────────────────────────────────────────── */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Top bar — page header lives in TopStatusStrip; account
				    surfaces moved to the sidebar user menu. */}
				<header data-studio-picker-chrome="1" className="min-h-[64px] py-2.5 bg-white/70 backdrop-blur-md border-b border-slate-200/70 sticky top-0 z-10 flex items-center px-6 gap-4">
					<TopStatusStrip />
				</header>

				{/* Workspace */}
				<main className={cn('flex-1 px-6 py-6 w-full', !wideMain && 'max-w-5xl')}>
					<Outlet />
				</main>
			</div>

			{/* Artifact panel was a left-rail drawer here, but it
			    moved into the chat header right group on 2026-05-29
			    (see StudioChat.tsx::ArtifactIconButton). Removed
			    from the layout so the workspace reclaims the width. */}

			{/* Phase S6a — AI chat lives here, sticky to the right.
			    Collapses to a thin rail; the user toggles. Inside,
			    StudioChat uses location to give the agent context
			    about the page the user is on. */}
			<StudioChat />

			{/* Mouse-picker overlay (no-op until armed). Mounted here
			    so it can layer above the workspace + chat. */}
			<StudioPicker />
		</div>
		</EnterpriseTipProvider>
		</LanguageProvider>
	);
}

export default StudioShell;
