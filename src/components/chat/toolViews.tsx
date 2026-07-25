// Rich renderers for Claude Code tool calls (claude-code-* models).
//
// The claude-sandbox streams the CLI's native tool events through identity
// verbatim, so `tool_start`/`tool_call` arrive with the CLI's tool names
// (Bash, Edit, Write, Read, Glob, Grep, TodoWrite, Task, WebFetch,
// WebSearch, …) and arg shapes. This module maps those names to
// claude.ai/code-style views — terminal blocks, diffs, checklists — and
// falls back to the generic ToolChip for anything unregistered (all the
// in-house snake_case tools keep their existing chip).

import { useState, useEffect, useRef, type ReactElement } from 'react';
import { Loader2, ChevronDown, Terminal, FileText, FilePen, Search, ListTodo, Globe, Bot, NotebookPen, ClipboardList, Zap, Plug, Wrench } from 'lucide-react';
import type { ToolCall } from './types';
import { Collapse } from './motion';

// resultText flattens a claude CLI tool_result content payload — a plain
// string or an array of {type:"text", text} blocks — into displayable text.
export function resultText(t: ToolCall): string {
	const r = t.result as unknown;
	if (r == null) return '';
	if (typeof r === 'string') return r;
	if (Array.isArray(r)) {
		return r
			.map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
			.filter(Boolean)
			.join('\n');
	}
	try { return JSON.stringify(r, null, 2); } catch { return String(r); }
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : v == null ? '' : String(v);
}

// Status dot shared by the views: spinner while pending, ✓/✗ after.
export function StatusDot({ t }: { t: ToolCall }) {
	if (t.pending) return <Loader2 className="w-3 h-3 animate-spin text-sky-600" />;
	return <span className={['text-[10px]', t.ok ? 'text-emerald-600' : 'text-rose-600'].join(' ')}>{t.ok ? '✓' : '✗'}</span>;
}

// Collapsible monospace block, capped height, used for command output +
// file previews.
// Auto-collapse: a tool's output is expanded while it's running and folds to
// its header line once it completes, so a finished turn is a tidy list of
// commands rather than a wall of output (this is the "auto collapse" behavior).
// Sticky against the user: once they click, we never fight them.
//
// pending=true keeps it open; the pending→done transition collapses it. Passing
// `keepOpen` (e.g. a failure, where the output is the point) leaves it expanded.
function useAutoCollapse(pending: boolean | undefined, keepOpen = false) {
	const [open, setOpen] = useState<boolean>(!!pending || keepOpen);
	const touched = useRef(false);
	const wasPending = useRef(!!pending);
	useEffect(() => {
		if (wasPending.current && !pending && !touched.current && !keepOpen) setOpen(false);
		wasPending.current = !!pending;
	}, [pending, keepOpen]);
	const toggle = () => { touched.current = true; setOpen((v) => !v); };
	return [open, toggle] as const;
}

// Cap what actually reaches the DOM. max-h + overflow only hides overflow — a
// 48 KB single line with break-all still has to be laid out, and it read as a
// wall of characters with no indication of how much there was.
const MONO_CAP = 6000;

export function MonoBlock({ text, tone }: { text: string; tone?: 'error' }) {
	if (!text) return null;
	const over = text.length > MONO_CAP;
	const shown = over ? text.slice(0, MONO_CAP) : text;
	const size = text.length >= 1024 ? `${(text.length / 1024).toFixed(1)} KB` : `${text.length} B`;
	return (
		<div className="mt-1">
			<pre className={[
				'p-2 rounded-md border text-[10.5px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto',
				tone === 'error' ? 'bg-rose-50/60 border-rose-200 text-rose-900' : 'bg-zinc-900 border-zinc-700 text-zinc-100',
				over ? 'rounded-b-none' : '',
			].join(' ')}>
				{shown}
			</pre>
			{over && (
				<div className="px-2 py-0.5 rounded-b-md border border-t-0 border-zinc-700 bg-zinc-800 text-[9.5px] text-zinc-400 tabular-nums">
					showing first {(MONO_CAP / 1024).toFixed(0)} KB of {size}
				</div>
			)}
		</div>
	);
}

