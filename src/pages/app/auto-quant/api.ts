// Auto-quant page API client.
//
// Consolidates all backend calls for /dashboard/auto-quant/* into one
// place. Three backends are hit:
//   1. lum.id/api/v1/admin/loops?app=auto-quant — identity backend (loop state + outcome)
//   2. /inbox-api/messages?app=auto-quant — xpcloud inbox via nginx proxy
//   3. /inbox-api/{message_id}/reply — xpcloud inbox replies (POST step_instructions)
//
// Auth: same-origin lm_session cookie for all three. No scoped bearer
// needed — lum.id proxies all /inbox-api/* to xpcloud with the cookie.

import apiClient from "@/api/client";
import type { DataResponse } from "@/api/types";
import type { LoopRow, LoopsResp, StrategyState } from "@/api/super-admin";
import {
	listInboxMessages,
	postStepInstructions,
	type InboxMessage,
	type StepInstructionsReply,
} from "@/api/inbox";

// ── Loop list (identity backend) ──────────────────────────────────────

/** Fetch all loops for the auto-quant app including outcome fields. */
export async function fetchAutoQuantLoops(): Promise<LoopRow[]> {
	const r = await apiClient.get<DataResponse<LoopsResp>>("/api/v1/admin/loops", {
		params: { app: "auto-quant" },
	});
	return (r.data.data.loops || []).filter((l) => l.app === "auto-quant");
}

// ── Strategy states (from loops response via apps[]) ─────────────────

/** Fetch strategy lifecycle states for auto-quant (from apps[] in loops resp). */
export async function fetchAutoQuantStrategies(): Promise<StrategyState[]> {
	const r = await apiClient.get<DataResponse<LoopsResp>>("/api/v1/admin/loops", {
		params: { app: "auto-quant" },
	});
	const apps = r.data.data.apps || [];
	const aq = apps.find((a) => a.app === "auto-quant");
	return aq?.strategies || [];
}

// ── Inbox messages ───────────────────────────────────────────────────

/** List the latest auto-quant cycle_summary inbox messages. */
export async function fetchAutoQuantInboxMessages(
	limit = 20,
): Promise<InboxMessage[]> {
	const resp = await listInboxMessages({ app: "auto-quant", limit });
	return resp.messages;
}

// ── Step instructions ─────────────────────────────────────────────────

/** Post a per-step instruction reply. */
export async function sendStepInstructions(
	messageId: string,
	reply: StepInstructionsReply,
): Promise<void> {
	await postStepInstructions(messageId, reply);
}

// ── Budget projection (derived from loop last_run metadata) ──────────

export interface BudgetProjection {
	/** Approximate API calls made today (derived from cycle cadence + loop count). */
	estimated_daily_calls: number;
	/** Estimated cost today in USD at $0.015/1k tokens (rough). */
	estimated_daily_usd: number;
	/** Per-loop breakdown. */
	per_loop: Array<{
		loop: string;
		runs_today: number;
		estimated_usd: number;
	}>;
}

/** Derive a rough budget projection from loop metadata (no live billing API yet). */
export function deriveBudget(loops: LoopRow[]): BudgetProjection {
	const now = Math.floor(Date.now() / 1000);
	const dayStart = now - 86400;
	const perLoop = loops.map((l) => {
		// Estimate runs today from schedule string (rough parse)
		let runsToday = 0;
		if (l.last_run_ts > dayStart) {
			// crude: count implied runs from cadence
			const sched = l.schedule || "";
			const minuteMatch = sched.match(/^\*\/(\d+)\s/);
			const hourMatch = sched.match(/^0\s\*\/(\d+)/);
			if (minuteMatch) {
				runsToday = Math.floor(1440 / parseInt(minuteMatch[1], 10));
			} else if (hourMatch) {
				runsToday = Math.floor(24 / parseInt(hourMatch[1], 10));
			} else if (sched.startsWith("0 ")) {
				runsToday = 1; // daily
			} else {
				runsToday = 2; // fallback
			}
		}
		// Rough cost: ~2000 tokens/run at $0.015/1k = $0.03/run
		const estimatedUsd = runsToday * 0.03;
		return { loop: l.loop, runs_today: runsToday, estimated_usd: estimatedUsd };
	});
	const totalCalls = perLoop.reduce((s, l) => s + l.runs_today, 0);
	const totalUsd = perLoop.reduce((s, l) => s + l.estimated_usd, 0);
	return {
		estimated_daily_calls: totalCalls,
		estimated_daily_usd: totalUsd,
		per_loop: perLoop,
	};
}
