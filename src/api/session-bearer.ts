// Mint a short-lived session-bearer (JWT) from the lm_session cookie.
//
// The session lives in an HttpOnly cookie, so JS can't read it to call
// cross-service endpoints that authenticate by `Authorization: Bearer`
// (e.g. xpcloud's /api/v1/repos + /api/v1/skills/catalog, which back the
// marketplace). GET /api/v1/session-bearer is cookie-authed and returns a
// short-lived JWT we can attach. Without it those endpoints answer
// anonymously and the caller's PRIVATE repos are filtered out.
//
// Cached + single-flight; refreshed a minute before the ~10-min expiry.

let cached: { token: string; exp: number } | null = null;
let inFlight: Promise<string | null> | null = null;

async function fetchBearer(): Promise<string | null> {
  try {
    const r = await fetch("/api/v1/session-bearer", { credentials: "same-origin" });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    const token: string | null = d?.data?.token ?? d?.token ?? null;
    if (token) cached = { token, exp: Date.now() + 9 * 60 * 1000 };
    return token;
  } catch {
    return null; // soft-fail — caller proceeds anonymously (public only)
  }
}

/** Returns a cached session-bearer, minting one if needed. null if unauthenticated. */
export async function getSessionBearer(): Promise<string | null> {
  if (cached && cached.exp > Date.now()) return cached.token;
  if (!inFlight) inFlight = fetchBearer().finally(() => { inFlight = null; });
  return inFlight;
}

/** Authorization header object for a session-bearer, or {} if none available. */
export async function bearerHeader(): Promise<Record<string, string>> {
  const t = await getSessionBearer();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
