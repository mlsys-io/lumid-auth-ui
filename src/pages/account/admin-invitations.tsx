import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Trash, Plus, Shield } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../../components/ui/select';
import {
	listInvitations,
	mintInvitations,
	revokeInvitation,
	type InvitationCode,
} from '../../api/admin';

type Status = 'active' | 'revoked' | 'exhausted' | 'all';

export default function AdminInvitations() {
	const navigate = useNavigate();
	const [codes, setCodes] = useState<InvitationCode[]>([]);
	const [loading, setLoading] = useState(true);
	const [status, setStatus] = useState<Status>('active');

	// Mint form
	const [count, setCount] = useState(1);
	const [maxUses, setMaxUses] = useState(1);
	const [note, setNote] = useState('');
	const [ttlDays, setTtlDays] = useState(0);
	const [minting, setMinting] = useState(false);

	async function refresh() {
		setLoading(true);
		try {
			const r = await listInvitations(status);
			setCodes(r.codes || []);
		} catch (e: unknown) {
			toast.error((e as Error)?.message || 'Failed to load codes');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [status]);

	async function onMint() {
		setMinting(true);
		try {
			const r = await mintInvitations({
				count,
				max_uses: maxUses,
				note: note.trim() || undefined,
				ttl_days: ttlDays || 0,
			});
			toast.success(`Minted ${r.total} code${r.total === 1 ? '' : 's'}`);
			setNote('');
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || 'Mint failed');
		} finally {
			setMinting(false);
		}
	}

	async function onRevoke(code: string) {
		if (!confirm(`Revoke ${code}? Existing claimed users keep their access.`)) return;
		try {
			await revokeInvitation(code);
			toast.success('Revoked');
			refresh();
		} catch (e: unknown) {
			toast.error((e as Error)?.message || 'Revoke failed');
		}
	}

	function copy(code: string) {
		navigator.clipboard.writeText(code).then(
			() => toast.success('Copied'),
			() => toast.error('Copy failed')
		);
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
			<div className="max-w-4xl mx-auto px-4 py-10">
				<header className="flex items-center justify-between mb-8">
					<div className="flex items-center gap-3">
						<Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
							<ArrowLeft className="w-4 h-4 mr-1" />
							Account
						</Button>
						<div className="flex items-center gap-2">
							<Shield className="w-5 h-5 text-indigo-600" />
							<h1 className="text-xl font-semibold">Invitation codes</h1>
						</div>
					</div>
				</header>

				<Card className="mb-6 border-0 shadow-md bg-white/80 backdrop-blur-sm">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<Plus className="w-4 h-4 text-indigo-600" />
							Mint new codes
						</CardTitle>
						<CardDescription>
							Each code can be redeemed at registration. Revoking keeps already-claimed users intact.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<div className="space-y-1">
							<Label htmlFor="count">Count</Label>
							<Input
								id="count"
								type="number"
								min={1}
								max={100}
								value={count}
								onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="max-uses">Max uses per code</Label>
							<Input
								id="max-uses"
								type="number"
								min={1}
								value={maxUses}
								onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value) || 1))}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="ttl">Expire in (days, 0=never)</Label>
							<Input
								id="ttl"
								type="number"
								min={0}
								value={ttlDays}
								onChange={(e) => setTtlDays(Math.max(0, Number(e.target.value) || 0))}
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="note">Note (optional)</Label>
							<Input
								id="note"
								value={note}
								onChange={(e) => setNote(e.target.value)}
								placeholder="e.g. YC batch friends"
							/>
						</div>
						<div className="sm:col-span-2 lg:col-span-4">
							<Button onClick={onMint} disabled={minting} className="w-full sm:w-auto">
								{minting ? 'Minting…' : 'Mint'}
							</Button>
						</div>
					</CardContent>
				</Card>

				<Card className="border-0 shadow-md bg-white/80 backdrop-blur-sm">
					<CardHeader>
						<div className="flex items-center justify-between flex-wrap gap-3">
							<div>
								<CardTitle className="text-base">Existing codes</CardTitle>
								<CardDescription>
									{codes.length === 0 ? 'None yet' : `${codes.length} code${codes.length === 1 ? '' : 's'}`}
								</CardDescription>
							</div>
							<Select value={status} onValueChange={(v) => setStatus(v as Status)}>
								<SelectTrigger className="w-40">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="revoked">Revoked</SelectItem>
									<SelectItem value="exhausted">Exhausted</SelectItem>
									<SelectItem value="all">All</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</CardHeader>
					<CardContent>
						{loading ? (
							<p className="text-sm text-muted-foreground">Loading…</p>
						) : codes.length === 0 ? (
							<p className="text-sm text-muted-foreground">Nothing to show for this filter.</p>
						) : (
							<table className="w-full text-sm">
								<thead className="text-xs text-muted-foreground">
									<tr className="border-b">
										<th className="text-left py-2 pr-3 font-medium">Code</th>
										<th className="text-left py-2 pr-3 font-medium">Uses</th>
										<th className="text-left py-2 pr-3 font-medium">Note</th>
										<th className="text-left py-2 pr-3 font-medium">Expires</th>
										<th className="text-right py-2 pl-3 font-medium"></th>
									</tr>
								</thead>
								<tbody>
									{codes.map((c) => (
										<tr key={c.code} className="border-b last:border-0">
											<td className="py-2 pr-3 font-mono">{c.code}</td>
											<td className="py-2 pr-3">
												{c.uses_remaining}/{c.max_uses}
											</td>
											<td className="py-2 pr-3 truncate max-w-[200px]">{c.note || '—'}</td>
											<td className="py-2 pr-3 text-muted-foreground">
												{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}
											</td>
											<td className="py-2 pl-3 text-right">
												<Button variant="ghost" size="sm" onClick={() => copy(c.code)} title="Copy">
													<Copy className="w-4 h-4" />
												</Button>
												{!c.revoked_at && (
													<Button variant="ghost" size="sm" onClick={() => onRevoke(c.code)} title="Revoke">
														<Trash className="w-4 h-4 text-destructive" />
													</Button>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
