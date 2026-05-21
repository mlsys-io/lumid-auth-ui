import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ExternalLink, X, TrendingUp, TrendingDown, FileText, Activity } from 'lucide-react';
import axios from 'axios';

// Per-cycle outcome — mirrors lumid_identity/internal/handler/admin_loops.go::loopOutcome.
// We render the latest cycle per loop (newest first) with rich trading
// metrics for trading loops + downstream-job chips for loops that use
// the submit_jobs path.

interface LoopProposal {
	strategy?: string;
	symbol?: string;
	direction?: string;
	size_pct_nav?: number;
	confidence?: number;
}

interface CycleJobRef {
	job_id: string;
	source: string;
	kind?: string;
	state: string;
}

interface LoopOutcome {
	alpha_pp?: number;
	benchmark?: string;
	sharpe?: number;
	max_dd?: number;
	insight_head?: string;
	last_proposal?: LoopProposal;
	trades_count?: number;
	pnl?: number;
	win_rate?: number;
	max_single_trade_loss?: number;
	downstream_jobs?: CycleJobRef[];
}

interface CycleRow {
	app: string;
	loop: string;
	ts: number;
	ts_str: string;
	status: 'ok' | 'error' | 'unknown';
	outcome?: LoopOutcome;
}

const identityApi = axios.create({ baseURL: '/', timeout: 15_000, withCredentials: true });

const STATE_BADGE: Record<string, string> = {
	queued:     'bg-slate-100 text-slate-700',
	scheduled:  'bg-blue-100 text-blue-700',
	running:    'bg-indigo-100 text-indigo-700',
	succeeded:  'bg-emerald-100 text-emerald-700',
	failed:     'bg-rose-100 text-rose-700',
	cancelled:  'bg-amber-100 text-amber-700',
};

export default function ResultsPage() {
	const [rows, setRows] = useState<CycleRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [err, setErr] = useState('');
	const [open, setOpen] = useState<CycleRow | null>(null);

	useEffect(() => {
		setLoading(true);
		identityApi.get('/api/v1/admin/loops')
			.then((r) => {
				const all: CycleRow[] = [];
				for (const app of (r.data?.apps || [])) {
					for (const lp of (app.loops || [])) {
						const ts = lp.latest_cycle_ts || lp.last_run_ts || 0;
						all.push({
							app: app.name,
							loop: lp.loop,
							ts,
							ts_str: lp.latest_cycle_ts || '',
							status: lp.last_ok == null ? 'unknown' : lp.last_ok ? 'ok' : 'error',
							outcome: lp.outcome,
						});
					}
				}
				all.sort((a, b) => b.ts - a.ts);
				setRows(all);
			})
			.catch((e) => setErr(e?.response?.data?.detail || e?.response?.data?.error || 'Failed to load results'))
			.finally(() => setLoading(false));
	}, []);

	return (
		<div className="max-w-5xl">
			<header className="mb-6">
				<h1 className="text-2xl font-semibold text-slate-900">My Results</h1>
				<p className="mt-1 text-sm text-slate-600">
					Latest cycle outcome per research loop.{' '}
					<a href="https://xp.io" target="_blank" rel="noopener noreferrer"
						className="text-indigo-600 hover:underline inline-flex items-center gap-1">
						Share findings on xp.io <ExternalLink className="w-3 h-3" />
					</a>
				</p>
			</header>

			{loading ? (
				<div className="text-sm text-slate-500 py-10 text-center">Loading results…</div>
			) : err ? (
				<div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm px-4 py-3">
					{err}
				</div>
			) : rows.length === 0 ? (
				<div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
					<BarChart3 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
					<div className="text-sm text-slate-500">No cycle results yet.</div>
					<div className="mt-2 text-xs text-slate-400">
						Results appear here after a research loop completes a cycle.
					</div>
				</div>
			) : (
				<div className="space-y-2">
					{rows.map((c, i) => (
						<CycleCard key={`${c.app}/${c.loop}/${c.ts}/${i}`} row={c} onOpen={() => setOpen(c)} />
					))}
				</div>
			)}

			{open && <CycleDrawer row={open} onClose={() => setOpen(null)} />}
		</div>
	);
}

