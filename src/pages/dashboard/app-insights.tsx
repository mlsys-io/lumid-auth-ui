// Per-app user insights — how one xpio app is actually being used, across
// every tenant.
//
// Generic over apps: the app is a route param and every panel reads the
// app-keyed rollup, so a second app is a URL, not a new page. Anything
// app-specific belongs in a plug-in block, not in a branch here.
//
// The design rule this page follows: a number that cannot be trusted must say
// so where it is rendered. Two panels on the existing dashboards get this
// wrong — /admin/auth-stats charts login events nothing writes, and
// me://loops/health returns {failing:0, stale:0, ok:0} because it reads a
// filesystem identity cannot see. Both render a confident zero that means
// "I know nothing". So: unknown outcomes get their own bucket, chat counts
// carry a floor badge, and an app with no recent runs is called inert rather
// than shown as quietly healthy.
//
// It also does not score anyone. Per /admin/cohort/submissions: telemetry
// cannot tell who converged from who merely ran loops, and a summariser
// between the traces and the reviewer becomes the thing being read.

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Info, Loader2, RefreshCcw } from 'lucide-react';
import { fetchAppInsights, type AppInsights, type InsightCount } from '@/api/app-insights';

const DAY_OPTIONS = [7, 30, 90];

function Stat({
	label,
	value,
	sub,
	tone,
}: {
	label: string;
	value: string | number;
	sub?: string;
	tone?: 'plain' | 'warn' | 'bad';
}) {
	const colour =
		tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900 dark:text-slate-100';
	return (
		<div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
			<div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
			<div className={`mt-1 text-2xl font-semibold ${colour}`}>{value}</div>
			{sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
		</div>
	);
}

/** Horizontal bars. Counts are printed as well as drawn — a bar is a shape, and
 *  the reject histogram is the one panel people will quote a number from. */
function BarList({ rows, empty }: { rows: InsightCount[]; empty: string }) {
	if (!rows || rows.length === 0) {
		return <div className="text-sm text-slate-500 py-3">{empty}</div>;
	}
	const max = Math.max(...rows.map((r) => r.count), 1);
	return (
		<div className="space-y-1.5">
			{rows.map((r) => (
				<div key={r.key} className="flex items-center gap-3">
					<div className="w-8 shrink-0 text-right text-sm tabular-nums font-medium">{r.count}</div>
					<div className="h-5 flex-1 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
						<div
							className="h-full rounded bg-[#96773A]/70"
							style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}
						/>
					</div>
					<div className="w-1/2 shrink-0 truncate font-mono text-xs text-slate-600 dark:text-slate-300" title={r.key}>
						{r.key}
					</div>
				</div>
			))}
		</div>
	);
}

function Panel({
	title,
	note,
	children,
}: {
	title: string;
	note?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-xl border border-slate-200 dark:border-slate-700 p-5">
			<h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</h2>
			{note ? <div className="mt-1 mb-3 text-xs text-slate-500">{note}</div> : <div className="mb-3" />}
			{children}
		</section>
	);
}

function humanAge(secs: number): string {
	if (!secs || secs <= 0) return '—';
	const d = Math.floor(secs / 86400);
	if (d >= 1) return `${d}d ${Math.floor((secs % 86400) / 3600)}h`;
	const h = Math.floor(secs / 3600);
	if (h >= 1) return `${h}h ${Math.floor((secs % 3600) / 60)}m`;
	return `${Math.floor(secs / 60)}m`;
}

