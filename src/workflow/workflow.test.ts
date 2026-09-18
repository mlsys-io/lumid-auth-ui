// Tests for the DSL-agnostic workflow core.
//
// Runs standalone via `node scripts/test-workflow.mjs` (esbuild-bundled — the
// repo has no test runner and this box's node is too old for
// --experimental-strip-types), and also under vitest's describe/it/expect once
// that infra is wired. Same dual shape as src/lib/relative-time.test.ts.
//
// What is worth testing here is the stuff that used to be silently wrong:
// dangling references being swallowed, the executed path not being derivable,
// and the layout memo key changing when a parameter changes (which reflows the
// canvas under the user's cursor).

import { parseLumilake, opDetail, workerByOp } from "./adapters/lumilake";
import { projectXpio, stageOf, isEmptyLoop } from "./adapters/xpio";
import { projectStepLog, stepIndexOf } from "./adapters/steplog";
import { applyOverlay, rootNodes } from "./model";
import { layoutGraph, layoutKey } from "./layout";

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

// ---------------------------------------------------------------------------
// Lumilake projection
// ---------------------------------------------------------------------------

const HELLO = `
name: hello-world
inputs:
  Name: ["world"]
outputs:
  - name: reply
    ref: Reply
ops:
  - id: Greeting
    op: FormatOp
    inputs: [Name]
    template: "Hello, {name}!"
  - id: Reply
    op: LLMChatOp
    inputs: [Greeting]
    config: {model: Qwen/Qwen2.5-7B-Instruct}
`;

check("lumilake: ops and inputs both become nodes", () => {
	const g = parseLumilake(HELLO);
	eq(g.nodes.map((n) => n.id).sort(), ["Greeting", "Reply", "input:Name"], "node ids");
	eq(g.format, "lumilake");
});

check("lumilake: edges are derived from op.inputs, not an edges array", () => {
	const g = parseLumilake(HELLO);
	const pairs = g.edges.map((e) => `${e.source}->${e.target}`).sort();
	eq(pairs, ["Greeting->Reply", "input:Name->Greeting"], "edges");
	ok(g.edges.every((e) => e.rel === "data"), "all edges are data edges");
});

check("lumilake: the input binding index is preserved as sourcePort", () => {
	// Positional inputs matter: LambdaOp destructures the tuple, so losing the
	// index would make a reorder unrepresentable.
	const g = parseLumilake(`
ops:
  - id: Join
    op: LambdaOp
    inputs: [A, B]
  - id: A
    op: MessageOp
  - id: B
    op: MessageOp
`);
	const into = g.edges.filter((e) => e.target === "Join").sort((x, y) => x.source.localeCompare(y.source));
	eq(into.map((e) => [e.source, e.sourcePort]), [["A", "0"], ["B", "1"]], "positional ports");
});

check("lumilake: a dangling input ref is a diagnostic, not a silent drop", () => {
	const g = parseLumilake(`
ops:
  - id: Reply
    op: LLMChatOp
    inputs: [NoSuchThing]
`);
	eq(g.edges.length, 0, "no edge invented");
	ok(
		g.diagnostics.some((d) => d.level === "error" && d.node === "Reply" && d.message.includes("NoSuchThing")),
		"dangling ref reported against its op",
	);
});

check("lumilake: a missing outputs block is flagged before the server rejects it", () => {
	const g = parseLumilake(`ops: [{id: A, op: MessageOp}]`);
	ok(
		g.diagnostics.some((d) => d.message.includes("Missing output")),
		"warns about the submit-time failure",
	);
});

check("lumilake: an output ref pointing nowhere is flagged", () => {
	const g = parseLumilake(`
outputs: [{name: r, ref: Ghost}]
ops: [{id: A, op: MessageOp}]
`);
	ok(g.diagnostics.some((d) => d.message.includes("Ghost")), "bad output ref reported");
});

check("lumilake: malformed YAML yields a diagnostic rather than throwing", () => {
	const g = parseLumilake("ops: [ {id: A,\n  op: :::");
	ok(g.diagnostics.length > 0, "error captured");
	eq(g.nodes.length, 0, "no nodes");
});

check("lumilake: an op with no id is reported and skipped", () => {
	const g = parseLumilake(`ops: [{op: MessageOp}]`);
	eq(g.nodes.length, 0, "unnamed op not rendered");
	ok(g.diagnostics.some((d) => d.message.includes("no id")), "reported");
});

check("opDetail surfaces the one meaningful parameter", () => {
	eq(opDetail({ op: "LLMChatOp", config: { model: "Qwen/Qwen2.5-7B-Instruct" } }), "Qwen/Qwen2.5-7B-Instruct");
	eq(opDetail({ op: "LambdaOp", fn_name: "shout" }), "fn shout");
	eq(opDetail({ op: "DataRetrievalOp", data_spec: { mode: "sql" } }), "data · sql");
	eq(opDetail({ op: "FormatOp", template: "Hello, {name}!" }), '"Hello, {name}!"');
	eq(opDetail({ op: "MessageOp" }), "MessageOp", "falls back to the op type");
});

