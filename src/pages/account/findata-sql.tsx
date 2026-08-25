// FinData SQL credentials — self-service warehouse access.
//
// Mirrors the PAT page's contract deliberately: the secret is shown exactly
// once, and the page says so before minting rather than after. Users have seen
// that pattern here already, so it needs no explaining.
//
// Three states this page has to distinguish, because they need different things
// from the reader and collapsing them produces a dead end:
//
//   not entitled          -> ask an operator. Nothing the user can do here.
//   entitled, no role     -> an operator must provision one. Also not on them,
//                            but a DIFFERENT ask, so it says so separately.
//   entitled + role       -> mint / rotate / revoke.
//
// The server returns 200 with `reason` for the first two rather than a 403,
// precisely so this page can render an explanation instead of an error toast.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { AlertTriangle, Check, Copy, Database, Clock, ShieldOff, Loader2 } from 'lucide-react';
import { me, type FindataSQLStatus, type FindataSQLCredential } from '../../api/me';

function relativeExpiry(iso?: string | null): string | null {
	if (!iso) return null;
	const ms = new Date(iso).getTime() - Date.now();
	if (Number.isNaN(ms)) return null;
	if (ms <= 0) return 'expired';
	const days = Math.floor(ms / 86_400_000);
	if (days >= 1) return `expires in ${days} day${days === 1 ? '' : 's'}`;
	const hours = Math.max(1, Math.floor(ms / 3_600_000));
	return `expires in ${hours} hour${hours === 1 ? '' : 's'}`;
}