export default function AppInsightsPage() {
	const { app = '' } = useParams();
	const [params, setParams] = useSearchParams();
	const days = Number(params.get('days') || 30);
	const [data, setData] = useState<AppInsights | null>(null);
	const [err, setErr] = useState('');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let live = true;
		setLoading(true);
		setErr('');
		fetchAppInsights(app, days)
			.then((d) => live && setData(d))
			.catch((e) => live && setErr(e?.response?.data?.message || e?.message || 'failed to load'))
			.finally(() => live && setLoading(false));
		return () => {
			live = false;
		};
	}, [app, days]);

	if (loading && !data) {
		return (
			<div className="flex items-center gap-2 p-8 text-slate-500">
				<Loader2 className="h-4 w-4 animate-spin" /> Loading insights for {app}…
			</div>
		);
	}
	if (err) {
		return (
			<div className="m-6 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
				<AlertTriangle className="mr-2 inline h-4 w-4" />
				{err}
			</div>
		);
	}
	if (!data) return null;

	const f = data.submissions;
	// "Inert" is a deliberate third state. Zero recent runs with a stale last
	// run is not the same as a healthy app that nobody used today, and the two
	// must not render identically.
	const STALE_AFTER = 48 * 3600;
	const inert = data.runs.total === 0 || data.runs.stale_seconds > STALE_AFTER;

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold">{data.app} — user insights</h1>
					<p className="text-xs text-slate-500">
						{data.aliases.length > 1 ? <>history also filed under {data.aliases.filter((a) => a !== data.app).join(', ')} · </> : null}
						generated {new Date(data.generated_at).toLocaleString()}
					</p>
				</div>
				<div className="flex items-center gap-1">
					{DAY_OPTIONS.map((d) => (
						<button
							key={d}
							onClick={() => setParams({ days: String(d) })}
							className={`rounded px-2.5 py-1 text-xs ${
								d === days
									? 'bg-[#96773A] text-white'
									: 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
							}`}
						>
							{d}d
						</button>
					))}
					<button
						onClick={() => setParams({ days: String(days) })}
						className="ml-1 rounded border border-slate-300 dark:border-slate-600 p-1.5 text-slate-500"
						title="Refresh"
					>
						<RefreshCcw className="h-3.5 w-3.5" />
					</button>
				</div>
			</header>

			{inert ? (
				<div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200">
					<AlertTriangle className="mr-2 inline h-4 w-4" />
					<strong>This app looks inert.</strong> Last recorded run{' '}
					{data.runs.newest_run_ts ? `${humanAge(data.runs.stale_seconds)} ago` : 'never'}. Numbers below describe
					a window in which the app was largely not running — read them as a record of that, not of engagement.
				</div>
			) : null}

			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				<Stat
					label="Submissions"
					value={data.truncated?.submissions ? `≥${f.total}` : f.total}
					sub={`${f.users} distinct users${data.truncated?.submissions ? ' · scan capped' : ''}`}
				/>
				<Stat
					label="Deployed"
					value={f.attributed.deployed}
					sub={f.unknown_outcome > 0 ? `${f.unknown_outcome} outcome unknown` : 'all outcomes recorded'}
					tone={f.unknown_outcome > 0 ? 'warn' : 'plain'}
				/>
				<Stat label="Rejected" value={f.attributed.rejected} sub="compiler refused" tone={f.attributed.rejected > 0 ? 'warn' : 'plain'} />
				{f.users_never_deployed > 0 || f.users_outcome_unknown === 0 ? (
					<Stat
						label="Never deployed"
						value={f.users_never_deployed}
						sub="users with a recorded outcome, none of them a deploy"
						tone={f.users_never_deployed > 0 ? 'bad' : 'plain'}
					/>
				) : (
					// Every submission in the window predates outcome recording.
					// Showing "N never deployed" here would report a gap in our
					// records as a fact about those people.
					<Stat
						label="Outcome unknown"
						value={f.users_outcome_unknown}
						sub="users whose submissions predate outcome recording"
						tone="warn"
					/>
				)}
			</div>

			<Panel
				title="Why submissions were rejected"
				note="The compiler's own message, grouped by first line. This is the teaching signal — what people actually get wrong."
			>
				<BarList
					rows={f.reject_reasons}
					empty={
						f.unknown_outcome > 0
							? `No reasons recorded yet. ${f.unknown_outcome} submission(s) in this window predate outcome recording — their verdicts were never attributed to a user and cannot be recovered.`
							: 'No rejections in this window.'
					}
				/>
			</Panel>

			<div className="grid gap-4 md:grid-cols-2">
				<Panel title="Attempts before first success" note="Users who never got there are counted separately, not as a large number that would drag this toward a fake answer.">
					<BarList rows={f.attempts_to_first_deploy} empty="Nobody has deployed in this window." />
					{f.users_never_deployed > 0 ? (
						<div className="mt-3 text-xs text-slate-500">
							{f.users_never_deployed} user(s) submitted and never deployed — excluded from the buckets above.
						</div>
					) : null}
					{f.users_outcome_unknown > 0 ? (
						<div className="mt-3 text-xs text-amber-600">
							{f.users_outcome_unknown} user(s) have no recorded outcome at all — their submissions predate
							verdict recording, so whether they succeeded is not knowable from this data.
						</div>
					) : null}
				</Panel>

				<Panel title="Submission outcomes">
					<BarList
						rows={[
							{ key: 'deployed', count: f.attributed.deployed },
							{ key: 'rejected (compiler)', count: f.attributed.rejected },
							{ key: 'no verdict in window', count: f.attributed.no_verdict },
							{ key: 'mailbox refused', count: f.attributed.mailbox_refused },
							{ key: 'transport error', count: f.attributed.transport_error },
							{ key: 'unknown (pre-attribution)', count: f.unknown_outcome },
						].filter((r) => r.count > 0)}
						empty="No submissions in this window."
					/>
					{f.verdict_ms_p50 ? (
						<div className="mt-3 text-xs text-slate-500">
							Time to verdict — p50 {f.verdict_ms_p50} ms · p95 {f.verdict_ms_p95} ms
						</div>
					) : null}
				</Panel>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<Panel
					title={`Loop runs — ${data.runs.total.toLocaleString()}`}
					note={`${data.runs.users} user(s) · last run ${data.runs.newest_run_ts ? humanAge(data.runs.stale_seconds) + ' ago' : 'never'}`}
				>
					<BarList rows={data.runs.by_loop} empty="No runs recorded in this window." />
					{data.runs.failures_by_loop.length > 0 ? (
						<div className="mt-4">
							<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-red-600">Failures by loop</div>
							<BarList rows={data.runs.failures_by_loop} empty="" />
						</div>
					) : null}
				</Panel>

				<Panel title="What people clicked" note="From the intent queue — UI actions that ran a loop, with how long they queued and whether they completed.">
					<BarList rows={data.intents.by_action} empty="No UI-triggered runs in this window." />
					{data.intents.total > 0 ? (
						<>
							<div className="mt-4">
								<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Outcome</div>
								<BarList rows={data.intents.by_status} empty="" />
							</div>
							<div className="mt-3 text-xs text-slate-500">
								Queue wait p50 {data.intents.queue_ms_p50} ms · p95 {data.intents.queue_ms_p95} ms · run p50{' '}
								{data.intents.run_ms_p50} ms · p95 {data.intents.run_ms_p95} ms
							</div>
						</>
					) : null}
				</Panel>
			</div>

			{/* Cross-tenant ARM ACTIVITY — counts, deliberately never a verdict.
			    Per-arm RESULTS live in each tenant's own ledger, where the
			    instrument guard applies; presenting a fleet mean here would
			    aggregate ledgers that cannot be aggregated. */}
			{data.experiments && data.experiments.total_runs > 0 ? (
				<Panel
					title="Experiment arms across the fleet"
					note={data.experiments.note}
				>
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
						<div>
							<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Runs by arm</div>
							<div className="space-y-1.5">
								{data.experiments.by_arm.map((a) => (
									<div key={a.arm} className="flex items-center gap-3 text-sm">
										<span className="w-40 truncate font-mono text-xs text-slate-700">{a.arm}</span>
										<span className="tabular-nums text-slate-800">{a.runs} run{a.runs === 1 ? "" : "s"}</span>
										<span className="tabular-nums text-xs text-slate-500">{a.users} user{a.users === 1 ? "" : "s"}</span>
										{a.failed > 0 ? (
											<span className="tabular-nums text-xs text-red-600">{a.failed} failed</span>
										) : null}
									</div>
								))}
							</div>
						</div>
						<div>
							<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Runs by experiment</div>
							<BarList rows={data.experiments.by_experiment} empty="" />
						</div>
					</div>
				</Panel>
			) : null}

			<Panel
				title="Backtest honesty"
				note="Whether a result can be quoted as performance. Presentable means ALL THREE axes came back real — prices, signals and settlement — so real prices cannot vouch for a constant signal."
			>
				{data.backtests && data.backtests.total > 0 ? (
					<div className="grid gap-4 md:grid-cols-2">
						<div>
							<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Verdict</div>
							<BarList rows={data.backtests.by_verdict} empty="" />
						</div>
						<div>
							<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Tape provenance</div>
							<BarList
								rows={data.backtests.by_tape}
								empty="No run recorded which tape it replayed."
							/>
						</div>
					</div>
				) : (
					<div className="text-sm text-slate-500">No backtest runs in this window.</div>
				)}
				{/* "Unlabelled" is its own bucket on purpose: a run that recorded no
				    axes is not the same as one that recorded them and failed the
				    test, and folding the two would overstate how much is known. */}
				<div className="mt-3 text-xs text-slate-500">
					Runs carrying no axis labels are counted as <em>unlabelled</em>, never as not-presentable —
					absent and false are different claims.
				</div>
			</Panel>

			<Panel
				title="What people did on the page"
				note="Surface views, form submits and row actions. Names only — never what was typed. Empty until enough traffic since capture was added."
			>
				{data.interactions && data.interactions.total > 0 ? (
					<div className="grid gap-4 md:grid-cols-2">
						<div>
							<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">By action</div>
							<BarList rows={data.interactions.by_action} empty="" />
						</div>
						<div>
							<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Surfaces opened</div>
							<BarList rows={data.interactions.by_surface} empty="No surface views yet." />
						</div>
					</div>
				) : (
					<div className="text-sm text-slate-500">
						Nothing captured in this window. Interaction capture was added recently, so an empty panel
						here means <em>no data yet</em> — not that nobody visited.
					</div>
				)}
				{data.interactions && data.interactions.total > 0 ? (
					<div className="mt-3 text-xs text-slate-500">{data.interactions.users} distinct visitor(s)</div>
				) : null}
			</Panel>

			<Panel
				title="Chat threads"
				note={
					<span className="inline-flex items-start gap-1.5">
						<Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>
							<strong>Floor, not a measurement.</strong> {data.chats.floor_note}.
						</span>
					</span>
				}
			>
				<div className="flex gap-8 text-sm">
					<div>
						<span className="text-2xl font-semibold">≥{data.chats.total}</span>{' '}
						<span className="text-slate-500">threads</span>
					</div>
					<div>
						<span className="text-2xl font-semibold">≥{data.chats.users}</span>{' '}
						<span className="text-slate-500">users</span>
					</div>
				</div>
			</Panel>

			{data.caveats?.length ? (
				<footer className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
					<div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
						How to read this
					</div>
					<ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
						{data.caveats.map((c) => (
							<li key={c}>{c}</li>
						))}
						<li>No per-user score or ranking is computed here, deliberately — that judgement is the reviewer's.</li>
					</ul>
				</footer>
			) : null}
		</div>
	);
}
