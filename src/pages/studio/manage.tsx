// Studio manage — cluster / users / status hub.
// Three tabs: Clusters (lumid_cluster), Users (admin users list), Status (build + auth).
// SuperAdminGuard-gated at the route in App.tsx.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Server, Users, Activity, RefreshCw, Loader2, ExternalLink } from 'lucide-react';
import {
	fetchClusterList,  type ClusterRow,
	fetchAdminUsers,   type AdminUserRow,
	fetchBuildStatus,  type BuildStatus,
	fetchAuthStats,    type AuthStats,
} from '@/api/super-admin';

type Tab = 'clusters' | 'users' | 'status';

const TABS: { id: Tab; label: string; icon: typeof Server }[] = [
	{ id: 'clusters', label: 'Clusters', icon: Server },
	{ id: 'users',    label: 'Users',    icon: Users },
	{ id: 'status',   label: 'Status',   icon: Activity },
];

export default function StudioManage() {
	const [tab, setTab] = useState<Tab>('clusters');
	return (
		<div className="space-y-4">
			<header className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-medium flex items-center gap-2">
						<Server className="w-5 h-5 text-gold-600" />
						Manage
					</h1>
					<p className="text-sm text-slate-500 mt-0.5">
						Cluster registry, users, and system status.
						Full dashboard at
						<Link to="/studio/super-admin" className="ml-1 text-gold-700 hover:underline">
							/studio/super-admin <ExternalLink className="inline w-3 h-3" />
						</Link>
						&nbsp;·&nbsp;
						<Link to="/quota" className="text-gold-700 hover:underline">
							Claude quota <ExternalLink className="inline w-3 h-3" />
						</Link>
					</p>
				</div>
			</header>

			<nav className="border-b border-slate-200 flex items-center gap-1">
				{TABS.map((t) => {
					const Icon = t.icon;
					const active = tab === t.id;
					return (
						<button
							key={t.id}
							onClick={() => setTab(t.id)}
							className={[
								'inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors -mb-px',
								active
									? 'border-gold-500 text-gold-700 font-medium'
									: 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300',
							].join(' ')}
						>
							<Icon className="w-4 h-4" />
							{t.label}
						</button>
					);
				})}
			</nav>

			<div className="pt-1">
				{tab === 'clusters' && <ClustersTab />}
				{tab === 'users'    && <UsersTab />}
				{tab === 'status'   && <StatusTab />}
			</div>
		</div>
	);
}

// ── Clusters tab ───────────────────────────────────────────────────

