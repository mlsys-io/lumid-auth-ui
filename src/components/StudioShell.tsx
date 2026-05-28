// Lumid Studio shell — the unified workspace.
//
// One left nav, one top bar, one design language. Replaces the
// fragmented /app/* and /dashboard/* dual-shell pattern over time.
// Lives at /studio/* (path-based, see studio-plan.md decision S1).
//
// The Outlet renders the active workspace. Each workspace is a
// regular page component that just trusts it's inside this shell —
// no per-page nav reimplementation.

import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
	Sparkles,
	Inbox,
	Store,
	Workflow as WorkflowIcon,
	Brain,
	Settings,
	Shield,
	LogOut,
	ChevronDown,
	Hexagon,
	Key,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
// Phase S6a — persistent chat sidebar. AI is the primary interface
// for Studio; webforms in the main workspace area become the
// precision channel beside it.
import { StudioChat } from './StudioChat';
// Top-bar status strip — page title + live activity pills (drafts,
// running, failing). Fills the gap left by removing the redundant
// "Ask anything" search input.
import TopStatusStrip from './TopStatusStrip';

interface NavItem {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	end?: boolean;
}

// Sidebar layout (post-consolidation, 2026-05-25):
//   Today / Inbox         — surfaces the user lives in.
//   ── Personal AI ──
//   Workflows             — apps + workflows + runs + mind, unified.
//                           Lenses: Live · All · Runs · Available. Rows
//                           group by their parent app (collapsible).
//   Marketplace           — Browse skills/workflows + Knowledge tab.
//   ── Settings + Admin ── (pinned bottom)
//
// Previously 5 items under Personal AI (Workflows / Runs / Skills /
// Knowledge / Mind). Runs folded into Workflows as a lens; Mind folded
// into the workflow detail panel as a tab; Skills + Knowledge merged
// into Marketplace as tabs. Old paths redirect for back-compat.
const TOP_NAV: NavItem[] = [
	{ to: '/studio/intents',   label: 'Intents',   icon: Sparkles, end: true },
	{ to: '/studio/inbox',     label: 'Inbox',     icon: Inbox },
];
const PERSONAL_AI_NAV: NavItem[] = [
	{ to: '/studio/workflows', label: 'Workflows', icon: WorkflowIcon },
	{ to: '/studio/knowledge', label: 'Knowledge', icon: Brain },
	{ to: '/studio/library',   label: 'Library',   icon: Store },
];
const SECONDARY_NAV: NavItem[] = [
	{ to: '/studio/settings',  label: 'Settings',  icon: Settings },
];

function NavItemView({ to, label, icon: Icon, end }: NavItem) {
	return (
		<NavLink
			to={to}
			end={end}
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
				</>
			)}
		</NavLink>
	);
}

export function StudioShell() {
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
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

	return (
		<div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 flex">
			{/* Sidebar ─────────────────────────────────────────────── */}
			<aside className="w-56 flex flex-col h-screen bg-white/70 backdrop-blur-sm border-r border-slate-200/70 sticky top-0">
				<Link to="/studio" className="px-4 py-4 border-b border-slate-200/60 flex items-center gap-2.5 hover:bg-slate-50/50 transition-colors">
					<div className="relative">
						<div className="absolute inset-0 bg-emerald-400/30 blur-md rounded-full" />
						<Hexagon className="relative w-5 h-5 text-emerald-600 fill-emerald-50" strokeWidth={1.5} />
					</div>
					<span className="font-semibold text-[15px] tracking-tight text-slate-900">Lumid Studio</span>
				</Link>

				<nav className="flex-1 overflow-y-auto px-2 py-3 space-y-px">
					{TOP_NAV.map((item) => <NavItemView key={item.to} {...item} />)}

					{/* Personal AI section — the three verbs (Create + Manage
					    + Improve) live here. Mind page lands in W4. */}
					<div className="mt-4 mb-1 px-3 flex items-center gap-2">
						<div className="flex-1 h-px bg-slate-200/60" />
						<span className="text-[10px] uppercase tracking-[0.08em] text-slate-400 font-semibold">
							Personal AI
						</span>
						<div className="flex-1 h-px bg-slate-200/60" />
					</div>
					{PERSONAL_AI_NAV.map((item) => <NavItemView key={item.to} {...item} />)}

					<div className="my-3 border-t border-slate-200/60" />

					{SECONDARY_NAV.map((item) => <NavItemView key={item.to} {...item} />)}
				</nav>

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
							<Link to="/dashboard/tokens"
								onClick={() => setMenuOpen(false)}
								className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
								<Key className="w-3.5 h-3.5 text-slate-500" />
								API tokens
							</Link>
							{isAdmin && (
								<Link to="/studio/admin"
									onClick={() => setMenuOpen(false)}
									className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
									<Shield className="w-3.5 h-3.5 text-slate-500" />
									Admin
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
			</aside>

			{/* Main column ─────────────────────────────────────────── */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Top bar — page header lives in TopStatusStrip; account
				    surfaces moved to the sidebar user menu. */}
				<header className="min-h-[64px] py-2.5 bg-white/70 backdrop-blur-md border-b border-slate-200/70 sticky top-0 z-10 flex items-center px-6 gap-4">
					<TopStatusStrip />
				</header>

				{/* Workspace */}
				<main className="flex-1 px-6 py-6 max-w-5xl w-full">
					<Outlet />
				</main>
			</div>

			{/* Phase S6a — AI chat lives here, sticky to the right.
			    Collapses to a thin rail; the user toggles. Inside,
			    StudioChat uses location to give the agent context
			    about the page the user is on. */}
			<StudioChat />
		</div>
	);
}

export default StudioShell;
