// Round-trip fidelity tests.
//
// These exist because the failure they guard against is silent and
// unforgivable: you open a hand-written .xpcloud.yaml in a canvas, change one
// field, and the file comes back with its comments gone and its keys
// reordered. Every case below is a shape that actually appears in the tree.

import { WorkflowDoc } from "./doc";

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

// A document with the things a generator destroys: a leading comment, inline
// comments, a blank line, single quotes, a flow map, and a long block scalar.
const REAL = `# mbb-ai case cycle
name: case_cycle          # the loop id
description: |
  End-to-end pass over one labeled case.
  Drops 3 correction surfaces per case.

engine:
  type: command
  module: cycle
  args: ['--case', '{{ args.case }}']
metrics: {primary: avg_question_score}
schedule: '@trigger'
`;

check("round-trip: an untouched document is byte-identical", () => {
	eq(WorkflowDoc.parse(REAL).toString(), REAL, "byte equality");
});

check("round-trip: comments, blank lines and quoting survive an edit", () => {
	const d = WorkflowDoc.parse(REAL);
	ok(d.setIn(["engine", "module"], "regression"), "edit applied");
	const out = d.toString();
	ok(out.includes("# mbb-ai case cycle"), "leading comment kept");
	ok(out.includes("# the loop id"), "inline comment kept");
	ok(out.includes("module: regression"), "the edit landed");
	ok(out.includes("'{{ args.case }}'"), "single quotes kept");
	ok(out.includes("{primary: avg_question_score}"), "flow map kept");
	ok(/\n\nengine:/.test(out), "blank line kept");
	ok(out.indexOf("name:") < out.indexOf("engine:"), "key order kept");
});

check("round-trip: the KNOWN residual — an edited file loses comment alignment", () => {
	// Recorded as a test, not just a comment, so it stays true or gets noticed.
	// yaml 2.9 re-emits `name: x          # pad` as `name: x # pad`; there is no
	// stringify option for it. The cost is confined to files the user edited,
	// which is the only place it is defensible — an untouched file is byte-exact
	// (asserted above), and so is anything undone back to pristine.
	const d = WorkflowDoc.parse(REAL);
	d.setIn(["engine", "module"], "regression");
	const out = d.toString();
	ok(out.includes("name: case_cycle # the loop id"), "alignment collapsed as expected");
	ok(!out.includes("case_cycle          #"), "the padding is gone");
	// But everything that carries meaning survives.
	ok(out.includes("['--case', '{{ args.case }}']"), "flow seq NOT padded out");
	ok(out.includes("{primary: avg_question_score}"), "flow map NOT padded out");
	ok(out.includes("description: |"), "block scalar still a block scalar");
});

check("round-trip: an unknown field we never model is preserved", () => {
	// The whole point of document-first. FlowMesh keeps growing fields; a model
	// that only knows what it knows would drop them on the way out.
	const src = "ops:\n  - id: A\n    op: LLMChatOp\n    tensor_parallel_size: 4\n";
	const d = WorkflowDoc.parse(src);
	d.setIn(["ops", 0, "op"], "LLMVisionOp");
	ok(d.toString().includes("tensor_parallel_size: 4"), "unmodelled field survives");
});

check("round-trip: a no-op edit does not consume an undo slot", () => {
	const d = WorkflowDoc.parse(REAL);
	d.setIn(["engine", "module"], "cycle"); // same value
	eq(d.canUndo, false, "no history for a no-op");
});

check("undo/redo restore text exactly", () => {
	const d = WorkflowDoc.parse(REAL);
	d.setIn(["engine", "module"], "regression");
	ok(d.canUndo, "undo available");
	d.undo();
	eq(d.toString(), REAL, "undo is byte-exact");
	ok(d.canRedo, "redo available");
	d.redo();
	ok(d.toString().includes("module: regression"), "redo reapplies");
});

check("undo is bounded and never underflows", () => {
	const d = WorkflowDoc.parse(REAL);
	for (let i = 0; i < 40; i++) d.setIn(["engine", "module"], `m${i}`);
	let n = 0;
	while (d.undo()) n++;
	ok(n <= 20, `ring bounded, unwound ${n}`);
	eq(d.undo(), false, "underflow is a no-op, not a throw");
});

