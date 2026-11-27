// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { readAppSpec, addWorkflows } from "./app-spec";
import {
	idProblem, suggestId, inputRowsFrom, inputValue, inputsFrom, dagPath, codePath, cleanFeedback,
	buildVariants, describePrompt, saveErrorWords, type VariantForm,
	buildChain, chainRowFor, chainStageFrom, chainFeedback, chainable, chainEnabled, passesOn,
	newWorkflowName, createsSentence, createdToast, newWorkflowChatPrompt, definitionLines,
} from "./variant-form";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function throws(fn: () => unknown, re: RegExp) {
	try { fn(); } catch (e) { if (re.test(String((e as Error).message))) return; throw new Error(`wrong error: ${(e as Error).message}`); }
	throw new Error("expected an error");
}

const SPEC = `name: mlsys-research
workflows:
  - id: simulate
    run: manual
    steps: {python: simulate}
    inputs: {task: "9.2", rounds: 3, fast: true, grid: [1, 2]}
    data: [kernels]
    compute: {site: office}
    feedback:
      - step: simulator
        metrics: [{name: objective, better: higher, target: 1}]
  - id: graph
    run: "0 * * * *"
    steps: {dag: graph}
nodes:
  - {id: real_gpu, title: On a real GPU, parent: simulate}
`;
const spec = readAppSpec(SPEC);
const sim = spec.workflows[0];
const base = (over: Partial<VariantForm> = {}): VariantForm => ({
	change: "same",
	rows: [{ id: "simulate_fast", title: "Fast", inputs: inputRowsFrom(sim.inputs) }],
	data: sim.data, compute: sim.compute, feedback: sim.feedback,
	placement: { mode: "under" },
	...over,
});

