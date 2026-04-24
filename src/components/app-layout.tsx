import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
	BrainCircuit,
	Blocks,
	Workflow,
	ListChecks,
	CreditCard,
	User as UserIcon,
	LogOut,
	Menu,
	X,
	ExternalLink,
	Calendar,
	FileCode,
	Server,
	Shield,
	LayoutDashboard,
	Users,
	Receipt,
	ClipboardCheck,
	Ticket,
	Database,
	Code,
	Sparkles,
	Tag,
	PlayCircle,
	SquareTerminal,
	Trophy,
	LineChart,
	Layers,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LanguageProvider } from '../runmesh/i18n';
import { EnterpriseTipProvider } from '../runmesh/components/EnterpriseTip';
import { useAuthStore } from '../runmesh/stores/useAuthStore';
import { httpUser } from '../runmesh/utils/axios';
import { useEffect } from 'react';
import { Button } from './ui/button';

// Product-surface shell. Every /app/* route renders here. Sibling of
// DashboardLayout — same container, same AuthGuard, different sidebar
// and purpose. DashboardLayout is identity (profile, tokens, admin);
// AppLayout is product (apps, workflows, tasks, billing).
//
// Keeping them separate means:
//   * users see a clean product nav at /app/* without admin clutter
//   * admins still reach all admin tools under /dashboard/admin/*
//   * no breadcrumb noise — product pages are a flat four-nav surface
//
// LanguageProvider wraps the tree because the ported Runmesh pages'
// useLanguage/t() helpers require it; non-Runmesh pages ignore it.

interface NavItem {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	end?: boolean;
}

const PRODUCT_NAV: NavItem[] = [
	{ to: '/app', label: 'Apps', icon: Blocks, end: true },
	{ to: '/app/workflows', label: 'Workflows', icon: Workflow },
	{ to: '/app/tasks', label: 'Tasks', icon: ListChecks },
	{ to: '/app/schedules', label: 'Schedules', icon: Calendar },
	{ to: '/app/gpu-rentals', label: 'GPU rentals', icon: Server },
	{ to: '/app/billing', label: 'Billing', icon: CreditCard },
	{ to: '/app/api-docs', label: 'API docs', icon: FileCode },
];

const LUMILAKE_NAV: NavItem[] = [
	{ to: '/app/lumilake/data', label: 'Data browsing', icon: Database },
	{ to: '/app/lumilake/data-label', label: 'Data label', icon: Tag },
	// SQL + Python workbenches removed from the sidebar 2026-04-24 —
	// underused relative to Low-code / Modelling; the routes still
	// resolve for deep links but the nav is trimmed.
	{ to: '/app/lumilake/low-code', label: 'Low-code', icon: Workflow },
	{ to: '/app/lumilake/modelling', label: 'Modelling', icon: Sparkles },
	{ to: '/app/lumilake/jobs', label: 'Running jobs', icon: PlayCircle },
];

// Consolidated admin nav: 17 flat items collapsed to 5. Each section
// lands on its first sub-page, with the remaining pages shown as tabs
// inside the section (see pages/app/admin-section-layout.tsx). Deep
// links like /app/admin/users/matrix still resolve because the tab
// navigation is URL-based.
const ADMIN_NAV: NavItem[] = [
	{ to: '/app/admin', label: 'Overview', icon: LayoutDashboard, end: true },
	{ to: '/app/admin/users', label: 'People & access', icon: Users },
	{ to: '/app/admin/clusters', label: 'Infrastructure', icon: Layers },
	{ to: '/app/admin/suppliers', label: 'Runmesh ops', icon: Receipt },
	{ to: '/app/admin/competitions', label: 'QuantArena', icon: Trophy },
];

function SidebarItem({ to, label, icon: Icon, end, onClick }: NavItem & { onClick?: () => void }) {
	return (
		<NavLink
			to={to}
			end={end}
			onClick={onClick}
			className={({ isActive }) =>
				`flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-md transition-colors ${
					isActive
						? 'bg-indigo-100 text-indigo-700 font-medium'
						: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
				}`
			}
		>
			<Icon className="w-4 h-4 shrink-0" />
			<span className="truncate">{label}</span>
		</NavLink>
	);
}

function SectionLabel({ label }: { label: string }) {
	return (
		<div className="mt-4 mb-1 px-2.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
			<span className="text-slate-500">{label}</span>
			<div className="flex-1 h-px ml-1.5 bg-slate-200" />
		</div>
	);
}

