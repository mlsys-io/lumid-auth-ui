import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw, X, ExternalLink, Filter } from 'lucide-react';

import { listJobs, JobRow, JobsSummary, JobSource, JobState } from '@/api/jobs';
import { useAutoRefresh, fmtAgo, useNowTick } from '@/hooks/useAutoRefresh';

// Unified Running Jobs panel. Reads the cross-source ledger via
// /api/v1/admin/jobs and renders any cron/flowmesh/lumilake/loop_cycle
// job with the same row shape. Read-only — deployment lives in claude
// (the MCP deploy_job flow), not here.

const SOURCE_CHIPS: Array<{ value: 'all' | JobSource; label: string }> = [
	{ value: 'all',       label: 'All' },
	{ value: 'cron',      label: 'Cron' },
	{ value: 'flowmesh',  label: 'FlowMesh' },
	{ value: 'lumilake',  label: 'Lumilake' },
	{ value: 'loop_cycle', label: 'Loop cycles' },
];

const STATE_BADGE: Record<JobState, string> = {
	queued:     'bg-slate-100 text-slate-700',
	scheduled:  'bg-blue-100 text-blue-700',
	running:    'bg-indigo-100 text-indigo-700',
	succeeded:  'bg-emerald-100 text-emerald-700',
	failed:     'bg-rose-100 text-rose-700',
	cancelled:  'bg-amber-100 text-amber-700',
};

