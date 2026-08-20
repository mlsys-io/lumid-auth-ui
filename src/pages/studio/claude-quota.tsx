// Claude Code quota status across all org accounts — super_admin only.
//
// Reads every row in claude_quota_tokens (admin-managed via "Add account").
// Quota is fetched live from api.anthropic.com/v1/messages response headers
// (anthropic-ratelimit-unified-5h-utilization etc.) — 5-min server-side cache.
// Sorted by pressure (five_hour_pct DESC).
//
// The page auto-refreshes every 2 minutes. Stale/errored accounts show
// the last known snapshot with a warning badge.

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { RefreshCw, Zap, AlertTriangle, CheckCircle, Loader2, UserPlus, X, Trash2, RotateCcw } from 'lucide-react';
import {
	fetchClaudeQuota,
	fetchClaudeUserUsage,
	adminAddClaudeToken,
	adminDeleteClaudeToken,
	adminResetClaudePoolWindow,
	adminResetClaudePoolWindowAll,
	fetchClaudeFieldBoxes,
	type ClaudeFieldBoxResp,
	type ClaudeQuotaAccount,
	type ClaudeUserUsageResp,
} from '@/api/super-admin';

const USER_USAGE_REFRESH_MS = 2 * 60 * 1000; // 2 min auto-refresh for per-user section