check("workerByOp matches HALO runtime ids back to op ids by substring", () => {
	const m = workerByOp(
		{ worker_assignment: { "w-1": ["graph_0__llm_graph_0_Reply_38"], "w-2": ["Greeting"] } },
		["Reply", "Greeting"],
	);
	eq(m, { Reply: "w-1", Greeting: "w-2" });
});

check("HALO worker lands on the node as a badge", () => {
	const g = parseLumilake(HELLO, { worker_assignment: { "w-9": ["graph_0_Reply_1"] } });
	const reply = g.nodes.find((n) => n.id === "Reply")!;
	eq(reply.badges?.map((b) => [b.kind, b.label]), [["worker", "w-9"]]);
});

// ---------------------------------------------------------------------------
// Overlay — the executed path
// ---------------------------------------------------------------------------

check("overlay: an edge is gold only when BOTH ends succeeded", () => {
	const g = applyOverlay(parseLumilake(HELLO), {
		"input:Name": "succeeded", Greeting: "succeeded", Reply: "pending",
	});
	const done = g.edges.find((e) => e.id.startsWith("input:Name"))!;
	const notDone = g.edges.find((e) => e.target === "Reply")!;
	eq(done.status, "succeeded", "traced");
	eq(notDone.status, undefined, "not traced while the target is pending");
});

check("overlay: only the in-edges of a RUNNING node are marked running", () => {
	const g = applyOverlay(parseLumilake(HELLO), { Greeting: "succeeded", Reply: "running" });
	eq(g.edges.find((e) => e.target === "Reply")!.status, "running");
	eq(g.edges.find((e) => e.target === "Greeting")!.status, undefined);
});

check("overlay: a failed target marks its in-edge failed", () => {
	const g = applyOverlay(parseLumilake(HELLO), { Reply: "failed" });
	eq(g.edges.find((e) => e.target === "Reply")!.status, "failed");
});

check("overlay: no overlay leaves the graph untouched", () => {
	const g = parseLumilake(HELLO);
	ok(applyOverlay(g, undefined) === g, "same object returned");
});