export default function FindataSQL() {
	const [status, setStatus] = useState<FindataSQLStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	// Held in state and never re-fetched: the server cannot return it again.
	const [minted, setMinted] = useState<FindataSQLCredential | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	// The exact ask, ready to send. Provisioning is an out-of-band script with
	// no API, so this page offers the words rather than a button that pretends
	// to file a request it cannot file.
	const PROVISION_REQUEST =
		'Please provision my FinData SQL role (sql_<name>) — my findata grant is already set.';

	const load = useCallback(async () => {
		try {
			setStatus(await me.findataSQL());
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'could not load SQL access');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const copy = (label: string, text: string) => {
		navigator.clipboard.writeText(text);
		setCopied(label);
		setTimeout(() => setCopied(null), 1500);
	};

	async function mint() {
		setBusy(true);
		try {
			const cred = await me.mintFindataSQL();
			setMinted(cred);
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'mint failed');
		} finally {
			setBusy(false);
		}
	}

	async function revoke() {
		setBusy(true);
		try {
			const r = await me.revokeFindataSQL();
			// Report the session count: revoking is the one action here with an
			// effect the user cannot see, and "3 sessions terminated" is the
			// difference between believing it worked and hoping it did.
			toast.success(
				r.sessions_terminated > 0
					? `Revoked — ${r.sessions_terminated} live session${r.sessions_terminated === 1 ? '' : 's'} terminated`
					: 'Revoked',
			);
			setMinted(null);
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'revoke failed');
		} finally {
			setBusy(false);
		}
	}

	if (loading) {
		return (
			<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" /> Loading SQL access…
			</div>
		);
	}
	if (!status) return null;

	return (
		<div className="mx-auto max-w-3xl space-y-6 p-6">
			<header className="space-y-1">
				<h1 className="flex items-center gap-2 text-xl font-semibold">
					<Database className="h-5 w-5" /> FinData SQL
				</h1>
				<p className="text-sm text-muted-foreground">
					A read-only Postgres login on the FinData warehouse, for the bulk and
					ad-hoc work the REST API does not fit. Your own credential — not a
					shared one.
				</p>
			</header>

			{!status.available && (
				<Notice icon={<AlertTriangle className="h-4 w-4" />} tone="warn">
					SQL credential issuing is not configured on this deployment. Nothing
					you can do from here — mention it to an operator.
				</Notice>
			)}

			{status.available && !status.entitled && (
				<Notice icon={<ShieldOff className="h-4 w-4" />} tone="muted">
					<strong>You do not have warehouse access.</strong>{' '}
					{status.reason ?? 'Ask an operator to grant it.'} It is granted per
					person rather than given to everyone, because this is 1.7&nbsp;TB of
					production data.
					<br />
					<br />
					Asking FinData questions in chat is a <em>different</em> entitlement and
					needs no grant — it queries the same warehouse through a service
					credential, so it already works for you. This page is only for a direct
					SQL login. Being denied here does not mean you are locked out of the
					data.
				</Notice>
			)}

			{status.available && status.entitled && !status.role && (
				<Notice icon={<AlertTriangle className="h-4 w-4" />} tone="warn">
					<strong>You are entitled, but no warehouse role exists yet.</strong> An
					operator needs to provision one — this is a separate step from the
					grant, and not something you can do from here.
					<br />
					<br />
					There is no self-service path for this and no request button, because
					provisioning is an out-of-band script with no API — a button here would
					be pretending. What there is: the exact ask, ready to send.
					<button
						type="button"
						className="mt-2 block w-full rounded border px-3 py-2 text-left text-xs font-mono hover:bg-muted"
						onClick={() => copy('request', PROVISION_REQUEST)}
					>
						{copied === 'request'
							? 'Copied — send this to an operator'
							: PROVISION_REQUEST}
					</button>
				</Notice>
			)}

			{status.entitled && status.role && (
				<section className="space-y-4 rounded-lg border p-4">
					<Field label="Role" value={status.role} onCopy={copy} copied={copied} />
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Host" value={`${status.host}:${status.port}`} onCopy={copy} copied={copied} />
						<Field label="Database" value={status.database} onCopy={copy} copied={copied} />
					</div>

					<div className="flex items-center gap-2 text-sm">
						<Clock className="h-4 w-4 text-muted-foreground" />
						{status.credential_active ? (
							<span>
								Credential active —{' '}
								<strong>{relativeExpiry(status.credential_expires_at)}</strong>
							</span>
						) : (
							<span className="text-muted-foreground">
								No active credential. Minting one is what makes the role usable.
							</span>
						)}
					</div>

					<div className="flex flex-wrap gap-2">
						<Button onClick={() => void mint()} disabled={busy}>
							{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{status.credential_active ? 'Rotate credential' : 'Generate credential'}
						</Button>
						{status.credential_active && (
							<Button variant="outline" onClick={() => void revoke()} disabled={busy}>
								Revoke
							</Button>
						)}
					</div>

					<p className="text-xs text-muted-foreground">
						Credentials last {status.ttl_days} days, then stop working — rotate
						from here. Rotating replaces the old password immediately, so update
						any client that stored it.
					</p>
				</section>
			)}

			{minted && (
				<section className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-4">
					<h2 className="flex items-center gap-2 font-medium">
						<AlertTriangle className="h-4 w-4 text-amber-600" />
						Copy this now — it will not be shown again
					</h2>
					<Field label="Password" value={minted.password} mono onCopy={copy} copied={copied} />
					<Field label="Connection string" value={minted.dsn} mono onCopy={copy} copied={copied} />
					<p className="text-xs text-muted-foreground">{minted.note}</p>
				</section>
			)}

			{status.entitled && (
				<section className="space-y-2 rounded-lg border p-4 text-sm">
					<h2 className="font-medium">Connecting</h2>
					<pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
						{`curl -O ${status.ca_url}
psql "host=${status.host} port=${status.port} dbname=${status.database} \\
      user=${status.role ?? 'sql_<name>'} sslmode=${status.sslmode} \\
      sslrootcert=sql-ca.pem"`}
					</pre>
					<p className="text-xs text-muted-foreground">
						Use <code>sslmode=verify-full</code>, not <code>require</code>.{' '}
						<code>require</code> encrypts but authenticates nothing — it accepts
						any certificate, so it does not protect against an active
						machine-in-the-middle, which is the entire reason the CA is
						published.
					</p>
					<p className="text-xs text-muted-foreground">
						The connection is read-only and queries time out at two minutes. If
						a query you need is being cut off, say so rather than working around
						it — that is a sign the query wants an index or the REST API.
					</p>
					<p className="text-xs text-muted-foreground">
						<a href="/studio/docs/findata-sql" className="underline underline-offset-2">
							FinData SQL guide
						</a>{' '}
						— DBeaver and DuckDB setup, the schema tour, and why an unscoped{' '}
						<code>count(*)</code> on a hypertable times out.
					</p>
				</section>
			)}
		</div>
	);
}

function Notice({
	icon,
	tone,
	children,
}: {
	icon: React.ReactNode;
	tone: 'warn' | 'muted';
	children: React.ReactNode;
}) {
	return (
		<div
			className={`flex items-start gap-2 rounded-lg border p-4 text-sm ${
				tone === 'warn' ? 'border-amber-500/50 bg-amber-500/5' : 'bg-muted/40'
			}`}
		>
			<span className="mt-0.5 shrink-0">{icon}</span>
			<div>{children}</div>
		</div>
	);
}

function Field({
	label,
	value,
	mono,
	onCopy,
	copied,
}: {
	label: string;
	value: string;
	mono?: boolean;
	onCopy: (label: string, text: string) => void;
	copied: string | null;
}) {
	return (
		<div className="space-y-1">
			<div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
			<div className="flex items-center gap-2">
				<code className={`flex-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs ${mono ? 'font-mono' : ''}`}>
					{value}
				</code>
				<Button size="sm" variant="ghost" onClick={() => onCopy(label, value)}>
					{copied === label ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
				</Button>
			</div>
		</div>
	);
}
