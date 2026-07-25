// Ordered renderers for the block model.
//
// One `BlockView` switch replaces MessageBubble's fixed JSX sequence
// (thinking → assembly → appSurface → entity cards → text → chips → tools), so
// a turn renders in true arrival order and a sub-agent's work nests under the
// Task that spawned it.
//
// Deliberately reuses the existing leaf renderers untouched — ToolCall is
// frozen, so toolViews.tsx (11 registered views) and entityCards.tsx need no
// changes at all.

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { Loader2, ChevronDown, Bot, AlertTriangle, Info, Scissors } from 'lucide-react';

import type { Block, SubagentBlock, ToolCall } from './types';
import { MonoBlock, resultText } from './toolViews';
import { entityCardFor } from './entityCards';

export type BlockViewProps = {
	b: Block;
	isUser?: boolean;
	streaming?: boolean;
	depth?: number;
	onToolApprove?: (approvalId: string, approved: boolean, always?: boolean, tool?: string) => void;
	// Injected so this module doesn't import StudioChat (circular) — those
	// components live there and stay there.
	renderTool: (t: ToolCall, onApprove?: (approved: boolean, always?: boolean) => void) => ReactNode;
	renderText: (text: string, done?: boolean) => ReactNode;
	renderReasoning: (text: string, done: boolean, elapsedMs?: number) => ReactNode;
	renderCard: (card: Extract<Block, { kind: 'card' }>['card']) => ReactNode;
	renderChips: (chips: Extract<Block, { kind: 'chips' }>['chips']) => ReactNode;
};

export function BlockView(props: BlockViewProps) {
	const { b, streaming, depth = 0 } = props;

	switch (b.kind) {
		case 'text':
			return <>{props.renderText(b.text, b.done)}</>;

		case 'reasoning':
			return <>{props.renderReasoning(
				b.text,
				!!b.done,
				b.startedAt ? (b.endedAt ?? Date.now()) - b.startedAt : undefined,
			)}</>;

		case 'tool': {
			const t = b.tool;
			const onApprove = t.approvalRequired && t.approvalId && props.onToolApprove
				? (approved: boolean, always?: boolean) => props.onToolApprove!(t.approvalId!, approved, always, t.name)
				: undefined;
			return <>{props.renderTool(t, onApprove)}</>;
		}

		case 'subagent':
			return <SubagentBlockView {...props} b={b} depth={depth} />;

		case 'card':
			return <>{props.renderCard(b.card)}</>;

		case 'chips':
			return streaming ? null : <>{props.renderChips(b.chips)}</>;

		case 'notice':
			return <NoticeView level={b.level} text={b.text} detail={b.detail} />;
	}
}

function NoticeView({ level, text, detail }: { level: 'error' | 'info'; text: string; detail?: string }) {
	const err = level === 'error';
	return (
		<div className={[
			'mt-2 flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px]',
			err ? 'border-rose-200 bg-rose-50/70 text-rose-900' : 'border-border bg-muted/50 text-muted-foreground',
		].join(' ')}>
			{err ? <AlertTriangle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
				: text.toLowerCase().includes('compact')
					? <Scissors className="w-3.5 h-3.5 mt-px flex-shrink-0" />
					: <Info className="w-3.5 h-3.5 mt-px flex-shrink-0" />}
			<span className="min-w-0 break-words">
				{text}
				{detail && <span className="ml-1 opacity-70">({detail})</span>}
			</span>
		</div>
	);
}

// ── sub-agent group ─────────────────────────────────────────────────────────

