// Rich renderers for Claude Code tool calls (claude-code-* models).
//
// The claude-sandbox streams the CLI's native tool events through identity
// verbatim, so `tool_start`/`tool_call` arrive with the CLI's tool names
// (Bash, Edit, Write, Read, Glob, Grep, TodoWrite, Task, WebFetch,
// WebSearch, …) and arg shapes. This module maps those names to
// claude.ai/code-style views — terminal blocks, diffs, checklists — and
// falls back to the generic ToolChip for anything unregistered (all the
// in-house snake_case tools keep their existing chip).

import { useState, type ReactElement } from 'react';
import { Loader2, ChevronDown, Terminal, FileText, FilePen, Search, ListTodo, Globe, Bot } from 'lucide-react';
import type { ToolCall } from './types';

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
export function MonoBlock({ text, tone }: { text: string; tone?: 'error' }) {
	if (!text) return null;
	return (
		<pre className={[
			'mt-1 p-2 rounded-md border text-[10.5px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto',
			tone === 'error' ? 'bg-rose-50/60 border-rose-200 text-rose-900' : 'bg-zinc-900 border-zinc-700 text-zinc-100',
		].join(' ')}>
			{text}
		</pre>
	);
}

// ── Bash — terminal block: `$ command` + output ─────────────────────────────
function BashView({ t }: { t: ToolCall }) {
	const [open, setOpen] = useState(true);
	const cmd = str(t.args?.command);
	const out = resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 max-w-full group">
				<Terminal className="w-3 h-3 text-zinc-500 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">$ {cmd || '(bash)'}</span>
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			{open && !t.pending && <MonoBlock text={out} tone={t.ok ? undefined : 'error'} />}
		</div>
	);
}

// ── Edit / MultiEdit — old/new line diff ────────────────────────────────────
function diffLines(oldS: string, newS: string): Array<{ sign: '-' | '+'; line: string }> {
	const out: Array<{ sign: '-' | '+'; line: string }> = [];
	for (const l of oldS.split('\n')) out.push({ sign: '-', line: l });
	for (const l of newS.split('\n')) out.push({ sign: '+', line: l });
	return out;
}

function EditView({ t }: { t: ToolCall }) {
	const [open, setOpen] = useState(true);
	const path = str(t.args?.file_path);
	// MultiEdit carries edits[]; single Edit carries old_string/new_string.
	const edits = Array.isArray(t.args?.edits)
		? (t.args!.edits as Array<{ old_string?: string; new_string?: string }>)
		: [{ old_string: str(t.args?.old_string), new_string: str(t.args?.new_string) }];
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 max-w-full group">
				<FilePen className="w-3 h-3 text-amber-600 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">{path || 'edit'}</span>
				{edits.length > 1 && <span className="opacity-60">×{edits.length}</span>}
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			{open && (
				<div className="mt-1 rounded-md border border-border overflow-hidden max-h-56 overflow-y-auto">
					{edits.map((e, i) => (
						<div key={i} className={i > 0 ? 'border-t border-border' : ''}>
							{diffLines(str(e.old_string), str(e.new_string)).map((d, j) => (
								<div
									key={j}
									className={[
										'px-2 font-mono text-[10.5px] whitespace-pre-wrap break-all',
										d.sign === '-' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800',
									].join(' ')}
								>
									<span className="select-none opacity-60 mr-1">{d.sign}</span>{d.line}
								</div>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── Write — path header + collapsible content preview ───────────────────────
function WriteView({ t }: { t: ToolCall }) {
	const [open, setOpen] = useState(false);
	const path = str(t.args?.file_path);
	const content = str(t.args?.content);
	const lines = content ? content.split('\n').length : 0;
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 max-w-full group">
				<FileText className="w-3 h-3 text-emerald-600 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">{path || 'write'}</span>
				{lines > 0 && <span className="opacity-60">{lines} lines</span>}
				<StatusDot t={t} />
				<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
			</button>
			{open && <MonoBlock text={content.length > 4000 ? content.slice(0, 4000) + '\n…' : content} />}
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
	const [open, setOpen] = useState(false);
	const desc = str(t.args?.description) || str(t.args?.prompt).slice(0, 80);
	const out = resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 max-w-full group">
				<Bot className="w-3 h-3 text-indigo-600 shrink-0" />
				<span className="text-zinc-700">agent: {desc || 'task'}</span>
				<StatusDot t={t} />
				{!t.pending && out && (
					<ChevronDown className={['w-3 h-3 opacity-40 group-hover:opacity-100 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
				)}
			</button>
			{open && <MonoBlock text={out.length > 4000 ? out.slice(0, 4000) + '\n…' : out} />}
		</div>
	);
}

// ── WebFetch / WebSearch — chip (WebFetch fails under the sandbox netpol —
// the error renders plainly via the ✗ dot + output) ─────────────────────────
function WebView({ t }: { t: ToolCall }) {
	const [open, setOpen] = useState(false);
	const target = str(t.args?.url) || str(t.args?.query);
	const out = resultText(t);
	return (
		<div className="max-w-full text-[11px]">
			<button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 max-w-full group">
				<Globe className="w-3 h-3 text-sky-600 shrink-0" />
				<span className="font-mono text-zinc-700 truncate max-w-[420px]">{t.name} {target}</span>
				<StatusDot t={t} />
			</button>
			{open && !t.ok && <MonoBlock text={out} tone="error" />}
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
	Task: TaskView,
	WebFetch: WebView,
	WebSearch: WebView,
};

// claudeToolView returns the rich view component for a Claude Code tool
// name, or null when the generic ToolChip should render instead.
export function claudeToolView(name: string): ((props: { t: ToolCall }) => ReactElement) | null {
	return TOOL_VIEWS[name] ?? null;
}
