// Phase S4 — Studio admin (lean v1).
//
// Tabbed surface that folds the most-used operator views inline:
// Tenants / Loops / Build. The full super-admin dashboard (Telemetry,
// CertExpiry, BackupStatus, CodebaseRepos, etc.) stays at
// /dashboard/super-admin and is one click away via the "Full
// dashboard" link. Goal here is consolidation of ENTRY points, not
// duplication of every tile.
//
// The full super-admin dashboard lives at /studio/super-admin (the
// /dashboard URL surface was retired 2026-06-19).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Users, RefreshCw, Server, ArrowRight, Activity } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
	fetchTenants,        type TenantsResp,
	fetchLoops,          type LoopsResp,
	fetchBuildStatus,    type BuildStatus,
	fetchAuthStats,      type AuthStats,
} from '@/api/super-admin';

type Tab = 'tenants' | 'loops' | 'build' | 'auth';

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
	{ id: 'tenants', label: 'Tenants', icon: Users },
	{ id: 'loops',   label: 'Loops',   icon: RefreshCw },
	{ id: 'build',   label: 'Build',   icon: Server },
	{ id: 'auth',    label: 'Auth',    icon: Shield },
];

export default function StudioAdmin() {
	const [tab, setTab] = useState<Tab>('tenants');
	return (
		<div className="space-y-4">
			<PageHeader
				className="pt-2 pb-1"
				eyebrow="Operator only"
				title="Admin"
				subtitle={
					<>
						Operator surfaces, folded into Studio. The full dashboard with cert, backup and telemetry tiles is{' '}
						<Link to="/studio/super-admin" className="group inline-flex items-center gap-0.5 font-medium text-gold-700 hover:text-gold-800">
							super-admin <ArrowRight className="h-3 w-3 transition-transform duration-180 group-hover:translate-x-0.5" />
						</Link>
					</>
				}
				actions={
					<Link
						to="/status/operations"
						className="lumen-press inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-body font-medium text-ink-800 shadow-e1 transition-colors duration-120 hover:border-ink-300 hover:bg-ink-50"
					>
						<Activity className="w-4 h-4 text-ink-500" />
						Operations status
					</Link>
				}
			/>

			<nav className="border-b border-border flex items-center gap-6" aria-label="Admin sections">
				{TABS.map((t) => {
					const Icon = t.icon;
					const active = tab === t.id;
					return (
						<button
							key={t.id}
							onClick={() => setTab(t.id)}
							className={[
								'inline-flex items-center gap-1.5 pb-2.5 pt-1 text-body font-medium border-b-2 transition-colors duration-180 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
								active
									? 'border-gold-500 text-ink-900'
									: 'border-transparent text-ink-600 hover:text-ink-900 hover:border-ink-300',
							].join(' ')}
						>
							<Icon className="w-4 h-4" />
							{t.label}
						</button>
					);
				})}
			</nav>

			<div className="pt-2">
				{tab === 'tenants' && <TenantsTab />}
				{tab === 'loops'   && <LoopsTab />}
				{tab === 'build'   && <BuildTab />}
				{tab === 'auth'    && <AuthTab />}
			</div>
		</div>
	);
}

// ── Tenants tab ────────────────────────────────────────────────────

