// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeUsage } from "./spend";
import { NO_RESEARCH_USAGE, OWNED_MACHINES_NOTE, appUsageRow, appUsageRows, deviceUsed, gpuTodayLine, realMoneyUsd } from "./research-usage";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }

// The MLSys student on 2026-11-28 (GET /me/usage?app=mlsys-research, trimmed).
const MLSYS: MeUsage = {
	app: "mlsys-research",
	budget: { gpu_minutes: 168, per: "total", parallel: 2 },
	limits: { gpu_measurements_per_day: 24, gpu_measurements_today: 14 },
	rates: { cpu_core_hour: 0.02, gpu_hour: { "RTX 5080": 0.25, "*": 0.5 }, notional: true },
	remaining: { gpu_s: 6695.529 },
	used: {
		gpu_s: 3384.471, cpu_s: 144.478, cost_usd: 0.235836, runs: 56, running: 0,
		by_device: { CPU: 144.478, "RTX 5080": 3384.471 },
		by_instrument: {
			"mlsys-sandbox": { cost_usd: 0.235096, cpu_s: 11.503, gpu_s: 3384.471, runs: 14 },
			"mlsys-simulator": { cost_usd: 0.00074, cpu_s: 132.975, gpu_s: 0, runs: 41 },
		},
	},
};

check("the budget the sweep found: 56 of 168 GPU-min, on RTX 5080, no dollars", () => {
	const r = appUsageRow("mlsys-research", MLSYS)!;
	eq(r.line, "Budget: 56 of 168 GPU-min used · 112 GPU-min left");
	eq(r.detail, "56 GPU-min on RTX 5080 · 2.4 CPU-min");
	eq(r.runs, "56 runs");
	ok(r.share! > 0.33 && r.share! < 0.34, `share ${r.share}`);
	eq(r.money, null, "owned-hardware time is never priced");
	ok(!/\$|4090/.test(`${r.line} ${r.detail}`), "no dollars, no RTX 4090");
});

check("model calls at list price are the only dollars shown", () => {
	const u: MeUsage = { used: { gpu_s: 0, cpu_s: 30, cost_usd: 1.5, runs: 3, llm: { calls: 10, tokens_in: 1, tokens_out: 1, cost_usd: 1.5, notional_usd: 0 } } };
	ok(Math.abs(realMoneyUsd(u) - 1.5) < 1e-9, `real ${realMoneyUsd(u)}`);
	const r = appUsageRow("mbb", u)!;
	eq(r.money, "$1.50 of model calls at list price");
	eq(r.line, "30 CPU-s used");
	eq(deviceUsed(u), "30 CPU-s");
});

check("an app that ran nothing has no row; rows are busiest first", () => {
	eq(appUsageRow("x", { used: { gpu_s: 0, cpu_s: 0, cost_usd: 0, runs: 0 } }), null);
	eq(appUsageRow("x", null), null);
	const rows = appUsageRows([
		{ app: "small", usage: { used: { gpu_s: 0, cpu_s: 60, cost_usd: 0, runs: 2 } } },
		{ app: "mlsys-research", usage: MLSYS },
		{ app: "idle", usage: { used: { gpu_s: 0, cpu_s: 0, cost_usd: 0, runs: 0 } } },
	]);
	eq(rows.map((r) => r.app), ["mlsys-research", "small"]);
	eq(rows[1].line, "1 CPU-min used");
	eq(rows[1].runs, "2 runs");
});

check("today's GPU measurements against the account cap", () => {
	eq(gpuTodayLine(MLSYS), "GPU measurements today: 14 of 24");
	eq(gpuTodayLine(null), null);
});

check("the notes say what the wallet is not", () => {
	ok(/not charged to your balance/.test(OWNED_MACHINES_NOTE), "owned machines are not charged");
	ok(/Nothing has run yet/.test(NO_RESEARCH_USAGE), "empty");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ research-usage: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
