// research-usage — what an account's research used, for the Billing page. Pure
// and tested (research-usage.test.ts); pages/app/billing.tsx only places it.
//
// Billing used to say "$0.00 · approx. 0 hours of RTX 4090 compute" and
// "No usage records" to a student who had used 56 of 168 GPU-minutes on
// RTX 5080s (2026-11-28 sweep): the page shows the Runmesh cloud-rental wallet,
// and research measurements run on lum.id's own machines, which never touch it.
// This module says what was used, per app, from identity's GET /me/usage —
// device-minutes first; dollars only for the part that is real money (model
// calls at list price, lib/spend.ts usageNotionalUsd). Device time on owned
// machines is not billed, so it is never priced here.

import { budgetMeter, deviceWords, dollars, gpuToday, usageNotionalUsd, type MeUsage, type Spend } from "./spend";

export interface AppUsageRow {
	app: string;
	/** "56 of 168 GPU-min used · 112 GPU-min left" or "6.9 GPU-min on RTX 5080 · 2.2 CPU-min used". */
	line: string;
	/** With a budget: the device time behind it ("56 GPU-min on RTX 5080 · 2.4 CPU-min"). */
	detail: string | null;
	/** "41 runs" */
	runs: string;
	/** Share of the budget used (0..1), when the app declares one. */
	share: number | null;
	/** The budget is used up / at 80%+. */
	over: boolean;
	low: boolean;
	/** "$0.12 of model calls at list price", when there is real money. */
	money: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The real-money part of a usage: what it cost minus the notional (owned-hardware) part. */
export function realMoneyUsd(u: MeUsage): number {
	const cost = u.used.cost_usd || 0;
	if (!(cost > 0)) return 0;
	return Math.max(0, cost - usageNotionalUsd(u));
}

/** Device time used, in words, with no dollars: "56 GPU-min on RTX 5080 · 2.4 CPU-min". */
export function deviceUsed(u: MeUsage): string {
	const s: Pick<Spend, "gpu_s" | "cpu_s" | "gpu_by_type"> = {
		gpu_s: u.used.gpu_s || 0,
		cpu_s: u.used.cpu_s || 0,
		gpu_by_type: Object.fromEntries(Object.entries(u.used.by_device ?? {}).filter(([k]) => k !== "CPU")),
	};
	return deviceWords(s);
}

/** One app's row, or null when it has run nothing. */
export function appUsageRow(app: string, u: MeUsage | null | undefined): AppUsageRow | null {
	if (!u || !u.used || !(u.used.runs > 0)) return null;
	const meter = budgetMeter(u);
	const dev = deviceUsed(u);
	const real = realMoneyUsd(u);
	const money = real >= 0.005 ? `${dollars(real)} of model calls at list price` : null;
	const line = meter
		? `Budget: ${meter.words.replace(/ \(about [^)]*\)$/, "")}`
		: dev ? `${dev} used` : money ? "No machine time used" : "Not metered";
	return { app, line, detail: meter && dev ? dev : null, runs: plural(u.used.runs, "run", "runs"), share: meter ? meter.share : null, over: !!meter?.over, low: !!meter?.low, money };
}

/** The rows for every app that ran something, the busiest (most runs) first. */
export function appUsageRows(perApp: Array<{ app: string; usage: MeUsage | null | undefined }>): AppUsageRow[] {
	return perApp
		.map((p) => ({ row: appUsageRow(p.app, p.usage), runs: p.usage?.used?.runs ?? 0 }))
		.filter((x): x is { row: AppUsageRow; runs: number } => !!x.row)
		.sort((a, b) => b.runs - a.runs || a.row.app.localeCompare(b.row.app))
		.map((x) => x.row);
}

/** The account-wide line under the rows: today's GPU measurements against the cap. */
export function gpuTodayLine(u: MeUsage | null | undefined): string | null {
	const t = gpuToday(u);
	if (!t) return null;
	if (t.limit) return `GPU measurements today: ${t.used} of ${t.limit}`;
	return t.used ? `GPU measurements in the last 24 hours: ${t.used}` : null;
}

/** What the wallet beside it is, so a $0 balance next to real usage reads true. */
export const OWNED_MACHINES_NOTE =
	"Research runs on lum.id's own machines (home and office) and is not charged to your balance. Where an app has a budget, that budget limits its machine time instead.";

/** What the page says when no app has run anything. */
export const NO_RESEARCH_USAGE = "Nothing has run yet. When an app runs or measures something, the machine time it used appears here.";
