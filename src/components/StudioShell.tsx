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
	Wrench,
	Layers,
	Brain,
	Settings,
	Shield,
	LogOut,
	Search,
	ChevronDown,
	Hexagon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
// Phase S6a — persistent chat sidebar. AI is the primary interface
// for Studio; webforms in the main workspace area become the
// precision channel beside it.
import { StudioChat } from './StudioChat';

interface NavItem {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	end?: boolean;
}

// Six workspaces. Admin is conditional on role; pinned at the bottom
// of the nav per the studio plan.
const PRIMARY_NAV: NavItem[] = [
	{ to: '/studio/today',     label: 'Today',     icon: Sparkles, end: true },
	{ to: '/studio/inbox',     label: 'Inbox',     icon: Inbox },
	{ to: '/studio/skills',    label: 'Skills',    icon: Wrench },
	{ to: '/studio/apps',      label: 'Apps',      icon: Layers },
	{ to: '/studio/knowledge', label: 'Knowledge', icon: Brain },
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
					'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
					isActive
						? 'bg-emerald-50 text-emerald-900 font-medium'
						: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
				)
			}
		>
			<Icon className="w-4 h-4 flex-shrink-0" />
			<span>{label}</span>
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
		<div className="min-h-screen bg-slate-50 flex">
			{/* Sidebar ─────────────────────────────────────────────── */}
			<aside className="w-56 flex flex-col h-screen bg-white border-r border-slate-200 sticky top-0">
				<Link to="/studio" className="px-4 py-3.5 border-b border-slate-200/60 flex items-center gap-2">
					<Hexagon className="w-5 h-5 text-emerald-600 fill-emerald-50" strokeWidth={1.5} />
					<span className="font-semibold text-[15px] tracking-tight">Lumid Studio</span>
				</Link>

				<nav className="flex-1 overflow-y-auto px-2 py-3 space-y-px">
					{PRIMARY_NAV.map((item) => <NavItemView key={item.to} {...item} />)}

					<div className="my-3 border-t border-slate-200/60" />

					{SECONDARY_NAV.map((item) => <NavItemView key={item.to} {...item} />)}
					{isAdmin && (
						<NavItemView to="/studio/admin" label="Admin" icon={Shield} />
					)}
				</nav>

				{/* User badge — collapsed; the avatar menu in top-bar
				    handles full controls. Surfaces here so the user
				    sees who they're signed in as at a glance. */}
				<div className="p-3 border-t border-slate-200/60">
					<div className="px-1 flex items-center gap-2 min-w-0">
						<div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
							{(user?.email?.[0] || '?').toUpperCase()}
						</div>
						<div className="flex-1 min-w-0">
							<div className="text-[12px] font-medium truncate">
								{user?.username || user?.email?.split('@')[0] || 'there'}
							</div>
							{isAdmin && (
								<div className="text-[10px] uppercase tracking-wide text-emerald-700">
									{user?.role === 'super_admin' ? 'super' : 'admin'}
								</div>
							)}
						</div>
					</div>
				</div>
			</aside>

			{/* Main column ─────────────────────────────────────────── */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Top bar */}
				<header className="h-14 bg-white border-b border-slate-200 sticky top-0 z-10 flex items-center px-6 gap-4">
					<div className="flex-1 max-w-md relative">
						<Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
						<input
							type="search"
							placeholder="Search apps, skills, memories…"
							className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400"
							// Search wiring is Phase S3; placeholder for now.
						/>
					</div>

					<div ref={menuRef} className="relative">
						<button
							onClick={() => setMenuOpen((v) => !v)}
							className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-slate-100 transition-colors"
						>
							<div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-semibold">
								{(user?.email?.[0] || '?').toUpperCase()}
							</div>
							<ChevronDown className="w-4 h-4 text-slate-500" />
						</button>
						{menuOpen && (
							<div className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white shadow-lg py-1 z-20">
								<div className="px-3 py-2 border-b border-slate-100">
									<div className="text-sm font-medium truncate">{user?.email}</div>
									<div className="text-[11px] text-slate-500 mt-0.5">{user?.role}</div>
								</div>
								<Link to="/studio/settings"
									onClick={() => setMenuOpen(false)}
									className="block px-3 py-2 text-sm hover:bg-slate-50">Settings</Link>
								<Link to="/dashboard/tokens"
									onClick={() => setMenuOpen(false)}
									className="block px-3 py-2 text-sm hover:bg-slate-50">API tokens</Link>
								<button
									onClick={onLogout}
									className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-rose-700 inline-flex items-center gap-2 border-t border-slate-100 mt-1 pt-2">
									<LogOut className="w-3.5 h-3.5" /> Sign out
								</button>
							</div>
						)}
					</div>
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
