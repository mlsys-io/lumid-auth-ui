// /dashboard/account/connect/microsoft — Microsoft Graph OAuth
// via device-code. Uses Microsoft's pre-registered Graph PowerShell
// SDK public client (no Azure AD app registration in your tenant).
//
// Flow:
//   1. Click Connect → POST /api/v1/oauth/microsoft/connect/init
//      → backend asks Microsoft for a device_code; we show the
//      user_code + verification URL.
//   2. User opens that URL in a new tab, completes corporate sign-in
//      + consent.
//   3. Page polls POST /api/v1/oauth/microsoft/connect/poll every
//      `interval_seconds`. Status flips to "connected" when the
//      user finishes; we surface the resolved userPrincipalName +
//      scopes + granted timestamp.
//
// Disconnect calls DELETE /api/v1/identity/microsoft-token. The
// refresh-token is wiped from microsoft_grants; the user can re-
// connect anytime by repeating step 1.

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import apiClient from '../../api/client';

interface GrantStatus {
	state: 'not_connected' | 'connected' | 'revoked';
	user_principal_name?: string;
	display_name?: string;
	scopes?: string;
	granted_at?: string;
	last_used_at?: string | null;
	revoked_at?: string | null;
}

interface PendingFlow {
	user_code: string;
	verification_uri: string;
	interval_seconds: number;
	expires_at: string;
	message?: string;
}

