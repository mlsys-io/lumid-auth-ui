import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { AlertTriangle, Check, Copy, KeyRound, Mail, Plus, Shield, Trash2, Clock, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
	listPATs,
	mintPAT,
	revokePAT,
	getPATAccessLog,
	getGrantableScopes,
	canGrantPreset,
	levelSatisfies,
	SCOPE_PRESETS,
	SCOPE_SERVICES,
	type PATInfo,
	type Scope,
	type ScopeLevel,
	type ScopeService,
	type GrantableScopes,
	type PATAccessLogEntry,
	type MintPATResponse,
} from '../../api/identity';
import { isSessionExpired } from '../../api/client';

/**
 * /account/tokens — mint, list, revoke, audit Personal Access Tokens.
 *
 * Named "Personal Access Tokens" (not just "API Keys") to signal that
 * the same credential is meant to work across every Lumid subsystem
 * once federated identity ships. The row labels + column hints
 * foreground the Runmesh-identity framing without screaming it at
 * the user.
 */
export default function TokensPage() {
	const [tokens, setTokens] = useState<PATInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [mintOpen, setMintOpen] = useState(false);
	const [minted, setMinted] = useState<MintPATResponse | null>(null);
	const [confirmRevoke, setConfirmRevoke] = useState<PATInfo | null>(null);
	const [auditFor, setAuditFor] = useState<PATInfo | null>(null);

	const refresh = () => {
		setLoading(true);
		listPATs()
			.then(setTokens)
			.catch((e) => toast.error(`Load tokens: ${String(e)}`))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		refresh();
	}, []);

	return (
		<div className="max-w-5xl mx-auto p-6 space-y-4">
			<div className="flex items-start justify-between">
				<div>
					<h1 className="text-2xl font-bold flex items-center gap-2">
						<KeyRound className="w-5 h-5 text-indigo-500" />
						Personal Access Tokens
					</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Your LumidOS credential. Works here in LQA, in Claude Code via MCP, and in any
						LumidOS app — AI quant research and beyond. Scope each token to exactly what it needs.
					</p>
				</div>
				<Button onClick={() => setMintOpen(true)} className="gap-2">
					<Plus className="w-4 h-4" /> New token
				</Button>
			</div>

			{loading ? (
				<div className="text-sm text-gray-500 py-6">Loading…</div>
			) : tokens.length === 0 ? (
				<div className="border border-dashed border-gray-200 rounded-xl p-8 text-center">
					<KeyRound className="w-8 h-8 text-gray-300 mx-auto mb-2" />
					<p className="text-sm text-gray-500">No tokens yet.</p>
					<Button onClick={() => setMintOpen(true)} className="mt-3 gap-2">
						<Plus className="w-4 h-4" /> Mint your first token
					</Button>
				</div>
			) : (
				<div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
					{tokens.map((t, i) => (
						<TokenRow
							key={t.id}
							token={t}
							isLast={i === tokens.length - 1}
							onRevoke={() => setConfirmRevoke(t)}
							onAudit={() => setAuditFor(t)}
						/>
					))}
				</div>
			)}

			{/* OAuth scope grants — live state from /api/v1/identity/google-grants. */}
			<div className="mt-8">
				<div className="flex items-start justify-between mb-3">
					<div>
						<h2 className="text-lg font-semibold flex items-center gap-2">
							<Mail className="w-4 h-4 text-indigo-500" />
							OAuth grants
						</h2>
						<p className="text-xs text-muted-foreground mt-0.5">
							Upstream service tokens scoped to lumid-owned OAuth clients.
							Stored encrypted server-side; the local CLI mints short-lived
							access tokens on demand.
						</p>
					</div>
				</div>
				<GoogleGrantCard onChange={refresh} />
			</div>

			<MintDialog
				open={mintOpen}
				onOpenChange={(v) => {
					setMintOpen(v);
					if (!v) setMinted(null);
				}}
				minted={minted}
				onMinted={(r) => {
					setMinted(r);
					refresh();
				}}
			/>

			<RevokeDialog
				token={confirmRevoke}
				onClose={() => setConfirmRevoke(null)}
				onRevoked={refresh}
			/>

			<AuditDialog token={auditFor} onClose={() => setAuditFor(null)} />
		</div>
	);
}