check("ids follow addWorkflows' rule", () => {
	eq(idProblem("ok_1", []), null);
	eq(!!idProblem("", []), true);
	eq(!!idProblem("Bad-Id", []), true);
	eq(!!idProblem("1x", []), true);
	eq(!!idProblem("x".repeat(49), []), true);
	eq(idProblem("simulate", ["simulate"]), `There is already a workflow called "simulate"`);
	eq(idProblem("a", [], ["a"]), "Two variants here have the same id");
});
check("suggested ids are free and valid", () => {
	eq(suggestId("simulate", ["simulate"]), "simulate_variant");
	eq(suggestId("simulate", ["simulate_variant"]), "simulate_variant_2");
	eq(suggestId("", []), "new_workflow");
	eq(idProblem(suggestId("x".repeat(60), []), []), null);
});
check("inputs keep the parent's types", () => {
	eq(inputRowsFrom(sim.inputs), [{ key: "task", value: "9.2" }, { key: "rounds", value: "3" }, { key: "fast", value: "true" }, { key: "grid", value: "[1,2]" }]);
	eq(inputValue("9.3", "9.2"), "9.3");
	eq(inputValue("5", 3), 5);
	eq(inputValue("no", true), false);
	eq(inputValue("[3]", [1]), [3]);
	throws(() => inputValue("abc", 3), /not a number/);
	throws(() => inputValue("maybe", true), /true or false/);
	eq(inputValue("4", undefined), 4); // new input: YAML
	eq(inputValue("hello", undefined), "hello");
	eq(inputsFrom([{ key: " task ", value: "10" }, { key: "", value: "x" }], sim.inputs), { task: "10" });
	throws(() => inputsFrom([{ key: "a", value: "1" }, { key: "a", value: "2" }]), /listed twice/);
	throws(() => inputsFrom([{ key: "rounds", value: "many" }], sim.inputs), /Input "rounds"/);
});
check("definition file paths", () => {
	eq([dagPath("graph"), dagPath("graph.yaml"), dagPath("workflows/graph"), dagPath("./workflows/g.yml")], ["workflows/graph.yaml", "workflows/graph.yaml", "workflows/graph.yaml", "workflows/g.yml"]);
	eq([codePath("simulate"), codePath("commands/simulate.py")], ["commands/simulate.py", "commands/simulate.py"]);
});
check("feedback drops blanks, keeps a step with no metrics", () => {
	eq(cleanFeedback([{ step: " sandbox ", metrics: [{ name: "", better: "higher" }, { name: "ttft", better: "lower", target: NaN }] }, { step: "", metrics: [] }, { step: "judge", metrics: [] }]),
		[{ step: "sandbox", metrics: [{ name: "ttft", better: "lower" }] }, { step: "judge", metrics: [] }]);
});
check("same steps: reuses the parent's steps, no file, run manual", () => {
	const b = buildVariants(base({ rows: [{ id: "simulate_fast", title: " Fast ", inputs: [{ key: "task", value: "9.3" }] }] }), spec, sim);
	eq(b.files, []);
	eq(b.node, undefined);
	eq(b.entries[0], { id: "simulate_fast", title: "Fast", parent: "simulate", steps: { python: "simulate" }, inputs: { task: "9.3" }, data: ["kernels"], compute: { site: "office" }, feedback: sim.feedback });
	const w = readAppSpec(addWorkflows(SPEC, b.entries, b.node)).workflows.find((x) => x.id === "simulate_fast");
	eq([w?.run, w?.parent, w?.inputs.task], ["manual", "simulate", "9.3"]);
});
check("edited steps: one DAG file named after the first variant, shared", () => {
	const b = buildVariants(base({ change: "steps", dagText: "ops: []", rows: [{ id: "a", title: "", inputs: [] }, { id: "b", title: "", inputs: [] }] }), spec, sim);
	eq(b.files, [{ path: "workflows/a.yaml", content: "ops: []\n" }]);
	eq(b.entries.map((e) => e.steps), [{ dag: "a" }, { dag: "a" }]);
	eq(b.ids, ["a", "b"]);
	throws(() => buildVariants(base({ change: "steps", dagText: " " }), spec, sim), /steps are empty/);
});
check("edited code: commands/<id>.py", () => {
	const b = buildVariants(base({ change: "code", codeText: "print(1)\n" }), spec, sim);
	eq([b.files[0].path, b.entries[0].steps], ["commands/simulate_fast.py", { python: "simulate_fast" }]);
});
check("placement: new node, existing node, under the parent", () => {
	const n = buildVariants(base({ placement: { mode: "new", title: "Faster sims" } }), spec, sim);
	eq(n.node, { id: "faster_sims", title: "Faster sims", parent: "simulate" });
	eq(n.entries[0].node, "faster_sims");
	const out = readAppSpec(addWorkflows(SPEC, n.entries, n.node));
	eq([out.nodes.length, out.workflows.find((w) => w.id === "simulate_fast")?.node], [2, "faster_sims"]);
	eq(buildVariants(base({ placement: { mode: "into", node: "real_gpu" } }), spec, sim).entries[0].node, "real_gpu");
	throws(() => buildVariants(base({ placement: { mode: "into", node: "nope" } }), spec, sim), /no node "nope"/);
	throws(() => buildVariants(base({ placement: { mode: "new", title: "  " } }), spec, sim), /name/);
	// a node title that collides with a workflow id gets a suffix
	eq(buildVariants(base({ placement: { mode: "new", title: "Graph" } }), spec, sim).node?.id, "graph_2");
});
check("rejects bad and duplicate ids before saving", () => {
	throws(() => buildVariants(base({ rows: [{ id: "simulate", title: "", inputs: [] }] }), spec, sim), /already a workflow/);
	throws(() => buildVariants(base({ rows: [{ id: "x", title: "", inputs: [] }, { id: "x", title: "", inputs: [] }] }), spec, sim), /same id/);
	throws(() => buildVariants(base({ rows: [] }), spec, sim), /at least one/);
});
check("a new workflow with no parent needs steps or code, and no new node", () => {
	throws(() => buildVariants(base(), spec), /needs steps or code/);
	throws(() => buildVariants(base({ change: "code", codeText: "x", placement: { mode: "new", title: "N" } }), spec), /goes under a workflow/);
	const b = buildVariants(base({ change: "code", codeText: "x", rows: [{ id: "fresh", title: "", inputs: [{ key: "n", value: "2" }] }], data: [], compute: {}, feedback: [] }), spec);
	eq(b.entries[0], { id: "fresh", steps: { python: "fresh" }, inputs: { n: 2 }, data: [], compute: {}, feedback: [] });
});
check("describe prompt carries the definition and asks for a proposal", () => {
	const p = describePrompt("mlsys-research", "use 2x rounds", sim);
	for (const want of ["\"simulate\"", "commands/simulate.py", "\"rounds\":3", "kernels", "site office", "objective, better higher, aiming for 1", "use 2x rounds", "proposal", "Start nothing", "run: manual"]) {
		if (!p.includes(want)) throw new Error(`prompt lacks ${want}`);
	}
	const n = describePrompt("app", "");
	if (!n.includes("new workflow") || !n.includes("Start nothing")) throw new Error("no-parent prompt");
});
check("save errors in words", () => {
	eq(saveErrorWords({ status: 409, message: "conflict" }), "The spec changed — try again.");
	eq(saveErrorWords(Object.assign(new Error("nope"), { status: 403 })).startsWith("Only the app's owner"), true);
	eq(saveErrorWords(Object.assign(new Error("x"), { status: 502 })), "The server couldn't save it (HTTP 502) — try again.");
	eq(saveErrorWords(new Error("There is already a workflow called \"a\"")), "There is already a workflow called \"a\"");
});

