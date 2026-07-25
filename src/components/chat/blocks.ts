// Block state machine for an assistant turn.
//
// Every export is a PURE function `(Message, args) => Message`. That shape is
// load-bearing for two reasons:
//   1. React 19 StrictMode double-invokes setState updaters, so a reducer that
//      mutated shared state or used a counter for ids would corrupt on replay.
//      Ids here are derived from the wire (tool_use_id) or from position.
//   2. This repo has no unit-test runner (package.json exposes only
//      dev/build/typecheck), so a pure reducer is the only thing that CAN be
//      exercised — see e2e/blocks-replay.mjs.
//
// Structural sharing rule: every mutator returns a NEW `blocks` array along the
// mutated path, including inside SubagentBlock.children. MessageBubble's memo
// comparator identifies block messages by `blocks` reference, so a missed clone
// shows up as "sub-agent output freezes mid-stream".

import type {
	Block, Message, ReasoningBlock, SubagentBlock, SubagentStatus,
	TextBlock, ToolBlock, ToolCall, CardBlock,
} from './types';
import { entityCardFor } from './entityCards';

// ── selectors ───────────────────────────────────────────────────────────────

/** Top-level text only — sub-agent chatter must not reach wire history/TTS. */
export function messageText(m: Message): string {
	if (!m.blocks) return m.content || '';
	return m.blocks
		.filter((b): b is TextBlock => b.kind === 'text')
		.map((b) => b.text)
		.filter(Boolean)
		.join('\n\n');
}

/** Depth-first over every tool, including inside sub-agents. */
export function walkTools(m: Message): ToolCall[] {
	const out: ToolCall[] = [];
	const visit = (bs: Block[]) => {
		for (const b of bs) {
			if (b.kind === 'tool') out.push(b.tool);
			else if (b.kind === 'subagent') { out.push(b.tool); visit(b.children); }
		}
	};
	if (m.blocks) visit(m.blocks);
	else if (m.tools) out.push(...m.tools);
	return out;
}

export function hasPendingTools(m: Message): boolean {
	return walkTools(m).some((t) => t.pending);
}

/**
 * Synthesize blocks for a pre-block Message, reproducing the EXACT order
 * MessageBubble used to hardcode: thinking → assembly → appSurface → entity
 * cards → text → chips → tools. Every persisted thread and every non-stream
 * producer (studio:notify, emitAppOpener, xpio cycle rows) keeps rendering
 * unchanged, with no migration pass and no schema version.
 */
export function legacyBlocks(m: Message): Block[] {
	const out: Block[] = [];
	if (m.role === 'assistant') {
		if (m.thinking !== undefined) {
			out.push({ kind: 'reasoning', id: 'lg:think', text: m.thinking, done: !!m.thinkingDone });
		}
		if (m.composed) {
			out.push({ kind: 'card', id: 'lg:asm', card: { type: 'assembly', draft: m.composed } });
		}
		if (m.appSurface) {
			out.push({ kind: 'card', id: 'lg:surf', card: { type: 'appSurface', ...m.appSurface } });
		}
		(m.tools || []).forEach((t, i) => {
			if (entityCardFor(t)) {
				out.push({ kind: 'card', id: `lg:ec${i}`, card: { type: 'entity', tool: t } });
			}
		});
	}
	if (m.content) out.push({ kind: 'text', id: 'lg:txt', text: m.content, done: true });
	if (m.role === 'assistant' && m.chips?.length) {
		out.push({ kind: 'chips', id: 'lg:chips', chips: m.chips });
	}
	(m.tools || []).forEach((t, i) => out.push({ kind: 'tool', id: `lg:t${i}`, tool: t }));
	return out;
}

/** Blocks to render: real ones when present, else the legacy synthesis. */
export function blocksOf(m: Message): Block[] {
	return m.blocks ?? legacyBlocks(m);
}

// ── internals ───────────────────────────────────────────────────────────────

