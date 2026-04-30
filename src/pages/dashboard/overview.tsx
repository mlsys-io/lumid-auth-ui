import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Activity,
	Cpu,
	Layers,
	Loader2,
	Server,
	Users,
	Zap,
} from 'lucide-react';
import {
	listClusters,
	listNodes,
	listWorkers,
	type Cluster,
	type Node,
	type Worker,
} from '@/api/cluster';
import {
	listUsers,
	listAudit,
	type AdminUserRow,
	type AuditEntry,
} from '@/api/users';
import { isSessionExpired } from '@/api/client';

// /dashboard/admin/ landing — operational snapshot for cluster owners.
// AppLayout already supplies the welcome chrome + sidebar nav, so this
// page is content-only: 4 headline tiles, a per-cluster breakdown,
// the GPU inventory roll-up, and the recent admin activity feed.

interface Snapshot {
	clusters: Cluster[] | null;
	nodes: Node[] | null;
	workers: Worker[] | null;
	users: { rows: AdminUserRow[]; total: number } | null;
	audit: AuditEntry[] | null;
}

export default function AdminOverview() {
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
				listAudit({ page_size: 12 }),
			]);
			if (cancelled) return;
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
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold">Overview</h1>
					<p className="text-xs text-muted-foreground mt-0.5">
						Live snapshot from cluster registry · refreshed on page load
					</p>
				</div>
				{loading && (
					<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
				)}
			</div>

			<section>
				<h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-3 flex items-center gap-1.5">
					<Activity className="w-3 h-3" />
					Headline metrics
				</h2>
				<div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
					<ClusterStat data={snap.clusters} />
					<NodeStat data={snap.nodes} />
					<WorkerStat data={snap.workers} />
					<UserStat data={snap.users} />
				</div>
			</section>

			<div className="grid gap-6 lg:grid-cols-2">
				<ClusterBreakdown
					clusters={snap.clusters}
					nodes={snap.nodes}
					workers={snap.workers}
					loading={loading}
				/>
				<GpuInventory workers={snap.workers} loading={loading} />
			</div>

			<RecentActivity entries={snap.audit} loading={loading} />
		</div>
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
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
				<Icon className="w-3.5 h-3.5" />
				{label}
			</div>
			<div className="text-2xl font-semibold leading-tight">{primary}</div>
			{primaryHint && (
				<div className="text-[10px] text-muted-foreground mt-0.5">{primaryHint}</div>
			)}
			<div className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{secondary}</div>
		</Link>
	);
}

function ClusterStat({ data }: { data: Cluster[] | null }) {
	if (data === null) return <ErrorTile icon={Layers} label="Clusters" to="/dashboard/admin/clusters" />;
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
					: [
							pending ? `${pending} pending` : '',
							disabled ? `${disabled} disabled` : '',
						]
							.filter(Boolean)
							.join(' · ')
			}
			tone={tone}
		/>
	);
}

