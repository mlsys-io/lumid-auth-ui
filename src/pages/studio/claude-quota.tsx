// Claude Code quota status across all org accounts — super_admin only.
//
// Reads every row in claude_quota_tokens (admin-managed via "Add account").
// Quota is fetched live from api.anthropic.com/v1/messages response headers
// (anthropic-ratelimit-unified-5h-utilization etc.) — 5-min server-side cache.
// Sorted by pressure (five_hour_pct DESC).
//
// The page auto-refreshes every 2 minutes. Stale/errored accounts show
// the last known snapshot with a warning badge.

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Clock, Loader2, UserPlus, X } from 'lucide-react';
import {
	fetchClaudeQuota,
	adminAddClaudeToken,
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

// ── Add-account modal ──────────────────────────────────────────────

function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
	const [email, setEmail] = useState('');
	const [token, setToken] = useState('');
	const [busy,  setBusy]  = useState(false);
	const [msg,   setMsg]   = useState<{ ok: boolean; text: string } | null>(null);

	const submit = async () => {
		const e = email.trim().toLowerCase();
		const t = token.trim();
		if (!e || !t) { setMsg({ ok: false, text: 'Email and token are required.' }); return; }
		setBusy(true);
		setMsg(null);
		try {
			const r = await adminAddClaudeToken(e, t);
			if (r.valid && r.stored) {
				setMsg({ ok: true, text: `Token stored for ${r.email}. Quota will refresh within 5 min.` });
				setTimeout(() => { onClose(); onAdded(); }, 1500);
			} else if (!r.valid) {
				setMsg({ ok: false, text: `Invalid token: ${r.reason}` });
			} else {
				setMsg({ ok: false, text: r.reason || 'Unknown error' });
			}
		} catch (err: any) {
			setMsg({ ok: false, text: String(err?.response?.data?.message || err?.message || err) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
			<div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg p-5 mx-4">
				<div className="flex items-center justify-between mb-4">
					<h2 className="font-semibold text-slate-800 flex items-center gap-2">
						<UserPlus className="w-4 h-4 text-gold-600" />
						Connect Claude account
					</h2>
					<button onClick={onClose} className="text-slate-400 hover:text-slate-700">
						<X className="w-4 h-4" />
					</button>
				</div>
				<p className="text-xs text-slate-500 mb-2">
					Log in as the target user with the Claude CLI, then copy their token:
				</p>
				<ol className="text-xs text-slate-600 space-y-1.5 mb-3 list-none">
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">1</span> <code className="font-mono">claude auth login</code> — sign in as the target user</li>
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">2</span> Copy the token printed below</li>
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">3</span> <code className="font-mono">claude auth logout</code> — then log back in as yourself</li>
				</ol>
				<pre className="text-[11px] font-mono bg-slate-900 text-emerald-300 rounded px-3 py-2 mb-3 select-all overflow-x-auto">
{`node -e "const h=require('os').homedir();console.log(JSON.parse(require('fs').readFileSync(h+'/.claude/.credentials.json','utf8')).claudeAiOauth.accessToken)"`}
				</pre>
				<p className="text-xs text-slate-400 mb-4">
					The token starts with <code className="font-mono bg-slate-100 px-1 rounded">sk-ant-oat01-</code> and is verified against Anthropic before storage.
				</p>
				<div className="space-y-3">
					<div>
						<label className="block text-xs font-medium text-slate-600 mb-1">User email</label>
						<input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="user@example.com"
							className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-slate-600 mb-1">Claude OAuth token</label>
						<input
							type="password"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							placeholder="sk-ant-oat01-…"
							className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-gold-400"
						/>
					</div>
					{msg && (
						<div className={`text-xs rounded px-2.5 py-2 ${msg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-800'}`}>
							{msg.text}
						</div>
					)}
					<div className="flex justify-end gap-2 pt-1">
						<button
							onClick={onClose}
							className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition"
						>
							Cancel
						</button>
						<button
							onClick={submit}
							disabled={busy}
							className="inline-flex items-center gap-1.5 rounded-md bg-gold-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-gold-700 disabled:opacity-50 transition"
						>
							{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
							Connect
						</button>
					</div>
				</div>
			</div>
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
	const [showAdd, setShowAdd] = useState(false);

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
			{showAdd && (
				<AddAccountModal
					onClose={() => setShowAdd(false)}
					onAdded={() => { setShowAdd(false); load(true); }}
				/>
			)}
			<header className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-medium flex items-center gap-2">
						<Zap className="w-5 h-5 text-gold-600" />
						Claude Code quota
					</h1>
					<p className="text-sm text-slate-500 mt-0.5">
						Live 5-hour and 7-day quota across all org accounts.
						Use "Add account" to register each user's Claude Code OAuth token.
					</p>
				</div>
				<div className="flex items-center gap-3">
					{lastFetch && (
						<span className="text-[11px] text-slate-400">
							updated {fmtTs(lastFetch.toISOString())}
						</span>
					)}
					<button
						onClick={() => setShowAdd(true)}
						className="inline-flex items-center gap-1.5 rounded-md border border-gold-300 bg-gold-50 px-2.5 py-1.5 text-xs font-medium text-gold-800 hover:bg-gold-100 transition"
					>
						<UserPlus className="w-3.5 h-3.5" />
						Add account
					</button>
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
						Click "Add account" above and paste each user's Claude Code OAuth token.
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
