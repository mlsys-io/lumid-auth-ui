// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { parse } from "yaml";
import { clippedSummary, installFacts, installLines } from "./marketplace-words";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }

// Trimmed from the three published specs on 2026-11-28.
const MLSYS = parse(`name: mlsys-research
compute:
  budget: {gpu_minutes: 168, per: total, parallel: 2}
workflows:
- {id: simulate, run: manual, compute: {memory: 512Mi}}
- {id: sandbox, run: manual, compute: {memory: 512Mi}}
`);
const MBB = parse(`name: mbb-consultant
compute:
  budget: {usd: 40, per: total, parallel: 2}
config: {default_analyst_model: qwen3.8-27b, judge_model: claude-sonnet, judge_panel: [a, b]}
workflows:
- {id: screen, run: manual}
- {id: quick, run: manual}
`);
const QUANT = parse(`name: quant-research
workflows:
- {id: backtest, run: manual}
- {id: stock_backtests, run: '5 */2 * * *', scope: operator}
- {id: kol_score_fleet, run: manual, compute: {gpu: 16Gi, site: home}}
- {id: harvest_outbox, run: '7 * * * *'}
- {id: screen}
`);

check("a GPU app on a GPU-minute budget that runs only when asked", () => {
	const f = installFacts(MLSYS)!;
	eq(f, { uses: "Uses GPU time", budget: "168 GPU-min budget in all, at most 2 runs at once", runs: "Nothing runs until you press Run." });
	eq(installLines(f), ["Uses GPU time · 168 GPU-min budget in all, at most 2 runs at once.", "Appears in My Agents. Nothing runs until you press Run."]);
	ok(!installLines(f).join(" ").includes("automatic"), "no 'first run starts automatically'");
});

check("an LLM app on a dollar budget", () => {
	eq(installFacts(MBB), { uses: "Uses LLM calls", budget: "$40 budget in all, at most 2 runs at once", runs: "Nothing runs until you press Run." });
});

check("a scheduled workflow is said; an operator-scoped one is not yours to run", () => {
	const f = installFacts(QUANT)!;
	eq(f.uses, "Uses GPU time");
	eq(f.budget, null);
	eq(f.runs, "1 workflow runs on its own, every hour; the rest wait until you press Run.");
	eq(installLines(f), ["Uses GPU time.", "Appears in My Agents. 1 workflow runs on its own, every hour; the rest wait until you press Run."]);
});

check("legacy loops, every workflow scheduled, a custom cron", () => {
	const f = installFacts({ loops: { a: { schedule: "0 8 * * *" }, b: { schedule: "0 9 1 * *" } } })!;
	eq(f.runs, "2 workflows run on their own, each on its own schedule.");
	eq(installFacts({ workflows: [{ id: "a", run: "0 9 1 * *" }] })!.runs, "1 workflow runs on its own, on a schedule.");
});

check("no spec, no claims", () => {
	eq(installFacts(null), null);
	eq(installLines(null), ["Appears in My Agents."]);
	eq(installFacts({ name: "x" }), { uses: null, budget: null, runs: "Nothing runs until you press Run." });
	eq(installLines(installFacts({ name: "x" })), ["Appears in My Agents. Nothing runs until you press Run."]);
});

check("a summary the index cut short ends on a whole word with an ellipsis", () => {
	const cut = "Write and backtest strategies. Also screens bar strategies on point-in-time company fundamentals (cryp";
	eq(clippedSummary(cut, cut.length), "Write and backtest strategies. Also screens bar strategies on point-in-time company fundamentals…");
	eq(clippedSummary("Short and whole."), "Short and whole.");
	eq(clippedSummary("x".repeat(20) + " done.", 10), "x".repeat(20) + " done.");
	eq(clippedSummary(undefined), "");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ marketplace-words: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
