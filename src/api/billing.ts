// User billing client. Reads Runmesh's balance endpoint via the
// lum.id /runmesh/* bridge — same-origin + scoped session-bearer
// (aud=runmesh) already set up by the runmesh axios client.

import { httpUser } from "@/runmesh/utils/axios";

export interface UserBalance {
	userId: number | string | null;
	amount: string; // decimal as string — "0.00" / "12.3456"
	totalBalance: string;
	frozenBalance: string;
	currency: string; // "USD"
}

export async function getUserBalance(): Promise<UserBalance> {
	// Runmesh returns {userId, amount, totalBalance, frozenBalance, currency}
	// nested under the standard {code,msg,data} envelope — httpUser unwraps
	// to the `data` field for us.
	return httpUser.get<UserBalance>("/runmesh/finance/userBill/balance");
}

/** Simple flat rate card for the wizard's cost estimate. The actual
 *  cost at billing time depends on the worker FlowMesh assigns —
 *  these are conservative per-resource rates used to show the user
 *  "at least roughly this much".
 */
export const RATE_CARD = {
	gpuPerHourUsd: 2.0, // per GPU
	cpuPerHourUsd: 0.05, // per core
	memPerGibHourUsd: 0.0, // bundled into CPU rate
} as const;

export interface RentalCostEstimate {
	gpuCost: number;
	cpuCost: number;
	totalPerHour: number;
	estimateForTtl: number;
	currency: "USD";
}

export function estimateRentalCost(
	gpu: number,
	cpu: number,
	ttlSeconds: number,
): RentalCostEstimate {
	const gpuCost = Math.max(0, gpu) * RATE_CARD.gpuPerHourUsd;
	const cpuCost = Math.max(0, cpu) * RATE_CARD.cpuPerHourUsd;
	const totalPerHour = gpuCost + cpuCost;
	const estimateForTtl = totalPerHour * (ttlSeconds / 3600);
	return {
		gpuCost,
		cpuCost,
		totalPerHour,
		estimateForTtl,
		currency: "USD",
	};
}
