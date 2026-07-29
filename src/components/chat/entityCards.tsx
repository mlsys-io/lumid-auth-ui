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
import type { ToolCall } from './types';
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
		rows.push(<Row key="s"><span className="text-[12.5px]">Optimized · {workers} worker{workers === 1 ? '' : 's'}{nodes != null ? ` · ${nodes} node${nodes === 1 ? '' : 's'}` : ''}</span></Row>);
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
				<WorkflowIcon className="w-3 h-3" /> Open workflow
			</button>
		</Row>,
	);
	return <Card title={kind === 'halo' ? 'Workflow · HALO plan' : 'Workflow run'} rows={rows} />;
}

const RENDERERS: Record<string, Renderer> = {
	optimize_workflow: (r) => workflowResultCard('halo', r),
	run_workflow: (r) => workflowResultCard('run', r),
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
	const r = t.result as Record<string, any>;
	// Generic app-ops tools (operate any app from chat).
	if (t.name === 'show_app_surface' && r.app) {
		return <AppSurfaceCard app={String(r.app)} surface={r.surface ? String(r.surface) : undefined} />;
	}
	if (t.name === 'app_read') return appReadCard(r);
	if (t.name === 'app_action') return actionOutcomeCard(String(r.action || 'action'), r);
	if (t.name === 'qa_call') return actionOutcomeCard(`${r.method || 'POST'} ${r.path || ''}`.trim(), r);
	const render = RENDERERS[t.name];
	if (!render) return null;
	try {
		return render(r);
	} catch {
		return null;
	}
}
