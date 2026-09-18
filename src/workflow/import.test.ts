// Tests for the n8n and Dify importers.
//
// The property that matters most is NOT how much comes across — it is that
// whatever does not come across is REPORTED. A workflow that looks imported
// and runs wrong is worse than one that plainly did not import, so every case
// below checks the loss is visible, not merely that the happy path works.

import { parseN8n, scaffoldLumilake, flowmeshCoverage, FLOWMESH_ACCEPTED } from "./import/n8n";
import { parseDify, scaffoldFromDify } from "./import/dify";
import { parseLumilake } from "./adapters/lumilake";
import { detectFormat } from "./detect";
import { graphFor } from "./preview";

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

const N8N = JSON.stringify({
	name: "research assistant",
	nodes: [
		{ name: "When clicking Execute", type: "n8n-nodes-base.manualTrigger", parameters: {}, position: [0, 0] },
		{ name: "Prompt", type: "n8n-nodes-base.set", parameters: { mode: "raw", value: "Summarise {{ $json.text }}" }, position: [200, 0] },
		{ name: "Model", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", parameters: { model: "gpt-4o-mini" }, position: [200, 160],
		  credentials: { openAiApi: { id: "1", name: "key" } } },
		{ name: "Chain", type: "@n8n/n8n-nodes-langchain.chainLlm", parameters: { text: "Summarise this" }, position: [400, 0] },
		{ name: "Slack", type: "n8n-nodes-base.slack", parameters: { channel: "#general" }, position: [600, 0] },
	],
	connections: {
		"When clicking Execute": { main: [[{ node: "Prompt" }]] },
		Prompt: { main: [[{ node: "Chain" }]] },
		Model: { ai_languageModel: [[{ node: "Chain" }]] },
		Chain: { main: [[{ node: "Slack" }]] },
	},
});

// --- n8n: projection ---------------------------------------------------------

check("n8n: every node renders, including ones nothing of ours understands", () => {
	// Hiding them would misrepresent the graph the user is looking at.
	const g = parseN8n(N8N);
	eq(g.nodes.length, 5, "all five");
	ok(g.nodes.some((n) => n.kind.family === "unknown" && n.kind.raw === "n8n-nodes-base.slack"), "Slack rendered as unknown");
});

check("n8n: authored positions are honoured, so it opens looking like it did", () => {
	const g = parseN8n(N8N);
	eq(g.layout, "authored");
	eq(g.nodes.find((n) => n.id === "Chain")!.ui, { x: 400, y: 0 });
});

check("n8n: an ai_languageModel edge is an ATTACHMENT, not data flow", () => {
	// The model plugs INTO the chain node. Rendering it as a pipeline would
	// claim the chain consumes the model's output, which is not what happens.
	const g = parseN8n(N8N);
	const e = g.edges.find((x) => x.source === "Model")!;
	eq(e.rel, "attach");
	eq(e.label, "languageModel");
	ok(g.edges.filter((x) => x.rel === "data").length === 3, "the three real data edges");
});

check("n8n: a second output slot becomes a branch, not another plain edge", () => {
	const g = parseN8n(JSON.stringify({
		nodes: [{ name: "If", type: "n8n-nodes-base.if", parameters: {} }, { name: "A", type: "x", parameters: {} }, { name: "B", type: "x", parameters: {} }],
		connections: { If: { main: [[{ node: "A" }], [{ node: "B" }]] } },
	}));
	const branch = g.edges.find((e) => e.rel === "branch");
	ok(!!branch, "second slot is a branch");
	eq(branch!.label, "out 1");
});

check("n8n: credentials and expressions are REPORTED, not quietly dropped", () => {
	const g = parseN8n(N8N);
	ok(g.diagnostics.some((d) => d.node === "Model" && /credentials/i.test(d.message)), "credentials flagged");
	ok(g.diagnostics.some((d) => d.node === "Prompt" && /expression/i.test(d.message)), "expression flagged");
});

check("n8n: an edge naming a node that is not there is an error", () => {
	const g = parseN8n(JSON.stringify({ nodes: [{ name: "A", type: "x", parameters: {} }], connections: { A: { main: [[{ node: "Ghost" }]] } } }));
	eq(g.edges.length, 0, "no edge invented");
	ok(g.diagnostics.some((d) => d.level === "error" && d.message.includes("Ghost")), "reported");
});

