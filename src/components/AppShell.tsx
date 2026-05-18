import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
	Hexagon,
	RefreshCw,
	ShoppingBag,
	Brain,
	BarChart3,
	Settings,
	Shield,
	LogOut,
	Menu,
	X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { LanguageProvider } from '../runmesh/i18n';
import { EnterpriseTipProvider } from '../runmesh/components/EnterpriseTip';

interface NavItem {
	to: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
}

const MAIN_NAV: NavItem[] = [
	{ to: '/app/loops',       label: 'My Loops',       icon: RefreshCw   },
	{ to: '/app/marketplace', label: 'Marketplace',     icon: ShoppingBag },
	{ to: '/app/knowledge',   label: 'My Knowledge',    icon: Brain       },
	{ to: '/app/results',     label: 'My Results',      icon: BarChart3   },
];

function SidebarItem({ to, label, icon: Icon, onClick }: NavItem & { onClick?: () => void }) {
	return (
		<NavLink
			to={to}
			onClick={onClick}
			className={({ isActive }) =>
				cn(
					'flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-colors',
					isActive
						? 'bg-indigo-50 text-indigo-700'
						: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
				)
			}
		>
			<Icon className="w-4 h-4 flex-shrink-0" />
			<span className="truncate">{label}</span>
		</NavLink>
	);
}

export default function AppShell() {
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const [mobileOpen, setMobileOpen] = useState(false);
	const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
	const close = () => setMobileOpen(false);

	const sidebar = (
		<aside className="w-56 flex flex-col h-screen bg-white border-r border-slate-200 flex-shrink-0">
			{/* Logo */}
			<div className="px-4 py-3.5 border-b border-slate-200/60 flex items-center gap-2">
				<Hexagon className="w-5 h-5 text-indigo-600 fill-indigo-50" strokeWidth={1.5} />
				<span className="font-semibold text-[15px] tracking-tight">Lumid</span>
				<button
					type="button"
					className="ml-auto md:hidden"
					onClick={close}
					aria-label="Close menu"
				>
					<X className="w-4 h-4 text-slate-500" />
				</button>
			</div>

			{/* Main nav */}
			<nav className="flex-1 overflow-y-auto px-2 py-3 space-y-px">
				{MAIN_NAV.map((item) => (
					<SidebarItem key={item.to} {...item} onClick={close} />
				))}

				<div className="my-2 border-t border-slate-200/60" />

				<SidebarItem
					to="/dashboard/profile"
					label="Account"
					icon={Settings}
					onClick={close}
				/>
				{isAdmin && (
					<SidebarItem
						to="/dashboard/super-admin"
						label="Admin"
						icon={Shield}
						onClick={close}
					/>
				)}
			</nav>

			{/* User footer */}
			<div className="p-2.5 border-t border-slate-200/60">
				<div className="px-2 pt-1 pb-2 flex items-center gap-1.5 min-w-0">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-1.5">
							<span className="text-[13px] font-medium truncate">
								{user?.username || user?.email?.split('@')[0] || 'there'}
							</span>
							{isAdmin && (
								<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide bg-indigo-100 text-indigo-700">
									<Shield className="w-3 h-3" />
									{user?.role === 'super_admin' ? 'super' : 'admin'}
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
							<Hexagon className="w-4 h-4 text-indigo-600" strokeWidth={1.5} />
							<span className="font-semibold text-sm">Lumid</span>
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
							<div className="relative z-10 w-56">{sidebar}</div>
						</div>
					)}

					<div className="flex">
						<div className="hidden md:flex sticky top-0 h-screen">{sidebar}</div>
						<main className="flex-1 min-w-0 px-4 md:px-8 py-6">
							<Outlet />
						</main>
					</div>
				</div>
			</EnterpriseTipProvider>
		</LanguageProvider>
	);
}