function ClustersTab() {
	const [data, setData]   = useState<ClusterRow[] | null>(null);
	const [total, setTotal] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = () => {
		setLoading(true);
		fetchClusterList()
			.then((r) => { setData(r.clusters ?? []); setTotal(r.total); setError(null); })
			.catch((e) => setError(String(e?.message || e)))
			.finally(() => setLoading(false));
	};

	useEffect(() => { load(); }, []);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-xs text-slate-500">
					{total} cluster{total !== 1 ? 's' : ''}
				</span>
				<button
					onClick={load}
					className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-gold-700 transition"
				>
					<RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
					refresh
				</button>
			</div>
			{error ? <ErrorBox>{error}</ErrorBox> : !data ? <Loading /> : (
				<div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-slate-50 text-left text-xs text-slate-600 tracking-wide">
							<tr>
								<th className="px-3 py-2 font-medium">Name</th>
								<th className="px-3 py-2 font-medium w-24">Region</th>
								<th className="px-3 py-2 font-medium w-24">Status</th>
								<th className="px-3 py-2 font-medium w-28">Created</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{data.length === 0 ? (
								<tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-500 italic">No clusters registered.</td></tr>
							) : data.map((c) => (
								<tr key={c.id} className="hover:bg-slate-50/60">
									<td className="px-3 py-1.5">
										<span className="font-medium text-sm">{c.name}</span>
										<span className="ml-2 font-mono text-[10px] text-slate-400">{c.id.slice(0, 8)}</span>
									</td>
									<td className="px-3 py-1.5 text-xs text-slate-600">{c.region || '—'}</td>
									<td className="px-3 py-1.5 text-xs">
										<StatusBadge status={c.status} />
									</td>
									<td className="px-3 py-1.5 text-xs text-slate-500">
										{c.created_at.slice(0, 10)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const cls =
		status === 'active'   ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
		status === 'disabled' ? 'text-slate-500 bg-slate-50 border-slate-200' :
		'text-amber-700 bg-amber-50 border-amber-200';
	return (
		<span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
			{status}
		</span>
	);
}

// ── Users tab ──────────────────────────────────────────────────────

function UsersTab() {
	const [data, setData]   = useState<AdminUserRow[] | null>(null);
	const [total, setTotal] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = () => {
		setLoading(true);
		fetchAdminUsers(1, 100, 'all')
			.then((r) => { setData(r.users ?? []); setTotal(r.total); setError(null); })
			.catch((e) => setError(String(e?.message || e)))
			.finally(() => setLoading(false));
	};

	useEffect(() => { load(); }, []);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<span className="text-xs text-slate-500">
					{total} user{total !== 1 ? 's' : ''}
				</span>
				<button
					onClick={load}
					className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-gold-700 transition"
				>
					<RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
					refresh
				</button>
			</div>
			{error ? <ErrorBox>{error}</ErrorBox> : !data ? <Loading /> : (
				<div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
					<table className="w-full text-sm">
						<thead className="bg-slate-50 text-left text-xs text-slate-600 tracking-wide">
							<tr>
								<th className="px-3 py-2 font-medium">Email</th>
								<th className="px-3 py-2 font-medium w-24">Role</th>
								<th className="px-3 py-2 font-medium w-20">Status</th>
								<th className="px-3 py-2 font-medium w-20">Tokens</th>
								<th className="px-3 py-2 font-medium w-28">Joined</th>
								<th className="px-3 py-2 font-medium w-28">Last login</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{data.length === 0 ? (
								<tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500 italic">No users.</td></tr>
							) : data.map((u) => (
								<tr key={u.id} className="hover:bg-slate-50/60">
									<td className="px-3 py-1.5 font-mono text-xs">{u.email}</td>
									<td className="px-3 py-1.5 text-xs">
										<RoleBadge role={u.role} />
									</td>
									<td className="px-3 py-1.5 text-xs">
										<StatusBadge status={u.status} />
									</td>
									<td className="px-3 py-1.5 text-xs text-slate-600 tabular-nums">{u.active_token_count}</td>
									<td className="px-3 py-1.5 text-xs text-slate-500">{u.created_at.slice(0, 10)}</td>
									<td className="px-3 py-1.5 text-xs text-slate-500">
										{u.last_login_at ? u.last_login_at.slice(0, 10) : '—'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function RoleBadge({ role }: { role: string }) {
	const cls =
		role === 'super_admin' ? 'text-rose-700 bg-rose-50 border-rose-200' :
		role === 'admin'       ? 'text-gold-700 bg-gold-50 border-gold-200' :
		'text-slate-500 bg-slate-50 border-slate-200';
	return (
		<span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
			{role}
		</span>
	);
}

// ── Status tab ─────────────────────────────────────────────────────

function StatusTab() {
	const [build, setBuild] = useState<BuildStatus | null>(null);
	const [auth,  setAuth]  = useState<AuthStats | null>(null);
	const [err,   setErr]   = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = () => {
		setLoading(true);
		Promise.all([
			fetchBuildStatus().catch((e): BuildStatus => { setErr(String(e?.message || e)); return null as any; }),
			fetchAuthStats().catch((): AuthStats => null as any),
		]).then(([b, a]) => {
			setBuild(b);
			setAuth(a);
		}).finally(() => setLoading(false));
	};

	useEffect(() => { load(); }, []);

	if (loading) return <Loading />;
	if (err) return <ErrorBox>{err}</ErrorBox>;

	const failed = (auth?.login.failed ?? 0) + (auth?.oauth.failed ?? 0);
	const services = build?.services ?? [];
	const running = services.filter((s: any) => /running|up/i.test(s.state ?? '')).length;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<span className="text-xs text-slate-500">System health snapshot</span>
				<button onClick={load} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-gold-700 transition">
					<RefreshCw className="w-3 h-3" /> refresh
				</button>
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard label="Services"     value={String(services.length)} hint={`${running} running`} />
				<StatCard label="Logins (24h)" value={String(auth?.login.total ?? '—')} hint={`${auth?.oauth.total ?? 0} OAuth`} />
				<StatCard
					label="Failed logins"
					value={String(failed)}
					tone={failed === 0 ? 'good' : failed < 10 ? 'warn' : 'bad'}
				/>
				<StatCard label="Build age" value={build ? `${build.snapshot_age}m` : '—'} />
			</div>
			{services.length > 0 && (
				<div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
					<div className="px-3 py-2 border-b border-slate-100 text-xs font-medium text-slate-700 uppercase tracking-wide">
						Services
					</div>
					<table className="w-full text-sm">
						<thead className="bg-slate-50 text-left text-xs text-slate-600 tracking-wide">
							<tr>
								<th className="px-3 py-2 font-medium">Name</th>
								<th className="px-3 py-2 font-medium w-40">Image</th>
								<th className="px-3 py-2 font-medium w-24">State</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{services.slice(0, 40).map((s: any, i: number) => (
								<tr key={`${s.name}-${i}`} className="hover:bg-slate-50/60">
									<td className="px-3 py-1.5 font-mono text-xs">{s.name}</td>
									<td className="px-3 py-1.5 text-xs text-slate-500 truncate max-w-[160px]">{s.image ?? '—'}</td>
									<td className="px-3 py-1.5 text-xs text-slate-600">{s.state ?? '—'}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

// ── Shared ─────────────────────────────────────────────────────────

function StatCard({ label, value, hint, tone = 'default' }: {
	label: string; value: string; hint?: string;
	tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
	const toneCls = { default: '', good: 'text-gold-700', warn: 'text-gold-700', bad: 'text-rose-700' }[tone];
	return (
		<div className="rounded-lg border border-slate-200 bg-white p-4">
			<div className="text-xs tracking-wide text-slate-500">{label}</div>
			<div className={['text-2xl font-medium mt-1', toneCls].join(' ')}>{value}</div>
			{hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
		</div>
	);
}

function ErrorBox({ children }: { children: React.ReactNode }) {
	return (
		<div className="text-sm rounded border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">
			{children}
		</div>
	);
}

function Loading() {
	return (
		<div className="text-sm text-slate-500 italic flex items-center gap-2">
			<Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
		</div>
	);
}
