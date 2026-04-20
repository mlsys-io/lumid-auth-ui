import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import React from 'react';
import { Loading } from './ui/loading';

interface AuthGuardProps {
	children: React.ReactNode;
	requireAuth?: boolean;
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
	const { isLoading, isAuthenticated } = useAuth();
	const location = useLocation();

	if (isLoading) {
		return <Loading fullScreen />;
	}

	if (requireAuth && !isAuthenticated) {
		// Preserve the original destination so /auth/login can send the
		// user back after sign-in via ?return_to=<current>.
		const here = location.pathname + location.search;
		return <Navigate to={`/auth/login?return_to=${encodeURIComponent(here)}`} replace />;
	}

	if (!requireAuth && isAuthenticated) {
		// Post-login landing. If the user arrived via ?return_to=... or
		// ?return_to=/absolute/URL (e.g. an OIDC authorize bounce), honor
		// that. Otherwise drop them in the account hub. We intentionally
		// don't default to `/strategy` — that page lives on
		// market.lum.id, not on the auth UI.
		const returnTo = new URLSearchParams(location.search).get('return_to');
		if (returnTo) {
			// Path-starting return_to goes through React Router; anything
			// absolute (http[s]://) triggers a hard nav so we escape the
			// /auth basename.
			if (returnTo.startsWith('http')) {
				window.location.replace(returnTo);
				return <Loading fullScreen />;
			}
			return <Navigate to={returnTo} replace />;
		}
		return <Navigate to="/dashboard" replace />;
	}

	return <>{children}</>;
}
