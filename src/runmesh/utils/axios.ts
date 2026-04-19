import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';

// Slim axios client dedicated to the ported Runmesh admin pages.
// Replaces the original Runmesh util axios.ts wholesale — we don't
// need the Sa-Token interceptor, AES body encryption, or auto-logout
// here. A lum.id admin session (`lm_session` cookie on `.lum.id`)
// rides along automatically via withCredentials, and Runmesh's
// backend introspects it through lumid-identity.
//
// Base URL defaults to the current origin's Runmesh deployment at
// `https://runmesh.ai`. Override via VITE_RUNMESH_API_URL for local
// dev (e.g. `http://localhost:8081`) without a rebuild.

const BASE_URL =
	(import.meta.env.VITE_RUNMESH_API_URL as string | undefined) ||
	'https://runmesh.ai';

export interface ApiResponse<T> {
	code: number;
	data: T;
	message?: string;
	msg?: string;
	traceId?: string;
}

export interface ExtendedAxiosRequestConfig extends AxiosRequestConfig {
	// The ported Runmesh pages sometimes pass these flags; we ignore
	// encryption (pages that demand it won't work cross-domain anyway)
	// but accept them so the page code compiles verbatim.
	isToken?: boolean;
	encrypt?: boolean;
	_skipAuth?: boolean;
	// For file-download endpoints — the shared EnterpriseTable + export
	// menus look for this to choose between blob vs JSON.
	responseType?: AxiosRequestConfig['responseType'];
}

const client = axios.create({
	baseURL: BASE_URL,
	// Needed so the lm_session cookie set on .lum.id rides along to
	// runmesh.ai. Pair with `Access-Control-Allow-Credentials: true`
	// and an explicit `Access-Control-Allow-Origin: https://lum.id`
	// (never `*` when credentials are in play) on the Runmesh side.
	withCredentials: true,
	timeout: 30000,
});

// The lm_session cookie is HttpOnly + on `.lum.id`, so the browser
// won't let JS read it and won't forward it to runmesh.ai anyway.
// Instead, fetch the JWT once via /api/v1/session-bearer (a same-
// origin authenticated endpoint) and attach it as Authorization
// Bearer on every Runmesh call. Runmesh's LumidSsoBridgeFilter
// introspects it and maps to a local sys_user admin row.
//
// Cached per-page-load; refreshes on 401.
let cachedBearer: { token: string; expires_at: number } | null = null;
let bearerInFlight: Promise<string | null> | null = null;

async function fetchBearer(): Promise<string | null> {
	try {
		const r = await axios.get<{ data: { token: string; expires_at: number } }>(
			'/api/v1/session-bearer',
			{ withCredentials: true },
		);
		const d = r.data?.data;
		if (d?.token) {
			cachedBearer = { token: d.token, expires_at: d.expires_at };
			return d.token;
		}
	} catch {
		// fall through — request will go without bearer, Runmesh will 401,
		// page surfaces an "unauthorized" state.
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

client.interceptors.request.use(async (config) => {
	const token = await getBearer();
	if (token) {
		config.headers = config.headers ?? {};
		(config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
	}
	return config;
});

// Unwrap the standard {code, data, msg} envelope Runmesh returns.
// Non-zero code → reject so the caller's try/catch fires like a
// regular HTTP error. `code === 200` is what Runmesh's success path
// uses (mapstruct + SpringBoot convention); 0 is also accepted for
// legacy compatibility.
client.interceptors.response.use(
	(res: AxiosResponse) => {
		const body = res.data;
		if (!body || typeof body !== 'object') {
			return res;
		}
		const code = (body as ApiResponse<unknown>).code;
		if (code !== undefined && code !== 200 && code !== 0) {
			const msg =
				(body as ApiResponse<unknown>).msg ||
				(body as ApiResponse<unknown>).message ||
				`Runmesh API error ${code}`;
			return Promise.reject(new Error(msg));
		}
		return res;
	},
	(err: AxiosError) => {
		if (err.response?.status === 401) {
			// Caller's lum.id session is dead or unauthorized against
			// Runmesh. Let the page render its normal error state;
			// global handling lives in the lum.id apiClient for
			// `/api/v1/user` and friends.
			return Promise.reject(new Error('Unauthorized — please sign in again at lum.id'));
		}
		return Promise.reject(err);
	},
);

type MaybeList<T> = { rows?: T[]; total?: number } & Record<string, unknown>;

// Runmesh responses can be `{data: T}` or `{rows, total}` (paginated).
// The page code does `res.data` or `res.rows` — preserve both shapes.
function unwrap<T>(res: AxiosResponse<ApiResponse<T>>): T {
	const body = res.data;
	if (body && typeof body === 'object' && 'data' in body) {
		return (body as ApiResponse<T>).data;
	}
	return body as unknown as T;
}

export const http = {
	get<T = unknown>(url: string, config?: ExtendedAxiosRequestConfig): Promise<T> {
		return client.get<ApiResponse<T>>(url, config).then(unwrap);
	},
	post<T = unknown>(url: string, data?: unknown, config?: ExtendedAxiosRequestConfig): Promise<T> {
		return client.post<ApiResponse<T>>(url, data, config).then(unwrap);
	},
	put<T = unknown>(url: string, data?: unknown, config?: ExtendedAxiosRequestConfig): Promise<T> {
		return client.put<ApiResponse<T>>(url, data, config).then(unwrap);
	},
	delete<T = unknown>(url: string, config?: ExtendedAxiosRequestConfig): Promise<T> {
		return client.delete<ApiResponse<T>>(url, config).then(unwrap);
	},
	// Some Runmesh server/*.ts files call http.request directly with a
	// config object — preserve that escape hatch.
	request<T = unknown>(config: ExtendedAxiosRequestConfig): Promise<T> {
		return client.request<ApiResponse<T>>(config).then(unwrap);
	},
};

export { client as axiosInstance };
export type { MaybeList };