function TokenRow({
	token,
	isLast,
	onRevoke,
	onAudit,
}: {
	token: PATInfo;
	isLast: boolean;
	onRevoke: () => void;
	onAudit: () => void;
}) {
	const statusColor =
		token.status === 'active'
			? 'bg-emerald-50 text-emerald-700 border-emerald-200'
			: token.status === 'revoked'
				? 'bg-gray-50 text-gray-500 border-gray-200'
				: 'bg-amber-50 text-amber-700 border-amber-200';
	return (
		<div
			className={`px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${
				isLast ? '' : 'border-b border-gray-100'
			}`}
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 flex-wrap">
					<span className="font-medium truncate">{token.name}</span>
					<span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${statusColor}`}>
						{token.status}
					</span>
				</div>
				<div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
					<code className="font-mono">{token.token_prefix}…</code>
					<span className="flex items-center gap-1">
						<Shield className="w-3 h-3" />
						{token.scopes.join(', ')}
					</span>
					{token.last_used_at > 0 && (
						<span className="flex items-center gap-1">
							<Clock className="w-3 h-3" /> last used {formatRelative(token.last_used_at)}
						</span>
					)}
				</div>
			</div>
			<div className="flex items-center gap-2 shrink-0 ml-auto">
				<Button variant="outline" size="sm" onClick={onAudit} disabled={token.status === 'revoked'}>
					Audit
				</Button>
				{token.status === 'active' && (
					<Button
						variant="outline"
						size="sm"
						onClick={onRevoke}
						className="text-rose-600 border-rose-200 hover:bg-rose-50"
					>
						<Trash2 className="w-3.5 h-3.5 mr-1" /> Revoke
					</Button>
				)}
			</div>
		</div>
	);
}

// ---- Mint dialog ----
//
// Scope picker is matrix-aware: we fetch the caller's grantable-scopes
// row on open and use it to (a) disable presets the caller can't mint
// and (b) grey out level radios above their current access in Custom
// mode. Backend gates the same thing, so the UI is informational — but
// the point is to never let the user pick something that will 403.

const LEVELS: ScopeLevel[] = ['none', 'read', 'write', 'admin'];

function MintDialog({
	open,
	onOpenChange,
	minted,
	onMinted,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	minted: MintPATResponse | null;
	onMinted: (r: MintPATResponse) => void;
}) {
	const [name, setName] = useState('');
	const [mode, setMode] = useState<'preset' | 'custom'>('preset');
	const [preset, setPreset] = useState<string>('readonly');
	const [ttlDays, setTtlDays] = useState<string>('0');
	const [submitting, setSubmitting] = useState(false);
	const [copied, setCopied] = useState(false);
	const [grantable, setGrantable] = useState<GrantableScopes | null>(null);

	// Per-service level selection for custom mode. `none` means "don't
	// include this service" so the final scope list is the (service, lvl)
	// rows with lvl != 'none'. Initialised to 'none' everywhere.
	const [custom, setCustom] = useState<Record<ScopeService, ScopeLevel>>(() =>
		Object.fromEntries(SCOPE_SERVICES.map((s) => [s, 'none'])) as Record<
			ScopeService,
			ScopeLevel
		>,
	);
	const [customWildcard, setCustomWildcard] = useState(false);

	useEffect(() => {
		if (!open) return;
		setName('');
		setMode('preset');
		setPreset('readonly');
		setTtlDays('0');
		setCopied(false);
		setCustom(
			Object.fromEntries(SCOPE_SERVICES.map((s) => [s, 'none'])) as Record<
				ScopeService,
				ScopeLevel
			>,
		);
		setCustomWildcard(false);
		setGrantable(null);
		getGrantableScopes()
			.then(setGrantable)
			.catch((e: unknown) => {
				if (isSessionExpired(e)) return;
				toast.error(`Load scopes: ${(e as Error)?.message ?? e}`);
			});
	}, [open]);

	const activePresets = useMemo(() => {
		if (!grantable) return SCOPE_PRESETS;
		return SCOPE_PRESETS.map((p) => ({
			...p,
			grantable: canGrantPreset(p, grantable),
		}));
	}, [grantable]);

	// Auto-pick the first preset the user can actually grant once
	// grantable loads (so admins land on 'readonly' same as before,
	// but users default to something that won't 403 on submit).
	useEffect(() => {
		if (!grantable) return;
		const current = activePresets.find((p) => p.id === preset);
		if (current && !('grantable' in current && current.grantable === false)) {
			return;
		}
		const first = activePresets.find(
			(p) => 'grantable' in p && p.grantable,
		);
		if (first) setPreset(first.id);
	}, [grantable, activePresets, preset]);

	const scopes = useMemo<Scope[]>(() => {
		if (mode === 'preset') {
			return SCOPE_PRESETS.find((p) => p.id === preset)?.scopes ?? [];
		}
		const out: Scope[] = [];
		if (customWildcard) out.push('*');
		for (const svc of SCOPE_SERVICES) {
			const lvl = custom[svc];
			if (lvl !== 'none') out.push(`${svc}:${lvl}`);
		}
		return out;
	}, [mode, preset, custom, customWildcard]);

	const canMint =
		name.trim().length > 0 &&
		scopes.length > 0 &&
		(grantable
			? mode === 'preset'
				? !!activePresets.find((p) => p.id === preset && 'grantable' in p && p.grantable)
				: true
			: true);

	const submit = async () => {
		if (!canMint) {
			toast.error(scopes.length === 0 ? 'Pick at least one scope' : 'Name is required');
			return;
		}
		setSubmitting(true);
		try {
			const r = await mintPAT({
				name: name.trim(),
				scopes,
				ttl_days: Number(ttlDays) || 0,
			});
			onMinted(r);
		} catch (e: any) {
			toast.error(String(e?.message ?? e));
		} finally {
			setSubmitting(false);
		}
	};

	const copy = () => {
		if (!minted) return;
		navigator.clipboard.writeText(minted.token);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{minted ? 'Save your new token' : 'New Personal Access Token'}
					</DialogTitle>
					<DialogDescription>
						{minted
							? 'This is the only time the token will be shown. Copy it now.'
							: 'Name it after where it will run (e.g. "my laptop", "trading bot").'}
					</DialogDescription>
				</DialogHeader>

				{minted ? (
					<MintResult minted={minted} copied={copied} onCopy={copy} onClose={() => onOpenChange(false)} />
				) : (
					<div className="space-y-4">
						<div>
							<Label>Name</Label>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="my laptop"
							/>
						</div>

						{/* Scope mode switcher */}
						<div>
							<Label>Scope</Label>
							<div className="mt-1 flex items-center gap-3 text-sm">
								<label className="inline-flex items-center gap-1.5 cursor-pointer">
									<input
										type="radio"
										checked={mode === 'preset'}
										onChange={() => setMode('preset')}
									/>
									<span>Preset</span>
								</label>
								<label className="inline-flex items-center gap-1.5 cursor-pointer">
									<input
										type="radio"
										checked={mode === 'custom'}
										onChange={() => setMode('custom')}
									/>
									<span>Custom (per service)</span>
								</label>
							</div>
						</div>

						{mode === 'preset' ? (
							<div>
								<Select value={preset} onValueChange={setPreset}>
									<SelectTrigger className="bg-white">
										<SelectValue>
											{SCOPE_PRESETS.find((p) => p.id === preset)?.label ??
												'Select a scope'}
										</SelectValue>
									</SelectTrigger>
									<SelectContent className="z-[200] bg-white border border-slate-200 shadow-xl">
										{activePresets.map((p) => {
											const disabled = 'grantable' in p && p.grantable === false;
											return (
												<SelectItem
													key={p.id}
													value={p.id}
													disabled={disabled}
													textValue={p.label}
												>
													<div className="flex flex-col">
														<span className="font-medium">
															{p.label}
															{disabled && (
																<span className="ml-2 text-xs text-slate-400">
																	(requires higher access)
																</span>
															)}
														</span>
														<span className="text-xs text-muted-foreground">
															{p.description}
														</span>
													</div>
												</SelectItem>
											);
										})}
									</SelectContent>
								</Select>
								<p className="mt-2 text-xs text-slate-500">
									Grants{' '}
									<span className="font-mono text-slate-700">
										{scopes.length === 0 ? '—' : scopes.join(' · ')}
									</span>
								</p>
							</div>
						) : (
							<CustomScopePicker
								grantable={grantable}
								custom={custom}
								setCustom={setCustom}
								wildcard={customWildcard}
								setWildcard={setCustomWildcard}
								resultingScopes={scopes}
							/>
						)}

						<div>
							<Label>Expiration</Label>
							<Select value={ttlDays} onValueChange={setTtlDays}>
								<SelectTrigger className="bg-white">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="z-[200] bg-white border border-slate-200 shadow-xl">
									<SelectItem value="0">Never expires</SelectItem>
									<SelectItem value="7">7 days</SelectItem>
									<SelectItem value="30">30 days</SelectItem>
									<SelectItem value="90">90 days</SelectItem>
									<SelectItem value="365">1 year</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<DialogFooter>
							<Button variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button onClick={submit} disabled={submitting || !canMint}>
								{submitting ? 'Minting…' : 'Mint token'}
							</Button>
						</DialogFooter>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ---- Custom scope picker ----

function CustomScopePicker({
	grantable,
	custom,
	setCustom,
	wildcard,
	setWildcard,
	resultingScopes,
}: {
	grantable: GrantableScopes | null;
	custom: Record<ScopeService, ScopeLevel>;
	setCustom: (
		v:
			| Record<ScopeService, ScopeLevel>
			| ((old: Record<ScopeService, ScopeLevel>) => Record<ScopeService, ScopeLevel>),
	) => void;
	wildcard: boolean;
	setWildcard: (v: boolean) => void;
	resultingScopes: Scope[];
}) {
	return (
		<div className="space-y-3">
			<div className="rounded-lg border border-slate-200 overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
						<tr>
							<th className="text-left py-2 px-3">Service</th>
							{LEVELS.map((l) => (
								<th key={l} className="text-center py-2 px-3 font-medium">
									{l}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{SCOPE_SERVICES.map((svc) => {
							const have = grantable?.matrix[svc] ?? 'none';
							return (
								<tr key={svc} className="border-t border-slate-100">
									<td className="py-2 px-3">
										<div className="font-medium">{svc}</div>
										<div className="text-[11px] text-slate-400">
											you have: <span className="font-mono">{have}</span>
										</div>
									</td>
									{LEVELS.map((l) => {
										const disabled =
											l !== 'none' && grantable !== null && !levelSatisfies(have, l);
										const checked = custom[svc] === l;
										return (
											<td key={l} className="text-center py-2 px-3">
												<input
													type="radio"
													name={`scope-${svc}`}
													disabled={disabled}
													checked={checked}
													onChange={() =>
														setCustom((old) => ({ ...old, [svc]: l }))
													}
												/>
											</td>
										);
									})}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			{/* Global wildcard — admin only */}
			<label
				className={`inline-flex items-center gap-2 text-sm ${
					grantable?.can_wildcard ? 'cursor-pointer' : 'opacity-50'
				}`}
			>
				<input
					type="checkbox"
					disabled={!grantable?.can_wildcard}
					checked={wildcard}
					onChange={(e) => setWildcard(e.target.checked)}
				/>
				<span>
					Global admin (<span className="font-mono">*</span>) — overrides per-service
				</span>
				{!grantable?.can_wildcard && (
					<span className="text-xs text-slate-400">admin role only</span>
				)}
			</label>

			<p className="text-xs text-slate-500">
				Grants{' '}
				<span className="font-mono text-slate-700">
					{resultingScopes.length === 0 ? '—' : resultingScopes.join(' · ')}
				</span>
			</p>
		</div>
	);
}

function MintResult({
	minted,
	copied,
	onCopy,
	onClose,
}: {
	minted: MintPATResponse;
	copied: boolean;
	onCopy: () => void;
	onClose: () => void;
}) {
	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm flex items-start gap-2">
				<AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
				<div className="text-amber-900">
					Store this somewhere safe. If you lose it, revoke and mint a new one — we can't show it again.
				</div>
			</div>

			<div>
				<Label>Your token</Label>
				<div className="flex gap-2 mt-1">
					<Input readOnly value={minted.token} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
					<Button variant="outline" onClick={onCopy} className="shrink-0">
						{copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
					</Button>
				</div>
			</div>

			<div>
				<Label>One-liner install</Label>
				<div className="mt-1 space-y-2">
					<div>
						<div className="text-[11px] uppercase tracking-wide text-gray-500 mb-0.5">Linux / macOS</div>
						<pre className="bg-gray-50 border border-gray-200 rounded-md p-2 text-xs font-mono whitespace-pre-wrap break-all">
							curl -sSL https://lum.id/start | bash -s -- {minted.token}
						</pre>
					</div>
					<div>
						<div className="text-[11px] uppercase tracking-wide text-gray-500 mb-0.5">Windows (PowerShell)</div>
						<pre className="bg-gray-50 border border-gray-200 rounded-md p-2 text-xs font-mono whitespace-pre-wrap break-all">
							{`$env:LUMID_PAT='${minted.token}'; iwr https://lum.id/install.ps1 -useb | iex`}
						</pre>
					</div>
				</div>
				<p className="mt-2 text-xs text-gray-500">
					Runs on your own machine. See{' '}
					<a href="/dashboard/connect" className="text-indigo-500 hover:underline">
						Connect
					</a>{' '}
					for the full walkthrough.
				</p>
			</div>

			<DialogFooter>
				<Button onClick={onClose}>I've saved it</Button>
			</DialogFooter>
		</div>
	);
}

