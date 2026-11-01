// Pure return_to rules, kept free of React so they can be unit-tested.

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
	// The OIDC authorize endpoint on THIS origin: lum.id bounces logged-out users of
	// every OAuth client (runmesh.ai, xp.io, lumid.market, Argo CD, Harbor…) to
	// /auth/login?return_to=/oauth/authorize?… — and the authorize handler only ever
	// redirects to a redirect_uri on that client's server-side allowlist, so this is
	// not an open redirect. Without it, signing in to a client stranded the user in
	// /studio and the client never got its code.
	if (isOAuthContinuation(raw)) return true;
	// Reject protocol-relative URLs that browsers treat as absolute.
	if (raw.startsWith('//')) return false;
	// Reject fully-qualified URLs to any origin other than our own.
	if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
		try {
			const u = new URL(raw);
			if (typeof window === 'undefined' || u.origin !== window.location.origin) return false;
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

/** A same-origin path served by the identity backend (not this SPA) that must be
 *  reached with a full page load, e.g. the OIDC authorize continuation. */
export function isOAuthContinuation(raw: string | null | undefined): boolean {
	return !!raw && (raw === '/oauth/authorize' || raw.startsWith('/oauth/authorize?'));
}

