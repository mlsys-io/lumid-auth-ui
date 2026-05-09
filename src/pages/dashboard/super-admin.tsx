import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Database,
	Key,
	Loader2,
	Lock,
	Package,
	RefreshCcw,
	Server,
	Shield,
} from 'lucide-react';
import {
	fetchAuthStats,
	fetchBackupStatus,
	fetchBuildStatus,
	fetchCertExpiry,
	fetchLoops,
	fetchOAuthClients,
	type AuthStats,
	type BackupStatus,
	type BuildStatus,
	type CertExpiry,
	type BuildService,
	type LoopsResp,
	type OAuthClientsResp,
} from '@/api/super-admin';
import { listUsers, type AdminUserRow } from '@/api/users';
import { isSessionExpired } from '@/api/client';
import { GrafanaEmbed } from '@/components/grafana-embed';

// /dashboard/super-admin — single-page operational + business pane of
// glass for super_admin role. AppLayout supplies the sidebar; this
// page is content-only.
//
// Tile groups (left to right, top to bottom):
//   Identity      users, audit, auth volume, oauth clients
//   QuantArena    strategies / competitions / 24h trade volume
//   Infra (live)  cert expiry per domain, backup status, build status
//   Infra (graphs) two embedded Grafana panels: container health + disk
//
// Each tile fetches its own slice via Promise.allSettled — a 5xx on
// one endpoint must not blank the page.

interface Snap {
	auth: AuthStats | null;
	certs: CertExpiry | null;
	backups: BackupStatus | null;
	builds: BuildStatus | null;
	oauth: OAuthClientsResp | null;
	users: { rows: AdminUserRow[]; total: number } | null;
	loops: LoopsResp | null;
}