/** Re-derive the `content` mirror after any text change. One place, one rule. */
function syncContent(m: Message): Message {
	const text = messageText(m);
	return text === m.content ? m : { ...m, content: text };
}

/**
 * Apply `fn` to the block list that owns `parentId` (top level when absent),
 * cloning every container along the way.
 *
 * Returns null when parentId names a sub-agent we've never seen — callers turn
 * that into a placeholder via ensureSubagent rather than dropping the event.
 */
function inScope(
	blocks: Block[],
	parentId: string | undefined,
	fn: (bs: Block[]) => Block[],
): Block[] | null {
	if (!parentId) return fn(blocks);
	let found = false;
	const next = blocks.map((b) => {
		if (b.kind !== 'subagent') return b;
		if (b.toolUseId === parentId || b.taskId === parentId) {
			found = true;
			return { ...b, children: fn(b.children) };
		}
		// Depth is 2 in practice (sub-agents can't spawn sub-agents), but recurse
		// anyway so an unexpected nesting doesn't silently drop content.
		const deeper = inScope(b.children, parentId, fn);
		if (deeper) { found = true; return { ...b, children: deeper }; }
		return b;
	});
	return found ? next : null;
}

function edit(
	m: Message,
	parentId: string | undefined,
	fn: (bs: Block[]) => Block[],
): Message {
	const base = m.blocks ?? [];
	let next = inScope(base, parentId, fn);
	if (!next) {
		// Child arrived before its Task — create the placeholder, then retry.
		const seeded = ensureSubagentBlocks(base, { toolUseId: parentId });
		next = inScope(seeded, parentId, fn) ?? seeded;
	}
	return { ...m, blocks: next };
}

function findSub(blocks: Block[], key: string): SubagentBlock | null {
	for (const b of blocks) {
		if (b.kind !== 'subagent') continue;
		if (b.toolUseId === key || b.taskId === key) return b;
		const deeper = findSub(b.children, key);
		if (deeper) return deeper;
	}
	return null;
}

/**
 * The one place a SubagentBlock is created. Matches on EITHER key and fills in
 * place, so all three arrival orders converge on a single block:
 * tool_start→subagent_start, subagent_start→tool_start, or a child event first.
 */
function ensureSubagentBlocks(
	blocks: Block[],
	a: { toolUseId?: string; taskId?: string; subagentType?: string; description?: string; prompt?: string; tool?: ToolCall },
): Block[] {
	const key = a.toolUseId || a.taskId;
	if (!key) return blocks;
	const existing = findSub(blocks, key)
		|| (a.taskId ? findSub(blocks, a.taskId) : null)
		|| (a.toolUseId ? findSub(blocks, a.toolUseId) : null);

	if (existing) {
		const patch = (b: SubagentBlock): SubagentBlock => ({
			...b,
			toolUseId: b.toolUseId || a.toolUseId,
			taskId: b.taskId || a.taskId,
			subagentType: a.subagentType ?? b.subagentType,
			description: a.description ?? b.description,
			prompt: a.prompt ?? b.prompt,
			tool: a.tool ?? b.tool,
		});
		const walk = (bs: Block[]): Block[] => bs.map((b) => {
			if (b.kind !== 'subagent') return b;
			if (b === existing) return patch(b);
			return { ...b, children: walk(b.children) };
		});
		return walk(blocks);
	}

	// A Task tool_use may already sit in the list as a plain ToolBlock (the
	// tool_start arm creates SubagentBlocks directly, but a resumed stream can
	// deliver the result first). Upgrade it in place rather than duplicating.
	const idx = blocks.findIndex((b) => b.kind === 'tool' && b.tool.id && b.tool.id === a.toolUseId);
	const upgraded: SubagentBlock = {
		kind: 'subagent',
		id: `s:${key}`,
		tool: a.tool ?? (idx >= 0 ? (blocks[idx] as ToolBlock).tool : { name: 'Task', ok: true, pending: true, id: a.toolUseId }),
		toolUseId: a.toolUseId,
		taskId: a.taskId,
		subagentType: a.subagentType,
		description: a.description,
		prompt: a.prompt,
		status: 'running',
		startedAt: Date.now(),
		children: [],
	};
	if (idx >= 0) {
		const next = blocks.slice();
		next[idx] = upgraded;
		return next;
	}
	return [...blocks, upgraded];
}

