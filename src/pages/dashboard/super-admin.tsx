import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Cpu,
	Database,
	GitBranch,
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
	fetchTenants,
	type TenantsResp,
	fetchBackupStatus,
	fetchBuildStatus,
	fetchCertExpiry,
	fetchCodebaseRepos,
	fetchLoops,
	fetchOAuthClients,
	type AuthStats,
	type BackupStatus,
	type BuildStatus,
	type CertExpiry,
	type BuildService,
	type CodebaseReposResp,
	type LoopsResp,
	type OAuthClientsResp,
} from '@/api/super-admin';
import { listUsers, type AdminUserRow } from '@/api/users';
import { isSessionExpired } from '@/api/client';
import { GrafanaEmbed } from '@/components/grafana-embed';
import { SysResearchTile } from '@/components/dashboard/SysResearchTile';

// /studio/super-admin — single-page operational + business pane of
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

// useCollapse — persistent expand/collapse toggle, keyed in
// localStorage so each operator's preferences stick across reloads.
// Used by Telemetry, BuildStatusTable, CodebaseReposTile, LoopStatusTile.
function useCollapse(key: string, defaultCollapsed = true): [boolean, () => void] {
	const storeKey = `super-admin:${key}`;
	const [collapsed, setCollapsed] = useState(() => {
		if (typeof localStorage === 'undefined') return defaultCollapsed;
		const v = localStorage.getItem(storeKey);
		if (v === '1') return true;
		if (v === '0') return false;
		return defaultCollapsed;
	});
	const toggle = () => {
		setCollapsed((prev) => {
			const next = !prev;
			try { localStorage.setItem(storeKey, next ? '1' : '0'); } catch { /* private mode */ }
			return next;
		});
	};
	return [collapsed, toggle];
}

interface Snap {
	auth: AuthStats | null;
	certs: CertExpiry | null;
	backups: BackupStatus | null;
	builds: BuildStatus | null;
	oauth: OAuthClientsResp | null;
	users: { rows: AdminUserRow[]; total: number } | null;
	loops: LoopsResp | null;
	codebase: CodebaseReposResp | null;
	tenants: TenantsResp | null;
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
		codebase: null,
		tenants: null,
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
				fetchCodebaseRepos(),
				fetchTenants(),
			]);
			if (cancelled) return;
			for (const r of results) {
				if (r.status === 'rejected' && isSessionExpired(r.reason)) return;
			}
			const [auth, certs, backups, builds, oauth, users, loops, codebase, tenants] = results;
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
				codebase: codebase.status === 'fulfilled' ? codebase.value : null,
				tenants: tenants.status === 'fulfilled' ? tenants.value : null,
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
				{/* Page identity lives in the top strip (deriveMeta /dashboard fallback). */}
				<p className="text-xs text-muted-foreground">
					Single pane of glass · refreshed on page load
				</p>
				{loading && (
					<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
				)}
			</div>

			{/* 1. Operational health — what would page someone right now */}
			<Section icon={Server} label="Operational health">
				<div className="grid gap-3 grid-cols-1 lg:grid-cols-3">
					<CertExpiryTile certs={snap.certs} />
					<BackupStatusTile backups={snap.backups} />
					<BuildStatusTile builds={snap.builds} />
				</div>
				<BuildStatusTable builds={snap.builds} />
			</Section>

			{/* 2. Source state — codebase + xpio app bundles. Both are
			    publish-state visibility, so they live together. */}
			<Section icon={GitBranch} label="Source">
				<CodebaseReposTile codebase={snap.codebase} />
			</Section>

			{/* 3. Autoresearch — the loops table (which already shows the
			    per-app git status row at its top). */}
			<Section icon={Activity} label="Autoresearch loops">
				<LoopStatusTile loops={snap.loops} />
			</Section>

			{/* 3b. SysResearch — focused tile for auto-sysresearch's
			    three loops with the headline metric pulled inline from
			    each loop's latest score.json / drift.json. */}
			<Section icon={Cpu} label="SysResearch">
				<SysResearchTile loops={snap.loops} />
			</Section>

			{/* 4. Identity — usage + access context, less urgent than health.
			    The 4 small tiles fold cleanly here. */}
			<Section icon={Shield} label="Identity">
				<div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
					<UsersTile users={snap.users} />
					<AuthVolumeTile auth={snap.auth} />
					<FailedLoginsTile auth={snap.auth} />
					<OAuthClientsTile oauth={snap.oauth} />
				</div>
				<TenantsTile tenants={snap.tenants} />
			</Section>

			{/* 5. Telemetry — stat strip default; timeseries + Loki log
			    panel are tucked behind a chevron. The Open-in-Grafana
			    link stays visible in both states for full drill-down. */}
			<Section icon={Activity} label="Telemetry">
				<TelemetrySection />
			</Section>

			{/* Build provenance — what commit of this bundle is actually
			    running (code↔running-binary drift gap). Baked at build time
			    via vite `define` (__BUILD_COMMIT__ / __BUILD_TIME__). */}
			<p className="text-[10px] text-muted-foreground/60 text-right">
				build {__BUILD_COMMIT__} · {__BUILD_TIME__}
			</p>
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
			to="/studio/admin/users"
			primary={users.total.toLocaleString()}
			secondary="active accounts"
		/>
	);
}

