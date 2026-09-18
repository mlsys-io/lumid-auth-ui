// Tests for the FlowMesh dialect and format detection.
//
// The case that carries the most risk is PROMOTION: adding a second task
// restructures a document the user may have hand-written. It has to move the
// per-node keys down, leave the shared configuration alone, and be undoable in
// one step.

import { WorkflowDoc } from "./doc";
import { parseFlowMesh, isFormFirst, isGraphForm, specDetail, toKind, TASK_TYPE_OF } from "./adapters/flowmesh";
import { applyFlowMeshEdit, promoteToGraph } from "./adapters/flowmesh.edit";
import { detectFormat } from "./detect";
import { FLOWMESH_REGISTRY, seedFlowMeshDoc } from "./registry/flowmesh";
import { unmodelledKeys } from "./registry/types";

type Check = { name: string; run: () => void };
const checks: Check[] = [];
const check = (name: string, run: () => void) => checks.push({ name, run });

function eq(actual: unknown, expected: unknown, what = "") {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${what || "value"}: expected ${e}, got ${a}`);
}
function ok(cond: boolean, what: string) {
	if (!cond) throw new Error(what);
}

const SINGLE = `apiVersion: flowmesh/v1
kind: InferenceTask
metadata:
  name: hello-infer          # the run's name
spec:
  taskType: inference
  resources:
    hardware: {cpu: 4, memory: 16GiB}
  model:
    source: {type: huggingface, identifier: TinyLlama/TinyLlama-1.1B-Chat-v1.0}
  data:
    type: list
    items: ['say hi']
  output:
    destination: {type: local}
    artifacts: [results.json]
`;

const DAG = `apiVersion: flowmesh/v1
kind: InferenceTask
metadata:
  name: dag-two-branch-demo
spec:
  taskType: inference
  resources:
    hardware: {cpu: 4, memory: 16GiB}
  model:
    source: {type: huggingface, identifier: TinyLlama/TinyLlama-1.1B-Chat-v1.0}
  graph:
    nodes:
      - name: branch-a
        spec: {taskType: inference, data: {type: list, items: ['a']}}
      - name: branch-b
        spec: {taskType: inference, data: {type: list, items: ['b']}}
      - name: synthesis
        dependsOn: [branch-a, branch-b]
        spec: {taskType: inference, data: {type: graph_template}}
`;

// --- projection -------------------------------------------------------------

check("flowmesh: a single task projects with synthetic data/output endpoints", () => {
	const g = parseFlowMesh(SINGLE);
	eq(g.nodes.map((n) => n.id), ["__data", "hello-infer", "__output"]);
	const real = g.nodes.filter((n) => !n.synthetic);
	eq(real.length, 1, "exactly one real node");
	ok(g.nodes[0].synthetic === true && g.nodes[2].synthetic === true, "endpoints are marked synthetic");
});

check("flowmesh: a single task is form-first, not graph-first", () => {
	// Drawing one box with two stubs as though it were a DAG is a canvas
	// performing rather than working.
	ok(isFormFirst(parseFlowMesh(SINGLE)), "single task -> form first");
	ok(!isFormFirst(parseFlowMesh(DAG)), "a real DAG is not");
	ok(!isGraphForm({ spec: {} }), "no graph key");
});

check("flowmesh: spec.graph nodes become real nodes wired by dependsOn", () => {
	const g = parseFlowMesh(DAG);
	eq(g.nodes.map((n) => n.id), ["branch-a", "branch-b", "synthesis"]);
	eq(g.edges.map((e) => `${e.source}->${e.target}`).sort(), ["branch-a->synthesis", "branch-b->synthesis"]);
	ok(g.nodes.every((n) => !n.synthetic), "no synthetic endpoints in the graph form");
});

check("flowmesh: a dependsOn naming nothing is a diagnostic, not a dropped edge", () => {
	const g = parseFlowMesh(DAG.replace("dependsOn: [branch-a, branch-b]", "dependsOn: [branch-a, ghost]"));
	eq(g.edges.length, 1, "only the real edge");
	ok(g.diagnostics.some((d) => d.level === "error" && d.message.includes("ghost")), "reported");
});

check("flowmesh: a node inherits the shared model for its subtitle", () => {
	// The model lives at the top level in the graph form; a node card that said
	// nothing would be worse than one that said what it will actually load.
	const g = parseFlowMesh(DAG);
	ok(g.nodes.every((n) => n.subtitle?.includes("TinyLlama")), g.nodes.map((n) => n.subtitle).join(" | "));
});

check("flowmesh: hardware shows as a badge", () => {
	const g = parseFlowMesh(SINGLE.replace("{cpu: 4, memory: 16GiB}", "{cpu: 8, memory: 32GiB, gpu: {type: RTX 5080, count: 2}}"));
	const task = g.nodes.find((n) => n.id === "hello-infer")!;
	eq(task.badges?.[0].label, "RTX 5080x2");
});

check("flowmesh: a missing kind is an error, a missing apiVersion a warning", () => {
	const g = parseFlowMesh("spec:\n  taskType: echo\n");
	ok(g.diagnostics.some((d) => d.level === "error" && d.message.includes("kind")), "kind is fatal");
	ok(g.diagnostics.some((d) => d.level === "warning" && d.message.includes("apiVersion")), "apiVersion is a warning");
});

check("specDetail prefers the model, then the dataset, then the task type", () => {
	eq(specDetail({ model: { source: { identifier: "m/x" } } }), "m/x");
	eq(specDetail({ data: { dataset_name: "openai/gsm8k" } }), "dataset · openai/gsm8k");
	eq(specDetail({ taskType: "echo" }), "echo");
	eq(specDetail({ taskType: "inference" }, { model: { source: { identifier: "parent/m" } } }), "parent/m", "inherits the parent model");
});

// --- promotion ---------------------------------------------------------------

check("promotion moves per-node keys down and leaves shared config alone", () => {
	const doc = WorkflowDoc.parse(SINGLE);
	ok(promoteToGraph(doc), "promoted");
	const js = doc.toJS<{ spec: Record<string, unknown> }>();
	const nodes = (js.spec.graph as { nodes: Array<{ name: string; spec: Record<string, unknown> }> }).nodes;
	eq(nodes.length, 1, "one node");
	eq(nodes[0].name, "main");
	ok(nodes[0].spec.data !== undefined, "data moved down");
	eq(js.spec.data, undefined, "and is gone from the top level");
	ok(js.spec.model !== undefined, "model stays shared");
	ok(js.spec.resources !== undefined, "resources stay shared");
	ok(js.spec.output !== undefined, "output stays shared");
});

check("promotion preserves the document's comments", () => {
	const doc = WorkflowDoc.parse(SINGLE);
	promoteToGraph(doc);
	ok(doc.toString().includes("# the run's name"), "comment survived a structural rewrite");
});

check("promotion is ONE undoable step", () => {
	const doc = WorkflowDoc.parse(SINGLE);
	promoteToGraph(doc);
	doc.undo();
	eq(doc.toString(), SINGLE, "byte-exact return");
});

check("promotion is a no-op on a document that is already a graph", () => {
	const doc = WorkflowDoc.parse(DAG);
	eq(promoteToGraph(doc), false, "refused");
	eq(doc.toString(), DAG, "untouched");
});

check("adding a second task promotes automatically, then appends", () => {
	const doc = WorkflowDoc.parse(SINGLE);
	const r = applyFlowMeshEdit(doc, parseFlowMesh(SINGLE), {
		t: "addNode", id: "", kind: { family: "flowmesh-task", taskType: "EchoTask" }, after: "main",
	});
	eq(r.ok, true);
	const g = parseFlowMesh(doc.toString());
	eq(g.nodes.map((n) => n.id), ["main", "echo"]);
	eq(g.edges.map((e) => `${e.source}->${e.target}`), ["main->echo"], "wired to what it was dropped after");
});

// --- editing -----------------------------------------------------------------

const dagDoc = () => {
	const doc = WorkflowDoc.parse(DAG);
	return { doc, graph: parseFlowMesh(doc.toString()) };
};
const re = (doc: WorkflowDoc) => parseFlowMesh(doc.toString());

check("setParam on a single task writes into spec", () => {
	const doc = WorkflowDoc.parse(SINGLE);
	applyFlowMeshEdit(doc, parseFlowMesh(SINGLE), {
		t: "setParam", node: "hello-infer", key: ["model", "source", "identifier"], value: "Qwen/Qwen2.5-0.5B-Instruct",
	});
	ok(doc.toString().includes("Qwen2.5-0.5B-Instruct"), "written");
	ok(doc.toString().includes("# the run's name"), "comment intact");
});

check("setParam on a synthetic endpoint edits the subtree it stands for", () => {
	const doc = WorkflowDoc.parse(SINGLE);
	applyFlowMeshEdit(doc, parseFlowMesh(SINGLE), { t: "setParam", node: "__output", key: ["destination", "type"], value: "s3" });
	ok(doc.toString().includes("type: s3"), "spec.output was edited through the endpoint node");
});

check("setParam on a graph node writes into that node's spec only", () => {
	const { doc, graph } = dagDoc();
	applyFlowMeshEdit(doc, graph, { t: "setParam", node: "branch-b", key: ["data", "items"], value: ["changed"] });
	const js = doc.toJS<{ spec: { graph: { nodes: Array<{ name: string; spec: { data: { items: string[] } } }> } } }>();
	eq(js.spec.graph.nodes[1].spec.data.items, ["changed"]);
	eq(js.spec.graph.nodes[0].spec.data.items, ["a"], "the sibling is untouched");
});

check("connect appends to dependsOn", () => {
	const { doc, graph } = dagDoc();
	applyFlowMeshEdit(doc, graph, { t: "connect", source: "branch-a", target: "branch-b" });
	eq(re(doc).edges.map((e) => `${e.source}->${e.target}`).sort(), ["branch-a->branch-b", "branch-a->synthesis", "branch-b->synthesis"]);
});

check("connect refuses a cycle", () => {
	const { doc, graph } = dagDoc();
	const r = applyFlowMeshEdit(doc, graph, { t: "connect", source: "synthesis", target: "branch-a" });
	eq(r.ok, false);
	eq(doc.toString(), DAG, "untouched");
});

check("connect on a single-task document explains itself instead of failing silently", () => {
	const doc = WorkflowDoc.parse(SINGLE);
	const r = applyFlowMeshEdit(doc, parseFlowMesh(SINGLE), { t: "connect", source: "a", target: "b" });
	eq(r.ok, false);
	ok(!r.ok && /second task/.test(r.reason), r.ok ? "" : r.reason);
});

check("rename rewrites dependsOn across the graph", () => {
	const { doc, graph } = dagDoc();
	applyFlowMeshEdit(doc, graph, { t: "renameNode", id: "branch-a", to: "first" });
	const g = re(doc);
	eq(g.diagnostics.filter((d) => d.level === "error").length, 0, "no dangling dependsOn");
	ok(g.edges.some((e) => e.source === "first" && e.target === "synthesis"), "edge followed");
});

check("rename on a single task renames metadata.name", () => {
	const doc = WorkflowDoc.parse(SINGLE);
	applyFlowMeshEdit(doc, parseFlowMesh(SINGLE), { t: "renameNode", id: "hello-infer", to: "renamed" });
	eq(re(doc).nodes.find((n) => !n.synthetic)!.id, "renamed");
});

check("remove strips dependsOn first so survivors are not left dangling", () => {
	const { doc, graph } = dagDoc();
	applyFlowMeshEdit(doc, graph, { t: "removeNode", id: "branch-a" });
	const g = re(doc);
	eq(g.nodes.map((n) => n.id), ["branch-b", "synthesis"]);
	eq(g.diagnostics.filter((d) => d.level === "error").length, 0, "synthesis is not left pointing at a ghost");
});

check("every flowmesh edit is undoable back to the exact bytes", () => {
	const { doc, graph } = dagDoc();
	applyFlowMeshEdit(doc, graph, { t: "renameNode", id: "branch-a", to: "first" });
	applyFlowMeshEdit(doc, re(doc), { t: "removeNode", id: "branch-b" });
	while (doc.undo()) { /* unwind */ }
	eq(doc.toString(), DAG, "byte-exact");
});

check("a document's two vocabularies are normalised to Kind", () => {
	// Documents carry `kind: InferenceTask` at the top and `taskType: inference`
	// inside each spec. Leaving both in the model meant graph nodes looked up
	// "inference" in a registry keyed by "InferenceTask" and found nothing, so
	// every node in a multi-node document lost its form.
	eq(toKind("inference"), "InferenceTask");
	eq(toKind("InferenceTask"), "InferenceTask", "already a Kind");
	eq(toKind("lora_sft"), "LoRASFTTask");
	eq(toKind(undefined), "EchoTask", "falls back rather than throwing");
	eq(toKind("nonsense", "SFTTask"), "SFTTask", "unknown uses the caller's fallback");
});

check("every graph node resolves to a registry schema", () => {
	const g = parseFlowMesh(DAG);
	for (const n of g.nodes) {
		const key = n.kind.family === "flowmesh-task" ? n.kind.taskType : "";
		ok(!!FLOWMESH_REGISTRY[key], `node ${n.id} resolved to "${key}", which has no schema`);
	}
});

// --- registry ----------------------------------------------------------------

check("every kind has a schema, and none is empty", () => {
	for (const kind of Object.keys(TASK_TYPE_OF)) {
		const spec = FLOWMESH_REGISTRY[kind];
		ok(!!spec, `${kind} has no schema`);
		ok(spec.sections.length > 0, `${kind} has no sections`);
		ok(spec.summary.length > 10, `${kind} has no real summary`);
	}
});

check("kinds that load no model do not show a Model block", () => {
	for (const kind of ["APITask", "SSHTask", "EchoTask"]) {
		ok(!FLOWMESH_REGISTRY[kind].sections.some((s) => s.title === "Model"), `${kind} should not ask for a model`);
	}
	ok(FLOWMESH_REGISTRY.SFTTask.sections.some((s) => s.title === "Model"), "SFT needs one");
});

check("LoRA gets its own block; a plain SFT does not", () => {
	ok(FLOWMESH_REGISTRY.LoRASFTTask.sections.some((s) => s.title === "LoRA"), "LoRA task needs a LoRA block");
	ok(!FLOWMESH_REGISTRY.SFTTask.sections.some((s) => s.title === "LoRA"), "a plain SFT must not ask for LoRA settings");
});

check("the GPU-type hint records that it is a substring matcher", () => {
	// It is not a flag: "RTX 5080" pins that model and excludes every other GPU.
	const res = FLOWMESH_REGISTRY.InferenceTask.sections.find((s) => s.title === "Resources")!;
	const gpu = res.fields.find((f) => f.path.join(".") === "resources.hardware.gpu.type")!;
	ok(/substring/i.test(gpu.hint ?? ""), "hint does not warn about substring matching");
});

check("an unmodelled spec key still surfaces, rather than vanishing", () => {
	const extras = unmodelledKeys(FLOWMESH_REGISTRY.InferenceTask, { model: {}, tensor_parallel_size: 4 });
	eq(extras, ["tensor_parallel_size"]);
});

check("the seed document parses and is a valid single task", () => {
	const g = parseFlowMesh(seedFlowMeshDoc());
	eq(g.diagnostics.filter((d) => d.level === "error").length, 0, "no errors");
	ok(isFormFirst(g), "starts form-first");
});

// --- detection ---------------------------------------------------------------

check("detect: flowmesh by apiVersion", () => {
	eq(detectFormat(SINGLE).format, "flowmesh");
	eq(detectFormat(SINGLE).confidence, 1);
});

check("detect: lumilake by a top-level ops list", () => {
	eq(detectFormat("ops:\n  - id: A\n    op: MessageOp\n").format, "lumilake");
});

check("detect: n8n needs BOTH nodes[] and connections{}", () => {
	eq(detectFormat('{"nodes":[],"connections":{}}').format, "n8n");
	// dify also has nodes; connections is what separates them.
	eq(detectFormat('{"nodes":[]}').format, "unknown");
});

check("detect: dify by workflow.graph.nodes", () => {
	eq(detectFormat('version: "0.7.0"\nkind: app\nworkflow:\n  graph:\n    nodes: []\n').format, "dify");
});

check("detect: xpio by loops[] or a loop's own steps[]", () => {
	eq(detectFormat("loops:\n  - name: a\n").format, "xpio");
	eq(detectFormat("steps:\n  - id: a\n").format, "xpio");
});

check("detect: unknown is a real answer, not a throw", () => {
	eq(detectFormat("just: a map\n").format, "unknown");
	eq(detectFormat("").format, "unknown");
	eq(detectFormat("{{{ not yaml").format, "unknown");
});

check("detect: a caller's hint is used ONLY where the bytes say nothing", () => {
	// The bytes always win — a hint that contradicts them would let a mislabelled
	// row render as the wrong dialect.
	eq(detectFormat("just: a map\n", "lumilake").format, "lumilake");
	eq(detectFormat(SINGLE, "lumilake").format, "flowmesh", "bytes beat the hint");
});

export function run(): number {
	let failed = 0;
	for (const c of checks) {
		try {
			c.run();
		} catch (e) {
			failed++;
			// eslint-disable-next-line no-console
			console.error(`  ✗ ${c.name}\n      ${(e as Error).message}`);
		}
	}
	return failed;
}

export const caseCount = checks.length;
