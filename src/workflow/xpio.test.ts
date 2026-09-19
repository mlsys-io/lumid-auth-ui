// Tests for editing an xpio loop.
//
// Two things here are unlike the other dialects and both are contract, not
// convenience: a manifest holds MANY loops (so an edit rooted at the wrong
// prefix rewrites the wrong one), and there is no drawable edge at all (so
// connect must refuse and say why). Anchors are routine in these files — five
// of the thirteen installed apps use them — so the per-path guard gets
// exercised here for real.

import { WorkflowDoc } from "./doc";
import { parseXpio, locateLoop, XPIO_CAPABILITIES } from "./adapters/xpio";
import { applyXpioEdit } from "./adapters/xpio.edit";
import { XPIO_REGISTRY } from "./registry/xpio";
import { detectFormat } from "./detect";

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

// Two loops, Pattern A and Pattern B, shaped like the real manifests.
const MANIFEST = `name: lumid-research-digest
kind: autoresearch
loops:
  - name: daily_digest          # the one users see
    schedule: '20 4 * * *'
    knowledge_agent: research-digest-analyst
    steps:
      - id: observe_papers
        stage: observe
        skill: arxiv/fetch
        args: {query: 'cat:cs.LG', max_results: 15}
        required: true
      - id: analyze_papers
        stage: analyze
        skill: analyze_papers
        required: true
      - id: learn_ingest
        stage: learn
        skill: learn/ingest_memories
        required: false
  - name: regression_sweep
    schedule: '20 4 * * *'
    engine:
      type: command
      module: regression
      args: ['--cases', 'all']
    skills_invoked:
      - cycle_run_all
      - score_diff
`;

const fresh = () => WorkflowDoc.parse(MANIFEST);
const re = (doc: WorkflowDoc, which?: string | number) => parseXpio(doc.toString(), which);

// --- locating ---------------------------------------------------------------

check("a manifest with many loops defaults to the first, and lists them all", () => {
	const { loop, prefix, loops } = locateLoop({ loops: [{ name: "a" }, { name: "b" }] });
	eq(loop.name, "a");
	eq(prefix, ["loops", 0]);
	eq(loops, ["a", "b"], "so the UI can offer a switcher");
});

check("a loop can be selected by name or index", () => {
	const doc = { loops: [{ name: "a" }, { name: "b" }] };
	eq(locateLoop(doc, "b").prefix, ["loops", 1]);
	eq(locateLoop(doc, 1).prefix, ["loops", 1]);
	eq(locateLoop(doc, "nope").prefix, ["loops", 0], "an unknown name falls back rather than throwing");
	eq(locateLoop(doc, 99).prefix, ["loops", 1], "an out-of-range index is clamped");
});

check("a bare loop is rooted at the document top", () => {
	eq(locateLoop({ steps: [{ id: "a" }] }).prefix, [], "no loops[] wrapper to root under");
});

check("node paths are rooted at the loop being edited", () => {
	// An edit written to steps[0] instead of loops[0].steps[0] would silently
	// rewrite whatever happens to be at the document top.
	const g = parseXpio(MANIFEST);
	const step = g.nodes.find((n) => n.id === "step:observe_papers")!;
	eq(step.path, ["loops", 0, "steps", 0]);
	const g2 = parseXpio(MANIFEST, "regression_sweep");
	eq(g2.nodes.find((n) => n.id === "engine")!.path, ["loops", 1, "engine"]);
});

check("detect recognises a manifest and a bare loop alike", () => {
	eq(detectFormat(MANIFEST).format, "xpio");
	eq(detectFormat("steps:\n  - id: a\n").format, "xpio");
});

check("a loop that declares nothing runnable says so", () => {
	const g = parseXpio("loops:\n  - name: empty\n");
	ok(g.diagnostics.some((d) => d.message.includes("nothing to run")), "warned");
});

// --- the contract: no drawable edge -----------------------------------------

check("the canvas offers no connect handles, because there is no edge to draw", () => {
	eq(XPIO_CAPABILITIES.rewire, false, "rewire must stay off");
	eq(XPIO_CAPABILITIES.reorder, true, "reorder is the topology edit this dialect has");
});

