import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
	Shield,
	Key,
	User as UserIcon,
	Ticket,
	ArrowRight,
	Layers,
	Users,
	Trophy,
} from 'lucide-react';

// /dashboard landing — a welcome + compact status page. Not a hub;
// the sidebar is the nav. Shows role prominently so the user knows
// what privileges they're operating with.

export default function Overview() {
	const { user } = useAuth();
	const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
	const isSuperAdmin = user?.role === 'super_admin';

	return (
		<div className="space-y-6">
			<header className="flex items-start justify-between gap-4 flex-wrap">
				<div>
					<h1 className="text-2xl font-semibold">
						Welcome back, {user?.username || user?.email?.split('@')[0] || 'there'}
					</h1>
					<p className="text-sm text-muted-foreground mt-1">{user?.email}</p>
				</div>
				<div
					className={
						isAdmin
							? 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 border border-indigo-200'
							: 'flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200'
					}
				>
					{isAdmin && <Shield className="w-3.5 h-3.5" />}
					<span className="uppercase tracking-wide">
						{isSuperAdmin ? 'super_admin' : isAdmin ? 'admin' : 'user'}
					</span>
				</div>
			</header>

			<section>
				<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
					Quick actions
				</h2>
				<div className="grid gap-2 sm:grid-cols-2">
					<QuickLink to="/dashboard/profile" icon={UserIcon} label="Update profile" desc="Name, avatar, password" />
					<QuickLink to="/dashboard/tokens" icon={Key} label="Mint a token" desc="PATs for CLI + bots" />
				</div>
			</section>

			{isAdmin && (
				<section>
					<h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-3 flex items-center gap-1.5">
						<Shield className="w-3 h-3" />
						Administration
					</h2>
					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
						<QuickLink
							to="/dashboard/admin/users"
							icon={Users}
							label="People & access"
							desc="Users, access matrix, invitations"
							adminAccent
						/>
						<QuickLink
							to="/dashboard/admin/clusters"
							icon={Layers}
							label="Infrastructure"
							desc="Clusters, workers, suppliers, billing"
							adminAccent
						/>
						<QuickLink
							to="/dashboard/admin/competitions"
							icon={Trophy}
							label="QuantArena"
							desc="Competitions, markets, templates"
							adminAccent
						/>
						<QuickLink
							to="/dashboard/admin/invitations"
							icon={Ticket}
							label="Invitations"
							desc="Mint, list, revoke"
							adminAccent
						/>
					</div>
				</section>
			)}

			<footer className="text-xs text-muted-foreground pt-4 border-t border-slate-200/60">
				Signed in via lum.id · session cookie is HttpOnly, scoped to{' '}
				<code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">.lum.id</code>
			</footer>
		</div>
	);
}

function QuickLink({
	to,
	icon: Icon,
	label,
	desc,
	adminAccent = false,
}: {
	to: string;
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	desc: string;
	adminAccent?: boolean;
}) {
	const base =
		'group rounded-lg p-3 border hover:border-indigo-300 hover:shadow-sm transition-all flex items-center gap-3 bg-white';
	const accent = adminAccent
		? 'border-l-[3px] border-l-indigo-500 border-slate-200'
		: 'border-slate-200';
	return (
		<Link to={to} className={`${base} ${accent}`}>
			<div className={`p-2 rounded-md shrink-0 ${adminAccent ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600'}`}>
				<Icon className="w-4 h-4" />
			</div>
			<div className="flex-1 min-w-0">
				<div className="text-sm font-medium">{label}</div>
				<p className="text-xs text-slate-500 truncate">{desc}</p>
			</div>
			<ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500 shrink-0 transition-colors" />
		</Link>
	);
}