function CycleCard({ row, onOpen }: { row: CycleRow; onOpen: () => void }) {
	const o = row.outcome;
	const hasTrading = o && (o.trades_count != null || o.pnl != null);
	const hasInsight = o && (o.insight_head || o.alpha_pp != null || o.sharpe != null);

	return (
		<div
			onClick={onOpen}
			className={
				`rounded-lg border bg-white px-4 py-3 cursor-pointer hover:bg-indigo-50/40 transition-colors ` +
				(row.status === 'error' ? 'border-rose-200' : 'border-slate-200')
			}
		>
			<div className="flex items-center gap-3">
				<div className={
					'w-2 h-2 rounded-full shrink-0 ' +
					(row.status === 'error' ? 'bg-rose-400' : row.status === 'ok' ? 'bg-emerald-400' : 'bg-slate-300')
				} />
				<div className="flex-1 min-w-0">
					<div className="text-sm font-medium text-slate-900 truncate">
						{row.app} <span className="text-slate-400">/</span> {row.loop}
					</div>
					{o?.insight_head && (
						<div className="mt-0.5 text-xs text-slate-500 line-clamp-2">
							{o.insight_head.split('\n')[0]}
						</div>
					)}
				</div>
				<div className="shrink-0 text-xs text-slate-400 whitespace-nowrap">
					{row.ts > 0 ? new Date(row.ts * 1000).toLocaleString() : '—'}
				</div>
			</div>

			{(hasTrading || hasInsight || (o?.downstream_jobs && o.downstream_jobs.length > 0)) && (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{hasTrading && (
						<>
							{o!.pnl != null && (
								<MetricChip
									icon={o!.pnl >= 0 ? TrendingUp : TrendingDown}
									tone={o!.pnl >= 0 ? 'emerald' : 'rose'}
									label="P&amp;L"
									value={fmtPnL(o!.pnl)}
								/>
							)}
							{o!.trades_count != null && (
								<MetricChip label="Trades" value={String(o!.trades_count)} tone="slate" />
							)}
							{o!.win_rate != null && (
								<MetricChip label="Win rate" value={`${(o!.win_rate * 100).toFixed(0)}%`} tone="indigo" />
							)}
						</>
					)}
					{o?.alpha_pp != null && (
						<MetricChip label="α" value={`${o.alpha_pp.toFixed(2)}pp`} tone="indigo" />
					)}
					{o?.sharpe != null && (
						<MetricChip label="Sharpe" value={o.sharpe.toFixed(2)} tone="slate" />
					)}
					{o?.max_dd != null && (
						<MetricChip label="Max DD" value={`${o.max_dd.toFixed(2)}%`} tone="rose" />
					)}
					{o?.downstream_jobs && o.downstream_jobs.length > 0 && (
						<Link
							to={`/dashboard/jobs?submitter_loop=${encodeURIComponent(row.loop)}`}
							onClick={(e) => e.stopPropagation()}
							className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
						>
							<Activity className="w-3 h-3" />
							{o.downstream_jobs.length} job{o.downstream_jobs.length === 1 ? '' : 's'}
						</Link>
					)}
				</div>
			)}
		</div>
	);
}