// Known field boxes with a claude-field-relay tunnel already wired
// (deploy_infra: wg-relay-{denmark,chicago,nyc,nightly-dk}/). All four are
// live in LUMID_CLAUDE_FIELD_RELAYS on claude-proxy AND lumid-identity, so a
// label picked here routes that account's traffic — Messages API and OAuth
// refresh — out through that box's own IP.
//
// MUST stay in sync with LUMID_CLAUDE_FIELD_RELAYS. A label with no matching
// relay entry is not an error: claude-proxy's Director falls through to the
// normal direct-to-Anthropic path on a lookup miss, so the account silently
// behaves as if unlabeled. That is a quiet failure, which is exactly why this
// list exists. "Other…" still allows a free-text label, so this is a UX
// convenience (typo prevention), not a hard validation boundary.
const KNOWN_FIELD_BOXES = ['denmark', 'chicago', 'nyc', 'nightly-dk'];

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

	// `revoked` is the backend's first-class quarantine state (invalid_grant →
	// family revoked, refresh retries stopped). The string-match is a fallback
	// for older identity builds that only surface the raw error text.
	const isAuthError = acc.revoked || (acc.error && (
		acc.error.includes('invalid') || acc.error.includes('unauthorized') ||
		acc.error.includes('401') || acc.error.includes('403') ||
		acc.error.includes('invalidated') || acc.error.includes('invalid_grant')
	));

	return (
		<div className="flex items-center gap-3 px-2.5 py-1.5 rounded border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors min-w-0">
			<SeverityDot severity={acc.severity} />

			{/* email */}
			<span className="w-44 shrink-0 truncate text-xs font-medium text-slate-800" title={acc.email}>
				{acc.email}
			</span>

			{/* field-box label */}
			{acc.label && (
				<span
					className="shrink-0 rounded-full bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
					title={`Field-box account — routes via the ${acc.label} relay`}
				>
					{acc.label}
				</span>
			)}

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
					<span className="text-[10px] text-rose-500 truncate" title={acc.revoke_reason || acc.error}>
						{acc.revoked
							? 'Family revoked — re-add with a fresh claude auth login'
							: isAuthError ? 'Token expired' : acc.error}
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

// fmtBytes renders a byte count at human scale. Raw byte counts are unreadable
// at a glance and the interesting range here spans six orders of magnitude
// (a single turn is ~KB, a busy box does GB/day), so the unit has to float.
// Binary units (1024) to match how the wire figures are actually measured.
function fmtBytes(n: number): string {
	if (!n || n < 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let v = n;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	// Sub-10 values keep a decimal so 1.4 GB doesn't collapse to "1 GB";
	// above that the decimal is noise.
	return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function fmtCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

// FieldBoxPanel — per-field-box traffic + relay health.
//
// The via_relay column is the operational point, not the bytes: a labelled box
// showing "direct" turns means its account egressed from the CLUSTER, not the
// box, and the whole reason the field boxes exist is silently not happening.
// Nothing else in the product surfaces that.
function FieldBoxPanel() {
	const [data, setData] = useState<ClaudeFieldBoxResp | null>(null);
	// 1h by default: this panel is read to answer "what is happening now" —
	// is a box carrying traffic, is anything bypassing its relay. A 24h window
	// buries a routing regression that started ten minutes ago under a day of
	// healthy history. Wider windows stay one click away.
	const [hours, setHours] = useState(1);
	const [err, setErr] = useState('');

	useEffect(() => {
		let alive = true;
		fetchClaudeFieldBoxes(hours)
			.then((d) => { if (alive) { setData(d); setErr(''); } })
			.catch((e) => { if (alive) setErr(String(e)); });
		return () => { alive = false; };
	}, [hours]);

	if (err) return <div className="text-[11px] text-rose-500">Field-box traffic unavailable: {err}</div>;
	if (!data) return <div className="text-[11px] text-slate-400">Loading field-box traffic…</div>;

	const degraded = data.totals.degraded_turns;

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-medium text-slate-800">
					Field-box traffic
					<span className="ml-2 text-[11px] font-normal text-slate-400">
						{fmtCount(data.totals.homed_users)} users placed ·{' '}
						{fmtCount(data.totals.active_users)} active ·{' '}
						{fmtBytes(data.totals.request_bytes + data.totals.response_bytes)} over {data.window_hours}h
					</span>
				</h2>
				<select
					value={hours}
					onChange={(e) => setHours(Number(e.target.value))}
					className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
				>
					<option value={1}>1h</option>
					<option value={24}>24h</option>
					<option value={168}>7d</option>
				</select>
			</div>

			{degraded > 0 && (
				<div className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
					<span className="font-medium">{fmtCount(degraded)} turns bypassed their field box.</span>{' '}
					Those requests left from the cluster IP, not the box the account is labelled for —
					check <code>LUMID_CLAUDE_FIELD_RELAYS</code> and the relay containers.
				</div>
			)}

			<div className="rounded border border-slate-200 overflow-hidden">
				<table className="w-full text-[11px]">
					<thead className="bg-slate-50 text-slate-500">
						<tr>
							<th className="text-left  font-medium px-2.5 py-1">Box</th>
							{/* Users before the byte columns on purpose: rebalancing is
							    decided on people first, load second. Rendered
							    "homed/active" — placement, then who actually showed up. */}
							<th className="text-right font-medium px-2.5 py-1" title="Homed / active users">
								Users
							</th>
							<th className="text-right font-medium px-2.5 py-1">In</th>
							<th className="text-right font-medium px-2.5 py-1">Out</th>
							<th className="text-right font-medium px-2.5 py-1">Turns</th>
							{/* NOT the quota number, and deliberately not called "Tokens".
							    This column is raw input+output from claude_session_turns,
							    which (a) is only written for users who have session
							    recording ON, (b) has no cache columns at all, so cached
							    prompt tokens land inside "input", and (c) applies no model
							    weighting. The per-user table and the caps use
							    ClaudeWeightedTokensSQL over usage_events instead — the same
							    expression the proxy's admission gate uses. Over one 7-day
							    window the two read 1.55B vs 94.7M on "input" alone, so
							    presenting both as "Tokens" invited exactly the comparison
							    that cannot hold. */}
							<th
								className="text-right font-medium px-2.5 py-1"
								title={
									'Raw input+output from RECORDED turns only — not a quota figure.\n' +
									'• Only counts users with session recording enabled\n' +
									'• Excludes cache read/write tokens (usually the bulk of the draw)\n' +
									'• No model weighting\n' +
									'For quota, read the per-user table below.'
								}
							>
								Recorded tok
							</th>
							<th className="text-left  font-medium px-2.5 py-1">Routing</th>
						</tr>
					</thead>
					<tbody>
						{data.boxes.length === 0 && (
							<tr><td colSpan={7} className="px-2.5 py-2 text-slate-400">No recorded turns in this window.</td></tr>
						)}
						{data.boxes.map((b) => {
							const labelled = b.field_box !== '';
							const idle = b.turns === 0;
								const bad = labelled && b.not_via_relay > 0;
							return (
								<tr
										key={b.field_box || '(direct)'}
										className={`border-t border-slate-100 ${idle ? 'opacity-60' : ''}`}
									>
									<td className="px-2.5 py-1 font-medium text-slate-800">
										{b.field_box || <span className="text-slate-400">(direct)</span>}
										{b.fingerprint && (
											<span
												className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 font-mono text-[9px] font-normal text-slate-500 cursor-default"
												title={
													`${b.fingerprint.user_agent}\n` +
													`${b.fingerprint.os}/${b.fingerprint.arch} · ${b.fingerprint.runtime}\n` +
													(b.fingerprint.override
														? 'explicit override — does not rotate'
														: b.fingerprint.rotates_at
															? `rotates ${new Date(b.fingerprint.rotates_at).toLocaleDateString()}`
															: '')
												}
											>
												{b.fingerprint.package_version}
											</span>
										)}
									</td>
									<td
										className={`px-2.5 py-1 text-right font-mono ${b.homed_users > 0 ? 'text-slate-800' : 'text-slate-400'}`}
										title={
											`${b.homed_users} user(s) homed on this box's account (current placement) · ` +
											`${b.active_users} distinct user(s) actually routed through it in this window`
										}
									>
										{fmtCount(b.homed_users)}
										<span className="ml-1 font-normal text-slate-400">/{fmtCount(b.active_users)}</span>
									</td>
									<td className="px-2.5 py-1 text-right font-mono text-slate-600">{fmtBytes(b.request_bytes)}</td>
									<td className="px-2.5 py-1 text-right font-mono text-slate-600">{fmtBytes(b.response_bytes)}</td>
									<td className="px-2.5 py-1 text-right font-mono text-slate-600">{fmtCount(b.turns)}</td>
									<td
										className="px-2.5 py-1 text-right font-mono text-slate-500"
										title={
											'Recorded turns only, raw input+output, no cache, no model weighting — ' +
											'not comparable to the per-user token figures below.'
										}
									>
										{fmtCount(b.input_tokens + b.output_tokens)}
									</td>
									<td className="px-2.5 py-1">
										{idle ? (
											// A configured box with no turns in this window. Must NOT
											// render "all relayed" — that would be a health claim about
											// traffic that never happened.
											<span className="text-slate-400">no traffic</span>
										) : !labelled ? (
											<span className="text-slate-400">direct by design</span>
										) : bad ? (
											<span className="text-amber-600">
												{fmtCount(b.via_relay)} relayed · {fmtCount(b.not_via_relay)} direct
											</span>
										) : (
											<span className="text-emerald-600">all relayed</span>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<p className="text-[10px] text-slate-400">
				Users read <span className="font-mono">homed/active</span>: homed is who is assigned to the
				box's account right now (the balancing number, not windowed); active is who actually routed
				through it in the window. Active overlaps between boxes because leases rotate, and misses
				users who opted out of transcript recording — read it as a floor.
				Sizes are true wire bytes, unaffected by the transcript cap.
				{' '}<span className="font-mono">Recorded tok</span> is raw input+output from those same
				recorded turns — it excludes cache tokens and applies no model weighting, so it is a
				traffic-shape indicator and <strong>not</strong> a quota figure. Quota is the weighted
				per-user number below, computed with the same expression the proxy's admission gate uses.
				{data.signal_since
					? ` Routing verified for turns since ${new Date(data.signal_since).toLocaleString()}.`
					: ' Routing verification has no data yet.'}
			</p>
		</section>
	);
}

// ── Add-account modal ──────────────────────────────────────────────

function AddAccountModal({
	onClose, onAdded, prefillEmail, prefillLabel, takenLabels,
}: {
	onClose: () => void; onAdded: () => void; prefillEmail?: string; prefillLabel?: string;
	// label -> the OTHER account already holding it (this account's own current
	// label, on a re-add, is excluded by the caller so it doesn't block itself).
	takenLabels?: Record<string, string>;
}) {
	const [email,        setEmail]        = useState(prefillEmail ?? '');
	const [token,        setToken]        = useState('');
	const [refreshToken, setRefreshToken] = useState('');
	const [label,        setLabel]        = useState(prefillLabel ?? '');
	// Custom mode = free-text entry for a field box not yet in KNOWN_FIELD_BOXES
	// (e.g. onboarding a third box ahead of adding it to the known list).
	const [customLabel,  setCustomLabel]  = useState(!!prefillLabel && !KNOWN_FIELD_BOXES.includes(prefillLabel));
	const [busy,         setBusy]         = useState(false);
	const [msg,          setMsg]          = useState<{ ok: boolean; text: string } | null>(null);

	const submit = async () => {
		const e = email.trim().toLowerCase();
		const t = token.trim();
		const rt = refreshToken.trim() || undefined;
		const lb = label.trim() || undefined;
		if (!e || !t) { setMsg({ ok: false, text: 'Email and token are required.' }); return; }
		if (lb && takenLabels?.[lb]) {
			setMsg({ ok: false, text: `"${lb}" is already allocated to ${takenLabels[lb]} — pick a different label or clear this account's first.` });
			return;
		}
		setBusy(true);
		setMsg(null);
		try {
			const r = await adminAddClaudeToken(e, t, rt, lb);
			if (r.valid && r.stored) {
				const extra = rt ? ' Auto-refresh enabled.' : '';
				const boxNote = lb ? ` Tagged "${lb}" — routes via that field box's relay.` : '';
				setMsg({ ok: true, text: `Token stored for ${r.email}.${extra}${boxNote} Quota will refresh within 5 min.` });
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
					Mint the token in a <strong>throwaway HOME</strong>, so your own Claude session is
					never touched and no second copy is left behind. Run this whole block:
				</p>
				<ol className="text-xs text-slate-600 space-y-1.5 mb-3 list-none">
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">1</span> Paste the block — it signs in as the target user inside a temporary directory</li>
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">2</span> Copy both tokens from the output into the fields below</li>
					<li><span className="font-mono bg-slate-100 px-1 rounded mr-1">3</span> The directory is deleted on the last line — nothing to undo, nothing to log out of</li>
				</ol>
				<pre className="text-[11px] font-mono bg-slate-900 text-emerald-300 rounded px-3 py-2 mb-1 select-all overflow-x-auto">
{`D=$(mktemp -d)
HOME=$D claude auth login
HOME=$D node -e "const c=JSON.parse(require('fs').readFileSync(process.env.HOME+'/.claude/.credentials.json','utf8')).claudeAiOauth;console.log('access:',c.accessToken,'\\nrefresh:',c.refreshToken)"
rm -rf "$D"`}
				</pre>
				<div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-2 mb-3">
					<strong>Never run <code className="font-mono">claude auth logout</code> for a pooled account.</strong>{" "}
					Logout revokes the token family on Anthropic's side, destroying the credential you just
					copied — an account added on 2026-08-15 died 3 minutes later this way. Equally, never mint
					into your normal <code className="font-mono">~/.claude</code>: if the credential stays there,
					your own Claude Code refreshes it on its own schedule, rotates the family, and the pool's
					copy dies hours later (this killed two more accounts). Discarding is safe; revoking and
					sharing are not.
				</div>
				<p className="text-xs text-slate-400 mb-4">
					Access token starts with <code className="font-mono bg-slate-100 px-1 rounded">sk-ant-oat01-</code>.
					Adding the refresh token enables <strong>auto-renewal</strong> when the access token expires.
					The pool must be the <strong>only</strong> holder of this credential.
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
					<div>
						<label className="block text-xs font-medium text-slate-600 mb-1">
							Field box <span className="text-slate-400 font-normal">(optional)</span>
						</label>
						<select
							value={customLabel ? '__custom__' : label}
							onChange={(e) => {
								if (e.target.value === '__custom__') { setCustomLabel(true); setLabel(''); }
								else { setCustomLabel(false); setLabel(e.target.value); }
							}}
							className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gold-400"
						>
							<option value="">— none (normal pooled account) —</option>
							{KNOWN_FIELD_BOXES.map((box) => {
								const takenBy = takenLabels?.[box];
								return (
									<option key={box} value={box} disabled={!!takenBy}>
										{box}{takenBy ? ` — already allocated (${takenBy})` : ''}
									</option>
								);
							})}
							<option value="__custom__">Other…</option>
						</select>
						{label && takenLabels?.[label] && !customLabel && (
							<p className="text-[11px] text-rose-500 mt-1">
								"{label}" is already allocated to {takenLabels[label]} — each field box holds one account.
							</p>
						)}
						{customLabel && (
							<input
								type="text"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder="new field-box label"
								autoFocus
								className="w-full mt-2 rounded border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-gold-400"
							/>
						)}
						<p className="text-[11px] text-slate-400 mt-1">
							Tags this account as belonging to a field box — its traffic routes through that box's relay instead of the pool's default network.
						</p>
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
// table above. NOTE: this short window is LUMID's own per-user fairness cap
// (env-tunable, 4h since 2026-08-11) and is deliberately NOT the same thing
// as the 5h window in the account table above, which is Anthropic's own
// rate-limit window for the pooled subscription. They drift out of phase.
function UserUsageSection({
	usage,
	countdown,
	onReset,
	isSuper,
}: {
	usage: ClaudeUserUsageResp;
	countdown: number;
	// /code is AdminGuard, the reset route is RequireSuperAdmin — so the page
	// has viewers who must not be shown the reset controls at all.
	isSuper: boolean;
	// Re-fetch after a reset so the row shows 0% immediately rather than the
	// pre-reset figure until the 2-minute auto-refresh happens to fire.
	onReset: () => void;
}) {
	if (!usage.users.length) return null;
	const shortWin = usage.short_window_label || '4h';
	const mm = Math.floor(countdown / 60);
	const ss = countdown % 60;
	const cdText = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
	return (
		<div>
			<div className="flex items-center gap-2 mb-1.5">
				<p className="text-xs font-medium text-slate-600">
					Per-user pool usage
				</p>
				<span className="text-[10px] text-slate-400 font-normal">
					caps: {fmtTokens(usage.five_hour_tokens)} tok / {shortWin} · {fmtTokens(usage.seven_day_tokens)} tok / 7d (claude-* only)
					{' · '}users with a <code className="font-mono text-[10px]">claude:proxy</code> PAT appear even at 0 usage
				</span>
				<span className="ml-auto shrink-0 flex items-center gap-2">
					<ResetAllButton isSuper={isSuper} userCount={usage.users.length} shortLabel={shortWin} onDone={onReset} />
					<span className="text-[10px] text-slate-400 tabular-nums">↺ {cdText}</span>
				</span>
			</div>
			<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
				{usage.users.map((u) => {
					const sev = usageSeverity(Math.max(u.five_hour_pct, u.seven_day_pct));
					const resetShort = fmtReset(u.five_hour_reset);
					const reset7d = fmtReset(u.seven_day_reset);
					return (
						<div key={u.email} className="px-2.5 py-1.5 min-w-0">
							<div className="flex items-center gap-3">
								<SeverityDot severity={sev} />
								<span className="w-44 shrink-0 truncate text-xs font-medium text-slate-800" title={u.email}>
									{u.email}
								</span>
								<div className="flex items-center gap-1 shrink-0" title={`${u.five_hour_tokens.toLocaleString()} tokens`}>
									<span className="text-[10px] text-slate-400 w-4">{shortWin}</span>
									<MiniBar pct={u.five_hour_pct} severity={usageSeverity(u.five_hour_pct)} />
									<span className="text-[10px] font-mono text-slate-600 w-8 text-right">{fmtPct(u.five_hour_pct)}</span>
									{resetShort && <span className="text-[10px] text-slate-400 w-10">{resetShort}</span>}
								</div>
								<div className="flex items-center gap-1 shrink-0" title={`${u.seven_day_tokens.toLocaleString()} tokens`}>
									<span className="text-[10px] text-slate-400 w-4">7d</span>
									<MiniBar pct={u.seven_day_pct} severity={usageSeverity(u.seven_day_pct)} />
									<span className="text-[10px] font-mono text-slate-600 w-8 text-right">{fmtPct(u.seven_day_pct)}</span>
									{reset7d && <span className="text-[10px] text-slate-400 w-10">{reset7d}</span>}
								</div>
								{/* BEFORE the flex-1 filler on purpose. Appended after it (and after
								    the timestamp) these sat at the extreme right of an already dense
								    row with no flex-wrap, so on anything but a very wide window they
								    were pushed out of view — shipped once that way and invisible. */}
								<ResetWindowButtons isSuper={isSuper} email={u.email} shortLabel={shortWin} onDone={onReset} />
								<span className="flex-1 min-w-0 text-[10px] text-slate-400 truncate">
									{fmtTokens(u.seven_day_tokens)} tok · {u.requests_7d} req
									{u.cost_cents_7d > 0 && <> · <span className="text-slate-500">{fmtCents(u.cost_cents_7d)}</span></>}
								</span>
								<span className="shrink-0 text-[10px] text-slate-400">{fmtTs(u.last_ts)}</span>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

// Reset the clock for EVERY user. Deliberately harder to fire than the per-row
// button: this is the fleet-wide giveaway, and the two are one click apart on the
// same screen.
//
// Friction is a typed confirmation naming the exact user count, not a yes/no —
// window.confirm on a destructive-ish bulk action is muscle-memory dismissed. The
// count comes from the rendered list, so the operator confirms against what they
// can actually see.
//
// "both" is offered because the case this exists for is a cap retune (2026-08-11:
// 4M/5h -> 2M/4h left every anchor stale under the old policy), where you want
// everyone clean on both clocks at once.
function ResetAllButton({ isSuper, userCount, shortLabel, onDone }: { isSuper: boolean; userCount: number; shortLabel: string; onDone: () => void }) {
	const [open, setOpen] = useState(false);
	const [win, setWin] = useState<'short' | 'weekly' | 'both'>('short');
	const [typed, setTyped] = useState('');
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	// Result of the last fleet reset. The handler reports rows-affected so a
	// pool-wide reset "is never silent"; echoing it here is the only place an
	// operator sees it without reading identity's logs. Note it can legitimately
	// be LOWER than userCount — only users with an open window have a row.
	const [done, setDone] = useState<{ reset: number; window: string } | null>(null);

	const phrase = `reset ${userCount}`;
	const armed = typed.trim().toLowerCase() === phrase;

	const run = async () => {
		if (!armed) return;
		setBusy(true);
		setErr(null);
		try {
			const r = await adminResetClaudePoolWindowAll(win);
			setDone(r);
			setOpen(false);
			setTyped('');
			onDone();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	if (!isSuper) return null;
	if (!open) {
		return (
			<span className="inline-flex items-center gap-1.5">
			{done && (
				<span className="text-[10px] text-emerald-700" title="rows affected, reported by the server">
					reset {done.reset} {done.window}
				</span>
			)}
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5
					text-[10px] font-medium text-amber-800 hover:bg-amber-100 transition"
				title={`Reset the quota clock for all ${userCount} users`}
			>
				<RotateCcw className="w-2.5 h-2.5" />
				reset all
			</button>
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1">
			<span className="text-[10px] text-amber-900">
				reset <strong>all {userCount}</strong> users:
			</span>
			{(['short', 'weekly', 'both'] as const).map((w) => (
				<button
					key={w}
					type="button"
					onClick={() => setWin(w)}
					className={`rounded px-1 py-0.5 text-[10px] font-medium transition ${
						win === w ? 'bg-amber-600 text-white' : 'text-amber-800 hover:bg-amber-100'
					}`}
				>
					{w === 'short' ? shortLabel : w === 'weekly' ? '7d' : 'both'}
				</button>
			))}
			<input
				value={typed}
				onChange={(e) => setTyped(e.target.value)}
				placeholder={`type "${phrase}"`}
				className="w-28 rounded border border-amber-300 px-1 py-0.5 text-[10px] font-mono
					focus:outline-none focus:border-amber-500"
			/>
			<button
				type="button"
				onClick={() => void run()}
				disabled={!armed || busy}
				className="rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white
					hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
			>
				{busy ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'confirm'}
			</button>
			<button
				type="button"
				onClick={() => { setOpen(false); setTyped(''); setErr(null); }}
				className="text-[10px] text-amber-700 hover:text-amber-900"
			>
				cancel
			</button>
			{err && <span className="text-[10px] text-red-600 max-w-[10rem] truncate" title={err}>{err}</span>}
		</span>
	);
}

// Reset one user's pooled-quota clock. super_admin only — the route is
// RequireSuperAdmin server-side.
//
// NOTE: this page is NOT super_admin-gated. /code sits behind AdminGuard, so a
// plain `admin` loads it fine; only the reset ROUTE is super_admin. An earlier
// version of this comment claimed the page was gated and rendered the buttons
// unconditionally, which showed every admin a control that could only ever
// answer 403 "super_admin required". Both controls now take an `isSuper` prop
// and render nothing without it. The server check is still the real boundary —
// this is about not offering an action the viewer cannot take.
//
// the
// button is the third gate, not the only one.
//
// Confirms first. Resetting is not destructive (the server EXPIRES the anchor, so
// the user simply reads zero and opens a fresh window on their next charge) but it
// IS a quota giveaway, and the two windows are worth very different amounts: the
// 4h clock refreshes on its own within hours, the 7d one is the weekly budget.
function ResetWindowButtons({
	isSuper,
	email,
	shortLabel,
	onDone,
}: {
	isSuper: boolean;
	email: string;
	shortLabel: string;
	onDone: () => void;
}) {
	const [busy, setBusy] = useState<'short' | 'weekly' | null>(null);
	const [err, setErr] = useState<string | null>(null);

	const run = async (win: 'short' | 'weekly') => {
		const label = win === 'short' ? shortLabel : '7d';
		if (!window.confirm(`Reset the ${label} quota clock for ${email}?`)) return;
		setBusy(win);
		setErr(null);
		try {
			await adminResetClaudePoolWindow(email, win);
			onDone();
		} catch (e) {
			// Surface the failure on the row. A silent no-op here would be worse
			// than useless: the operator would believe the user was unblocked and
			// the user would keep getting 429s.
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	};


	// Rendered on an AdminGuard page, but the endpoint is RequireSuperAdmin.
	// Without this a plain admin sees a button whose only outcome is a 403.
	if (!isSuper) return null;
	return (
		<span className="flex items-center gap-1 shrink-0">
			<span className="text-[10px] text-slate-400">reset</span>
			{(['short', 'weekly'] as const).map((win) => {
				const label = win === 'short' ? shortLabel : '7d';
				return (
					<button
						key={win}
						type="button"
						onClick={() => void run(win)}
						disabled={busy !== null}
						title={`Reset this user's ${label} quota window`}
						className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50/60 px-1.5 py-0.5
							text-[10px] font-medium text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300
							disabled:opacity-40 disabled:cursor-not-allowed transition"
					>
						{busy === win ? (
							<Loader2 className="w-2.5 h-2.5 animate-spin" />
						) : (
							<RotateCcw className="w-2.5 h-2.5" />
						)}
						{label}
					</button>
				);
			})}
			{err && (
				<span className="text-[10px] text-red-600 max-w-[10rem] truncate" title={err}>
					{err}
				</span>
			)}
		</span>
	);
}

// Per-model usage + cost, aggregated across all pool users — 7d window.
// claude-* models draw on the pooled quota (tokens); other models are
// pay-per-use and carry a USD cost.
function ModelCostPanel({ usage }: { usage: ClaudeUserUsageResp }) {
	const byModel = new Map<string, { tokens: number; cost: number; users: { email: string; tokens: number; cost: number }[] }>();
	for (const u of usage.users) {
		if (!u.models) continue;
		for (const [model, v] of Object.entries(u.models)) {
			if (v.tokens_7d <= 0 && v.cost_cents_7d <= 0) continue;
			let agg = byModel.get(model);
			if (!agg) { agg = { tokens: 0, cost: 0, users: [] }; byModel.set(model, agg); }
			agg.tokens += v.tokens_7d;
			agg.cost += v.cost_cents_7d;
			agg.users.push({ email: u.email, tokens: v.tokens_7d, cost: v.cost_cents_7d });
		}
	}
	if (byModel.size === 0) return null;

	const rows = [...byModel.entries()].sort((a, b) => (b[1].cost - a[1].cost) || (b[1].tokens - a[1].tokens));
	const maxTokens = Math.max(...rows.map(([, v]) => v.tokens), 1);
	const totalCost = rows.reduce((s, [, v]) => s + v.cost, 0);
	const totalTokens = rows.reduce((s, [, v]) => s + v.tokens, 0);

	return (
		<div>
			<div className="flex items-center gap-2 mb-1.5">
				<p className="text-xs font-medium text-slate-600">Per-model usage &amp; cost · 7d</p>
				<span className="text-[10px] text-slate-400 font-normal">
					<code className="font-mono text-[10px]">claude-*</code> draws pool quota (tokens); other models bill per use
				</span>
				<span className="ml-auto shrink-0 text-[10px] font-mono text-slate-500">
					{fmtTokens(totalTokens)} tok{totalCost > 0 ? ` · ${fmtCents(totalCost)}` : ''}
				</span>
			</div>
			<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
				{rows.map(([model, v]) => {
					const users = [...v.users].sort((a, b) => (b.cost - a.cost) || (b.tokens - a.tokens));
					return (
						<div key={model} className="flex items-center gap-3 px-2.5 py-1.5 min-w-0">
							<span className="w-44 shrink-0 truncate text-xs font-mono text-slate-800" title={model}>
								{model}
							</span>
							<div className="w-24 h-1 rounded-full bg-slate-100 overflow-hidden shrink-0" title={`${v.tokens.toLocaleString()} tokens`}>
								<div className="h-full rounded-full bg-gold-400" style={{ width: `${Math.max(2, (v.tokens / maxTokens) * 100)}%` }} />
							</div>
							<span className="w-14 shrink-0 text-right text-[10px] font-mono text-slate-600">{fmtTokens(v.tokens)}</span>
							<span className="w-14 shrink-0 text-right text-[10px] font-mono text-slate-700">
								{v.cost > 0 ? fmtCents(v.cost) : <span className="text-slate-300">pool</span>}
							</span>
							<span className="flex-1 min-w-0 truncate text-[10px] text-slate-400">
								{users.slice(0, 4).map((uu, i) => (
									<span key={uu.email} title={`${uu.tokens.toLocaleString()} tok${uu.cost > 0 ? ` · ${fmtCents(uu.cost)}` : ''}`}>
										{i > 0 && ' · '}
										{uu.email.split('@')[0]} {fmtTokens(uu.tokens)}{uu.cost > 0 ? ` ${fmtCents(uu.cost)}` : ''}
									</span>
								))}
								{users.length > 4 && ` · +${users.length - 4} more`}
							</span>
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
	// /code is AdminGuard (admin + super_admin); the reset endpoint is
	// RequireSuperAdmin. Gate the reset controls on the stricter of the two.
	const { user } = useAuth();
	const isSuper = user?.role === 'super_admin';
	const [accounts, setAccounts] = useState<ClaudeQuotaAccount[] | null>(null);
	const [userUsage, setUserUsage] = useState<ClaudeUserUsageResp | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [lastFetch, setLastFetch] = useState<Date | null>(null);
	const [showAdd, setShowAdd] = useState(false);
	const [reAddEmail, setReAddEmail] = useState<string | undefined>(undefined);
	const [countdown, setCountdown] = useState(USER_USAGE_REFRESH_MS / 1000);
	const countdownRef = useRef(USER_USAGE_REFRESH_MS / 1000);

	const loadUserUsage = useCallback(() => {
		fetchClaudeUserUsage()
			.then(setUserUsage)
			.catch(() => {});
	}, []);

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
		loadUserUsage();
	}, [loadUserUsage]);

	// Auto-refresh user usage every 2 min with a live countdown.
	useEffect(() => {
		load();
		const tick = setInterval(() => {
			countdownRef.current -= 1;
			if (countdownRef.current <= 0) {
				countdownRef.current = USER_USAGE_REFRESH_MS / 1000;
				loadUserUsage();
			}
			setCountdown(countdownRef.current);
		}, 1000);
		return () => clearInterval(tick);
	}, [load, loadUserUsage]);

	return (
		<div className="space-y-3 max-w-3xl mx-auto">
			{showAdd && (
				<AddAccountModal
					onClose={() => { setShowAdd(false); setReAddEmail(undefined); }}
					onAdded={() => { setShowAdd(false); setReAddEmail(undefined); load(true); }}
					prefillEmail={reAddEmail}
					prefillLabel={reAddEmail ? accounts?.find((a) => a.email === reAddEmail)?.label : undefined}
					// Every OTHER account's label is "taken" — a re-add excludes its own
					// current label so it doesn't block re-registering itself.
					takenLabels={Object.fromEntries(
						(accounts ?? [])
							.filter((a) => a.label && a.email !== reAddEmail)
							.map((a) => [a.label as string, a.email]),
					)}
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

			{/* Per-field-box traffic + relay health. Self-contained (own fetch)
			    so a field-box outage can't blank the quota page above it. */}
			<FieldBoxPanel />

			{userUsage && <UserUsageSection usage={userUsage} countdown={countdown} onReset={loadUserUsage} isSuper={isSuper} />}

			{userUsage && <ModelCostPanel usage={userUsage} />}

			<p className="text-[11px] text-slate-400">
				Setup + full guide: <a href="/docs/claude" className="text-gold-700 hover:underline">/docs/claude</a>.
				Recorded sessions: <a href="/claude-sessions" className="text-gold-700 hover:underline">/claude-sessions</a>.
				Mint a <code className="font-mono bg-slate-100 px-1 rounded">claude:proxy</code> PAT at <a href="/dashboard/tokens" className="text-gold-700 hover:underline">/dashboard/tokens</a>.
			</p>
		</div>
	);
}
