import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Database,
	Key,
	Loader2,
	Lock,
	Package,
	Server,
	Shield,
	TrendingUp,
} from 'lucide-react';
import {
	fetchAuthStats,
	fetchBackupStatus,
	fetchBuildStatus,
	fetchCertExpiry,
	fetchOAuthClients,
	fetchQASummary,
	type AuthStats,
	type BackupStatus,
	type BuildStatus,
	type CertExpiry,
	type OAuthClientsResp,
	type QASummary,
} from '@/api/super-admin';
import { listAudit, listUsers, type AdminUserRow, type AuditEntry } from '@/api/users';
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
	qa: QASummary | null;
	certs: CertExpiry | null;
	backups: BackupStatus | null;
	builds: BuildStatus | null;
	oauth: OAuthClientsResp | null;
	users: { rows: AdminUserRow[]; total: number } | null;
	audit: AuditEntry[] | null;
}

export default function SuperAdminDashboard() {
	const [snap, setSnap] = useState<Snap>({
		auth: null,
		qa: null,
		certs: null,
		backups: null,
		builds: null,
		oauth: null,
		users: null,
		audit: null,
	});
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const results = await Promise.allSettled([
				fetchAuthStats(),
				fetchQASummary(),
				fetchCertExpiry(),
				fetchBackupStatus(),
				fetchBuildStatus(),
				fetchOAuthClients(),
				listUsers({ page_size: 1, status: 'all' }),
				listAudit({ page_size: 12 }),
			]);
			if (cancelled) return;
			for (const r of results) {
				if (r.status === 'rejected' && isSessionExpired(r.reason)) return;
			}
			const [auth, qa, certs, backups, builds, oauth, users, audit] = results;
			setSnap({
				auth:    auth.status    === 'fulfilled' ? auth.value    : null,
				qa:      qa.status      === 'fulfilled' ? qa.value      : null,
				certs:   certs.status   === 'fulfilled' ? certs.value   : null,
				backups: backups.status === 'fulfilled' ? backups.value : null,
				builds:  builds.status  === 'fulfilled' ? builds.value  : null,
				oauth:   oauth.status   === 'fulfilled' ? oauth.value   : null,
				users:   users.status   === 'fulfilled'
					? { rows: users.value.users, total: users.value.total }
					: null,
				audit:   audit.status   === 'fulfilled' ? audit.value.entries : null,
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
				<RecentAudit entries={snap.audit} />
			</Section>

			<Section icon={TrendingUp} label="QuantArena">
				<div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
					<QAStrategiesTile qa={snap.qa} />
					<QACompetitionsTile qa={snap.qa} />
					<QATradesTile qa={snap.qa} />
				</div>
			</Section>

			<Section icon={Server} label="Infrastructure">
				<div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
					<CertExpiryTile certs={snap.certs} />
					<BackupStatusTile backups={snap.backups} />
					<BuildStatusTile builds={snap.builds} />
				</div>
				<div className="grid gap-3 lg:grid-cols-2 mt-4">
					<GrafanaEmbed
						src="/d-solo/cadvisor/cadvisor?panelId=1"
						title="Container CPU (Grafana)"
					/>
					<GrafanaEmbed
						src="/d-solo/node-exporter/node-exporter?panelId=1"
						title="Host disk (Grafana)"
					/>
				</div>
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

// ---- QA tiles ----

function QAStrategiesTile({ qa }: { qa: QASummary | null }) {
	if (!qa) return <Tile icon={Activity} label="Strategies" primary="—" />;
	return (
		<Tile
			icon={Activity}
			label="Strategies"
			primary={qa.strategies.total.toLocaleString()}
			secondary={`${qa.strategies.active} active`}
		/>
	);
}

function QACompetitionsTile({ qa }: { qa: QASummary | null }) {
	if (!qa) return <Tile icon={TrendingUp} label="Competitions" primary="—" />;
	return (
		<Tile
			icon={TrendingUp}
			label="Competitions"
			primary={qa.competitions.ongoing.toLocaleString()}
			secondary={`${qa.competitions.upcoming} upcoming · ${qa.competitions.total} total`}
		/>
	);
}

function QATradesTile({ qa }: { qa: QASummary | null }) {
	if (!qa) return <Tile icon={TrendingUp} label="Trades (24h)" primary="—" />;
	return (
		<Tile
			icon={TrendingUp}
			label="Trades (24h)"
			primary={qa.trades_24h.count.toLocaleString()}
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
				secondary={builds.note ?? 'no data'}
			/>
		);
	}
	const pending = builds.services.filter((s) => s.pending_update).length;
	return (
		<Tile
			icon={Package}
			label="Builds"
			primary={`${builds.services.length} services`}
			secondary={pending > 0 ? `${pending} pending update` : 'all current'}
			tone={pending > 0 ? 'warn' : 'good'}
		/>
	);
}

// ---- Recent audit feed ----

function RecentAudit({ entries }: { entries: AuditEntry[] | null }) {
	if (!entries) return null;
	return (
		<div className="mt-4 bg-white border border-gray-200 rounded">
			<div className="px-3 py-2 border-b text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
				<Clock className="w-3 h-3" />
				Recent admin actions
			</div>
			<div className="divide-y divide-gray-100">
				{entries.slice(0, 8).map((e) => (
					<div key={e.id} className="px-3 py-1.5 text-xs flex items-center gap-2">
						<span className="font-mono text-gray-500 w-32 shrink-0">
							{new Date(e.created_at).toLocaleString(undefined, {
								month: 'short',
								day: 'numeric',
								hour: '2-digit',
								minute: '2-digit',
							})}
						</span>
						<span className="font-medium text-gray-700 w-20 shrink-0">{e.event}</span>
						<span className="text-gray-600 truncate">{e.method} {e.path}</span>
						<span className={`ml-auto font-mono text-xs ${
							(e.status ?? 0) >= 400 ? 'text-red-600' : 'text-gray-400'
						}`}>{e.status ?? '—'}</span>
					</div>
				))}
			</div>
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
