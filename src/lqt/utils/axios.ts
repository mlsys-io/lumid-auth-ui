/**
 * Slim axios instance for the LQT gateway.
 *
 * Mirrors `lumid_ui/src/runmesh/utils/axios.ts`. The browser is on
 * `lum.id`; the gateway is on a different machine at
 * `<LQT_API_GATEWAY_URL>`. Cross-domain. The `lm_session` cookie is
 * `Domain=.lum.id` and cannot cross the boundary — so we authenticate
 * by fetching a short-lived scoped session-bearer JWT from lum.id
 * (same-origin) and forwarding it as `Authorization: Bearer` to the
 * gateway (cross-origin).
 *
 * Cache discipline:
 *  - one 10-min JWT per browser session, cached in-memory only
 *  - refreshed 60s before expiry
 *  - single-flight: concurrent callers share the same in-flight
 *    refresh promise
 *
 * On gateway 401, the cached token is invalidated and a single retry
 * is attempted with a freshly-minted JWT. If that 401s again, the
 * error is surfaced — the caller is responsible for routing to the
 * login page.
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

// `import.meta.env` is Vite's compile-time env. The placeholder
// `https://lqt.lum.id` is operator-overridden at deploy time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ENV = ((import.meta as any)?.env ?? {}) as Record<string, string | undefined>;
// SAME-ORIGIN by default. The status page hits lum.id/lqt/* which the landing
// nginx proxies to the in-cluster `lqt` read service, injecting the read-scoped
// service PAT server-side (mirrors the /findata-cloud findata-token.conf pattern).
// So the browser sends NO Authorization header and no cross-domain hop — the old
// `https://lqt.lum.id` default was an unrouted domain (network error). An operator
// can still override to an absolute gateway URL via VITE_LQT_API_GATEWAY_URL.
const LQT_API_GATEWAY_URL: string =
  ENV.VITE_LQT_API_GATEWAY_URL ?? '';

/**
 * Cached scoped session-bearer. `null` means uncached or expired.
 * Concurrent callers share the in-flight refresh via `inflight`.
 */
interface BearerCache {
  token: string;
  /** Unix-millis when the gateway will start rejecting this token. */
  expires_at_ms: number;
}

let cached: BearerCache | null = null;
let inflight: Promise<BearerCache> | null = null;

/** Refresh window — fetch a new token this many ms before expiry. */
const REFRESH_LEAD_MS = 60_000;

/** Default TTL the lum.id endpoint mints (10 min). */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * Typed error surfaced by the gateway request layer. Preserves the
 * original axios error in `cause` so callers can drill down.
 */
export class LqtGatewayError extends Error {
  status: number | undefined;
  body: unknown;
  cause: unknown;

  constructor(message: string, opts: { status?: number; body?: unknown; cause?: unknown } = {}) {
    super(message);
    this.name = 'LqtGatewayError';
    this.status = opts.status;
    this.body = opts.body;
    this.cause = opts.cause;
  }
}

/**
 * Fetch (or refresh) the scoped session-bearer. Same-origin to
 * lum.id; `withCredentials: true` is load-bearing because the
 * `lm_session` cookie is what authenticates the request.
 */
async function fetchSessionBearer(): Promise<BearerCache> {
  const res = await axios.get<{ token: string; expires_in?: number }>(
    '/api/v1/session-bearer',
    {
      withCredentials: true,
      // We POST `aud=lqt` via query so the lum.id mint helper
      // returns a JWT scoped for the LQT gateway. The lum.id
      // session-bearer endpoint accepts either `aud=` query or a
      // header; we use the query form so it's visible in browser
      // network logs during debugging.
      params: { aud: 'lqt' },
      // Don't pin a base URL — we want this to hit the same origin
      // the browser is currently on (lum.id).
      baseURL: '',
    },
  );
  const ttlMs = (res.data.expires_in ?? DEFAULT_TTL_MS / 1000) * 1000;
  return {
    token: res.data.token,
    expires_at_ms: Date.now() + ttlMs,
  };
}

/** Returns a fresh-enough cached token, refreshing if needed. */
async function getBearer(): Promise<BearerCache> {
  const now = Date.now();
  if (cached && cached.expires_at_ms - REFRESH_LEAD_MS > now) {
    return cached;
  }
  if (inflight) {
    return inflight;
  }
  inflight = fetchSessionBearer()
    .then((c) => {
      cached = c;
      return c;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Invalidate the cached token (used on 401 retry). */
export function invalidateBearerCache(): void {
  cached = null;
}

/**
 * Singleton axios instance pre-configured for the LQT gateway.
 *
 * `withCredentials: false` is intentional — the gateway is on a
 * different domain and we don't want cookies to flow. Auth is
 * carried purely by the `Authorization: Bearer` header.
 */
export const lqtAxios: AxiosInstance = axios.create({
  baseURL: LQT_API_GATEWAY_URL,
  withCredentials: false,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — SAME-ORIGIN mode: attach NO Authorization header. The
// landing nginx (/lqt/ location) injects the read-scoped service PAT server-side
// only when the caller presents no bearer (findata-token.conf precedence), so
// sending anything here would OVERRIDE that injection and get rejected. The old
// cross-domain session-bearer machinery (getBearer/fetchSessionBearer) is retained
// below as dead code for the future absolute-gateway path but is intentionally
// not wired.
lqtAxios.interceptors.request.use((config: InternalAxiosRequestConfig) => config);

// Response interceptor — single-shot 401 retry with a fresh token.
lqtAxios.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    // SAME-ORIGIN mode: no bearer to refresh — the nginx /lqt/ proxy owns auth.
    // Surface the status verbatim so the page can show a clear error.
    if (err.response) {
      throw new LqtGatewayError(`gateway_${err.response.status}`, {
        status: err.response.status,
        body: err.response.data,
        cause: err,
      });
    }
    throw new LqtGatewayError('gateway_network_error', { cause: err });
  },
);

/** Convenience GET helper that returns parsed JSON. */
export async function getJson<T>(
  path: string,
  params?: Record<string, unknown>,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await lqtAxios.get<T>(path, { params, ...(config ?? {}) });
  return res.data;
}

/** Convenience POST helper. Reserved for Phase 2 write surfaces. */
export async function postJson<T, B = unknown>(
  path: string,
  body: B,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await lqtAxios.post<T>(path, body, config);
  return res.data;
}

/** Currently-resolved gateway base URL. Surfaced for debug panels. */
export function lqtGatewayBaseUrl(): string {
  return LQT_API_GATEWAY_URL;
}

export default lqtAxios;