check("n8n: malformed JSON is a diagnostic, not a throw", () => {
	ok(parseN8n("{not json").diagnostics.some((d) => d.level === "error"), "captured");
});

// --- n8n: scaffolding --------------------------------------------------------

check("scaffold: unmapped nodes become ghosts with a reason, never silence", () => {
	const r = scaffoldLumilake(parseN8n(N8N));
	const names = r.dropped.map((d) => d.name).sort();
	// Three: a trigger and a Slack node with no equivalent, plus the model
	// PROVIDER, which is folded into the op it attaches to rather than becoming
	// one. All three are listed — being folded in is still a thing the user
	// should be told about.
	eq(names, ["Model", "Slack", "When clicking Execute"], "every non-op node is accounted for");
	ok(r.dropped.every((d) => d.reason.length > 20), "each carries a real reason");
});

check("scaffold: the result is a VALID Lumilake document", () => {
	// A scaffold that does not parse is worse than no scaffold.
	const r = scaffoldLumilake(parseN8n(N8N));
	const g = parseLumilake(r.text);
	eq(g.diagnostics.filter((d) => d.level === "error").length, 0, `errors: ${g.diagnostics.map((d) => d.message).join("; ")}`);
	ok(g.nodes.length >= 2, "has ops");
});

check("scaffold: an outputs block is emitted, or the job fails server-side", () => {
	// Lumilake rejects a workflow with no outputs: "Missing output for workflow".
	const r = scaffoldLumilake(parseN8n(N8N));
	ok(r.text.includes("outputs:"), "outputs emitted");
	ok(!parseLumilake(r.text).diagnostics.some((d) => d.message.includes("Missing output")), "and it satisfies the check");
});

check("scaffold: op ids are safe and unique even from awkward names", () => {
	const g = parseN8n(JSON.stringify({
		nodes: [
			{ name: "When clicking 'Execute'!", type: "n8n-nodes-base.set", parameters: {} },
			{ name: "when-clicking-execute", type: "n8n-nodes-base.set", parameters: {} },
		],
		connections: {},
	}));
	const r = scaffoldLumilake(g);
	const ids = r.mapped.map((m) => m.to);
	eq(new Set(ids).size, ids.length, `collision: ${ids.join(",")}`);
	ok(ids.every((i) => /^[a-z0-9_]+$/.test(i)), `unsafe id in ${ids.join(",")}`);
});

check("scaffold: a model provider is folded in, not left as an orphan op", () => {
	// An lmChatOpenAi node is not a task that runs — it is the model a chain
	// uses. Making it an op produced a node with no inputs and no consumer,
	// sitting in the imported graph doing nothing while looking like it might.
	const r = scaffoldLumilake(parseN8n(N8N));
	const g = parseLumilake(r.text);
	ok(!g.nodes.some((n) => n.id === "model"), `provider must not become an op; got ${g.nodes.map((n) => n.id).join(",")}`);
	ok(r.dropped.some((d) => d.name === "Model" && /provider/i.test(d.reason)), "and it is explained, not silently gone");
	// Its model is lifted onto the op it was attached to.
	ok(r.text.includes("gpt-4o-mini"), `the provider's model should land on the chain: ${r.text}`);
});

check("scaffold: no op is left orphaned with neither inputs nor consumers", () => {
	const g = parseLumilake(scaffoldLumilake(parseN8n(N8N)).text);
	for (const n of g.nodes) {
		const connected = g.edges.some((e) => e.source === n.id || e.target === n.id);
		ok(connected, `${n.id} is an orphan in the scaffold`);
	}
});

check("scaffold: the caveats are carried as notes, not left implicit", () => {
	const r = scaffoldLumilake(parseN8n(N8N));
	ok(r.notes.some((n) => /expression/i.test(n)), "expressions");
	ok(r.notes.some((n) => /credential/i.test(n)), "credentials");
	ok(r.notes.some((n) => /attachment/i.test(n)), "model attachments");
});

