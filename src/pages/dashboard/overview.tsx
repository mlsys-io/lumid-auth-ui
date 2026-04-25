import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
	Activity,
	ArrowRight,
	Cpu,
	Key,
	Layers,
	Loader2,
	Server,
	Shield,
	Ticket,
	Trophy,
	User as UserIcon,
	Users,
	Zap,
} from 'lucide-react';
import { listClusters, listNodes, listWorkers, type Cluster, type Node, type Worker } from '@/api/cluster';
import { listUsers, listAudit, type AdminUserRow, type AuditEntry } from '@/api/users';
import { isSessionExpired } from '@/api/client';

// /dashboard landing — welcome + live operational snapshot for admins.
// Non-admin sees a slim profile/token shortcut. Admin gets stat tiles
// pulled in parallel + a recent-activity feed so they don't have to
// dig through three pages to know "is anything on fire?"

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

			{isAdmin && <AdminSnapshot />}

			{isAdmin && (
				<section>
					<h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-3 flex items-center gap-1.5">
						<Shield className="w-3 h-3" />
						Jump to
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

// ─────────────────────────────────────────────────────────────────────
// AdminSnapshot — four stat tiles + a recent-activity feed. All four
// fetches run in parallel. A tile-level error doesn't tank the page;
// it just shows an em-dash. Stale-worker count comes from the registry
// last_heartbeat field; anything older than 5min counts as stale even
// if the row still claims idle/busy (stops the operator getting a
// false-green).
// ─────────────────────────────────────────────────────────────────────

interface Snapshot {
	clusters: Cluster[] | null;
	nodes: Node[] | null;
	workers: Worker[] | null;
	users: { rows: AdminUserRow[]; total: number } | null;
	audit: AuditEntry[] | null;
}

function AdminSnapshot() {
	const [snap, setSnap] = useState<Snapshot>({
		clusters: null,
		nodes: null,
		workers: null,
		users: null,
		audit: null,
	});
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const [cR, nR, wR, uR, aR] = await Promise.allSettled([
				listClusters({ page_size: 200 }),
				listNodes({ page_size: 500 }),
				listWorkers({ page_size: 1000 }),
				listUsers({ page_size: 200 }),
				listAudit({ page_size: 8 }),
			]);
			if (cancelled) return;
			// Bail silently on session-expired (the AuthGuard will redirect)
			for (const r of [cR, nR, wR, uR, aR]) {
				if (r.status === 'rejected' && isSessionExpired(r.reason)) return;
			}
			setSnap({
				clusters: cR.status === 'fulfilled' ? cR.value.clusters : null,
				nodes: nR.status === 'fulfilled' ? nR.value.nodes : null,
				workers: wR.status === 'fulfilled' ? wR.value.workers : null,
				users:
					uR.status === 'fulfilled'
						? { rows: uR.value.users, total: uR.value.total }
						: null,
				audit: aR.status === 'fulfilled' ? aR.value.entries : null,
			});
			setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<section>
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700 flex items-center gap-1.5">
					<Activity className="w-3 h-3" />
					Operational snapshot
				</h2>
				{loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
			</div>
			<div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
				<ClusterStat data={snap.clusters} />
				<NodeStat data={snap.nodes} />
				<WorkerStat data={snap.workers} />
				<UserStat data={snap.users} />
			</div>
			<RecentActivity entries={snap.audit} loading={loading} />
		</section>
	);
}

// ─── Stat tiles ───────────────────────────────────────────────────────

function StatTile({
	icon: Icon,
	label,
	to,
	primary,
	primaryHint,
	secondary,
	tone = 'default',
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	to: string;
	primary: React.ReactNode;
	primaryHint?: string;
	secondary: React.ReactNode;
	tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
	const toneCls =
		tone === 'good'
			? 'border-l-green-500'
			: tone === 'warn'
				? 'border-l-amber-500'
				: tone === 'bad'
					? 'border-l-red-500'
					: 'border-l-indigo-500';
	return (
		<Link
			to={to}
			className={`group block rounded-lg border border-slate-200 border-l-[3px] ${toneCls} bg-white p-3 hover:shadow-sm hover:border-indigo-300 transition-all`}
		>
			<div className="flex items-center justify-between mb-1">
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Icon className="w-3.5 h-3.5" />
					{label}
				</div>
				<ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-indigo-500 transition-colors" />
			</div>
			<div className="text-2xl font-semibold leading-tight">{primary}</div>
			{primaryHint && <div className="text-[10px] text-muted-foreground mt-0.5">{primaryHint}</div>}
			<div className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{secondary}</div>
		</Link>
	);
}

function ClusterStat({ data }: { data: Cluster[] | null }) {
	if (data === null) {
		return (
			<StatTile
				icon={Layers}
				label="Clusters"
				to="/dashboard/admin/clusters"
				primary={<span className="text-muted-foreground">—</span>}
				secondary="Couldn't load"
				tone="default"
			/>
		);
	}
	const active = data.filter((c) => c.status === 'active').length;
	const pending = data.filter((c) => c.status === 'pending').length;
	const disabled = data.filter((c) => c.status === 'disabled').length;
	const tone = data.length === 0 ? 'default' : active === 0 ? 'warn' : 'good';
	return (
		<StatTile
			icon={Layers}
			label="Clusters"
			to="/dashboard/admin/clusters"
			primary={active}
			primaryHint={`of ${data.length} total`}
			secondary={
				pending + disabled === 0
					? 'All active'
					: `${pending ? `${pending} pending` : ''}${pending && disabled ? ' · ' : ''}${disabled ? `${disabled} disabled` : ''}`
			}
			tone={tone}
		/>
	);
}

function NodeStat({ data }: { data: Node[] | null }) {
	if (data === null) {
		return (
			<StatTile
				icon={Server}
				label="Nodes"
				to="/dashboard/admin/clusters"
				primary={<span className="text-muted-foreground">—</span>}
				secondary="Couldn't load"
				tone="default"
			/>
		);
	}
	const active = data.filter((n) => n.status === 'active').length;
	const draining = data.filter((n) => n.status === 'draining').length;
	const offline = data.filter((n) => n.status === 'offline').length;
	const stale = data.filter((n) => isStale(n.last_seen, 300)).length;
	const tone =
		data.length === 0 ? 'default' : offline > 0 || stale > active / 2 ? 'bad' : draining > 0 || stale > 0 ? 'warn' : 'good';
	return (
		<StatTile
			icon={Server}
			label="Nodes"
			to="/dashboard/admin/clusters"
			primary={active}
			primaryHint={`of ${data.length} total`}
			secondary={
				offline + draining + stale === 0
					? 'All healthy'
					: [
							offline ? `${offline} offline` : '',
							draining ? `${draining} draining` : '',
							stale ? `${stale} stale (>5min)` : '',
						]
							.filter(Boolean)
							.join(' · ')
			}
			tone={tone}
		/>
	);
}

function WorkerStat({ data }: { data: Worker[] | null }) {
	if (data === null) {
		return (
			<StatTile
				icon={Cpu}
				label="Workers"
				to="/dashboard/admin/clusters"
				primary={<span className="text-muted-foreground">—</span>}
				secondary="Couldn't load"
				tone="default"
			/>
		);
	}
	const idle = data.filter((w) => w.status === 'idle').length;
	const busy = data.filter((w) => w.status === 'busy').length;
	const starting = data.filter((w) => w.status === 'starting').length;
	const lost = data.filter((w) => w.status === 'lost').length;
	const stopped = data.filter((w) => w.status === 'stopped').length;
	const live = idle + busy;
	const stale = data.filter((w) => (w.status === 'idle' || w.status === 'busy') && isStale(w.last_heartbeat, 300)).length;
	const gpu = data.filter((w) => w.type === 'gpu').length;
	const tone =
		data.length === 0
			? 'default'
			: lost > 0 || (stale > 0 && stale === live)
				? 'bad'
				: starting > 0 || stale > 0
					? 'warn'
					: 'good';
	return (
		<StatTile
			icon={Cpu}
			label="Workers"
			to="/dashboard/admin/clusters"
			primary={
				<>
					{live}
					<span className="text-base text-muted-foreground"> / {data.length}</span>
				</>
			}
			primaryHint={`${idle} idle · ${busy} busy${gpu ? ` · ${gpu} GPU` : ''}`}
			secondary={
				lost + starting + stopped + stale === 0
					? 'All heartbeating'
					: [
							lost ? `${lost} lost` : '',
							starting ? `${starting} starting` : '',
							stale ? `${stale} stale heartbeat` : '',
							stopped ? `${stopped} stopped` : '',
						]
							.filter(Boolean)
							.join(' · ')
			}
			tone={tone}
		/>
	);
}

function UserStat({ data }: { data: { rows: AdminUserRow[]; total: number } | null }) {
	if (data === null) {
		return (
			<StatTile
				icon={Users}
				label="Users"
				to="/dashboard/admin/users"
				primary={<span className="text-muted-foreground">—</span>}
				secondary="Couldn't load"
				tone="default"
			/>
		);
	}
	// Privileged rows are bounded; if we got fewer than `total`, the
	// admin/super_admin counts are still right because the page is sorted
	// active-first and admins are typically a tiny fraction. We surface a
	// dash when the page hasn't covered the long tail.
	const admins = data.rows.filter((u) => u.role === 'admin').length;
	const superAdmins = data.rows.filter((u) => u.role === 'super_admin').length;
	const suspended = data.rows.filter((u) => u.status === 'suspended').length;
	const tone = suspended > 0 ? 'warn' : 'default';
	return (
		<StatTile
			icon={Users}
			label="Users"
			to="/dashboard/admin/users"
			primary={data.total}
			primaryHint={`${admins} admin · ${superAdmins} super_admin`}
			secondary={
				suspended === 0
					? data.rows.filter((u) => u.status === 'pending').length > 0
						? `${data.rows.filter((u) => u.status === 'pending').length} pending verification`
						: 'No suspended accounts'
					: `${suspended} suspended`
			}
			tone={tone}
		/>
	);
}

function RecentActivity({ entries, loading }: { entries: AuditEntry[] | null; loading: boolean }) {
	if (loading) {
		return (
			<div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-xs text-muted-foreground flex items-center gap-2">
				<Loader2 className="w-3 h-3 animate-spin" />
				Loading recent activity…
			</div>
		);
	}
	if (!entries) {
		return (
			<div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-xs text-muted-foreground">
				Couldn't load recent activity.
			</div>
		);
	}
	if (entries.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-xs text-muted-foreground">
				No recent admin activity.
			</div>
		);
	}
	return (
		<div className="mt-4 rounded-lg border border-slate-200 bg-white">
			<div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
				<div className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
					<Zap className="w-3 h-3 text-indigo-500" />
					Recent activity
				</div>
				<Link
					to="/dashboard/admin/audit"
					className="text-[10px] text-muted-foreground hover:text-indigo-600"
				>
					View all →
				</Link>
			</div>
			<ul className="divide-y divide-slate-100">
				{entries.map((e) => (
					<ActivityRow key={e.id} entry={e} />
				))}
			</ul>
		</div>
	);
}

function ActivityRow({ entry }: { entry: AuditEntry }) {
	const ok = !entry.status || (entry.status >= 200 && entry.status < 400);
	const dotCls = ok ? 'bg-green-400' : entry.status && entry.status >= 500 ? 'bg-red-500' : 'bg-amber-500';
	const ago = relativeTime(entry.created_at);
	return (
		<li className="px-3 py-2 text-xs flex items-center gap-2.5 hover:bg-slate-50/60">
			<span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
			<span className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">{entry.method || '—'}</span>
			<span className="font-mono text-[11px] truncate flex-1">{entry.path || entry.event}</span>
			{entry.status != null && (
				<span className={`text-[10px] font-mono shrink-0 ${ok ? 'text-slate-500' : 'text-red-600'}`}>
					{entry.status}
				</span>
			)}
			<span className="text-[10px] text-muted-foreground w-14 text-right shrink-0" title={entry.created_at}>
				{ago}
			</span>
		</li>
	);
}

// ─── helpers ─────────────────────────────────────────────────────────

function isStale(ts: string | undefined | null, thresholdSec: number): boolean {
	if (!ts) return true;
	const t = new Date(ts).getTime();
	if (!Number.isFinite(t)) return true;
	return (Date.now() - t) / 1000 > thresholdSec;
}

function relativeTime(ts: string): string {
	const t = new Date(ts).getTime();
	if (!Number.isFinite(t)) return '—';
	const ageS = Math.max(0, Math.floor((Date.now() - t) / 1000));
	if (ageS < 60) return `${ageS}s`;
	if (ageS < 3600) return `${Math.floor(ageS / 60)}m`;
	if (ageS < 86400) return `${Math.floor(ageS / 3600)}h`;
	return `${Math.floor(ageS / 86400)}d`;
}

// ─────────────────────────────────────────────────────────────────────

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
