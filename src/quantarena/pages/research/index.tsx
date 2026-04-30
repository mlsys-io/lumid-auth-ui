import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { getResearchByStrategy, type ResearchBundle, type ResearchJobInfo, type ResearchExecution } from '../../api/research';

/**
 * Research-results page — read-only view of what a user's bot has done.
 *
 * Per the Claude-Code-first pivot (plan W2c): users create and control
 * AI strategies from Claude Code via MCP tools; this page is the "watch"
 * surface. For each FlowMesh job linked to the strategy we show:
 *   - Scheduler status (active / paused / stopped)
 *   - Total cycles executed
 *   - Last run timestamp + any error
 *   - Last 20 cycles with per-cycle ok/error + a tail of the stdout body
 *
 * Handles three real cases:
 *   - A user-created FlowMesh job (has a tbl_flow_mesh_job row → job_id>0)
 *   - A Claude-Code bot registered via sdk.ops.start_bot (scheduler-only,
 *     job_id=0, shows up via the bot-<strategy_id> convention)
 *   - A strategy with no bot at all (empty jobs array → zero state)
 */
export default function ResearchPage() {
	const { strategyId } = useParams<{ strategyId: string }>();
	const [bundle, setBundle] = useState<ResearchBundle | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const id = Number(strategyId);
		if (!id) {
			setError('Invalid strategy id');
			setLoading(false);
			return;
		}
		let cancelled = false;
		const load = () => {
			getResearchByStrategy(id)
				.then((b) => {
					if (!cancelled) setBundle(b);
				})
				.catch((e) => {
					if (!cancelled) setError(String(e?.message ?? e));
				})
				.finally(() => {
					if (!cancelled) setLoading(false);
				});
		};
		load();
		// Poll every 20s so the cycle table picks up new executions
		// without requiring the user to refresh.
		const timer = setInterval(load, 20_000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [strategyId]);

	if (loading) {
		return <div className="p-6 text-sm text-gray-500">Loading research…</div>;
	}
	if (error) {
		return <div className="p-6 text-sm text-red-500">Error: {error}</div>;
	}
	if (!bundle) {
		return <div className="p-6 text-sm text-gray-500">Not found</div>;
	}

	return (
		<div className="max-w-5xl mx-auto p-6 space-y-4">
			<div>
				<Link to="/dashboard/quant/strategy" className="text-xs text-indigo-500 hover:underline">← back to strategies</Link>
				<h1 className="text-2xl font-bold text-gray-900 mt-2">{bundle.strategy_name}</h1>
				{bundle.description && <p className="text-sm text-gray-500 mt-1">{bundle.description}</p>}
				<div className="flex gap-3 mt-2 text-xs">
					<span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">status: {bundle.status}</span>
					{bundle.competition_name && (
						<Link
							to={`/competition/detail/${bundle.competition_id}`}
							className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
						>
							↗ {bundle.competition_name}
						</Link>
					)}
				</div>
			</div>

			{bundle.jobs.length === 0 ? (
				<div className="border border-gray-200 rounded-xl p-8 text-center bg-white/50">
					<p className="text-sm text-gray-500 mb-1">No bot jobs scheduled for this strategy yet.</p>
					<p className="text-xs text-gray-400">
						From Claude Code, run <code className="px-1 py-0.5 bg-gray-100 rounded">/lumid start_bot "momentum on DOGE"</code> to schedule one.
					</p>
				</div>
			) : (
				bundle.jobs.map((job) => <JobCard key={job.lumidos_job_id} job={job} />)
			)}
		</div>
	);
}

function JobCard({ job }: { job: ResearchJobInfo }) {
	const status = job.scheduler_status || job.status;
	const color =
		status === 'active'
			? 'bg-emerald-50 text-emerald-700 border-emerald-200'
			: status === 'paused'
				? 'bg-amber-50 text-amber-700 border-amber-200'
				: 'bg-gray-50 text-gray-600 border-gray-200';
	// Source chip — distinguishes bots running on lumid.market from
	// bots the user is running on their own machine. The "local" tag
	// means the state in the table came from a push via
	// PUT /api/v1/identity/reported-schedules, so "last run" is
	// whatever the local scheduler last reported.
	const source = job.source ?? 'hosted';
	const sourceColor =
		source === 'local'
			? 'bg-indigo-50 text-indigo-700 border-indigo-200'
			: 'bg-gray-50 text-gray-600 border-gray-200';
	const sourceLabel = source === 'local' ? 'on your machine' : 'hosted';
	return (
		<div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
			<div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
				<div className="min-w-0">
					<div className="font-semibold text-sm truncate">{job.name}</div>
					<div className="text-xs text-gray-500 mt-0.5">
						<code>{job.lumidos_job_id}</code> · cron <code>{job.cron || '—'}</code>
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${sourceColor}`}>{sourceLabel}</span>
					<span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${color}`}>{status}</span>
					<span className="text-xs text-gray-500 tabular-nums">{job.total_runs} run{job.total_runs === 1 ? '' : 's'}</span>
				</div>
			</div>

			<div className="px-4 py-2 text-xs text-gray-500">
				Last run:&nbsp;
				<span className="tabular-nums text-gray-700">{job.last_run_at || 'never'}</span>
			</div>

			{job.last_error && (
				<div className="mx-4 mb-3 p-2 border border-rose-200 bg-rose-50 rounded text-[11px] font-mono text-rose-700 whitespace-pre-wrap break-all">
					{job.last_error.slice(0, 400)}
					{job.last_error.length > 400 && '…'}
				</div>
			)}

			{job.executions && job.executions.length > 0 ? (
				<div className="border-t border-gray-100">
					<div className="px-4 py-2 text-xs font-medium text-gray-500">Recent cycles</div>
					<div className="divide-y divide-gray-50">
						{job.executions.slice().reverse().map((e, i) => (
							<ExecutionRow key={`${e.timestamp}-${i}`} e={e} />
						))}
					</div>
				</div>
			) : (
				<div className="border-t border-gray-100 px-4 py-3 text-xs text-gray-400">No executions yet</div>
			)}
		</div>
	);
}

function ExecutionRow({ e }: { e: ResearchExecution }) {
	const [open, setOpen] = useState(false);
	return (
		<button
			onClick={() => setOpen((v) => !v)}
			className="w-full text-left px-4 py-2 hover:bg-gray-50 cursor-pointer"
		>
			<div className="flex items-center gap-2 text-xs">
				<span className={`w-1.5 h-1.5 rounded-full ${e.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
				<span className="tabular-nums text-gray-600">{e.timestamp.replace('T', ' ').slice(0, 19)}</span>
				<span className={`text-[10px] px-1.5 py-0.5 rounded-full ${e.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
					{e.ok ? 'ok' : 'failed'}
				</span>
				{!open && e.body_tail && (
					<span className="text-gray-400 truncate flex-1">
						{e.body_tail.replace(/\s+/g, ' ').slice(0, 80)}
					</span>
				)}
			</div>
			{open && (
				<div className="mt-2 font-mono text-[11px] whitespace-pre-wrap break-all text-gray-700 bg-gray-50 rounded p-2">
					{e.error && <div className="text-rose-700 mb-2">{e.error}</div>}
					{e.body_tail || <span className="text-gray-400">(no body)</span>}
				</div>
			)}
		</button>
	);
}
