// Typed client for the caller's OWN LQT strategies — GET /lqt/inspect/*.
//
// WHY THIS FILE EXISTS. lqt-data's route config says outright that these two
// endpoints were built for a UI that was then never written: "Lets the
// researcher UI list the strategies the user has registered so it can then
// drill into /lqt/inspect/cycles/:strategy." They have been deployed, RLS-
// enforced and consumer-less.
//
// ---------------------------------------------------------------------------
// TRANSPORT — three traps, all of them load-bearing. Read before editing.
//
// 1. USE lum.id, NOT lumid.trade. The lqt-inspect Ingress is registered for
//    host `lum.id` only; the same path on lumid.trade is a 404. That is the
//    opposite of the /xpio/* read endpoints, which are lumid.trade-only.
//
// 2. THIS PATH DOES NOT GET THE SERVICE PAT INJECTED, and must not. The landing
//    nginx `location /lqt/` UNCONDITIONALLY overwrites Authorization with a
//    read-scoped service PAT ($lqt_auth) — its own comment says it "ALWAYS
//    resolves to the service PAT and OVERRIDES any Authorization the browser
//    sends". If that applied here, every user would see the SERVICE ACCOUNT's
//    strategies instead of their own. It does not apply, because
//    /lqt/inspect(/|$)(.*) has its OWN Ingress that matches at the cluster edge
//    and goes straight to lqt-inspect:8089, never reaching the landing pod.
//    Verified 2026-08-23: unauthenticated -> 401 from lqt-inspect (not the
//    landing's injected identity).
//
//    Consequence: if anyone ever "tidies up" by routing /lqt/inspect through the
//    landing block, this silently becomes a cross-tenant read. The 401 on an
//    anonymous request is the canary.
//
// 3. AUTH IS A SESSION-BEARER WITH audience=lqt. lqt-auth verifies a JWKS-signed
//    JWT requiring aud="lqt" / iss="https://lum.id" before falling back to PAT
//    introspect, so the browser needs an `lqt`-audience bearer — NOT the default
//    runmesh one, which fails the audience check. Scoping is server-side:
//    self_tenant injects the caller's `sub` and pins the RLS GUC, so the tenant
//    cannot be spoofed by editing the request.
// ---------------------------------------------------------------------------

import { bearerHeader } from "./session-bearer";

// Same-origin: the Ingress serves these off lum.id, and the SPA is on lum.id.
// Overridable for a dev server pointed at prod.
const LQT_BASE = (import.meta.env.VITE_LQT_API_BASE as string | undefined) || "";

/** A strategy registered under the caller's tenant (core.tenant_strategies). */
export interface LqtStrategy {
	tenant_id: string;
	strategy_id: string;
	name: string;
	kind: string;
	model: string | null;
	version: string;
	/** Non-empty = compiled and registered. Empty/null = submitted but not compiled. */
	program_hash: string | null;
	source_msg_id: string | null;
	registered_at: string;
	updated_at: string;
}

/** One runtime cycle for a strategy (obs.runtime_cycles), newest first. */
export interface LqtCycle {
	ts: string;
	box_id: string;
	strategy_id: string;
	cycle_id: string;
	loop_seq: number;
	region_id: string | null;
	n_proposed: number;
	n_submitted: number;
	n_rejected: number;
	suppressed: number;
	/** Distribution of why orders were rejected — the most diagnostic field here. */
	reject_reasons: Record<string, number> | string | null;
	decision_mid_ticks: number | null;
	gate_latency_ns: number | null;
	router_latency_ns: number | null;
	decision_latency_ns: number | null;
}

export class LqtAuthError extends Error {}

async function get<T>(path: string): Promise<T> {
	const headers = await bearerHeader("lqt");
	if (!headers.Authorization) {
		// No session -> no bearer. Fail loudly rather than sending an anonymous
		// request: anonymous here is a 401 from lqt-inspect, which would surface
		// as "your strategies could not be loaded" and send the reader hunting a
		// backend problem that is really just a signed-out tab.
		throw new LqtAuthError("not signed in");
	}
	const r = await fetch(`${LQT_BASE}${path}`, {
		headers: { ...headers, Accept: "application/json" },
	});
	if (r.status === 401 || r.status === 403) {
		throw new LqtAuthError(
			"LQT rejected the session bearer — the `lqt` audience may not be deployed on lumid-identity yet",
		);
	}
	if (!r.ok) throw new Error(`lqt ${path}: HTTP ${r.status}`);
	const body = await r.json();
	// shape = "rows": lqt-data returns a bare array. Tolerate an enveloped form
	// so a future shape change degrades to empty rather than throwing in render.
	return (Array.isArray(body) ? body : (body?.rows ?? body?.data ?? [])) as T;
}

/** The caller's registered strategies, newest first. Tenant-scoped server-side. */
export function listStrategies(limit = 200): Promise<LqtStrategy[]> {
	return get<LqtStrategy[]>(`/lqt/inspect/strategies?limit=${limit}`);
}

/** Runtime cycles for one strategy, newest first. Empty is normal — a strategy
 *  that is registered but has not been picked up by a field box yet has none. */
export function listCycles(strategyId: string, limit = 200): Promise<LqtCycle[]> {
	return get<LqtCycle[]>(
		`/lqt/inspect/cycles/${encodeURIComponent(strategyId)}?limit=${limit}`,
	);
}

/** Rolls cycles up into the funnel the researcher actually wants to see. */
export function summarizeCycles(cycles: LqtCycle[]) {
	const t = { proposed: 0, submitted: 0, rejected: 0, suppressed: 0 };
	const reasons: Record<string, number> = {};
	for (const c of cycles) {
		t.proposed += c.n_proposed || 0;
		t.submitted += c.n_submitted || 0;
		t.rejected += c.n_rejected || 0;
		t.suppressed += c.suppressed || 0;
		// reject_reasons is jsonb; it can arrive as an object or as a string
		// depending on the driver, so handle both rather than trusting one.
		let rr = c.reject_reasons;
		if (typeof rr === "string") {
			try { rr = JSON.parse(rr); } catch { rr = null; }
		}
		if (rr && typeof rr === "object") {
			for (const [k, v] of Object.entries(rr)) {
				reasons[k] = (reasons[k] || 0) + (Number(v) || 0);
			}
		}
	}
	const topReasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
	return { ...t, topReasons, cycles: cycles.length };
}
