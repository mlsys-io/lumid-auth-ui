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
	adminSetClaudeAccountDrain,
	adminResetClaudePoolWindow,
	adminResetClaudePoolWindowAll,
	fetchClaudeFieldBoxes,
	fetchOpenRouterBalance,
	type ClaudeFieldBoxResp,
	type ClaudeQuotaAccount,
	type ClaudeUserUsageResp,
	type OpenRouterBalanceResp,
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
		// 'none' = no cap applies (admin/super_admin). Deliberately NOT green:
		// green claims "healthy, plenty of headroom", which is a measurement, and
		// there is nothing being measured. Slate reads as not-applicable.
		severity === 'none'     ? 'bg-slate-300' :
		'bg-emerald-400';
	return <span className={`inline-block w-2 h-2 rounded-full ${cls} shrink-0`} />;
}


// A bar and the number beside it describe the SAME quantity, so they must carry
// the same colour. They did not: every fill was severity-coded (rose / amber /
// gold / sky / violet) while every percentage rendered flat slate-600, so a row
// at 99% showed a red bar next to grey text and read as unremarkable. The reset
// clocks were already matched to their bar half; the numbers were the one thing
// left out.
//
// Both helpers below derive from the SAME predicates as their fill counterpart,
// deliberately adjacent to it, so the pair cannot drift. Text sits a step darker
// than the fill (-600 vs -400/-500) because a 10px glyph needs more contrast
// than a 4px bar to read at the same weight.
// Account rows carry the same two channels. `severity` is the SERVER's verdict
// for the account (not recomputed from pct), so this mirrors MiniBar's ladder
// rather than usageSeverity's.
function severityText(pct: number, severity: string, window: 'short' | 'week'): string {
	const short = window === 'short';
	if (severity === 'critical') return short ? 'text-rose-500' : 'text-rose-700';
	if (severity === 'warning') return short ? 'text-amber-500' : 'text-amber-700';
	if (pct > 60) return short ? 'text-gold-500' : 'text-gold-700';
	return short ? 'text-emerald-500' : 'text-emerald-700';
}

// Text runs a step darker than its fill at both ends — a 10px glyph needs more
// contrast than a 4px bar to read at the same weight — while keeping the same
// light/dark split between the windows.
function windowText(pct: number, window: 'short' | 'week'): string {
	const short = window === 'short';
	switch (usageSeverity(pct)) {
		case 'critical': return short ? 'text-rose-500' : 'text-rose-700';
		case 'warning': return short ? 'text-amber-500' : 'text-amber-700';
	}
	if (pct > 60) return short ? 'text-gold-500' : 'text-gold-700';
	return short ? 'text-emerald-500' : 'text-emerald-700';
}