// Phase D follow-up — per-tenant operational snapshot. Surfaces who's
// running what, how much storage they use, and today's cycle / LLM
// activity. Sorted by cycles_today desc so active tenants float up.
function TenantsTile({ tenants }: { tenants: TenantsResp | null }) {
	if (!tenants) return (
		<div className="rounded-lg border border-slate-200 bg-white p-4 mt-3">
			<div className="text-sm text-slate-500 italic">Loading tenants…</div>
		</div>
	);
	const rows = [...tenants.tenants].sort(
		(a, b) => (b.cycles_today || 0) - (a.cycles_today || 0),
	);
	const active = rows.filter((t) => t.apps > 0 || t.cycles_today > 0);
	return (
		<div className="rounded-lg border border-slate-200 bg-white mt-3 overflow-hidden">
			<div className="px-4 py-3 border-b border-slate-200/60 flex items-baseline justify-between">
				<h3 className="text-sm font-semibold">Tenants</h3>
				<span className="text-xs text-slate-500">
					{active.length} active · {rows.length} total
				</span>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs text-slate-600 uppercase tracking-wide">
						<tr>
							<th className="px-3 py-2 font-medium">Email</th>
							<th className="px-3 py-2 font-medium w-20">Apps</th>
							<th className="px-3 py-2 font-medium w-24">Storage</th>
							<th className="px-3 py-2 font-medium w-20">Cycles</th>
							<th className="px-3 py-2 font-medium w-28">LLM today</th>
							<th className="px-3 py-2 font-medium w-20">Gmail</th>
							<th className="px-3 py-2 font-medium">Joined</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.slice(0, 30).map((t) => (
							<tr key={t.sub} className="hover:bg-slate-50/60">
								<td className="px-3 py-1.5 font-mono text-xs">
									{t.email}
									{t.role !== 'user' && (
										<span className="ml-2 text-[10px] uppercase tracking-wide text-indigo-700">{t.role}</span>
									)}
								</td>
								<td className="px-3 py-1.5 text-xs">
									{t.apps}
									{t.apps > 0 && t.app_names && (
										<span className="ml-1 text-slate-400" title={t.app_names.join(', ')}>
											({t.app_names.slice(0, 2).join(', ')}{t.app_names.length > 2 && '…'})
										</span>
									)}
								</td>
								<td className="px-3 py-1.5 text-xs text-slate-600 tabular-nums">
									{t.storage_mb.toFixed(1)} MB
								</td>
								<td className="px-3 py-1.5 text-xs tabular-nums">
									{t.cycles_today}/100
								</td>
								<td className="px-3 py-1.5 text-xs tabular-nums text-slate-600">
									{(t.llm_tokens_today / 1000).toFixed(0)}K
								</td>
								<td className="px-3 py-1.5 text-xs tabular-nums text-slate-600">
									{t.gmail_today}
								</td>
								<td className="px-3 py-1.5 text-xs text-slate-500">
									{new Date(t.created_at).toISOString().slice(0, 10)}
								</td>
							</tr>
						))}
						{rows.length === 0 && (
							<tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500 italic">No tenants yet.</td></tr>
						)}
					</tbody>
				</table>
			</div>
			{rows.length > 30 && (
				<div className="px-3 py-2 text-xs text-slate-500 border-t border-slate-200/60">
					Showing top 30 by cycles_today (of {rows.length})
				</div>
			)}
		</div>
	);
}

