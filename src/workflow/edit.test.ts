// Tests for Lumilake editing.
//
// The two cases that matter most are rename and remove, because an op id is a
// REFERENCE: getting either wrong silently disconnects a graph the user
// believes they only renamed or tidied.

import { WorkflowDoc } from "./doc";
import { applyLumilakeEdit } from "./adapters/lumilake.edit";
import { parseLumilake } from "./adapters/lumilake";

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

const SRC = `name: hello
inputs:
  Name: ['world']
outputs:
  - name: reply
    ref: Reply
ops:
  - id: Greeting      # formats the prompt
    op: FormatOp
    inputs: [Name]
    template: 'Hello, {name}!'
  - id: Reply
    op: LLMChatOp
    inputs: [Greeting]
    config: {model: Qwen/Qwen2.5-7B-Instruct}
`;

const fresh = () => {
	const doc = WorkflowDoc.parse(SRC);
	return { doc, graph: parseLumilake(doc.toString()) };
};
const re = (doc: WorkflowDoc) => parseLumilake(doc.toString());

check("setParam writes through to the document", () => {
	const { doc, graph } = fresh();
	const r = applyLumilakeEdit(doc, graph, { t: "setParam", node: "Reply", key: ["config", "model"], value: "Qwen/Qwen2.5-0.5B-Instruct" });
	eq(r.ok, true);
	ok(doc.toString().includes("Qwen2.5-0.5B-Instruct"), "value written");
	ok(doc.toString().includes("# formats the prompt"), "comment survived");
});

check("connect appends to the target op's inputs", () => {
	const { doc, graph } = fresh();
	applyLumilakeEdit(doc, graph, { t: "connect", source: "input:Name", target: "Reply" });
	const g = re(doc);
	const into = g.edges.filter((e) => e.target === "Reply").map((e) => e.source).sort();
	eq(into, ["Greeting", "input:Name"], "both inputs now feed Reply");
});

check("connect refuses a duplicate", () => {
	const { doc, graph } = fresh();
	const r = applyLumilakeEdit(doc, graph, { t: "connect", source: "Greeting", target: "Reply" });
	eq(r.ok, false, "refused");
});

check("connect refuses a cycle rather than writing one", () => {
	// Lumilake's scheduler would reject it much later, with a message naming
	// neither op.
	const { doc, graph } = fresh();
	const r = applyLumilakeEdit(doc, graph, { t: "connect", source: "Reply", target: "Greeting" });
	eq(r.ok, false, "refused");
	ok(!r.ok && r.reason.includes("cycle"), "and says why");
	eq(doc.toString(), SRC, "document untouched");
});

check("connect refuses a self-loop", () => {
	const { doc, graph } = fresh();
	eq(applyLumilakeEdit(doc, graph, { t: "connect", source: "Reply", target: "Reply" }).ok, false);
});

check("disconnect removes exactly one occurrence, by index", () => {
	// An op may legitimately take the same upstream twice; dropping both would
	// change what the function receives.
	const doc = WorkflowDoc.parse("ops:\n  - id: A\n    op: MessageOp\n  - id: B\n    op: LambdaOp\n    inputs: [A, A]\n");
	const graph = parseLumilake(doc.toString());
	const edge = graph.edges.find((e) => e.sourcePort === "1")!;
	applyLumilakeEdit(doc, graph, { t: "disconnect", edge: edge.id });
	eq(re(doc).edges.filter((e) => e.target === "B").length, 1, "one left");
});

check("rename rewrites every reference, not just the label", () => {
	const { doc, graph } = fresh();
	const r = applyLumilakeEdit(doc, graph, { t: "renameNode", id: "Greeting", to: "Prompt" });
	eq(r.ok, true);
	const g = re(doc);
	eq(g.diagnostics.filter((d) => d.level === "error").length, 0, "no dangling refs");
	ok(g.edges.some((e) => e.source === "Prompt" && e.target === "Reply"), "edge followed the rename");
});

check("rename rewrites an outputs[].ref too", () => {
	const { doc, graph } = fresh();
	applyLumilakeEdit(doc, graph, { t: "renameNode", id: "Reply", to: "Answer" });
	ok(doc.toString().includes("ref: Answer"), "output ref followed");
	eq(re(doc).diagnostics.filter((d) => d.level === "error").length, 0, "no errors");
});

