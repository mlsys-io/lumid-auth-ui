import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { AlertTriangle, Check, Copy, KeyRound, Plus, Shield, Trash2, Clock, X } from 'lucide-react';
import {
	listPATs,
	mintPAT,
	revokePAT,
	getPATAccessLog,
	SCOPE_PRESETS,
	type PATInfo,
	type Scope,
	type PATAccessLogEntry,
	type MintPATResponse,
} from '../../api/identity';

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
		<div className={`px-4 py-3 flex items-center gap-3 ${isLast ? '' : 'border-b border-gray-100'}`}>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">{token.name}</span>
					<span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${statusColor}`}>
						{token.status}
					</span>
				</div>
				<div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
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
	);
}

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
	const [preset, setPreset] = useState<string>('trading_bot');
	const [expiry, setExpiry] = useState<string>('0');
	const [submitting, setSubmitting] = useState(false);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (open) {
			setName('');
			setPreset('trading_bot');
			setExpiry('0');
			setCopied(false);
		}
	}, [open]);

	const scopes = useMemo<Scope[]>(
		() => SCOPE_PRESETS.find((p) => p.id === preset)?.scopes ?? ['read'],
		[preset],
	);

	const submit = async () => {
		if (!name.trim()) {
			toast.error('Name is required');
			return;
		}
		setSubmitting(true);
		try {
			const r = await mintPAT({
				name: name.trim(),
				scopes,
				expires_in_seconds: Number(expiry) || 0,
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
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>{minted ? 'Save your new token' : 'New Personal Access Token'}</DialogTitle>
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
							<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my laptop" />
						</div>
						<div>
							<Label>Scope</Label>
							<Select value={preset} onValueChange={setPreset}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SCOPE_PRESETS.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											<div className="flex flex-col">
												<span className="font-medium">{p.label}</span>
												<span className="text-xs text-muted-foreground">{p.description}</span>
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="mt-2 text-xs text-gray-500">
								Grants: <code className="bg-gray-100 rounded px-1.5 py-0.5">{scopes.join(' · ')}</code>
							</div>
						</div>
						<div>
							<Label>Expiration</Label>
							<Select value={expiry} onValueChange={setExpiry}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="0">Never expires</SelectItem>
									<SelectItem value={String(7 * 86400)}>7 days</SelectItem>
									<SelectItem value={String(30 * 86400)}>30 days</SelectItem>
									<SelectItem value={String(90 * 86400)}>90 days</SelectItem>
									<SelectItem value={String(365 * 86400)}>1 year</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button onClick={submit} disabled={submitting || !name.trim()}>
								{submitting ? 'Minting…' : 'Mint token'}
							</Button>
						</DialogFooter>
					</div>
				)}
			</DialogContent>
		</Dialog>
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
				<pre className="mt-1 bg-gray-50 border border-gray-200 rounded-md p-2 text-xs font-mono whitespace-pre-wrap break-all">
					curl -sSL https://lumid.market/install.sh | bash -s -- {minted.token}
				</pre>
				<p className="mt-1 text-xs text-gray-500">
					Runs on your own machine. See{' '}
					<a href="/connect" className="text-indigo-500 hover:underline">
						/connect
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
			.catch(() => {})
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