check("a request that got no answer is said in words", () => {
	eq(saveErrorWords(new TypeError("Failed to fetch")), "Couldn't reach lum.id, so nothing was saved — try again in a moment.");
});

// ── a new workflow, and chains ──

check("new workflow words: name, the sentence before saving, the toast, the chat prompt", () => {
	eq(newWorkflowName("strategy_run"), "Strategy run");
	eq(newWorkflowName("strategy_run", "  Strategy pipeline "), "Strategy pipeline");
	eq(createsSentence("Strategy pipeline", "Quant Research"), "Creates \u2018Strategy pipeline\u2019 in Quant Research. It runs only when you press Run.");
	eq(createdToast("Strategy pipeline"), "Created Strategy pipeline \u2014 run it when you're ready");
	const p = newWorkflowChatPrompt("Quant Research");
	if (/how often|schedule|cron/i.test(p)) throw new Error(`the prompt asks about a schedule: ${p}`);
	if (!/only when I press Run/.test(p)) throw new Error("the prompt doesn't say it runs only when pressed");
});
check("chain stages: unchanged inputs write the bare id; changed ones only the change", () => {
	eq(chainable(spec).map((w) => w.id), ["simulate", "graph"]);
	const row = chainRowFor(sim);
	eq(chainStageFrom(row, sim), "simulate");
	const changed = { ...row, inputs: row.inputs.map((r) => (r.key === "rounds" ? { ...r, value: "7" } : r)).concat([{ key: "days", value: "7" }]) };
	eq(chainStageFrom(changed, sim), { use: "simulate", inputs: { rounds: 7, days: 7 } });
	// A removed input falls back to the workflow's own value: no override.
	eq(chainStageFrom({ ...row, inputs: row.inputs.filter((r) => r.key !== "task") }, sim), "simulate");
});
check("chain: buildChain → addWorkflows writes steps.workflows, run manual, feedback from the last stage", () => {
	const stages = [{ ...chainRowFor(sim), inputs: [{ key: "rounds", value: "5" }] }, chainRowFor(spec.workflows[1]), chainRowFor(sim)];
	eq(chainFeedback(spec, stages).map((f) => f.step), ["simulator"]);
	eq(chainFeedback(spec, stages.slice(0, 2)), []);
	const built = buildChain({ id: "sim_chain", title: "Simulate twice", stages, feedback: chainFeedback(spec, stages), placement: { mode: "into", node: "real_gpu" } }, spec);
	eq(built.files, []);
	const w = readAppSpec(addWorkflows(SPEC, built.entries, built.node)).workflows.find((x) => x.id === "sim_chain")!;
	eq([w.run, w.node, w.title, w.steps], ["manual", "real_gpu", "Simulate twice", { workflows: [{ use: "simulate", inputs: { rounds: 5 } }, "graph", "simulate"] }]);
	eq(w.feedback[0].metrics[0], { name: "objective", better: "higher", target: 1 });
	if (!/workflows simulate → graph → simulate, in order/.test(definitionLines(w)[0])) throw new Error(definitionLines(w)[0]);
});
check("chain: refuses an empty chain, a taken id, a bad input, a vanished workflow", () => {
	const ok = { id: "c", title: "", stages: [chainRowFor(sim)], feedback: [], placement: { mode: "under" as const } };
	throws(() => buildChain({ ...ok, stages: [] }, spec), /at least one workflow/);
	throws(() => buildChain({ ...ok, id: "simulate" }, spec), /already a workflow/);
	throws(() => buildChain({ ...ok, stages: [{ use: "simulate", inputs: [{ key: "rounds", value: "many" }] }] }, spec), /Stage 1 \(Simulate\): Input "rounds": "many" is not a number/);
	throws(() => buildChain({ ...ok, stages: [{ use: "gone", inputs: [] }] }, spec), /no workflow "gone" any more/);
});
check("chain: what passes on, and when the builder is offered", () => {
	const graph = spec.workflows[1];
	eq(passesOn(sim, graph, 2), { line: "Stage 2 can use stage 1's results (Objective) as prev_objective", inputs: ["prev_objective"], uses: [] });
	const reads = { ...graph, inputs: { prev_objective: 0, prev_other: 1, window: 3 } };
	eq(passesOn(sim, reads, 3).uses, ["prev_objective"]);
	eq(passesOn(graph, sim, 2), { line: "Stage 2 runs after stage 1 and can read its results", inputs: [], uses: [] });
	eq([chainEnabled(spec, false), chainEnabled(spec, true)], [false, true]);
	const withChain = readAppSpec(SPEC.replace("nodes:", "  - id: c\n    steps: {workflows: [simulate]}\nnodes:"));
	eq(chainEnabled(withChain, false), true);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ variant-form: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