check("rename refuses a name that is taken", () => {
	const { doc, graph } = fresh();
	eq(applyLumilakeEdit(doc, graph, { t: "renameNode", id: "Reply", to: "Greeting" }).ok, false);
});

check("remove strips references so survivors are not left dangling", () => {
	const { doc, graph } = fresh();
	const r = applyLumilakeEdit(doc, graph, { t: "removeNode", id: "Greeting" });
	eq(r.ok, true);
	const g = re(doc);
	eq(g.nodes.map((n) => n.id).sort(), ["Reply", "input:Name"], "op gone");
	eq(g.diagnostics.filter((d) => d.level === "error").length, 0, "and Reply is not left holding a dangling ref");
});

check("remove drops an outputs entry that pointed at it", () => {
	const { doc, graph } = fresh();
	applyLumilakeEdit(doc, graph, { t: "removeNode", id: "Reply" });
	ok(!doc.toString().includes("ref: Reply"), "output reference removed");
});

check("removing a declared input also unbinds it", () => {
	const { doc, graph } = fresh();
	applyLumilakeEdit(doc, graph, { t: "removeNode", id: "input:Name" });
	const g = re(doc);
	eq(g.diagnostics.filter((d) => d.level === "error").length, 0, "Greeting no longer references it");
});

check("addNode wires itself to the node it was dropped after", () => {
	const { doc, graph } = fresh();
	const r = applyLumilakeEdit(doc, graph, { t: "addNode", id: "", kind: { family: "lumilake-op", op: "MessageOp" }, after: "Reply" });
	eq(r.ok, true);
	const g = re(doc);
	ok(g.edges.some((e) => e.source === "Reply" && e.target === "message"), "connected, not orphaned");
});

check("addNode seeds real parameters, so a new node is never blank", () => {
	const { doc, graph } = fresh();
	applyLumilakeEdit(doc, graph, { t: "addNode", id: "", kind: { family: "lumilake-op", op: "LLMChatOp" }, after: "Reply" });
	const out = doc.toString();
	ok(out.includes("messages:"), "messages seeded");
	ok(out.includes("Qwen"), "a default model seeded");
});

check("addNode generates a non-colliding id", () => {
	const { doc, graph } = fresh();
	applyLumilakeEdit(doc, graph, { t: "addNode", id: "", kind: { family: "lumilake-op", op: "FormatOp" }, after: "Reply" });
	applyLumilakeEdit(doc, re(doc), { t: "addNode", id: "", kind: { family: "lumilake-op", op: "FormatOp" }, after: "Reply" });
	const ids = re(doc).nodes.map((n) => n.id);
	eq(new Set(ids).size, ids.length, "ids unique");
	ok(ids.includes("format") && ids.includes("format_2"), `got ${ids.join(",")}`);
});

check("every edit is undoable, back to the exact original bytes", () => {
	const { doc, graph } = fresh();
	applyLumilakeEdit(doc, graph, { t: "renameNode", id: "Greeting", to: "Prompt" });
	applyLumilakeEdit(doc, re(doc), { t: "addNode", id: "", kind: { family: "lumilake-op", op: "MessageOp" }, after: "Reply" });
	while (doc.undo()) { /* unwind */ }
	eq(doc.toString(), SRC, "byte-exact return to the source");
});

check("an anchor elsewhere in the file does NOT block an unrelated edit", () => {
	// The guard is per-path. A shared `skills` anchor has nothing to do with an
	// op's `op:` field, and refusing that edit would refuse 38% of real apps.
	const src = "skills: &a\n  - x\nalias: *a\nops:\n  - id: A\n    op: MessageOp\n";
	const doc = WorkflowDoc.parse(src);
	const r = applyLumilakeEdit(doc, parseLumilake(src), { t: "setParam", node: "A", key: ["op"], value: "FormatOp" });
	eq(r.ok, true, "allowed");
	ok(doc.toString().includes("op: FormatOp"), "and it landed");
	ok(doc.toString().includes("&a"), "the anchor is untouched");
});

check("an edit naming a node that is not there is refused, not silently dropped", () => {
	const { doc, graph } = fresh();
	eq(applyLumilakeEdit(doc, graph, { t: "setParam", node: "Ghost", key: ["op"], value: "X" }).ok, false);
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