check("connect is refused with the contract as the reason, in Pattern A", () => {
	const doc = fresh();
	const r = applyXpioEdit(doc, re(doc), { t: "connect", source: "step:a", target: "step:b" });
	eq(r.ok, false);
	ok(!r.ok && /order they are written/.test(r.reason), r.ok ? "" : r.reason);
	eq(doc.toString(), MANIFEST, "nothing written");
});

check("connect is refused for a different reason in Pattern B", () => {
	// skills_invoked[] is explicitly unordered; an arrow would assert a sequence
	// the runner does not honour.
	const doc = fresh();
	const r = applyXpioEdit(doc, re(doc, 1), { t: "connect", source: "engine", target: "skill:x" }, 1);
	eq(r.ok, false);
	ok(!r.ok && /unordered/.test(r.reason), r.ok ? "" : r.reason);
});

// --- editing ----------------------------------------------------------------

check("setParam edits a step in the right loop", () => {
	const doc = fresh();
	const r = applyXpioEdit(doc, re(doc), { t: "setParam", node: "step:analyze_papers", key: ["skill"], value: "analyze_v2" });
	eq(r.ok, true);
	ok(doc.toString().includes("skill: analyze_v2"), "written");
	ok(doc.toString().includes("# the one users see"), "comment intact");
	ok(doc.toString().includes("module: regression"), "the other loop untouched");
});

check("setParam edits the SECOND loop when that is the one selected", () => {
	// Assert WHERE the value landed, not merely that it appears somewhere. An
	// earlier version of this check passed even when the edit was rooted at
	// loop 0, because writing `engine.module` there simply CREATED an engine on
	// a loop that never had one — the string was present and the test was happy
	// while the document had been corrupted.
	const doc = fresh();
	applyXpioEdit(doc, re(doc, 1), { t: "setParam", node: "engine", key: ["module"], value: "sweep_v2" }, 1);
	const js = doc.toJS<{ loops: Array<Record<string, unknown>> }>();
	eq((js.loops[1].engine as { module?: string }).module, "sweep_v2", "landed in loop 1");
	eq(js.loops[0].engine, undefined, "and loop 0 did NOT grow an engine it never had");
	eq((js.loops[0].steps as unknown[]).length, 3, "loop 0 is otherwise intact");
});

check("the trigger node edits the loop's schedule", () => {
	const doc = fresh();
	applyXpioEdit(doc, re(doc), { t: "setParam", node: "trigger", key: [], value: "@trigger" });
	ok(doc.toString().includes("schedule: '@trigger'") || doc.toString().includes('schedule: "@trigger"') || doc.toString().includes("schedule: '@trigger'"), doc.toString().slice(0, 200));
});

check("reorder moves a step and carries its comment and args with it", () => {
	const doc = fresh();
	const r = applyXpioEdit(doc, re(doc), { t: "reorder", id: "step:observe_papers", index: 2 });
	eq(r.ok, true);
	eq(re(doc).nodes.filter((n) => n.id.startsWith("step:")).map((n) => n.id),
		["step:analyze_papers", "step:learn_ingest", "step:observe_papers"]);
	ok(doc.toString().includes("max_results: 15"), "the moved step kept its args");
});

check("reorder is what changes execution order — the edges follow", () => {
	const doc = fresh();
	applyXpioEdit(doc, re(doc), { t: "reorder", id: "step:learn_ingest", index: 0 });
	const g = re(doc);
	eq(g.edges.map((e) => `${e.source}->${e.target}`)[0], "trigger->step:learn_ingest", "it now runs first");
});

check("addNode appends a step with a usable skeleton", () => {
	const doc = fresh();
	const r = applyXpioEdit(doc, re(doc), { t: "addNode", id: "", kind: { family: "xpio-step", stage: "observe" } });
	eq(r.ok, true);
	const ids = re(doc).nodes.filter((n) => n.id.startsWith("step:")).map((n) => n.id);
	eq(ids.length, 4, "appended");
	ok(doc.toString().includes("required: true"), "seeded with the fields a step needs");
});

