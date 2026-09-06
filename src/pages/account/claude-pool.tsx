// Delegated Claude-pool management — the DELEGATE's own page.
//
// Renders only for someone super_admin has named a manager of a pool. There is
// no role behind it: the server answers /me/claude-pool/manage with an empty
// roster for everyone else, so this page decides visibility from the DATA. That
// ordering matters — a role check here would have to guess at a capability the
// server stores per (pool, user), and would drift the moment either changed.
//
// Hiding is presentation ONLY. Every action below is independently enforced
// server-side against the caller's managed pools; a delegate who forges a
// request for another pool's account gets a 404, not a hidden button.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, PauseCircle, PlayCircle, RotateCcw, ShieldCheck } from 'lucide-react';
import {
	fetchClaudePoolManage,
	manageDrainAccount,
	manageResetWindow,
	type ClaudePoolManageRoster,
} from '../../api/claude-pool-manage';

function errText(e: any): string {
	return String(e?.response?.data?.message || e?.message || e);
}

export default function ClaudePoolManage() {
	const [roster, setRoster] = useState<ClaudePoolManageRoster | null>(null);
	const [loadErr, setLoadErr] = useState('');
	const [busy, setBusy] = useState<string | null>(null);
	const [msg, setMsg] = useState<Record<string, string>>({});

	const load = useCallback(async () => {
		try {
			setRoster(await fetchClaudePoolManage());
			setLoadErr('');
		} catch (e: any) {
			setLoadErr(errText(e));
		}
	}, []);

	useEffect(() => { void load(); }, [load]);

	const drain = async (email: string, next: boolean) => {
		if (next && !window.confirm(
			`Pause ${email}?\n\n` +
			'It stops taking NEW sessions. Conversations already on it keep running, so this is a ' +
			'graceful drain rather than a cut-off.',
		)) return;
		setBusy(email);
		setMsg((m) => ({ ...m, [email]: '' }));
		try {
			await manageDrainAccount(email, next);
			await load();
		} catch (e: any) {
			setMsg((m) => ({ ...m, [email]: errText(e) }));
		} finally {
			setBusy(null);
		}
	};

	const reset = async (userSub: string, email: string) => {
		if (!window.confirm(
			`Reset the usage clock for ${email}?\n\n` +
			'Their rolling quota windows start again from now. This hands out budget — it does not ' +
			'change how much the underlying Anthropic subscription has left.',
		)) return;
		setBusy(userSub);
		setMsg((m) => ({ ...m, [userSub]: '' }));
		try {
			const r = await manageResetWindow(userSub);
			setMsg((m) => ({ ...m, [userSub]: `reset (${r.window})` }));
		} catch (e: any) {
			setMsg((m) => ({ ...m, [userSub]: errText(e) }));
		} finally {
			setBusy(null);
		}
	};

	if (loadErr) {
		return <p className="text-sm text-rose-600">Could not load pool management: {loadErr}</p>;
	}
	if (!roster) {
		return (
			<p className="flex items-center gap-2 text-sm text-slate-400">
				<Loader2 className="w-4 h-4 animate-spin" /> Loading…
			</p>
		);
	}
	// The empty roster IS the non-manager answer — not an error, and not a
	// state worth explaining at length to someone who will never see it change.
	if (roster.pools.length === 0) {
		return (
			<p className="text-sm text-slate-500">
				You don't manage a Claude pool. If you should, ask a super-admin to grant it.
			</p>
		);
	}

	return (
		<div className="space-y-6">
			<header>
				<h1 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
					<ShieldCheck className="w-4 h-4 text-indigo-600" /> Claude pool management
				</h1>
				<p className="mt-1 text-xs text-slate-500">
					You manage {roster.pools.map((p) => p.name).join(', ')}. These controls reach this
					pool's accounts and members only.
				</p>
			</header>

			<section>
				<h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Accounts</h2>
				<div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
					{roster.accounts.length === 0 ? (
						<p className="p-3 text-xs text-slate-400">This pool has no accounts.</p>
					) : roster.accounts.map((a) => {
						const paused = !!a.draining_since;
						return (
							<div key={a.email} className="flex items-center gap-3 px-3 py-2">
								<span className="w-48 shrink-0 truncate text-xs font-medium text-slate-800">{a.email}</span>
								{a.label && <span className="shrink-0 text-[10px] text-slate-400">{a.label}</span>}
								{a.revoked && (
									<span className="shrink-0 rounded-full bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10px] text-rose-700"
										title="Token family revoked — only an operator re-add restores it">
										quarantined
									</span>
								)}
								{paused && (
									<span className="shrink-0 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700"
										title={a.drain_reason || 'Paused — takes no new sessions'}>
										paused
									</span>
								)}
								<button
									onClick={() => void drain(a.email, !paused)}
									disabled={busy === a.email}
									className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
								>
									{busy === a.email
										? <Loader2 className="w-3 h-3 animate-spin" />
										: paused ? <PlayCircle className="w-3 h-3" /> : <PauseCircle className="w-3 h-3" />}
									{paused ? 'resume' : 'pause'}
								</button>
								{msg[a.email] && (
									<span className="shrink-0 max-w-64 truncate text-[10px] text-amber-600" title={msg[a.email]}>
										{msg[a.email]}
									</span>
								)}
							</div>
						);
					})}
				</div>
			</section>

			<section>
				<h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Members</h2>
				<div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
					{roster.members.length === 0 ? (
						<p className="p-3 text-xs text-slate-400">This pool has no members.</p>
					) : roster.members.map((m) => (
						<div key={m.user_sub + m.pool_id} className="flex items-center gap-3 px-3 py-2">
							<span className="w-64 shrink-0 truncate text-xs text-slate-800">{m.email}</span>
							<button
								onClick={() => void reset(m.user_sub, m.email)}
								disabled={busy === m.user_sub}
								className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-50"
							>
								{busy === m.user_sub
									? <Loader2 className="w-3 h-3 animate-spin" />
									: <RotateCcw className="w-3 h-3" />}
								reset usage clock
							</button>
							{msg[m.user_sub] && (
								<span className="shrink-0 max-w-64 truncate text-[10px] text-slate-500" title={msg[m.user_sub]}>
									{msg[m.user_sub]}
								</span>
							)}
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
