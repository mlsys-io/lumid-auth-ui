// entityCards — inline cards for observability tool results in the chat.
//
// The chat is the main surface now (claude.ai layout), so "how are my
// apps doing?" must answer with the same visual vocabulary the old
// middle pane had — compact white cards, state dots, deep links — not
// a wall of markdown. This generalizes the AssemblyCard precedent
// (compose_workflow already renders inline): a renderer map keyed by
// tool name turns a completed tool result into a card rendered above
// the assistant's text. Map-driven so new tools just add a row.
//
// Deep links reuse the same routes effects.ts::toolLink uses, so a
// card row and the tool chip's "Open →" land in the same place.

import { Link } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Workflow as WorkflowIcon } from 'lucide-react';
import { baseToolName, unwrapToolResult, type ToolCall } from './types';
import { TONES, statusTone, type ToneKey } from '@/lib/tones';
import { appTitle } from '@/components/workflow/AppCard';
import { loopLabel } from '@/lib/workflow-names';
import AppSurfaceCard from './AppSurfaceCard';

const MAX_ROWS = 6;

function appLink(app: string, loop?: string, cycle?: string): string {
	let to = `/studio/apps/${encodeURIComponent(app)}`;
	const q: string[] = [];
	if (loop) q.push(`selected=${encodeURIComponent(loop)}`);
	if (cycle) q.push(`cycle=${encodeURIComponent(cycle)}`);
	return q.length ? `${to}?${q.join('&')}` : to;
}