export default function SuperAdminDashboard() {
	const [snap, setSnap] = useState<Snap>({
		auth: null,
		certs: null,
		backups: null,
		builds: null,
		oauth: null,
		users: null,
		loops: null,
	});
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const results = await Promise.allSettled([
				fetchAuthStats(),
				fetchCertExpiry(),
				fetchBackupStatus(),
				fetchBuildStatus(),
				fetchOAuthClients(),
				listUsers({ page_size: 1, status: 'all' }),
				fetchLoops(),
			]);
			if (cancelled) return;
			for (const r of results) {
				if (r.status === 'rejected' && isSessionExpired(r.reason)) return;
			}
			const [auth, certs, backups, builds, oauth, users, loops] = results;
			setSnap({
				auth:    auth.status    === 'fulfilled' ? auth.value    : null,
				certs:   certs.status   === 'fulfilled' ? certs.value   : null,
				backups: backups.status === 'fulfilled' ? backups.value : null,
				builds:  builds.status  === 'fulfilled' ? builds.value  : null,
				oauth:   oauth.status   === 'fulfilled' ? oauth.value   : null,
				users:   users.status   === 'fulfilled'
					? { rows: users.value.users, total: users.value.total }
					: null,
				loops:   loops.status   === 'fulfilled' ? loops.value   : null,
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
					<h1 className="text-xl font-semibold">Super-admin overview</h1>
					<p className="text-xs text-muted-foreground mt-0.5">
						Single pane of glass · refreshed on page load
					</p>
				</div>
				{loading && (
					<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
				)}
			</div>

			<Section icon={Shield} label="Identity">
				<div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
					<UsersTile users={snap.users} />
					<AuthVolumeTile auth={snap.auth} />
					<FailedLoginsTile auth={snap.auth} />
					<OAuthClientsTile oauth={snap.oauth} />
				</div>
			</Section>

			<Section icon={Server} label="Infrastructure">
				<div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
					<CertExpiryTile certs={snap.certs} />
					<BackupStatusTile backups={snap.backups} />
					<BuildStatusTile builds={snap.builds} />
				</div>
				<BuildStatusTable builds={snap.builds} />
				<div className="grid gap-3 lg:grid-cols-2 mt-4">
					<GrafanaEmbed
						src="/d-solo/lumid-ops/lumid-ops?panelId=21"
						title="Container restart rate (Grafana)"
					/>
					<GrafanaEmbed
						src="/d-solo/lumid-ops/lumid-ops?panelId=30"
						title="Host disk usage (Grafana)"
					/>
				</div>
			</Section>

			<Section icon={Activity} label="Autoresearch loops">
				<LoopStatusTile loops={snap.loops} />
			</Section>
		</div>
	);
}

// ---- section wrapper ----

function Section({
	icon: Icon,
	label,
	children,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<section>
			<h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-3 flex items-center gap-1.5">
				<Icon className="w-3 h-3" />
				{label}
			</h2>
			{children}
		</section>
	);
}

// ---- generic tile shell ----

interface TileProps {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	to?: string;
	primary: React.ReactNode;
	secondary?: React.ReactNode;
	tone?: 'default' | 'good' | 'warn' | 'bad';
}

function Tile({ icon: Icon, label, to, primary, secondary, tone = 'default' }: TileProps) {
	const toneCls =
		tone === 'good'
			? 'border-l-green-500'
			: tone === 'warn'
				? 'border-l-amber-500'
				: tone === 'bad'
					? 'border-l-red-500'
					: 'border-l-indigo-500';
	const inner = (
		<div className={`bg-white border border-gray-200 border-l-4 ${toneCls} rounded p-4 hover:shadow-sm transition`}>
			<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
				<Icon className="w-3 h-3" />
				{label}
			</div>
			<div className="text-2xl font-semibold leading-tight">{primary}</div>
			{secondary && (
				<div className="text-xs text-muted-foreground mt-1">{secondary}</div>
			)}
		</div>
	);
	return to ? <Link to={to}>{inner}</Link> : inner;
}

// ---- Identity tiles ----

function UsersTile({ users }: { users: Snap['users'] }) {
	if (!users) return <Tile icon={Shield} label="Users" primary="—" />;
	return (
		<Tile
			icon={Shield}
			label="Users"
			to="/dashboard/admin/users"
			primary={users.total.toLocaleString()}
			secondary="active accounts"
		/>
	);
}

function AuthVolumeTile({ auth }: { auth: AuthStats | null }) {
	if (!auth) return <Tile icon={Activity} label="Logins (24h)" primary="—" />;
	return (
		<Tile
			icon={Activity}
			label="Logins (24h)"
			primary={auth.login.total.toLocaleString()}
			secondary={`${auth.oauth.total} via OAuth`}
		/>
	);
}

function FailedLoginsTile({ auth }: { auth: AuthStats | null }) {
	if (!auth) return <Tile icon={AlertTriangle} label="Failed logins (24h)" primary="—" />;
	const failed = auth.login.failed + auth.oauth.failed;
	const tone: TileProps['tone'] = failed === 0 ? 'good' : failed < 10 ? 'warn' : 'bad';
	return (
		<Tile
			icon={AlertTriangle}
			label="Failed logins (24h)"
			primary={failed.toLocaleString()}
			secondary={<Sparkline values={auth.hourly.map((h) => h.failed)} />}
			tone={tone}
		/>
	);
}

function OAuthClientsTile({ oauth }: { oauth: OAuthClientsResp | null }) {
	if (!oauth) return <Tile icon={Lock} label="OAuth clients" primary="—" />;
	return (
		<Tile
			icon={Lock}
			label="OAuth clients"
			primary={oauth.total}
			secondary={oauth.clients
				.slice(0, 4)
				.map((c) => c.client_id)
				.join(', ')}
		/>
	);
}


// ---- Infra tiles ----

function CertExpiryTile({ certs }: { certs: CertExpiry | null }) {
	if (!certs) return <Tile icon={Key} label="Cert expiry" primary="—" />;
	const min = certs.certificates.reduce(
		(m, c) => (m === null || c.days_left < m ? c.days_left : m),
		null as number | null,
	);
	const tone: TileProps['tone'] =
		min === null ? 'default' : min < 14 ? 'bad' : min < 30 ? 'warn' : 'good';
	return (
		<div className={`bg-white border border-gray-200 border-l-4 rounded p-4 ${
			tone === 'good' ? 'border-l-green-500' :
			tone === 'warn' ? 'border-l-amber-500' :
			tone === 'bad'  ? 'border-l-red-500' :
			'border-l-indigo-500'
		}`}>
			<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
				<Key className="w-3 h-3" />
				Cert expiry
			</div>
			<div className="text-2xl font-semibold mb-2">
				{min === null ? '—' : `${min}d`}
				<span className="text-xs text-muted-foreground font-normal ml-2">
					soonest
				</span>
			</div>
			<div className="space-y-0.5 text-xs">
				{certs.certificates.slice(0, 5).map((c) => (
					<div key={c.domain} className="flex justify-between">
						<span className="font-mono text-gray-700">{c.domain}</span>
						<span className={
							c.days_left < 14 ? 'text-red-600 font-medium' :
							c.days_left < 30 ? 'text-amber-600' :
							'text-gray-500'
						}>{c.days_left}d</span>
					</div>
				))}
			</div>
		</div>
	);
}

function BackupStatusTile({ backups }: { backups: BackupStatus | null }) {
	if (!backups) return <Tile icon={Database} label="Backups" primary="—" />;
	const allHealthy = backups.jobs.every((j) => j.healthy) && backups.verify.healthy;
	const tone: TileProps['tone'] = allHealthy ? 'good' : 'bad';
	return (
		<div className={`bg-white border border-gray-200 border-l-4 rounded p-4 ${
			tone === 'good' ? 'border-l-green-500' : 'border-l-red-500'
		}`}>
			<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
				<Database className="w-3 h-3" />
				Backups
			</div>
			<div className="text-2xl font-semibold mb-2 flex items-center gap-2">
				{allHealthy ? (
					<>
						<CheckCircle2 className="w-5 h-5 text-green-600" />
						healthy
					</>
				) : (
					<>
						<AlertTriangle className="w-5 h-5 text-red-600" />
						attention
					</>
				)}
			</div>
			<div className="space-y-0.5 text-xs">
				{backups.jobs.map((j) => (
					<div key={j.job} className="flex justify-between">
						<span className="font-mono text-gray-700">{j.job}</span>
						<span className={j.healthy ? 'text-gray-500' : 'text-red-600 font-medium'}>
							{j.age_hours}h ago
						</span>
					</div>
				))}
				<div className="flex justify-between pt-1 border-t border-gray-100 mt-1">
					<span className="text-gray-700">verify</span>
					<span className={backups.verify.healthy ? 'text-green-600' : 'text-red-600 font-medium'}>
						{backups.verify.healthy ? 'pass' : 'FAIL'}
					</span>
				</div>
			</div>
		</div>
	);
}

function BuildStatusTile({ builds }: { builds: BuildStatus | null }) {
	if (!builds) return <Tile icon={Package} label="Builds" primary="—" />;
	if (builds.services.length === 0) {
		return (
			<Tile
				icon={Package}
				label="Builds"
				primary="—"
				secondary={builds.note ?? 'snapshot pending'}
			/>
		);
	}
	const total = builds.services.length;
	const stale = builds.snapshot_age > 60;
	const tone: TileProps['tone'] = stale ? 'warn' : 'good';
	const ageStr =
		builds.snapshot_age < 0
			? '—'
			: builds.snapshot_age === 0
				? 'just now'
				: `${builds.snapshot_age}m ago`;
	return (
		<Tile
			icon={Package}
			label="Builds"
			primary={`${total} services`}
			secondary={`snapshot ${ageStr}`}
			tone={tone}
		/>
	);
}

// Detail table — shows per-service container + image state.
function BuildStatusTable({ builds }: { builds: BuildStatus | null }) {
	if (!builds || builds.services.length === 0) return null;
	const fmtRelative = (iso: string): string => {
		if (!iso) return '—';
		const t = new Date(iso).getTime();
		if (Number.isNaN(t)) return '—';
		const m = Math.round((Date.now() - t) / 60000);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m`;
		const h = Math.round(m / 60);
		if (h < 48) return `${h}h`;
		return `${Math.round(h / 24)}d`;
	};
	return (
		<div className="mt-4 bg-white border border-gray-200 rounded">
			<div className="px-3 py-2 border-b text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
				<Package className="w-3 h-3" />
				Build &amp; deploy state
				{builds.snapshot_age >= 0 && (
					<span className="ml-2 text-[10px] font-normal text-gray-400">
						snapshot {builds.snapshot_age}m ago
					</span>
				)}
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-xs">
					<thead className="bg-gray-50 text-gray-500">
						<tr>
							<th className="text-left px-3 py-1.5 font-medium">Service</th>
							<th className="text-left px-3 py-1.5 font-medium">Container</th>
							<th className="text-left px-3 py-1.5 font-medium">Image</th>
							<th className="text-left px-3 py-1.5 font-medium">Image age</th>
							<th className="text-left px-3 py-1.5 font-medium">Container age</th>
							<th className="text-left px-3 py-1.5 font-medium">State</th>
							<th className="text-left px-3 py-1.5 font-medium">Last build sha</th>
							<th className="text-left px-3 py-1.5 font-medium">Cron last fired</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-100">
						{builds.services.map((s) => {
							const containerOk =
								s.container_status &&
								s.container_status.toLowerCase().startsWith('up');
							return (
								<tr key={s.service} className="hover:bg-gray-50">
									<td className="px-3 py-1.5 font-medium text-gray-700">{s.service}</td>
									<td className="px-3 py-1.5">
										<span className={containerOk ? 'text-green-700' : 'text-red-600'}>
											{containerOk ? '●' : '○'}
										</span>{' '}
										<span className="text-gray-500">{s.container_status || '—'}</span>
									</td>
									<td className="px-3 py-1.5 font-mono text-[11px] text-gray-700">
										<span title={s.image_id}>{s.image || '—'}</span>
										{s.image_size && (
											<span className="text-gray-400 ml-1">{s.image_size}</span>
										)}
									</td>
									<td className="px-3 py-1.5 text-gray-600" title={s.image_created}>
										{fmtRelative(s.image_created)}
									</td>
									<td className="px-3 py-1.5 text-gray-600" title={s.container_started}>
										{fmtRelative(s.container_started)}
									</td>
									<td className="px-3 py-1.5">
										<StateBadges svc={s} />
									</td>
									<td className="px-3 py-1.5 font-mono text-[11px] text-gray-600">
										{s.last_built_sha || '—'}
									</td>
									<td className="px-3 py-1.5 text-gray-600" title={s.last_built_at}>
										{fmtRelative(s.last_built_at)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// ---- Per-service status badges ----

function StateBadges({ svc }: { svc: BuildService }) {
	const updateColor =
		svc.update_pending === 'true'
			? 'bg-amber-100 text-amber-700 border-amber-200'
			: svc.update_pending === 'false'
				? 'bg-green-100 text-green-700 border-green-200'
				: 'bg-gray-100 text-gray-500 border-gray-200';
	const updateLabel =
		svc.update_pending === 'true'
			? 'update'
			: svc.update_pending === 'false'
				? 'current'
				: 'no GHCR';
	return (
		<div className="flex items-center gap-1">
			<span
				className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${updateColor}`}
				title={
					svc.update_pending === 'true'
						? `GHCR has a newer image (${svc.ghcr_digest.slice(0, 12)}…) than what's running locally (${svc.local_digest.slice(0, 12)}…)`
						: svc.update_pending === 'false'
							? `Local image matches GHCR digest ${svc.ghcr_digest.slice(0, 12)}…`
							: 'Image not yet on GHCR (or docker not logged in)'
				}
			>
				{updateLabel}
			</span>
			{svc.restart_pending && (
				<span
					className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border bg-rose-100 text-rose-700 border-rose-200"
					title="Image was built/pulled AFTER the running container started — restart needed to pick up the new bits"
				>
					<RefreshCcw className="w-2.5 h-2.5" />
					restart
				</span>
			)}
		</div>
	);
}

