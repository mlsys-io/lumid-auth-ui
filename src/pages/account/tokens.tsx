import { useEffect, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { deleteSshKey, listSshKeys, uploadSshKey, type SshKey } from '@/api/ssh-keys';
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
	presetScopes,
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
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { updateInvitationCode } from '../../api/auth';
import {
	STALE_HEADING, bulkRevokeResult, groupTokens, isAutoMinted, lastUsedWords, powerfulScopes, revokeTheseLabel,
} from '@/lib/token-hygiene';

/**
 * /account/tokens — mint, list, revoke, audit Personal Access Tokens.
 *
 * Named "Personal Access Tokens" (not just "API Keys") to signal that
 * the same credential is meant to work across every Lumid subsystem
 * once federated identity ships. The row labels + column hints
 * foreground the Runmesh-identity framing without screaming it at
 * the user.
 */
// Tokens the platform mints on the user's behalf (an app intent needing a
// credential) are named "<purpose> (…, auto)" (lib/token-hygiene isAutoMinted).
// One account had 98 of them above its 2 hand-made tokens, so the ones the
// user actually manages were buried. They stay listed — revocable and
// auditable — behind a fold.
//
// Hand-made tokens nobody has used in 60+ days lead the page, grouped, with
// one button that lists them for confirmation before revoking any.
function TokenList({ tokens, onRevoke, onAudit, onBulkRevoke }: {
	tokens: PATInfo[];
	onRevoke: (t: PATInfo) => void;
	onAudit: (t: PATInfo) => void;
	onBulkRevoke: (list: PATInfo[]) => void;
}) {
	const [showAuto, setShowAuto] = useState(false);
	const nowSec = Math.floor(Date.now() / 1000);
	const { stale, rest } = groupTokens(tokens.filter((t) => !isAutoMinted(t)), nowSec);
	const mine = rest;
	const auto = tokens.filter(isAutoMinted);
	const rows = (list: PATInfo[]) => list.map((t, i) => (
		<TokenRow
			key={t.id}
			token={t}
			isLast={i === list.length - 1}
			onRevoke={() => onRevoke(t)}
			onAudit={() => onAudit(t)}
		/>
	));
	return (
		<div className="space-y-3">
			{stale.length > 0 && (
				<section aria-label={STALE_HEADING} className="border border-ember-200 rounded-xl overflow-hidden bg-card">
					<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-ember-50 border-b border-ember-200">
						<span className="flex items-center gap-1.5 text-meta text-ember-700">
							<AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden /> {STALE_HEADING}
						</span>
						<Button variant="destructive" size="sm" onClick={() => onBulkRevoke(stale)}>
							<Trash2 className="w-3.5 h-3.5 mr-1" /> {revokeTheseLabel(stale.length)}
						</Button>
					</div>
					{rows(stale)}
				</section>
			)}
			{mine.length > 0 && (
				<div className="border border-ink-200 rounded-xl overflow-hidden bg-card">{rows(mine)}</div>
			)}
			{auto.length > 0 && (
				<div className="border border-ink-200 rounded-xl overflow-hidden bg-card">
					<button
						type="button"
						onClick={() => setShowAuto((v) => !v)}
						aria-expanded={showAuto}
						className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-ink-600 hover:bg-ink-50"
					>
						<span>Created automatically by your apps ({auto.length})</span>
						<span className="text-xs text-ink-600">{showAuto ? 'Hide' : 'Show'}</span>
					</button>
					{showAuto && <div className="border-t border-ink-100">{rows(auto)}</div>}
				</div>
			)}
		</div>
	);
}

export default function TokensPage() {
	const [tokens, setTokens] = useState<PATInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [mintOpen, setMintOpen] = useState(false);
	const [minted, setMinted] = useState<MintPATResponse | null>(null);
	const [confirmRevoke, setConfirmRevoke] = useState<PATInfo | null>(null);
	const [bulkRevoke, setBulkRevoke] = useState<PATInfo[] | null>(null);
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
		<div className="max-w-[1120px] space-y-4">
			{/* Lumen: the shared serif PageHeader (was a bold 24px sans with a plum
			    key, a different title voice from every other Studio page). */}
			<PageHeader
				className="pt-2 pb-2"
				title="Personal access tokens"
				subtitle="Your LumidOS credential. Works here in LQA, in Claude Code via MCP, and in any LumidOS app — AI quant research and beyond. Scope each token to exactly what it needs."
				actions={
					<Button onClick={() => setMintOpen(true)}>
						<Plus className="w-4 h-4" /> New token
					</Button>
				}
			/>

			<AccessCodeRedeemer />

			{loading ? (
				<div className="space-y-2" aria-busy="true" aria-label="Loading tokens">
					{[0, 1].map((i) => <Skeleton key={i} className="h-[68px] w-full rounded-[12px]" />)}
				</div>
			) : tokens.length === 0 ? (
				<EmptyState
					icon={KeyRound}
					title="No tokens yet"
					body="Mint one to use LumidOS from Claude Code, the CLI, or your own scripts."
					actionLabel="Mint your first token"
					onAction={() => setMintOpen(true)}
				/>
			) : (
				<TokenList tokens={tokens} onRevoke={setConfirmRevoke} onAudit={setAuditFor} onBulkRevoke={setBulkRevoke} />
			)}

			{/* SSH keys.
			    ------------------------------------------------------------------
			    THIS PAGE IS WHERE PEOPLE LOOK FOR CREDENTIALS. Until 2026-09-13 the
			    only place to add an SSH key was a button inside Research Fleet ->
			    Sandboxes, three levels from here and next to "Create sandbox" —
			    nobody adding a key goes there. The observed result: a user creates a
			    sandbox, it runs, and every connection is refused with
			    `Permission denied (publickey)` with no surface anywhere telling them
			    they have no key. Same client as the Sandboxes panel; both are live,
			    because the contextual one is right when you are already provisioning
			    and this one is right when you are setting up an account. */}
			<div className="pt-8">
				<div className="flex items-start justify-between mb-3">
					<div>
						<h2 className="font-display text-h3 font-medium text-ink-900">
							SSH keys
						</h2>
						<p className="text-meta text-ink-600 mt-0.5">
							Public keys that let you into your sandboxes over{" "}
							<code className="rounded bg-muted px-1">ssh gw@lum.id</code>. Without one,
							a running sandbox still refuses every connection.
						</p>
					</div>
				</div>
				<SshKeysCard />
			</div>

			{/* OAuth scope grants — live state from /api/v1/identity/google-grants. */}
			<div className="pt-8">
				<div className="flex items-start justify-between mb-3">
					<div>
						<h2 className="font-display text-h3 font-medium text-ink-900">
							OAuth grants
						</h2>
						<p className="text-meta text-ink-600 mt-0.5">
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

			<BulkRevokeDialog
				tokens={bulkRevoke}
				onClose={() => setBulkRevoke(null)}
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
			? 'bg-gold-50 text-gold-700 border-gold-200'
			: token.status === 'revoked'
				? 'bg-ink-50 text-ink-600 border-ink-200'
				: 'bg-ember-50 text-ember-700 border-ember-200';
	return (
		<div
			className={`px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${
				isLast ? '' : 'border-b border-ink-100'
			}`}
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 flex-wrap">
					<span className="font-medium truncate">{token.name}</span>
					<span className={`text-nano font-medium border rounded-full px-2 py-0.5 ${statusColor}`}>
						{token.status}
					</span>
				</div>
				<div className="text-xs text-ink-600 mt-0.5 flex items-center gap-3 flex-wrap">
					<code className="font-mono">{token.token_prefix}…</code>
					<span className="flex items-center gap-1">
						<Shield className="w-3 h-3" />
						{token.scopes.join(', ')}
					</span>
					{(token.status === 'active' || token.last_used_at > 0) && (
						<span className="flex items-center gap-1">
							<Clock className="w-3 h-3" /> {lastUsedWords(token, Math.floor(Date.now() / 1000))}
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
						className="text-brick-600 border-brick-200 hover:bg-brick-50"
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
	const [capScopes, setCapScopes] = useState<Set<string>>(new Set());

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
		setCapScopes(new Set());
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
			// presetScopes(), not `.scopes`: a preset that enumerates services is a second
			// copy of a list the server owns, and it went stale when `findata` was added.
			const p = SCOPE_PRESETS.find((x) => x.id === preset);
			return p ? presetScopes(p, grantable) : [];
		}
		const out: Scope[] = [];
		if (customWildcard) out.push('*');
		// Same server-first list the table renders. Iterating SCOPE_SERVICES here
		// while the table rendered the server's list would be worse than the
		// original bug: the row appears, you select a level, and the scope is
		// silently dropped on submit. `custom` is seeded from the mirror, so a
		// service known only to the server has no entry yet — default it.
		for (const svc of grantable?.services ?? SCOPE_SERVICES) {
			const lvl = custom[svc] ?? 'none';
			if (lvl !== 'none') out.push(`${svc}:${lvl}`);
		}
		for (const cap of capScopes) out.push(cap);
		return out;
	}, [mode, preset, custom, customWildcard, capScopes, grantable]);

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
									<SelectTrigger className="bg-card">
										<SelectValue>
											{SCOPE_PRESETS.find((p) => p.id === preset)?.label ??
												'Select a scope'}
										</SelectValue>
									</SelectTrigger>
									<SelectContent className="z-[200] bg-card border border-ink-200 shadow-xl">
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
																<span className="ml-2 text-xs text-ink-600">
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
								<p className="mt-2 text-xs text-ink-600">
									Grants{' '}
									<span className="font-mono text-ink-700">
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
								capScopes={capScopes}
								setCapScopes={setCapScopes}
								resultingScopes={scopes}
							/>
						)}

						<div>
							<Label>Expiration</Label>
							<Select value={ttlDays} onValueChange={setTtlDays}>
								<SelectTrigger className="bg-card">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="z-[200] bg-card border border-ink-200 shadow-xl">
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

