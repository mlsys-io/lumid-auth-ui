// Replay driver for the chat block reducer.
//
// This repo has no unit-test runner (package.json exposes dev/build/typecheck
// only), and the block reducer is the one piece where a silent bug is
// expensive: wrong ordering, a sub-agent's tool completing its parent's
// pending call, or a missed clone that freezes the stream mid-turn.
//
// The reducer is pure `(Message, args) => Message`, so it replays with no DOM,
// no React and no network. Run:
//
//   node --experimental-strip-types e2e/blocks-replay.mjs
//   npm run test:blocks
//
// Event shapes below mirror what lumid-identity's Claude Code bridge actually
// emits (verified against a real CLI capture — see
// lumid_identity/internal/handler/testdata/claude_stream_subagent.ndjson).

import assert from 'node:assert/strict';

// entityCards imports React/lucide, which we neither need nor can load here.
// blocks.ts only calls entityCardFor() to decide whether to emit a card, so a
// stub that never emits one keeps every ordering assertion valid.
import { register } from 'node:module';
register(
	'data:text/javascript,' +
	encodeURIComponent(`
		export async function resolve(spec, ctx, next) {
			if (spec.endsWith('./entityCards')) return { url: 'data:text/javascript,export function entityCardFor(){return null}', shortCircuit: true };
			return next(spec, ctx);
		}
	`),
	import.meta.url,
);

const B = await import('../src/components/chat/blocks.ts');

