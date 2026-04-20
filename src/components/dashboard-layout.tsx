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
	{ name: 'Analytics', url: 'https://analytics.lumid.market/dashboard', icon: BarChart3 },
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
				`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
					isActive
						? 'bg-indigo-100 text-indigo-700 font-medium'
						: 'text-muted-foreground hover:bg-indigo-50 hover:text-indigo-700'
				}`
			}
		>
			<Icon className="w-4 h-4" />
			<span>{label}</span>
		</NavLink>
	);
}

function Breadcrumb({ pathname }: { pathname: string }) {
	// Only render for admin routes. Parts = segments after /dashboard/admin.
	if (!pathname.startsWith('/dashboard/admin')) return null;
	const segments = pathname.replace(/^\/dashboard\/admin\/?/, '').split('/').filter(Boolean);
	if (segments.length === 0) return null;
	const labels = segments.map((s) => s.replace(/-/g, ' '));
	return (
		<div className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
			<span>Dashboard</span>
			<ChevronRight className="w-3 h-3" />
			<span className="text-indigo-700 font-medium">Admin</span>
			{labels.map((label, i) => (
				<span key={i} className="flex items-center gap-1.5">
					<ChevronRight className="w-3 h-3" />
					<span className="capitalize">{label}</span>
				</span>
			))}
		</div>
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
		<aside className="w-64 shrink-0 flex flex-col bg-white/80 backdrop-blur-sm border-r border-slate-200/60">
			{/* Brand */}
			<div className="p-4 border-b border-slate-200/60">
				<div className="flex items-center gap-2">
					<div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-md shadow-sm">
						<BrainCircuit className="w-5 h-5 text-white" />
					</div>
					<span className="font-semibold text-sm">lum.id</span>
				</div>
			</div>

			{/* Nav */}
			<nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
				<div className="space-y-0.5">
					{ACCOUNT_NAV.map((item) => (
						<SidebarItem key={item.to} {...item} onClick={close} />
					))}
				</div>

				{isAdmin && (
					<>
						<div className="pt-4 pb-1 px-3 flex items-center gap-1.5">
							<Shield className="w-3 h-3 text-indigo-600" />
							<span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
								Administration
							</span>
						</div>
						<div className="space-y-0.5">
							{ADMIN_NAV.map((item) => (
								<SidebarItem key={item.to} {...item} onClick={close} />
							))}
						</div>
						<div className="pt-3 pb-1 px-3">
							<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
								Runmesh
							</span>
						</div>
						<div className="space-y-0.5">
							{RUNMESH_ADMIN_NAV.map((item) => (
								<SidebarItem key={item.to} {...item} onClick={close} />
							))}
						</div>
					</>
				)}

				<div className="pt-4 pb-1 px-3">
					<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
						Apps
					</span>
				</div>
				<div className="space-y-0.5">
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
								className="flex items-center gap-2 px-3 py-2 text-sm rounded-md text-muted-foreground hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
							>
								<Icon className="w-4 h-4" />
								<span className="flex-1">{app.name}</span>
								<ExternalLink className="w-3 h-3 opacity-60" />
							</a>
						);
					})}
				</div>
			</nav>

			{/* User footer */}
			<div className="p-3 border-t border-slate-200/60">
				<div className="flex items-center gap-2 px-2 py-2 mb-2">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-1.5">
							<span className="text-sm font-medium truncate">
								{user?.username || user?.email?.split('@')[0] || 'there'}
							</span>
							{roleChip}
						</div>
						<p className="text-xs text-muted-foreground truncate">{user?.email}</p>
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-start"
					onClick={async () => {
						await logout();
						navigate('/auth/login');
					}}
				>
					<LogOut className="w-4 h-4 mr-2" />
					Sign out
				</Button>
			</div>
		</aside>
	);

	return (
		<LanguageProvider>
			<div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
				{/* Mobile top bar */}
				<header className="md:hidden bg-white/80 backdrop-blur-sm border-b border-slate-200/60 flex items-center gap-2 px-4 py-2 sticky top-0 z-30">
					<Button variant="ghost" size="sm" onClick={() => setMobileOpen(true)}>
						<Menu className="w-4 h-4" />
					</Button>
					<div className="flex items-center gap-2">
						<BrainCircuit className="w-4 h-4 text-indigo-600" />
						<span className="font-semibold text-sm">lum.id</span>
					</div>
					<div className="ml-auto">{roleChip}</div>
				</header>

				{/* Mobile drawer */}
				{mobileOpen && (
					<div className="md:hidden fixed inset-0 z-40 flex" onClick={close}>
						<div className="absolute inset-0 bg-black/30" />
						<div className="relative z-10 flex" onClick={(e) => e.stopPropagation()}>
							{sidebar}
							<Button
								variant="ghost"
								size="sm"
								className="absolute top-3 right-[-40px] text-white"
								onClick={close}
							>
								<X className="w-5 h-5" />
							</Button>
						</div>
					</div>
				)}

				<div className="flex">
					<div className="hidden md:flex sticky top-0 h-screen">{sidebar}</div>

					<main className="flex-1 min-w-0">
						<div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
							<Breadcrumb pathname={location.pathname} />
							<div
								className={
									isAdminRoute
										? 'rounded-lg bg-white/80 backdrop-blur-sm border-l-[3px] border-l-indigo-500 border-t border-r border-b border-slate-200/60 shadow-sm p-4 sm:p-6'
										: 'rounded-lg bg-white/80 backdrop-blur-sm border border-slate-200/60 shadow-sm p-4 sm:p-6'
								}
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