// Opaque capability tags from identity's `capabilityScopes` allowlist
// (admin_users.go). They are grantable by ANY active authenticated user and
// confer no platform access — parseScope ignores them — so they belong here
// and NOT in SCOPE_SERVICES, which drives the service:level access matrix.
//
// Keep this in sync with capabilityScopes. A tag that identity grants but this
// list omits is unmintable from the UI with no other way to ask for it: there
// is no free-text scope field. That is how `lqt:strategy` came to be required
// by step 3 of the published /docs/lqt-strategies instructions while being
// impossible to obtain — the whole strategy funnel dead-ended on this array.
// FALLBACK ONLY — the real list is served by identity as `grantable.capabilities`
// (see GrantableCapability). This pair remains so the dialog still offers something
// against an identity older than 2026-09-15, and because these two are the ones with
// published docs pointing at them. Do NOT add to this array: adding a tag here instead
// of to identity's capabilityCatalog is exactly how this list fell thirteen entries
// behind the allowlist, leaving flowmesh:workflows:write impossible to ask for.
const CAP_SCOPES_FALLBACK = [
	{
		id: 'claude:proxy',
		label: 'Claude proxy',
		desc: 'Route Claude Code through the org account pool at lum.id/claude',
	},
	{
		id: 'lqt:strategy',
		label: 'LQT strategy deploy',
		desc: 'Submit and deploy your own LQT strategies (the strategy.deploy mailbox topic). Confers no admin and no real-trade — live trading is gated separately.',
	},
] as const;