/**
 * Index of the block a delta should extend, or -1 to start a new one.
 *
 * Deltas extend the TAIL only. Anything else merges text that arrived after a
 * tool back into the paragraph before it — and since not every provider sends
 * content_block_stop, "last unclosed block of this kind" would keep the first
 * text block open for the whole turn and collapse the entire ordering.
 *
 * An exact wire-index match is honored first, so a provider that does bracket
 * its blocks stays precise even if something lands out of order.
 */
function tailOpen(bs: Block[], kind: 'text' | 'reasoning', idx?: number): number {
	if (idx !== undefined) {
		const exact = bs.findIndex((b) => b.kind === kind && (b as TextBlock).idx === idx && !(b as TextBlock).done);
		if (exact >= 0) return exact;
	}
	const last = bs.length - 1;
	if (last < 0) return -1;
	const b = bs[last];
	if (b.kind !== kind || (b as TextBlock).done) return -1;
	// A block carrying a different wire index is a different block.
	if (idx !== undefined && (b as TextBlock).idx !== undefined && (b as TextBlock).idx !== idx) return -1;
	return last;
}

// ── mutators ────────────────────────────────────────────────────────────────

export function appendText(m: Message, delta: string, parentId?: string, idx?: number): Message {
	const out = edit(m, parentId, (bs) => {
		const at = tailOpen(bs, 'text', idx);
		if (at >= 0) {
			const next = bs.slice();
			next[at] = { ...(bs[at] as TextBlock), text: (bs[at] as TextBlock).text + delta };
			return next;
		}
		// No open text block — a tool ran since the last one, so this is a NEW
		// paragraph after it, not a continuation. This is what makes
		// text→tool→text render in true arrival order.
		return [...bs, { kind: 'text', id: `text:${bs.length}`, text: delta, idx }];
	});
	return parentId ? out : syncContent(out);
}

export function appendReasoning(m: Message, delta: string, parentId?: string, idx?: number): Message {
	return edit(m, parentId, (bs) => {
		const at = tailOpen(bs, 'reasoning', idx);
		if (at >= 0) {
			const next = bs.slice();
			next[at] = { ...(bs[at] as ReasoningBlock), text: (bs[at] as ReasoningBlock).text + delta };
			return next;
		}
		return [...bs, { kind: 'reasoning', id: `think:${bs.length}`, text: delta, idx, startedAt: Date.now() }];
	});
}

/** Attach the provider's own reasoning-token count to the open block. */
export function setReasoningTokens(m: Message, tokens: number, parentId?: string): Message {
	return edit(m, parentId, (bs) => {
		for (let i = bs.length - 1; i >= 0; i--) {
			if (bs[i].kind === 'reasoning') {
				const next = bs.slice();
				next[i] = { ...(bs[i] as ReasoningBlock), tokens };
				return next;
			}
		}
		return bs;
	});
}

/** Open a NEW reasoning block. Never reuses an old one — a turn can think more than once. */
export function openReasoning(m: Message, parentId?: string, idx?: number): Message {
	return edit(m, parentId, (bs) => [
		...bs,
		{ kind: 'reasoning', id: `think:${bs.length}`, text: '', idx, startedAt: Date.now() },
	]);
}

export function closeReasoning(m: Message, parentId?: string, idx?: number): Message {
	return edit(m, parentId, (bs) => {
		const at = tailOpen(bs, 'reasoning', idx);
		if (at < 0) return bs;
		const next = bs.slice();
		next[at] = { ...(bs[at] as ReasoningBlock), done: true, endedAt: Date.now() };
		return next;
	});
}