function TenantsTab() {
	const [data, setData] = useState<TenantsResp | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		fetchTenants().then(setData).catch((e) => setError(String(e?.message || e)));
	}, []);
	if (error) return <ErrorBox>{error}</ErrorBox>;
	if (!data) return <Loading />;
	const rows = [...data.tenants].sort((a, b) => (b.cycles_today || 0) - (a.cycles_today || 0));
	const active = rows.filter((t) => t.apps > 0 || t.cycles_today > 0);
	return (
		<div className="space-y-2">
			<div className="text-xs text-ink-600">
				{active.length} active · {rows.length} total · sorted by cycles today
			</div>
			<div className="rounded-lg border border-ink-200 bg-card overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-ink-50 text-left text-xs text-ink-600 tracking-wide">
						<tr>
							<th className="px-3 py-2 font-medium">Email</th>
							<th className="px-3 py-2 font-medium w-20">Agents</th>
							<th className="px-3 py-2 font-medium w-24">Storage</th>
							<th className="px-3 py-2 font-medium w-24">Cycles</th>
							<th className="px-3 py-2 font-medium w-24">LLM today</th>
							<th className="px-3 py-2 font-medium w-20">Gmail</th>
							<th className="px-3 py-2 font-medium">Joined</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-ink-100">
						{rows.slice(0, 50).map((t) => (
							<tr key={t.sub} className="hover:bg-ink-50/60">
								<td className="px-3 py-1.5 font-mono text-xs">
									{t.email}
									{t.role !== 'user' && (
										<span className="ml-2 text-nano tracking-wide text-gold-700">{t.role}</span>
									)}
								</td>
								<td className="px-3 py-1.5 text-xs">{t.apps}</td>
								<td className="px-3 py-1.5 text-xs text-ink-600 tabular-nums">{t.storage_mb.toFixed(1)} MB</td>
								<td className="px-3 py-1.5 text-xs tabular-nums">{t.cycles_today}/100</td>
								<td className="px-3 py-1.5 text-xs tabular-nums text-ink-600">{(t.llm_tokens_today/1000).toFixed(0)}K</td>
								<td className="px-3 py-1.5 text-xs tabular-nums text-ink-600">{t.gmail_today}</td>
								<td className="px-3 py-1.5 text-xs text-ink-600">{new Date(t.created_at).toISOString().slice(0, 10)}</td>
							</tr>
						))}
						{rows.length === 0 && (
							<tr><td colSpan={7} className="px-3 py-8 text-center text-body text-ink-600">No tenants yet.</td></tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// ── Loops tab ──────────────────────────────────────────────────────

function LoopsTab() {
	const [data, setData] = useState<LoopsResp | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		fetchLoops().then(setData).catch((e) => setError(String(e?.message || e)));
	}, []);
	if (error) return <ErrorBox>{error}</ErrorBox>;
	if (!data) return <Loading />;
	const loops = (data as any).loops as Array<{
		app: string; loop: string; schedule?: string; enabled?: boolean;
		last_run_ts?: string; consecutive_failures?: number;
	}>;
	const failing = loops.filter((l) => (l.consecutive_failures ?? 0) > 0);
	return (
		<div className="space-y-3">
			<div className="text-xs text-ink-600">
				{loops.length} loops · {failing.length} failing
			</div>
			<div className="rounded-lg border border-ink-200 bg-card overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-ink-50 text-left text-xs text-ink-600 tracking-wide">
						<tr>
							<th className="px-3 py-2 font-medium">Agent / Loop</th>
							<th className="px-3 py-2 font-medium w-32">Schedule</th>
							<th className="px-3 py-2 font-medium w-32">Last run</th>
							<th className="px-3 py-2 font-medium w-24">State</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-ink-100">
						{[...loops].sort((a, b) => (b.consecutive_failures ?? 0) - (a.consecutive_failures ?? 0)).slice(0, 60).map((l, i) => (
							<tr key={`${l.app}:${l.loop}:${i}`} className="hover:bg-ink-50/60">
								<td className="px-3 py-1.5">
									<div className="text-xs font-medium">{l.loop}</div>
									<div className="text-nano text-ink-600 font-mono">{l.app}</div>
								</td>
								<td className="px-3 py-1.5 text-xs font-mono text-ink-600">{l.schedule ?? '—'}</td>
								<td className="px-3 py-1.5 text-xs text-ink-600">{l.last_run_ts ? new Date(l.last_run_ts).toISOString().slice(0,16).replace('T',' ') : '—'}</td>
								<td className="px-3 py-1.5 text-xs">
									{(l.consecutive_failures ?? 0) > 0 ? (
										<span className="text-brick-700">{l.consecutive_failures} fail{l.consecutive_failures === 1 ? '' : 's'}</span>
									) : l.enabled ? (
										<span className="text-gold-700">on</span>
									) : (
										<span className="text-ink-600">off</span>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// ── Build tab ──────────────────────────────────────────────────────

function BuildTab() {
	const [data, setData] = useState<BuildStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		fetchBuildStatus().then(setData).catch((e) => setError(String(e?.message || e)));
	}, []);
	if (error) return <ErrorBox>{error}</ErrorBox>;
	if (!data) return <Loading />;
	return (
		<div className="space-y-3">
			<div className="text-xs text-ink-600">
				{data.services?.length ?? 0} services · snapshot age {data.snapshot_age}m
			</div>
			<div className="rounded-lg border border-ink-200 bg-card overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-ink-50 text-left text-xs text-ink-600 tracking-wide">
						<tr>
							<th className="px-3 py-2 font-medium">Service</th>
							<th className="px-3 py-2 font-medium w-32">Image</th>
							<th className="px-3 py-2 font-medium w-20">State</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-ink-100">
						{(data.services ?? []).slice(0, 40).map((s: any, i: number) => (
							<tr key={`${s.name}-${i}`} className="hover:bg-ink-50/60">
								<td className="px-3 py-1.5 font-mono text-xs">{s.name}</td>
								<td className="px-3 py-1.5 text-xs text-ink-600">{s.image ?? '—'}</td>
								<td className="px-3 py-1.5 text-xs">{s.state ?? '—'}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// ── Auth tab ───────────────────────────────────────────────────────

function AuthTab() {
	const [data, setData] = useState<AuthStats | null>(null);
	useEffect(() => {
		fetchAuthStats().then(setData).catch(() => setData(null));
	}, []);
	if (!data) return <Loading />;
	const failed = data.login.failed + data.oauth.failed;
	return (
		<div className="grid grid-cols-2 gap-3">
			<StatCard label="Logins (24h)"    value={data.login.total.toLocaleString()} hint={`${data.oauth.total} via OAuth`} />
			<StatCard label="Failed logins"   value={failed.toLocaleString()} tone={failed === 0 ? 'good' : failed < 10 ? 'warn' : 'bad'} />
		</div>
	);
}

// ── Shared ─────────────────────────────────────────────────────────

function StatCard({ label, value, hint, tone = 'default' }: {
	label: string; value: string; hint?: string;
	tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
	const toneCls = {
		default: '',
		good:    'text-gold-700',
		warn:    'text-gold-700',
		bad:     'text-brick-700',
	}[tone];
	return (
		<div className="rounded-lg border border-ink-200 bg-card p-4">
			<div className="text-xs tracking-wide text-ink-600">{label}</div>
			<div className={['text-h2 font-medium mt-1', toneCls].join(' ')}>{value}</div>
			{hint && <div className="text-xs text-ink-600 mt-1">{hint}</div>}
		</div>
	);
}

function ErrorBox({ children }: { children: React.ReactNode }) {
	return (
		<div role="alert" className="text-meta rounded-[10px] border border-brick-200 bg-brick-50 text-brick-800 px-3 py-2">
			{children}
		</div>
	);
}

function Loading() {
	return (
		<div className="space-y-2" aria-busy="true" aria-label="Loading">
			<Skeleton className="h-9 w-full rounded-[8px]" />
			{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-full rounded" />)}
		</div>
	);
}
