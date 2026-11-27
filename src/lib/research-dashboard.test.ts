// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperiment, MeRunRow, MeWorkflowRow } from "@/api/me";
import { bestResult, bestResults, bestSoFar, dollars, failingWorkflows, researchHeadline, weekSummary } from "./research-dashboard";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const NOW = Date.parse("2026-11-27T12:00:00Z") / 1000;
const exp = (o: Partial<MeExperiment>): MeExperiment => ({ id: "kol_alpha", hypothesis: "", kind: "arms", status: "running", n_results: 30, criteria_met: false, metric: { name: "sharpe" }, ...o } as MeExperiment);

check("a leader needs results and alike measurements", () => {
	eq(bestResult(exp({ best_variant: null })), null);
	eq(bestResult(exp({ best_variant: "a", comparable: false, variants: { a: { n: 3, mean: 1 } } })), null);
	const b = bestResult(exp({ best_variant: "musk_lean", criteria_met: true, variants: { musk_lean: { n: 20, mean: 1.42 } } }))!;
	eq([b.experiment, b.leader, b.standing, b.select], ["KOL alpha", "Musk lean", "winning", "exp:kol_alpha"]);
});
check("winners first, then most results", () => {
	const a = exp({ id: "a", best_variant: "x", variants: { x: { n: 5, mean: 1 } }, n_results: 50 });
	const b = exp({ id: "b", best_variant: "y", criteria_met: true, variants: { y: { n: 5, mean: 2 } }, n_results: 5 });
	eq(bestResults([a, b]).map((r) => r.select), ["exp:b", "exp:a"]);
});
check("headline order: new best, failing, ideas, collecting", () => {
	const win = exp({ best_variant: "musk_lean", criteria_met: true, updated_at: "2026-11-26T10:00:00Z", variants: { musk_lean: { n: 20, mean: 1.42 } } });
	const h = researchHeadline({ exps: [win], failing: [], ideas: 2, now: NOW })!;
	eq(h.tone, "ok");
	if (!h.text.startsWith("New best on KOL alpha: Musk lean wins with") || !h.text.endsWith(" · 2 ideas to try")) throw new Error(h.text);
	const old = exp({ best_variant: "musk_lean", criteria_met: true, updated_at: "2026-11-01T10:00:00Z", variants: { musk_lean: { n: 20, mean: 1.42 } } });
	const f = researchHeadline({ exps: [old], failing: [{ id: "bt", label: "Backtest", select: "wf:bt" }], ideas: 0, now: NOW })!;
	eq([f.tone, f.text, f.select], ["failing", "Backtest is failing — its latest run didn't finish", "wf:bt"]);
	eq(researchHeadline({ exps: [], failing: [], ideas: 1, now: NOW })!.text, "1 idea to try — open one to decide");
	const col = exp({ n_results: 18, min_samples: 10, arms: [{ id: "a" }, { id: "b" }, { id: "c" }], variants: { a: { n: 9, mean: 1 } } });
	eq(researchHeadline({ exps: [col], failing: [], ideas: 0, now: NOW })!.text, "KOL alpha: collecting results: 18 of 30");
	eq(researchHeadline({ exps: [], failing: [], ideas: 0, now: NOW }), null);
});
check("a leader that changed since the last visit is news", () => {
	const lead = exp({ best_variant: "b", updated_at: "2026-10-01T00:00:00Z", variants: { b: { n: 9, mean: 3 } } });
	if (!researchHeadline({ exps: [lead], failing: [], ideas: 0, seen: { kol_alpha: "A" }, now: NOW })!.text.includes("B now leads")) throw new Error("expected news");
	eq(researchHeadline({ exps: [lead], failing: [], ideas: 0, seen: { kol_alpha: "B" }, now: NOW })?.tone ?? null, null);
});
check("failing workflows and the week", () => {
	const rows = new Map<string, MeWorkflowRow>([
		["bt", { slug: "q:bt", last_run_ok: false, cost_cents_mtd: 30 } as MeWorkflowRow],
		["ft", { slug: "q:ft", last_run_ok: false, running: true, cost_cents_mtd: 80 } as MeWorkflowRow],
	]);
	eq(failingWorkflows(rows, (id) => id.toUpperCase()).map((f) => f.label), ["BT"]);
	const runs = [
		{ run_id: "1", workflow_slug: "q:bt", app: "q", state: "succeeded", started_at: NOW - 3600 },
		{ run_id: "2", workflow_slug: "q:bt", app: "q", state: "failed", started_at: NOW - 1800 },
		{ run_id: "3", workflow_slug: "z:bt", app: "z", state: "failed", started_at: NOW - 1800 },
		{ run_id: "4", workflow_slug: "q:bt", app: "q", state: "succeeded", started_at: NOW - 9 * 86400 },
	] as MeRunRow[];
	const w = weekSummary("q", runs, rows, NOW);
	eq([w.runs, w.failed, w.dots.map((d) => d.state), w.spendCents], [2, 1, ["done", "failed"], 110]);
	eq(dollars(410), "$4.10");
});
check("best so far never goes back", () => {
	eq(bestSoFar([1, 3, 2, 5, NaN, 4], true), [1, 3, 3, 5, 5]);
	eq(bestSoFar([9, 7, 8, 3], false), [9, 7, 7, 3]);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ research-dashboard: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
