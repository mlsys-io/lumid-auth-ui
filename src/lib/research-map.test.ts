// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
// Fixtures are trimmed copies of real lum.id experiments (2026-11-24).
import type { MeExperiment } from "@/api/me";
import { appPages, pageHref } from "./app-pages";
import { roundOver, humanId, inSentence, experimentStatus, versionsOf, nextStepWords, tiedAtTop, criteriaInWords, buildResearchTree, pathTo, mapSummary, comparabilityNote, suggestionParent, experimentLoop, versionsToRun, triedVersions, settingRows, experimentLabel, proposalCheck, shortStatus, batchProgress, type Proposal } from "./research-map";

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
check("ids keep their decimals", () => {
	eq(humanId("llm_1_7b").includes("1.7b"), true);
	eq(humanId("util_0_95").includes("0.95"), true);
	eq(humanId("llm_0_6b").includes("0.6b"), true);
	eq(humanId("run_2026_11_28").includes("2026.11"), false);
	eq(humanId("mom_6_1").includes("6.1"), false);
	eq(humanId("qwen3_8b").includes("3.8"), false);
	eq(humanId("baseline_momentum_12_1").includes("12.1"), false);
});
check("status: not comparable, in words", () => eq(experimentStatus(kol), { tone: "attention", text: "Can't compare yet — the versions ran under 18 different setups" }));
check("status: confirmed winner", () => eq(experimentStatus(won), { tone: "ok", text: "Winning: Plain style" }));
check("status: never ran / starved / unfed", () => {
	eq(experimentStatus(fresh).text, "Not started yet");
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "backtest failed its last 5 run(s): HTTP 500" } as MeExperiment).tone, "failing");
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "backtest failed its last 5 run(s): HTTP 500" } as MeExperiment).text.startsWith("Stuck — Backtest failed its last 5 runs: "), true);
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "screen failed its last 1 run(s)" } as MeExperiment).text, "Stuck — Screen failed its last run");
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "something failed oddly" } as MeExperiment).text, "Stuck — the workflow that runs it is failing");
	// Never ran, or waits to be dispatched: not started, not failing.
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "no run of screen has been recorded yet" } as MeExperiment), { tone: "idle", text: "Not started yet — none of its versions has run" });
	// Rows from earlier steps, none carrying the metric yet: under way, not "not started".
	eq(experimentStatus({ ...fresh, starved: true, starved_reason: "no run of screen has been recorded yet", n_rows_total: 16, metric: { name: "oos_sharpe" } } as MeExperiment), { tone: "running", text: "Under way — 16 results so far, none with OOS sharpe yet" });
	eq(experimentStatus({ ...fresh, n_rows_total: 1 } as MeExperiment).text, "Under way — 1 result so far, none with the experiment's own number yet");
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
	// A version stopped at its first gate ran: it is not "untried".
	eq(versionsToRun(fresh, triedVersions([{ variant_id: "a" }, { variant_id: "a" }])), { ids: ["b"], untried: true });
	eq(versionsToRun(fresh, ["a", "b"]), { ids: ["a", "b"], untried: false });
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

check("settings: an object input reads as key: value rows, meta fields aren't settings", () => {
	eq(settingRows({ id: "v", about: "x", title: "T", overrides: { "deployments.model": "llm-0.6b", "serving.max_concurrency": 16 }, task: "9.2", tags: ["a", "b"] }),
		[["Overrides · deployments.model", "llm-0.6b"], ["Overrides · serving.max_concurrency", "16"], ["Task", "9.2"], ["Tags", "a, b"]]);
	eq(settingRows(undefined), []);
});
check("a version's title wins over its id", () => {
	const e = { id: "x", arms: [{ id: "serve_9_2_c16", title: "9.2 at c16" }, { id: "mom_6_1" }], variants: {} } as unknown as MeExperiment;
	eq(versionsOf(e).map((v) => v.label), ["9.2 at c16", "Mom 6 1"]);
});

