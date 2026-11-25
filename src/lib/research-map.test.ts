// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
// Fixtures are trimmed copies of real lum.id experiments (2026-11-24).
import type { MeExperiment } from "@/api/me";
import { humanId, experimentStatus, versionsOf, criteriaInWords, buildResearchTree, pathTo, mapSummary, comparabilityNote, suggestionParent, type Proposal } from "./research-map";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const kol = {
	id: "kol_alpha", kind: "arms", status: "active", hypothesis: "h", n_results: 728, criteria_met: false,
	comparable: false, instruments: 18, baseline: { arm: "current" }, min_samples: 10,
	metric: { name: "realized_pnl_ticks", higher_is_better: true },
	arms: [{ id: "current" }, { id: "musk_v1", description: "keyword lean" }, { id: "musk_llm_scored" }],
	variants: { current: { n: 357, mean: 121610.64 }, musk_llm_scored: { n: 184, mean: 70619.57 }, musk_v1: { n: 187, mean: 17125.67 } },
} as unknown as MeExperiment;
const won = { id: "readability_lift", kind: "arms", status: "active", hypothesis: "h", n_results: 60, criteria_met: true, comparable: true,
	best_variant: "plain_style", baseline: { arm: "current" }, min_samples: 20, metric: { name: "readability_score" },
	arms: [{ id: "current" }, { id: "plain_style" }], variants: { current: { n: 30, mean: 0.61 }, plain_style: { n: 30, mean: 0.72 } } } as unknown as MeExperiment;
const fresh = { id: "analyst_local_gpu", kind: "arms", status: "active", hypothesis: "h", n_results: 0, criteria_met: false,
	arms: [{ id: "a" }, { id: "b" }], variants: {} } as unknown as MeExperiment;

