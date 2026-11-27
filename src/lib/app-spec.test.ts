// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { readAppSpec, addWorkflows, setWorkflowNode, addNode, renameNode, moveNode, removeNode, setFeedback, nodeIdFrom, chainStages } from "./app-spec";

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

const V2 = `# MLSys Research — the simple scheme
name: mlsys-research
title: MLSys Research
compute: {site: office}
workflows:
  - id: simulate          # the simulator
    title: Simulate
    run: manual
    steps: {python: simulate}
    inputs: {task: "9.2"}
    feedback:
      - step: simulator
        metrics: [{name: objective, better: higher, target: 1}]
  - id: coach
    helper: true
    steps: {python: coach}
nodes:
  - {id: real_gpu, title: On a real GPU, parent: simulate}
`;
const LEGACY = `name: quant-research
display_name: Quant Research
loops:
- name: backtest
  schedule: 5 */2 * * *
  engine: {type: command, module: backtest, site: home}
  metrics: {primary: real_tape_rate}
- name: send_universe_refresh_fast
  scope: operator
  schedule: '*/10 * * * *'
- name: kol_score_fleet
  schedule: '@trigger'
  engine: {type: lumilake, workflow: kol_score, hardware: {gpu_memory: 16Gi}}
`;

check("reads the simple scheme", () => {
	const sp = readAppSpec(V2);
	eq(sp.title, "MLSys Research");
	eq(sp.workflows.map((w) => w.id), ["simulate", "coach"]);
	const sim = sp.workflows[0];
	eq([sim.title, sim.run, sim.steps, sim.legacy], ["Simulate", "manual", { python: "simulate" }, false]);
	eq(sim.feedback, [{ step: "simulator", metrics: [{ name: "objective", better: "higher", target: 1 }] }]);
	eq(sp.workflows[1].helper, true);
	eq(sp.nodes, [{ id: "real_gpu", title: "On a real GPU", parent: "simulate" }]);
});
check("reads the older loops scheme into the same shape", () => {
	const sp = readAppSpec(LEGACY);
	eq(sp.title, "Quant Research");
	const [bt, ref, kol] = sp.workflows;
	eq([bt.id, bt.run, bt.steps, bt.compute, bt.primary, bt.legacy], ["backtest", "5 */2 * * *", { python: "backtest" }, { site: "home" }, "real_tape_rate", true]);
	eq(ref.helper, true); // scope: operator is housekeeping
	eq([kol.run, kol.steps, kol.compute], ["manual", { dag: "kol_score" }, { gpu: "16Gi" }]);
});
check("never throws on junk", () => { eq(readAppSpec("::: [").workflows, []); eq(readAppSpec("").nodes, []); });