export function closeText(m: Message, parentId?: string, idx?: number): Message {
	return edit(m, parentId, (bs) => {
		const at = tailOpen(bs, 'text', idx);
		if (at < 0) return bs;
		const next = bs.slice();
		next[at] = { ...(bs[at] as TextBlock), done: true };
		return next;
	});
}

export function startTool(
	m: Message,
	t: { id?: string; name: string; args?: Record<string, unknown>; summary?: string },
	parentId?: string,
): Message {
	const tool: ToolCall = {
		id: t.id, name: t.name, ok: true, pending: true, args: t.args, summary: t.summary,
	};
	// A Task/Agent call becomes a sub-agent group immediately, so its children
	// nest even if the system/task_started event never arrives.
	if ((t.name === 'Task' || t.name === 'Agent') && t.id) {
		const args = (t.args || {}) as Record<string, unknown>;
		return edit(m, parentId, (bs) => ensureSubagentBlocks(bs, {
			toolUseId: t.id,
			subagentType: typeof args.subagent_type === 'string' ? args.subagent_type : undefined,
			description: typeof args.description === 'string' ? args.description : undefined,
			prompt: typeof args.prompt === 'string' ? args.prompt : undefined,
			tool,
		}));
	}
	return edit(m, parentId, (bs) => [
		...bs,
		{ kind: 'tool', id: t.id ? `t:${t.id}` : `t:#${bs.length}`, tool },
	]);
}

export function appendToolArgs(m: Message, id: string, partialJson: string, parentId?: string): Message {
	if (!id) return m;
	return edit(m, parentId, (bs) => {
		const at = bs.findIndex((b) => b.kind === 'tool' && b.tool.id === id);
		if (at < 0) return bs;
		const b = bs[at] as ToolBlock;
		const acc = (b.partialJson || '') + partialJson;
		let args = b.tool.args;
		try { args = JSON.parse(acc); } catch { /* still incomplete — expected */ }
		const next = bs.slice();
		next[at] = { ...b, partialJson: acc, tool: { ...b.tool, args } };
		return next;
	});
}

export function markApproval(
	m: Message,
	a: { id?: string; name?: string; approvalId: string; args?: Record<string, unknown> },
): Message {
	return edit(m, undefined, (bs) => {
		let at = a.id ? bs.findIndex((b) => b.kind === 'tool' && b.tool.id === a.id) : -1;
		if (at < 0) {
			for (let i = bs.length - 1; i >= 0; i--) {
				const b = bs[i];
				if (b.kind === 'tool' && b.tool.pending && (!a.name || b.tool.name === a.name)) { at = i; break; }
			}
		}
		if (at < 0) return bs;
		const b = bs[at] as ToolBlock;
		const next = bs.slice();
		next[at] = { ...b, tool: { ...b.tool, approvalRequired: true, approvalId: a.approvalId, args: a.args ?? b.tool.args } };
		return next;
	});
}

/**
 * Complete a tool, scoped by parentId.
 *
 * Scoping matters: the old flat reducer fell back to "last pending with the
 * same name" across the whole list, so a sub-agent's Bash result would complete
 * the PARENT's pending Bash. Name-matching is now confined to one scope.
 */
export function completeTool(m: Message, completed: ToolCall, parentId?: string): Message {
	const out = edit(m, parentId, (bs) => {
		let at = completed.id
			? bs.findIndex((b) => (b.kind === 'tool' || b.kind === 'subagent') && b.tool.id === completed.id)
			: -1;
		if (at < 0 && !completed.id) {
			for (let i = bs.length - 1; i >= 0; i--) {
				const b = bs[i];
				if ((b.kind === 'tool' || b.kind === 'subagent') && b.tool.pending && b.tool.name === completed.name) { at = i; break; }
			}
		}
		const merged = (prev: ToolCall): ToolCall => ({ ...prev, ...completed, pending: false });

		if (at < 0) {
			// Never drop a result: append it as a finished block.
			const withTool: Block[] = [...bs, {
				kind: 'tool',
				id: completed.id ? `t:${completed.id}` : `t:#${bs.length}`,
				tool: { ...completed, pending: false },
			}];
			return maybeEntityCard(withTool, completed);
		}
		const b = bs[at];
		const next = bs.slice();
		if (b.kind === 'subagent') {
			// subagent_done owns status; fall back if it never lands.
			next[at] = {
				...b,
				tool: merged(b.tool),
				status: b.status === 'running' ? (completed.ok ? 'ok' : 'error') : b.status,
				endedAt: b.endedAt ?? Date.now(),
			};
			return next;
		}
		next[at] = { ...(b as ToolBlock), tool: merged((b as ToolBlock).tool) };
		return maybeEntityCard(next, completed);
	});
	return out;
}

