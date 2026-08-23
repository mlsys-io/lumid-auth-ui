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

// Audiences are cached SEPARATELY. A bearer carries `aud`, and every consumer
// verifies it (lqt-auth requires aud="lqt"; runmesh requires "runmesh"), so
// handing one audience's token to another service is a 401, not a fallback.
// One shared cache slot would do exactly that the moment two surfaces are open
// in the same tab.
type Audience = "runmesh" | "flowmesh" | "lqt";
const DEFAULT_AUD: Audience = "runmesh";

const cached: Partial<Record<Audience, { token: string; exp: number }>> = {};
const inFlight: Partial<Record<Audience, Promise<string | null>>> = {};

async function fetchBearer(aud: Audience): Promise<string | null> {
  try {
    // The default audience is requested WITHOUT the query param, preserving the
    // exact request the server has always seen for it.
    const qs = aud === DEFAULT_AUD ? "" : `?audience=${encodeURIComponent(aud)}`;
    const r = await fetch(`/api/v1/session-bearer${qs}`, { credentials: "same-origin" });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    const token: string | null = d?.data?.token ?? d?.token ?? null;
    if (token) cached[aud] = { token, exp: Date.now() + 9 * 60 * 1000 };
    return token;
  } catch {
    return null; // soft-fail — caller proceeds anonymously (public only)
  }
}

/** Returns a cached session-bearer, minting one if needed. null if unauthenticated. */
export async function getSessionBearer(aud: Audience = DEFAULT_AUD): Promise<string | null> {
  const hit = cached[aud];
  if (hit && hit.exp > Date.now()) return hit.token;
  if (!inFlight[aud]) {
    inFlight[aud] = fetchBearer(aud).finally(() => { delete inFlight[aud]; });
  }
  return inFlight[aud]!;
}

/** Authorization header object for a session-bearer, or {} if none available. */
export async function bearerHeader(aud: Audience = DEFAULT_AUD): Promise<Record<string, string>> {
  const t = await getSessionBearer(aud);
  return t ? { Authorization: `Bearer ${t}` } : {};
}
