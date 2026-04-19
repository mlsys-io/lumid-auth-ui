import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield, Users, Server, Receipt, ClipboardCheck, LayoutDashboard } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { LanguageProvider } from '../../../runmesh/i18n';

// Shared shell for every ported Runmesh admin page. Wraps the
// <Outlet/> in a sidebar that mimics Runmesh's own admin nav so
// keyboard muscle memory carries over. The nav is the only
// non-Runmesh chrome on these pages — the page content itself
// is literally the Runmesh component tree.
//
// <LanguageProvider> makes the copied useLanguage/t() helpers work;
// we default to en-US but the language selector inside Runmesh's
// i18n module keeps zh-CN available for Chinese-speaking admins.

const NAV = [
	{ to: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
	{ to: 'users', label: 'Users', icon: Users },
	{ to: 'nodes', label: 'Nodes', icon: Server },
	{ to: 'suppliers', label: 'Suppliers', icon: Server },
	{ to: 'supplier-nodes', label: 'Supplier nodes', icon: Server },
	{ to: 'billing', label: 'Billing', icon: Receipt },
	{ to: 'workflow-review', label: 'Reviews', icon: ClipboardCheck },
];

export default function RunmeshAdminLayout() {
	const navigate = useNavigate();
	return (
		<LanguageProvider>
			<div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
				<header className="bg-white/60 backdrop-blur-sm border-b">
					<div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
						<Button variant="ghost" size="sm" onClick={() => navigate('/account/admin')}>
							<ArrowLeft className="w-4 h-4 mr-1" />
							Admin hub
						</Button>
						<div className="flex items-center gap-2">
							<Shield className="w-4 h-4 text-indigo-600" />
							<h1 className="text-sm font-semibold">Runmesh admin</h1>
						</div>
					</div>
				</header>

				<div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
					<aside className="w-56 shrink-0 hidden md:block">
						<nav className="bg-white/80 backdrop-blur-sm rounded-lg border-0 shadow-sm p-2 sticky top-4">
							{NAV.map(({ to, label, icon: Icon }) => (
								<NavLink
									key={to}
									to={to}
									className={({ isActive }) =>
										`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
											isActive
												? 'bg-indigo-100 text-indigo-700 font-medium'
												: 'text-muted-foreground hover:bg-indigo-50 hover:text-indigo-700'
										}`
									}
								>
									<Icon className="w-4 h-4" />
									{label}
								</NavLink>
							))}
						</nav>
					</aside>

					<main className="flex-1 min-w-0 bg-white/80 backdrop-blur-sm rounded-lg border-0 shadow-sm p-4 overflow-x-auto">
						<Outlet />
					</main>
				</div>
			</div>
		</LanguageProvider>
	);
}
