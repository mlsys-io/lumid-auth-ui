// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts (the repo
// has no standalone test runner; see that script's header).
import { toCycleId } from "./cycle-id";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("cycle-dir id passes through unchanged", () => eq(toCycleId("20260928T075005Z"), "20260928T075005Z"));
check("unix seconds (run-tree run_ts) become the cycle-dir id", () => eq(toCycleId("1790581805"), "20260928T075005Z"));
check("numeric unix seconds are accepted too", () => eq(toCycleId(1790581805), "20260928T075005Z"));
check("fractional unix seconds are floored", () => eq(toCycleId("1790581805.93"), "20260928T075005Z"));
check("small integers are not treated as epoch seconds", () => eq(toCycleId("42"), "42"));
check("empty / missing is empty", () => { eq(toCycleId(""), ""); eq(toCycleId(undefined), ""); eq(toCycleId(null), ""); });
check("anything else passes through", () => eq(toCycleId("latest"), "latest"));

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}
export const caseCount = checks.length;
