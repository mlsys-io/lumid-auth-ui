// Claude Code quota status across all org accounts — super_admin only.
//
// Reads every user who has stored a CLAUDE_CODE_OAUTH_TOKEN via the
// "Connect Claude" modal in Studio settings. Fetches live quota from
// claude.ai for each (5-min server-side cache). Sorted by pressure
// (five_hour_pct DESC) so the accounts closest to their limit float up.
//
// The page auto-refreshes every 2 minutes. Stale/errored accounts show
// the last known snapshot with a warning badge.

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Clock, Loader2 } from 'lucide-react';
import {
	fetchClaudeQuota,
	type ClaudeQuotaAccount,
	type ClaudeQuotaLimit,
} from '@/api/super-admin';

const AUTO_REFRESH_MS = 2 * 60 * 1000;

function fmtTime(iso: string): string {
	if (!iso || iso.startsWith('0001')) return '—';
	const d = new Date(iso);
	const now = new Date();
	const diffMs = d.getTime() - now.getTime();
	if (diffMs < 0) return 'now';
	const h = Math.floor(diffMs / 3600000);
	const m = Math.floor((diffMs % 3600000) / 60000);
	if (h > 24) return `${Math.floor(h / 24)}d`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function fmtTs(iso: string): string {
	if (!iso || iso.startsWith('0001')) return '—';
	const d = new Date(iso);
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function SeverityDot({ severity }: { severity: string }) {
	const cls =
		severity === 'critical' ? 'bg-rose-500' :
		severity === 'warning'  ? 'bg-amber-400' :
		'bg-emerald-400';
	return <span className={`inline-block w-2 h-2 rounded-full ${cls} shrink-0`} />;
}

function PctBar({ pct, severity }: { pct: number; severity: string }) {
	const fill =
		severity === 'critical' ? 'bg-rose-500' :
		severity === 'warning'  ? 'bg-amber-400' :
		pct > 60                ? 'bg-gold-400'  :
		'bg-emerald-400';
	return (
		<div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
			<div
				className={`h-full rounded-full transition-all ${fill}`}
				style={{ width: `${Math.min(100, pct)}%` }}
			/>
		</div>
	);
}

function ActiveLimit({ limit }: { limit: ClaudeQuotaLimit }) {
	return (
		<span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
			{limit.kind}: {limit.percent}%
			<span className="text-slate-400">→ {fmtTime(limit.resets_at)}</span>
		</span>
	);
}

function AccountRow({ acc }: { acc: ClaudeQuotaAccount }) {
	const activeLimits = (acc.limits ?? []).filter((l) => l.is_active);
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors">
			{/* header */}
			<div className="flex items-center gap-2 min-w-0">
				<SeverityDot severity={acc.severity} />
				<span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-800">
					{acc.email}
				</span>
				{acc.stale && (
					<span className="shrink-0 inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700">
						<AlertTriangle className="w-3 h-3" /> stale
					</span>
				)}
				{acc.error && (
					<span className="shrink-0 text-[10px] text-rose-600 truncate max-w-[160px]" title={acc.error}>
						{acc.error}
					</span>
				)}
				<span className="shrink-0 text-[10px] text-slate-400 flex items-center gap-0.5">
					<Clock className="w-3 h-3" /> {fmtTs(acc.ts)}
				</span>
			</div>

			{/* bars */}
			<div className="grid grid-cols-2 gap-3">
				<div>
					<div className="flex items-center justify-between mb-1">
						<span className="text-[10px] text-slate-500">5-hour</span>
						<span className="text-[10px] font-mono font-medium text-slate-700">
							{acc.five_hour_pct ?? 0}%
						</span>
					</div>
					<PctBar pct={acc.five_hour_pct ?? 0} severity={acc.severity} />
					<div className="text-[10px] text-slate-400 mt-0.5">
						resets in {fmtTime(acc.five_hour_reset)}
					</div>
				</div>
				<div>
					<div className="flex items-center justify-between mb-1">
						<span className="text-[10px] text-slate-500">7-day</span>
						<span className="text-[10px] font-mono font-medium text-slate-700">
							{acc.seven_day_pct ?? 0}%
						</span>
					</div>
					<PctBar pct={acc.seven_day_pct ?? 0} severity={acc.severity} />
					<div className="text-[10px] text-slate-400 mt-0.5">
						resets in {fmtTime(acc.seven_day_reset)}
					</div>
				</div>
			</div>

			{/* active limits */}
			{activeLimits.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{activeLimits.map((l) => <ActiveLimit key={l.kind} limit={l} />)}
				</div>
			)}
		</div>
	);
}

function SummaryBar({ accounts }: { accounts: ClaudeQuotaAccount[] }) {
	const critical = accounts.filter((a) => a.severity === 'critical').length;
	const warning  = accounts.filter((a) => a.severity === 'warning').length;
	const healthy  = accounts.length - critical - warning;
	return (
		<div className="grid grid-cols-3 gap-3">
			<div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
				<div className="text-2xl font-medium text-rose-600">{critical}</div>
				<div className="text-xs text-slate-500 mt-0.5">critical</div>
			</div>
			<div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
				<div className="text-2xl font-medium text-amber-600">{warning}</div>
				<div className="text-xs text-slate-500 mt-0.5">warning</div>
			</div>
			<div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
				<div className="text-2xl font-medium text-emerald-600">{healthy}</div>
				<div className="text-xs text-slate-500 mt-0.5">healthy</div>
			</div>
		</div>
	);
}

export default function StudioClaudeQuota() {
	const [accounts, setAccounts] = useState<ClaudeQuotaAccount[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [lastFetch, setLastFetch] = useState<Date | null>(null);

	const load = useCallback((silent = false) => {
		if (!silent) setLoading(true);
		fetchClaudeQuota()
			.then((d) => {
				setAccounts(d.accounts ?? []);
				setError(null);
				setLastFetch(new Date());
			})
			.catch((e) => setError(String(e?.message || e)))
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		load();
		const t = setInterval(() => load(true), AUTO_REFRESH_MS);
		return () => clearInterval(t);
	}, [load]);

	return (
		<div className="space-y-4">
			<header className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-medium flex items-center gap-2">
						<Zap className="w-5 h-5 text-gold-600" />
						Claude Code quota
					</h1>
					<p className="text-sm text-slate-500 mt-0.5">
						Live 5-hour and 7-day quota across all org accounts.
						Tokens are stored via the "Connect Claude" modal in each
						user's Studio settings.
					</p>
				</div>
				<div className="flex items-center gap-3">
					{lastFetch && (
						<span className="text-[11px] text-slate-400">
							updated {fmtTs(lastFetch.toISOString())}
						</span>
					)}
					<button
						onClick={() => load()}
						disabled={loading}
						className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-gold-700 transition disabled:opacity-50"
					>
						<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
						refresh
					</button>
				</div>
			</header>

			{error ? (
				<div className="text-sm rounded border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">
					{error}
				</div>
			) : accounts === null ? (
				<div className="text-sm text-slate-500 italic flex items-center gap-2">
					<Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
				</div>
			) : accounts.length === 0 ? (
				<div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
					<CheckCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
					<p className="text-sm text-slate-500">
						No accounts have connected a Claude token yet.
					</p>
					<p className="text-xs text-slate-400 mt-1">
						Users connect via Studio → Settings → Agent secrets → CLAUDE_CODE_OAUTH_TOKEN.
					</p>
				</div>
			) : (
				<>
					<SummaryBar accounts={accounts} />
					<div className="space-y-2">
						{accounts.map((a) => <AccountRow key={a.email} acc={a} />)}
					</div>
				</>
			)}
		</div>
	);
}