function RevokeDialog({
	token,
	onClose,
	onRevoked,
}: {
	token: PATInfo | null;
	onClose: () => void;
	onRevoked: () => void;
}) {
	const [submitting, setSubmitting] = useState(false);
	if (!token) return null;
	const submit = async () => {
		setSubmitting(true);
		try {
			await revokePAT(token.id);
			toast.success('Token revoked');
			onRevoked();
			onClose();
		} catch (e: any) {
			toast.error(String(e?.message ?? e));
		} finally {
			setSubmitting(false);
		}
	};
	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Revoke token?</DialogTitle>
					<DialogDescription>
						<code>{token.name}</code> ({token.token_prefix}…) will stop working immediately.
						Machines using it will need a new token.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={submit} disabled={submitting}>
						{submitting ? 'Revoking…' : 'Revoke'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AuditDialog({ token, onClose }: { token: PATInfo | null; onClose: () => void }) {
	const [entries, setEntries] = useState<PATAccessLogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	useEffect(() => {
		if (!token) return;
		setLoading(true);
		getPATAccessLog(token.id)
			.then(setEntries)
			.catch((e) => {
				// Session expiry is handled centrally by AuthProvider's
				// lumid:session-expired listener — don't double-surface.
				if (isSessionExpired(e)) return;
				toast.error((e as Error)?.message || "Failed to load audit log");
			})
			.finally(() => setLoading(false));
	}, [token]);
	if (!token) return null;
	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle>Audit: {token.name}</DialogTitle>
					<DialogDescription>
						Last 100 authenticated requests made with <code>{token.token_prefix}…</code>.
						One row per call — includes path, status, latency, source IP.
					</DialogDescription>
				</DialogHeader>
				<div className="flex-1 overflow-y-auto border border-gray-100 rounded-md">
					{loading ? (
						<div className="p-6 text-sm text-gray-500">Loading…</div>
					) : entries.length === 0 ? (
						<div className="p-6 text-sm text-gray-400 italic">No requests yet.</div>
					) : (
						<table className="w-full text-xs">
							<thead className="bg-gray-50 text-gray-500">
								<tr>
									<th className="text-left px-3 py-2 font-medium">When</th>
									<th className="text-left px-3 py-2 font-medium">Source</th>
									<th className="text-left px-3 py-2 font-medium">Request</th>
									<th className="text-left px-3 py-2 font-medium">Status</th>
									<th className="text-left px-3 py-2 font-medium">Latency</th>
									<th className="text-left px-3 py-2 font-medium">IP</th>
								</tr>
							</thead>
							<tbody>
								{entries.map((e, i) => (
									<tr key={i} className="border-t border-gray-50 hover:bg-gray-50/60">
										<td className="px-3 py-1.5 tabular-nums text-gray-600 whitespace-nowrap">
											{new Date(e.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19)}
										</td>
										<td className="px-3 py-1.5">
											<code className="text-[10px] bg-gray-100 rounded px-1.5 py-0.5">{e.source}</code>
										</td>
										<td className="px-3 py-1.5 font-mono truncate max-w-md" title={`${e.method} ${e.path}`}>
											<span className="text-gray-400">{e.method}</span> {e.path}
										</td>
										<td className="px-3 py-1.5 tabular-nums">
											<span className={e.status >= 400 ? 'text-rose-600' : 'text-emerald-600'}>{e.status}</span>
										</td>
										<td className="px-3 py-1.5 tabular-nums text-gray-500">{e.duration_ms}ms</td>
										<td className="px-3 py-1.5 text-gray-500 truncate max-w-[120px]" title={e.ip}>
											{e.ip}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						<X className="w-4 h-4 mr-1" /> Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function formatRelative(ts: number): string {
	const diff = Date.now() / 1000 - ts;
	if (diff < 60) return 'just now';
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

// ── GoogleGrantCard ───────────────────────────────────────────────
// Renders /api/v1/identity/google-grants live state — the page tile
// for "is Gmail + Calendar connected on this account?". Shows scopes
// + granted_at + last_used_at when connected, plus a Disconnect button
// that calls DELETE /api/v1/identity/google-token.

interface GoogleGrant {
	state: 'connected' | 'revoked';
	scopes: string[];
	client_id?: string;
	granted_at: string;
	last_used_at?: string | null;
	revoked_at?: string | null;
}

function GoogleGrantCard({ onChange }: { onChange?: () => void }) {
	const [grant, setGrant] = useState<GoogleGrant | null | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	const refresh = () => {
		fetch('/api/v1/identity/google-grants', { credentials: 'include' })
			.then((r) => (r.ok ? r.json() : Promise.reject(r)))
			.then((d) => setGrant((d?.data?.google as GoogleGrant) ?? null))
			.catch(() => setGrant(null));
	};

	useEffect(() => { refresh(); }, []);

	async function disconnect() {
		if (!confirm('Revoke the Google grant? lumid will keep an encrypted copy until you reconnect, but the personal-agent app will lose Gmail + Calendar access until then.')) return;
		setBusy(true);
		try {
			const r = await fetch('/api/v1/identity/google-token', {
				method: 'DELETE',
				credentials: 'include',
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			toast.success('Google grant revoked');
			refresh();
			onChange?.();
		} catch (e) {
			toast.error((e as Error).message || 'Failed to revoke');
		} finally {
			setBusy(false);
		}
	}

	if (grant === undefined) {
		return (
			<div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
				Loading…
			</div>
		);
	}

	if (!grant) {
		// Not connected — show the Connect call-to-action.
		return (
			<Link
				to="/dashboard/account/connect/google"
				className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
			>
				<div className="flex items-start gap-3">
					<div className="rounded-lg bg-indigo-50 p-2">
						<Mail className="w-5 h-5 text-indigo-600" />
					</div>
					<div className="flex-1 min-w-0">
						<div className="font-medium text-sm">Google · Gmail + Calendar</div>
						<div className="text-xs text-muted-foreground mt-0.5">
							Not connected. Required by the <code>personal-agent</code> xpio
							app's morning_brief + hourly_triage loops. Single click, no
							per-user OAuth-app registration.
						</div>
					</div>
					<div className="text-xs text-indigo-600 self-center">Connect →</div>
				</div>
			</Link>
		);
	}

	// Connected (or revoked). Render full state.
	const isRevoked = grant.state === 'revoked';
	const tone = isRevoked
		? 'border-amber-200 bg-amber-50/40'
		: 'border-green-200 bg-green-50/40';
	const dotTone = isRevoked ? 'bg-amber-500' : 'bg-green-500';

	return (
		<div className={`rounded-xl border ${tone} p-4`}>
			<div className="flex items-start gap-3">
				<div className="rounded-lg bg-white p-2 border border-gray-200">
					<Mail className="w-5 h-5 text-indigo-600" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<div className="font-medium text-sm">Google · Gmail + Calendar</div>
						<span className="inline-flex items-center gap-1 text-[11px] font-medium">
							<span className={`w-1.5 h-1.5 rounded-full ${dotTone}`}></span>
							{isRevoked ? 'revoked' : 'connected'}
						</span>
					</div>
					<div className="text-xs text-muted-foreground mt-1 space-y-0.5">
						<div>
							<span className="text-gray-500">Granted </span>
							<RelativeTime iso={grant.granted_at} />
							{grant.last_used_at && (
								<>
									<span className="text-gray-500"> · last used </span>
									<RelativeTime iso={grant.last_used_at} />
								</>
							)}
							{grant.revoked_at && (
								<>
									<span className="text-gray-500"> · revoked </span>
									<RelativeTime iso={grant.revoked_at} />
								</>
							)}
						</div>
						<div className="flex flex-wrap gap-1 mt-1">
							{(grant.scopes || []).map((s) => (
								<code
									key={s}
									className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-700"
								>
									{shortScope(s)}
								</code>
							))}
						</div>
					</div>
				</div>
				<div className="flex flex-col items-end gap-2">
					{isRevoked ? (
						<Link
							to="/dashboard/account/connect/google"
							className="text-xs text-indigo-600 hover:underline"
						>
							Reconnect →
						</Link>
					) : (
						<>
							<Link
								to="/dashboard/account/connect/google"
								className="text-xs text-gray-500 hover:text-gray-900 hover:underline"
							>
								View
							</Link>
							<button
								onClick={disconnect}
								disabled={busy}
								className="text-xs text-red-600 hover:underline disabled:opacity-50"
							>
								Disconnect
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function shortScope(s: string): string {
	// Trim "https://www.googleapis.com/auth/" prefix for compact display
	const m = s.match(/\/auth\/([^/]+)$/);
	return m ? m[1] : s;
}

function RelativeTime({ iso }: { iso: string }) {
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return <span>—</span>;
	const diff = (Date.now() - t) / 1000;
	let label: string;
	if (diff < 60) label = 'just now';
	else if (diff < 3600) label = `${Math.floor(diff / 60)}m ago`;
	else if (diff < 86400) label = `${Math.floor(diff / 3600)}h ago`;
	else label = `${Math.floor(diff / 86400)}d ago`;
	return <span title={iso}>{label}</span>;
}
