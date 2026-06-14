// Phase S4 — Studio admin (lean v1).
//
// Tabbed surface that folds the most-used operator views inline:
// Tenants / Loops / Build. The full super-admin dashboard (Telemetry,
// CertExpiry, BackupStatus, CodebaseRepos, etc.) stays at
// /dashboard/super-admin and is one click away via the "Full
// dashboard" link. Goal here is consolidation of ENTRY points, not
// duplication of every tile.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Users, RefreshCw, Server, ExternalLink, Loader2 } from 'lucide-react';
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
			<header className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-medium flex items-center gap-2">
						<Shield className="w-5 h-5 text-gold-600" />
						Admin
					</h1>
					<p className="text-sm text-slate-500 mt-0.5">
						Operator surfaces — folded into Studio. Full dashboard
						with cert / backup / telemetry tiles lives at
						<Link to="/dashboard/super-admin" className="ml-1 text-gold-700 hover:underline">
							/dashboard/super-admin <ExternalLink className="inline w-3 h-3" />
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
			<div className="text-xs text-slate-500">
				{active.length} active · {rows.length} total · sorted by cycles today
			</div>
			<div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs text-slate-600 tracking-wide">
						<tr>
							<th className="px-3 py-2 font-medium">Email</th>
							<th className="px-3 py-2 font-medium w-20">Apps</th>
							<th className="px-3 py-2 font-medium w-24">Storage</th>
							<th className="px-3 py-2 font-medium w-24">Cycles</th>
							<th className="px-3 py-2 font-medium w-24">LLM today</th>
							<th className="px-3 py-2 font-medium w-20">Gmail</th>
							<th className="px-3 py-2 font-medium">Joined</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{rows.slice(0, 50).map((t) => (
							<tr key={t.sub} className="hover:bg-slate-50/60">
								<td className="px-3 py-1.5 font-mono text-xs">
									{t.email}
									{t.role !== 'user' && (
										<span className="ml-2 text-[10px] tracking-wide text-gold-700">{t.role}</span>
									)}
								</td>
								<td className="px-3 py-1.5 text-xs">{t.apps}</td>
								<td className="px-3 py-1.5 text-xs text-slate-600 tabular-nums">{t.storage_mb.toFixed(1)} MB</td>
								<td className="px-3 py-1.5 text-xs tabular-nums">{t.cycles_today}/100</td>
								<td className="px-3 py-1.5 text-xs tabular-nums text-slate-600">{(t.llm_tokens_today/1000).toFixed(0)}K</td>
								<td className="px-3 py-1.5 text-xs tabular-nums text-slate-600">{t.gmail_today}</td>
								<td className="px-3 py-1.5 text-xs text-slate-500">{new Date(t.created_at).toISOString().slice(0, 10)}</td>
							</tr>
						))}
						{rows.length === 0 && (
							<tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-500 italic">No tenants yet.</td></tr>
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
			<div className="text-xs text-slate-500">
				{loops.length} loops · {failing.length} failing
			</div>
			<div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs text-slate-600 tracking-wide">
						<tr>
							<th className="px-3 py-2 font-medium">App / Loop</th>
							<th className="px-3 py-2 font-medium w-32">Schedule</th>
							<th className="px-3 py-2 font-medium w-32">Last run</th>
							<th className="px-3 py-2 font-medium w-24">State</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{[...loops].sort((a, b) => (b.consecutive_failures ?? 0) - (a.consecutive_failures ?? 0)).slice(0, 60).map((l, i) => (
							<tr key={`${l.app}:${l.loop}:${i}`} className="hover:bg-slate-50/60">
								<td className="px-3 py-1.5">
									<div className="text-xs font-medium">{l.loop}</div>
									<div className="text-[10px] text-slate-500 font-mono">{l.app}</div>
								</td>
								<td className="px-3 py-1.5 text-xs font-mono text-slate-600">{l.schedule ?? '—'}</td>
								<td className="px-3 py-1.5 text-xs text-slate-500">{l.last_run_ts ? new Date(l.last_run_ts).toISOString().slice(0,16).replace('T',' ') : '—'}</td>
								<td className="px-3 py-1.5 text-xs">
									{(l.consecutive_failures ?? 0) > 0 ? (
										<span className="text-rose-700">{l.consecutive_failures} fail{l.consecutive_failures === 1 ? '' : 's'}</span>
									) : l.enabled ? (
										<span className="text-gold-700">on</span>
									) : (
										<span className="text-slate-500">off</span>
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
			<div className="text-xs text-slate-500">
				{data.services?.length ?? 0} services · snapshot age {data.snapshot_age}m
			</div>
			<div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-left text-xs text-slate-600 tracking-wide">
						<tr>
							<th className="px-3 py-2 font-medium">Service</th>
							<th className="px-3 py-2 font-medium w-32">Image</th>
							<th className="px-3 py-2 font-medium w-20">State</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-100">
						{(data.services ?? []).slice(0, 40).map((s: any, i: number) => (
							<tr key={`${s.name}-${i}`} className="hover:bg-slate-50/60">
								<td className="px-3 py-1.5 font-mono text-xs">{s.name}</td>
								<td className="px-3 py-1.5 text-xs text-slate-600">{s.image ?? '—'}</td>
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
		bad:     'text-rose-700',
	}[tone];
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