// This shape is real and common: mbb-ai's .xpcloud.yaml has `skills: &id001`
// with `skills_invoked: *id001`. FIVE of the thirteen installed apps use
// anchors, so refusing to edit the whole file would refuse 38% of them —
// including loops that never touch the anchor. The guard is per-path.
const ANCHORED = `loops:
  - name: a
    skills: &id001
      - alignment
    skills_invoked: *id001
  - name: b
    steps:
      - id: s1
`;

check("anchors: writing AT an anchor whose alias is used elsewhere is refused", () => {
	const d = WorkflowDoc.parse(ANCHORED);
	ok(d.editable, "the file as a whole is still editable");
	ok(!!d.aliasRiskAt(["loops", 0, "skills"]), "risk reported");
	eq(d.setIn(["loops", 0, "skills", 0], "nope"), false, "write refused");
	eq(d.toString(), ANCHORED, "and nothing changed");
});

check("anchors: writing AT an alias is refused", () => {
	const d = WorkflowDoc.parse(ANCHORED);
	ok(!!d.aliasRiskAt(["loops", 0, "skills_invoked"]), "risk reported");
	eq(d.setIn(["loops", 0, "skills_invoked", 0], "nope"), false, "refused");
});

check("anchors: an UNRELATED part of the same file stays editable", () => {
	// This is the whole point of scoping the guard.
	const d = WorkflowDoc.parse(ANCHORED);
	eq(d.aliasRiskAt(["loops", 1, "steps"]), null, "no risk on the other loop");
	ok(d.setIn(["loops", 1, "steps", 0, "id"], "renamed"), "write allowed");
	ok(d.toString().includes("id: renamed"), "and it landed");
	ok(d.toString().includes("&id001"), "the anchor is untouched");
});

check("anchors: an anchor nobody references is not a hazard", () => {
	const d = WorkflowDoc.parse("a: &unused\n  - x\nb:\n  - y\n");
	eq(d.aliasRiskAt(["a"]), null, "no alias points at it, so editing it is safe");
	ok(d.setIn(["a", 0], "changed"), "allowed");
});

check("a multi-document stream is locked, not silently truncated", () => {
	const src = "name: one\n---\nname: two\n";
	const d = WorkflowDoc.parse(src);
	ok(!d.editable, "locked");
	eq(d.lock?.reason, "multiple documents");
});

check("a plain document without anchors is editable", () => {
	ok(WorkflowDoc.parse(REAL).editable, "editable");
});

check("malformed YAML surfaces as an issue rather than throwing", () => {
	const d = WorkflowDoc.parse("ops: [ {id: A,\n  op: :::");
	ok(d.issues.some((i) => i.level === "error"), "error captured");
});

check("deleteIn removes a key and keeps its siblings' formatting", () => {
	const d = WorkflowDoc.parse(REAL);
	d.deleteIn(["schedule"]);
	const out = d.toString();
	ok(!out.includes("schedule:"), "removed");
	ok(out.includes("# the loop id"), "sibling comment intact");
});

check("addIn appends to a sequence without rewriting the others", () => {
	const src = "ops:\n  - id: A   # first\n    op: MessageOp\n";
	const d = WorkflowDoc.parse(src);
	d.addIn(["ops"], { id: "B", op: "FormatOp" });
	const out = d.toString();
	ok(out.includes("# first"), "existing comment kept");
	ok(out.includes("id: B"), "appended");
});

check("reorderIn moves an item and preserves each entry's own comment", () => {
	const src = "steps:\n  - id: a  # alpha\n  - id: b  # beta\n  - id: c  # gamma\n";
	const d = WorkflowDoc.parse(src);
	d.reorderIn(["steps"], 0, 2);
	const out = d.toString();
	const order = [...out.matchAll(/id: (\w)/g)].map((m) => m[1]);
	eq(order, ["b", "c", "a"], "order changed");
	ok(out.includes("# alpha") && out.includes("# beta") && out.includes("# gamma"), "comments rode along");
});

check("reorderIn clamps rather than throwing on a bad index", () => {
	const d = WorkflowDoc.parse("steps:\n  - id: a\n  - id: b\n");
	d.reorderIn(["steps"], 0, 99);
	eq([...d.toString().matchAll(/id: (\w)/g)].map((m) => m[1]), ["b", "a"]);
	d.reorderIn(["steps"], 99, 0); // out-of-range source is ignored
	eq([...d.toString().matchAll(/id: (\w)/g)].map((m) => m[1]), ["b", "a"]);
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
