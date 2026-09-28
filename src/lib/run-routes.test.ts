// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts (the repo
// has no standalone test runner; see that script's header).
import {
	workflowPath, runPath, parseScheduledRunId, runRowHref, legacyAppQueryTarget,
	legacyCycleTarget, legacyWorkflowSlugTarget, canonicalRunId,
} from "./run-routes";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check("workflow path", () => eq(workflowPath("quant-research", "backtest"), "/studio/apps/quant-research/w/backtest"));
check("workflow path with arm filter; empty params dropped", () =>
	eq(workflowPath("qr", "backtest", { arm: "tape_covered", outcome: "" }), "/studio/apps/qr/w/backtest?arm=tape_covered"));
check("run path with step + pane", () =>
	eq(runPath("qr", "backtest", "20260928T075005Z", { step: "engine_command", pane: "output" }),
		"/studio/apps/qr/w/backtest/r/20260928T075005Z?step=engine_command&pane=output"));
check("run path normalises unix seconds to the cycle-dir id", () =>
	eq(runPath("qr", "backtest", "1790581805"), "/studio/apps/qr/w/backtest/r/20260928T075005Z"));
check("canonicalRunId: unix seconds redirect, dir id stays", () => {
	eq(canonicalRunId("1790581805"), "20260928T075005Z");
	eq(canonicalRunId("20260928T075005Z"), null);
});
check("scheduled run id parses", () => {
	const p = parseScheduledRunId("scheduled:mbb-consultant:case_eval:20260928T110641Z");
	eq(p?.app, "mbb-consultant"); eq(p?.loop, "case_eval"); eq(p?.runId, "20260928T110641Z");
});
check("non-scheduled run id → null, and opens the standalone page", () => {
	eq(parseScheduledRunId("visual:abc"), null);
	eq(runRowHref("visual:abc"), "/studio/runs/visual%3Aabc");
});
check("scheduled run row opens the run page", () =>
	eq(runRowHref("scheduled:qr:backtest:20260928T075005Z"), "/studio/apps/qr/w/backtest/r/20260928T075005Z"));
check("legacy ?selected= → workflow page", () => eq(legacyAppQueryTarget("qr", "?selected=backtest"), "/studio/apps/qr/w/backtest"));
check("legacy ?selected=&cycle= → run page (unix seconds normalised)", () => {
	eq(legacyAppQueryTarget("qr", "?selected=backtest&cycle=20260928T075005Z"), "/studio/apps/qr/w/backtest/r/20260928T075005Z");
	eq(legacyAppQueryTarget("qr", "?selected=backtest&cycle=1790581805"), "/studio/apps/qr/w/backtest/r/20260928T075005Z");
});
check("legacy query keeps unrelated params, drops surface", () =>
	eq(legacyAppQueryTarget("qr", "?selected=backtest&surface=workflows&arm=x"), "/studio/apps/qr/w/backtest?arm=x"));
check("no workflow named → no redirect", () => {
	eq(legacyAppQueryTarget("qr", "?surface=workflows"), null);
	eq(legacyAppQueryTarget("qr", "?selected=__overview__"), null);
	eq(legacyAppQueryTarget("qr", ""), null);
});
check("legacy cycle route", () => {
	eq(legacyCycleTarget("qr", "backtest", "20260928T075005Z"), "/studio/apps/qr/w/backtest/r/20260928T075005Z");
	eq(legacyCycleTarget("qr", "backtest"), "/studio/apps/qr/w/backtest");
});
check("legacy workflow slug", () => {
	eq(legacyWorkflowSlugTarget("qr:backtest"), "/studio/apps/qr/w/backtest");
	eq(legacyWorkflowSlugTarget("qr"), "/studio/apps/qr");
});

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