// ---- Sparkline (24-bar) ----

function Sparkline({ values }: { values: number[] }) {
	const max = Math.max(...values, 1);
	return (
		<div className="flex items-end gap-px h-4 mt-1">
			{values.map((v, i) => (
				<div
					key={i}
					className="w-0.5 bg-gray-300"
					style={{ height: `${(v / max) * 100}%`, minHeight: 1 }}
					title={`${v}`}
				/>
			))}
		</div>
	);
}

// ── LoopStatusTile ─────────────────────────────────────────────────
//
// Status visibility for the autoresearch loop layer. Reads from
// /api/v1/admin/loops which aggregates the lumid-scheduler daemon's
// state.json with per-app .scheduler.json indices.

function LoopStatusTile({ loops }: { loops: LoopsResp | null }) {
	if (!loops) return <Tile icon={Activity} label="Loops" primary="—" />;
	const { summary, scheduler_daemon, loops: rows } = loops;
	const totalScheduled = summary.ok + summary.failing + summary.stale + summary.never;
	const allHealthy = summary.failing === 0 && summary.stale === 0;
	const tone = scheduler_daemon !== 'running'
		? 'bad'
		: allHealthy ? 'good' : 'bad';

	const fmtAge = (ts: number) => {
		if (!ts) return '—';
		const ageS = Math.max(0, Math.floor(Date.now() / 1000 - ts));
		if (ageS < 60)        return `${ageS}s ago`;
		if (ageS < 3600)      return `${Math.floor(ageS / 60)}m ago`;
		if (ageS < 86400)     return `${Math.floor(ageS / 3600)}h ago`;
		return `${Math.floor(ageS / 86400)}d ago`;
	};
	const statusColor = (s: string) => ({
		ok:      'text-green-600',
		never:   'text-gray-400',
		failing: 'text-red-600 font-medium',
		stale:   'text-amber-600',
		manual:  'text-gray-500',
	}[s] || 'text-gray-500');

	return (
		<div className={`bg-white border border-gray-200 border-l-4 rounded p-4 ${
			tone === 'good' ? 'border-l-green-500' : 'border-l-red-500'
		}`}>
			<div className="flex items-center justify-between mb-3">
				<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
					<Activity className="w-3 h-3" />
					Loops · scheduler daemon: {scheduler_daemon === 'running'
						? <span className="text-green-600 font-medium">running</span>
						: <span className="text-amber-600 font-medium">not installed</span>}
				</div>
				<div className="text-xs text-muted-foreground">
					{summary.ok}/{totalScheduled} ok ·
					{' '}{summary.failing} failing ·
					{' '}{summary.stale} stale ·
					{' '}{summary.never} never ·
					{' '}{summary.manual} manual
				</div>
			</div>
			{rows.length === 0 ? (
				<div className="text-sm text-muted-foreground py-4 text-center">
					No loops declared on this host. Install an xpio app with{' '}
					<code className="text-xs">/lumid app install …</code>
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
							<tr className="border-b border-gray-100">
								<th className="text-left font-medium py-1.5 pr-3">app</th>
								<th className="text-left font-medium py-1.5 pr-3">loop</th>
								<th className="text-left font-medium py-1.5 pr-3">schedule</th>
								<th className="text-left font-medium py-1.5 pr-3">declared in</th>
								<th className="text-left font-medium py-1.5 pr-3">status</th>
								<th className="text-left font-medium py-1.5">last run</th>
							</tr>
						</thead>
						<tbody className="font-mono">
							{rows.map((r) => (
								<tr key={`${r.app}:${r.loop}`} className="border-b border-gray-50 last:border-0">
									<td className="py-1.5 pr-3 text-gray-700">{r.app}</td>
									<td className="py-1.5 pr-3 text-gray-700">{r.loop}</td>
									<td className="py-1.5 pr-3 text-gray-500">{r.schedule || '—'}</td>
									<td className="py-1.5 pr-3 text-gray-400">{r.declared_in}</td>
									<td className={`py-1.5 pr-3 ${statusColor(r.status)}`}>
										{r.status}
										{r.consecutive_failures > 0 && (
											<span className="ml-1 text-[10px] text-red-500">
												(×{r.consecutive_failures})
											</span>
										)}
									</td>
									<td className="py-1.5 text-gray-500">{fmtAge(r.last_run_ts)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
