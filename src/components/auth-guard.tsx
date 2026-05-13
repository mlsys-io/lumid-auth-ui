import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import React from 'react';
import { Loading } from './ui/loading';

interface AuthGuardProps {
	children: React.ReactNode;
	requireAuth?: boolean;
}

/** Whitelist for ?return_to=... values.
 *
 * We previously allowed any `http(s)://` URL, which is an open-redirect
 * vector: an attacker can craft `/auth/login?return_to=https://evil/`
 * and use it in a phishing link. Only same-origin *paths* under our
 * known product surfaces are honored; external URLs and
 * protocol-relative (`//evil.com`) URLs are rejected.
 *
 * Kept loose enough for legitimate cross-domain bounces via
 * `window.location.replace` back to lum.id's own subpaths — but not to
 * any arbitrary host. Export so `pages/auth/callback.tsx` can share
 * the exact same check.
 */
export function isSafeReturnTo(raw: string | null | undefined): raw is string {
	if (!raw) return false;
	// Reject protocol-relative URLs that browsers treat as absolute.
	if (raw.startsWith('//')) return false;
	// Reject fully-qualified URLs to any origin other than our own.
	if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
		try {
			const u = new URL(raw);
			if (u.origin !== window.location.origin) return false;
			// Same-origin absolute — collapse to path for Navigate.
			return (
				u.pathname.startsWith('/app') ||
				u.pathname.startsWith('/dashboard') ||
				u.pathname.startsWith('/account') ||
				u.pathname === '/'
			);
		} catch {
			return false;
		}
	}
	// Plain paths — must start with a known safe prefix.
	return (
		raw.startsWith('/app') ||
		raw.startsWith('/dashboard') ||
		raw.startsWith('/account') ||
		raw === '/'
	);
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
	const { isLoading, isAuthenticated, user } = useAuth();
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

	// Bypass-proof invitation-code gate. The OAuth callback pops a
	// dialog when `invitation_code` is empty, but the backend has
	// already set the session cookie — so cancelling the dialog and
	// going back to lum.id used to slip the user past with no code.
	// Now any authenticated session with empty `invitation_code` gets
	// force-redirected to /auth/redeem-invite. Admins are exempt to
	// avoid bricking the bootstrap admin.
	if (
		requireAuth &&
		isAuthenticated &&
		user &&
		!user.invitation_code &&
		user.role !== 'admin' &&
		user.role !== 'super_admin' &&
		location.pathname !== '/auth/redeem-invite'
	) {
		const here = location.pathname + location.search;
		return (
			<Navigate
				to={`/auth/redeem-invite?return_to=${encodeURIComponent(here)}`}
				replace
			/>
		);
	}

	if (!requireAuth && isAuthenticated) {
		// Post-login landing. Only honor `return_to` if it's a safe
		// same-origin path; otherwise fall through to /dashboard so
		// phishy external URLs can't use /auth/login as a bounce.
		const returnTo = new URLSearchParams(location.search).get('return_to');
		if (isSafeReturnTo(returnTo)) {
			return <Navigate to={returnTo} replace />;
		}
		return <Navigate to="/dashboard" replace />;
	}

	return <>{children}</>;
}