function AuthVolumeTile({ auth }: { auth: AuthStats | null }) {
	if (!auth) return <Tile icon={Activity} label="Logins (24h)" primary="—" />;
	return (
		<Tile
			icon={Activity}
			label="Logins (24h)"
			to="/studio/admin/audit?event=login"
			primary={auth.login.total.toLocaleString()}
			secondary={`${auth.oauth.total} via OAuth · click for full audit log`}
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
			to="/studio/admin/audit?event=login_failed"
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
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	if (!certs) return <Tile icon={Key} label="Cert expiry" primary="—" />;
	const min = certs.certificates.reduce(
		(m, c) => (m === null || c.days_left < m ? c.days_left : m),
		null as number | null,
	);
	const tone: TileProps['tone'] =
		min === null ? 'default' : min < 14 ? 'bad' : min < 30 ? 'warn' : 'good';
	const toggle = (k: string) => setExpanded((p) => {
		const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n;
	});
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
				{certs.certificates.slice(0, 5).map((c) => {
					const open = expanded.has(c.domain);
					return (
						<div key={c.domain}>
							<div
								className="flex justify-between cursor-pointer hover:bg-gray-50 px-1 -mx-1 rounded"
								onClick={() => toggle(c.domain)}
							>
								<span className="font-mono text-gray-700">
									<span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>
									{c.domain}
								</span>
								<span className={
									c.days_left < 14 ? 'text-red-600 font-medium' :
									c.days_left < 30 ? 'text-amber-600' :
									'text-gray-500'
								}>{c.days_left}d</span>
							</div>
							{open && (
								<div className="px-2 py-1.5 mt-0.5 bg-gray-50 rounded text-[10px] text-gray-600 space-y-0.5 font-mono">
									<div>expires_at: <span className="text-gray-700">{c.expires_at}</span></div>
									<div>cert path: <code>/etc/letsencrypt/live/{c.domain}/fullchain.pem</code></div>
									<div className="pt-1 text-muted-foreground">force renew now:</div>
									<code className="block bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700">
										docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /var/www/certbot:/var/www/certbot certbot/certbot renew --cert-name {c.domain} --force-renewal
									</code>
									<div className="pt-1 text-muted-foreground">reload nginx after renew:</div>
									<code className="block bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700">
										/proj/infra/scripts/reload-cert-nginxes.sh
									</code>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function BackupStatusTile({ backups }: { backups: BackupStatus | null }) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	if (!backups) return <Tile icon={Database} label="Backups" primary="—" />;
	const allHealthy = backups.jobs.every((j) => j.healthy) && backups.verify.healthy;
	const tone: TileProps['tone'] = allHealthy ? 'good' : 'bad';
	const toggle = (k: string) => setExpanded((p) => {
		const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n;
	});
	// Map job → component name for `lumid host restore <component>`. The
	// six restore-able components are: dbs/secrets/xpio/apps/compose/full.
	// Some heartbeat job names don't map (auto-build-ghcr, ops, etc. —
	// those aren't user-restorable; skip the action line for them).
	const restoreFor = (job: string): string | null => {
		if (job === 'databases')        return 'dbs';
		if (job === 'secrets')          return 'secrets';
		if (job === 'xpio')             return 'xpio';
		if (job === 'apps')             return 'apps';
		if (job === 'compose')          return 'compose';
		if (job === 'full')             return 'full';
		return null;
	};
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
				{backups.jobs.map((j) => {
					const open = expanded.has(j.job);
					const component = restoreFor(j.job);
					return (
						<div key={j.job}>
							<div
								className="flex justify-between cursor-pointer hover:bg-gray-50 px-1 -mx-1 rounded"
								onClick={() => toggle(j.job)}
							>
								<span className="font-mono text-gray-700">
									<span className="text-gray-400 mr-1">{open ? '▾' : '▸'}</span>
									{j.job}
								</span>
								<span className={j.healthy ? 'text-gray-500' : 'text-red-600 font-medium'}>
									{j.age_hours}h ago
								</span>
							</div>
							{open && (
								<div className="px-2 py-1.5 mt-0.5 bg-gray-50 rounded text-[10px] text-gray-600 space-y-0.5 font-mono">
									<div>last_run: <span className="text-gray-700">{j.last_run}</span></div>
									<div>NAS path: <code>/nfss/lumid-backups/{j.job}/</code></div>
									{component && (
										<>
											<div className="pt-1 text-muted-foreground">backup now:</div>
											<code className="block bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700">
												/lumid host backup {component}
											</code>
											<div className="pt-1 text-muted-foreground">restore latest (interactive):</div>
											<code className="block bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700">
												/lumid host restore {component} latest
											</code>
										</>
									)}
									{!component && (
										<div className="pt-1 text-amber-700">
											(operational heartbeat — not a user-restorable backup component)
										</div>
									)}
								</div>
							)}
						</div>
					);
				})}
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
// Default-collapsed to a 1-line summary; click the header to expand.
function BuildStatusTable({ builds }: { builds: BuildStatus | null }) {
	const [collapsed, toggle] = useCollapse('build-table', true);
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
	const total = builds.services.length;
	const up = builds.services.filter(
		(s) => s.container_status && s.container_status.toLowerCase().startsWith('up'),
	).length;
	const down = total - up;
	return (
		<div className="mt-4 bg-white border border-gray-200 rounded">
			<button
				onClick={toggle}
				className="w-full px-3 py-2 border-b text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5 hover:bg-gray-50"
			>
				<span className="text-gray-400">{collapsed ? '▸' : '▾'}</span>
				<Package className="w-3 h-3" />
				Build &amp; deploy state
				{builds.snapshot_age >= 0 && (
					<span className="ml-2 text-[10px] font-normal text-gray-400">
						snapshot {builds.snapshot_age}m ago
					</span>
				)}
				<span className="ml-auto text-[10px] font-normal lowercase text-gray-500">
					{total} service{total === 1 ? '' : 's'} · {up} up
					{down > 0 && <span className="text-amber-600 font-medium"> · {down} down</span>}
				</span>
			</button>
			{collapsed ? null : (
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
							<th className="text-left px-3 py-1.5 font-medium">Actions</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-100">
						{builds.services.map((s) => {
							const containerOk = !!(
								s.container_status &&
								s.container_status.toLowerCase().startsWith('up')
							);
							return (
								<BuildServiceRow key={s.service} svc={s} containerOk={containerOk} fmtRelative={fmtRelative} />
							);
						})}
					</tbody>
				</table>
			</div>
			)}
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

// ── TelemetrySection ──────────────────────────────────────────────
//
// Default = the 4 stat-cell row (~140px) + a chevron + the
// Open-in-Grafana link. Expanded = adds the 2x2 timeseries grid +
// the Loki recent-errors panel. Toggle persists in localStorage so
// each operator's preference sticks across reloads.

function TelemetrySection() {
	const [collapsed, toggle] = useCollapse('telemetry-detail', true);
	return (
		<div>
			{/* Stat strip — always visible. */}
			<div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
				<GrafanaEmbed
					src="/d-solo/lumid-ops/lumid-ops?panelId=1"
					title="Public endpoints up"
					height={140}
				/>
				<GrafanaEmbed
					src="/d-solo/lumid-ops/lumid-ops?panelId=2"
					title="Backups verify"
					height={140}
				/>
				<GrafanaEmbed
					src="/d-solo/lumid-ops/lumid-ops?panelId=4"
					title="Containers up"
					height={140}
				/>
				<GrafanaEmbed
					src="/d-solo/lumid-ops/lumid-ops?panelId=3"
					title="DR test"
					height={140}
				/>
			</div>
			{/* Chevron + drill-down link share one row when collapsed. */}
			<div className="mt-2 flex items-center justify-between gap-3">
				<button
					onClick={toggle}
					className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
				>
					{collapsed ? '▸' : '▾'} {collapsed ? 'show' : 'hide'} timeseries + recent errors
				</button>
				<a
					href="/grafana/d/lumid-ops/lumid-ops"
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
				>
					Open full lumid-ops dashboard in Grafana →
				</a>
			</div>
			{!collapsed && (
				<>
					<div className="grid gap-3 lg:grid-cols-2 mt-3">
						<GrafanaEmbed
							src="/d-solo/lumid-ops/lumid-ops?panelId=20"
							title="HTTPS probe latency (p99)"
							height={260}
						/>
						<GrafanaEmbed
							src="/d-solo/lumid-ops/lumid-ops?panelId=21"
							title="Container restart rate (per 5m)"
							height={260}
						/>
						<GrafanaEmbed
							src="/d-solo/lumid-ops/lumid-ops?panelId=30"
							title="Host disk usage"
							height={260}
						/>
						<GrafanaEmbed
							src="/d-solo/lumid-ops/lumid-ops?panelId=31"
							title="Host load average"
							height={260}
						/>
					</div>
					<div className="mt-3">
						<GrafanaEmbed
							src="/d-solo/lumid-ops/lumid-ops?panelId=40"
							title="Recent errors across containers"
							height={320}
						/>
					</div>
				</>
			)}
		</div>
	);
}

// ── CodebaseReposTile ─────────────────────────────────────────────
//
// Per-codebase-repo git state — branch, dirty, ahead/behind, last
// commit. Sourced from /admin/codebase-repos which walks /proj. Distinct
// from the per-app git status inside LoopStatusTile (those are xpio
// app bundles in ~/.xp/apps/).

const CODEBASE_DEFAULT_ROW_CAP = 6;

function CodebaseReposTile({ codebase }: { codebase: CodebaseReposResp | null }) {
	const [showDeprecated, setShowDeprecated] = useState(false);
	const [capped, toggleCap] = useCollapse('codebase-cap', true);
	if (!codebase) return <Tile icon={GitBranch} label="Codebase" primary="—" />;
	const { repos, summary, root, warning } = codebase;
	const filtered = showDeprecated ? repos : repos.filter((r) => !r.deprecated);
	// Sort attention-grabbers first so the cap doesn't hide dirty repos.
	const order: Record<string, number> = {
		dirty: 0, diverged: 0, ahead: 1, behind: 1, detached: 2,
		no_upstream: 3, clean: 4, no_git: 5,
	};
	const sorted = filtered.slice().sort((a, b) => {
		const oa = order[a.status] ?? 9;
		const ob = order[b.status] ?? 9;
		if (oa !== ob) return oa - ob;
		if (a.group !== b.group) return (a.group || '').localeCompare(b.group || '');
		return a.name.localeCompare(b.name);
	});
	const visible = capped ? sorted.slice(0, CODEBASE_DEFAULT_ROW_CAP) : sorted;
	const hidden = sorted.length - visible.length;

	const dirty = summary.dirty || 0;
	const ahead = summary.ahead || 0;
	const behind = summary.behind || 0;
	const diverged = summary.diverged || 0;
	const allClean = dirty + ahead + behind + diverged === 0;
	const tone = allClean ? 'good' : 'bad';

	const tonecls: Record<string, string> = {
		clean:       'text-green-600',
		dirty:       'text-amber-600',
		ahead:       'text-blue-600',
		behind:      'text-amber-600',
		diverged:    'text-red-600',
		no_upstream: 'text-gray-500',
		detached:    'text-amber-600',
		no_git:      'text-gray-400',
	};

	return (
		<div className={`bg-white border border-gray-200 border-l-4 rounded p-4 ${
			tone === 'good' ? 'border-l-green-500' : 'border-l-amber-500'
		}`}>
			<div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
				<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
					<GitBranch className="w-3 h-3" />
					Codebase · {visible.length} repo{visible.length === 1 ? '' : 's'}
					<span className="text-gray-400 normal-case lowercase ml-2 text-[10px]">
						{root}
					</span>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-xs text-muted-foreground">
						{summary.clean || 0} clean ·
						{' '}<span className={dirty ? 'text-amber-600 font-medium' : ''}>{dirty} dirty</span> ·
						{' '}{ahead} ahead ·
						{' '}{behind} behind ·
						{' '}{diverged} diverged
					</span>
					<button
						onClick={() => setShowDeprecated(!showDeprecated)}
						className="text-[10px] text-indigo-600 hover:underline"
					>
						{showDeprecated ? 'hide' : 'show'} deprecated
					</button>
				</div>
			</div>
			{warning && (
				<div className="text-xs text-amber-700 bg-amber-50 px-3 py-2 mb-2 rounded">
					{warning}
				</div>
			)}
			<div className="overflow-x-auto">
				<table className="w-full text-xs font-mono">
					<thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
						<tr className="border-b border-gray-100">
							<th className="text-left font-medium py-1 pr-3">repo</th>
							<th className="text-left font-medium py-1 pr-3">branch</th>
							<th className="text-left font-medium py-1 pr-3">status</th>
							<th className="text-left font-medium py-1 pr-3">working tree</th>
							<th className="text-left font-medium py-1 pr-3">vs origin</th>
							<th className="text-left font-medium py-1">HEAD</th>
						</tr>
					</thead>
					<tbody>
						{visible.map((r) => (
							<tr key={r.path} className="border-b border-gray-50 last:border-0 align-top">
								<td className="py-1 pr-3 text-gray-700">
									{r.group && <span className="text-gray-400">{r.group}/</span>}
									<span className={r.deprecated ? 'text-gray-400 line-through' : ''}>{r.name}</span>
								</td>
								<td className="py-1 pr-3 text-gray-500">{r.branch || '—'}</td>
								<td className={`py-1 pr-3 ${tonecls[r.status] || 'text-gray-500'}`}>
									{r.status}
								</td>
								<td className="py-1 pr-3 text-gray-500">
									{r.dirty_count > 0 && (
										<span className="text-amber-600 mr-2">{r.dirty_count} mod</span>
									)}
									{r.untracked_count > 0 && (
										<span className="text-gray-500">{r.untracked_count} untracked</span>
									)}
									{!r.dirty_count && !r.untracked_count && <span>—</span>}
									{r.dirty_example && (
										<div className="text-[10px] text-gray-400 truncate max-w-[260px]">
											{r.dirty_example}
										</div>
									)}
								</td>
								<td className="py-1 pr-3">
									{!r.has_upstream ? (
										<span className="text-gray-400">no upstream</span>
									) : ((r.ahead_origin || 0) === 0 && (r.behind_origin || 0) === 0) ? (
										<span className="text-gray-500">in sync</span>
									) : (
										<>
											{(r.ahead_origin || 0) > 0 && (
												<span className="text-blue-600">↑{r.ahead_origin}</span>
											)}
											{(r.behind_origin || 0) > 0 && (
												<span className="ml-2 text-amber-600">↓{r.behind_origin}</span>
											)}
										</>
									)}
								</td>
								<td className="py-1 text-gray-500">
									{r.head_short_sha && (
										<>
											<code className="text-[10px] text-gray-700">{r.head_short_sha}</code>
											{r.head_subject && (
												<span className="text-[10px] text-gray-500 ml-1 truncate inline-block max-w-[300px] align-bottom">
													{r.head_subject}
												</span>
											)}
										</>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{hidden > 0 && (
				<div className="mt-2 text-right">
					<button
						onClick={toggleCap}
						className="text-[10px] text-indigo-600 hover:underline"
					>
						show all {sorted.length} repo{sorted.length === 1 ? '' : 's'} ({hidden} hidden)
					</button>
				</div>
			)}
			{!capped && sorted.length > CODEBASE_DEFAULT_ROW_CAP && (
				<div className="mt-2 text-right">
					<button
						onClick={toggleCap}
						className="text-[10px] text-indigo-600 hover:underline"
					>
						collapse to {CODEBASE_DEFAULT_ROW_CAP} most-attention-needed
					</button>
				</div>
			)}
		</div>
	);
}

// ── LoopStatusTile ─────────────────────────────────────────────────
//
// Status visibility for the autoresearch loop layer. Reads from
// /api/v1/admin/loops which aggregates the lumid-scheduler daemon's
// state.json with per-app .scheduler.json indices.

const LOOPS_DEFAULT_ROW_CAP = 5;

function LoopStatusTile({ loops }: { loops: LoopsResp | null }) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [capped, toggleCap] = useCollapse('loops-cap', true);
	if (!loops) return <Tile icon={Activity} label="Loops" primary="—" />;
	const { summary, scheduler_daemon, loops: rawRows, apps: appsStatus } = loops;
	// Failing first so the cap never hides a regression. Then stale,
	// never, ok, manual — alphabetical within each tier.
	const statusOrder: Record<string, number> = {
		failing: 0, stale: 1, never: 2, ok: 3, manual: 4,
	};
	const rows = rawRows.slice().sort((a, b) => {
		const oa = statusOrder[a.status] ?? 9;
		const ob = statusOrder[b.status] ?? 9;
		if (oa !== ob) return oa - ob;
		if (a.app !== b.app) return a.app.localeCompare(b.app);
		return a.loop.localeCompare(b.loop);
	});
	const visibleRows = capped ? rows.slice(0, LOOPS_DEFAULT_ROW_CAP) : rows;
	const hiddenRows = rows.length - visibleRows.length;
	const toggle = (key: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key); else next.add(key);
			return next;
		});
	};
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
			{appsStatus && appsStatus.length > 0 && (
				<div className="mb-4 pb-3 border-b border-gray-100">
					<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
						git status · {appsStatus.length} repo{appsStatus.length === 1 ? '' : 's'}
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-xs font-mono">
							<thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
								<tr className="border-b border-gray-100">
									<th className="text-left font-medium py-1 pr-3">app</th>
									<th className="text-left font-medium py-1 pr-3">version</th>
									<th className="text-left font-medium py-1 pr-3">kind</th>
									<th className="text-left font-medium py-1 pr-3">status</th>
									<th className="text-left font-medium py-1 pr-3">published</th>
									<th className="text-left font-medium py-1">local drift</th>
								</tr>
							</thead>
							<tbody>
								{appsStatus.map((a) => <AppGitStatusRow key={a.app} a={a} />)}
							</tbody>
						</table>
					</div>
				</div>
			)}
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
								<th className="text-left font-medium py-1.5 pr-3">outcome</th>
								<th className="text-left font-medium py-1.5">last run</th>
							</tr>
						</thead>
						<tbody className="font-mono">
							{visibleRows.map((r) => {
								const key = `${r.app}:${r.loop}`;
								const isOpen = expanded.has(key);
								return (
									<>
										<tr
											key={key}
											className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50"
											onClick={() => toggle(key)}
										>
											<td className="py-1.5 pr-3 text-gray-700">
												<span className="text-gray-400 mr-1">{isOpen ? '▾' : '▸'}</span>
												{r.app}
											</td>
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
											<td className="py-1.5 pr-3">
												{r.outcome ? (
													<LoopOutcomeCell outcome={r.outcome} />
												) : (
													<span className="text-gray-300">—</span>
												)}
											</td>
											<td className="py-1.5 text-gray-500">{fmtAge(r.last_run_ts)}</td>
										</tr>
										{isOpen && <LoopDetailRow loop={r} />}
									</>
								);
							})}
						</tbody>
					</table>
					{hiddenRows > 0 && (
						<div className="mt-2 text-right">
							<button
								onClick={toggleCap}
								className="text-[10px] text-indigo-600 hover:underline"
							>
								show all {rows.length} loop{rows.length === 1 ? '' : 's'} ({hiddenRows} hidden)
							</button>
						</div>
					)}
					{!capped && rows.length > LOOPS_DEFAULT_ROW_CAP && (
						<div className="mt-2 text-right">
							<button
								onClick={toggleCap}
								className="text-[10px] text-indigo-600 hover:underline"
							>
								collapse to {LOOPS_DEFAULT_ROW_CAP} most-attention-needed
							</button>
						</div>
					)}
				</div>
			)}
			<RecentInsightsFeed rows={rows} />
		</div>
	);
}

// RecentInsightsFeed — last 5 insight heads across all auto-quant loops.
function RecentInsightsFeed({ rows }: { rows: import('@/api/super-admin').LoopRow[] }) {
	const insightRows = rows
		.filter((r) => r.outcome?.insight_head && r.app === 'auto-quant' && r.last_run_ts > 0)
		.sort((a, b) => b.last_run_ts - a.last_run_ts)
		.slice(0, 5);
	if (insightRows.length === 0) return null;
	return (
		<div className="mt-4 pt-3 border-t border-gray-100">
			<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
				Recent insights · auto-quant · last {insightRows.length} cycle{insightRows.length === 1 ? '' : 's'}
			</div>
			<ul className="space-y-2">
				{insightRows.map((r) => (
					<li key={`${r.app}:${r.loop}:${r.last_run_ts}`} className="text-[11px] flex flex-col gap-0.5">
						<div className="flex items-center gap-2 text-muted-foreground text-[10px]">
							<span className="font-mono">{r.loop}</span>
							<span>·</span>
							<span>{new Date(r.last_run_ts * 1000).toLocaleString()}</span>
							{r.latest_cycle_dir && (
								<a
									href={`/studio/super-admin/cycle-transcript?dir=${encodeURIComponent(r.latest_cycle_dir)}`}
									target="_blank"
									rel="noreferrer"
									className="text-indigo-500 hover:underline"
								>
									View cycle →
								</a>
							)}
						</div>
						<div className="text-gray-700 italic line-clamp-2 whitespace-pre-line pl-1 border-l-2 border-gray-200">
							{r.outcome!.insight_head}
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

// LoopDetailRow — expanded view inside the loops table. Renders the
// per-loop detail fields the backend hydrates inline (skills, steps,
// datasets, knowledge_agent, latest cycle artifact pointer).

// LoopOutcomeCell — compact inline display for realized alpha + sharpe
function LoopOutcomeCell({ outcome }: { outcome: import('@/api/super-admin').LoopOutcome }) {
	const fmtAlpha = (v: number | undefined) => {
		if (v == null) return null;
		const sign = v >= 0 ? '+' : '';
		return <span className={v >= 0 ? 'text-green-600' : 'text-red-500'}>{sign}{v.toFixed(2)}pp</span>;
	};
	const fmtSharpe = (v: number | undefined) => {
		if (v == null) return null;
		return <span className="text-gray-600 ml-1">S:{v.toFixed(2)}</span>;
	};
	const hasAlpha = outcome.alpha_pp != null;
	const hasSharpe = outcome.sharpe != null;
	if (!hasAlpha && !hasSharpe) return <span className="text-gray-300 text-[10px]">no score</span>;
	return (
		<span className="text-[10px] whitespace-nowrap">
			{fmtAlpha(outcome.alpha_pp)}
			{outcome.benchmark && <span className="text-gray-400 ml-0.5 text-[9px]">vs {outcome.benchmark}</span>}
			{fmtSharpe(outcome.sharpe)}
		</span>
	);
}

function LoopDetailRow({ loop: r }: { loop: import('@/api/super-admin').LoopRow }) {
	return (
		<tr className="bg-gray-50 border-b border-gray-100">
			<td colSpan={7} className="px-3 py-3">
				<div className="text-[11px] grid gap-2 lg:grid-cols-2">
					{r.description && (
						<div className="lg:col-span-2 text-gray-700 whitespace-pre-line">
							{r.description}
						</div>
					)}
					{r.goal_primary && (
						<div className="lg:col-span-2 flex flex-wrap items-baseline gap-1.5">
							<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
								goal
							</span>
							<code className="text-emerald-700">{r.goal_primary}</code>
							{(r.goal_tracked || []).map((t) => (
								<span
									key={t}
									className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-600"
								>
									{t}
								</span>
							))}
						</div>
					)}
					{r.engine === 'command' && r.engine_module && (
						<div className="lg:col-span-2 flex flex-wrap items-baseline gap-1.5">
							<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
								engine
							</span>
							<code className="text-purple-700">command</code>
							<span className="text-[10px] text-gray-500">→ commands/</span>
							<code className="text-blue-700">{r.engine_module}.py</code>
							<a
								href="/docs/xpio-autoresearch#pattern-b--command-driven-loop"
								className="text-[10px] text-indigo-600 hover:underline"
								target="_blank" rel="noreferrer"
							>
								Pattern B
							</a>
						</div>
					)}
					{(r.skills_invoked && r.skills_invoked.length > 0) && (
						<div className="lg:col-span-2">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
								skills invoked by engine ({r.skills_invoked.length})
							</div>
							<div className="flex flex-wrap gap-1">
								{r.skills_invoked.map((s) => (
									<code
										key={s}
										className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-700"
									>
										{s}
									</code>
								))}
							</div>
						</div>
					)}
					{(r.skills && r.skills.length > 0 && !r.skills_invoked) && (
						<div>
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
								skills ({r.skills.length})
							</div>
							<div className="flex flex-wrap gap-1">
								{r.skills.map((s) => (
									<code
										key={s}
										className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-700"
									>
										{s}
									</code>
								))}
							</div>
						</div>
					)}
					{(r.steps && r.steps.length > 0) && (
						<div>
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
								steps (ordered)
							</div>
							<ol className="space-y-0.5 list-decimal list-inside text-gray-700">
								{r.steps.map((st) => (
									<li key={st.id}>
										<code className="text-blue-700">{st.skill}</code>
										{st.knowledge_agent && (
											<span className="text-gray-400 ml-1">
												via <code>{st.knowledge_agent}</code>
											</span>
										)}
									</li>
								))}
							</ol>
						</div>
					)}
					<div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1 pt-2 border-t border-gray-200 mt-1">
						{r.primary_role && <div><span className="text-muted-foreground">role:</span>{' '}<code>{r.primary_role}</code></div>}
						{r.knowledge_agent && <div><span className="text-muted-foreground">kg agent:</span>{' '}<code>{r.knowledge_agent}</code></div>}
						{r.mode && <div><span className="text-muted-foreground">mode:</span>{' '}<code>{r.mode}</code></div>}
						{(r.datasets && r.datasets.length > 0) && (
							<div><span className="text-muted-foreground">datasets:</span>{' '}<code>{r.datasets.join(', ')}</code></div>
						)}
						{r.latest_cycle_dir && (
							<div className="col-span-2 lg:col-span-4 truncate text-gray-500">
								<span className="text-muted-foreground">latest cycle:</span>{' '}
								<code className="text-[10px]">{r.latest_cycle_dir}</code>
								{r.outcome?.insight_head && (
									<div className="mt-1 text-[10px] text-gray-600 italic whitespace-pre-line line-clamp-3">
										{r.outcome.insight_head}
									</div>
								)}
								{r.latest_cycle_dir && (
									<a
										href={`/studio/super-admin/cycle-transcript?dir=${encodeURIComponent(r.latest_cycle_dir)}`}
										target="_blank"
										rel="noreferrer"
										className="text-[10px] text-indigo-500 hover:underline mt-0.5 inline-block"
									>
										Transcript →
									</a>
								)}
							</div>
						)}
					</div>
					{(r.last_errors && r.last_errors.length > 0) || r.last_journal ? (
						<div className="mt-3 pt-2 border-t border-red-200 bg-red-50/40 -mx-3 -mb-3 px-3 py-2 rounded-b">
							<div className="text-[10px] uppercase tracking-wide text-red-700 font-medium mb-1.5">
								failure detail
							</div>
							{(r.last_errors || []).slice(0, 5).map((err, i) => (
								<div key={i} className="mb-1 last:mb-0">
									{err.step && (
										<span className="text-[10px] text-red-800/70 mr-1">
											step <code>{err.step}</code>
											{err.skill && <> · skill <code>{err.skill}</code></>}:
										</span>
									)}
									<code className="text-[10px] text-red-900 break-all whitespace-pre-wrap">
										{err.error}
									</code>
								</div>
							))}
							{r.last_journal && (
								<details className="mt-1">
									<summary className="text-[10px] text-red-700 cursor-pointer hover:underline">
										journal tail
									</summary>
									<code className="block text-[10px] text-red-900 break-all whitespace-pre-wrap mt-1 pl-3">
										{r.last_journal}
									</code>
								</details>
							)}
						</div>
					) : null}
				</div>
			</td>
		</tr>
	);
}

// AppGitStatusRow — one row of the per-app git status table, rendered
// at the top of the LoopStatusTile so the operator can spot drift
// without expanding every loop.
function AppGitStatusRow({ a }: { a: import('@/api/super-admin').AppGitStatus }) {
	const tone: Record<string, string> = {
		in_sync:     'text-green-600',
		dirty:       'text-amber-600',
		ahead:       'text-blue-600',
		behind:      'text-amber-600',
		drift:       'text-red-600',
		unpublished: 'text-gray-500',
		no_git:      'text-gray-400',
	};
	return (
		<tr className="border-b border-gray-50 last:border-0">
			<td className="py-1 pr-3 text-gray-700">{a.app}</td>
			<td className="py-1 pr-3 text-gray-500">{a.version || '—'}</td>
			<td className="py-1 pr-3 text-gray-500">{a.kind || '—'}</td>
			<td className={`py-1 pr-3 ${tone[a.status] || 'text-gray-500'}`}>{a.status}</td>
			<td className="py-1 pr-3 text-gray-500">
				{a.published_slug ? (
					<a href={`https://xp.io/${a.published_slug}`} target="_blank" rel="noreferrer"
					   className="text-indigo-600 hover:underline">
						{a.published_slug}
					</a>
				) : '—'}
			</td>
			<td className="py-1 text-gray-500">
				{a.local_dirty_count > 0 && (
					<span className="text-amber-600">
						dirty {a.local_dirty_count}
						{a.local_dirty_example && <span className="text-gray-400"> · {a.local_dirty_example}</span>}
					</span>
				)}
				{(a.local_ahead_origin || 0) > 0 && (
					<span className="ml-2 text-blue-600">↑{a.local_ahead_origin}</span>
				)}
				{(a.local_behind_origin || 0) > 0 && (
					<span className="ml-2 text-amber-600">↓{a.local_behind_origin}</span>
				)}
				{a.local_head && a.remote_head && a.local_head !== a.remote_head && (
					<span className="ml-2 text-red-600 font-mono text-[10px]">
						local {a.local_head.slice(0, 7)} ≠ remote {a.remote_head.slice(0, 7)}
					</span>
				)}
				{!a.local_dirty_count && !a.local_ahead_origin && !a.local_behind_origin &&
					(!a.local_head || !a.remote_head || a.local_head === a.remote_head) && '—'}
			</td>
		</tr>
	);
}

// BuildServiceRow — one row of the build-status table, with the new
// Actions column expanded inline. Uses two-row pattern: the data row
// stays compact + a click-toggle reveals rebuild/restart commands.

function BuildServiceRow({
	svc,
	containerOk,
	fmtRelative,
}: {
	svc: BuildService;
	containerOk: boolean;
	fmtRelative: (iso: string) => string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<tr
				className="hover:bg-gray-50 cursor-pointer"
				onClick={() => setOpen((v) => !v)}
			>
				<td className="px-3 py-1.5 font-medium text-gray-700">
					<span className="text-gray-400 mr-1 text-[10px]">{open ? '▾' : '▸'}</span>
					{svc.service}
				</td>
				<td className="px-3 py-1.5">
					<span className={containerOk ? 'text-green-700' : 'text-red-600'}>
						{containerOk ? '●' : '○'}
					</span>{' '}
					<span className="text-gray-500">{svc.container_status || '—'}</span>
				</td>
				<td className="px-3 py-1.5 font-mono text-[11px] text-gray-700">
					<span title={svc.image_id}>{svc.image || '—'}</span>
					{svc.image_size && (
						<span className="text-gray-400 ml-1">{svc.image_size}</span>
					)}
				</td>
				<td className="px-3 py-1.5 text-gray-600" title={svc.image_created}>
					{fmtRelative(svc.image_created)}
				</td>
				<td className="px-3 py-1.5 text-gray-600" title={svc.container_started}>
					{fmtRelative(svc.container_started)}
				</td>
				<td className="px-3 py-1.5">
					<StateBadges svc={svc} />
				</td>
				<td className="px-3 py-1.5 font-mono text-[11px] text-gray-600">
					{svc.last_built_sha || '—'}
				</td>
				<td className="px-3 py-1.5 text-gray-600" title={svc.last_built_at}>
					{fmtRelative(svc.last_built_at)}
				</td>
				<td className="px-3 py-1.5 text-[11px] text-indigo-600">
					{open ? 'hide' : 'show'}
				</td>
			</tr>
			{open && (
				<tr className="bg-gray-50">
					<td colSpan={9} className="px-4 py-2 text-[11px]">
						<div className="space-y-1 font-mono">
							<div className="text-muted-foreground text-[10px] uppercase">rebuild + push to GHCR</div>
							<code className="block bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700">
								/proj/infra/scripts/build-and-push-ghcr.sh {svc.service}
							</code>
							<div className="text-muted-foreground text-[10px] uppercase pt-1">pull latest + restart this container</div>
							<code className="block bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700">
								/proj/infra/scripts/docker-pull-cron.sh {svc.service}
							</code>
							<div className="text-muted-foreground text-[10px] uppercase pt-1">force a fresh local build (no GHCR)</div>
							<code className="block bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-700">
								cd /proj/infra/compose/{svc.service.replace(/-/g, '_')} && docker compose up -d --build
							</code>
						</div>
					</td>
				</tr>
			)}
		</>
	);
}