function fmtTokens(n?: number): string {
	if (!n) return '';
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`;
}

function fmtDur(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Ticks only while running, so a finished transcript holds zero timers. */
function useElapsed(startedAt: number, endedAt: number | undefined, running: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [running]);
	return (endedAt ?? (running ? now : startedAt)) - startedAt;
}

/**
 * A Task rendered the way the CLI presents one: header + dim metadata line +
 * an indented rail of the sub-agent's own activity + a terminal summary.
 *
 * Open while working so the user watches it, auto-collapsed when done — but
 * never fighting a user who clicked (touchedRef).
 */
function SubagentBlockView(props: BlockViewProps & { b: SubagentBlock; depth: number }) {
	const { b, depth } = props;
	const running = b.status === 'running';
	const [open, setOpen] = useState(running);
	const touched = useRef(false);
	const [showPrompt, setShowPrompt] = useState(false);
	const elapsed = useElapsed(b.startedAt, b.endedAt, running);

	useEffect(() => {
		if (!running && !touched.current) setOpen(false);
	}, [running]);

	const toolCount = b.children.filter((c) => c.kind === 'tool' || c.kind === 'subagent').length;
	const label = b.description || (b.prompt ? b.prompt.slice(0, 80) : 'sub-agent');
	const summary = b.summary || (b.tool.result ? resultText(b.tool) : '');

	const meta = [
		b.lastToolName && running ? b.lastToolName : '',
		toolCount ? `${toolCount} tool${toolCount === 1 ? '' : 's'}` : '',
		fmtTokens(b.tokens),
		fmtDur(elapsed),
	].filter(Boolean).join(' · ');

	return (
		<div className={['mt-2 border-l-2 pl-2.5', depth > 0 ? 'ml-1' : '',
			running ? 'border-indigo-300' : b.status === 'ok' ? 'border-indigo-200/70' : 'border-rose-300',
		].join(' ')}>
			<button
				type="button"
				onClick={() => { touched.current = true; setOpen((v) => !v); }}
				className="group/sa w-full flex items-center gap-1.5 text-left text-[12px] text-muted-foreground hover:text-foreground transition-colors"
			>
				<ChevronDown className={['w-3 h-3 flex-shrink-0 transition-transform', open ? '' : '-rotate-90'].join(' ')} />
				<Bot className="w-3.5 h-3.5 flex-shrink-0 text-indigo-500" />
				<span className="font-medium text-foreground truncate">{label}</span>
				{b.subagentType && (
					<span className="flex-shrink-0 px-1.5 py-px rounded-full bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-200">
						{b.subagentType}
					</span>
				)}
				<span className="flex-shrink-0 ml-auto flex items-center gap-1.5">
					{running
						? <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
						: <span className={['text-[10px]', b.status === 'ok' ? 'text-emerald-600' : 'text-rose-600'].join(' ')}>
							{b.status === 'ok' ? '✓' : '✗'}
						</span>}
				</span>
			</button>

			{meta && <div className="mt-0.5 ml-[18px] text-[10px] text-muted-foreground tabular-nums">{meta}</div>}

			{open && (
				<div className="ml-[18px]">
					{b.prompt && (
						<>
							<button
								type="button"
								onClick={() => setShowPrompt((v) => !v)}
								className="mt-1 text-[10px] text-muted-foreground hover:text-foreground underline decoration-dotted"
							>
								{showPrompt ? 'hide prompt' : 'prompt'}
							</button>
							{showPrompt && <MonoBlock text={b.prompt} />}
						</>
					)}
					{/* The sub-agent's own blocks, rendered by the same components. */}
					{b.children.map((c) => (
						<BlockView key={c.id} {...props} b={c} depth={depth + 1} />
					))}
				</div>
			)}

			{/* Visible even when collapsed — this is the answer the parent consumed. */}
			{!running && summary && (
				<div className="mt-1 ml-[18px] flex items-start gap-1 text-[12px] text-muted-foreground">
					<span className="flex-shrink-0 opacity-60">⎿</span>
					<span className="min-w-0 break-words line-clamp-3">{summary}</span>
				</div>
			)}
		</div>
	);
}

/** Entity card wrapper, kept here so MessageBubble's card arm stays one line. */
export function EntityCardBlock({ tool }: { tool: ToolCall }) {
	const card = entityCardFor(tool);
	return card ? <div className="mb-2">{card}</div> : null;
}