check("ids read as words", () => { eq(humanId("kol_alpha"), "KOL alpha"); eq(humanId("musk_llm_scored"), "Musk LLM scored"); });
check("status: not comparable, in words", () => eq(experimentStatus(kol), { tone: "attention", text: "Can't compare yet — the versions ran under 18 different setups" }));
check("status: confirmed winner", () => eq(experimentStatus(won), { tone: "ok", text: "Winning: Plain style" }));
check("status: never ran / starved / unfed", () => {
	eq(experimentStatus(fresh).text, "Not started yet");
	eq(experimentStatus({ ...fresh, starved: true } as MeExperiment).text, "Stuck — the workflow that feeds it is failing");
	eq(experimentStatus({ ...fresh, unfed: true } as MeExperiment).text, "Can't start — no workflow feeds it");
});
check("versions: tags and lines", () => {
	const v = versionsOf(kol);
	eq(v.map((x) => x.label), ["Current version", "Musk v1", "Musk LLM scored"]);
	eq(v[0].tag, "current"); eq(v[1].tag, "trying");
	eq(v[0].line, "357 results · avg 121,610.6 ticks");
	eq(v[1].description, "keyword lean");
	const w = versionsOf(won);
	eq(w.find((x) => x.id === "plain_style")?.tag, "winning");
	eq(versionsOf(fresh).map((x) => x.tag), ["not run yet", "not run yet"]);
});
check("not comparable: nobody is 'leading'", () => {
	const v = versionsOf({ ...kol, best_variant: "current" } as MeExperiment);
	if (v.some((x) => x.tag === "leading" || x.tag === "winning")) throw new Error(JSON.stringify(v.map((x) => x.tag)));
});
check("done-when in words", () => {
	eq(criteriaInWords("best_n >= 20 and baseline_n >= 20 and delta_pp > 10"), "The best and the current version each have 20+ results, and the best is ahead by more than 10 percentage points");
	eq(criteriaInWords("best_n >= 10 and baseline_n >= 10 and delta > 0"), "The best and the current version each have 10+ results, and the best beats the current one");
	eq(criteriaInWords("custom_thing(x) > 3"), "custom_thing(x) > 3");
	eq(criteriaInWords(""), "");
});
const props: Proposal[] = [{ id: "symbol_over_signal", hypothesis: "h", est_runs: 40 }, { id: "kol_alpha", hypothesis: "dup" }];
check("tree: app → experiments → versions, suggestions dashed, accepted ones not repeated", () => {
	const t = buildResearchTree("quant-research", [kol, won], props);
	eq(t.nodes.filter((n) => n.kind === "experiment").length, 2);
	eq(t.nodes.filter((n) => n.kind === "version").length, 5);
	eq(t.nodes.filter((n) => n.kind === "suggested").map((n) => n.ref), ["symbol_over_signal"]);
	eq(t.edges.find((e) => e.target === "sug:symbol_over_signal")?.dashed, true);
});
check("path: root to a version, and an experiment lights its versions", () => {
	const t = buildResearchTree("qr", [kol], []);
	eq([...pathTo(t.nodes, "ver:kol_alpha:musk_v1")].sort(), ["app:qr", "exp:kol_alpha", "ver:kol_alpha:musk_v1"]);
	eq(pathTo(t.nodes, "exp:kol_alpha").size, 5);
});
check("comparability note says what differed and what to do", () => {
	eq(comparabilityNote({ ...kol, compare_within: ["harness_version"] } as MeExperiment), "They differ in harness version, so a gap between them may come from the setup rather than the version. To compare them, run every version under the same setup.");
	eq(comparabilityNote(won), null);
});
check("status: enough results but no leader is 'too close to call'", () => {
	const doc = { id: "readability_lift", kind: "arms", status: "active", hypothesis: "h", n_results: 209, criteria_met: false, comparable: true,
		min_samples: 12, arms: [{ id: "current" }, { id: "rewritten" }], variants: { current: { n: 108, mean: 3.13 }, rewritten: { n: 101, mean: 3.13 } } } as unknown as MeExperiment;
	eq(experimentStatus(doc).text, "Enough results — too close to call so far");
});
check("a suggestion hangs off the experiment it extends (2 of loop/dataset/metric)", () => {
	const e1 = { ...kol, id: "kol_alpha", dispatch: { loop: "kol_strategy" }, loops: ["kol_strategy"], dataset_id: "musk_tweets_v1" } as unknown as MeExperiment;
	const e2 = { ...won, id: "backtest_evidence", dispatch: { loop: "backtest" }, dataset_id: "tape_covered_v1", metric: { name: "real_tape" } } as unknown as MeExperiment;
	eq(suggestionParent({ id: "s1", dispatch_loop: "backtest", dataset_id: "tape_covered_v1" }, [e1, e2]), "backtest_evidence");
	eq(suggestionParent({ id: "s2", dispatch_loop: "backtest" }, [e1, e2]), null);
	const t = buildResearchTree("qr", [e1, e2], [{ id: "s1", dispatch_loop: "backtest", dataset_id: "tape_covered_v1" }]);
	const sug = t.nodes.find((n) => n.id === "sug:s1")!;
	eq([sug.parent, sug.depth], ["exp:backtest_evidence", 2]);
	eq(t.edges.find((e) => e.target === "sug:s1")?.label, "suggested next");
});
check("forked_from draws experiment → experiment, deeper", () => {
	const child = { ...won, id: "readability_v2", forked_from: "readability_lift" } as unknown as MeExperiment;
	const t = buildResearchTree("doc", [child, won], []);
	const n = t.nodes.find((x) => x.id === "exp:readability_v2")!;
	eq([n.parent, n.depth], ["exp:readability_lift", 2]);
	eq(t.edges.find((e) => e.target === "exp:readability_v2")?.label, "forked from");
	eq(t.nodes.find((x) => x.id === "ver:readability_v2:plain_style")?.depth, 3);
});
check("summary line", () => eq(mapSummary([kol, won], props), "2 experiments · 5 versions tried · 1 suggested"));

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