// ── Bash — terminal block: `$ command` + output ─────────────────────────────
function BashView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const cmd = str(t.args?.command);
	// The CLI's typed result splits the streams and flags interruption; the
	// flattened string merges them. Prefer typed when the bridge forwarded it
	// (main-agent calls only — sub-agent results arrive without it).
	const typed = t.resultTyped;
	const stdout = typed ? str(typed.stdout) : '';
	const stderr = typed ? str(typed.stderr) : '';
	const interrupted = !!typed?.interrupted;
	const out = typed ? stdout : resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				{/* The Terminal icon already signals "shell"; a `$` prefix on top
				    of it read as a doubled prompt (>_ $). Icon + monospace command
				    is one prompt, consistent with the other icon-led tool rows. */}
				<Terminal className="w-3 h-3 text-zinc-500 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">{cmd || '(bash)'}</span>
				{interrupted && (
					<span className="shrink-0 px-1 rounded bg-amber-100 text-amber-800 text-[9.5px] border border-amber-200">
						interrupted
					</span>
				)}
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			<Collapse open={open && !t.pending}>
				<>
					<MonoBlock text={out} tone={t.ok ? undefined : 'error'} />
					{/* stderr kept visually distinct rather than concatenated —
					    "did it warn or did it fail" is the whole question. */}
					{stderr && <MonoBlock text={stderr} tone="error" />}
					{typed && !stdout && !stderr && !!typed.noOutputExpected && (
						<div className="mt-1 text-[10px] text-muted-foreground italic">(no output)</div>
					)}
				</>
			</Collapse>
		</div>
	);
}