function NodeStat({ data }: { data: Node[] | null }) {
	if (data === null) return <ErrorTile icon={Server} label="Nodes" to="/dashboard/admin/clusters" />;
	const active = data.filter((n) => n.status === 'active').length;
	const draining = data.filter((n) => n.status === 'draining').length;
	const offline = data.filter((n) => n.status === 'offline').length;
	const stale = data.filter((n) => isStale(n.last_seen, 300)).length;
	const tone =
		data.length === 0
			? 'default'
			: offline > 0 || stale > active / 2
				? 'bad'
				: draining > 0 || stale > 0
					? 'warn'
					: 'good';
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
	if (data === null) return <ErrorTile icon={Cpu} label="Workers" to="/dashboard/admin/clusters" />;
	const idle = data.filter((w) => w.status === 'idle').length;
	const busy = data.filter((w) => w.status === 'busy').length;
	const starting = data.filter((w) => w.status === 'starting').length;
	const lost = data.filter((w) => w.status === 'lost').length;
	const stopped = data.filter((w) => w.status === 'stopped').length;
	const live = idle + busy;
	const stale = data.filter(
		(w) => (w.status === 'idle' || w.status === 'busy') && isStale(w.last_heartbeat, 300),
	).length;
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

function UserStat({
	data,
}: {
	data: { rows: AdminUserRow[]; total: number } | null;
}) {
	if (data === null) return <ErrorTile icon={Users} label="Users" to="/dashboard/admin/users" />;
	const admins = data.rows.filter((u) => u.role === 'admin').length;
	const superAdmins = data.rows.filter((u) => u.role === 'super_admin').length;
	const suspended = data.rows.filter((u) => u.status === 'suspended').length;
	const pending = data.rows.filter((u) => u.status === 'pending').length;
	const tone = suspended > 0 ? 'warn' : 'default';
	return (
		<StatTile
			icon={Users}
			label="Users"
			to="/dashboard/admin/users"
			primary={data.total}
			primaryHint={`${admins} admin · ${superAdmins} super_admin`}
			secondary={
				suspended > 0
					? `${suspended} suspended${pending ? ` · ${pending} pending` : ''}`
					: pending > 0
						? `${pending} pending verification`
						: 'No suspended accounts'
			}
			tone={tone}
		/>
	);
}

function ErrorTile({
	icon: Icon,
	label,
	to,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	to: string;
}) {
	return (
		<StatTile
			icon={Icon}
			label={label}
			to={to}
			primary={<span className="text-muted-foreground">—</span>}
			secondary="Couldn't load"
			tone="default"
		/>
	);
}

// ─── Per-cluster breakdown ────────────────────────────────────────────

function ClusterBreakdown({
	clusters,
	nodes,
	workers,
	loading,
}: {
	clusters: Cluster[] | null;
	nodes: Node[] | null;
	workers: Worker[] | null;
	loading: boolean;
}) {
	const rows = useMemo(() => {
		if (!clusters || !nodes || !workers) return [];
		return clusters.map((c) => {
			const cNodes = nodes.filter((n) => n.cluster_id === c.id);
			const cWorkers = workers.filter((w) => w.cluster_id === c.id);
			const live = cWorkers.filter((w) => w.status === 'idle' || w.status === 'busy').length;
			const lost = cWorkers.filter((w) => w.status === 'lost').length;
			const gpus = cWorkers.filter((w) => w.type === 'gpu').length;
			return { cluster: c, nodes: cNodes, workers: cWorkers, live, lost, gpus };
		});
	}, [clusters, nodes, workers]);

	return (
		<Panel
			title="Clusters"
			icon={Layers}
			loading={loading && (clusters === null || nodes === null || workers === null)}
			loadFailed={!loading && (clusters === null || nodes === null || workers === null)}
			empty={!loading && rows.length === 0 ? 'No clusters yet.' : undefined}
		>
			<table className="w-full text-xs">
				<thead className="text-[10px] uppercase text-muted-foreground">
					<tr className="border-b border-slate-100">
						<th className="text-left font-medium py-1.5 px-2">Name</th>
						<th className="text-left font-medium py-1.5 px-2">Status</th>
						<th className="text-right font-medium py-1.5 px-2">Nodes</th>
						<th className="text-right font-medium py-1.5 px-2">Workers</th>
						<th className="text-right font-medium py-1.5 px-2">GPU</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.cluster.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
							<td className="py-1.5 px-2">
								<Link
									to={`/dashboard/admin/clusters/${r.cluster.id}`}
									className="font-medium hover:text-indigo-600"
								>
									{r.cluster.name}
								</Link>
								{r.cluster.region && (
									<span className="text-[10px] text-muted-foreground ml-1.5">{r.cluster.region}</span>
								)}
							</td>
							<td className="py-1.5 px-2">
								<StatusPill status={r.cluster.status} />
							</td>
							<td className="py-1.5 px-2 text-right tabular-nums">
								{r.nodes.filter((n) => n.status === 'active').length}
								<span className="text-muted-foreground">/{r.nodes.length}</span>
							</td>
							<td className="py-1.5 px-2 text-right tabular-nums">
								{r.live}
								<span className="text-muted-foreground">/{r.workers.length}</span>
								{r.lost > 0 && (
									<span className="ml-1 text-red-600 text-[10px]">+{r.lost} lost</span>
								)}
							</td>
							<td className="py-1.5 px-2 text-right tabular-nums">{r.gpus}</td>
						</tr>
					))}
				</tbody>
			</table>
		</Panel>
	);
}