let pass = 0, fail = 0;
function test(name, fn) {
	try { fn(); pass++; console.log(`  ok   ${name}`); }
	catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const fresh = () => ({ role: 'assistant', content: '', blocks: [] });
const kinds = (m) => m.blocks.map((b) => b.kind);

console.log('block reducer replay\n');

// ── ordering: the headline gap ──────────────────────────────────────────────

test('text -> tool -> text renders in ARRIVAL order (not all text first)', () => {
	let m = fresh();
	m = B.appendText(m, 'Let me check. ');
	m = B.startTool(m, { id: 'a1', name: 'Bash', args: { command: 'ls' } });
	m = B.completeTool(m, { id: 'a1', name: 'Bash', ok: true, result: 'file.txt' });
	m = B.appendText(m, 'Found one file.');
	assert.deepEqual(kinds(m), ['text', 'tool', 'text']);
	assert.equal(m.blocks[0].text, 'Let me check. ');
	assert.equal(m.blocks[2].text, 'Found one file.');
});

test('content mirror joins only TOP-LEVEL text', () => {
	let m = fresh();
	m = B.appendText(m, 'first');
	m = B.startTool(m, { id: 'a1', name: 'Bash' });
	m = B.completeTool(m, { id: 'a1', name: 'Bash', ok: true });
	m = B.appendText(m, 'second');
	assert.equal(m.content, 'first\n\nsecond');
	assert.equal(B.messageText(m), m.content, 'mirror must equal content');
});

test('two thinking blocks stay separate (old reducer concatenated them)', () => {
	let m = fresh();
	m = B.openReasoning(m); m = B.appendReasoning(m, 'plan A'); m = B.closeReasoning(m);
	m = B.appendText(m, 'hmm');
	m = B.openReasoning(m); m = B.appendReasoning(m, 'plan B'); m = B.closeReasoning(m);
	const r = m.blocks.filter((b) => b.kind === 'reasoning');
	assert.equal(r.length, 2);
	assert.equal(r[0].text, 'plan A');
	assert.equal(r[1].text, 'plan B');
});

test('reasoning never leaks into the content mirror', () => {
	let m = fresh();
	m = B.openReasoning(m); m = B.appendReasoning(m, 'secret reasoning');
	m = B.appendText(m, 'answer');
	assert.equal(m.content, 'answer');
});

// ── sub-agents ─────────────────────────────────────────────────────────────

test('sub-agent tool nests under its Task, not as a sibling', () => {
	let m = fresh();
	m = B.startTool(m, { id: 'task1', name: 'Task', args: { description: 'Explore' } });
	m = B.startSubagent(m, { taskId: 'T1', toolUseId: 'task1', subagentType: 'general-purpose' });
	m = B.startTool(m, { id: 'b1', name: 'Bash', args: { command: 'echo hi' } }, 'task1');
	m = B.completeTool(m, { id: 'b1', name: 'Bash', ok: true, result: 'hi' }, 'task1');
	assert.deepEqual(kinds(m), ['subagent'], 'exactly one top-level block');
	const sa = m.blocks[0];
	assert.equal(sa.children.length, 1);
	assert.equal(sa.children[0].kind, 'tool');
	assert.equal(sa.children[0].tool.name, 'Bash');
	assert.equal(sa.children[0].tool.result, 'hi');
});

test('a sub-agent Bash result does NOT complete the parent pending Bash', () => {
	let m = fresh();
	// Parent starts its own Bash with no id (forces name-based fallback).
	m = B.startTool(m, { name: 'Bash', args: { command: 'parent cmd' } });
	m = B.startTool(m, { id: 'task1', name: 'Task' });
	m = B.startTool(m, { name: 'Bash', args: { command: 'child cmd' } }, 'task1');
	// Child result arrives first, scoped to the sub-agent.
	m = B.completeTool(m, { name: 'Bash', ok: true, result: 'child out' }, 'task1');
	const parentTool = m.blocks.find((b) => b.kind === 'tool');
	assert.equal(parentTool.tool.pending, true, 'parent Bash must still be pending');
	const child = m.blocks.find((b) => b.kind === 'subagent').children[0];
	assert.equal(child.tool.result, 'child out');
});

test('all three sub-agent arrival orders converge on ONE block', () => {
	// (a) tool_start then subagent_start
	let a = B.startTool(fresh(), { id: 'x1', name: 'Task' });
	a = B.startSubagent(a, { taskId: 'T', toolUseId: 'x1', subagentType: 'Explore' });
	assert.equal(a.blocks.filter((b) => b.kind === 'subagent').length, 1);
	assert.equal(a.blocks[0].subagentType, 'Explore');

	// (b) subagent_start then tool_start
	let b = B.startSubagent(fresh(), { taskId: 'T', toolUseId: 'x1', subagentType: 'Explore' });
	b = B.startTool(b, { id: 'x1', name: 'Task' });
	assert.equal(b.blocks.filter((x) => x.kind === 'subagent').length, 1);

	// (c) a child event arrives before either — placeholder, then upgrade
	let c = B.startTool(fresh(), { id: 'k1', name: 'Read' }, 'x1');
	assert.equal(c.blocks.filter((x) => x.kind === 'subagent').length, 1, 'placeholder created');
	c = B.startSubagent(c, { taskId: 'T', toolUseId: 'x1', subagentType: 'Plan' });
	assert.equal(c.blocks.filter((x) => x.kind === 'subagent').length, 1, 'no duplicate');
	assert.equal(c.blocks[0].subagentType, 'Plan');
	assert.equal(c.blocks[0].children.length, 1);
});

test('task_updated (task_id only, NO tool_use_id) still finds the block', () => {
	// The real CLI omits tool_use_id on task_updated — verified in the capture.
	let m = B.startTool(fresh(), { id: 'x1', name: 'Task' });
	m = B.startSubagent(m, { taskId: 'T9', toolUseId: 'x1' });
	m = B.progressSubagent(m, { taskId: 'T9', status: 'completed' });
	assert.equal(m.blocks[0].status, 'ok');
	assert.equal(m.blocks.filter((b) => b.kind === 'subagent').length, 1, 'must not create a second block');
});

test('subagent_done sets status + summary; progress tracks live tool name', () => {
	let m = B.startSubagent(fresh(), { taskId: 'T', toolUseId: 'x1' });
	m = B.progressSubagent(m, { taskId: 'T', lastToolName: 'Grep', tokens: 27591 });
	assert.equal(m.blocks[0].lastToolName, 'Grep');
	assert.equal(m.blocks[0].tokens, 27591);
	assert.equal(m.blocks[0].status, 'running');
	m = B.doneSubagent(m, { taskId: 'T', status: 'completed', summary: 'found 3' });
	assert.equal(m.blocks[0].status, 'ok');
	assert.equal(m.blocks[0].summary, 'found 3');
	assert.ok(m.blocks[0].endedAt, 'endedAt stamped');
});

// ── structural sharing (a missed clone freezes the UI) ─────────────────────

test('mutating a sub-agent child returns a NEW top-level blocks array', () => {
	let m = B.startTool(fresh(), { id: 'x1', name: 'Task' });
	m = B.startSubagent(m, { taskId: 'T', toolUseId: 'x1' });
	const before = m.blocks;
	const beforeChildren = m.blocks[0].children;
	m = B.startTool(m, { id: 'c1', name: 'Read' }, 'x1');
	assert.notEqual(m.blocks, before, 'top-level array must be cloned');
	assert.notEqual(m.blocks[0].children, beforeChildren, 'children array must be cloned');
});

test('appendText clones the blocks array', () => {
	let m = B.appendText(fresh(), 'a');
	const before = m.blocks;
	m = B.appendText(m, 'b');
	assert.notEqual(m.blocks, before);
	assert.equal(m.blocks[0].text, 'ab');
});

// ── determinism (StrictMode double-invokes updaters) ───────────────────────

test('same input twice yields identical block ids', () => {
	const build = () => {
		let m = fresh();
        m = B.appendText(m, 'x');
		m = B.startTool(m, { id: 't1', name: 'Bash' });
		m = B.openReasoning(m);
		return m.blocks.map((b) => b.id);
	};
	assert.deepEqual(build(), build());
});

// ── streaming tool args ────────────────────────────────────────────────────

test('partial JSON accumulates and parses only when complete', () => {
	let m = B.startTool(fresh(), { id: 'a1', name: 'Bash' });
	m = B.appendToolArgs(m, 'a1', '{"comm');
	assert.equal(m.blocks[0].tool.args, undefined, 'incomplete JSON must not set args');
	m = B.appendToolArgs(m, 'a1', 'and": "ls -la"}');
	assert.deepEqual(m.blocks[0].tool.args, { command: 'ls -la' });
});

// ── back-compat: the gate for not breaking persisted threads ───────────────

test('legacyBlocks reproduces the exact historical render order', () => {
	const legacy = {
		role: 'assistant',
		content: 'the answer',
		thinking: 'reasoning',
		thinkingDone: true,
		tools: [{ id: 't1', name: 'Bash', ok: true }],
		chips: [{ label: 'next', prompt: 'go' }],
	};
	// thinking -> text -> chips -> tools (cards omitted: entityCardFor stubbed)
	assert.deepEqual(B.legacyBlocks(legacy).map((b) => b.kind),
		['reasoning', 'text', 'chips', 'tool']);
});

test('blocksOf prefers real blocks and falls back to legacy', () => {
	assert.equal(B.blocksOf({ role: 'assistant', content: '', blocks: [] }).length, 0);
	assert.equal(B.blocksOf({ role: 'assistant', content: 'hi' })[0].kind, 'text');
});

test('messageText on a legacy message returns its content', () => {
	assert.equal(B.messageText({ role: 'assistant', content: 'legacy text' }), 'legacy text');
});

// ── cleanup helpers ────────────────────────────────────────────────────────

test('failPendingTools works on blocks AND legacy, incl. sub-agent children', () => {
	let m = B.startTool(fresh(), { id: 'x1', name: 'Task' });
	m = B.startSubagent(m, { taskId: 'T', toolUseId: 'x1' });
	m = B.startTool(m, { id: 'c1', name: 'Bash' }, 'x1');
	m = B.failPendingTools(m);
	const sa = m.blocks[0];
	assert.equal(sa.children[0].tool.pending, false);
	assert.equal(sa.children[0].tool.ok, false);
	assert.equal(sa.status, 'cancelled');

	const legacy = B.failPendingTools({ role: 'assistant', content: '', tools: [{ name: 'Bash', ok: true, pending: true }] });
	assert.equal(legacy.tools[0].pending, false);
});

test('clearApproval reaches a tool nested inside a sub-agent', () => {
	let m = B.startTool(fresh(), { id: 'x1', name: 'Task' });
	m = B.startSubagent(m, { taskId: 'T', toolUseId: 'x1' });
	m = B.startTool(m, { id: 'c1', name: 'Bash' }, 'x1');
	m = B.markApproval(m, { id: 'c1', approvalId: 'ap1' });
	// markApproval is top-level-scoped; approve via the walker regardless.
	m = B.clearApproval(m, 'ap1');
	const child = m.blocks[0].children[0];
	assert.notEqual(child.tool.approvalRequired, true);
});

test('stripForPersist drops scratch and clamps huge results', () => {
	let m = B.startTool(fresh(), { id: 'a1', name: 'Read' });
	m = B.appendToolArgs(m, 'a1', '{"path":"/x"}');
	m = B.completeTool(m, { id: 'a1', name: 'Read', ok: true, result: { text: 'y'.repeat(20000) } });
	const [out] = B.stripForPersist([m]);
	const tb = out.blocks.find((b) => b.kind === 'tool');
	assert.equal(tb.partialJson, undefined, 'streaming scratch dropped');
	assert.equal(tb.tool.result._truncated, true, 'oversized result clamped');
	assert.ok(JSON.stringify(out).length < 12000, 'payload bounded');
});

test('completeTool never drops an unmatched result', () => {
	const m = B.completeTool(fresh(), { id: 'ghost', name: 'Bash', ok: true, result: 'out' });
	assert.equal(m.blocks.length, 1);
	assert.equal(m.blocks[0].tool.result, 'out');
});

test('setReasoningTokens uses the provider count over the char estimate', () => {
	let m = B.openReasoning(fresh());
	m = B.appendReasoning(m, 'x'.repeat(400));   // estimate would be ~100
	m = B.setReasoningTokens(m, 69);
	assert.equal(m.blocks[0].tokens, 69);
});

test('setReasoningTokens is a no-op with no reasoning block', () => {
	const m = B.setReasoningTokens(fresh(), 42);
	assert.equal(m.blocks.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