check("add a variant in a new node: run manual, comments kept", () => {
	const out = addWorkflows(V2, [{ id: "sandbox", parent: "simulate", node: "sandbox_node", steps: { python: "sandbox" }, compute: { site: "home", gpu: "24Gi" },
		feedback: [{ step: "simulator", metrics: [{ name: "objective", better: "higher" }] }, { step: "sandbox", metrics: [{ name: "ttft_p99_ms", better: "lower" }] }] }],
		{ id: "sandbox_node", title: "Sandbox", parent: "simulate" });
	if (!out.includes("# the simulator") || !out.includes("# MLSys Research")) throw new Error("comments lost");
	const sp = readAppSpec(out);
	const sb = sp.workflows.find((w) => w.id === "sandbox")!;
	eq([sb.parent, sb.node, sb.run, sb.compute, sb.feedback.length], ["simulate", "sandbox_node", "manual", { site: "home", gpu: "24Gi" }, 2]);
	eq(sp.nodes.map((n) => n.id), ["real_gpu", "sandbox_node"]);
});
check("add refuses bad ids, duplicates and unknown parents", () => {
	throws(() => addWorkflows(V2, [{ id: "Bad Id", steps: {} }]), /can't be a workflow id/);
	throws(() => addWorkflows(V2, [{ id: "simulate", steps: {} }]), /already a workflow/);
	throws(() => addWorkflows(V2, [{ id: "x", parent: "ghost", steps: {} }]), /no workflow "ghost"/);
});
check("add works on an older spec too (lands under workflows:)", () => {
	const out = addWorkflows(LEGACY, [{ id: "backtest_short", parent: "backtest", steps: { python: "backtest" } }]);
	eq(readAppSpec(out).workflows.map((w) => w.id), ["backtest", "send_universe_refresh_fast", "kol_score_fleet", "backtest_short"]);
});
check("move into a node, back out, and on an older loop", () => {
	let out = setWorkflowNode(V2, "coach", "real_gpu");
	eq(readAppSpec(out).workflows[1].node, "real_gpu");
	out = setWorkflowNode(out, "coach", null);
	eq(readAppSpec(out).workflows[1].node, undefined);
	throws(() => setWorkflowNode(V2, "coach", "ghost"), /No node/);
	const leg = addNode(LEGACY, "Sweeps", "backtest");
	eq(readAppSpec(setWorkflowNode(leg.text, "kol_score_fleet", leg.id)).workflows[2].node, "sweeps");
});
check("nodes: add (unique id), rename, move (no cycles), remove (members move up)", () => {
	eq(nodeIdFrom("On a real GPU", ["on_a_real_gpu"]), "on_a_real_gpu_2");
	const a = addNode(V2, "Tuned", "real_gpu");
	let out = renameNode(a.text, "real_gpu", "Sandbox");
	eq(readAppSpec(out).nodes.find((n) => n.id === "real_gpu")?.title, "Sandbox");
	throws(() => moveNode(out, "real_gpu", a.id), /inside itself/);
	out = setWorkflowNode(out, "coach", a.id);
	out = removeNode(out, a.id);
	const sp = readAppSpec(out);
	eq(sp.nodes.map((n) => n.id), ["real_gpu"]);
	eq(sp.workflows.find((w) => w.id === "coach")?.node, "real_gpu"); // moved up to the removed node's parent node
	out = removeNode(out, "real_gpu");
	eq(readAppSpec(out).workflows.find((w) => w.id === "coach")?.node, undefined); // parent was a workflow: directly under it
});
check("feedback edits replace the steps", () => {
	const out = setFeedback(V2, "simulate", [{ step: "simulator", metrics: [{ name: "objective", better: "higher", target: 2 }] }, { step: "sandbox", metrics: [{ name: "ttft_p99_ms", better: "lower" }] }]);
	const fb = readAppSpec(out).workflows[0].feedback;
	eq([fb.length, fb[0].metrics[0].target, fb[1].metrics[0].better], [2, 2, "lower"]);
	eq(readAppSpec(setFeedback(V2, "simulate", [])).workflows[0].feedback, []);
});

check("chains: reads steps.workflows (ids and {use, inputs})", () => {
	const text = V2.replace("nodes:", `  - id: chain_x
    steps:
      workflows:
        - simulate
        - {use: coach, inputs: {days: 7}}
        - {inputs: {lost: 1}}   # no workflow named: dropped
nodes:`);
	const w = readAppSpec(text).workflows.find((x) => x.id === "chain_x")!;
	eq(w.steps, { workflows: ["simulate", { use: "coach", inputs: { days: 7 } }] });
	eq(chainStages(w.steps), [{ use: "simulate", inputs: {} }, { use: "coach", inputs: { days: 7 } }]);
	eq(w.run, "manual");
});
check("chains: addWorkflows writes steps.workflows, run manual, comments kept", () => {
	const out = addWorkflows(V2, [{
		id: "sim_then_coach", title: "Simulate, then coach",
		steps: { workflows: ["simulate", { use: "coach", inputs: { days: 7 } }, { use: "simulate", inputs: {} }] },
		feedback: [{ step: "simulator", metrics: [{ name: "objective", better: "higher" }] }],
	}]);
	if (!out.includes("# the simulator") || !out.includes("# MLSys Research")) throw new Error("comments lost");
	const w = readAppSpec(out).workflows.find((x) => x.id === "sim_then_coach")!;
	// A stage with no changed inputs is written as its bare id.
	eq([w.run, w.steps, w.feedback.length], ["manual", { workflows: ["simulate", { use: "coach", inputs: { days: 7 } }, "simulate"] }, 1]);
	if (!/workflows:\n\s+- simulate\n\s+- use: coach\n\s+inputs:\n\s+days: 7/.test(out)) throw new Error(`unexpected YAML:\n${out}`);
});
check("chains: refuses an unknown stage, itself, and an empty chain", () => {
	throws(() => addWorkflows(V2, [{ id: "c", steps: { workflows: ["ghost"] } }]), /no workflow "ghost" to chain/);
	throws(() => addWorkflows(V2, [{ id: "c", steps: { workflows: ["simulate", "c"] } }]), /stage of itself/);
	throws(() => addWorkflows(V2, [{ id: "c", steps: { workflows: [] } }]), /at least one workflow/);
	// A stage may be a workflow added earlier in the same batch.
	const out = addWorkflows(V2, [{ id: "a", steps: { python: "a" } }, { id: "c", steps: { workflows: ["a", "simulate"] } }]);
	eq(readAppSpec(out).workflows.find((x) => x.id === "c")!.steps, { workflows: ["a", "simulate"] });
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ app-spec: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
