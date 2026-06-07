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
				u.pathname.startsWith('/studio') ||
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
		raw.startsWith('/studio') ||
		raw.startsWith('/app') ||
		raw.startsWith('/dashboard') ||
		raw.startsWith('/account') ||
		raw.startsWith('/onboarding') ||
		raw === '/'
	);
}

/** Role-aware default landing path.
 *
 * The xp.io/go/* staging bundle (VITE_ROUTER_BASE_PATH=/go) is the new
 * web-first consumer surface. Everyone — including admins — lands on
 * /app there so the new UX gets dogfooded by the operators too. Admins
 * can still navigate to /dashboard manually for ops work.
 *
 * On the canonical lum.id bundle (no basename), regular users land on
 * /app and admins on /dashboard until the dedicated /admin/* shell ships.
 */
export function defaultLandingPath(role: string | null | undefined): string {
	const isGoBundle = !!import.meta.env.VITE_ROUTER_BASE_PATH;
	// Phase S5 — Studio is the canonical user surface. Regular users
	// land on /studio/intents (the renamed Today; shows the onboarding
	// nudge for fresh signups with no apps). Admins still get /dashboard
	// for now; Phase S4's /studio/admin is a parallel surface, not the
	// admin home yet. /go bundle stays on the composer (its raison
	// d'être) — the composer's Start button routes cross-domain to
	// lum.id/studio anyway.
	if (isGoBundle) return '/go-composer';
	// One entrance: everyone lands in Studio. Admins reach management via the
	// sidebar Management section / user-menu Admin link (now under /studio).
	return '/studio';
}

/**
 * OAuth `state` carries the CSRF nonce AND a same-origin `return_to` so the
 * post-login destination survives the Google round-trip — Google only echoes
 * the opaque `state` param, so anything we want back must ride inside it.
 * `return_to` is validated (isSafeReturnTo) before being packed; the callback
 * re-validates on the way out.
 */
export function encodeOAuthState(nonce: string, returnTo?: string | null): string {
	const r = returnTo && isSafeReturnTo(returnTo) ? returnTo : '';
	const json = JSON.stringify({ n: nonce, r });
	return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeOAuthState(raw: string): { nonce: string; returnTo: string } {
	try {
		const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
		const j = JSON.parse(atob(b64)) as { n?: string; r?: string };
		return { nonce: String(j.n || ''), returnTo: typeof j.r === 'string' ? j.r : '' };
	} catch {
		// Back-compat: a plain-hex state (pre-return_to) is treated as the nonce.
		return { nonce: raw, returnTo: '' };
	}
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
		// same-origin path; otherwise fall through to the role-aware
		// default (`/app` for regular users, `/dashboard` for admins)
		// so phishy external URLs can't use /auth/login as a bounce.
		const returnTo = new URLSearchParams(location.search).get('return_to');
		if (isSafeReturnTo(returnTo)) {
			return <Navigate to={returnTo} replace />;
		}
		return <Navigate to={defaultLandingPath(user?.role)} replace />;
	}

	return <>{children}</>;
}
