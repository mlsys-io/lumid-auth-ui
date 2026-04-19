import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { googleLogin, ApiError } from '../../api';
import { useAuth } from '../../hooks/useAuth';
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

	useEffect(() => {
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

			// Verify state matches (CSRF protection)
			const storedState = sessionStorage.getItem('oauth_state');
			if (state !== storedState) {
				throw new Error('Invalid state parameter - possible CSRF attack');
			}

			// Clear stored state
			sessionStorage.removeItem('oauth_state');

			// Exchange code for session. The backend sets lm_session
			// as an HttpOnly cookie on .lum.id; the returned user_info
			// is what the AuthProvider caches in React state.
			const response = await googleLogin({ code, state });

			// Defensive — the backend may return either {user_info}
			// (lumid.market shape) or {user} (simpler shape). Accept
			// both so future cleanup doesn't break the UI.
			const u =
				(response as unknown as { user_info?: UserInfo }).user_info ||
				(response as unknown as { user?: UserInfo }).user;
			if (!u) {
				throw new Error('Missing user in Google login response');
			}

			login(response.token, u);
			setStatus('success');
			toast.success('Signed in with Google');

			// Honor ?return_to for SSO bounces; otherwise land on the
			// dashboard.
			const returnTo = urlParams.get('return_to');
			setTimeout(() => {
				if (returnTo && returnTo.startsWith('http')) {
					window.location.replace(returnTo);
				} else {
					navigate(returnTo || '/account');
				}
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

	// Invitation-code dialog was a QuantArena concern; lum.id lets any
	// Google-authed user through. Leaving the handler as a no-op for
	// back-compat with the dialog component's onSuccess prop.
	const handleInvitationCodeSuccess = (_token: string) => {
		setShowInvitationDialog(false);
	};
	// Silence unused-var warnings from the transitional state.
	void pendingUserInfo;
	void setPendingUserInfo;

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
							<Button onClick={() => navigate('/login')}>Back to Login</Button>
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