// ── Edit / MultiEdit — real line diff ───────────────────────────────────────
// A proper LCS diff, so unchanged lines show as context instead of every old
// line being marked removed and every new line added (which is what the
// previous "diff" did — it made a one-character change look like a rewrite).
function diffLines(oldS: string, newS: string): Array<{ sign: '-' | '+' | ' '; line: string }> {
	const a = oldS.split('\n');
	const b = newS.split('\n');
	// Guard: LCS is O(n*m); fall back to a plain replacement view on huge edits.
	if (a.length * b.length > 250_000) {
		return [...a.map((l) => ({ sign: '-' as const, line: l })), ...b.map((l) => ({ sign: '+' as const, line: l }))];
	}
	const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}
	const out: Array<{ sign: '-' | '+' | ' '; line: string }> = [];
	let i = 0, j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) { out.push({ sign: ' ', line: a[i] }); i++; j++; }
		else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ sign: '-', line: a[i] }); i++; }
		else { out.push({ sign: '+', line: b[j] }); j++; }
	}
	while (i < a.length) { out.push({ sign: '-', line: a[i++] }); }
	while (j < b.length) { out.push({ sign: '+', line: b[j++] }); }
	// Collapse long unchanged runs — a diff is about what moved.
	const CONTEXT = 2;
	const keep = new Array(out.length).fill(false);
	out.forEach((d, k) => {
		if (d.sign === ' ') return;
		for (let x = Math.max(0, k - CONTEXT); x <= Math.min(out.length - 1, k + CONTEXT); x++) keep[x] = true;
	});
	const folded: Array<{ sign: '-' | '+' | ' '; line: string }> = [];
	let skipped = 0;
	out.forEach((d, k) => {
		if (keep[k]) {
			if (skipped) { folded.push({ sign: ' ', line: `⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}` }); skipped = 0; }
			folded.push(d);
		} else skipped++;
	});
	if (skipped) folded.push({ sign: ' ', line: `⋯ ${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
	return folded;
}

function EditView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const path = str(t.args?.file_path);
	// MultiEdit carries edits[]; single Edit carries old_string/new_string.
	const edits = Array.isArray(t.args?.edits)
		? (t.args!.edits as Array<{ old_string?: string; new_string?: string }>)
		: [{ old_string: str(t.args?.old_string), new_string: str(t.args?.new_string) }];
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<FilePen className="w-3 h-3 text-amber-600 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">{path || 'edit'}</span>
				{edits.length > 1 && <span className="opacity-60">×{edits.length}</span>}
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			<Collapse open={open}>
				<div className="mt-1 rounded-md border border-border overflow-hidden max-h-56 overflow-y-auto">
					{edits.map((e, i) => (
						<div key={i} className={i > 0 ? 'border-t border-border' : ''}>
							{diffLines(str(e.old_string), str(e.new_string)).map((d, j) => (
								<div
									key={j}
									className={[
										'px-2 font-mono text-[10.5px] whitespace-pre-wrap break-all',
										d.sign === '-' ? 'bg-rose-50 text-rose-800'
											: d.sign === '+' ? 'bg-emerald-50 text-emerald-800'
												: 'text-muted-foreground',
									].join(' ')}
								>
									<span className="select-none opacity-60 mr-1">{d.sign}</span>{d.line}
								</div>
							))}
						</div>
					))}
				</div>
			</Collapse>
		</div>
	);
}

// ── Write — path header + collapsible content preview ───────────────────────
function WriteView({ t }: { t: ToolCall }) {
	const failed = !t.ok && !t.pending;
	const err = failed ? resultText(t) : '';
	// A FAILED write must NOT keep the content preview open (keepOpen=false):
	// the preview is the intended file body, not the error, so force-opening it
	// showed a wall of comments that told you nothing about why it failed. On
	// failure we surface the error instead; on success it folds like everything.
	const [open, toggle] = useAutoCollapse(t.pending);
	const path = str(t.args?.file_path);
	const content = str(t.args?.content);
	const lines = content ? content.split('\n').length : 0;
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<FileText className={['w-3 h-3 shrink-0', failed ? 'text-rose-500' : 'text-emerald-600'].join(' ')} />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">{path || 'write'}</span>
				{lines > 0 && <span className="opacity-60">{lines} lines</span>}
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			{/* Failure → the error, always visible (it's short and it's the point).
			    Success → the collapsible content preview. */}
			{failed && err
				? <MonoBlock text={err} tone="error" />
				: <Collapse open={open}><MonoBlock text={content.length > 4000 ? content.slice(0, 4000) + '\n…' : content} /></Collapse>}
		</div>
	);
}

// ── Read / Glob / Grep — compact chips ──────────────────────────────────────
function ReadView({ t }: { t: ToolCall }) {
	const path = str(t.args?.file_path);
	const n = resultText(t).split('\n').length;
	return (
		<div className="inline-flex items-center gap-1.5 text-[11px] max-w-full">
			<FileText className="w-3 h-3 text-sky-600 shrink-0" />
			<span className="font-mono text-zinc-700 truncate max-w-[420px]">{path || 'read'}</span>
			{!t.pending && t.ok && <span className="opacity-60">{n} lines</span>}
			<StatusDot t={t} />
		</div>
	);
}

function SearchView({ t }: { t: ToolCall }) {
	const pattern = str(t.args?.pattern);
	const out = resultText(t);
	const n = out ? out.split('\n').filter(Boolean).length : 0;
	return (
		<div className="inline-flex items-center gap-1.5 text-[11px] max-w-full">
			<Search className="w-3 h-3 text-violet-600 shrink-0" />
			<span className="font-mono text-zinc-700 truncate max-w-[380px]">{t.name} {pattern}</span>
			{!t.pending && <span className="opacity-60">{n} match{n === 1 ? '' : 'es'}</span>}
			<StatusDot t={t} />
		</div>
	);
}

// ── TodoWrite — checklist ───────────────────────────────────────────────────
type Todo = { content?: string; status?: string; activeForm?: string };
function TodoView({ t }: { t: ToolCall }) {
	const todos = Array.isArray(t.args?.todos) ? (t.args!.todos as Todo[]) : [];
	return (
		<div className="max-w-full text-[11px]">
			<div className="inline-flex items-center gap-1.5">
				<ListTodo className="w-3 h-3 text-gold-700 shrink-0" />
				<span className="text-zinc-700 font-medium">Tasks</span>
				<StatusDot t={t} />
			</div>
			<div className="mt-0.5 ml-4 flex flex-col gap-0.5">
				{todos.map((td, i) => (
					<div key={i} className="inline-flex items-start gap-1.5">
						<span className="text-[10px] mt-0.5 select-none">
							{td.status === 'completed' ? '✅' : td.status === 'in_progress' ? '🔄' : '⬜'}
						</span>
						<span className={td.status === 'completed' ? 'line-through opacity-60' : ''}>
							{td.status === 'in_progress' && td.activeForm ? td.activeForm : td.content}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

// ── Task — sub-agent card ───────────────────────────────────────────────────
function TaskView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const desc = str(t.args?.description) || str(t.args?.prompt).slice(0, 80);
	const out = resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<Bot className="w-3 h-3 text-indigo-600 shrink-0" />
				<span className="text-zinc-700">agent: {desc || 'task'}</span>
				<StatusDot t={t} />
				{!t.pending && out && (
					<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
				)}
			</button>
			<Collapse open={open}><MonoBlock text={out.length > 4000 ? out.slice(0, 4000) + '\n…' : out} /></Collapse>
		</div>
	);
}

// ── WebFetch / WebSearch — chip (WebFetch fails under the sandbox netpol —
// the error renders plainly via the ✗ dot + output) ─────────────────────────
function WebView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const target = str(t.args?.url) || str(t.args?.query);
	const out = resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<Globe className="w-3 h-3 text-sky-600 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">{t.name} {target}</span>
				<StatusDot t={t} />
				{!t.pending && out && (
					<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
				)}
			</button>
			{/* Was `!t.ok` — successful fetches/searches were unviewable, which is
			    exactly the case you want to read. */}
			<Collapse open={open && !t.pending}><MonoBlock text={out} tone={t.ok ? undefined : 'error'} /></Collapse>
		</div>
	);
}

// ── NotebookEdit — cell-scoped edit ─────────────────────────────────────────
function NotebookView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const path = str(t.args?.notebook_path);
	const cell = str(t.args?.cell_id);
	const mode = str(t.args?.edit_mode) || 'replace';
	const src = str(t.args?.new_source);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<NotebookPen className="w-3 h-3 text-orange-600 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[380px]">{path || 'notebook'}</span>
				<span className="opacity-60">{mode}{cell ? ` ${cell.slice(0, 8)}` : ''}</span>
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			<Collapse open={open}><MonoBlock text={src.length > 4000 ? src.slice(0, 4000) + '\n…' : src} /></Collapse>
		</div>
	);
}

// ── ExitPlanMode — the plan awaiting approval ───────────────────────────────
function PlanView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const plan = str(t.args?.plan);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<ClipboardList className="w-3 h-3 text-violet-600 shrink-0" />
				<span className="text-zinc-700">plan ready</span>
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			<Collapse open={open && !!plan}>
				<div className="mt-1 px-2.5 py-2 rounded-md border border-violet-200 bg-violet-50/50 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
					{plan}
				</div>
			</Collapse>
		</div>
	);
}

// ── SlashCommand / Skill — named invocation ─────────────────────────────────
function CommandView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const name = str(t.args?.command) || str(t.args?.skill) || str(t.args?.name);
	const out = resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<Zap className="w-3 h-3 text-gold-600 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">{t.name === 'Skill' ? 'skill' : ''} {name || t.name}</span>
				<StatusDot t={t} />
				{!t.pending && out && (
					<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
				)}
			</button>
			<Collapse open={open && !t.pending}><MonoBlock text={out} tone={t.ok ? undefined : 'error'} /></Collapse>
		</div>
	);
}

// ── BashOutput / KillShell — background-shell control ───────────────────────
function ShellCtlView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const id = str(t.args?.bash_id) || str(t.args?.shell_id);
	const out = resultText(t);
	const kill = t.name === 'KillShell';
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<Terminal className={['w-3 h-3 shrink-0', kill ? 'text-rose-500' : 'text-zinc-500'].join(' ')} />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">
					{kill ? 'kill' : 'output'} {id}
				</span>
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			<Collapse open={open && !t.pending}><MonoBlock text={out} tone={t.ok ? undefined : 'error'} /></Collapse>
		</div>
	);
}

// ── MCP tools (mcp__<server>__<tool>) — server-labelled chip ───────────────
function McpView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const parts = t.name.split('__');
	const server = parts[1] || 'mcp';
	const tool = parts.slice(2).join('__') || t.name;
	const out = resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<Plug className="w-3 h-3 text-teal-600 shrink-0" />
				<span className="shrink-0 px-1 rounded bg-teal-50 text-teal-700 text-[9.5px] border border-teal-200">{server}</span>
				<span className="font-mono text-zinc-700 truncate max-w-[360px]">{tool}</span>
				<StatusDot t={t} />
				{!t.pending && out && (
					<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
				)}
			</button>
			<Collapse open={open && !t.pending}><MonoBlock text={out} tone={t.ok ? undefined : 'error'} /></Collapse>
		</div>
	);
}

// ── Task* family — this sandbox's task-list tools ───────────────────────────
//
// This CLI build exposes TaskCreate / TaskUpdate / TaskList / TaskGet /
// TaskOutput / TaskStop instead of TodoWrite (which is keyed above but does not
// exist here). They had no renderer, so a turn that created seven tasks showed
// seven anonymous generic chips — the single worst source of visual debris in a
// real transcript. Each is now ONE tight line so a run of them reads as a
// checklist rather than a stack of blocks.
function TaskItemView({ t }: { t: ToolCall }) {
	const a = t.args || {};
	const subject = str(a.subject) || str(a.description);
	const status = str(a.status);
	const id = str(a.taskId) || str(a.task_id);

	let glyph = '•';
	let label = subject || t.name;
	let tone = 'text-zinc-700';
	switch (t.name) {
		case 'TaskCreate':
			glyph = '+';
			label = subject || 'task';
			break;
		case 'TaskUpdate':
			// The common case is a status flip; show what it became.
			glyph = status === 'completed' ? '✓' : status === 'in_progress' ? '▸' : '~';
			label = subject || (status ? status.replace('_', ' ') : 'update') + (id ? ` #${id}` : '');
			tone = status === 'completed' ? 'text-emerald-700' : 'text-zinc-600';
			break;
		case 'TaskList':
			glyph = '☰'; label = 'task list'; tone = 'text-zinc-500';
			break;
		case 'TaskGet':
			glyph = '?'; label = id ? `task #${id}` : 'task'; tone = 'text-zinc-500';
			break;
		case 'TaskStop':
			glyph = '■'; label = id ? `stop #${id}` : 'stop task'; tone = 'text-rose-600';
			break;
		case 'TaskOutput':
			glyph = '»'; label = id ? `output #${id}` : 'task output'; tone = 'text-zinc-500';
			break;
	}
	return (
		<div className="max-w-full text-[11px] flex items-center gap-1.5">
			<span className="w-3 shrink-0 text-center opacity-50 select-none">{glyph}</span>
			<span className={['truncate max-w-[440px]', tone].join(' ')}>{label}</span>
			<StatusDot t={t} />
		</div>
	);
}

