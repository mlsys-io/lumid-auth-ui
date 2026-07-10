// Typed client for GET /api/v1/me/portfolio — the cross-workflow fleet view
// (P4). Rolls every one of the caller's workflows up into per-workflow health
// + 30d cost / tokens / learning velocity, plus fleet totals.
//
// Like casebook.ts, this is a NEW file kept independent of me.ts: it reuses the
// same lumid-identity envelope ({ ret_code, message, data }) and cross-origin
// cookie auth idiom, but the fleet view is a cold, one-shot read per
// /studio/portfolio open, so it skips me.ts's hot-path TTL cache / in-flight
// dedup machinery.

import { identityOrigin } from "../config/identity-origin";

const ME_BASE = identityOrigin(
	import.meta.env.VITE_ME_API_BASE as string | undefined
);

export type PortfolioHealth =
	| "healthy"
	| "needs_attention"
	| "recovered"
	| "paused"
	| "never";

export interface PortfolioWorkflow {
	app: string;
	loop: string;
	label?: string; // declared goal.primary, if any
	health: PortfolioHealth;
	last_run_ts?: number;
	last_run_ok?: boolean | null;
	runs_30d: number;
	cost_usd_30d: number;
	total_tokens_30d: number;
	learned_30d: number; // memories pushed across the window
	avg_duration_s: number;
	scan_capped?: boolean; // window may undercount very high-frequency loops
}

export interface PortfolioTotals {
	workflows: number;
	healthy: number;
	needs_attention: number;
	cost_usd_30d: number;
	total_tokens_30d: number;
	learned_30d: number;
	runs_30d: number;
}

export interface Portfolio {
	workflows: PortfolioWorkflow[];
	totals: PortfolioTotals;
	as_of?: string;
	cycle_scan_cap?: number;
}

const EMPTY_TOTALS: PortfolioTotals = {
	workflows: 0,
	healthy: 0,
	needs_attention: 0,
	cost_usd_30d: 0,
	total_tokens_30d: 0,
	learned_30d: 0,
	runs_30d: 0,
};

// Fetch the fleet rollup. Mirrors casebook.ts's unwrap-or-throw; callers can
// `.catch(() => emptyPortfolio)` to treat any failure as an empty fleet.
export async function fetchPortfolio(): Promise<Portfolio> {
	const r = await fetch(`${ME_BASE}/api/v1/me/portfolio`, {
		credentials: "include", // send lm_session cookie cross-origin
	});
	let json: { ret_code?: number; message?: string; data?: Portfolio } = {};
	try {
		json = await r.json();
	} catch {
		/* empty / non-JSON body */
	}
	if (!r.ok || (json.ret_code !== undefined && json.ret_code !== 0)) {
		throw new Error(json.message ?? r.statusText);
	}
	return json.data ?? { workflows: [], totals: { ...EMPTY_TOTALS } };
}
