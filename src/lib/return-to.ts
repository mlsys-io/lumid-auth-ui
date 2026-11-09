// Pure return_to rules, kept free of React so they can be unit-tested.

/** SPA surfaces reachable as a post-login destination.
 *
 * Every one of these is a path the landing nginx proxies to lumid-ui (see
 * `location /code|/status|/claude-sessions|/explore|/onboarding` in
 * deploy_infra/k8s-lift/nginx/lum-id-landing.conf) AND a route in App.tsx, so a
 * client-side Navigate to it lands on a working page.
 *
 * /code, /status and /claude-sessions were missing until 2026-11-09, and the
 * omission silently broke the sign-in round trip for them: nginx 302s a
 * logged-out visitor to `/auth/login?return_to=/code`, then AuthGuard found
 * `isSafeReturnTo('/code') === false` and fell through to `defaultLandingPath()`
 * — /studio. So /code never came back after login; it dumped the user on the
 * Studio home with no error and no way to tell it was a redirect rather than a
 * dead page. Verified in a browser: /code -> /auth/login?return_to=/code -> /studio.
 *
 * DELIBERATELY ABSENT:
 *  - `/quota`: nginx answers it with `301 /code`, so a client-side Navigate to it
 *    would loop between the two.
 *  - `/docs/…`: server-rendered markdown, not this SPA's route table.
 */
const SAFE_PATH_PREFIXES = [
	'/studio',
	'/app',
	'/dashboard',
	'/account',
	'/onboarding',
	'/code',
	'/status',
	'/claude-sessions',
	'/explore',
];

function isSafePath(p: string): boolean {
	return SAFE_PATH_PREFIXES.some((pre) => p === pre || p.startsWith(pre + '/') || p.startsWith(pre + '?'));
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
export function isSafeReturnTo(raw: string | null | undefined, origin?: string): raw is string {
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
			// `origin` is injectable so this branch is unit-testable: the suite runs
			// under bare Node with no `window`, where the in-browser comparison
			// would be unreachable and the absolute form silently untested.
			const self =
				origin !== undefined
					? origin
					: typeof window !== 'undefined'
						? window.location.origin
						: '';
			if (!self || u.origin !== self) return false;
			// Same-origin absolute — collapse to path for Navigate. Keep the
			// query and hash: /oauth/authorize is handled above, but an SPA
			// destination can legitimately carry state (?tab=views).
			return isSafePath(u.pathname) || u.pathname === '/';
		} catch {
			return false;
		}
	}
	// Plain paths — must start with a known safe prefix.
	return isSafePath(raw) || raw === '/';
}

/** A same-origin path served by the identity backend (not this SPA) that must be
 *  reached with a full page load, e.g. the OIDC authorize continuation. */
export function isOAuthContinuation(raw: string | null | undefined): boolean {
	return !!raw && (raw === '/oauth/authorize' || raw.startsWith('/oauth/authorize?'));
}

