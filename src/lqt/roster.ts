/**
 * Shared types + fetch helper for the LQT strategies roster.
 *
 * Consumed by BOTH `src/pages/status/operations.tsx` (the super-admin
 * operations status page) and `src/pages/studio/manage.tsx` (the
 * read-only "LQT Strategies" studio view) so the two surfaces stay
 * consistent.
 *
 * Backed by `GET /lqt/strategies-roster`, served by the opsagent under
 * the same `/lqt/*` path the operations status page already uses. Unlike
 * the plain read paths (stack-check / venue-health / resource-usage), the
 * opsagent roster endpoint is `_require_super_admin`-gated: it introspects
 * the CALLER's bearer and requires `role == super_admin`, so the nginx
 * read-scoped service PAT is not sufficient (it introspects as non-admin /
 * expired → 401 "token not active"). The fetch therefore goes through
 * `getJsonAuthed`, which forwards the viewer's own scoped session-bearer
 * (minted from the `lm_session` cookie); a super_admin viewer authenticates
 * as themselves. Both consumers of this helper are super_admin surfaces.
 *
 * Response shape (exact):
 *   {
 *     "generated_at": "<iso8601>", "source": "lumid.trade/xpio",
 *     "boxes": [ { box_id, family, mode, last_seen, age_secs, cycles,
 *                  n_proposed, n_submitted, n_rejected,
 *                  key_metric: { name, value }, live }, ... ],
 *     "summary": { live_arms, silent_arms, total_arms,
 *                  families: { [family]: number } }
 *   }
 */

import { getJsonAuthed } from '@/lqt/utils/axios';

/** One reported key metric for a strategy arm. */
export interface RosterKeyMetric {
	name: string;
	value: number;
}

/** One reported strategy arm (a box running a family in some mode). */
export interface RosterBox {
	box_id: string;
	family: string;
	mode: string;
	last_seen: string;
	age_secs: number;
	cycles: number;
	n_proposed: number;
	n_submitted: number;
	n_rejected: number;
	key_metric: RosterKeyMetric;
	live: boolean;
}

export interface RosterSummary {
	live_arms: number;
	silent_arms: number;
	total_arms: number;
	families: Record<string, number>;
}

export interface LqtStrategiesRoster {
	generated_at: string;
	source: string;
	boxes: RosterBox[];
	summary: RosterSummary;
}

/** Path served by the opsagent under the shared `/lqt/*` proxy. */
export const ROSTER_PATH = '/lqt/strategies-roster';

/** Fetch the strategies roster from the gateway (super_admin bearer forwarded). */
export async function fetchRoster(): Promise<LqtStrategiesRoster> {
	return getJsonAuthed<LqtStrategiesRoster>(ROSTER_PATH);
}