export default function AppLayout() {
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const [mobileOpen, setMobileOpen] = useState(false);
	const close = () => setMobileOpen(false);
	const isAdmin = user?.role === 'admin';
	const setRunmeshUser = useAuthStore((s) => s.setUser);

	// Bridge lum.id → Runmesh auth store. The ported Runmesh pages
	// (Billing, Stripe/Alipay flow) read user.id from useAuthStore and
	// require a numeric Runmesh sys_user.user_id, not lum.id's UUID.
	// Fetch /runmesh/system/user/profile once on mount — Sa-Token's
	// session is already established via SSO bridge, so this just
	// returns the current user's row.
	useEffect(() => {
		if (!user) return;
		(async () => {
			try {
				const profile = await httpUser.get<any>('/runmesh/system/user/profile');
				const u = profile?.user ?? profile;
				if (u?.userId != null) {
					setRunmeshUser({
						id: u.userId,
						username: u.userName || user.username || '',
						nickname: u.nickName || user.username || '',
						email: u.email || user.email || '',
						role: (user.role as any) || 'user',
					} as any);
				}
			} catch {
				// best-effort — pages that need this data will show their
				// own error state rather than blowing up the whole shell.
			}
		})();
	}, [user, setRunmeshUser]);

	const sidebar = (
		<aside className="w-60 shrink-0 flex flex-col bg-white/90 backdrop-blur-sm border-r border-slate-200/60 h-full">
			{/* Brand */}
			<div className="px-3 py-3 border-b border-slate-200/60 flex items-center gap-2">
				<div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-md shadow-sm">
					<BrainCircuit className="w-4 h-4 text-white" />
				</div>
				<span className="font-semibold text-sm flex-1">lum.id</span>
				<Button
					variant="ghost"
					size="sm"
					className="md:hidden -mr-2 px-2"
					onClick={close}
					aria-label="Close menu"
				>
					<X className="w-4 h-4" />
				</Button>
			</div>

			{/* Nav */}
			<nav className="flex-1 overflow-y-auto px-2 pt-2 pb-4">
				<SectionLabel label="Product" />
				<div className="space-y-px">
					{PRODUCT_NAV.map((item) => (
						<SidebarItem key={item.to} {...item} onClick={close} />
					))}
				</div>

				<SectionLabel label="Lumilake" />
				<div className="space-y-px">
					{LUMILAKE_NAV.map((item) => (
						<SidebarItem key={item.to} {...item} onClick={close} />
					))}
				</div>

				{isAdmin && (
					<>
						<div className="mt-4 mb-1 px-2.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
							<Shield className="w-3 h-3 text-indigo-600" />
							<span className="text-indigo-700">Administration</span>
							<div className="flex-1 h-px ml-1.5 bg-indigo-200/70" />
						</div>
						<div className="space-y-px">
							{ADMIN_NAV.map((item) => (
								<SidebarItem key={item.to} {...item} onClick={close} />
							))}
						</div>
					</>
				)}

				{/* Account surface — product profile + identity cross-nav */}
				<SectionLabel label="Account" />
				<div className="space-y-px">
					<SidebarItem to="/app/profile" label="Profile" icon={UserIcon} onClick={close} />
					<NavLink
						to="/dashboard/profile"
						onClick={close}
						className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
					>
						<UserIcon className="w-4 h-4 shrink-0" />
						<span className="truncate flex-1">Identity & tokens</span>
						<ExternalLink className="w-3 h-3 opacity-50" />
					</NavLink>
				</div>
			</nav>

			{/* User footer */}
			<div className="p-2.5 border-t border-slate-200/60">
				<div className="px-2 pt-1 pb-2 flex items-center gap-1.5 min-w-0">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-1.5">
							<span className="text-[13px] font-medium truncate">
								{user?.username || user?.email?.split('@')[0] || 'there'}
							</span>
							{isAdmin ? (
								<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide bg-indigo-100 text-indigo-700">
									<Shield className="w-3 h-3" />
									admin
								</span>
							) : (
								<span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide bg-slate-100 text-slate-600">
									user
								</span>
							)}
						</div>
						<p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
					</div>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="w-full justify-start text-[13px] bg-white/60"
					onClick={async () => {
						await logout();
						navigate('/auth/login');
					}}
				>
					<LogOut className="w-3.5 h-3.5 mr-2" />
					Sign out
				</Button>
			</div>
		</aside>
	);

	return (
		<LanguageProvider>
			<EnterpriseTipProvider>
			<div className="min-h-screen bg-slate-50">
				{/* Mobile top bar */}
				<header className="md:hidden bg-white/95 backdrop-blur-sm border-b border-slate-200 flex items-center gap-2 px-3 py-2 sticky top-0 z-30">
					<Button variant="ghost" size="sm" onClick={() => setMobileOpen(true)} aria-label="Open menu">
						<Menu className="w-4 h-4" />
					</Button>
					<div className="flex items-center gap-1.5">
						<BrainCircuit className="w-4 h-4 text-indigo-600" />
						<span className="font-semibold text-sm">lum.id</span>
					</div>
				</header>

				{/* Mobile drawer */}
				{mobileOpen && (
					<div className="md:hidden fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
						<button
							type="button"
							className="absolute inset-0 bg-slate-900/40"
							aria-label="Close menu"
							onClick={close}
						/>
						<div className="relative z-10 w-60">{sidebar}</div>
					</div>
				)}

				<div className="max-w-7xl mx-auto flex">
					<div className="hidden md:flex sticky top-0 h-screen">{sidebar}</div>

					<main className="app-main flex-1 min-w-0 bg-slate-50">
						{/* Ported Runmesh + Lumilake pages bring their own
						    Card/header chrome. Wrapping them in an outer
						    Card created a card-in-card nesting with
						    mismatched padding and font sizes. Render the
						    Outlet directly; the .app-main class scopes
						    CSS overrides that normalize typography +
						    background next to the sidebar. */}
						<Outlet />
					</main>
				</div>
			</div>
			</EnterpriseTipProvider>
		</LanguageProvider>
	);
}