function MiniBar({ pct, severity, window = 'short', w = 'w-16' }: { pct: number; severity: string; window?: 'short' | 'week'; w?: string }) {
	const short = window === 'short';
	const fill =
		severity === 'critical' ? (short ? 'bg-rose-400' : 'bg-rose-600') :
		severity === 'warning'  ? (short ? 'bg-amber-300' : 'bg-amber-500') :
		pct > 60                ? (short ? 'bg-gold-300' : 'bg-gold-500') :
		(short ? 'bg-emerald-300' : 'bg-emerald-500');
	return (
		<div className={`${w} h-1 rounded-full bg-slate-100 overflow-hidden`}>
			<div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(100, pct)}%` }} />
		</div>
	);
}

// StackedBar — the per-user 4h and 7d windows on ONE track, so a row reads at a
// glance instead of two separate bars. The 4h window fills from the LEFT, the
// 7d from the RIGHT; they meet in the middle. Each side keeps its own severity
// colour, and the centre gap shows how much headroom remains on both.
// The two halves of the track are DIFFERENT WINDOWS, and they were drawn in the
// same colour — identical severity ramp for both — so which half you were
// looking at could only be inferred from its position. They now carry distinct
// hues at rest: sky for the short window, violet for the 7d.
//
// Severity still overrides both. A bar approaching its cap has to read as
// approaching its cap whichever window it belongs to, so warning/critical keep
// amber/rose and the window hue only applies while there is headroom. Telling
// 4h from 7d matters less than telling "fine" from "about to be denied".
// ONE COLOUR LANGUAGE FOR USAGE, page-wide.
//
// This used to fall back to sky (4h) / violet (7d), so the same quantity was
// coloured two different ways depending on which panel you looked at: an
// account bar at 70% rendered gold-400 (#C5A75E, a bronze that reads brown)
// while a user row at 30% rendered cyan and purple. Nothing tied them together,
// and adding colour to the numbers made the clash obvious rather than causing
// it.
//
// Severity is now the only thing that drives usage colour anywhere:
// emerald -> gold -> amber -> rose, identical to MiniBar. WHICH WINDOW a figure
// belongs to is still unambiguous without colour — the 4h half fills from the
// left and the 7d from the right, and the reset clocks beside them keep their
// sky/violet identity. Position and the clocks carry window; colour carries
// pressure. One meaning per channel.
// TWO CHANNELS, TWO MEANINGS.
//
//   HUE   = pressure   emerald -> gold -> amber -> rose
//   SHADE = window     4h is the light step, 7d the dark one
//
// Getting here took two wrong turns worth recording. First the fills encoded the
// WINDOW as hue (sky/violet) while the figures beside them were flat slate, so
// the same quantity was two colours depending which panel you read. Collapsing
// everything to severity fixed that and broke the other half: with hue carrying
// only pressure, a 4h and a 7d mark at similar load became indistinguishable.
//
// Hue and shade are independent channels, so both facts fit without collision: a
// window stays ONE colour across its bar half, its percentage and its clock,
// while 4h and 7d remain tellable apart at a glance.
//
// Class names are written out in full on purpose — Tailwind scans for literal
// strings, so a computed `bg-${hue}-${shade}` would be purged from the bundle
// and silently render unstyled.
function windowFill(pct: number, window: 'short' | 'week'): string {
	const short = window === 'short';
	switch (usageSeverity(pct)) {
		case 'critical': return short ? 'bg-rose-400' : 'bg-rose-600';
		case 'warning': return short ? 'bg-amber-300' : 'bg-amber-500';
	}
	if (pct > 60) return short ? 'bg-gold-300' : 'bg-gold-500';
	return short ? 'bg-emerald-300' : 'bg-emerald-500';
}

function StackedBar({ shortPct, weekPct }: { shortPct: number; weekPct: number }) {
	const shortFill = windowFill(shortPct, 'short');
	const weekFill = windowFill(weekPct, 'week');
	// Cap each side at 50% of the track so they never overlap; the pct text
	// beside the bar carries the true number beyond that.
	const shortW = Math.min(50, shortPct / 2);
	const weekW = Math.min(50, weekPct / 2);
	return (
		<div className="w-20 h-1 rounded-full bg-slate-100 overflow-hidden flex shrink-0"
			title={`${shortPct.toFixed(0)}% of the 4h cap (left) · ${weekPct.toFixed(0)}% of the 7d cap (right) — colour is pressure, not window`}>
			<div className={`h-full rounded-l-full ${shortFill}`} style={{ width: `${shortW}%` }} />
			<div className="flex-1" />
			<div className={`h-full rounded-r-full ${weekFill}`} style={{ width: `${weekW}%` }} />
		</div>
	);
}

function AccountRow({
	acc,
	onDelete,
	onReAdd,
	onChanged,
}: {
	acc: ClaudeQuotaAccount;
	onDelete: (email: string) => void;
	onReAdd: (email: string) => void;
	// The accounts list has no auto-refresh (the 1s interval only reloads the
	// per-user section), so a mutation must ask for a refetch explicitly or the
	// row keeps showing the pre-click state.
	onChanged: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [deleting,   setDeleting]   = useState(false);
	const [pausing,    setPausing]    = useState(false);
	const [pauseErr,   setPauseErr]   = useState('');
	const paused = !!acc.draining_since;

	async function togglePause() {
		// Spell out the semantics: "pause" reads as "kill", and an operator who
		// thinks this disconnects people will never use it — or will use it and
		// panic. The one thing they need to know is that nobody is cut off.
		const msg = paused
			? `Resume ${acc.email}? It starts taking new sessions again on the next placement tick.`
			: `Pause ${acc.email}?\n\nIt stops taking NEW sessions immediately. Conversations already on it finish normally — nobody is disconnected and no session is moved between subscriptions.\n\nUsers drift off as they go idle; that drift is the transfer.`;
		if (!window.confirm(msg)) return;
		setPausing(true);
		setPauseErr('');
		try {
			await adminSetClaudeAccountDrain(acc.email, !paused, paused ? '' : 'paused from /code');
			onChanged();
		} catch (e) {
			// Surfaced inline, like ResetWindowButtons: an operator who believes
			// an account is paused when it is not will keep leasing it, which is
			// worse than an obvious failure.
			setPauseErr(e instanceof Error ? e.message : String(e));
		} finally {
			setPausing(false);
		}
	}

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

			{/* Operator PAUSE. Amber, not red: the account is not broken and is
			    still serving the people on it — it is winding down on purpose. */}
			{paused && (
				<span
					className="shrink-0 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
					title={
						`PAUSED by an operator${acc.drain_reason ? ` — ${acc.drain_reason}` : ''}\n` +
						`since ${acc.draining_since}\n\n` +
						`Takes no new sessions. Conversations already on it are still being served and ` +
						`finish normally; users move off as they go idle. Unlike a bench this never ` +
						`expires — it clears only when someone resumes it.`
					}
				>
					paused
				</span>
			)}

			{/* 5h bar */}
			<div className="flex items-center gap-1.5 shrink-0">
				<span className="text-[10px] text-slate-400 w-4">5h</span>
				<MiniBar pct={acc.five_hour_pct ?? 0} severity={acc.severity} window="short" />
				<span className={`text-[10px] font-mono w-8 text-right ${severityText(acc.five_hour_pct ?? 0, acc.severity, 'short')}`}>{Math.round(acc.five_hour_pct ?? 0)}%</span>
				<span className={`text-[10px] w-12 ${severityText(acc.five_hour_pct ?? 0, acc.severity, 'short')}`}>↺{fmtTime(acc.five_hour_reset)}</span>
			</div>

			{/* 7d bar */}
			<div className="flex items-center gap-1.5 shrink-0">
				<span className="text-[10px] text-slate-400 w-4">7d</span>
				<MiniBar pct={acc.seven_day_pct ?? 0} severity={acc.severity} window="week" />
				<span className={`text-[10px] font-mono w-8 text-right ${severityText(acc.seven_day_pct ?? 0, acc.severity, 'week')}`}>{Math.round(acc.seven_day_pct ?? 0)}%</span>
				<span className={`text-[10px] w-14 ${severityText(acc.seven_day_pct ?? 0, acc.severity, 'week')}`}>↺{fmtTime(acc.seven_day_reset)}</span>
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
			{/* Pause / Resume. Sits before the destructive delete so the reversible
			    control is the one nearest to hand.
			    NOT isSuper-gated, matching the delete button beside it: the route
			    is RequireAdmin, and an admin who may remove an account outright
			    must not be blocked from the reversible pause. Gating it tighter
			    simply hid it from the operators who run the pool. */}
			{!acc.revoked && (
				<button
					onClick={togglePause}
					disabled={pausing}
					className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition disabled:opacity-50 ${
						paused
							? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
							: 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
					}`}
					title={paused
						? 'Resume: start taking new sessions again'
						: 'Pause: stop taking NEW sessions. In-flight conversations finish normally — nobody is disconnected.'}
				>
					{pausing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : paused ? 'resume' : 'pause'}
				</button>
			)}
			{pauseErr && (
				<span className="shrink-0 max-w-40 truncate text-[10px] text-rose-500" title={pauseErr}>{pauseErr}</span>
			)}

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