function MetricChip({
	label, value, tone, icon: Icon,
}: {
	label: string;
	value: string;
	tone: 'indigo' | 'slate' | 'emerald' | 'rose';
	icon?: React.ComponentType<{ className?: string }>;
}) {
	const toneMap: Record<string, string> = {
		indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
		slate: 'border-slate-200 bg-slate-50 text-slate-700',
		emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
		rose: 'border-rose-200 bg-rose-50 text-rose-700',
	};
	return (
		<div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border ${toneMap[tone]}`}>
			{Icon && <Icon className="w-3 h-3" />}
			<span className="font-medium">{label}</span>
			<span className="font-mono">{value}</span>
		</div>
	);
}

function fmtPnL(n: number): string {
	const sign = n >= 0 ? '+' : '';
	if (Math.abs(n) >= 1000) return `${sign}${n.toFixed(0)}`;
	return `${sign}${n.toFixed(2)}`;
}

// Drill-down drawer — fetches insight.md / trades.json / signals.csv on
// demand via the new /admin/cycle-artifact endpoint. Read-only.
function CycleDrawer({ row, onClose }: { row: CycleRow; onClose: () => void }) {
	return (
		<div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
			<div
				onClick={(e) => e.stopPropagation()}
				className="w-full max-w-3xl rounded-lg bg-white shadow-2xl border border-slate-200 max-h-[88vh] overflow-y-auto"
			>
				<header className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
					<div>
						<h2 className="font-semibold text-slate-900">
							{row.app} <span className="text-slate-400">/</span> {row.loop}
						</h2>
						<p className="text-xs text-slate-500 mt-0.5">
							{row.ts > 0 ? new Date(row.ts * 1000).toLocaleString() : '—'}
						</p>
					</div>
					<button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
				</header>

				<div className="px-5 py-4 space-y-5 text-sm">
					{row.outcome?.last_proposal && (
						<ProposalSection p={row.outcome.last_proposal} />
					)}

					<ArtifactSection
						title="Insight"
						app={row.app}
						loop={row.loop}
						name="insight.md"
						icon={FileText}
					/>

					<ArtifactSection
						title="Trades"
						app={row.app}
						loop={row.loop}
						name="trades.json"
						icon={TrendingUp}
					/>

					<ArtifactSection
						title="Signals (first 50 rows)"
						app={row.app}
						loop={row.loop}
						name="signals.csv"
						icon={Activity}
						previewRows={50}
					/>

					{row.outcome?.downstream_jobs && row.outcome.downstream_jobs.length > 0 && (
						<DownstreamJobsSection loop={row.loop} jobs={row.outcome.downstream_jobs} />
					)}
				</div>
			</div>
		</div>
	);
}

function ProposalSection({ p }: { p: LoopProposal }) {
	return (
		<div>
			<h3 className="text-xs uppercase text-slate-500 tracking-wide mb-2">Latest proposal</h3>
			<div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
				{p.symbol && <Field label="Symbol" value={p.symbol} />}
				{p.direction && <Field label="Direction" value={p.direction} />}
				{p.strategy && <Field label="Strategy" value={p.strategy} />}
				{p.size_pct_nav != null && <Field label="Size %NAV" value={`${(p.size_pct_nav * 100).toFixed(2)}%`} />}
				{p.confidence != null && <Field label="Confidence" value={p.confidence.toFixed(2)} />}
			</div>
		</div>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<div className="text-xs text-slate-500">{label}</div>
			<div className="text-sm font-mono text-slate-800 mt-0.5">{value}</div>
		</div>
	);
}

function ArtifactSection({
	title, app, loop, name, icon: Icon, previewRows,
}: {
	title: string;
	app: string;
	loop: string;
	name: string;
	icon: React.ComponentType<{ className?: string }>;
	previewRows?: number;
}) {
	const [content, setContent] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		setLoading(true);
		setMissing(false);
		identityApi
			.get(`/api/v1/admin/cycle-artifact`, { params: { app, loop, name }, responseType: 'text', transformResponse: (x) => x })
			.then((r) => setContent(typeof r.data === 'string' ? r.data : JSON.stringify(r.data)))
			.catch((e) => {
				if (e?.response?.status === 404) setMissing(true);
				else setContent(`(failed to load: ${e?.response?.data?.error || e?.message})`);
			})
			.finally(() => setLoading(false));
	}, [app, loop, name]);

	const display = useMemo(() => {
		if (content == null) return '';
		if (previewRows && content.includes('\n')) {
			const lines = content.split('\n');
			if (lines.length > previewRows) {
				return lines.slice(0, previewRows).join('\n') + `\n… (${lines.length - previewRows} more rows)`;
			}
		}
		return content;
	}, [content, previewRows]);

	if (missing) return null; // nothing to show — don't take up space

	return (
		<div>
			<h3 className="text-xs uppercase text-slate-500 tracking-wide mb-2 inline-flex items-center gap-1.5">
				<Icon className="w-3 h-3" /> {title}
			</h3>
			{loading ? (
				<div className="text-xs text-slate-400">Loading…</div>
			) : (
				<pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">
{display || '(empty)'}
				</pre>
			)}
		</div>
	);
}

function DownstreamJobsSection({ loop, jobs }: { loop: string; jobs: CycleJobRef[] }) {
	return (
		<div>
			<h3 className="text-xs uppercase text-slate-500 tracking-wide mb-2 inline-flex items-center gap-1.5">
				<Activity className="w-3 h-3" /> Downstream jobs
			</h3>
			<div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
				{jobs.map((j) => (
					<div key={j.job_id} className="px-4 py-2.5 flex items-center gap-3">
						<span className={
							'inline-block px-2 py-0.5 rounded text-xs font-medium ' +
							(STATE_BADGE[j.state] || 'bg-slate-100 text-slate-700')
						}>
							{j.state}
						</span>
						<div className="flex-1 min-w-0">
							<div className="font-mono text-xs text-slate-700 truncate">{j.job_id}</div>
							<div className="text-xs text-slate-500">{j.source}{j.kind ? ` · ${j.kind}` : ''}</div>
						</div>
					</div>
				))}
			</div>
			<Link
				to={`/dashboard/jobs?submitter_loop=${encodeURIComponent(loop)}`}
				className="mt-2 inline-block text-xs text-indigo-600 hover:underline"
			>
				View in jobs panel →
			</Link>
		</div>
	);
}