/** Emit the entity card as a sibling right after its tool, in order. */
function maybeEntityCard(bs: Block[], t: ToolCall): Block[] {
	if (!entityCardFor(t)) return bs;
	const id = `ec:${t.id || t.name}`;
	if (bs.some((b) => b.id === id)) return bs;
	return [...bs, { kind: 'card', id, card: { type: 'entity', tool: t } } as CardBlock];
}

export function pushCard(m: Message, card: CardBlock['card'], key?: string): Message {
	return edit(m, undefined, (bs) => {
		const id = `card:${key || card.type}`;
		const at = bs.findIndex((b) => b.id === id);
		if (at >= 0) {
			const next = bs.slice();
			next[at] = { kind: 'card', id, card };
			return next;
		}
		return [...bs, { kind: 'card', id, card }];
	});
}

export function pushNotice(m: Message, level: 'error' | 'info', text: string, detail?: string): Message {
	return edit(m, undefined, (bs) => [
		...bs,
		{ kind: 'notice', id: `note:${bs.length}`, level, text, detail },
	]);
}

export function pushChips(m: Message, chips: NonNullable<Message['chips']>): Message {
	return edit(m, undefined, (bs) => [...bs, { kind: 'chips', id: 'chips', chips }]);
}

// ── sub-agent lifecycle ─────────────────────────────────────────────────────

export function startSubagent(
	m: Message,
	a: { taskId?: string; toolUseId?: string; subagentType?: string; description?: string; prompt?: string },
): Message {
	return edit(m, undefined, (bs) => ensureSubagentBlocks(bs, a));
}

export function progressSubagent(
	m: Message,
	a: { taskId?: string; toolUseId?: string; description?: string; lastToolName?: string; tokens?: number; status?: string },
): Message {
	const key = a.taskId || a.toolUseId;
	if (!key) return m;
	return edit(m, undefined, (bs) => {
		const seeded = ensureSubagentBlocks(bs, { taskId: a.taskId, toolUseId: a.toolUseId });
		const walk = (list: Block[]): Block[] => list.map((b) => {
			if (b.kind !== 'subagent') return b;
			if (b.taskId === key || b.toolUseId === key) {
				return {
					...b,
					description: a.description ?? b.description,
					lastToolName: a.lastToolName ?? b.lastToolName,
					tokens: a.tokens ?? b.tokens,
					status: terminalStatus(a.status) ?? b.status,
					endedAt: terminalStatus(a.status) ? (b.endedAt ?? Date.now()) : b.endedAt,
				};
			}
			return { ...b, children: walk(b.children) };
		});
		return walk(seeded);
	});
}

export function doneSubagent(
	m: Message,
	a: { taskId?: string; toolUseId?: string; status?: string; summary?: string; tokens?: number },
): Message {
	const key = a.taskId || a.toolUseId;
	if (!key) return m;
	return edit(m, undefined, (bs) => {
		const seeded = ensureSubagentBlocks(bs, { taskId: a.taskId, toolUseId: a.toolUseId });
		const walk = (list: Block[]): Block[] => list.map((b) => {
			if (b.kind !== 'subagent') return b;
			if (b.taskId === key || b.toolUseId === key) {
				return {
					...b,
					status: terminalStatus(a.status) ?? 'ok',
					summary: a.summary ?? b.summary,
					tokens: a.tokens ?? b.tokens,
					endedAt: b.endedAt ?? Date.now(),
				};
			}
			return { ...b, children: walk(b.children) };
		});
		return walk(seeded);
	});
}

