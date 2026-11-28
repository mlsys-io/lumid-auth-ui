// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeCycleDetail } from "@/api/me";
import { runAgreement, runUsage } from "./run-agreement";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const detail = (summary: Record<string, unknown>, out?: Record<string, unknown>) =>
	({ summary, steps: out ? [{ output: { out } }] : [] }) as unknown as MeCycleDetail;

check("a run's own comparison rows (MLSys sandbox shape)", () => {
	const d = detail({}, { comparison: [
		{ metric: "Time to the first word, slowest 1% of requests", simulated: "1158 ms", measured: "672 ms", gap: "-42%" },
		{ metric: "Goodput", simulated: "22.4 tokens/s", measured: "24 tokens/s", gap: "+7%" },
	] });
	const a = runAgreement(d)!;
	eq([a.firstLabel, a.secondLabel, a.rows.length], ["Simulated", "Measured", 2]);
	eq(a.rows[1], { metric: "Goodput", first: "22.4 tokens/s", second: "24 tokens/s", gap: "+7%" });
});

check("a row that names its key gets the short label", () => {
	const a = runAgreement(detail({}, { comparison: [{ metric: "Time to the first word, slowest 1% of requests", key: "ttft_ms_p99", simulated: 1158, measured: 669 }] }))!;
	eq(a.rows[0].metric, "TTFT p99");
});

check("numeric comparison computes the gap and the headline", () => {
	const a = runAgreement(detail({}, { comparison: [{ metric: "ttft_ms_p99", predicted: 1400, measured: 820 }, { metric: "goodput_tok_s", predicted: 22, measured: 24 }] }))!;
	eq(a.rows[0].gap, "−41%");
	eq(a.headline, "1 of 2 numbers within 20% of measured; TTFT p99 was 41% lower");
});

check("a chain's stages that share a metric", () => {
	const a = runAgreement(detail({ stages: [{ loop: "simulate", metrics: { goodput_tok_s: 22, cost_usd: 0 } }, { loop: "sandbox", metrics: { goodput_tok_s: 24, gpu_s: 400 } }] }))!;
	eq([a.firstLabel, a.secondLabel, a.rows.map((r) => r.metric)], ["Simulate", "Sandbox", ["Goodput"]]);
	eq(runAgreement(detail({ stages: [{ loop: "a", metrics: { x: 1 } }] })), null);
});

check("what the run used", () => {
	eq(runUsage(detail({ usage: { gpu_s: 414, gpu_type: "RTX 5080", cost_usd: 0.03, metered: "measured" } }))!.words, "6.9 GPU-min on RTX 5080 · $0.03 notional");
	eq(runUsage(detail({}, { usage: { metered: "reused", saved_cpu_s: 6 } }))!.words, "Free — reused (saved 6 CPU-s)");
	eq(runUsage(detail({ metrics: { score: 1 } })), null);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ run-agreement: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