check("addNode refuses on a command-driven loop rather than silently converting it", () => {
	// Adding steps[] to a Pattern B loop would change HOW IT RUNS, not just what
	// it contains.
	const doc = fresh();
	const r = applyXpioEdit(doc, re(doc, 1), { t: "addNode", id: "", kind: { family: "xpio-step", stage: "observe" } }, 1);
	eq(r.ok, false);
	ok(!r.ok && /command-driven/.test(r.reason), r.ok ? "" : r.reason);
});

check("removeNode drops a step, and a declared skill", () => {
	const doc = fresh();
	applyXpioEdit(doc, re(doc), { t: "removeNode", id: "step:analyze_papers" });
	ok(!doc.toString().includes("analyze_papers"), "step gone");
	const doc2 = fresh();
	applyXpioEdit(doc2, re(doc2, 1), { t: "removeNode", id: "skill:score_diff" }, 1);
	ok(!doc2.toString().includes("score_diff"), "declared skill gone");
});

check("renameNode refuses a name already used by another step", () => {
	const doc = fresh();
	eq(applyXpioEdit(doc, re(doc), { t: "renameNode", id: "step:observe_papers", to: "analyze_papers" }).ok, false);
});

check("every xpio edit is undoable back to the exact bytes", () => {
	const doc = fresh();
	applyXpioEdit(doc, re(doc), { t: "reorder", id: "step:observe_papers", index: 2 });
	applyXpioEdit(doc, re(doc), { t: "setParam", node: "step:learn_ingest", key: ["required"], value: true });
	while (doc.undo()) { /* unwind */ }
	eq(doc.toString(), MANIFEST, "byte-exact");
});

// --- anchors, which are routine in these files -------------------------------

const ANCHORED = `loops:
  - name: case_cycle
    skills: &id001
      - alignment
      - answer
    skills_invoked: *id001
    engine: {type: command, module: cycle}
  - name: sweep
    steps:
      - id: s1
        skill: k
`;

check("an anchored value refuses the edit AND explains the sharing", () => {
	const doc = WorkflowDoc.parse(ANCHORED);
	const r = applyXpioEdit(doc, parseXpio(ANCHORED), { t: "setParam", node: "skill:alignment", key: [], value: "nope" });
	eq(r.ok, false);
	ok(!r.ok && /anchor|alias/i.test(r.reason), r.ok ? "" : r.reason);
	eq(doc.toString(), ANCHORED, "unchanged");
});

check("a loop WITHOUT anchors in the same file is still fully editable", () => {
	// The whole reason the guard is per-path rather than per-file: five of the
	// thirteen installed apps use anchors, and locking those files entirely
	// would refuse loops that never touch them.
	const doc = WorkflowDoc.parse(ANCHORED);
	const r = applyXpioEdit(doc, parseXpio(ANCHORED, 1), { t: "setParam", node: "step:s1", key: ["skill"], value: "k2" }, 1);
	eq(r.ok, true, "allowed");
	ok(doc.toString().includes("skill: k2"), "written");
	ok(doc.toString().includes("&id001"), "the anchor is untouched");
});

// --- registry ----------------------------------------------------------------

check("every xpio node kind resolves to a schema", () => {
	const g = parseXpio(MANIFEST);
	for (const n of g.nodes) {
		const key = n.kind.family === "xpio-step" ? "xpio.step"
			: n.kind.family === "xpio-engine" ? "xpio.engine"
			: n.kind.family === "io" ? `io.${n.kind.role}` : n.kind.family;
		ok(!!XPIO_REGISTRY[key], `${n.id} resolved to "${key}", which has no schema`);
	}
});

check("the step schema warns that an id is what history refers to", () => {
	const idField = XPIO_REGISTRY["xpio.step"].sections[0].fields.find((f) => f.path[0] === "id")!;
	ok(/history|step_id|orphan/i.test(idField.hint ?? ""), "renaming a step orphans its past cycles; say so");
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