check("scaffold: a graph with nothing mappable says so rather than emitting junk", () => {
	const r = scaffoldLumilake(parseN8n(JSON.stringify({ nodes: [{ name: "S", type: "n8n-nodes-base.slack", parameters: {} }], connections: {} })));
	eq(r.mapped.length, 0);
	ok(r.notes.some((n) => /nothing/i.test(n)), "said plainly");
});

check("flowmeshCoverage reports the real parser's reach without reimplementing it", () => {
	// Five accepted node types, from src/server/task/n8n_parser.py.
	eq(FLOWMESH_ACCEPTED.size, 5);
	const c = flowmeshCoverage(JSON.parse(N8N));
	eq(c.total, 5);
	eq(c.accepted, 3, "set + lmChatOpenAi + chainLlm");
	ok(c.unsupported.includes("n8n-nodes-base.slack"), "names what it cannot take");
});

// --- dify --------------------------------------------------------------------

const DIFY = `version: "0.7.0"
kind: app
app:
  name: summariser
  mode: workflow
workflow:
  graph:
    nodes:
      - id: start1
        type: custom
        position: {x: 0, y: 0}
        data: {type: start, title: Start, _hovering: false, selected: true}
      - id: llm1
        type: custom
        position: {x: 300, y: 0}
        data:
          type: llm
          title: Summarise
          model: {name: gpt-4o-mini, provider: openai}
          prompt_template: [{role: user, text: "Summarise {{#start1.query#}}"}]
          _runningStatus: succeeded
      - id: ifelse1
        type: custom
        position: {x: 600, y: 0}
        data: {type: if-else, title: Long enough?}
      - id: answer1
        type: custom
        position: {x: 900, y: 0}
        data: {type: answer, title: Reply}
    edges:
      - {id: e1, source: start1, target: llm1, sourceHandle: source}
      - {id: e2, source: llm1, target: ifelse1, sourceHandle: source}
      - {id: e3, source: ifelse1, target: answer1, sourceHandle: "true"}
`;

check("dify: the REAL kind comes from data.type, not the node's own type", () => {
	// node.type is the literal "custom" on almost every node; reading it would
	// make every node identical.
	const g = parseDify(DIFY);
	const llm = g.nodes.find((n) => n.id === "llm1")!;
	eq(llm.kind, { family: "lumilake-op", op: "LLMChatOp" }, "llm mapped");
	ok(g.nodes.every((n) => !(n.kind.family === "unknown" && n.kind.raw === "custom")), "nothing read as 'custom'");
});

check("dify: the node's title is used as the label", () => {
	eq(parseDify(DIFY).nodes.find((n) => n.id === "llm1")!.label, "Summarise");
});

check("dify: frontend scratch state never enters our document", () => {
	// _hovering / _runningStatus / selected are another tool's transient UI
	// state, not the workflow.
	const g = parseDify(DIFY);
	for (const n of g.nodes) {
		for (const k of Object.keys(n.params)) {
			ok(!k.startsWith("_") && k !== "selected", `${n.id} kept UI key ${k}`);
		}
	}
});

check("dify: sourceHandle carries BRANCH identity, and is preserved", () => {
	const g = parseDify(DIFY);
	const branch = g.edges.find((e) => e.rel === "branch")!;
	eq(branch.sourcePort, "true", "the branch it came from");
	// "source" is Dify's name for the ordinary single output, not a branch.
	eq(g.edges.filter((e) => e.rel === "data").length, 2, "the two plain edges");
});

check("dify: control flow is flagged as untranslatable, not silently dropped", () => {
	const g = parseDify(DIFY);
	const d = g.diagnostics.find((x) => x.node === "ifelse1")!;
	ok(!!d, "if-else reported");
	eq(d.untranslatable, true);
	ok(/redesigned/.test(d.message), d.message);
});

check("dify: variable references are reported rather than mistranslated", () => {
	ok(parseDify(DIFY).diagnostics.some((d) => d.node === "llm1" && /variable reference/i.test(d.message)), "flagged");
});

check("dify: a non-workflow document is rejected with a reason", () => {
	const g = parseDify('version: "0.7.0"\nkind: app\napp: {name: x, mode: agent}\n');
	ok(g.diagnostics.some((d) => d.level === "error" && /not a Dify workflow/.test(d.message)), "said why");
});

