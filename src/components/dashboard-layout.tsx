import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
	BrainCircuit,
	LayoutDashboard,
	User as UserIcon,
	Key,
	Terminal,
	Shield,
	Ticket,
	Users,
	Server,
	Receipt,
	ClipboardCheck,
	ExternalLink,
	LogOut,
	BarChart3,
	TrendingUp,
	Workflow,
	Database,
	ChevronRight,
	Menu,
	X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LanguageProvider } from '../runmesh/i18n';
import { Button } from './ui/button';

// Unified sidebar + content shell for every authenticated surface.
// Replaces both the old card-grid dashboard and the RunmeshAdminLayout.
// Every /dashboard/* route renders inside this shell — the sidebar is
// the only nav; the content pane lives in <Outlet/>.
//
// Role distinction is baked into the visual design:
//   * a chip next to the user name reads `user` (slate) or `admin` (indigo)
//   * the admin section only appears when role=admin
//   * admin content pages render with an indigo left-accent border
//   * a breadcrumb above the content surfaces the admin scope explicitly
//
// <LanguageProvider> wraps everything so the Runmesh-ported pages'
// useLanguage/t() helpers keep working; non-Runmesh pages ignore it.

interface NavItem {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	end?: boolean;
}

const ACCOUNT_NAV: NavItem[] = [
	{ to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
	{ to: '/dashboard/profile', label: 'Profile', icon: UserIcon },
	{ to: '/dashboard/tokens', label: 'Access Tokens', icon: Key },
	{ to: '/dashboard/connect', label: 'Install LumidOS', icon: Terminal },
];

const ADMIN_NAV: NavItem[] = [
	{ to: '/dashboard/admin/invitations', label: 'Invitation codes', icon: Ticket },
];

// Admin-only external links — Umami's analytics dashboard is a
// per-site operator tool, not an end-user ecosystem app, so it
// belongs next to the other admin surfaces rather than in the
// public Apps launcher.
const ADMIN_EXTERNAL: { name: string; url: string; icon: React.ComponentType<{ className?: string }> }[] = [
	{ name: 'Analytics', url: 'https://analytics.lum.id/dashboard', icon: BarChart3 },
];

const RUNMESH_ADMIN_NAV: NavItem[] = [
	{ to: '/dashboard/admin/runmesh/dashboard', label: 'Dashboard', icon: LayoutDashboard },
	{ to: '/dashboard/admin/runmesh/users', label: 'Users', icon: Users },
	{ to: '/dashboard/admin/runmesh/nodes', label: 'Nodes', icon: Server },
	{ to: '/dashboard/admin/runmesh/suppliers', label: 'Suppliers', icon: Server },
	{ to: '/dashboard/admin/runmesh/supplier-nodes', label: 'Supplier nodes', icon: Server },
	{ to: '/dashboard/admin/runmesh/billing', label: 'Billing', icon: Receipt },
	{ to: '/dashboard/admin/runmesh/workflow-review', label: 'Reviews', icon: ClipboardCheck },
];

interface AppEntry {
	name: string;
	url: string;
	icon: React.ComponentType<{ className?: string }>;
}

const APPS: AppEntry[] = [
	{ name: 'QuantArena', url: 'https://lumid.market/backend/api/v1/auth/lumid-sso/start?return_to=/strategy', icon: TrendingUp },
	{ name: 'Runmesh', url: 'https://runmesh.ai/', icon: Workflow },
	{ name: 'Lumilake', url: 'https://lumilake.ai/sso/lumid', icon: Database },
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

function SectionLabel({ icon: Icon, label, accent }: { icon?: React.ComponentType<{ className?: string }>; label: string; accent?: boolean }) {
	return (
		<div className="mt-4 mb-1 px-2.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
			{Icon && <Icon className={`w-3 h-3 ${accent ? 'text-indigo-600' : 'text-slate-400'}`} />}
			<span className={accent ? 'text-indigo-700' : 'text-slate-500'}>{label}</span>
			<div className={`flex-1 h-px ml-1.5 ${accent ? 'bg-indigo-200/70' : 'bg-slate-200'}`} />
		</div>
	);
}

const TITLE_CASE = (s: string) =>
	s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function Breadcrumb({ pathname }: { pathname: string }) {
	// Only render for admin routes. Parts = segments after /dashboard/admin.
	if (!pathname.startsWith('/dashboard/admin')) return null;
	const segments = pathname.replace(/^\/dashboard\/admin\/?/, '').split('/').filter(Boolean);
	if (segments.length === 0) return null;
	return (
		<nav className="text-xs text-slate-500 mb-4 flex items-center gap-1.5 flex-wrap" aria-label="Breadcrumb">
			<span>Dashboard</span>
			<ChevronRight className="w-3 h-3 opacity-60" />
			<span className="text-indigo-700 font-medium">Admin</span>
			{segments.map((seg, i) => (
				<span key={i} className="flex items-center gap-1.5">
					<ChevronRight className="w-3 h-3 opacity-60" />
					<span className={i === segments.length - 1 ? 'text-slate-900 font-medium' : ''}>
						{TITLE_CASE(seg)}
					</span>
				</span>
			))}
		</nav>
	);
}

export default function DashboardLayout() {
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	const [mobileOpen, setMobileOpen] = useState(false);

	const isAdmin = user?.role === 'admin';
	const isAdminRoute = location.pathname.startsWith('/dashboard/admin');

	const roleChip = isAdmin ? (
		<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide bg-indigo-100 text-indigo-700">
			<Shield className="w-3 h-3" />
			admin
		</span>
	) : (
		<span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide bg-slate-100 text-slate-600">
			user
		</span>
	);

	const close = () => setMobileOpen(false);

	const sidebar = (
		<aside className="w-60 shrink-0 flex flex-col bg-white/90 backdrop-blur-sm border-r border-slate-200/60 h-full">
			{/* Brand + mobile close */}
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
				<SectionLabel label="Account" />
				<div className="space-y-px">
					{ACCOUNT_NAV.map((item) => (
						<SidebarItem key={item.to} {...item} onClick={close} />
					))}
				</div>

				{isAdmin && (
					<>
						<SectionLabel icon={Shield} label="Administration" accent />
						<div className="space-y-px">
							{ADMIN_NAV.map((item) => (
								<SidebarItem key={item.to} {...item} onClick={close} />
							))}
							{ADMIN_EXTERNAL.map((app) => {
								const Icon = app.icon;
								return (
									<a
										key={app.name}
										href={app.url}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
									>
										<Icon className="w-4 h-4 shrink-0" />
										<span className="truncate flex-1">{app.name}</span>
										<ExternalLink className="w-3 h-3 opacity-50" />
									</a>
								);
							})}
						</div>
						<SectionLabel label="Runmesh" />
						<div className="space-y-px">
							{RUNMESH_ADMIN_NAV.map((item) => (
								<SidebarItem key={item.to} {...item} onClick={close} />
							))}
						</div>
					</>
				)}

				<SectionLabel label="Apps" />
				<div className="space-y-px">
					{APPS.map((app) => {
						const Icon = app.icon;
						const href =
							app.name === 'Lumilake' && user?.email
								? `${app.url}?email=${encodeURIComponent(user.email)}${
										user.username ? `&name=${encodeURIComponent(user.username)}` : ''
								  }`
								: app.url;
						return (
							<a
								key={app.name}
								href={href}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
							>
								<Icon className="w-4 h-4 shrink-0" />
								<span className="truncate flex-1">{app.name}</span>
								<ExternalLink className="w-3 h-3 opacity-50" />
							</a>
						);
					})}
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
							{roleChip}
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

	// Runmesh admin pages bring their own Card + filter UI; stacking
	// our outer-card padding on top creates visible card-in-card
	// nesting. Drop the inner padding for Runmesh routes but keep
	// the indigo left-accent so the admin-mode cue stays.
	const isRunmeshRoute = location.pathname.startsWith('/dashboard/admin/runmesh');

	return (
		<LanguageProvider>
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
					<div className="ml-auto">{roleChip}</div>
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

				{/* Canvas: sidebar + content travel together, capped at
				    max-w-7xl (1280px) and centered. On ultra-wide
				    screens the page has symmetric breathing room on
				    both sides instead of the sidebar stuck to the far
				    left edge with dead space on the right. */}
				<div className="max-w-7xl mx-auto flex">
					<div className="hidden md:flex sticky top-0 h-screen">{sidebar}</div>

					<main className="flex-1 min-w-0">
						<div className="px-4 py-5 sm:px-6 sm:py-6">
							<Breadcrumb pathname={location.pathname} />
							<div
								className={[
									'rounded-lg bg-white shadow-sm border-slate-200',
									isAdminRoute
										? 'border-l-[3px] border-l-indigo-500 border-y border-r'
										: 'border',
									isRunmeshRoute ? 'p-0 overflow-hidden' : 'p-4 sm:p-6',
								].join(' ')}
							>
								<Outlet />
							</div>
						</div>
					</main>
				</div>
			</div>
		</LanguageProvider>
	);
}
