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
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Loader2, UserPlus, X, Trash2 } from 'lucide-react';
import {
	fetchClaudeQuota,
	fetchClaudeUserUsage,
	adminAddClaudeToken,
	adminDeleteClaudeToken,
	type ClaudeQuotaAccount,
	type ClaudeUserUsageResp,
} from '@/api/super-admin';

// No auto-refresh — load once on mount; user clicks refresh manually.

function fmtTime(iso: string): string {
	if (!iso || iso.startsWith('0001')) return '—';
	const d = new Date(iso);
	const now = new Date();
	const diffMs = d.getTime() - now.getTime();
	if (diffMs < 0) return 'now';
	const h = Math.floor(diffMs / 3600000);
	const m = Math.floor((diffMs % 3600000) / 60000);
	if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
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


function MiniBar({ pct, severity }: { pct: number; severity: string }) {
	const fill =
		severity === 'critical' ? 'bg-rose-500' :
		severity === 'warning'  ? 'bg-amber-400' :
		pct > 60                ? 'bg-gold-400'  :
		'bg-emerald-400';
	return (
		<div className="w-16 h-1 rounded-full bg-slate-100 overflow-hidden">
			<div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(100, pct)}%` }} />
		</div>
	);
}

function AccountRow({
	acc,
	onDelete,
	onReAdd,
}: {
	acc: ClaudeQuotaAccount;
	onDelete: (email: string) => void;
	onReAdd: (email: string) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [deleting,   setDeleting]   = useState(false);

	async function handleDelete() {
		setDeleting(true);
		try { await adminDeleteClaudeToken(acc.email); onDelete(acc.email); }
		catch { setDeleting(false); setConfirming(false); }
	}

	const isAuthError = acc.error && (
		acc.error.includes('invalid') || acc.error.includes('unauthorized') ||
		acc.error.includes('401') || acc.error.includes('403') ||
		acc.error.includes('invalidated') || acc.error.includes('invalid_grant')
	);

	return (
		<div className="flex items-center gap-3 px-2.5 py-1.5 rounded border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors min-w-0">
			<SeverityDot severity={acc.severity} />

			{/* email */}
			<span className="w-44 shrink-0 truncate text-xs font-medium text-slate-800" title={acc.email}>
				{acc.email}
			</span>

			{/* 5h bar */}
			<div className="flex items-center gap-1.5 shrink-0">
				<span className="text-[10px] text-slate-400 w-4">5h</span>
				<MiniBar pct={acc.five_hour_pct ?? 0} severity={acc.severity} />
				<span className="text-[10px] font-mono text-slate-600 w-8 text-right">{Math.round(acc.five_hour_pct ?? 0)}%</span>
				<span className="text-[10px] text-slate-400 w-12">↺{fmtTime(acc.five_hour_reset)}</span>
			</div>

			{/* 7d bar */}
			<div className="flex items-center gap-1.5 shrink-0">
				<span className="text-[10px] text-slate-400 w-4">7d</span>
				<MiniBar pct={acc.seven_day_pct ?? 0} severity={acc.severity} />
				<span className="text-[10px] font-mono text-slate-600 w-8 text-right">{Math.round(acc.seven_day_pct ?? 0)}%</span>
				<span className="text-[10px] text-slate-400 w-14">↺{fmtTime(acc.seven_day_reset)}</span>
			</div>

			{/* error / stale / re-add */}
			{acc.error ? (
				<span className="flex items-center gap-1.5 flex-1 min-w-0">
					<span className="text-[10px] text-rose-500 truncate" title={acc.error}>
						{isAuthError ? 'Token expired' : acc.error}
					</span>
					<button
						onClick={() => onReAdd(acc.email)}
						className="shrink-0 text-[10px] text-rose-600 underline hover:text-rose-800 whitespace-nowrap"
					>
						re-add
					</button>
				</span>
			) : acc.stale ? (
				<span className="flex items-center gap-1.5 flex-1 min-w-0">
					<span className="text-[10px] text-amber-500">stale</span>
					<button
						onClick={() => onReAdd(acc.email)}
						className="shrink-0 text-[10px] text-slate-400 underline hover:text-slate-600 whitespace-nowrap"
					>
						re-add
					</button>
				</span>
			) : (
				<span className="flex items-center gap-1.5 flex-1 min-w-0">
					<button
						onClick={() => onReAdd(acc.email)}
						className="shrink-0 text-[10px] text-slate-300 underline hover:text-slate-500 whitespace-nowrap"
					>
						re-add
					</button>
				</span>
			)}

			{/* timestamp */}
			<span className="shrink-0 text-[10px] text-slate-400">{fmtTs(acc.ts)}</span>

			{/* delete */}
			{confirming ? (
				<div className="shrink-0 flex items-center gap-1">
					<button onClick={handleDelete} disabled={deleting}
						className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-rose-700 disabled:opacity-50 transition">
						{deleting ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'rm'}
					</button>
					<button onClick={() => setConfirming(false)} disabled={deleting}
						className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 disabled:opacity-50 transition">
						×
					</button>
				</div>
			) : (
				<button onClick={() => setConfirming(true)}
					className="shrink-0 text-slate-300 hover:text-rose-400 transition" title="Remove">
					<Trash2 className="w-3 h-3" />
				</button>
			)}
		</div>
	);
}

// ── Add-account modal ──────────────────────────────────────────────

function AddAccountModal({ onClose, onAdded, prefillEmail }: { onClose: () => void; onAdded: () => void; prefillEmail?: string }) {
	const [email,        setEmail]        = useState(prefillEmail ?? '');
	const [token,        setToken]        = useState('');
	const [refreshToken, setRefreshToken] = useState('');
	const [busy,         setBusy]         = useState(false);
	const [msg,          setMsg]          = useState<{ ok: boolean; text: string } | null>(null);

	const submit = async () => {
		const e = email.trim().toLowerCase();
		const t = token.trim();
		const rt = refreshToken.trim() || undefined;
		if (!e || !t) { setMsg({ ok: false, text: 'Email and token are required.' }); return; }
		setBusy(true);
		setMsg(null);
		try {
			const r = await adminAddClaudeToken(e, t, rt);
			if (r.valid && r.stored) {
				const extra = rt ? ' Auto-refresh enabled.' : '';
				setMsg({ ok: true, text: `Token stored for ${r.email}.${extra} Quota will refresh within 5 min.` });
				setTimeout(() => { onClose(); onAdded(); }, 1800);
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
					Log in as the target user with the Claude CLI, then copy their tokens:
				</p>
				<ol className="text-xs text-slate-600 space-y-1.5 mb-3 list-none">
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">1</span> <code className="font-mono">claude auth login</code> — sign in as the target user</li>
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">2</span> Copy both tokens from the output below</li>
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">3</span> <code className="font-mono">claude auth logout</code> — then log back in as yourself</li>
				</ol>
				<pre className="text-[11px] font-mono bg-slate-900 text-emerald-300 rounded px-3 py-2 mb-1 select-all overflow-x-auto">
{`node -e "const h=require('os').homedir(),c=JSON.parse(require('fs').readFileSync(h+'/.claude/.credentials.json','utf8')).claudeAiOauth;console.log('access:',c.accessToken,'\\nrefresh:',c.refreshToken)"`}
				</pre>
				<p className="text-xs text-slate-400 mb-4">
					Access token starts with <code className="font-mono bg-slate-100 px-1 rounded">sk-ant-oat01-</code>.
					Adding the refresh token enables <strong>auto-renewal</strong> when the access token expires.
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
						<label className="block text-xs font-medium text-slate-600 mb-1">Claude OAuth access token</label>
						<input
							type="password"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							placeholder="sk-ant-oat01-…"
							className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-gold-400"
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-slate-600 mb-1">
							Refresh token <span className="text-slate-400 font-normal">(optional — enables auto-renewal)</span>
						</label>
						<input
							type="password"
							value={refreshToken}
							onChange={(e) => setRefreshToken(e.target.value)}
							placeholder="paste refresh token here…"
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

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return String(n);
}

function fmtPct(pct: number): string {
	if (pct === 0) return '0%';
	if (pct < 1) return '<1%';
	return `${Math.round(pct)}%`;
}

function usageSeverity(pct: number): string {
	if (pct >= 100) return 'critical';
	if (pct >= 85) return 'warning';
	return 'normal';
}

function fmtCents(cents: number): string {
	if (cents === 0) return '$0';
	if (cents < 100) return `$${(cents / 100).toFixed(3)}`;
	return `$${(cents / 100).toFixed(2)}`;
}

function fmtReset(iso?: string): string {
	if (!iso || iso.startsWith('0001')) return '';
	const d = new Date(iso);
	const now = new Date();
	const diffMs = d.getTime() - now.getTime();
	if (diffMs <= 0) return 'now';
	const h = Math.floor(diffMs / 3600000);
	const m = Math.floor((diffMs % 3600000) / 60000);
	if (h > 24) return `↺${Math.floor(h / 24)}d`;
	if (h > 0) return `↺${h}h${m}m`;
	return `↺${m}m`;
}

// Per-user pool consumption — the per-PAT quota counterpart of the account
// table above. Same rolling 5h/7d windows, enforced by claude-proxy.
function UserUsageSection({ usage }: { usage: ClaudeUserUsageResp }) {
	if (!usage.users.length) return null;
	return (
		<div>
			<p className="text-xs font-medium text-slate-600 mb-1.5">
				Per-user pool usage
				<span className="ml-2 font-normal text-slate-400">
					caps: {fmtTokens(usage.five_hour_tokens)} tok / 5h · {fmtTokens(usage.seven_day_tokens)} tok / 7d (claude-* only)
					{' · '}users with a <code className="font-mono text-[10px]">claude:proxy</code> PAT appear even at 0 usage
				</span>
			</p>
			<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
				{usage.users.map((u) => {
					const sev = usageSeverity(Math.max(u.five_hour_pct, u.seven_day_pct));
					const reset5h = fmtReset(u.five_hour_reset);
					const reset7d = fmtReset(u.seven_day_reset);
					const modelEntries = u.models ? Object.entries(u.models).filter(([, v]) => v.tokens_7d > 0).sort((a, b) => b[1].tokens_7d - a[1].tokens_7d) : [];
					return (
						<div key={u.email} className="px-2.5 py-1.5 min-w-0">
							<div className="flex items-center gap-3">
								<SeverityDot severity={sev} />
								<span className="w-44 shrink-0 truncate text-xs font-medium text-slate-800" title={u.email}>
									{u.email}
								</span>
								<div className="flex items-center gap-1 shrink-0" title={`${u.five_hour_tokens.toLocaleString()} tokens`}>
									<span className="text-[10px] text-slate-400 w-4">5h</span>
									<MiniBar pct={u.five_hour_pct} severity={usageSeverity(u.five_hour_pct)} />
									<span className="text-[10px] font-mono text-slate-600 w-8 text-right">{fmtPct(u.five_hour_pct)}</span>
									{reset5h && <span className="text-[10px] text-slate-400 w-10">{reset5h}</span>}
								</div>
								<div className="flex items-center gap-1 shrink-0" title={`${u.seven_day_tokens.toLocaleString()} tokens`}>
									<span className="text-[10px] text-slate-400 w-4">7d</span>
									<MiniBar pct={u.seven_day_pct} severity={usageSeverity(u.seven_day_pct)} />
									<span className="text-[10px] font-mono text-slate-600 w-8 text-right">{fmtPct(u.seven_day_pct)}</span>
									{reset7d && <span className="text-[10px] text-slate-400 w-10">{reset7d}</span>}
								</div>
								<span className="flex-1 min-w-0 text-[10px] text-slate-400 truncate">
									{fmtTokens(u.seven_day_tokens)} tok · {u.requests_7d} req
									{u.cost_cents_7d > 0 && <> · <span className="text-slate-500">{fmtCents(u.cost_cents_7d)}</span></>}
								</span>
								<span className="shrink-0 text-[10px] text-slate-400">{fmtTs(u.last_ts)}</span>
							</div>
							{modelEntries.length > 0 && (
								<div className="flex flex-wrap gap-1.5 mt-0.5 ml-6">
									{modelEntries.map(([model, v]) => (
										<span key={model} className="text-[10px] font-mono text-slate-500 bg-slate-50 border border-slate-200 px-1.5 rounded" title={`${v.tokens_7d.toLocaleString()} tok`}>
											{model} {fmtTokens(v.tokens_7d)}{v.cost_cents_7d > 0 ? ` ${fmtCents(v.cost_cents_7d)}` : ''}
										</span>
									))}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SummaryBar({ accounts }: { accounts: ClaudeQuotaAccount[] }) {
	const critical = accounts.filter((a) => a.severity === 'critical').length;
	const warning  = accounts.filter((a) => a.severity === 'warning').length;
	const healthy  = accounts.length - critical - warning;
	return (
		<div className="flex items-center gap-4 text-xs text-slate-500">
			{critical > 0 && <span className="text-rose-600 font-medium">{critical} critical</span>}
			{warning  > 0 && <span className="text-amber-600 font-medium">{warning} warning</span>}
			<span className="text-emerald-600">{healthy} healthy</span>
			<span className="text-slate-300">/ {accounts.length} total</span>
		</div>
	);
}

export default function StudioClaudeQuota() {
	const [accounts, setAccounts] = useState<ClaudeQuotaAccount[] | null>(null);
	const [userUsage, setUserUsage] = useState<ClaudeUserUsageResp | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [lastFetch, setLastFetch] = useState<Date | null>(null);
	const [showAdd, setShowAdd] = useState(false);
	const [reAddEmail, setReAddEmail] = useState<string | undefined>(undefined);

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
		fetchClaudeUserUsage()
			.then(setUserUsage)
			.catch(() => {}); // section simply hidden if unavailable
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	return (
		<div className="space-y-3 max-w-3xl mx-auto">
			{showAdd && (
				<AddAccountModal
					onClose={() => { setShowAdd(false); setReAddEmail(undefined); }}
					onAdded={() => { setShowAdd(false); setReAddEmail(undefined); load(true); }}
					prefillEmail={reAddEmail}
				/>
			)}
			<header className="flex items-center justify-between">
				<div>
					<h1 className="text-base font-medium flex items-center gap-2">
						<Zap className="w-4 h-4 text-gold-600" />
						Claude Code quota
					</h1>
					<p className="text-xs text-slate-400 mt-0.5">
						Live 5h / 7d quota across all org accounts.
					</p>
				</div>
				<div className="flex items-center gap-3">
					{lastFetch && (
						<span className="text-[11px] text-slate-400">
							updated {fmtTs(lastFetch.toISOString())}
						</span>
					)}
					<button
						onClick={() => { setReAddEmail(undefined); setShowAdd(true); }}
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
					<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
						{accounts.map((a) => (
							<AccountRow
								key={a.email}
								acc={a}
								onDelete={(email) => setAccounts((prev) => prev?.filter((x) => x.email !== email) ?? [])}
								onReAdd={(email) => { setReAddEmail(email); setShowAdd(true); }}
							/>
						))}
					</div>
				</>
			)}

			{userUsage && <UserUsageSection usage={userUsage} />}

			{/* Setup: point your Claude Code CLI at the pool */}
			<div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
				<p className="text-xs font-medium text-slate-600 mb-2">Set up your Claude Code CLI to use the pool</p>
				<ol className="text-[11px] text-slate-500 space-y-2 mb-2 list-none">
					<li>
						<span className="font-mono bg-slate-200 text-slate-700 px-1.5 rounded mr-1.5">1</span>
						Mint a PAT at <a href="/dashboard/tokens" className="text-gold-700 hover:underline">/dashboard/tokens</a> with
						the scope <code className="font-mono bg-slate-100 px-1 rounded">claude:proxy</code>.
					</li>
					<li>
						<span className="font-mono bg-slate-200 text-slate-700 px-1.5 rounded mr-1.5">2</span>
						Add the pool endpoint + your PAT to <code className="font-mono bg-slate-100 px-1 rounded">~/.claude/settings.json</code> (applies
						to every session; your personal <code className="font-mono bg-slate-100 px-1 rounded">claude auth login</code> stays untouched — remove the two keys to switch back):
						<pre className="text-[11px] font-mono bg-slate-900 text-emerald-300 rounded px-3 py-2 mt-1.5 select-all overflow-x-auto">
{`{
  "env": {
    "ANTHROPIC_BASE_URL": "https://lum.id/claude",
    "ANTHROPIC_AUTH_TOKEN": "lm_pat_live_..."
  }
}`}
						</pre>
						<span className="block mt-1 text-slate-400">…or per-shell instead:</span>
						<pre className="text-[11px] font-mono bg-slate-900 text-emerald-300 rounded px-3 py-2 mt-1 select-all overflow-x-auto">
{`export ANTHROPIC_BASE_URL=https://lum.id/claude
export ANTHROPIC_AUTH_TOKEN=lm_pat_live_...`}
						</pre>
					</li>
					<li>
						<span className="font-mono bg-slate-200 text-slate-700 px-1.5 rounded mr-1.5">3</span>
						Run <code className="font-mono bg-slate-100 px-1 rounded">claude</code> as usual — requests route to the pooled
						account with the most quota. Model choice passes through
						(<code className="font-mono bg-slate-100 px-1 rounded">claude --model opus</code>, <code className="font-mono bg-slate-100 px-1 rounded">/model</code>).
					</li>
					<li>
						<span className="font-mono bg-slate-200 text-slate-700 px-1.5 rounded mr-1.5">4</span>
						<strong className="text-slate-700">Non-Anthropic models</strong> — require <code className="font-mono bg-slate-100 px-1 rounded">role=admin</code>; route through <code className="font-mono bg-slate-100 px-1 rounded">lum.id/llm</code>
						alongside the Anthropic pool — same PAT, same setup:
						<pre className="text-[11px] font-mono bg-slate-900 text-emerald-300 rounded px-3 py-2 mt-1.5 select-all overflow-x-auto">
{`claude --model kimi-k3              # Kimi K3 via Moonshot  ($3/$15 per M tok)
claude --model z-ai/glm-5.2         # GLM-5.2 via OpenRouter ($0.77/$2.42 per M tok)`}
						</pre>
						<span className="block mt-1 text-slate-400">
							Other in-cluster models (no auth tier): <code className="font-mono bg-slate-100 px-1 rounded">qwen3.6-27b</code> (default) · <code className="font-mono bg-slate-100 px-1 rounded">qwen3.6-35b-a3b</code> (MoE, long context).
							Token quota applies to <code className="font-mono bg-slate-100 px-1 rounded">claude-*</code> names only; other models record cost in USD.
						</span>
					</li>
				</ol>
				<p className="text-[11px] text-slate-400">
					Each user has their own 5h/7d pool budget (shown above once you've made requests).
					Recorded sessions: <a href="/claude-sessions" className="text-gold-700 hover:underline">/claude-sessions</a>.
					Full guide: <a href="/docs/claude" className="text-gold-700 hover:underline">/docs/claude</a>.
					This page: <a href="/code" className="text-gold-700 hover:underline">/code</a>.
				</p>
			</div>
		</div>
	);
}