function terminalStatus(s?: string): SubagentStatus | undefined {
	switch (s) {
		case 'completed': case 'success': case 'ok': return 'ok';
		case 'failed': case 'error': return 'error';
		case 'cancelled': case 'canceled': case 'interrupted': return 'cancelled';
		default: return undefined;
	}
}

/**
 * Shrink a transcript for persistence.
 *
 * sessionStorage has a ~5 MB quota and the write happens on EVERY `messages`
 * change — i.e. once per streamed token. Tool results were already persisted
 * uncapped, which blocks roughly double; a couple of big Read/Bash outputs can
 * blow the quota and silently kill persistence for the whole session. Drops
 * streaming scratch (partialJson, pending) and clamps result text.
 */
const PERSIST_RESULT_CAP = 8 * 1024;

export function stripForPersist(msgs: Message[]): Message[] {
	const clampTool = (t: ToolCall): ToolCall => {
		const next: ToolCall = { ...t };
		delete next.pending;
		if (next.result !== undefined) {
			try {
				const s = JSON.stringify(next.result);
				if (s.length > PERSIST_RESULT_CAP) {
					next.result = { _truncated: true, preview: s.slice(0, PERSIST_RESULT_CAP) } as unknown as Record<string, unknown>;
				}
			} catch { next.result = undefined; }
		}
		return next;
	};
	const walk = (bs: Block[]): Block[] => bs.map((b) => {
		if (b.kind === 'tool') {
			const { partialJson: _drop, ...rest } = b;
			return { ...rest, tool: clampTool(b.tool) };
		}
		if (b.kind === 'subagent') return { ...b, tool: clampTool(b.tool), children: walk(b.children) };
		return b;
	});
	return msgs.map((m) => ({
		...m,
		...(m.blocks ? { blocks: walk(m.blocks) } : {}),
		...(m.tools ? { tools: m.tools.map(clampTool) } : {}),
	}));
}

/**
 * Clear an approval prompt everywhere it could live — top-level blocks,
 * sub-agent children, and the legacy tools[]. A flat map would miss an
 * approval raised inside a Task.
 */
export function clearApproval(m: Message, approvalId: string): Message {
	const fix = (t: ToolCall): ToolCall =>
		t.approvalId === approvalId ? { ...t, approvalRequired: false, approvalId: undefined } : t;
	if (!m.blocks) {
		if (!m.tools?.some((t) => t.approvalId === approvalId)) return m;
		return { ...m, tools: m.tools.map(fix) };
	}
	const walk = (bs: Block[]): Block[] => bs.map((b) => {
		if (b.kind === 'tool') return b.tool.approvalId === approvalId ? { ...b, tool: fix(b.tool) } : b;
		if (b.kind === 'subagent') return { ...b, tool: fix(b.tool), children: walk(b.children) };
		return b;
	});
	return { ...m, blocks: walk(m.blocks) };
}

/** Mark every still-pending tool failed — used on abort and on stream end. */
export function failPendingTools(m: Message): Message {
	const fixTool = (t: ToolCall): ToolCall => (t.pending ? { ...t, pending: false, ok: false } : t);
	if (!m.blocks) {
		if (!m.tools?.some((t) => t.pending)) return m;
		return { ...m, tools: m.tools.map(fixTool) };
	}
	const walk = (bs: Block[]): Block[] => bs.map((b) => {
		if (b.kind === 'tool') return b.tool.pending ? { ...b, tool: fixTool(b.tool) } : b;
		if (b.kind === 'subagent') {
			return {
				...b,
				tool: fixTool(b.tool),
				status: b.status === 'running' ? 'cancelled' : b.status,
				children: walk(b.children),
			};
		}
		return b;
	});
	return { ...m, blocks: walk(m.blocks) };
}