check("an experiment's title wins over its id", () => {
	eq(experimentLabel({ id: "serve_9_2", title: "Serve 9.2" }), "Serve 9.2");
	eq(experimentLabel({ id: "strategy_search" }), "Strategy search");
	eq(experimentLabel({ id: "x_y", title: "  " }), "X y");
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

check("gated chains: nothing leads when the best failed its step; stopped versions say so", () => {
	const e = { id: "fs", metric: { name: "oos_sharpe" }, n_results: 3, best_variant: "q", best_failed_gate: true, best_stopped_at: "robustness",
		arms: [{ id: "q" }, { id: "p" }, { id: "v" }],
		variants: { q: { n: 1, mean: 0.42 }, p: { n: 1, mean: -0.45 } },
		gate_progress: { q: { reached: "robustness", index: 3, passed: false }, p: { reached: "robustness", index: 3, passed: false }, v: { reached: "bar_backtest", index: 2, passed: false } } } as unknown as MeExperiment;
	eq(experimentStatus(e), { tone: "attention", text: "No version passed every step — the furthest stopped at Robustness" });
	const tags = Object.fromEntries(versionsOf(e).map((v) => [v.id, v.tag]));
	eq(tags, { q: "stopped at Robustness", p: "stopped at Robustness", v: "stopped at Bar backtest" });
	eq(nextStepWords(e, ["data_check", "bar_backtest", "robustness"]),
		"This round is over: none of the 3 versions passed every step. Next: add new versions — each one counts as another try.");
});

check("gated chains: the next move is said in words", () => {
	const steps = ["data_check", "bar_backtest", "robustness"];
	const held = { id: "x", arms: [{ id: "a" }, { id: "b" }, { id: "c" }],
		gate_progress: { a: { reached: "bar_backtest", index: 2, passed: true }, b: { reached: "bar_backtest", index: 2, passed: true }, c: { reached: "bar_backtest", index: 2, passed: false } } } as unknown as MeExperiment;
	eq(nextStepWords(held, steps), "Next: 2 versions passed Bar backtest — run them through Robustness.");
	// Ran but scored nothing is not "untried" (the Run button said "once more").
	const ran = { id: "x", arms: [{ id: "a" }, { id: "b" }], variants: { a: { n: 1, mean: 1 } }, metric: { name: "goodput" } } as unknown as MeExperiment;
	eq([humanId("profit_gpa"), humanId("oos_sharpe"), humanId("dsr_p")], ["Profit GPA", "OOS sharpe", "DSR p"]);
	eq([inSentence("OOS sharpe"), inSentence("Goodput"), inSentence("PnL"), inSentence("TTFT p99")], ["OOS sharpe", "goodput", "PnL", "TTFT p99"]);
	{
		const gp = (a: boolean, b: boolean) => ({ id: "r", arms: [{ id: "a" }, { id: "b" }], gate_progress: { a: { reached: "x", index: 1, passed: a }, b: { reached: "y", index: 2, passed: b } } }) as unknown as MeExperiment;
		eq([roundOver(gp(false, false)), roundOver(gp(true, false)), roundOver({ id: "u", arms: [{ id: "a" }] } as unknown as MeExperiment)], [true, false, false]);
		const untried = { id: "r", arms: [{ id: "a" }, { id: "c" }], gate_progress: { a: { reached: "x", index: 1, passed: false } } } as unknown as MeExperiment;
		eq(roundOver(untried), false);
	}
	eq(nextStepWords(ran, ["simulate"]), "Next: run the 1 untried version — the cheap steps first.");
	eq(nextStepWords(ran, ["simulate"], ["a", "b"]), "Next: 1 version ran but recorded no goodput — open it to see why before running it again.");
	eq(versionsOf(ran, ["b"]).find((v) => v.id === "b")?.tag, "ran, no score");
	eq(versionsOf(ran).find((v) => v.id === "b")?.tag, "not run yet");
	const untried = { id: "y", arms: [{ id: "a" }, { id: "b" }] } as unknown as MeExperiment;
	eq(nextStepWords(untried, steps), "Next: run the 2 untried versions — the cheap steps first.");
	const done = { id: "z", arms: [{ id: "a" }], gate_progress: { a: { reached: "robustness", index: 3, passed: true } } } as unknown as MeExperiment;
	eq(nextStepWords(done, steps).startsWith("1 version passed every step."), true);
	eq(nextStepWords(untried, []), "");
});

check("gated chains: when another version passed where the top one failed, say so", () => {
	const e = { id: "fs", metric: { name: "oos_sharpe" }, n_results: 2, best_variant: "q", best_failed_gate: true, best_stopped_at: "robustness",
		variants: { q: { n: 1, mean: 0.9 }, p: { n: 1, mean: 0.3 } },
		gate_progress: { q: { reached: "robustness", index: 3, passed: false }, p: { reached: "robustness", index: 3, passed: true } } } as unknown as MeExperiment;
	eq(experimentStatus(e), { tone: "running", text: "The top result didn't pass Robustness — 1 other version did" });
});

check("ties: equal top means read 'Tied', not 'leads'", () => {
	const e = { id: "t", metric: { name: "goodput_tok_s" }, n_results: 3, best_variant: "c16",
		variants: { c32: { n: 1, mean: 22.4 }, c16: { n: 1, mean: 22.4 }, c8: { n: 1, mean: 22.4 } } } as unknown as MeExperiment;
	eq(tiedAtTop(e).length, 3);
	eq(experimentStatus(e), { tone: "running", text: "Tied — 3 versions score the same so far" });
	eq(versionsOf(e).map((v) => v.tag), ["tied", "tied", "tied"]);
	const lead = { ...e, variants: { c32: { n: 1, mean: 22.4 }, c16: { n: 1, mean: 23.0 } } } as unknown as MeExperiment;
	eq(tiedAtTop(lead), []);
});

check("settings: nested keys read as words with their unit", () => {
	eq(settingRows({ spec: { universe: "top_n_dollar_volume:500", costs: { bps: 1, half_spread_bps: 2 } } }),
		[["Spec · universe", "top_n_dollar_volume:500"], ["Costs · bps", "1"], ["Costs · half spread (bps)", "2"]]);
});

export const caseCount = checks.length;

