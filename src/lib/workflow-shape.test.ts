// Run by scripts/test-workflow.mjs via src/workflow/workflow.test.ts.
import { parse } from "yaml";
import { readAppSpec } from "./app-spec";
import { readShape, setWorkflowShape, shapeChanged, shapeProblems, shapeSavedWords, stepsFile, type WorkflowShape } from "./workflow-shape";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });
function eq(actual: unknown, expected: unknown, what = "") {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }
function throws(fn: () => unknown, re: RegExp) {
	try { fn(); } catch (e) { if (re.test(String((e as Error).message))) return; throw new Error(`wrong error: ${(e as Error).message}`); }
	throw new Error("expected an error");
}

// MLSys's own shape: a Python workflow with flow-style maps and comments, a
// chain of two, and an app-level budget the editor must never touch.
const SPEC = `name: mlsys-research
compute: {site: office, budget: {gpu_minutes: 168, per: total}}
datasets:
- {id: traces, repo: x/traces}
- {id: holdouts, repo: x/holdouts}
workflows:
- id: simulate
  title: Simulate
  run: manual
  steps: {python: simulate}
  # Each run's memory cap.
  compute: {memory: 512Mi}
  inputs: {task: '', base: '', seed: '42'}
  data: [traces]
  knowledge_agent: mlsys-notes
- id: sandbox
  steps: {python: sandbox}
- id: screen
  title: Screen
  run: '@trigger'
  steps:
    workflows: [simulate, {use: sandbox, inputs: {site: office}}]   # cheap first
- id: graph
  steps: {dag: workflows/graph.yaml}
`;

const spec = readAppSpec(SPEC);
const wf = (id: string) => spec.workflows.find((w) => w.id === id)!;
const y = (t: string) => parse(t) as { workflows: Array<Record<string, unknown>>; compute: unknown };
const entry = (t: string, id: string) => y(t).workflows.find((w) => w.id === id)!;

check("reads a Python workflow's whole shape, memory included", () => {
	const s = readShape(wf("simulate"));
	eq(s.kind, "python"); eq(s.python, "simulate"); eq(s.memory, "512Mi"); eq(s.data, ["traces"]);
	eq(s.inputs, [{ name: "task", value: "" }, { name: "base", value: "" }, { name: "seed", value: "42" }]);
	eq(s.run, "manual");
	eq(stepsFile(s), "commands/simulate.py");
});

check("reads a chain's stages with the inputs each was written with", () => {
	const s = readShape(wf("screen"));
	eq(s.kind, "chain");
	eq(s.stages, [{ use: "simulate", inputs: {} }, { use: "sandbox", inputs: { site: "office" } }]);
	eq(stepsFile(s), null);
	eq(stepsFile(readShape(wf("graph"))), "workflows/graph.yaml");
});

check("an unchanged form hands the spec text back untouched", () => {
	for (const id of ["simulate", "screen", "graph", "sandbox"]) eq(setWorkflowShape(SPEC, id, readShape(wf(id))), SPEC, id);
});

check("reordering a chain keeps each stage's inputs and the comment", () => {
	const s = readShape(wf("screen"));
	const out = setWorkflowShape(SPEC, "screen", { ...s, stages: [s.stages[1], s.stages[0]] });
	eq((entry(out, "screen").steps as { workflows: unknown }).workflows, [{ use: "sandbox", inputs: { site: "office" } }, "simulate"]);
	ok(out.includes("# Each run's memory cap."), "other comments kept");
	eq(entry(out, "screen").run, "@trigger", "a manual run keeps the way it was written");
});