function CustomScopePicker({
	grantable,
	custom,
	setCustom,
	wildcard,
	setWildcard,
	capScopes,
	setCapScopes,
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
	capScopes: Set<string>;
	setCapScopes: (v: Set<string>) => void;
	resultingScopes: Scope[];
}) {
	return (
		<div className="space-y-3">
			<div className="rounded-lg border border-ink-200 overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-ink-50 text-xs text-ink-600 uppercase tracking-wide">
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
						{/* Render the SERVER's service list, not the local SCOPE_SERVICES
						    mirror, falling back to the mirror only until the fetch lands.
						    The two drift: `findata` was added to identity's accessServices
						    on 2026-08-24 and the server offered it immediately
						    (grantable-scopes -> services + matrix), while this table showed
						    six rows and no way to mint findata:read at all. That is the same
						    failure that left lqt:strategy required-but-unobtainable — a
						    scope the backend accepts and the UI gives you no way to ask
						    for. Reading the server's list means the next service added
						    appears here on its own. */}
						{(grantable?.services ?? SCOPE_SERVICES).map((svc) => {
							const have = grantable?.matrix[svc] ?? 'none';
							return (
								<tr key={svc} className="border-t border-ink-100">
									<td className="py-2 px-3">
										<div className="font-medium">{svc}</div>
										<div className="text-micro text-ink-600">
											you have: <span className="font-mono">{have}</span>
										</div>
									</td>
									{LEVELS.map((l) => {
										const disabled =
											l !== 'none' && grantable !== null && !levelSatisfies(have, l);
										// `?? 'none'`: `custom` is seeded from the local
									// SCOPE_SERVICES mirror, so a service the SERVER knows
									// about but the mirror does not has no entry yet. Without
									// the default, that row renders with NO level selected —
									// not even "none" — which reads as a broken control.
									const checked = (custom[svc] ?? 'none') === l;
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
					<span className="text-xs text-ink-600">admin role only</span>
				)}
			</label>

			{/* Capability scopes — SERVED, not hardcoded. Identity filters this list
			    through canGrant before sending it, so everything rendered here is
			    something this caller can actually mint; and a tag added to its
			    allowlist shows up here on its own, which is the whole fix. Note
			    these are the ONLY way to ask for a multi-colon scope: parseScope
			    splits on the first colon, so the service x level matrix above
			    structurally cannot produce `flowmesh:workflows:write`. */}
			<div className="space-y-1.5">
				<p className="text-xs font-medium text-ink-600 uppercase tracking-wide">
					Capability scopes
				</p>
				{(grantable?.capabilities?.map((c) => ({ id: c.scope, label: c.label, desc: c.desc }))
					?? CAP_SCOPES_FALLBACK.map((c) => ({ id: c.id as string, label: c.label, desc: c.desc }))
				).map(({ id, label, desc }) => (
					<label key={id} className="flex items-start gap-2 cursor-pointer">
						<input
							type="checkbox"
							className="mt-0.5"
							checked={capScopes.has(id)}
							onChange={(e) => {
								const next = new Set(capScopes);
								e.target.checked ? next.add(id) : next.delete(id);
								setCapScopes(next);
							}}
						/>
						<span>
							<span className="text-sm font-medium">{label}</span>
							<span className="ml-1 font-mono text-xs text-ink-600">{id}</span>
							<p className="text-xs text-ink-600">{desc}</p>
						</span>
					</label>
				))}
			</div>

			{/* Claude pool overrides — only pools the caller belongs to besides
			    their primary. The primary pool is already what an unscoped
			    token draws from; this exists so a member of a SECOND pool can
			    mint a token that deliberately routes to that one instead. */}
			{(grantable?.claude_pools ?? []).filter((p) => !p.is_primary).length > 0 && (
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-ink-600 uppercase tracking-wide">
						Claude pool override
					</p>
					{(grantable?.claude_pools ?? [])
						.filter((p) => !p.is_primary)
						.map((p) => {
							const id = `claude-pool:${p.id}`;
							return (
								<label key={id} className="flex items-start gap-2 cursor-pointer">
									<input
										type="checkbox"
										className="mt-0.5"
										checked={capScopes.has(id)}
										onChange={(e) => {
											const next = new Set(capScopes);
											e.target.checked ? next.add(id) : next.delete(id);
											setCapScopes(next);
										}}
									/>
									<span>
										<span className="text-sm font-medium">{p.name}</span>
										<span className="ml-1 font-mono text-xs text-ink-600">{id}</span>
										<p className="text-xs text-ink-600">
											Route Claude Code through this pool's accounts instead of your
											primary pool, for this token only.
										</p>
									</span>
								</label>
							);
						})}
				</div>
			)}

			<p className="text-xs text-ink-600">
				Grants{' '}
				<span className="font-mono text-ink-700">
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
			<div className="rounded-lg border border-ember-200 bg-ember-50 p-3 text-sm flex items-start gap-2">
				<AlertTriangle className="w-4 h-4 text-ember-600 mt-0.5 shrink-0" />
				<div className="text-ember-900">
					Store this somewhere safe. If you lose it, revoke and mint a new one — we can't show it again.
				</div>
			</div>

			<div>
				<Label>Your token</Label>
				<div className="flex gap-2 mt-1">
					<Input readOnly value={minted.token} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
					<Button variant="outline" onClick={onCopy} className="shrink-0">
						{copied ? <Check className="w-4 h-4 text-gold-700" /> : <Copy className="w-4 h-4" />}
					</Button>
				</div>
			</div>

			<div>
				<Label>One-liner install</Label>
				<div className="mt-1 space-y-2">
					<div>
						<div className="text-micro uppercase tracking-wide text-ink-600 mb-0.5">Linux / macOS</div>
						<pre className="bg-ink-50 border border-ink-200 rounded-md p-2 text-xs font-mono whitespace-pre-wrap break-all">
							curl -sSL https://lum.id/start | bash -s -- {minted.token}
						</pre>
					</div>
					<div>
						<div className="text-micro uppercase tracking-wide text-ink-600 mb-0.5">Windows (PowerShell)</div>
						<pre className="bg-ink-50 border border-ink-200 rounded-md p-2 text-xs font-mono whitespace-pre-wrap break-all">
							{`$env:LUMID_PAT='${minted.token}'; iwr https://lum.id/install.ps1 -useb | iex`}
						</pre>
					</div>
				</div>
				<p className="mt-2 text-xs text-ink-600">
					Runs on your own machine. See{' '}
					<a href="/account/connect/google" className="text-plum-600 hover:underline">
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

/** Revoke a list of tokens after the reader has seen every one of them. Calls
 *  the same per-token revoke as the row button, one at a time; a failure is
 *  named and the rest still go. */
function BulkRevokeDialog({
	tokens,
	onClose,
	onRevoked,
}: {
	tokens: PATInfo[] | null;
	onClose: () => void;
	onRevoked: () => void;
}) {
	const [submitting, setSubmitting] = useState(false);
	const [done, setDone] = useState(0);
	if (!tokens || tokens.length === 0) return null;
	const nowSec = Math.floor(Date.now() / 1000);
	const submit = async () => {
		setSubmitting(true);
		setDone(0);
		const failed: string[] = [];
		let revoked = 0;
		for (const t of tokens) {
			try {
				await revokePAT(t.id);
				revoked++;
			} catch {
				failed.push(t.name);
			}
			setDone((d) => d + 1);
		}
		const r = bulkRevokeResult(revoked, failed);
		if (r.ok) toast.success(r.text);
		else toast.error(r.text);
		setSubmitting(false);
		onRevoked();
		onClose();
	};
	return (
		<Dialog open onOpenChange={(v) => { if (!v && !submitting) onClose(); }}>
			<DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle>{revokeTheseLabel(tokens.length)}?</DialogTitle>
					<DialogDescription>
						Each stops working immediately. Anything still using one will need a new token.
					</DialogDescription>
				</DialogHeader>
				<ul className="flex-1 overflow-y-auto border border-ink-100 rounded-md divide-y divide-ink-100">
					{tokens.map((t) => {
						const strong = powerfulScopes(t.scopes);
						return (
							<li key={t.id} className="px-3 py-2 text-caption">
								<div className="flex flex-wrap items-baseline gap-x-2">
									<span className="font-medium text-ink-900">{t.name}</span>
									<code className="font-mono text-micro text-ink-600">{t.token_prefix}…</code>
								</div>
								<div className="text-micro text-ink-600">
									{lastUsedWords(t, nowSec)}
									{strong.length > 0 && (
										<span className="text-ember-700"> · has {strong.join(', ')}</span>
									)}
								</div>
							</li>
						);
					})}
				</ul>
				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={submitting}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={submit} disabled={submitting}>
						{submitting ? `Revoking… ${done} of ${tokens.length}` : revokeTheseLabel(tokens.length)}
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
				<div className="flex-1 overflow-y-auto border border-ink-100 rounded-md">
					{loading ? (
						<div className="p-6 text-sm text-ink-600">Loading…</div>
					) : entries.length === 0 ? (
						<div className="p-6 text-sm text-ink-600 italic">No requests yet.</div>
					) : (
						<table className="w-full text-xs">
							<thead className="bg-ink-50 text-ink-600">
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
									<tr key={i} className="border-t border-ink-50 hover:bg-ink-50/60">
										<td className="px-3 py-1.5 tabular-nums text-ink-600 whitespace-nowrap">
											{new Date(e.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19)}
										</td>
										<td className="px-3 py-1.5">
											<code className="text-nano bg-ink-100 rounded px-1.5 py-0.5">{e.source}</code>
										</td>
										<td className="px-3 py-1.5 font-mono truncate max-w-md" title={`${e.method} ${e.path}`}>
											<span className="text-ink-600">{e.method}</span> {e.path}
										</td>
										<td className="px-3 py-1.5 tabular-nums">
											<span className={e.status >= 400 ? 'text-brick-600' : 'text-gold-700'}>{e.status}</span>
										</td>
										<td className="px-3 py-1.5 tabular-nums text-ink-600">{e.duration_ms}ms</td>
										<td className="px-3 py-1.5 text-ink-600 truncate max-w-[120px]" title={e.ip}>
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

// ── SshKeysCard ───────────────────────────────────────────────────
// Deliberately plain: list, add, remove. No sync button — syncing is a
// per-site gateway concern and belongs on the Sandboxes tab, which does it
// automatically on add. Here the question is only "does my account know my key".

function SshKeysCard() {
	const [keys, setKeys] = useState<SshKey[] | null>(null);
	const [pub, setPub] = useState("");
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");

	const load = useCallback(async () => {
		try { setKeys(await listSshKeys()); } catch { setKeys([]); }
	}, []);
	useEffect(() => { void load(); }, [load]);

	async function add() {
		const k = pub.trim();
		setErr("");
		// Catch the two common paste mistakes with a specific message rather than
		// letting identity answer 400 "bad request".
		if (k.startsWith("-----BEGIN")) {
			setErr("That is a PRIVATE key. Paste the .pub file — it starts with ssh-ed25519 or ssh-rsa.");
			return;
		}
		if (!/^(ssh-(rsa|ed25519|dss)|ecdsa-[a-z0-9-]+)\s+\S+/.test(k)) {
			setErr("Not a public key. Run: cat ~/.ssh/id_ed25519.pub");
			return;
		}
		setBusy(true);
		try {
			const comment = k.split(/\s+/)[2] ?? "";
			await uploadSshKey({ title: label.trim() || comment || `key-${new Date().toISOString().slice(0, 10)}`, public_key: k });
			setPub(""); setLabel("");
			await load();
		} catch (e: any) {
			setErr(e?.response?.data?.message ?? "could not add that key");
		} finally { setBusy(false); }
	}

	async function remove(k: SshKey) {
		if (!confirm(`Delete SSH key "${k.title}"?\n\nAny machine using it loses access to your sandboxes.`)) return;
		try { await deleteSshKey(k.id); await load(); } catch { setErr("could not remove that key"); }
	}

	return (
		<div className="rounded-[12px] border border-border bg-card p-5 shadow-e1">
			{keys === null ? (
				<div className="mb-4 space-y-2" aria-busy="true"><Skeleton className="h-4 w-2/3 rounded" /></div>
			) : keys.length === 0 ? (
				<p className="mb-4 flex items-start gap-2 rounded-[8px] bg-ember-50 px-3 py-2 text-meta text-ember-800">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ember-700" aria-hidden />
					No SSH keys yet — sandboxes will refuse every connection until you add one.
				</p>
			) : (
				<ul className="mb-4 divide-y divide-ink-100">
					{keys.map((k) => (
						<li key={k.id} className="flex items-center gap-3 py-2 text-meta first:pt-0">
							<KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
							<span className="font-medium text-ink-900">{k.title}</span>
							<span className="min-w-0 truncate font-mono text-caption text-ink-600">{k.fingerprint}</span>
							<Button variant="ghost" size="sm" onClick={() => void remove(k)}
								className="ml-auto text-ink-600 hover:bg-brick-50 hover:text-brick-700">Remove</Button>
						</li>
					))}
				</ul>
			)}
			<div className="flex flex-wrap items-end gap-3">
				<div className="min-w-0 flex-1 basis-80">
					<Label htmlFor="ssh-pub" className="text-meta font-medium text-ink-700">Public key</Label>
					<Input id="ssh-pub" value={pub} onChange={(e) => setPub(e.target.value)}
						placeholder="ssh-ed25519 AAAAC3... you@laptop"
						className="mt-1.5 font-mono text-meta" />
				</div>
				<div className="w-36">
					<Label htmlFor="ssh-label" className="text-meta font-medium text-ink-700">
						Label <span className="font-normal text-ink-600">(optional)</span>
					</Label>
					<Input id="ssh-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="laptop"
						className="mt-1.5" />
				</div>
				<Button onClick={() => void add()} disabled={busy || !pub.trim()}>
					{busy ? "Adding…" : "Add key"}
				</Button>
			</div>
			{err && <p role="alert" className="mt-2 text-meta text-brick-700">{err}</p>}
			<p className="mt-3 text-meta text-ink-600">
				Get it with <code className="rounded bg-ink-100 px-1 font-mono text-caption text-ink-800">cat ~/.ssh/id_ed25519.pub</code>.
			</p>
		</div>
	);
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
			<div className="rounded-xl border border-ink-200 bg-card p-4 text-sm text-ink-600">
				Loading…
			</div>
		);
	}

	if (!grant) {
		// Not connected — show the Connect call-to-action.
		return (
			<Link
				to="/studio/account/connect/google"
				className="block rounded-xl border border-ink-200 bg-card p-4 hover:border-plum-300 hover:bg-plum-50/30 transition-colors"
			>
				<div className="flex items-start gap-3">
					<div className="rounded-lg bg-plum-50 p-2">
						<Mail className="w-5 h-5 text-plum-600" />
					</div>
					<div className="flex-1 min-w-0">
						<div className="font-medium text-sm">Google · Gmail + Calendar</div>
						<div className="text-xs text-muted-foreground mt-0.5">
							Not connected. Required by the <code>personal-agent</code> xpio
							app's morning_brief + hourly_triage workflows. Single click, no
							per-user OAuth-app registration.
						</div>
					</div>
					<div className="text-xs text-plum-600 self-center">Connect →</div>
				</div>
			</Link>
		);
	}

	// Connected (or revoked). Render full state.
	const isRevoked = grant.state === 'revoked';
	const tone = isRevoked
		? 'border-ember-200 bg-ember-50/40'
		: 'border-gold-200 bg-gold-50/40';
	const dotTone = isRevoked ? 'bg-ember-500' : 'bg-gold-500';

	return (
		<div className={`rounded-xl border ${tone} p-4`}>
			<div className="flex items-start gap-3">
				<div className="rounded-lg bg-card p-2 border border-ink-200">
					<Mail className="w-5 h-5 text-plum-600" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<div className="font-medium text-sm">Google · Gmail + Calendar</div>
						<span className="inline-flex items-center gap-1 text-micro font-medium">
							<span className={`w-1.5 h-1.5 rounded-full ${dotTone}`}></span>
							{isRevoked ? 'revoked' : 'connected'}
						</span>
					</div>
					<div className="text-xs text-muted-foreground mt-1 space-y-0.5">
						<div>
							<span className="text-ink-600">Granted </span>
							<RelativeTime iso={grant.granted_at} />
							{grant.last_used_at && (
								<>
									<span className="text-ink-600"> · last used </span>
									<RelativeTime iso={grant.last_used_at} />
								</>
							)}
							{grant.revoked_at && (
								<>
									<span className="text-ink-600"> · revoked </span>
									<RelativeTime iso={grant.revoked_at} />
								</>
							)}
						</div>
						<div className="flex flex-wrap gap-1 mt-1">
							{(grant.scopes || []).map((s) => (
								<code
									key={s}
									className="px-1.5 py-0.5 rounded bg-card border border-ink-200 text-nano text-ink-700"
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
							to="/studio/account/connect/google"
							className="text-xs text-plum-600 hover:underline"
						>
							Reconnect →
						</Link>
					) : (
						<>
							<Link
								to="/studio/account/connect/google"
								className="text-xs text-ink-600 hover:text-ink-900 hover:underline"
							>
								View
							</Link>
							<button
								onClick={disconnect}
								disabled={busy}
								className="text-xs text-brick-600 hover:underline disabled:opacity-50"
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

// Redeem an access code.
//
// WHY IT LIVES ON THIS PAGE. The moment someone needs it is the moment they
// open the mint dialog, look for `lumid:write`, and find they cannot grant it
// to themselves. Putting the remedy on the page where that discovery happens
// means they do not have to know the feature exists in order to find it.
//
// It is NOT on the OAuth callback dialog, which is where invitation codes were
// redeemed before: that dialog only appears for accounts with no code yet, so
// it is unreachable for every already-onboarded user — which is precisely the
// population that needs a grant. All twenty cohort accounts were in exactly
// that state.
//
// Deliberately quiet by default: it is a one-line prompt, not a form, because
// most people visiting this page have no code and should not be asked for one.
function AccessCodeRedeemer() {
	const [open, setOpen] = useState(false);
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState(false);

	async function redeem() {
		const c = code.trim();
		if (!c) return;
		setBusy(true);
		try {
			await updateInvitationCode({ invitation_code: c });
			// Reload rather than patch local state: redeeming rewrites the
			// caller's grants, and the mint dialog reads those from
			// grantable-scopes at open time. A stale in-memory view here would
			// show the new scope as still ungrantable, which reads as the
			// redemption having failed.
			toast.success('Access code redeemed — your new scopes are available now');
			setCode('');
			setOpen(false);
			setTimeout(() => window.location.reload(), 600);
		} catch (e: unknown) {
			toast.error((e as Error)?.message || 'Could not redeem that code');
		} finally {
			setBusy(false);
		}
	}

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
			>
				Have an access code? Redeem it to unlock scopes you can't grant yourself.
			</button>
		);
	}

	return (
		<div className="rounded-lg border p-4 space-y-2">
			<Label htmlFor="access-code">Access code</Label>
			<div className="flex gap-2">
				<Input
					id="access-code"
					value={code}
					onChange={(e) => setCode(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && void redeem()}
					placeholder="paste the code an operator sent you"
					className="font-mono"
				/>
				<Button onClick={() => void redeem()} disabled={busy || !code.trim()}>
					{busy ? 'Redeeming…' : 'Redeem'}
				</Button>
				<Button variant="ghost" onClick={() => setOpen(false)}>
					Cancel
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				Access codes grant entitlements you cannot give yourself — <code>lumid:write</code>{' '}
				being the usual one. Redeeming applies the grant to your account; you then mint
				tokens with it as normal. A code can only be redeemed once per person.
			</p>
		</div>
	);
}
