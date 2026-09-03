// Per-app user-insight rollup — lumid_identity's /api/v1/admin/apps/:app/insights.
//
// Same-origin from lum.id, so the lm_session cookie plus the AdminGuard at the
// route is the auth; no scoped bearer.
//
// The types below mirror the handler exactly, including the honesty fields
// (`unknown_outcome`, `is_floor`, `caveats`). Those are not decoration: the page
// is meant to be trusted, and a number whose provenance is shaky has to say so
// where it is rendered, not in a doc nobody opens.

import apiClient from './client';
import type { DataResponse } from './types';

export interface InsightCount {
	key: string;
	count: number;
}

export interface InsightDay {
	day: string;
	submissions: number;
	runs: number;
	intents: number;
}

export interface SubmissionFunnel {
	total: number;
	users: number;
	attributed: {
		deployed: number;
		rejected: number;
		no_verdict: number;
		mailbox_refused: number;
		transport_error: number;
	};
	/** Rows written before the verdict was recorded. Counted, never inferred. */
	unknown_outcome: number;
	reject_reasons: InsightCount[];
	attempts_to_first_deploy: InsightCount[];
	users_never_deployed: number;
	/** Users whose every submission predates outcome recording. Not a failure —
	 *  we do not know what happened to them. */
	users_outcome_unknown: number;
	verdict_ms_p50?: number;
	verdict_ms_p95?: number;
}

export interface AppInsights {
	app: string;
	aliases: string[];
	window_days: number;
	generated_at: string;
	submissions: SubmissionFunnel;
	runs: {
		total: number;
		users: number;
		by_loop: InsightCount[];
		failures_by_loop: InsightCount[];
		newest_run_ts: number;
		stale_seconds: number;
	};
	intents: {
		total: number;
		users: number;
		by_action: InsightCount[];
		by_status: InsightCount[];
		queue_ms_p50: number;
		queue_ms_p95: number;
		run_ms_p50: number;
		run_ms_p95: number;
	};
	chats: {
		total: number;
		users: number;
		is_floor: boolean;
		floor_note: string;
	};
	truncated: { submissions: boolean; runs: boolean; intents: boolean; row_cap: number };
	backtests: {
		total: number;
		by_verdict: InsightCount[];
		by_tape: InsightCount[];
		truncated: boolean;
	};
	interactions: {
		total: number;
		users: number;
		by_action: InsightCount[];
		by_surface: InsightCount[];
	};
	activity: InsightDay[];
	caveats: string[];
}

export async function fetchAppInsights(app: string, days = 30): Promise<AppInsights> {
	const r = await apiClient.get<DataResponse<AppInsights>>(
		`/api/v1/admin/apps/${encodeURIComponent(app)}/insights?days=${days}`,
	);
	return r.data.data;
}