function StatusPill({ status }: { status: string }) {
	const cls =
		status === 'active'
			? 'bg-green-100 text-green-700 border-green-200'
			: status === 'pending'
				? 'bg-amber-100 text-amber-700 border-amber-200'
				: 'bg-slate-100 text-slate-600 border-slate-200';
	return (
		<span
			className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] border ${cls}`}
		>
			{status}
		</span>
	);
}

// ─── GPU inventory roll-up ────────────────────────────────────────────

function GpuInventory({
	workers,
	loading,
}: {
	workers: Worker[] | null;
	loading: boolean;
}) {
	const rows = useMemo(() => {
		if (!workers) return [];
		const m = new Map<string, { live: number; total: number }>();
		for (const w of workers) {
			if (w.type !== 'gpu') continue;
			const key = String(w.gpu_index != null ? `gpu#${w.gpu_index}` : 'gpu');
			void key;
			// We don't have model on Worker — group by gpu+role instead.
			const k = `${w.role} GPU`;
			const prev = m.get(k) || { live: 0, total: 0 };
			prev.total += 1;
			if (w.status === 'idle' || w.status === 'busy') prev.live += 1;
			m.set(k, prev);
		}
		return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total);
	}, [workers]);

	const cpuLive = useMemo(() => {
		if (!workers) return { live: 0, total: 0 };
		const cpu = workers.filter((w) => w.type === 'cpu');
		return {
			live: cpu.filter((w) => w.status === 'idle' || w.status === 'busy').length,
			total: cpu.length,
		};
	}, [workers]);

	return (
		<Panel
			title="Compute mix"
			icon={Cpu}
			loading={loading && workers === null}
			loadFailed={!loading && workers === null}
			empty={!loading && workers !== null && workers.length === 0 ? 'No workers enrolled.' : undefined}
		>
			<table className="w-full text-xs">
				<thead className="text-[10px] uppercase text-muted-foreground">
					<tr className="border-b border-slate-100">
						<th className="text-left font-medium py-1.5 px-2">Pool</th>
						<th className="text-right font-medium py-1.5 px-2">Live</th>
						<th className="text-right font-medium py-1.5 px-2">Total</th>
					</tr>
				</thead>
				<tbody>
					{cpuLive.total > 0 && (
						<tr className="border-b border-slate-50 hover:bg-slate-50/50">
							<td className="py-1.5 px-2">CPU</td>
							<td className="py-1.5 px-2 text-right tabular-nums">{cpuLive.live}</td>
							<td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
								{cpuLive.total}
							</td>
						</tr>
					)}
					{rows.map(([k, v]) => (
						<tr key={k} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
							<td className="py-1.5 px-2 capitalize">{k}</td>
							<td className="py-1.5 px-2 text-right tabular-nums">{v.live}</td>
							<td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
								{v.total}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</Panel>
	);
}

// ─── Recent admin activity ────────────────────────────────────────────

function RecentActivity({
	entries,
	loading,
}: {
	entries: AuditEntry[] | null;
	loading: boolean;
}) {
	return (
		<Panel
			title="Recent activity"
			icon={Zap}
			loading={loading && entries === null}
			loadFailed={!loading && entries === null}
			empty={
				!loading && entries !== null && entries.length === 0
					? 'No recent admin activity.'
					: undefined
			}
			rightAction={
				<Link
					to="/dashboard/admin/audit"
					className="text-[10px] text-muted-foreground hover:text-indigo-600"
				>
					View all →
				</Link>
			}
		>
			<ul className="divide-y divide-slate-100">
				{entries?.map((e) => (
					<ActivityRow key={e.id} entry={e} />
				))}
			</ul>
		</Panel>
	);
}

function ActivityRow({ entry }: { entry: AuditEntry }) {
	const ok = !entry.status || (entry.status >= 200 && entry.status < 400);
	const dotCls = ok
		? 'bg-green-400'
		: entry.status && entry.status >= 500
			? 'bg-red-500'
			: 'bg-amber-500';
	const ago = relativeTime(entry.created_at);
	return (
		<li className="px-3 py-2 text-xs flex items-center gap-2.5 hover:bg-slate-50/60">
			<span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
			<span className="font-mono text-[10px] text-muted-foreground w-12 shrink-0">
				{entry.method || '—'}
			</span>
			<span className="font-mono text-[11px] truncate flex-1">
				{entry.path || entry.event}
			</span>
			{entry.status != null && (
				<span
					className={`text-[10px] font-mono shrink-0 ${ok ? 'text-slate-500' : 'text-red-600'}`}
				>
					{entry.status}
				</span>
			)}
			<span
				className="text-[10px] text-muted-foreground w-10 text-right shrink-0"
				title={entry.created_at}
			>
				{ago}
			</span>
		</li>
	);
}

// ─── Panel + helpers ──────────────────────────────────────────────────

function Panel({
	title,
	icon: Icon,
	children,
	loading,
	loadFailed,
	empty,
	rightAction,
}: {
	title: string;
	icon: React.ComponentType<{ className?: string }>;
	children: React.ReactNode;
	loading?: boolean;
	loadFailed?: boolean;
	empty?: string;
	rightAction?: React.ReactNode;
}) {
	return (
		<div className="rounded-lg border border-slate-200 bg-white">
			<div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
				<div className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
					<Icon className="w-3 h-3 text-indigo-500" />
					{title}
				</div>
				{rightAction}
			</div>
			{loading ? (
				<div className="px-3 py-6 text-xs text-muted-foreground flex items-center justify-center gap-2">
					<Loader2 className="w-3 h-3 animate-spin" />
					Loading…
				</div>
			) : loadFailed ? (
				<div className="px-3 py-6 text-xs text-muted-foreground text-center">
					Couldn't load.
				</div>
			) : empty ? (
				<div className="px-3 py-6 text-xs text-muted-foreground text-center">{empty}</div>
			) : (
				children
			)}
		</div>
	);
}

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
