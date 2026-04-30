import axios, {
	type AxiosError,
	type AxiosInstance,
	type AxiosResponse,
	type InternalAxiosRequestConfig,
} from 'axios';
import type { ErrorResponse } from './types';

// Quant-arena API client for the lumid_ui port.
//
// The original client.ts (in quantarena/frontend) reads `access_token`
// from localStorage — set by the QA SSO callback at lumid.market.
// We can't use that here: lum.id's localStorage is a different origin
// from lumid.market's, and visitors may never have gone through the
// QA callback. Instead we follow the runmesh-port pattern: fetch a
// scoped session-bearer JWT from lum.id's `/api/v1/session-bearer`
// (cookie-authed against the .lum.id `lm_session`), and present it
// as `Authorization: Bearer …` to the QA backend.
//
// QA's `AuthMiddlewareIntrospect` already validates lum.id-issued
// JWTs (and lm_pat_*) by introspecting against lumid-identity, so no
// new server-side work is needed when AUTH_MODE=introspect is on
// (Phase 5 default).
//
// Base URL is `https://lumid.market/backend` — that's the path
// trading-nginx prefix-strips and forwards to the QA Go backend on
// :9988. Hitting `https://lumid.market/api/v1/…` directly would be
// served by the QA frontend SPA (which 405s on POST/OPTIONS). The
// existing QA frontend uses the same `/backend/` prefix, so the
// migrated pages keep their `/api/v1/…` URLs unchanged. Override via
// `VITE_LQA_API_URL` for local dev (e.g. http://localhost:9988).

const BASE_URL =
	(import.meta.env.VITE_LQA_API_URL as string | undefined) ||
	'https://lumid.market/backend';

export class ApiError extends Error {
	ret_code: number;
	response?: AxiosResponse;

	constructor(ret_code: number, message: string, response?: AxiosResponse) {
		super(message);
		this.name = 'ApiError';
		this.ret_code = ret_code;
		this.response = response;
	}
}

const apiClient: AxiosInstance = axios.create({
	baseURL: BASE_URL,
	timeout: 30000,
	headers: { 'Content-Type': 'application/json' },
	// Cookie path is supplementary — the bearer in the Authorization
	// header is what QA's middleware reads. Keep withCredentials so
	// any session-bearer endpoint that piggybacks on cookies works.
	// Pair with QA's CORS config:
	//   Access-Control-Allow-Credentials: true
	//   Access-Control-Allow-Origin: https://lum.id    (never *)
	withCredentials: true,
	paramsSerializer: { indexes: null },
});

// ─── session-bearer cache ──────────────────────────────────────────
//
// Same shape as runmesh's: one token per page-load, refreshed when
// within 60s of expiry or on 401. The session-bearer endpoint is on
// lum.id (same-origin from lumid_ui), so the request is plain
// withCredentials cookie auth — no chicken-and-egg.

let cachedBearer: { token: string; expires_at: number } | null = null;
let bearerInFlight: Promise<string | null> | null = null;

async function fetchBearer(): Promise<string | null> {
	try {
		const r = await axios.get<{ data: { token: string; expires_at: number } }>(
			'/api/v1/session-bearer?scope=user',
			{ withCredentials: true },
		);
		const d = r.data?.data;
		if (d?.token) {
			cachedBearer = { token: d.token, expires_at: d.expires_at };
			return d.token;
		}
	} catch {
		// Fall through; request goes without bearer, QA returns 401,
		// the page surfaces an unauthorized state and the AuthGuard
		// in lumid_ui kicks the user back to login.
	}
	return null;
}

async function getBearer(forceRefresh = false): Promise<string | null> {
	const now = Math.floor(Date.now() / 1000);
	if (
		!forceRefresh &&
		cachedBearer &&
		cachedBearer.expires_at - 60 > now
	) {
		return cachedBearer.token;
	}
	if (!bearerInFlight) {
		bearerInFlight = fetchBearer().finally(() => {
			bearerInFlight = null;
		});
	}
	return bearerInFlight;
}

apiClient.interceptors.request.use(
	async (config: InternalAxiosRequestConfig) => {
		const token = await getBearer();
		if (token && config.headers) {
			config.headers.Authorization = `Bearer ${token}`;
		}
		return config;
	},
	(error: AxiosError) => Promise.reject(error),
);

// Response interceptor — preserve the QA-codebase contract. The
// original throws ApiError for envelope-non-zero responses; keep that
// so the migrated pages compile verbatim.
apiClient.interceptors.response.use(
	(response: AxiosResponse) => {
		if (
			response.data &&
			typeof response.data === 'object' &&
			'ret_code' in response.data
		) {
			const { ret_code, message } = response.data as ErrorResponse;
			if (ret_code !== 0 && ret_code !== undefined) {
				throw new ApiError(ret_code, message ?? 'API error', response);
			}
		}
		return response;
	},
	async (error: AxiosError) => {
		// 401 → refresh the session-bearer once and retry. A stale
		// JWT can land us here even when the underlying lum.id session
		// is still alive.
		if (error.response?.status === 401 && cachedBearer) {
			cachedBearer = null;
			const fresh = await getBearer(true);
			if (fresh && error.config) {
				const cfg = error.config as InternalAxiosRequestConfig;
				cfg.headers = cfg.headers ?? ({} as never);
				(cfg.headers as Record<string, string>).Authorization = `Bearer ${fresh}`;
				return apiClient.request(cfg);
			}
		}
		const data = error.response?.data as ErrorResponse | undefined;
		if (data && typeof data === 'object') {
			throw new ApiError(
				data.ret_code ?? error.response?.status ?? 0,
				data.message ?? error.message,
				error.response,
			);
		}
		return Promise.reject(error);
	},
);

export default apiClient;