check("rootNodes finds the entry points", () => {
	eq(rootNodes(parseLumilake(HELLO)), ["input:Name"]);
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

check("layout: every node gets a position", () => {
	const g = parseLumilake(HELLO);
	const { positions } = layoutGraph(g);
	eq(positions.size, g.nodes.length, "positioned count");
	ok([...positions.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), "finite coords");
});

check("layout: LR puts a downstream op to the RIGHT of its source", () => {
	const { positions } = layoutGraph(parseLumilake(HELLO), { direction: "LR" });
	ok(positions.get("Reply")!.x > positions.get("Greeting")!.x, "Reply is right of Greeting");
});

check("layout: the memo key is structural, so editing a param does not reflow", () => {
	// This is the canvas's #1 perf trap: keying on the graph object re-runs
	// dagre on every inspector keystroke and moves nodes under the cursor.
	const before = parseLumilake(HELLO);
	const after = parseLumilake(HELLO.replace("Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-0.5B-Instruct"));
	eq(layoutKey(after), layoutKey(before), "key unchanged by a parameter edit");
});

check("layout: the memo key DOES change when topology changes", () => {
	const before = parseLumilake(HELLO);
	const after = parseLumilake(HELLO + "  - id: Extra\n    op: MessageOp\n    inputs: [Reply]\n");
	ok(layoutKey(after) !== layoutKey(before), "key changed by a new node");
});

check("layout: a manual nudge wins over the computed position", () => {
	const g = parseLumilake(HELLO);
	const { positions } = layoutGraph(g, { pinned: { Reply: { x: 999, y: 111 } } });
	eq([positions.get("Reply")!.x, positions.get("Reply")!.y], [999, 111]);
});

// ---------------------------------------------------------------------------
// xpio
// ---------------------------------------------------------------------------

check("xpio Pattern A: trigger → steps in declared order → knowledge sink", () => {
	const g = projectXpio({
		name: "daily", schedule: "20 4 * * *", knowledge_agent: "bank",
		steps: [{ id: "observe_papers", skill: "arxiv/fetch" }, { id: "analyze_papers", skill: "analyze" }],
	});
	eq(g.nodes.map((n) => n.id), ["trigger", "step:observe_papers", "step:analyze_papers", "knowledge"]);
	eq(g.edges.map((e) => `${e.source}->${e.target}`), [
		"trigger->step:observe_papers",
		"step:observe_papers->step:analyze_papers",
		"step:analyze_papers->knowledge",
	]);
	eq(g.layout, "column-bands");
});

check("xpio Pattern B: declared skills hang off UNORDERED dashed edges", () => {
	// The contract enforces no ordering for skills_invoked[]; rendering them as
	// a pipeline would assert a sequence that does not exist.
	const g = projectXpio({
		name: "sweep",
		engine: { type: "command", module: "cycle" },
		skills_invoked: ["a", "b", "c"],
	});
	const declared = g.edges.filter((e) => e.rel === "declared");
	eq(declared.length, 3, "one declared edge per skill");
	ok(declared.every((e) => e.source === "engine"), "all fan out from the engine");
	ok(declared.every((e) => e.label === "declared"), "labelled honestly");
});

check("xpio: a run overlay turns declared skills into real results", () => {
	const g = projectXpio(
		{ engine: { module: "cycle" }, skills_invoked: ["a"] },
		{ cycle: { ts: 1, steps: [{ step_id: "a", ok: true, duration_s: 1.5 }] } as never },
	);
	const node = g.nodes.find((n) => n.id === "skill:a")!;
	eq(node.status, "succeeded");
	eq(node.run?.duration_s, 1.5);
	eq(g.edges.find((e) => e.target === "skill:a")!.rel, "data", "no longer merely declared");
});

check("xpio: a failed step carries its error text onto the node", () => {
	const g = projectXpio(
		{ steps: [{ id: "s1", skill: "k" }] },
		{ cycle: { ts: 1, steps: [{ step_id: "s1", ok: false, error: "boom\nstack" }] } as never },
	);
	const n = g.nodes.find((n) => n.id === "step:s1")!;
	eq(n.status, "failed");
	eq(n.run?.error, "boom\nstack");
});

check("xpio: the stage is stored on the node, so bands cannot disagree with labels", () => {
	// The old code recomputed the stage from an index into a mixed array when
	// painting bands, which could land a node in a band its own label denied.
	const g = projectXpio({ steps: [{ id: "observe_x" }, { id: "learn_y" }] });
	const stages = g.nodes.filter((n) => n.kind.family === "xpio-step").map((n) => n.group);
	eq(stages, ["observe", "learn"]);
});

check("stageOf: cycle truth beats the name, and the name beats position", () => {
	eq(stageOf("anything", 0, 4, "analyze"), "analyze", "cycle stage wins");
	eq(stageOf("observe_papers", 3, 4), "observe", "name wins over position");
	eq(stageOf("zzz", 0, 5), "observe", "position fallback");
});

// ---------------------------------------------------------------------------
// step_log (a run, not a document)
// ---------------------------------------------------------------------------

check("steplog: linear order is the edge set", () => {
	const g = projectStepLog([
		{ id: "observe", ok: true, duration_s: 0.7, skill: "email/observe" },
		{ id: "act", ok: false, duration_s: 1.2, error: "Quota exceeded" },
	]);
	eq(g.nodes.map((n) => n.label), ["observe", "act"]);
	eq(g.edges.map((e) => `${e.source}->${e.target}`), ["step-0->step-1"]);
});

check("steplog: state is inferred from ok/skipped, not invented", () => {
	const g = projectStepLog([{ ok: true }, { ok: false }, { skipped: true }, {}]);
	eq(g.nodes.map((n) => n.status), ["succeeded", "failed", "skipped", "pending"]);
});

check("steplog: a run has no document, so nothing claims an edit path", () => {
	const g = projectStepLog([{ id: "a", ok: true }]);
	ok(g.nodes.every((n) => n.path.length === 0), "no edit anchors on a run");
});

check("steplog: the error text rides on the node", () => {
	const g = projectStepLog([{ id: "act", ok: false, error: "Quota exceeded" }]);
	eq(g.nodes[0].run?.error, "Quota exceeded");
});

check("steplog: node ids round-trip back to the raw entry index", () => {
	eq(stepIndexOf("step-3"), 3);
	eq(stepIndexOf("nonsense"), -1);
});

check("isEmptyLoop is true only when nothing is declared", () => {
	ok(isEmptyLoop({}), "empty");
	ok(!isEmptyLoop({ steps: [{ id: "a" }] }), "pattern A");
	ok(!isEmptyLoop({ engine: { module: "m" } }), "pattern B");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

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

declare const describe: undefined | ((n: string, f: () => void) => void);
declare const it: undefined | ((n: string, f: () => void) => void);

if (typeof describe === "function" && typeof it === "function") {
	describe("workflow core", () => {
		for (const c of checks) it!(c.name, c.run);
	});
} else {
	const failed = run();
	const proc = (globalThis as { process?: { exitCode?: number } }).process;
	if (failed > 0) {
		// eslint-disable-next-line no-console
		console.error(`${failed} of ${checks.length} case(s) failed`);
		if (proc) proc.exitCode = 1;
	} else {
		// eslint-disable-next-line no-console
		console.log(`workflow core: all ${checks.length} cases passed`);
	}
}
