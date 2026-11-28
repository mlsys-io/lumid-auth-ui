// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
// Fixtures are trimmed copies of real lum.id experiments (2026-11-24).
import type { MeExperiment } from "@/api/me";
import { appPages, pageHref } from "./app-pages";
import { humanId, experimentStatus, versionsOf, criteriaInWords, buildResearchTree, pathTo, mapSummary, comparabilityNote, suggestionParent, experimentLoop, versionsToRun, proposalCheck, shortStatus, batchProgress, type Proposal } from "./research-map";

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
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "backtest failed its last 5 run(s): HTTP 500" } as MeExperiment), { tone: "failing", text: "Stuck — the workflow that runs it is failing" });
	// Never ran, or waits to be dispatched: not started, not failing.
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "no run of screen has been recorded yet" } as MeExperiment), { tone: "idle", text: "Not started yet — none of its versions has run" });
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "it runs only when dispatched, and nothing has dispatched it yet" } as MeExperiment).tone, "idle");
	eq(experimentStatus({ ...fresh, unfed: true } as MeExperiment).text, "Can't start — no workflow runs it");
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
// The quant app as it reads (trimmed): 4 research workflows, helpers that fold.
const qrWfs = [
	{ id: "backtest" }, { id: "backtest_poll", parent: "backtest", helper: true },
	{ id: "kol_strategy" }, { id: "kol_poll", parent: "kol_strategy", helper: true },
	{ id: "harvest_outbox", helper: true }, { id: "analyze", helper: true },
	{ id: "short_window", parent: "backtest", node: "windows" }, { id: "long_window", parent: "backtest", node: "windows" },
	{ id: "short_window_2", parent: "short_window" },
];
const qrNodes = [{ id: "windows", title: "Window sweeps", parent: "backtest" }];
const kolOnLoop = { ...kol, dispatch: { loop: "kol_strategy" }, loops: ["kol_strategy", "kol_poll"] } as unknown as MeExperiment;
check("tree: app → workflows → experiments → versions; suggestions on their workflow", () => {
	const t = buildResearchTree("quant-research", [kolOnLoop, won], [{ id: "symbol_over_signal", hypothesis: "h", dispatch_loop: "kol_strategy" }, { id: "kol_alpha", hypothesis: "dup" }], qrWfs, qrNodes);
	eq(t.nodes.filter((n) => n.kind === "workflow" && n.depth === 1).map((n) => n.ref), ["backtest", "kol_strategy"]);
	eq(t.nodes.find((n) => n.id === "exp:kol_alpha")?.parent, "wf:kol_strategy");
	eq(t.nodes.find((n) => n.id === "exp:kol_alpha")?.depth, 2);
	eq(t.nodes.find((n) => n.id === "ver:kol_alpha:musk_v1")?.depth, 3);
	eq(t.nodes.find((n) => n.id === "exp:readability_lift")?.parent, "app:quant-research"); // its workflow isn't drawn
	eq(t.nodes.filter((n) => n.kind === "suggested").map((n) => [n.ref, n.parent]), [["symbol_over_signal", "wf:kol_strategy"]]);
	eq(t.edges.find((e) => e.target === "sug:symbol_over_signal")?.dashed, true);
});
check("tree: helpers fold; parentless helpers gather in Other workflows", () => {
	const t = buildResearchTree("q", [], [], qrWfs, qrNodes);
	eq(t.nodes.some((n) => n.ref === "backtest_poll" || n.ref === "kol_poll"), false);
	eq(t.nodes.find((n) => n.id === "node:__other")?.depth, 1);
	eq(t.nodes.some((n) => n.ref === "harvest_outbox"), false);
});
check("tree: a node holds the variants moved into it; variants nest; edges say 'variant'", () => {
	const t = buildResearchTree("q", [], [], qrWfs, qrNodes);
	const at = (id: string) => { const n = t.nodes.find((x) => x.id === id)!; return [n.parent, n.depth]; };
	eq(at("node:windows"), ["wf:backtest", 2]);
	eq(at("wf:short_window"), ["node:windows", 3]);
	eq(at("wf:long_window"), ["node:windows", 3]);
	eq(at("wf:short_window_2"), ["wf:short_window", 4]);
	eq(t.edges.find((e) => e.target === "wf:short_window_2")?.label, "variant");
});
check("tree: cycles and unknown parents fall back to the app", () => {
	const t = buildResearchTree("q", [], [], [{ id: "a" }, { id: "b", parent: "ghost" }], [{ id: "n1", title: "N1", parent: "n2" }, { id: "n2", title: "N2", parent: "n1" }]);
	eq(t.nodes.find((n) => n.id === "wf:b")?.parent, "app:q");
	for (const id of ["node:n1", "node:n2"]) if (!(t.nodes.find((n) => n.id === id)!.depth >= 1)) throw new Error(id);
});
check("path: root to a version, and an experiment lights its versions", () => {
	const t = buildResearchTree("qr", [kolOnLoop], [], [{ id: "kol_strategy" }]);
	eq([...pathTo(t.nodes, "ver:kol_alpha:musk_v1")].sort(), ["app:qr", "exp:kol_alpha", "ver:kol_alpha:musk_v1", "wf:kol_strategy"]);
	eq(pathTo(t.nodes, "exp:kol_alpha").size, 6); // app, workflow, experiment, 3 versions
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
check("a suggestion's closest experiment (2 of loop/dataset/metric)", () => {
	const e1 = { ...kol, id: "kol_alpha", dispatch: { loop: "kol_strategy" }, loops: ["kol_strategy"], dataset_id: "musk_tweets_v1" } as unknown as MeExperiment;
	const e2 = { ...won, id: "backtest_evidence", dispatch: { loop: "backtest" }, dataset_id: "tape_covered_v1", metric: { name: "real_tape" } } as unknown as MeExperiment;
	eq(suggestionParent({ id: "s1", dispatch_loop: "backtest", dataset_id: "tape_covered_v1" }, [e1, e2]), "backtest_evidence");
	eq(suggestionParent({ id: "s2", dispatch_loop: "backtest" }, [e1, e2]), null);
});
check("runs started by hand, no version run: say so, not 'records no results'", () => {
	eq(experimentStatus({ ...fresh, unrecorded: true } as MeExperiment).text, "None of its versions has run yet");
	eq(experimentStatus({ ...fresh, arms: [], unrecorded: true } as unknown as MeExperiment).text, "Its workflow runs but records no results");
});
check("which versions a Run button starts, and from which workflow", () => {
	eq(versionsToRun(fresh), { ids: ["a", "b"], untried: true });
	eq(versionsToRun(kol), { ids: ["current", "musk_v1", "musk_llm_scored"], untried: false });
	// Measured centrally for everyone: nothing for this install to run.
	eq(versionsToRun({ ...kol, shared: true } as MeExperiment), { ids: [], untried: false });
	eq(versionsToRun({ ...kol, variants: { current: { n: 3, mean: 1 } } } as unknown as MeExperiment), { ids: ["musk_v1", "musk_llm_scored"], untried: true });
	eq(experimentLoop({ ...kol, dispatch: { loop: "kol_poll" }, loops: ["kol_strategy", "kol_poll"] } as unknown as MeExperiment), "kol_poll");
	eq(experimentLoop({ ...kol, dispatch: { loop: "other" }, loops: ["kol_strategy"] } as unknown as MeExperiment), "kol_strategy");
});
check("summary line counts only versions that actually ran", () => {
	eq(mapSummary([kol, won], props), "2 experiments · 5 versions tried · 1 suggested");
	eq(mapSummary([fresh], []), "1 experiment · 2 versions, none tried yet");
	eq(mapSummary([kol, fresh], []), "2 experiments · 3 of 5 versions tried");
	eq(mapSummary([kolOnLoop], [], qrWfs), "2 workflows · 3 variants · 1 experiment");
});

check("proposal check in words", () => {
	eq(proposalCheck({ id: "a", verdict: "will_collect" } as Proposal)?.tone, "ok");
	eq(proposalCheck({ id: "a", verdict: "will_be_invisible", verdict_reason: "no metric named real_tape" } as Proposal)?.text, "It would run but record nothing: no metric named real_tape");
	eq(proposalCheck({ id: "a", verdict: "unchecked", verdict_reason: "sandboxed turn" } as Proposal)?.text, "Not checked yet whether it would record results.");
	eq(proposalCheck({ id: "a" } as Proposal), null);
});

check("app pages always lead with the home", () => {
	// Research is always the first tab; an app's own home is an ordinary tab after it.
	eq(appPages([{ surface: "strategies", label: "Strategies" }, { surface: "data", label: "Data" }]).map((t) => t.label), ["Research", "Strategies", "Data"]);
	eq(appPages([{ surface: "home", label: "Work" }, { surface: "workflows" }]).map((t) => t.label), ["Research", "Work", "workflows"]);
	eq(appPages([{ surface: "home" }]).map((t) => `${t.label}:${t.home}`), ["Research:true", "Overview:false"]);
	eq(appPages([], true).map((t) => t.surface), ["research", "home"]);
	eq(appPages([], false).map((t) => t.surface), ["research"]);
	eq(appPages([{ surface: "data", label: "Data" }], true).map((t) => t.label), ["Research", "Data"]);
	eq(appPages([{ surface: "home", label: "Work" }], true).map((t) => t.label), ["Research", "Work"]);
	eq(pageHref("m", appPages([], true)[1], true), "/studio/apps/m?surface=home");
	eq(pageHref("quant-research", appPages([])[0], true), "/studio/apps/quant-research");
	eq(pageHref("q", { surface: "data", label: "Data", home: false }, true), "/studio/apps/q?surface=data");
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
check("batchProgress reads a queued batch back in words", () => {
	const rows = [
		{ req_id: "a:0", state: "done", branch_label: "llm_1_7b" },
		{ req_id: "b:0", state: "running", branch_label: "llm_0_6b" },
	];
	const p = batchProgress(rows, ["a", "b", "c"], ["1.7B", "0.6B", "4B"]);
	eq(p.runs.map((r) => r.state).join(","), "done,running,waiting");
	eq(p.text, "Running 1 of 3 · 1 waiting · 1 done");
	eq(p.finished, false);
	const q = batchProgress([{ req_id: "a:0", state: "done" }, { req_id: "b:0", state: "failed", last_error: "no GPU" }], ["a", "b"], ["x", "y"]);
	eq(q.finished, true);
	eq(q.text, "1 finished, 1 failed: no GPU");
	eq(batchProgress([], ["a"], ["x"]).text, "1 run queued — waiting for a free machine");
	// The queue names its rows eq_…; the batch is found by experiment + version + time.
	const byRows = [
		{ req_id: "eq_1", state: "done", experiment_id: "kol", branch_label: "musk_v1", submitted_at: 1000 },
		{ req_id: "eq_2", state: "running", experiment_id: "kol", branch_label: "current", submitted_at: 1001 },
		{ req_id: "eq_0", state: "done", experiment_id: "kol", branch_label: "current", submitted_at: 100 },
	];
	const r = batchProgress(byRows, ["u1", "u2"], ["Musk v1", "Current"], { experiment: "kol", versions: ["musk_v1", "current"], sentAt: 999 });
	eq(r.runs.map((x) => x.state), ["done", "running"]);
	eq(r.text, "Running 1 of 2 · 1 done");
	eq(batchProgress([{ req_id: "a:0", state: "done" }], ["a"], ["x"]).text, "All 1 run finished — results added.");
});

check("shortStatus keeps the first clause", () => {
	const e = { id: "kol_alpha", n_results: 10, comparable: false, instruments: 18 } as unknown as MeExperiment;
	eq(shortStatus(e).text, "Can't compare yet");
	const won = { id: "x", status: "concluded", best_variant: "musk_v1", criteria_met: true, n_results: 5 } as unknown as MeExperiment;
	eq(shortStatus(won).text, `${humanId("musk_v1")} won`);
});

export const caseCount = checks.length;