// ── the rest of this sandbox's tools — labelled, not anonymous ──────────────
function NamedView({ t }: { t: ToolCall }) {
	const [open, toggle] = useAutoCollapse(t.pending, !t.ok && !t.pending);
	const a = t.args || {};
	const detail = str(a.name) || str(a.cron) || str(a.prompt) || str(a.message) || str(a.description) || str(a.summary);
	const out = resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={toggle} className="inline-flex items-center gap-1.5 max-w-full group">
				<Wrench className="w-3 h-3 text-zinc-500 shrink-0" />
				<span className="font-mono text-zinc-700">{t.name}</span>
				{detail && <span className="truncate max-w-[320px] text-muted-foreground">{detail}</span>}
				<StatusDot t={t} />
				{!t.pending && out && (
					<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
				)}
			</button>
			<Collapse open={open && !t.pending}><MonoBlock text={out} tone={t.ok ? undefined : 'error'} /></Collapse>
		</div>
	);
}

// Registry keyed by the CLI's tool names (verbatim from the stream).
const TOOL_VIEWS: Record<string, (props: { t: ToolCall }) => ReactElement> = {
	Bash: BashView,
	Edit: EditView,
	MultiEdit: EditView,
	Write: WriteView,
	Read: ReadView,
	Glob: SearchView,
	Grep: SearchView,
	TodoWrite: TodoView,
	// The CLI registers this as `Task` but emits tool_use name `Agent`
	// (verified in a live 2.1.x capture) — key both.
	Task: TaskView,
	Agent: TaskView,
	WebFetch: WebView,
	WebSearch: WebView,
	NotebookEdit: NotebookView,
	ExitPlanMode: PlanView,
	SlashCommand: CommandView,
	Skill: CommandView,
	BashOutput: ShellCtlView,
	KillShell: ShellCtlView,
	// This sandbox's task-list family (it has no TodoWrite).
	TaskCreate: TaskItemView,
	TaskUpdate: TaskItemView,
	TaskList: TaskItemView,
	TaskGet: TaskItemView,
	TaskStop: TaskItemView,
	TaskOutput: TaskItemView,
	// Present in this sandbox and previously anonymous.
	CronCreate: NamedView,
	CronDelete: NamedView,
	CronList: NamedView,
	EnterWorktree: NamedView,
	ExitWorktree: NamedView,
	ReportFindings: NamedView,
	ScheduleWakeup: NamedView,
	SendMessage: NamedView,
	Workflow: NamedView,
};

// claudeToolView returns the rich view component for a Claude Code tool
// name, or null when the generic ToolChip should render instead.
export function claudeToolView(name: string): ((props: { t: ToolCall }) => ReactElement) | null {
	if (TOOL_VIEWS[name]) return TOOL_VIEWS[name];
	// MCP tools are dynamic (mcp__<server>__<tool>) so they can't be enumerated.
	if (name.startsWith('mcp__')) return McpView;
	return null;
}