check("data, inputs, site and memory change; the app budget and unknown keys don't", () => {
	const s = readShape(wf("simulate"));
	const out = setWorkflowShape(SPEC, "simulate", { ...s, data: ["traces", "holdouts"], inputs: [...s.inputs.filter((i) => i.name !== "base"), { name: "workloads", value: "dev" }], site: "home", memory: "1Gi" });
	const e = entry(out, "simulate");
	eq(e.data, ["traces", "holdouts"]);
	eq(e.inputs, { task: "", seed: "42", workloads: "dev" });
	eq(e.compute, { memory: "1Gi", site: "home" });
	eq(e.knowledge_agent, "mlsys-notes");
	eq(y(out).compute, { site: "office", budget: { gpu_minutes: 168, per: "total" } });
	ok(out.includes("# Each run's memory cap."), "comment above compute kept");
});

check("clearing site and memory removes compute; clearing data removes it", () => {
	const s = readShape(wf("simulate"));
	const e = entry(setWorkflowShape(SPEC, "simulate", { ...s, memory: "", data: [] }), "simulate");
	ok(!("compute" in e), "empty compute removed");
	ok(!("data" in e), "empty data removed");
});

check("a schedule and a renamed Python module are written", () => {
	const s = readShape(wf("sandbox"));
	const e = entry(setWorkflowShape(SPEC, "sandbox", { ...s, python: "sandbox_v2", run: "0 6 * * *" }), "sandbox");
	eq(e.steps, { python: "sandbox_v2" }); eq(e.run, "0 6 * * *");
});

check("problems say what to fix, in words", () => {
	const s = readShape(wf("screen"));
	eq(shapeProblems(s, spec, "screen"), []);
	ok(shapeProblems({ ...s, stages: [] }, spec, "screen")[0].includes("at least one stage"), "empty chain");
	ok(shapeProblems({ ...s, stages: [{ use: "screen", inputs: {} }] }, spec, "screen")[0].includes("can't run itself"), "self");
	ok(shapeProblems({ ...s, stages: [{ use: "nope", inputs: {} }] }, spec, "screen")[0].includes('no workflow "nope"'), "unknown");
	const p = readShape(wf("simulate"));
	ok(shapeProblems({ ...p, run: "every day" }, spec, "simulate")[0].includes("five cron fields"), "bad cron");
	eq(shapeProblems({ ...p, run: "*/15 * * * *" }, spec, "simulate"), []);
	ok(shapeProblems({ ...p, memory: "lots" }, spec, "simulate")[0].includes("512Mi"), "bad memory");
	ok(shapeProblems({ ...p, inputs: [{ name: "a", value: "" }, { name: "a", value: "1" }] }, spec, "simulate")[0].includes("twice"), "dup input");
	ok(shapeProblems({ ...p, python: "sim-ulate" }, spec, "simulate")[0].includes("module name"), "bad module");
	ok(shapeProblems({ ...s, stages: [{ use: "simulate", inputs: {} }, { use: "screen", inputs: {} }] }, spec, "graph").some((x) => x.includes("itself a chain")), "nested chain");
});

check("changed and saved words follow the edit", () => {
	const s = readShape(wf("simulate"));
	ok(!shapeChanged(s, { ...s, inputs: [...s.inputs, { name: " ", value: "" }] }), "a blank input row is no change");
	const after: WorkflowShape = { ...s, data: ["holdouts"], run: "0 6 * * *" };
	ok(shapeChanged(s, after), "changed");
	eq(shapeSavedWords(s, after, false), "Saved its data and when it starts. It applies from the next run.");
	eq(shapeSavedWords(s, s, true), "Saved its steps file. It applies from the next run.");
});

check("the older loops form is refused with where to change it", () => {
	const legacy = "name: x\nloops:\n- name: old\n  engine: {type: command, module: old}\n";
	const w = readAppSpec(legacy).workflows[0];
	throws(() => setWorkflowShape(legacy, "old", readShape(w)), /older format/);
	throws(() => setWorkflowShape(SPEC, "missing", readShape(wf("simulate"))), /No workflow "missing"/);
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try { c.run(); } catch (e) { failed++; console.error(`  ✗ workflow-shape: ${c.name}\n    ${(e as Error).message}`); }
	}
	return failed;
}
export const caseCount = checks.length;