function fmtDuration(start?: number, end?: number): string {
	if (!start) return '—';
	const end_ = end ?? Date.now() / 1000;
	const s = Math.max(0, Math.floor(end_ - start));
	if (s < 60)    return `${s}s`;
	if (s < 3600)  return `${Math.floor(s / 60)}m ${s % 60}s`;
	return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function fmtAbsAgo(unix?: number, nowTick = 0): string {
	void nowTick; // dep — re-render on tick
	if (!unix) return '—';
	const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
	if (s < 5)     return 'just now';
	if (s < 60)    return `${s}s ago`;
	if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

export default function Jobs() {
	const [params, setParams] = useSearchParams();
	const rawSource = (params.get('source') || 'all').toLowerCase();
	const source = (SOURCE_CHIPS.find((c) => c.value === rawSource)?.value ?? 'all') as 'all' | JobSource;
	const submitterApp = params.get('submitter_app') || '';
	const submitterLoop = params.get('submitter_loop') || '';

	const [jobs, setJobs] = useState<JobRow[]>([]);
	const [summary, setSummary] = useState<JobsSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [err, setErr] = useState('');
	const [openJob, setOpenJob] = useState<JobRow | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setErr('');
		try {
			const data = await listJobs({
				source: source === 'all' ? undefined : source,
				submitter_app: submitterApp || undefined,
				submitter_loop: submitterLoop || undefined,
			});
			setJobs(data.jobs);
			setSummary(data.summary);
		} catch (e) {
			const msg = (e as { response?: { data?: { detail?: string; error?: string } } })
				?.response?.data?.detail
				?? (e as { response?: { data?: { detail?: string; error?: string } } })?.response?.data?.error
				?? 'Failed to load jobs';
			setErr(msg);
		} finally {
			setLoading(false);
		}
	}, [source, submitterApp, submitterLoop]);

	useEffect(() => { void load(); }, [load]);

	const { loadedAt, refresh } = useAutoRefresh(load, { staleAfterMs: 30_000 });
	const tick = useNowTick(15_000);
	const liveAgo = fmtAgo(loadedAt);
	void tick; // dep — surface re-renders to refresh the "Nm ago" column

	const setSource = (next: 'all' | JobSource) => {
		const p = new URLSearchParams(params);
		if (next === 'all') p.delete('source');
		else p.set('source', next);
		setParams(p, { replace: true });
	};

	const clearAppFilter = () => {
		const p = new URLSearchParams(params);
		p.delete('submitter_app');
		p.delete('submitter_loop');
		setParams(p, { replace: true });
	};

	const stats = useMemo(() => summary ?? { running: 0, queued: 0, succeeded_24h: 0, failed_24h: 0, total_in_ledger: 0 }, [summary]);

	return (
		<div>
			<header className="flex items-start justify-between gap-4 mb-5 flex-wrap">
				<div>
					<h1 className="text-2xl font-semibold text-slate-900">Running jobs</h1>
					<p className="text-sm text-slate-500 mt-1">
						Unified view across cron, FlowMesh, Lumilake, and loop cycles.
						Deploy a new job by asking <code className="px-1.5 py-0.5 rounded bg-slate-100">claude</code>.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-slate-400">{liveAgo}</span>
					<button
						onClick={() => void refresh()}
						className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50"
					>
						<RefreshCw className="w-3.5 h-3.5" /> Refresh
					</button>
				</div>
			</header>

			{/* Stat strip — global counters across the unfiltered ledger. */}
			<div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
				<StatCell label="Running"        value={stats.running}        tone="indigo" />
				<StatCell label="Queued"         value={stats.queued}         tone="slate" />
				<StatCell label="Succeeded 24h"  value={stats.succeeded_24h}  tone="emerald" />
				<StatCell label="Failed 24h"     value={stats.failed_24h}     tone="rose" />
				<StatCell label="Total in ledger" value={stats.total_in_ledger} tone="slate" />
			</div>

			{/* Filter chips + active-app callout. */}
			<div className="flex items-center gap-2 mb-4 flex-wrap">
				{SOURCE_CHIPS.map((c) => (
					<button
						key={c.value}
						onClick={() => setSource(c.value)}
						className={
							'px-3 py-1.5 rounded-full text-sm border transition-colors ' +
							(source === c.value
								? 'border-indigo-500 bg-indigo-50 text-indigo-700'
								: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
						}
					>
						{c.label}
					</button>
				))}
				{(submitterApp || submitterLoop) && (
					<button
						onClick={clearAppFilter}
						className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
					>
						<Filter className="w-3.5 h-3.5" />
						{submitterApp}{submitterLoop ? ` · ${submitterLoop}` : ''}
						<X className="w-3.5 h-3.5" />
					</button>
				)}
			</div>

			{err && (
				<div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 mb-4 text-sm text-rose-700">
					{err}
				</div>
			)}

			{loading && jobs.length === 0 ? (
				<div className="text-sm text-slate-400 py-12 text-center">Loading…</div>
			) : jobs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
					<p className="text-sm text-slate-600">
						No jobs match this filter yet. Autoresearch loops record submissions to{' '}
						<code className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-xs">
							~/.lumilake/jobs.jsonl
						</code>
						{' '}as they fire.
					</p>
				</div>
			) : (
				<div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
					<table className="min-w-full text-sm">
						<thead className="bg-slate-50 text-xs uppercase text-slate-500">
							<tr>
								<th className="px-4 py-2 text-left font-medium">Job</th>
								<th className="px-3 py-2 text-left font-medium">Source</th>
								<th className="px-3 py-2 text-left font-medium">Submitter</th>
								<th className="px-3 py-2 text-left font-medium">State</th>
								<th className="px-3 py-2 text-right font-medium">Started</th>
								<th className="px-3 py-2 text-right font-medium">Duration</th>
							</tr>
						</thead>
						<tbody>
							{jobs.map((row) => (
								<tr
									key={row.job_id}
									onClick={() => setOpenJob(row)}
									className="border-t border-slate-100 hover:bg-indigo-50/40 cursor-pointer"
								>
									<td className="px-4 py-2.5">
										<div className="font-mono text-xs text-slate-700">{row.job_id}</div>
										<div className="text-xs text-slate-500 mt-0.5 truncate max-w-md">
											{row.spec_summary || '(no summary)'}
										</div>
									</td>
									<td className="px-3 py-2.5">
										<span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
											{row.source}
										</span>
										<div className="text-xs text-slate-400 mt-0.5">{row.kind}</div>
									</td>
									<td className="px-3 py-2.5">
										<Link
											to={`/dashboard/loops?app=${encodeURIComponent(row.submitter_app)}`}
											onClick={(e) => e.stopPropagation()}
											className="text-xs text-indigo-600 hover:underline"
										>
											{row.submitter_app || '—'}
										</Link>
										<div className="text-xs text-slate-400">{row.submitter_loop || '—'}</div>
									</td>
									<td className="px-3 py-2.5">
										<span className={
											'inline-block px-2 py-0.5 rounded text-xs font-medium ' +
											(STATE_BADGE[row.state] || 'bg-slate-100 text-slate-700')
										}>
											{row.state}
										</span>
										{row.error && (
											<div className="text-xs text-rose-600 mt-0.5 truncate max-w-xs" title={row.error}>
												{row.error.split('\n')[0]}
											</div>
										)}
									</td>
									<td className="px-3 py-2.5 text-right text-xs text-slate-500 whitespace-nowrap">
										{fmtAbsAgo(row.started_at, tick)}
									</td>
									<td className="px-3 py-2.5 text-right text-xs text-slate-500 whitespace-nowrap">
										{fmtDuration(row.started_at, row.finished_at)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{openJob && <JobDrawer job={openJob} onClose={() => setOpenJob(null)} />}
		</div>
	);
}

function StatCell({ label, value, tone }: { label: string; value: number; tone: 'indigo' | 'slate' | 'emerald' | 'rose' }) {
	const toneClass: Record<string, string> = {
		indigo:  'text-indigo-700',
		slate:   'text-slate-700',
		emerald: 'text-emerald-700',
		rose:    'text-rose-700',
	};
	return (
		<div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
			<div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
			<div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass[tone]}`}>{value}</div>
		</div>
	);
}

// Drill-down modal. The panel is observation-only so this shows
// metadata, spec, output URL, and any captured output/error — never a
// Run/Stop control.
function JobDrawer({ job, onClose }: { job: JobRow; onClose: () => void }) {
	return (
		<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
			<div
				onClick={(e) => e.stopPropagation()}
				className="w-full max-w-2xl rounded-lg bg-white shadow-2xl border border-slate-200 max-h-[85vh] overflow-y-auto"
			>
				<header className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
					<div>
						<h2 className="font-semibold text-slate-900 font-mono text-sm">{job.job_id}</h2>
						<p className="text-xs text-slate-500 mt-0.5">{job.spec_summary || '(no summary)'}</p>
					</div>
					<button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
				</header>

				<div className="px-5 py-4 space-y-4 text-sm">
					<DetailRow label="Source">
						<span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">{job.source}</span>
						<span className="ml-2 text-slate-500">{job.kind}</span>
					</DetailRow>
					<DetailRow label="State">
						<span className={
							'inline-block px-2 py-0.5 rounded text-xs font-medium ' +
							(STATE_BADGE[job.state] || 'bg-slate-100 text-slate-700')
						}>{job.state}</span>
					</DetailRow>
					<DetailRow label="Submitter">
						<Link
							to={`/dashboard/loops?app=${encodeURIComponent(job.submitter_app)}`}
							className="text-indigo-600 hover:underline"
						>
							{job.submitter_app || '—'}
						</Link>
						<span className="ml-1 text-slate-500">/ {job.submitter_loop || '—'}</span>
					</DetailRow>
					<DetailRow label="Started">{job.started_at ? new Date(job.started_at * 1000).toLocaleString() : '—'}</DetailRow>
					<DetailRow label="Finished">{job.finished_at ? new Date(job.finished_at * 1000).toLocaleString() : '—'}</DetailRow>
					{job.output_url && (
						<DetailRow label="Output URL">
							<a href={job.output_url} target="_blank" rel="noopener noreferrer"
								className="text-indigo-600 hover:underline inline-flex items-center gap-1 font-mono text-xs break-all">
								{job.output_url} <ExternalLink className="w-3 h-3 flex-shrink-0" />
							</a>
						</DetailRow>
					)}
					{job.error && (
						<div>
							<div className="text-xs uppercase text-slate-500 mb-1">Error</div>
							<pre className="text-xs bg-rose-50 border border-rose-100 rounded p-3 overflow-x-auto whitespace-pre-wrap text-rose-800">
{job.error}
							</pre>
						</div>
					)}
					{job.spec && Object.keys(job.spec).length > 0 && (
						<div>
							<div className="text-xs uppercase text-slate-500 mb-1">Spec</div>
							<pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-x-auto">
{JSON.stringify(job.spec, null, 2)}
							</pre>
						</div>
					)}
					{job.output != null && (
						<div>
							<div className="text-xs uppercase text-slate-500 mb-1">Output</div>
							<pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-x-auto">
{typeof job.output === 'string' ? job.output : JSON.stringify(job.output, null, 2)}
							</pre>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[120px_1fr] items-baseline gap-3">
			<div className="text-xs uppercase text-slate-500">{label}</div>
			<div className="text-sm text-slate-800">{children}</div>
		</div>
	);
}
