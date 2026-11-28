// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import type { MeExperiment, MeRunRow, MeWorkflowRow } from "@/api/me";
import { metricText, bestResult, bestResultValue, bestResults, bestSoFar, bestTileLines, dollars, failingWorkflows, isYesNoMetric, phoneSummary, researchHeadline, weekSummary, yesNoWords } from "./research-dashboard";

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
	// The cause rides along, and the headline says where and why.
	const causes = new Map([["bt", "At Dev eval: Not signed in (HTTP 401)"]]);
	const f = failingWorkflows(rows, (id) => id.toUpperCase(), causes);
	eq(f[0].cause, "At Dev eval: Not signed in (HTTP 401)");
	eq(researchHeadline({ exps: [], failing: f, ideas: 0, now: NOW })!.text, "BT is failing — At Dev eval: Not signed in (HTTP 401)");
	eq(researchHeadline({ exps: [], failing: [f[0], { ...f[0], id: "x", label: "X" }], ideas: 0, now: NOW })!.text,
		"2 workflows are failing, all the same way: At Dev eval: Not signed in (HTTP 401)");
	eq(researchHeadline({ exps: [], failing: [f[0], { id: "x", label: "X", select: "wf:x" }], ideas: 0, now: NOW })!.text,
		"2 workflows are failing · BT — At Dev eval: Not signed in (HTTP 401)");
	eq(failingWorkflows(rows, (id) => id, new Map([["bt", "No reason recorded"]]))[0].cause, undefined);
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
check("a top number a gate stopped is not a lead", () => {
	const mk = (id: string, extra: Record<string, unknown>) => ({ id, best_variant: "a", n_results: 5, metric: { name: "sharpe" }, variants: { a: { n: 5, mean: 1 } }, ...extra }) as unknown as MeExperiment;
	const stopped = mk("s", { best_failed_gate: true, best_stopped_at: "robustness" });
	const b = bestResult(stopped)!;
	eq([b.standing, b.stoppedAt], ["didn't pass a step", "Robustness"]);
	eq(bestResults([stopped, mk("l", {})]).map((x) => x.select), ["exp:l", "exp:s"]);
	eq(researchHeadline({ exps: [stopped], failing: [], ideas: 0, seen: { s: "B" }, now: NOW }), null);
});
check("a unit is written once", () => {
	for (const k of ["energy_j_per_request", "energy_j_per_token", "latency_ms", "cost_usd"]) {
		const t = metricText(k, 1.5);
		if (/(\S+(?: per \S+)?) \1$/.test(t)) throw new Error(`unit doubled: ${t}`);
	}
	eq(metricText("goodput_tok_s", 22.4), "22.4 tok/s");
});
check("best so far never goes back", () => {
	eq(bestSoFar([1, 3, 2, 5, NaN, 4], true), [1, 3, 3, 5, 5]);
	eq(bestSoFar([9, 7, 8, 3], false), [9, 7, 7, 3]);
});

check("phone: the three tiles in one line", () => {
	eq(phoneSummary({ left: "112 GPU-min left", needs: 2, failing: 1 }), "112 GPU-min left · 2 need you · 1 failing");
	eq(phoneSummary({ left: null, needs: 1, failing: 0 }), "1 needs you");
	eq(phoneSummary({ left: "$39.08 left", needs: 0, failing: 0 }), "$39.08 left · Nothing needs you");
});
check("the leader is named by its spec title when it has one", () => {
	const b = bestResult(exp({ best_variant: "llm_0_6b_c12", arms: [{ id: "llm_0_6b_c12", title: "0.6B · concurrency 12" }] as never, variants: { llm_0_6b_c12: { n: 1, mean: 0.37 } } }))!;
	eq(b.leader, "0.6B · concurrency 12");
});

check("a yes/no metric reads as words, never 'Meets constraints yes'", () => {
	eq([isYesNoMetric("meets_constraints"), isYesNoMetric("passes_gate"), isYesNoMetric("is_valid"), isYesNoMetric("ok")], [true, true, true, true]);
	// Values alone: only 0 and 1, at least two, no unit, not a count or a share.
	eq([isYesNoMetric("constraint_check", [1, 0, 1]), isYesNoMetric("sharpe", [1]), isYesNoMetric("success_rate", [1, 0]), isYesNoMetric("n_errors", [0, 1]), isYesNoMetric("ttft_ms", [0, 1])], [true, false, false, false, false]);
	eq(yesNoWords("meets_constraints", 1), { tile: "meets constraints", sentence: "meets every constraint" });
	eq(yesNoWords("meets_constraints", 0), { tile: "doesn't meet constraints", sentence: "doesn't meet every constraint" });
	eq(yesNoWords("passes_gate", 0).tile, "doesn't pass gate");
	eq(yesNoWords("is_valid", 0).tile, "isn't valid");
	eq(yesNoWords("same_gpu_as_simulated", 1).tile, "same GPU as simulated");
	eq(yesNoWords("constraint_check", 1).tile, "passes constraint check");
	eq(yesNoWords("meets_constraints", 0.67).tile, "meets constraints in 67% of runs");
	// The headline and the tile (the MLSys audit: "Util 0.85 wins with Meets constraints yes").
	const e = exp({ id: "util", best_variant: "u85", criteria_met: true, updated_at: "2026-11-26T10:00:00Z", metric: { name: "meets_constraints" },
		arms: [{ id: "u85", title: "Util 0.85" }] as never, variants: { u85: { n: 4, mean: 1 }, u70: { n: 4, mean: 0 } } });
	const b = bestResult(e)!;
	eq([b.valueText, b.yesNo], ["meets constraints", "meets every constraint"]);
	const h = researchHeadline({ exps: [e], failing: [], ideas: 0, now: NOW })!;
	if (!h.text.endsWith("Util 0.85 wins: meets every constraint")) throw new Error(h.text);
	eq(bestTileLines(b, "yes · no simulated"), { value: "meets constraints" });
	eq(bestResultValue(b), "meets constraints");
	// An ordinary number keeps its name and the per-step words.
	const n = bestResult(exp({ best_variant: "a", variants: { a: { n: 3, mean: 1.42 }, b: { n: 3, mean: 1 } } }))!;
	eq([n.yesNo, bestResultValue(n)], [undefined, "Sharpe 1.42"]);
	eq(bestTileLines(n, "1.42 backtest · 1.1 forward"), { metric: "Sharpe", value: "1.42 backtest · 1.1 forward" });
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ research-dashboard: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