// How far into a quota window we are, e.g. "18h in". The window-scoped columns
// are meaningless without it: a "7d" figure whose window opened 18 hours ago
// covers 18 hours, and reads as though it covered a week.
function fmtWindowAge(sec?: number): string {
	if (sec == null || sec <= 0) return '';
	const h = Math.floor(sec / 3600);
	if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h in`;
	if (h >= 1) return `${h}h in`;
	return `${Math.max(1, Math.floor(sec / 60))}m in`;
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
	// CAPS ARE PER-ROLE, so one number cannot describe this table.
	//
	// This line used to print the GLOBAL pair (ClaudePoolLimits, the admin tier)
	// while every bar beneath it was drawn against the viewer's own
	// ClaudePoolLimitsForUser. That was survivable while the two were equal; once
	// the user tier was cut to 24.5M/245M against an admin 70M/900M the header
	// contradicted the rows it labelled, and a cap change looked like it had not
	// deployed. Derive the tiers from the rows instead — cap_5h/cap_7d are
	// already on the wire per user, so this needs no new field and cannot drift
	// from what the bars actually divide by.
	const capTiers = (() => {
		const seen = new Map<string, { c5: number; c7: number; unlimited: boolean }>();
		for (const u of usage.users) {
			if (u.cap_5h == null || u.cap_7d == null) continue;
			seen.set(`${u.cap_5h}/${u.cap_7d}`, {
				c5: u.cap_5h, c7: u.cap_7d, unlimited: u.cap_unlimited === true,
			});
		}
		const tiers = [...seen.values()].filter((t) => !t.unlimited);
		// Fall back to the server's global pair only when no row carries a cap
		// (older server, or a table of nothing but uncapped admins).
		if (tiers.length === 0) {
			return `${fmtTokens(usage.five_hour_tokens)} units / ${shortWin} · ${fmtTokens(usage.seven_day_tokens)} units / 7d`;
		}
		return tiers
			.sort((a, b) => b.c5 - a.c5)
			.map((t) => `${fmtTokens(t.c5)} / ${shortWin} · ${fmtTokens(t.c7)} / 7d`)
			.join('  |  ');
	})();
	const mm = Math.floor(countdown / 60);
	const ss = countdown % 60;
	const cdText = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
	// ON-PREM SAVINGS BANNER.
	//
	// Rendered as a RANGE on purpose. The two ends differ ~5x because deepseek
	// reports its whole prompt as input_tokens, so the upper end charges every
	// token at full input price while a real OpenRouter buyer would get
	// prefix-cache reads at 1/5 (our own local hit rate is ~97%). Showing a
	// single figure here would be a confident number with a 5x error bar.
	const savMax = usage.onprem_savings_cents_7d_max;
	const savMin = usage.onprem_savings_cents_7d_min;
	const orSpend = usage.openrouter_spend_cents_7d;
	const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
	return (
		<div>
			{savMax != null && savMax > 0 && (
				<div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded border border-emerald-100 bg-emerald-50 px-2.5 py-1.5">
					<span className="text-[11px] font-medium text-emerald-700">
						Saved by on-prem (7d): {usd(savMin ?? Math.round(savMax / 5))}–{usd(savMax)}
					</span>
					<span
						className="text-[10px] text-emerald-600/80"
						title={
							'What the GB10-served share WOULD have cost on OpenRouter, at the rate the overflow actually pays ' +
							'($0.04/M in, $0.08/M out — the cheapest endpoint, not the top-level list price). ' +
							'The range is real: deepseek reports its whole prompt as input_tokens, so the high end charges every ' +
							'token at full input price, while a buyer would get prefix-cache reads at 1/5. Our local hit rate is ~97%, ' +
							'so the truth sits nearer the low end. This is avoided spend, never an invoice.'
						}
					>
						range, not an estimate — why?
					</span>
					{orSpend != null && (
						<span className="text-[10px] text-slate-500 ml-auto">
							actually spent on OpenRouter overflow:{' '}
							<span className="tabular-nums font-medium text-violet-600">{usd(orSpend)}</span>
							{savMin != null && orSpend > savMin && (
								<span
									className="ml-1 text-amber-600"
									title="Overflow is costing more than the low estimate of what on-prem is saving. That is a signal to chase spill volume, not to add hardware."
								>
									· exceeds low estimate
								</span>
							)}
						</span>
					)}
				</div>
			)}
			<div className="flex items-center gap-2 mb-1.5">
				<p className="text-xs font-medium text-slate-600">
					Per-user pool usage
				</p>
				<span className="text-[10px] text-slate-400 font-normal">
					caps: {capTiers} (pooled Claude only — deepseek is counted but not limited)
					{' · '}<span title="Quota units are price-weighted: a cache READ counts 0.1x, a 5m cache write 1.25x, a 1h write 2x; sonnet 0.6x, haiku 0.2x, non-Claude 0.1x. A Claude Code turn is mostly cache-read, so units run ~10x below raw tokens. Raw tokens are shown alongside.">units ≠ tokens</span>
					{' · '}users with a <code className="font-mono text-[10px]">claude:proxy</code> PAT appear even at 0 usage
				</span>
				<span className="ml-auto shrink-0 flex items-center gap-2">
					<ResetAllButton isSuper={isSuper} userCount={usage.users.length} shortLabel={shortWin} onDone={onReset} />
					<span className="text-[10px] text-slate-400 tabular-nums">↺ {cdText}</span>
				</span>
			</div>
			<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
				{usage.users.map((u) => {
					// Bars reflect POOLED CLAUDE ONLY — the gate exempts
					// deepseek/on-prem and OpenRouter from the cap, so drawing
					// them against the Claude budget would misread as pressure.
					// Fall back to the full-window figure if the server hasn't
					// emitted the Claude-only pct yet.
					const shortPct = u.claude_five_hour_pct ?? u.five_hour_pct;
					const weekPct = u.claude_seven_day_pct ?? u.seven_day_pct;
					// An admin/super_admin has NO cap: the server sends a math.MaxInt32
					// sentinel so one enforcement path serves every role, and divides by
					// it anyway. The result is a fraction of a sentinel, not of a budget
					// — admin@lum.id read "2%·6%" while actually drawing 1.1 BILLION raw
					// Claude tokens in 7 days, because 128M weighted units / MaxInt32
					// happens to land on 6. A plausible small number is worse than an
					// obvious zero: it reads as a real measurement. The server flags this
					// with cap_unlimited precisely so we don't render it.
					const uncapped = u.cap_unlimited === true;
					// role `user` never touches the Claude pool: aliasClaudeForRole
					// rewrites their sonnet/haiku to the in-house deepseek upstream of
					// any pool routing. So the 4h/7d bars are permanently empty, the
					// reset clocks tick on a window they never draw from, and the reset
					// buttons would act on nothing. Showing that chrome implies a
					// relationship to the pool that does not exist — and buries the one
					// number that IS real for them, their deepseek volume, among four
					// that are not.
					const usesPool = u.role !== 'user';
					const winAge = fmtWindowAge(u.seven_window_age_seconds);
					// Prefer the pool-only trailing figure; fall back through the
					// all-models one to the old window-scoped field on older servers.
					const poolTok = u.trailing_7d_claude_tokens ?? u.trailing_7d_tokens ?? u.raw_total_tokens_7d;
					const sev = (!usesPool || uncapped) ? 'none' : usageSeverity(Math.max(shortPct, weekPct));
					const resetShort = fmtReset(u.five_hour_reset);
					// There was NO 7d clock. seven_day_reset has always been returned
					// and nothing displayed it, so the 7d bar had no reset instant
					// beside it — the one number that says whether a high percentage
					// is about to clear on its own or sit there for days.
					const resetWeek = fmtReset(u.seven_day_reset);
					return (
						<div key={u.email} className="px-2.5 py-1.5 min-w-0">
							<div className="flex items-center gap-3">
								<SeverityDot severity={sev} />
								<span className="flex-1 min-w-0 truncate text-xs font-medium text-slate-800" title={u.email}>
									{u.email}
								</span>
								{!usesPool && (
									<span className="shrink-0 text-[10px] text-slate-400 italic"
										title="Role `user`: sonnet/haiku is served by the in-house deepseek, so this account never draws on the Claude pool. No window, no cap, nothing to reset.">
										not pooled
									</span>
								)}
								{usesPool && <div className="flex items-center gap-1.5 shrink-0" title={uncapped
									? `${u.email} is admin/super_admin — UNCAPPED. The server sends a math.MaxInt32 sentinel as the cap so enforcement needs no per-role branch; a percentage of it would be meaningless, so none is shown. Actual draw: ${(u.claude_five_hour_tokens ?? u.five_hour_tokens).toLocaleString()} quota units (${shortWin}) · ${(u.claude_seven_day_tokens ?? u.seven_day_tokens).toLocaleString()} (7d).`
									: `${(u.claude_five_hour_tokens ?? u.five_hour_tokens).toLocaleString()} pooled-Claude QUOTA UNITS (${shortWin}) · ${(u.claude_seven_day_tokens ?? u.seven_day_tokens).toLocaleString()} (7d) — price-weighted, not raw tokens`}>
									{uncapped ? (
										<span className="text-[10px] font-medium text-slate-400 tabular-nums">uncapped</span>
									) : (
										<>
											<StackedBar shortPct={shortPct} weekPct={weekPct} />
											<span className="text-[10px] font-mono tabular-nums">
												<span className={windowText(shortPct, 'short')}>{fmtPct(shortPct)}</span>
												<span className="text-slate-300">·</span>
												<span className={windowText(weekPct, 'week')}>{fmtPct(weekPct)}</span>
											</span>
											{/* The badge is what a glance sees — a low % right after the 7d
											    anchor rolls reads as "barely used" even for a heavy continuous
											    consumer whose TRUE 7d volume (the detail line below) is still
											    huge. The detail line already carries this via winAge; without
											    it here too, the one number people actually glance at is the
											    misleading one. */}
											{winAge && <span className="text-[9px] text-slate-400 tabular-nums">({winAge})</span>}
										</>
									)}
									{/* Each clock carries the colour of the window it belongs to — the same
									    colour as that window's bar half and its percentage. A window is then
									    one consistent colour across all three of its marks, and that colour
									    means pressure. Which clock is which is carried by order (4h then 7d)
									    and the tooltip, exactly as the bar halves are carried by left and
									    right. */}
									{resetShort && <span className={`text-[10px] tabular-nums ${windowText(shortPct, 'short')}`} title={`4h window resets ${u.five_hour_reset ?? ''}`}>{resetShort}</span>}
									{resetWeek && <span className={`text-[10px] tabular-nums ${windowText(weekPct, 'week')}`} title={`7d window resets ${u.seven_day_reset ?? ''}`}>{resetWeek}</span>}
								</div>}
								{usesPool && <ResetWindowButtons isSuper={isSuper} email={u.email} shortLabel={shortWin} onDone={onReset} />}
								<span className="shrink-0 text-[10px] text-slate-400">{fmtTs(u.last_ts)}</span>
							</div>
							{/* SECOND LINE — usage detail.
							    Everything below used to sit on line 1 alongside the identity,
							    bars and actions. Six of those seven children were shrink-0, so
							    the provider chips were the only flexible one and absorbed all
							    the pressure: as figures were added to the metrics span the chips
							    clipped to nothing and the row overflowed. Splitting the concerns
							    — line 1 identifies and gates, line 2 quantifies — removes the
							    competition for width entirely, and lets the chips WRAP instead
							    of being occluded. Indented to align under the email. */}
							<div className="mt-0.5 pl-5 flex items-baseline gap-x-3 gap-y-1 flex-wrap">
								{/* BOTH units, each named. These differ by ~10x on real Claude
								    Code traffic (a turn is 90-95% cache-read, weighted 0.1x), so
								    showing one bare number labelled "tok" read as a large
								    under-count of actual usage. Raw is Anthropic's own figure;
								    units are what the cap is enforced against. The fallback is
								    labelled "units" too -- it IS the weighted figure, and
								    calling it "tok" is exactly the bug. */}
								<span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap"
									title={u.trailing_7d_tokens != null
										? `TRUE rolling windows (anchor-independent):\n`
											+ `  4h pool: ${(u.trailing_4h_claude_tokens ?? u.trailing_4h_tokens ?? 0).toLocaleString()} tok\n`
											+ `  7d pool: ${(u.trailing_7d_claude_tokens ?? u.trailing_7d_tokens).toLocaleString()} tok\n`
											+ `  7d all models (incl. exempt on-prem): ${u.trailing_7d_tokens.toLocaleString()} tok\n\n`
											+ `QUOTA WINDOW (what the cap is enforced against)${winAge ? ` — ${winAge}` : ''}:\n`
											+ `  ${u.seven_day_tokens.toLocaleString()} weighted units\n`
											+ `  raw within window: ${(u.raw_total_tokens_7d ?? 0).toLocaleString()} tok\n\n`
											+ `The window opens on first use and rolls only once fully elapsed, so it `
											+ `can cover far less than 7 days — and an expired window reads 0.`
										: u.raw_total_tokens_7d != null
										? `raw 7d: ${u.raw_total_tokens_7d.toLocaleString()} tokens `
											+ `(in ${(u.raw_input_tokens_7d ?? 0).toLocaleString()} · `
											+ `out ${(u.raw_output_tokens_7d ?? 0).toLocaleString()} · `
											+ `cache-read ${(u.raw_cache_read_tokens_7d ?? 0).toLocaleString()} · `
											+ `cache-write ${(u.raw_cache_creation_tokens_7d ?? 0).toLocaleString()})`
										: 'raw token breakdown unavailable from this server build'}>
									{/* Lead with the TRUE rolling 7d — that is what "usage" means to a
									    reader. The window-scoped unit figure follows, tagged with how far
									    into its window it is, because those two numbers can differ by
									    several times over and the difference is invisible otherwise. */}
									{/* POOL usage: claude-* only. deepseek runs on our own GB10 and the
									    cap exempts it, so folding it in overstated what the shared pool
									    bore — 26% of one user's headline on 2026-08-24. Non-pool volume
									    is still visible, in the provider chips to the left. */}
									{poolTok != null
										? <>{fmtTokens(poolTok)} tok<span className="text-slate-400">/7d</span></>
										: null}
									<span className="text-slate-300"> · </span>
									{/* Claude-only weighted, so this figure and the BAR beside it are the
									    same population. They were not: the printed number was all-models
									    while the bar was claude-only, and for suzhengy that read 102.5M
									    next to a bar drawn from 19.8M — a 5.2x disagreement between two
									    numbers touching each other on the same row. */}
									{fmtTokens(u.claude_seven_day_tokens ?? u.seven_day_tokens)} units
									{winAge && <span className="text-slate-400"> ({winAge})</span>}
									<span className="text-slate-300"> · </span>{u.trailing_7d_requests ?? u.requests_7d} req
								</span>
								{/* Color-coded provider subtotals fill the middle gap — Claude
								    slate, onprem emerald, OpenRouter violet (mirror modelRoute).
								    Aggregates the per-model breakdown, so the model chips are
								    folded away and each user stays on ONE line. */}
								<span className="flex items-center gap-1 flex-wrap">
									{u.providers && (["claude", "openrouter", "onprem"] as const).map((p) => {
										const v = u.providers![p];
										if (!v || v.tokens_7d <= 0) return null;
										const cls =
											p === 'claude' ? 'bg-slate-100 text-slate-500' :
											p === 'onprem' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
											'bg-violet-50 text-violet-600 border border-violet-100';
										const lbl =
											p === 'claude' ? 'Claude' :
											p === 'onprem' ? 'onprem' : 'OpenRouter';
										return (
											<span key={p} className={`px-1.5 py-px rounded text-[9px] tabular-nums whitespace-nowrap ${cls}`}
												title={`${v.tokens_7d.toLocaleString()} raw tokens (input+output+cache — the SAME basis for every provider, so Claude and deepseek are comparable)`
													+ (v.weighted_tokens_7d != null ? ` · ${v.weighted_tokens_7d.toLocaleString()} quota units` : '')}>
												{lbl}
												<span className="text-slate-400"> · {fmtTokens(v.tokens_7d)}</span>
											</span>
										);
									})}
								</span>
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

// OpenRouterBalancePanel — the metered pay-per-use side of the pool. Shows how
// much credit is left on the OpenRouter account backing the non-Claude models
// (kimi-*, z-ai/*, deepseek/deepseek-* fallthrough). Reads GET /api/v1/credits
// (total_credits - total_usage) via the admin endpoint; the key never leaves
// the server. available:false (missing key / unreachable) blanks the panel
// instead of erroring the page.
function OpenRouterBalancePanel() {
	const [data, setData] = useState<OpenRouterBalanceResp | null>(null);

	useEffect(() => {
		let alive = true;
		fetchOpenRouterBalance()
			.then((d) => { if (alive) setData(d); })
			.catch(() => { /* degrade silently — panel just stays blank */ });
		return () => { alive = false; };
	}, []);

	if (!data) return null;

	return (
		<div className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2">
			<div className="flex items-center gap-2">
				<span className="text-xs font-medium text-slate-700">OpenRouter balance</span>
				<span className="ml-auto shrink-0 font-mono text-xs text-violet-800">
					{data.available ? (
						<>${data.balance_usd.toFixed(2)} <span className="text-slate-400 font-normal">credit</span>{data.usage_usd > 0 ? <> · ${data.usage_usd.toFixed(2)} <span className="text-slate-400 font-normal">used</span></> : ''}</>
					) : (
						<span className="text-slate-400 text-[11px] font-normal">not configured</span>
					)}
				</span>
			</div>
			{data.available && data.total_credits > 0 && (
				<>
					<div className="mt-1.5 h-1 rounded-full bg-violet-100 overflow-hidden">
						<div
							className="h-full rounded-full bg-violet-500"
							style={{ width: `${Math.max(2, Math.min(100, (data.balance_usd / data.total_credits) * 100))}%` }}
						/>
					</div>
					<p className="mt-1 text-[10px] text-slate-400">
						{fmtPct((data.balance_usd / data.total_credits) * 100)} of ${data.total_credits.toFixed(2)} credit remaining
					</p>
				</>
			)}
			{data.error && (
				<p className="mt-1 text-[10px] text-slate-400">{data.error}</p>
			)}
		</div>
	);
}

function SummaryBar({ accounts }: { accounts: ClaudeQuotaAccount[] }) {
	const critical = accounts.filter((a) => a.severity === 'critical').length;
	const warning  = accounts.filter((a) => a.severity === 'warning').length;
	const healthy  = accounts.length - critical - warning;
	return (
		<div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
			<div className="text-xs font-medium text-slate-700">Pooled accounts</div>
			<div className="flex items-center gap-4 text-xs text-slate-500 mt-0.5">
				{critical > 0 && <span className="text-rose-600 font-medium">{critical} critical</span>}
				{warning  > 0 && <span className="text-amber-600 font-medium">{warning} warning</span>}
				<span className="text-emerald-600">{healthy} healthy</span>
				<span className="text-slate-300">/ {accounts.length} total</span>
			</div>
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
		<div className="space-y-3 max-w-5xl mx-auto">
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
						Token Dashboard
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
				<>
					{/* OpenRouter credit — still useful with no pooled accounts. */}
					<OpenRouterBalancePanel />
					<div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
						<CheckCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
						<p className="text-sm text-slate-500">
							No accounts have connected a Claude token yet.
						</p>
						<p className="text-xs text-slate-400 mt-1">
							Click "Add account" above and paste each user's Claude Code OAuth token.
						</p>
					</div>
				</>
			) : (
				<>
					{/* Top row: OpenRouter credit + pooled-account health side by side.
					    Both are one-glance status figures; pairing them reclaims the
					    vertical space two stacked cards would eat. */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<OpenRouterBalancePanel />
						<SummaryBar accounts={accounts} />
					</div>
					<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
						{accounts.map((a) => (
							<AccountRow
								key={a.email}
								acc={a}
								onDelete={(email) => setAccounts((prev) => prev?.filter((x) => x.email !== email) ?? [])}
								onReAdd={(email) => { setReAddEmail(email); setShowAdd(true); }}
								// AdminClaudeQuota fans out live Anthropic probes and can take
								// seconds, so patch the row optimistically first — otherwise the
								// pill appears to lag the click — then refetch for the truth.
								onChanged={() => {
									setAccounts((prev) => prev?.map((x) => x.email === a.email
										? { ...x, draining_since: x.draining_since ? undefined : new Date().toISOString() }
										: x) ?? []);
									load(true);
								}}
							/>
						))}
					</div>
				</>
			)}

			{/* Per-field-box traffic + relay health. Self-contained (own fetch)
			    so a field-box outage can't blank the quota page above it. */}
			<FieldBoxPanel />

			{userUsage && <UserUsageSection usage={userUsage} countdown={countdown} onReset={loadUserUsage} isSuper={isSuper} />}

			<p className="text-[11px] text-slate-400">
				Setup + full guide: <a href="/docs/claude" className="text-gold-700 hover:underline">/docs/claude</a>.
				Recorded sessions: <a href="/claude-sessions" className="text-gold-700 hover:underline">/claude-sessions</a>.
				Mint a <code className="font-mono bg-slate-100 px-1 rounded">claude:proxy</code> PAT at <a href="/dashboard/tokens" className="text-gold-700 hover:underline">/dashboard/tokens</a>.
			</p>
		</div>
	);
}
