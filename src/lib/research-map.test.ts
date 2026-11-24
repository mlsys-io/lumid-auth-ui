// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
// Fixtures are trimmed copies of real lum.id experiments (2026-11-24).
import type { MeExperiment } from "@/api/me";
import { humanId, experimentStatus, versionsOf, criteriaInWords, buildResearchTree, pathTo, mapSummary, comparabilityNote, type Proposal } from "./research-map";

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
