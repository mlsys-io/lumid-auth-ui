import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { updateInvitationCode, ApiError } from '../../api';
import { useAuth } from '../../hooks/useAuth';
import { isSafeReturnTo, defaultLandingPath } from '../../components/auth-guard';

// Standalone page (not a dialog) so users who land here can't bypass
// it by closing a modal. AuthGuard force-redirects here whenever a
// non-admin authenticated user has an empty `invitation_code`.
export default function RedeemInvitePage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const { user, logout, refreshUser } = useAuth();

	const [code, setCode] = useState(() => {
		return (searchParams.get('code') || searchParams.get('invite') || '').trim();
	});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!code.trim()) {
			setError('Please enter an invitation code');
			return;
		}
		setLoading(true);
		setError('');
		try {
			await updateInvitationCode({ invitation_code: code.trim() });
			toast.success('Invitation code verified — welcome.');
			// Refetch /api/v1/user so AuthGuard sees the populated
			// invitation_code and lets us through.
			if (refreshUser) await refreshUser();
			const returnTo = searchParams.get('return_to');
			navigate(isSafeReturnTo(returnTo) ? returnTo : defaultLandingPath(user?.role), { replace: true });
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : 'Invalid invitation code.';
			setError(msg);
			toast.error(msg);
		} finally {
			setLoading(false);
		}
	};

	const handleLogout = async () => {
		// Escape hatch — let users sign out instead of being trapped.
		try {
			await logout();
		} finally {
			navigate('/auth/login', { replace: true });
		}
	};

	return (
		<div className="min-h-screen flex items-center justify-center bg-background p-4">
			<div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
				<h1 className="text-xl font-semibold mb-1">Enter your invitation code</h1>
				<p className="text-sm text-muted-foreground mb-3">
					Lumid is invite-only while we onboard the first wave of users. Your
					account is created and verified — this is the last step.
					{user?.email && (
						<> Signed in as <code className="text-xs">{user.email}</code>.</>
					)}
				</p>
				{/* Every user who lands here is BLOCKED: AuthGuard force-redirects any
				    non-admin with an empty invitation_code, so this page is the whole
				    product until a code is entered. It previously said only that Lumid
				    was invite-only, which states the rule without giving a next action
				    — and real accounts sat here for weeks with zero redemptions. Say
				    where a code comes from, and give a way to ask for one. */}
				<p className="text-sm text-muted-foreground mb-4">
					Your code comes from whoever invited you — if you joined as part of a
					cohort or a class, that is your organiser. It is <strong>not</strong>{' '}
					the 6-digit code that was emailed to you when you registered; that one
					verified your address and is already used.
				</p>
				<form onSubmit={submit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="invite-code">Invitation Code</Label>
						<Input
							id="invite-code"
							value={code}
							onChange={(e) => { setCode(e.target.value); setError(''); }}
							placeholder="e.g. a58605"
							disabled={loading}
							autoFocus
							aria-invalid={!!error}
						/>
						{error && (
							<div className="flex items-center gap-2 text-sm text-destructive" role="alert">
								<AlertCircle className="h-4 w-4" />
								<span>{error}</span>
							</div>
						)}
					</div>
					<Button type="submit" disabled={loading || !code.trim()} className="w-full">
						{loading ? (
							<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…</>
						) : 'Continue'}
					</Button>
				</form>
				<div className="mt-4 pt-4 border-t space-y-2 text-center">
					{/* The only other exit was "sign out", which does not get anyone a
					    code. hello@lum.id is the contact address the app already uses
					    (components/app-layout.tsx). Subject carries the signed-in
					    address so a request is actionable without a round trip. */}
					<a
						href={`mailto:hello@lum.id?subject=${encodeURIComponent(
							'Invitation code request',
						)}&body=${encodeURIComponent(
							`I registered${user?.email ? ` as ${user.email}` : ''} but do not have an invitation code.`,
						)}`}
						className="block text-xs text-muted-foreground hover:text-foreground"
					>
						Don't have a code? Ask for one
					</a>
					<button
						type="button"
						onClick={handleLogout}
						className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
					>
						<LogOut className="w-3 h-3" /> Sign out instead
					</button>
				</div>
			</div>
		</div>
	);
}
