import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Shield, Key, Terminal, User as UserIcon, Ticket, ArrowRight } from 'lucide-react';

// /dashboard landing — a welcome + compact status page. Not a hub;
// the sidebar is the nav. Shows role prominently so the user knows
// what privileges they're operating with.

export default function Overview() {
	const { user } = useAuth();
	const isAdmin = user?.role === 'admin';

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
					<span className="uppercase tracking-wide">{isAdmin ? 'admin' : 'user'}</span>
				</div>
			</header>

			<section>
				<h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
					Quick actions
				</h2>
				<div className="grid gap-2 sm:grid-cols-3">
					<QuickLink to="/dashboard/profile" icon={UserIcon} label="Update profile" desc="Name, avatar, password" />
					<QuickLink to="/dashboard/tokens" icon={Key} label="Mint a token" desc="PATs for CLI + bots" />
					<QuickLink to="/dashboard/connect" icon={Terminal} label="Install LumidOS" desc="One-line installer" />
				</div>
			</section>

			{isAdmin && (
				<section>
					<h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-3 flex items-center gap-1.5">
						<Shield className="w-3 h-3" />
						Administration
					</h2>
					<div className="grid gap-2 sm:grid-cols-3">
						<QuickLink
							to="/dashboard/admin/invitations"
							icon={Ticket}
							label="Invitation codes"
							desc="Mint, list, revoke"
							adminAccent
						/>
						<QuickLink
							to="/dashboard/admin/runmesh/dashboard"
							icon={Shield}
							label="Runmesh admin"
							desc="Users, nodes, billing"
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
		'group rounded-lg p-3 border hover:shadow-md transition-all flex items-start gap-3 bg-white';
	const accent = adminAccent
		? 'border-l-[3px] border-l-indigo-500 border-slate-200/60'
		: 'border-slate-200/60';
	return (
		<Link to={to} className={`${base} ${accent}`}>
			<div className="p-2 rounded-md bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100">
				<Icon className="w-4 h-4" />
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5 text-sm font-medium">
					{label}
					<ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
				</div>
				<p className="text-xs text-muted-foreground truncate">{desc}</p>
			</div>
		</Link>
	);
}
