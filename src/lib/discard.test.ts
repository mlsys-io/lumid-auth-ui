// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeCycleDetail, MeExperimentRow } from "@/api/me";
import { countedRows, discardedGroups, runDiscardTarget } from "./discard";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("a chain run discards its stages' results for its version", () => {
	const d = { ts: "T0", summary: { lineage: { variant: { arm: "v1", study: "serve" } }, stages: [{ loop: "simulate", ts: "T1" }, { loop: "sandbox", ts: "T2" }] }, steps: [] } as unknown as MeCycleDetail;
	eq(runDiscardTarget(d), { experiment: "serve", version: "v1", matches: [{ variant_id: "v1", cycle_ts: "T1" }, { variant_id: "v1", cycle_ts: "T2" }] });
	const plain = { ts: "T9", summary: { experiment: "v2", experiments: [{ id: "serve" }] }, steps: [] } as unknown as MeCycleDetail;
	eq(runDiscardTarget(plain)?.matches, [{ variant_id: "v2", cycle_ts: "T9" }]);
	eq(runDiscardTarget({ ts: "T", summary: {}, steps: [] } as unknown as MeCycleDetail), null);
});

check("discarded rows are listed, and only the rest count", () => {
	const rows = [
		{ ts: "1", variant_id: "a", cycle_ts: "T1", metrics: {}, dims: { discarded: "1", discarded_reason: "wrong design", discarded_at: "2026-11-28T03:40:00Z", stage: "sandbox" } },
		{ ts: "2", variant_id: "a", cycle_ts: "T1", metrics: {}, dims: { discarded: "1", discarded_reason: "wrong design", stage: "sandbox" } },
		{ ts: "3", variant_id: "b", metrics: {}, dims: {} },
	] as unknown as MeExperimentRow[];
	eq(countedRows(rows).length, 1);
	eq(discardedGroups(rows), [{ version: "a", cycle_ts: "T1", stage: "sandbox", reason: "wrong design", at: "2026-11-28T03:40:00Z", n: 2 }]);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ discard: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
