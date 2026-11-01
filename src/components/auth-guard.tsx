import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import React from 'react';
import BrandLoader from './BrandLoader';
import { isOAuthContinuation, isSafeReturnTo } from '../lib/return-to';

// Re-exported: callback.tsx, redeem-invite.tsx and connect-google.tsx import them from here.
export { isOAuthContinuation, isSafeReturnTo };

interface AuthGuardProps {
	children: React.ReactNode;
	requireAuth?: boolean;
}

/** Go to a vetted return_to. Server paths need a real navigation; SPA paths don't. */
export function goReturnTo(raw: string, navigate: (to: string, opts?: { replace?: boolean }) => void) {
	if (isOAuthContinuation(raw)) {
		window.location.replace(raw);
		return;
	}
	navigate(raw, { replace: true });
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
		return <BrandLoader />;
	}

	if (requireAuth && !isAuthenticated) {
		// Preserve the original destination so /auth/login can send the
		// user back after sign-in via ?return_to=<current>.
		const here = location.pathname + location.search;
		return <Navigate to={`/auth/login?return_to=${encodeURIComponent(here)}`} replace />;
	}

	// Registration is open (2026-11-01): an empty invitation_code no longer
	// forces /auth/redeem-invite. The page stays reachable for cohort codes,
	// which still grant their scopes when redeemed.

	if (!requireAuth && isAuthenticated) {
		// Post-login landing. Only honor `return_to` if it's a safe
		// same-origin path; otherwise fall through to the role-aware
		// default (`/app` for regular users, `/dashboard` for admins)
		// so phishy external URLs can't use /auth/login as a bounce.
		const returnTo = new URLSearchParams(location.search).get('return_to');
		if (isOAuthContinuation(returnTo)) {
			// Served by identity, not the SPA: a <Navigate> would stay client-side.
			window.location.replace(returnTo!);
			return <BrandLoader />;
		}
		if (isSafeReturnTo(returnTo)) {
			return <Navigate to={returnTo} replace />;
		}
		return <Navigate to={defaultLandingPath(user?.role)} replace />;
	}

	return <>{children}</>;
}