export default function ConnectMicrosoftPage() {
	const [grant, setGrant] = useState<GrantStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [pending, setPending] = useState<PendingFlow | null>(null);
	const [pollStatus, setPollStatus] = useState<string>('');
	const pollTimerRef = useRef<number | null>(null);
	const [copied, setCopied] = useState(false);

	const loadGrant = async () => {
		try {
			const r = await apiClient.get('/api/v1/identity/microsoft-grants');
			setGrant(r.data?.data || { state: 'not_connected' });
		} catch {
			setGrant({ state: 'not_connected' });
		}
	};
	useEffect(() => { loadGrant(); }, []);

	// Cleanup any in-flight polling when the page unmounts.
	useEffect(() => {
		return () => {
			if (pollTimerRef.current != null) window.clearTimeout(pollTimerRef.current);
		};
	}, []);

	const startConnect = async () => {
		setBusy(true);
		setPollStatus('');
		try {
			const r = await apiClient.post('/api/v1/oauth/microsoft/connect/init', {});
			const p = r.data?.data as PendingFlow | undefined;
			if (!p?.user_code) throw new Error('No device_code returned');
			setPending(p);
			beginPolling(p.interval_seconds * 1000);
		} catch (e: any) {
			toast.error(e?.response?.data?.message || e?.message || 'Failed to start connect');
		} finally {
			setBusy(false);
		}
	};

	const beginPolling = (intervalMs: number) => {
		const tick = async () => {
			try {
				const r = await apiClient.post('/api/v1/oauth/microsoft/connect/poll', {});
				const data = r.data?.data || {};
				const status = data.status as string;
				setPollStatus(status);
				if (status === 'connected') {
					toast.success('Microsoft connected');
					setPending(null);
					await loadGrant();
					return; // stop polling
				}
				if (status === 'denied') {
					toast.error('Consent declined');
					setPending(null);
					return;
				}
				if (status === 'expired') {
					toast.error('Device code expired — restart');
					setPending(null);
					return;
				}
				if (status === 'error') {
					toast.error(data.error || 'Connect failed');
					setPending(null);
					return;
				}
				// pending / slow_down — keep polling
				pollTimerRef.current = window.setTimeout(tick, intervalMs);
			} catch (e: any) {
				toast.error(e?.response?.data?.message || e?.message || 'Poll failed');
				setPending(null);
			}
		};
		// First poll after one interval; Microsoft asks us not to hammer.
		pollTimerRef.current = window.setTimeout(tick, intervalMs);
	};

	const cancel = () => {
		if (pollTimerRef.current != null) window.clearTimeout(pollTimerRef.current);
		setPending(null);
		setPollStatus('');
	};

	const disconnect = async () => {
		setBusy(true);
		try {
			await apiClient.delete('/api/v1/identity/microsoft-token');
			toast.success('Disconnected');
			await loadGrant();
		} catch (e: any) {
			toast.error(e?.response?.data?.message || 'Failed to disconnect');
		} finally {
			setBusy(false);
		}
	};

	const copyCode = async () => {
		if (!pending?.user_code) return;
		try {
			await navigator.clipboard.writeText(pending.user_code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch { /* ignore */ }
	};

	return (
		<div className="max-w-2xl mx-auto p-6 space-y-6">
			<div>
				<div className="text-xs font-medium text-indigo-500 uppercase tracking-widest">
					Microsoft 365 · Outlook + Calendar
				</div>
				<h1 className="text-3xl font-bold mt-1">Connect Outlook + Calendar</h1>
				<p className="text-sm text-muted-foreground mt-2">
					Connects your Microsoft 365 (Outlook + Calendar) to Lumid via Microsoft Graph using
					Microsoft&apos;s pre-registered Graph PowerShell SDK client. <strong>No Azure AD app
					registration in your tenant</strong> — per-user delegated consent only, the same flow
					your IT lets you use for any Microsoft-published app.
				</p>
				<p className="text-xs text-muted-foreground mt-2 leading-relaxed">
					This is the path that survives corporate tenant policies blocking custom app
					registration AND SAS-token HTTP triggers (the Power Automate failure mode). If your
					tenant requires admin approval even for Microsoft-published apps, you&apos;ll see a
					&ldquo;Need admin approval&rdquo; screen at consent time — that&apos;s the only wall
					left, and asking IT to whitelist just <code>Microsoft Graph PowerShell</code> is much
					smaller than asking them to approve a custom Lumid app.
				</p>
			</div>

			{/* Current state */}
			{grant === null ? (
				<div className="text-sm text-muted-foreground italic">Loading…</div>
			) : grant.state === 'connected' ? (
				<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-1">
					<div className="font-medium text-emerald-700">✓ Connected</div>
					<div className="text-sm text-muted-foreground">
						{grant.display_name || grant.user_principal_name}
						{grant.user_principal_name && grant.display_name && (
							<> · <code className="text-xs">{grant.user_principal_name}</code></>
						)}
					</div>
					{grant.scopes && (
						<div className="text-xs text-muted-foreground">
							Scopes: <code>{grant.scopes}</code>
						</div>
					)}
					<div className="text-xs text-muted-foreground">
						Granted {fmt(grant.granted_at)}
						{grant.last_used_at && <> · last used {fmt(grant.last_used_at)}</>}
					</div>
				</div>
			) : grant.state === 'revoked' ? (
				<div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
					Previously connected but revoked. Reconnect to enable.
				</div>
			) : (
				<div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
					Not connected yet.
				</div>
			)}

			{/* Device-code prompt — shown only while a flow is in flight */}
			{pending && (
				<div className="rounded-lg border-2 border-emerald-400/60 bg-emerald-50/40 p-5 space-y-3">
					<div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
						Step 1 · Authenticate at Microsoft
					</div>
					<ol className="text-sm space-y-2 list-decimal pl-5">
						<li>
							Open{' '}
							<a
								href={pending.verification_uri}
								target="_blank"
								rel="noreferrer"
								className="text-emerald-700 hover:underline font-medium"
							>
								{pending.verification_uri}
							</a>
							{' '}in a new tab
						</li>
						<li>
							Enter this code:{' '}
							<button
								onClick={copyCode}
								className="font-mono font-bold text-lg bg-white border border-emerald-300 rounded px-3 py-1 hover:bg-emerald-50 transition-colors"
							>
								{pending.user_code}
							</button>
							{copied && <span className="ml-2 text-xs text-emerald-700">copied</span>}
						</li>
						<li>Complete your normal corporate sign-in (MFA + Conditional Access apply)</li>
						<li>Click <strong>Accept</strong> on the Microsoft Graph PowerShell consent screen</li>
					</ol>
					<div className="flex items-center gap-3 pt-2 border-t border-emerald-200">
						<div className="text-xs text-muted-foreground flex-1">
							{pollStatus === 'pending' || pollStatus === '' ? (
								<>Waiting for you to finish at Microsoft…</>
							) : (
								<>Status: {pollStatus}</>
							)}
						</div>
						<Button variant="outline" size="sm" onClick={cancel}>Cancel</Button>
					</div>
				</div>
			)}

			{/* Actions */}
			{!pending && (
				<div className="rounded-lg border bg-card p-6 space-y-3">
					<h2 className="font-semibold">Scopes requested</h2>
					<ul className="text-sm text-muted-foreground space-y-1">
						<li><code>Mail.ReadWrite</code> — read inbox, draft replies, change folders</li>
						<li><code>Mail.Send</code> — send mail through your Outlook account</li>
						<li><code>Calendars.ReadWrite</code> — read events, propose / book meetings</li>
						<li><code>User.Read</code> — your profile (display name, principal name)</li>
						<li><code>offline_access</code> — refresh token so the bridge keeps working</li>
					</ul>
					<div className="flex gap-2 pt-2">
						{grant?.state === 'connected' ? (
							<>
								<Button onClick={startConnect} disabled={busy}>Re-consent</Button>
								<Button variant="outline" onClick={disconnect} disabled={busy}>Disconnect</Button>
							</>
						) : (
							<Button onClick={startConnect} disabled={busy}>Connect Microsoft</Button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function fmt(s?: string | null): string {
	if (!s) return 'never';
	try { return new Date(s).toLocaleString(); } catch { return s; }
}
