import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import apiClient from '../../api/client';
import { isSafeReturnTo } from '../../components/auth-guard';

/**
 * /dashboard/account/connect/google — one-click Google scope grant
 * for the personal-agent xpio app and any future scope-needing app.
 *
 * The lumid Google OAuth client is the same one used for
 * Sign-in-with-Lumid; this page only escalates the scopes by passing
 * gmail.modify + calendar to /api/v1/oauth/google/connect/init. The
 * backend stores the resulting refresh-token encrypted in
 * lumid_identity.google_grants and the personal-agent CLI fetches it
 * via /api/v1/identity/google-token.
 *
 * Status query-string contract (set by the callback handler):
 *   ?google_status=connected         — happy path
 *   ?google_status=denied&detail=…   — user clicked Cancel on Google
 *   ?google_status=already_connected — re-consent without new RT issued
 *   ?google_status=invalid           — code/state missing
 *   ?google_status=unknown_user      — state didn't match any user
 *   ?google_status=server_misconfigured — env vars unset
 *   ?google_status=exchange_failed   — Google token endpoint rejected
 *   ?google_status=encrypt_failed    — IDENTITY_GRANT_KEY broken
 */
export default function ConnectGooglePage() {
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);

	const status = params.get('google_status');
	const detail = params.get('detail') || '';
	const returnTo = params.get('return_to');

	const banner = useMemo(() => statusToBanner(status, detail), [status, detail]);

	useEffect(() => {
		if (status === 'connected') {
			toast.success('Gmail + Calendar connected');
			// Bounce back to the launching page (e.g. a Studio surface) after
			// briefly showing the success banner. return_to was server-validated
			// before being appended to the callback redirect.
			if (isSafeReturnTo(returnTo)) {
				const t = setTimeout(() => navigate(returnTo), 1200);
				return () => clearTimeout(t);
			}
		} else if (status && status !== 'invalid') {
			toast.error(`Google connect: ${status}`);
		}
	}, [status, returnTo, navigate]);

	async function startConnect() {
		setBusy(true);
		try {
			// Carry the page we were launched from (or fall back to Studio) so
			// the post-consent redirect returns there instead of stranding the
			// user on this connect page.
			const rt = isSafeReturnTo(returnTo) ? returnTo : '/studio';
			const r = await apiClient.post('/api/v1/oauth/google/connect/init', { return_to: rt });
			const url = (r.data?.data as { authorize_url?: string } | undefined)?.authorize_url;
			if (!url) throw new Error('No authorize_url returned');
			window.location.href = url;
		} catch (e) {
			setBusy(false);
			toast.error((e as Error)?.message || 'Failed to start Google connect');
		}
	}

	async function revoke() {
		setBusy(true);
		try {
			await apiClient.delete('/api/v1/identity/google-token');
			toast.success('Google grant revoked');
		} catch (e) {
			toast.error((e as Error)?.message || 'Failed to revoke');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="max-w-2xl mx-auto p-6 space-y-6">
			<div>
				<div className="text-xs font-medium text-indigo-500 uppercase tracking-widest">
					Personal Agent · OAuth Grants
				</div>
				<h1 className="text-3xl font-bold mt-1">Connect Gmail + Calendar</h1>
				<p className="text-sm text-muted-foreground mt-2">
					Lets the <code>personal-agent</code> xpio app draft email replies in your voice and propose
					calendar slots from your work-hours preferences. The grant is stored encrypted on lum.id;
					the access-token never touches your code, and the refresh-token only flows to your local
					machine via <code>/lumid app personal-agent setup</code>. Revoke any time below.
				</p>
			</div>

			{banner ? <div className={banner.cls}>{banner.text}</div> : null}

			<div className="rounded-lg border bg-card p-6 space-y-4">
				<div>
					<h2 className="font-semibold">Scopes requested</h2>
					<ul className="text-sm text-muted-foreground mt-2 space-y-1">
						<li>
							<code>gmail.modify</code> — read messages, draft replies, change labels (no permanent delete)
						</li>
						<li>
							<code>calendar</code> — read events, propose / book meeting slots
						</li>
						<li>
							<code>openid email profile</code> — used for Sign-in-with-Lumid (already granted)
						</li>
					</ul>
				</div>
				<div className="flex gap-3">
					<Button onClick={startConnect} disabled={busy}>
						Connect Gmail + Calendar
					</Button>
					<Button variant="outline" onClick={revoke} disabled={busy}>
						Revoke
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					After clicking <i>Connect</i>, you'll be redirected to Google's consent screen. Once you
					approve, you'll land back here and can return to your terminal where{' '}
					<code>setup</code> is polling for the token.
				</p>
			</div>
		</div>
	);
}

function statusToBanner(status: string | null, detail: string) {
	if (!status) return null;
	const map: Record<string, { text: string; cls: string }> = {
		connected: { text: '✓ Connected — return to your terminal.', cls: bannerOk },
		already_connected: {
			text: 'Already connected. If you need to refresh the token, revoke and reconnect.',
			cls: bannerInfo,
		},
		denied: { text: `Google denied the request${detail ? ': ' + detail : ''}.`, cls: bannerError },
		invalid: { text: 'Invalid callback (missing code/state).', cls: bannerError },
		unknown_user: { text: 'Could not identify your session — try Sign-in-with-Lumid first.', cls: bannerError },
		server_misconfigured: {
			text: 'Server-side: GOOGLE_CLIENT_ID/SECRET not set on lumid-identity.',
			cls: bannerError,
		},
		exchange_failed: { text: 'Google token exchange failed.', cls: bannerError },
		encrypt_failed: { text: 'IDENTITY_GRANT_KEY misconfigured on lumid-identity.', cls: bannerError },
	};
	return map[status] || null;
}

const bannerOk = 'rounded-md border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm';
const bannerInfo = 'rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm';
const bannerError = 'rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm';
