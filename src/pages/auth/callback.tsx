import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { googleLogin, ApiError } from '../../api';
import { useAuth } from '../../hooks/useAuth';
import { isSafeReturnTo } from '../../components/auth-guard';
import { toast } from 'sonner';
import InvitationCodeDialog from './invitation-code-dialog';
import type { UserInfo } from '../../api';

export function AuthCallback() {
	const navigate = useNavigate();
	const { login } = useAuth();
	const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
	const [errorMessage, setErrorMessage] = useState<string>('');
	const [showInvitationDialog, setShowInvitationDialog] = useState(false);
	const [pendingUserInfo, setPendingUserInfo] = useState<UserInfo | null>(null);

	// Guard against double-invocation. React StrictMode in dev mounts
	// effects twice and a `code` param can only be exchanged once
	// (Google invalidates it after first use); without this guard the
	// second run tears through a now-empty sessionStorage and throws
	// "Invalid state — possible CSRF attack" even on a legit login.
	const ranRef = useRef(false);

	useEffect(() => {
		if (ranRef.current) return;
		ranRef.current = true;
		handleOAuthCallback();
	}, []);

	async function handleOAuthCallback() {
		try {
			// Extract code and state from URL
			const urlParams = new URLSearchParams(window.location.search);
			const code = urlParams.get('code');
			const state = urlParams.get('state');

			// Check for error from Google
			const error = urlParams.get('error');
			if (error) {
				throw new Error(`OAuth error: ${error}`);
			}

			if (!code || !state) {
				throw new Error('Missing code or state parameter');
			}

			// Verify state matches (CSRF protection). We DON'T clear the
			// stored state until the backend exchange succeeds — if the
			// exchange fails, a legit retry (user clicks "back to login"
			// → Google again) still has the value for the next round.
			const storedState = sessionStorage.getItem('oauth_state');
			if (state !== storedState) {
				throw new Error('Invalid state parameter - possible CSRF attack');
			}

			// Exchange code for session. The backend sets lm_session
			// as an HttpOnly cookie on .lum.id; the returned user_info
			// is what the AuthProvider caches in React state.
			const response = await googleLogin({ code, state });

			// Clear state after the exchange succeeded.
			sessionStorage.removeItem('oauth_state');

			// Defensive — the backend may return either {user_info}
			// (lumid.market shape) or {user} (simpler shape). Accept
			// both so future cleanup doesn't break the UI.
			const u =
				(response as unknown as { user_info?: UserInfo }).user_info ||
				(response as unknown as { user?: UserInfo }).user;
			if (!u) {
				throw new Error('Missing user in Google login response');
			}

			// Gate first-time Google sign-ins on a valid invitation code,
			// matching the email/password registration flow. When the
			// backend created the user fresh from this OAuth exchange,
			// `invitation_code` is empty — pop the dialog, defer the
			// React-side `login()` call, and let the dialog's success
			// callback finish the sign-in once the code is redeemed.
			//
			// The session cookie is *already* set on .lum.id by the
			// backend, so the `PUT /api/v1/user/invitation-code` request
			// the dialog issues authenticates via cookie. We just
			// haven't told the AuthProvider about the user yet.
			if (!u.invitation_code) {
				setPendingUserInfo(u);
				setShowInvitationDialog(true);
				// Stash the token so handleInvitationCodeSuccess can
				// fall back to it if the backend echoes a different one.
				sessionStorage.setItem('pending_oauth_token', response.token);
				return; // keep status=loading until the dialog resolves
			}

			login(response.token, u);
			setStatus('success');
			toast.success('Signed in with Google');

			// Honor ?return_to for SSO bounces, but only if it points
			// back at a safe lum.id path — see isSafeReturnTo in
			// auth-guard.tsx. External URLs fall through to /dashboard
			// so the OAuth callback can't be used as an open redirect.
			const returnTo = urlParams.get('return_to');
			setTimeout(() => {
				navigate(isSafeReturnTo(returnTo) ? returnTo : '/dashboard');
			}, 500);
		} catch (err) {
			console.error('OAuth callback error:', err);

			let message = 'Authentication failed';
			if (err instanceof ApiError) {
				message = err.message;
			} else if (err instanceof Error) {
				message = err.message;
			}

			setStatus('error');
			setErrorMessage(message);
			toast.error(message);
		}
	}

	const handleInvitationCodeSuccess = (token: string) => {
		// Dialog hands back the bearer it just authed against (today
		// the same session cookie value the OAuth exchange returned —
		// the backend doesn't re-mint on redeem since invitation_code
		// isn't a JWT claim). Fall back to the sessionStorage stash
		// if the backend ever stops echoing tokens.
		const finalToken =
			token || sessionStorage.getItem('pending_oauth_token') || '';
		sessionStorage.removeItem('pending_oauth_token');

		if (!pendingUserInfo) {
			setStatus('error');
			setErrorMessage('Failed to get user info');
			toast.error('Failed to get user info');
			return;
		}

		// Reflect the just-redeemed code in the cached user_info so
		// downstream consumers (auth-guard, profile page) see a
		// fully-onboarded user without an extra /api/v1/user round
		// trip. The backend's authoritative copy refreshes on the
		// next CurrentUserHandler call anyway.
		const refreshed: UserInfo = {
			...pendingUserInfo,
			invitation_code: 'redeemed',
		};
		login(finalToken, refreshed);
		setShowInvitationDialog(false);
		setStatus('success');
		toast.success('Signed in with Google');

		const params = new URLSearchParams(window.location.search);
		const returnTo = params.get('return_to');
		setTimeout(() => {
			navigate(isSafeReturnTo(returnTo) ? returnTo : '/dashboard');
		}, 500);
	};

	const renderContent = () => {
		switch (status) {
			case 'loading':
				return (
					<div className="text-center space-y-4">
						<div className="flex justify-center">
							<div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
								<RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
							</div>
						</div>
						<div>
							<h2 className="text-2xl font-bold mb-2">Authenticating...</h2>
							<p className="text-muted-foreground">Please wait while we verify your Google account.</p>
						</div>
					</div>
				);

			case 'success':
				return (
					<div className="text-center space-y-4">
						<div className="flex justify-center">
							<div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
								<CheckCircle className="w-8 h-8 text-green-600" />
							</div>
						</div>
						<div>
							<h2 className="text-2xl font-bold mb-2">Success!</h2>
							<p className="text-muted-foreground">Redirecting to your dashboard...</p>
						</div>
					</div>
				);

			case 'error':
				return (
					<div className="text-center space-y-4">
						<div className="flex justify-center">
							<div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
								<AlertCircle className="w-8 h-8 text-red-600" />
							</div>
						</div>
						<div>
							<h2 className="text-2xl font-bold mb-2">Authentication Error</h2>
							<p className="text-destructive mb-4">{errorMessage}</p>
							<Button onClick={() => navigate('/auth/login')}>Back to Login</Button>
						</div>
					</div>
				);

			default:
				return null;
		}
	};

	return (
		<>
			<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
				<div className="absolute inset-0 bg-grid-pattern opacity-5" />

				<Card className="w-full max-w-md mx-4 shadow-xl border-0 bg-white/80 backdrop-blur-sm">
					<CardHeader className="pb-4" />
					<CardContent className="pb-8">{renderContent()}</CardContent>
				</Card>
			</div>

			{/* Invitation Code Dialog */}
			<InvitationCodeDialog
				open={showInvitationDialog}
				onOpenChange={setShowInvitationDialog}
				onSuccess={handleInvitationCodeSuccess}
			/>
		</>
	);
}