function rel(tsSec?: number): string {
	if (!tsSec) return '';
	const diff = Date.now() / 1000 - tsSec;
	if (diff < 60) return 'now';
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

function relIso(iso?: string): string {
	if (!iso) return '';
	const t = new Date(iso).getTime();
	return Number.isFinite(t) ? rel(t / 1000) : '';
}

function Dot({ tone }: { tone: ToneKey }) {
	return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONES[tone].dot}`} />;
}

// Shared card chrome — one bordered white card; rows are hairline-divided
// links so every entity is one click from its page.
function Card({ title, rows, more }: { title: string; rows: React.ReactNode[]; more?: number }) {
	if (rows.length === 0) return null;
	return (
		<div className="max-w-md rounded-xl border border-border bg-card shadow-sm overflow-hidden text-left">
			<div className="px-3 pt-2 pb-1 text-[10.5px] tracking-[0.08em] font-medium text-foreground/45 uppercase">{title}</div>
			<div className="divide-y divide-border/70">{rows}</div>
			{more && more > 0 ? (
				<div className="px-3 py-1.5 text-[11px] text-muted-foreground">+{more} more</div>
			) : null}
		</div>
	);
}

function Row({ to, children }: { to?: string; children: React.ReactNode }) {
	const cls = 'group/row flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-foreground transition-colors';
	if (!to) return <div className={cls}>{children}</div>;
	return (
		<Link to={to} className={`${cls} hover:bg-muted`}>
			{children}
			<ArrowUpRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0" />
		</Link>
	);
}

type Renderer = (result: Record<string, any>) => React.ReactNode | null;

function workflowResultCard(kind: 'halo' | 'run', r: Record<string, any>): React.ReactNode {
	if (r?.error) {
		return <Card title="Workflow" rows={[<Row key="e"><span className="text-rose-600 text-[12px]">{String(r.error).slice(0, 140)}</span></Row>]} />;
	}
	const rows: React.ReactNode[] = [];
	if (kind === 'halo') {
		const workers = Array.isArray(r.selected_workers) ? r.selected_workers.length : 0;
		const counts = r.runtime_graph_node_counts && typeof r.runtime_graph_node_counts === 'object'
			? Object.values(r.runtime_graph_node_counts as Record<string, number>).reduce((a, b) => a + (b || 0), 0) : undefined;
		const nodes = r.merged_runtime_node_count ?? counts;
		const optMs = typeof r.optimization_seconds === 'number' ? Math.round(r.optimization_seconds * 1000) : undefined;
		rows.push(<Row key="s"><span className="text-[12.5px]">Optimized · {workers} worker{workers === 1 ? '' : 's'}{nodes != null ? ` · ${nodes} node${nodes === 1 ? '' : 's'}` : ''}{optMs != null ? ` · ${optMs} ms` : ''}</span></Row>);
	} else {
		const st = String(r.status || '').toLowerCase() || 'submitted';
		rows.push(<Row key="s"><span className="text-[12.5px]">Run {st}{r.workflow_id ? ` · ${String(r.workflow_id).slice(0, 14)}…` : ''}</span></Row>);
	}
	rows.push(
		<Row key="o">
			<button
				onClick={() => window.dispatchEvent(new CustomEvent('studio:workflow-panel-toggle'))}
				className="inline-flex items-center gap-1 text-[12px] text-gold-700 hover:underline"
			>
				<WorkflowIcon className="w-3 h-3" /> Open full graph
			</button>
		</Row>,
	);
	return <Card title={kind === 'halo' ? 'Workflow · HALO plan' : 'Workflow run'} rows={rows} />;
}

// Map a FlowMesh/Lumilake worker or job status to a tone (statusTone only knows
// the loops-health vocabulary; these are FM/LL states: IDLE/BUSY, pending/
// running/completed/failed/cancelled, PENDING/DISPATCHED/DONE…).
function jobTone(s: any): ToneKey {
	const v = String(s || '').toLowerCase();
	if (['idle', 'completed', 'done', 'ok', 'succeeded'].includes(v)) return 'ok';
	if (['busy', 'running', 'dispatched', 'pending', 'processing'].includes(v)) return 'running';
	if (['failed', 'error'].includes(v)) return 'failing';
	if (['cancelled', 'canceled', 'stale', 'stopping', 'stopped', 'not_ready'].includes(v)) return 'attention';
	return 'idle';
}

// Thin inline progress bar (0–100). Accepts a fraction (≤1) or a percent.
function ProgressBar({ value }: { value: number }) {
	const p = Math.max(0, Math.min(100, value <= 1 && value > 0 ? value * 100 : value));
	return (
		<span className="inline-block w-24 h-1.5 rounded-full bg-muted overflow-hidden align-middle">
			<span className="block h-full bg-gold-600 rounded-full" style={{ width: `${p}%` }} />
		</span>
	);
}

function fmtEta(sec: any): string {
	const s = typeof sec === 'number' ? sec : parseFloat(String(sec));
	if (!Number.isFinite(s) || s <= 0) return '';
	if (s < 60) return `~${Math.round(s)}s left`;
	if (s < 3600) return `~${Math.round(s / 60)}m left`;
	return `~${Math.round(s / 3600)}h left`;
}

// Lumilake job status/progress → live-ish card (status dot, % bar, ETA, batches).
// Shared by lumilake_job_status and run_lumilake_job (which carries a terminal
// status). Rendered inline so a job is watched inside the conversation.
function lumilakeJobCard(r: Record<string, any>): React.ReactNode {
	if (r?.error) {
		return <Card title="Lumilake job" rows={[<Row key="e"><span className="text-rose-600 text-[12px]">{String(r.error).slice(0, 160)}</span></Row>]} />;
	}
	const status = String(r.status || '').toLowerCase();
	const jid = r.job_id ? String(r.job_id) : '';
	const p = typeof r.percentage === 'number' ? r.percentage : undefined;
	const rows: React.ReactNode[] = [
		<Row key="s">
			<Dot tone={jobTone(status)} />
			<span className="text-[12.5px] capitalize">{status || 'submitted'}</span>
			{p != null ? <ProgressBar value={p} /> : null}
			{p != null ? <span className="text-[11.5px] text-muted-foreground">{Math.round(p <= 1 ? p * 100 : p)}%</span> : null}
			<span className="ml-auto text-[11px] text-muted-foreground">{fmtEta(r.eta_seconds)}</span>
		</Row>,
	];
	const b = r.batches as Record<string, any> | undefined;
	if (b && (b.total != null)) {
		rows.push(<Row key="b"><span className="text-[11.5px] text-muted-foreground">batches: {b.completed ?? 0}/{b.total} done{b.running ? ` · ${b.running} running` : ''}{b.failed ? ` · ${b.failed} failed` : ''}</span></Row>);
	}
	// Terminal run_lumilake_job carries outputs — summarize inline.
	if (r.outputs != null) {
		const txt = typeof r.outputs === 'string' ? r.outputs : JSON.stringify(r.outputs);
		rows.push(<Row key="o"><span className="text-[12px] text-foreground/80 line-clamp-2 break-words">{txt.slice(0, 200)}</span></Row>);
	}
	if (jid) rows.push(<Row key="id"><span className="font-mono text-[10.5px] text-muted-foreground">{jid.slice(0, 22)}</span></Row>);
	return <Card title="Lumilake job" rows={rows} />;
}

// Lumilake job result → outputs card (grouped text).
function lumilakeResultCard(r: Record<string, any>): React.ReactNode {
	if (r?.error) return <Card title="Lumilake result" rows={[<Row key="e"><span className="text-rose-600 text-[12px]">{String(r.error).slice(0, 160)}</span></Row>]} />;
	if (r.status === 'not_ready') return <Card title="Lumilake result" rows={[<Row key="n"><span className="text-[12px] text-muted-foreground">Not ready — job still running</span></Row>]} />;
	const out = r.outputs;
	const txt = out == null ? '(no output)' : (typeof out === 'string' ? out : JSON.stringify(out, null, 0));
	return <Card title="Lumilake result" rows={[<Row key="o"><span className="text-[12px] text-foreground/85 whitespace-pre-wrap break-words line-clamp-6">{txt.slice(0, 500)}</span></Row>]} />;
}

// Lumilake job trace → critical-path / provenance card (best-effort).
function jobTraceCard(r: Record<string, any>): React.ReactNode {
	if (r?.error) return <Card title="Job trace" rows={[<Row key="e"><span className="text-rose-600 text-[12px]">{String(r.error).slice(0, 160)}</span></Row>]} />;
	const rows: React.ReactNode[] = [];
	if (r.note) rows.push(<Row key="n"><span className="text-[12px] text-muted-foreground">{String(r.note)}</span></Row>);
	const tr = r.trace as Record<string, any> | undefined;
	if (tr && typeof tr === 'object') {
		const cp = tr.critical_path || tr.criticalPath;
		const e2e = tr.e2e_seconds ?? tr.total_seconds ?? tr.e2e;
		if (e2e != null) rows.push(<Row key="e2e"><span className="text-[12.5px]">E2E {typeof e2e === 'number' ? `${e2e.toFixed(1)}s` : String(e2e)}</span></Row>);
		if (Array.isArray(cp) && cp.length) {
			rows.push(<Row key="cp"><span className="text-[11.5px] text-muted-foreground truncate">critical path: {cp.map((n: any) => (typeof n === 'string' ? n : (n?.node || n?.name || ''))).filter(Boolean).slice(0, 6).join(' → ')}</span></Row>);
		}
	}
	if (r.trace_id) rows.push(<Row key="tid"><span className="font-mono text-[10.5px] text-muted-foreground">{String(r.trace_id).slice(0, 22)}</span></Row>);
	if (rows.length === 0) rows.push(<Row key="empty"><span className="text-[12px] text-muted-foreground">No trace recorded yet</span></Row>);
	return <Card title="Job trace" rows={rows} />;
}

// FlowMesh workflow log tail → compact log lines card.
function workflowLogsCard(r: Record<string, any>): React.ReactNode {
	if (r?.error) return <Card title="Workflow logs" rows={[<Row key="e"><span className="text-rose-600 text-[12px]">{String(r.error).slice(0, 160)}</span></Row>]} />;
	const lines: any[] = Array.isArray(r.lines) ? r.lines : [];
	if (lines.length === 0) return <Card title="Workflow logs" rows={[<Row key="n"><span className="text-[12px] text-muted-foreground">No log lines yet</span></Row>]} />;
	const shown = lines.slice(-8);
	const tone = (lvl: string) => lvl === 'ERROR' ? 'text-rose-600' : lvl === 'WARNING' ? 'text-amber-600' : 'text-foreground/75';
	const rows = shown.map((l, i) => (
		<Row key={`l${i}`}>
			<span className={`font-mono text-[11px] truncate ${tone(String(l.level || '').toUpperCase())}`}>
				<span className="text-muted-foreground/70">{String(l.level || '').slice(0, 4)}</span> {String(l.message ?? '').slice(0, 160)}
			</span>
		</Row>
	));
	return <Card title="Workflow logs" rows={rows} more={lines.length - shown.length} />;
}

// Cancel confirmation (FM workflow or LL job).
function cancelCard(kind: 'workflow' | 'job', r: Record<string, any>): React.ReactNode {
	if (r?.error) return <Card title="Cancel" rows={[<Row key="e"><span className="text-rose-600 text-[12px]">{String(r.error).slice(0, 160)}</span></Row>]} />;
	const id = String(r.workflow_id || r.job_id || '');
	const st = String(r.status || 'cancelled');
	return <Card title={kind === 'job' ? 'Job cancelled' : 'Workflow cancelled'} rows={[
		<Row key="s"><Dot tone={jobTone(st)} /><span className="text-[12.5px] capitalize">{st}</span><span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{id.slice(0, 18)}</span></Row>,
	]} />;
}

// FlowMesh worker roster (list_workers → {workers:[{alias,status,node_alias,
// cluster,...}]}) as a compact health card — status dot + node/cluster + state,
// instead of the raw-JSON MCP chip.
function workersCard(r: Record<string, any>): React.ReactNode {
	const workers: any[] = Array.isArray(r?.workers) ? r.workers : [];
	if (workers.length === 0) {
		const msg = r?.error ? String(r.error).slice(0, 140) : 'No workers registered';
		return <Card title="FlowMesh workers" rows={[<Row key="e"><span className={`text-[12px] ${r?.error ? 'text-rose-600' : 'text-muted-foreground'}`}>{msg}</span></Row>]} />;
	}
	const norm = (s: any) => String(s || '').toLowerCase();
	const idle = workers.filter((w) => norm(w.status) === 'idle').length;
	const busy = workers.filter((w) => ['busy', 'running'].includes(norm(w.status))).length;
	const rows: React.ReactNode[] = [
		<Row key="sum">
			<span className="text-[12.5px]">{workers.length} worker{workers.length === 1 ? '' : 's'}{idle ? ` · ${idle} idle` : ''}{busy ? ` · ${busy} busy` : ''}</span>
		</Row>,
	];
	const shown = workers.slice(0, 6);
	shown.forEach((w, i) => {
		const node = w.node_alias ? String(w.node_alias) : '';
		const cluster = w.cluster ? String(w.cluster) : '';
		rows.push(
			<Row key={`w${i}`}>
				<Dot tone={jobTone(w.status)} />
				<span className="font-mono text-[12px] truncate">{String(w.alias || w.id || `worker ${i}`)}</span>
				{node ? <span className="text-[11.5px] text-muted-foreground truncate">{node}{cluster ? ` · ${cluster}` : ''}</span> : null}
				<span className="ml-auto text-[11px] text-muted-foreground shrink-0">{String(w.status || '').toUpperCase()}</span>
			</Row>,
		);
	});
	return <Card title="FlowMesh workers" rows={rows} more={workers.length - shown.length} />;
}

const RENDERERS: Record<string, Renderer> = {
	optimize_workflow: (r) => workflowResultCard('halo', r),
	run_workflow: (r) => workflowResultCard('run', r),
	list_workers: (r) => workersCard(r),
	// FM/LL job lifecycle — each tool call renders an inline card in the chat.
	run_lumilake_job: (r) => lumilakeJobCard(r),
	lumilake_job_status: (r) => lumilakeJobCard(r),
	lumilake_job_result: (r) => lumilakeResultCard(r),
	lumilake_job_trace: (r) => jobTraceCard(r),
	cancel_lumilake_job: (r) => cancelCard('job', r),
	cancel_workflow: (r) => cancelCard('workflow', r),
	workflow_logs: (r) => workflowLogsCard(r),
	list_apps: (r) => {
		const apps: Array<{ name: string; tenant?: boolean }> = Array.isArray(r.apps) ? r.apps : [];
		if (apps.length === 0) return null;
		const shown = apps.slice(0, MAX_ROWS);
		return (
			<Card
				title="Agents"
				more={apps.length - shown.length}
				rows={shown.map((a) => (
					<Row key={a.name} to={appLink(a.name)}>
						<span className="flex-1 min-w-0 truncate font-medium">{appTitle(a.name)}</span>
						<span className="text-[10.5px] text-muted-foreground shrink-0">{a.tenant ? 'yours' : 'shared'}</span>
					</Row>
				))}
			/>
		);
	},

	loops_health: (r) => {
		const loops: Array<{ app: string; loop: string; status: string; consecutive_failures?: number; last_run_ts?: number; last_error?: string }> =
			Array.isArray(r.loops) ? r.loops : [];
		if (loops.length === 0) return null;
		const shown = loops.slice(0, MAX_ROWS);
		return (
			<Card
				title="Workflow health"
				more={loops.length - shown.length}
				rows={shown.map((L) => {
					const tone = statusTone(L.status);
					return (
						<Row key={`${L.app}:${L.loop}`} to={appLink(L.app, L.loop)}>
							<Dot tone={tone} />
							<span className="flex-1 min-w-0 truncate">
								<span className="font-medium">{appTitle(L.app)}</span>
								<span className="text-muted-foreground"> · {loopLabel(undefined, L.loop)}</span>
							</span>
							<span className={`text-[10.5px] shrink-0 ${L.status === 'failing' ? 'text-rose-700 font-medium' : 'text-muted-foreground'}`}>
								{L.status === 'failing' && L.consecutive_failures
									? `${L.consecutive_failures}× failing`
									: L.status}{L.last_run_ts ? ` · ${rel(L.last_run_ts)}` : ''}
							</span>
						</Row>
					);
				})}
			/>
		);
	},

	list_workflows: (r) => {
		const wfs: Array<{ slug: string; kind?: string; name?: string; app?: string; trigger?: string; enabled?: boolean; running?: boolean; last_run_ok?: boolean | null; last_run_ts?: number }> =
			Array.isArray(r.workflows) ? r.workflows : [];
		if (wfs.length === 0) return null;
		const shown = wfs.slice(0, MAX_ROWS);
		return (
			<Card
				title="Workflows"
				more={wfs.length - shown.length}
				rows={shown.map((w) => {
					const loop = w.app && w.slug.startsWith(w.app + ':') ? w.slug.slice(w.app.length + 1) : undefined;
					const tone: ToneKey = w.running ? 'running'
						: w.last_run_ok === false ? 'failing'
						: w.last_run_ok === true ? 'ok'
						: 'idle';
					return (
						<Row key={w.slug} to={w.app ? appLink(w.app, loop) : undefined}>
							<Dot tone={tone} />
							<span className="flex-1 min-w-0 truncate">
								<span className="font-medium">{loopLabel(w.name, loop || w.slug)}</span>
								{w.app && <span className="text-muted-foreground"> · {appTitle(w.app)}</span>}
							</span>
							<span className="text-[10.5px] text-muted-foreground shrink-0">
								{w.trigger || ''}{w.last_run_ts ? ` · ${rel(w.last_run_ts)}` : ''}
							</span>
						</Row>
					);
				})}
			/>
		);
	},

	list_runs: (r) => {
		const runs: Array<{ run_id: string; workflow_slug?: string; name?: string; app?: string; state?: string; started_iso?: string; duration_s?: number; reason?: string }> =
			Array.isArray(r.runs) ? r.runs : [];
		if (runs.length === 0) return null;
		const shown = runs.slice(0, MAX_ROWS);
		return (
			<Card
				title="Recent runs"
				more={runs.length - shown.length}
				rows={shown.map((run) => {
					const tone: ToneKey = run.state === 'failed' ? 'failing'
						: run.state === 'running' ? 'running'
						: run.state === 'succeeded' ? 'ok'
						: 'idle';
					const loop = run.app && run.workflow_slug?.startsWith(run.app + ':')
						? run.workflow_slug.slice(run.app.length + 1)
						: undefined;
					return (
						<Row key={run.run_id} to={run.app ? appLink(run.app, loop) : undefined}>
							<Dot tone={tone} />
							<span className="flex-1 min-w-0 truncate">
								<span className="font-medium">{loopLabel(run.name, loop || run.workflow_slug || run.run_id)}</span>
								{run.app && <span className="text-muted-foreground"> · {appTitle(run.app)}</span>}
							</span>
							<span className={`text-[10.5px] shrink-0 ${run.state === 'failed' ? 'text-rose-700 font-medium' : 'text-muted-foreground'}`}>
								{run.state}{run.started_iso ? ` · ${relIso(run.started_iso)}` : ''}
							</span>
						</Row>
					);
				})}
			/>
		);
	},

	cycle_detail: (r) => {
		const app = String(r.app || '');
		const loop = String(r.loop || '');
		const ts = String(r.ts || '');
		if (!app || !loop) return null;
		const steps: Array<{ step_id?: string; ok?: boolean }> = Array.isArray(r.steps) ? r.steps : [];
		const failed = steps.filter((s) => s.ok === false).length;
		const tone: ToneKey = failed > 0 ? 'failing' : 'ok';
		return (
			<Card
				title="Run"
				rows={[
					<Row key="run" to={appLink(app, loop, ts)}>
						<Dot tone={tone} />
						<span className="flex-1 min-w-0 truncate">
							<span className="font-medium">{appTitle(app)}</span>
							<span className="text-muted-foreground"> · {loopLabel(undefined, loop)}</span>
						</span>
						<span className={`text-[10.5px] shrink-0 ${failed > 0 ? 'text-rose-700 font-medium' : 'text-muted-foreground'}`}>
							{steps.length} step{steps.length === 1 ? '' : 's'}{failed > 0 ? ` · ${failed} failed` : ''}{ts ? ` · ${ts}` : ''}
						</span>
					</Row>,
				]}
			/>
		);
	},
};

// actionOutcomeCard — a compact "done" card for app_action / qa_call results,
// with a deep link to the affected app/rental when we can derive one.
function actionOutcomeCard(label: string, r: Record<string, any>): React.ReactNode {
	const app = String(r.app || r.installed_as || r.for_app || '');
	const taskID = String(r.task_id || '');
	const to = taskID
		? `/studio/a/lumid-gpu-rentals/${encodeURIComponent(taskID)}`
		: app ? `/studio/a/${encodeURIComponent(app)}?full=1` : undefined;
	return (
		<div className="max-w-md rounded-xl border border-border bg-card shadow-sm overflow-hidden text-left">
			<div className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
				<CheckCircle2 className="w-3.5 h-3.5 text-gold-600 shrink-0" />
				<span className="flex-1 min-w-0 truncate text-foreground">Done · <span className="font-medium">{label}</span></span>
				{to && (
					<Link to={to} onClick={(e) => e.stopPropagation()} className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground">
						open <ArrowUpRight className="w-3 h-3" />
					</Link>
				)}
			</div>
		</div>
	);
}

// appReadCard — render the common app_read data shapes (rentals, pricing fleet)
// as compact rows; else a quiet one-liner (the agent narrates detail in text).
function appReadCard(r: Record<string, any>): React.ReactNode {
	const src = String(r.source || '');
	const data = (r.data || {}) as Record<string, any>;
	const rentals: any[] = Array.isArray(data.rentals) ? data.rentals : [];
	if (rentals.length) {
		const shown = rentals.slice(0, MAX_ROWS);
		return (
			<Card title="GPU rentals" more={rentals.length - shown.length}
				rows={shown.map((rt) => {
					const st = String(rt.status || '');
					const tone: ToneKey = st === 'error' ? 'failing' : (st === 'running' || st === 'dispatched') ? 'running' : (st === 'done' || st === 'cancelled') ? 'idle' : 'ok';
					return (
						<Row key={String(rt.task_id || rt.id)} to={rt.task_id ? `/studio/a/lumid-gpu-rentals/${encodeURIComponent(String(rt.task_id))}` : undefined}>
							<Dot tone={tone} />
							<span className="flex-1 min-w-0 truncate font-medium">{String(rt.name || rt.task_id)}</span>
							<span className="text-[10.5px] text-muted-foreground shrink-0">{rt.gpu ? `${rt.gpu}×GPU · ` : ''}{st}</span>
						</Row>
					);
				})} />
		);
	}
	const fleet: any[] = Array.isArray(data.fleet) ? data.fleet : [];
	if (fleet.length) {
		const shown = fleet.slice(0, MAX_ROWS);
		return (
			<Card title="GPU pricing" more={fleet.length - shown.length}
				rows={shown.map((f, i) => (
					<Row key={i}>
						<span className="flex-1 min-w-0 truncate">{String(f.substr || f.gpu || f.name || '')}</span>
						<span className="text-[10.5px] text-muted-foreground shrink-0">{f.sell != null ? `$${f.sell}/hr` : ''}</span>
					</Row>
				))} />
		);
	}
	const count = typeof data.count === 'number' ? data.count : undefined;
	return <Card title={src} rows={[<Row key="s"><span className="text-muted-foreground text-[12px]">{count != null ? `${count} item${count === 1 ? '' : 's'}` : 'loaded'}</span></Row>]} />;
}

/** Inline entity card for a completed, successful tool call — or null. */
export function entityCardFor(t: ToolCall): React.ReactNode | null {
	if (t.pending || !t.ok || !t.result) return null;
	// MCP tools (mcp__lumid__*) deliver results as content blocks; native tools
	// return the object directly. Normalize so both render the same.
	const r = unwrapToolResult(t.result) as Record<string, any>;
	// Generic app-ops tools (operate any app from chat).
	if (t.name === 'show_app_surface' && r.app) {
		return <AppSurfaceCard app={String(r.app)} surface={r.surface ? String(r.surface) : undefined} />;
	}
	if (t.name === 'app_read') return appReadCard(r);
	if (t.name === 'app_action') return actionOutcomeCard(String(r.action || 'action'), r);
	if (t.name === 'qa_call') return actionOutcomeCard(`${r.method || 'POST'} ${r.path || ''}`.trim(), r);
	const render = RENDERERS[baseToolName(t.name)];
	if (!render) return null;
	try {
		return render(r);
	} catch {
		return null;
	}
}
