// lum.id/data jobs entrance client — /jobs/v1/* on the lumid-data instance.
//
// Same transport and auth as the Data Warehouse catalog (api/dataLake.ts):
// same-origin `/data` base (the landing nginx root-strips to lumid-data) and
// the browser's lum.id session, carried as the short-lived session-bearer —
// the HttpOnly cookie can't be read from JS. Responses are normalised in
// lib/data-jobs.ts; nothing renders the raw payload.

import { bearerHeader } from "@/api/session-bearer";
import { instanceById } from "@/api/dataLake";
import {
	jobsErrorWords, normalizeEvents, normalizeJob, normalizeJobs, normalizePlan, normalizeSource, normalizeSources,
	parseApiError, type DataSource, type JobSpec, type SourceScope, type Visibility,
} from "@/lib/data-jobs";

const BASE = instanceById("lumid-data")?.basePath ?? "/data";
const enc = encodeURIComponent;

/** A failed jobs call. `status` is read by ErrorState (errorStatus()). */
export class JobsApiError extends Error {
	status: number;
	code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

async function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<unknown> {
	// lum.id/data only accepts a bearer minted for it (audience lumid-data).
	const auth = await bearerHeader("lumid-data");
	let r: Response;
	try {
		r = await fetch(`${BASE}${path}`, {
			method,
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
				...auth,
				...(headers ?? {}),
			},
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	} catch {
		throw new JobsApiError(0, "network", "Couldn't reach lum.id/data. Check your connection and try again.");
	}
	const text = await r.text().catch(() => "");
	if (!r.ok) {
		const e = parseApiError(text);
		throw new JobsApiError(r.status, e.code, jobsErrorWords(r.status, e.code, e.message));
	}
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		// HTML where JSON was expected: the route fell through to a login page.
		throw new JobsApiError(r.status, "not_json", "lum.id/data answered with a page instead of data. Reload and try again.");
	}
}

export const dataJobs = {
	sources: async (scope: SourceScope, q = "") =>
		normalizeSources(await req("GET", `/jobs/v1/sources?scope=${enc(scope)}${q ? `&q=${enc(q)}` : ""}`)),

	createSource: async (b: { name: string; ref: string; visibility?: Visibility; max_bytes?: number; description?: string }): Promise<DataSource | null> =>
		normalizeSource(await req("POST", "/jobs/v1/sources", b)),

	deleteSource: (id: string) => req("DELETE", `/jobs/v1/sources/${enc(id)}`),

	share: (id: string, b: { grantee: string; access: "read" | "write"; expires_at?: string }) =>
		req("POST", `/jobs/v1/sources/${enc(id)}/grants`, b),

	unshare: (id: string, grantee: string, access: "read" | "write") =>
		req("DELETE", `/jobs/v1/sources/${enc(id)}/grants/${enc(grantee)}/${enc(access)}`),

	plan: async (spec: JobSpec) => normalizePlan(await req("POST", "/jobs/v1/plan", { spec })),

	/** Run a checked plan. The plan id doubles as the idempotency key, so a
	 *  double click (or a retry after a dropped response) can't start it twice. */
	runPlan: async (planId: string) =>
		normalizeJob(await req("POST", "/jobs/v1/jobs", { plan_id: planId }, { "Idempotency-Key": `plan-${planId}` })),

	jobs: async (o: { status?: string; app?: string; limit?: number } = {}) => {
		const sp = new URLSearchParams();
		if (o.status) sp.set("status", o.status);
		if (o.app) sp.set("app", o.app);
		sp.set("limit", String(o.limit ?? 50));
		return normalizeJobs(await req("GET", `/jobs/v1/jobs?${sp}`));
	},

	job: async (id: string) => normalizeJob(await req("GET", `/jobs/v1/jobs/${enc(id)}`)),

	cancel: async (id: string) => normalizeJob(await req("POST", `/jobs/v1/jobs/${enc(id)}/cancel`)),

	events: async (id: string) => normalizeEvents(await req("GET", `/jobs/v1/jobs/${enc(id)}/events`)),
};