check("dify scaffold: a ghost card carries the PARSER's reason, not a generic one", () => {
	// projectDify knows why an if-else cannot come across — it is control flow
	// Dify runs itself. Falling back to the generic line threw that away at
	// exactly the point the user reads it.
	const r = scaffoldFromDify(parseDify(DIFY));
	const ghost = r.dropped.find((d) => d.type === "if-else")!;
	ok(!!ghost, "if-else is listed");
	ok(/control flow/i.test(ghost.reason) && /redesigned/.test(ghost.reason), ghost.reason);
});

check("dify scaffold: flattened branches are called out", () => {
	// Lumilake has no conditional, so an if-else becomes unconditional inputs.
	const r = scaffoldFromDify(parseDify(DIFY));
	ok(r.notes.some((n) => /branch/i.test(n) && /rebuil/i.test(n)), r.notes.join(" | "));
	ok(r.notes.some((n) => /control-flow/i.test(n)), "control flow counted");
});

check("scaffold: the pipeline survives a dropped node in the middle", () => {
	// Dify's graph is start -> llm -> if-else -> answer. Both start and if-else
	// are dropped, so a naive scaffold emits two disconnected orphans: every
	// part kept, the pipeline lost.
	const r = scaffoldFromDify(parseDify(DIFY));
	const g = parseLumilake(r.text);
	eq(g.nodes.length, 2, "two ops survive");
	ok(g.edges.some((e) => e.source === "summarise" && e.target === "reply"),
		`the flow should bridge the dropped nodes; got ${g.edges.map((e) => `${e.source}->${e.target}`).join(",") || "no edges"}`);
});

check("scaffold: bridging is cycle-safe", () => {
	const g = parseN8n(JSON.stringify({
		nodes: [
			{ name: "A", type: "n8n-nodes-base.set", parameters: {} },
			{ name: "X", type: "n8n-nodes-base.slack", parameters: {} },
			{ name: "Y", type: "n8n-nodes-base.slack", parameters: {} },
		],
		connections: { A: { main: [[{ node: "X" }]] }, X: { main: [[{ node: "Y" }]] }, Y: { main: [[{ node: "X" }]] } },
	}));
	scaffoldLumilake(g); // must terminate
	ok(true, "did not hang on a cycle of dropped nodes");
});

check("dify scaffold: the result is a valid Lumilake document", () => {
	const g = parseLumilake(scaffoldFromDify(parseDify(DIFY)).text);
	eq(g.diagnostics.filter((d) => d.level === "error").length, 0, g.diagnostics.map((d) => d.message).join("; "));
});

check("detect distinguishes the two importable formats", () => {
	eq(detectFormat(N8N).format, "n8n");
	eq(detectFormat(DIFY).format, "dify");
});

// --- the marketplace preview -------------------------------------------------

check("preview: every dialect a definition_json can hold is drawable", () => {
	// The column is opaque LONGTEXT the Java never parses, so a preview has to
	// sniff the bytes. Four dialects plus two kinds of nothing.
	eq(graphFor('ops:\n  - id: A\n    op: MessageOp\n').label, "Lumilake");
	eq(graphFor("apiVersion: flowmesh/v1\nkind: EchoTask\nspec: {taskType: echo}\n").label, "FlowMesh");
	eq(graphFor("loops:\n  - name: a\n    steps: [{id: s}]\n").label, "xpio loop");
	eq(graphFor('{"nodes":[],"connections":{}}').label, "n8n");
	eq(graphFor('version: "0.7.0"\nworkflow: {graph: {nodes: []}}\n').label, "Dify");
});

check("preview: an empty or unrecognised row degrades, it does not throw", () => {
	// This is an ordinary occurrence — definition_json has no schema discipline.
	eq(graphFor("{}").graph, null, "the literal empty object");
	eq(graphFor("").graph, null, "empty string");
	eq(graphFor("just: a map\n").label, "unrecognised");
	eq(graphFor("{{{ not parseable").graph, null, "garbage");
});

check("preview: a real document yields real nodes", () => {
	const r = graphFor('ops:\n  - id: A\n    op: MessageOp\n  - id: B\n    op: FormatOp\n    inputs: [A]\n');
	eq(r.graph?.nodes.length, 2);
	eq(r.graph?.edges.length, 1);
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
