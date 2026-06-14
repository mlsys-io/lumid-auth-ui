// SysResearchTile — surfaces the live state of `auto-sysresearch`
// across its three loops (benchmark / benchmark_parallel /
// regression_sweep) on the super-admin dashboard.
//
// Most operator-relevant data already lives in `snap.loops` (the
// `LoopsResp` snapshot the super-admin page fetches once). This tile:
//   1. Filters that snapshot for app=auto-sysresearch rows
//   2. Renders each loop's status + last cycle timestamp + duration
//   3. Pulls one extra artifact per row (`score.json` for benchmark,
//      `drift.json` for regression_sweep) to surface the headline
//      metric inline — without expanding the row.
//
// Drill-down is one click → /dashboard/results?app=auto-sysresearch
// (the existing CycleDrawer page handles the full insight.md + score
// + journal stack).
//
// Three loops, so the tile renders as a 3-column grid on lg+ screens.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, Clock, Cpu, GitBranch, Loader2 } from 'lucide-react';
import axios from 'axios';
import type { LoopRow, LoopsResp } from '@/api/super-admin';

// Same shape as results.tsx — read-only fetch against the identity
// service; cookie auth via withCredentials. Single shared client to
// keep keep-alive warm across the K artifact requests this tile fires.
import { API_BASE_URL } from '@/config/env';
const api = axios.create({ baseURL: API_BASE_URL, timeout: 15_000, withCredentials: true });

const APP_NAME = 'auto-sysresearch';
const LOOP_ORDER: { name: string; label: string; metric: string }[] = [
	{ name: 'benchmark',           label: 'sequential',  metric: 'accuracy' },
	{ name: 'benchmark_parallel',  label: 'parallel K=3', metric: 'best_accuracy' },
	{ name: 'regression_sweep',    label: 'nightly drift', metric: 'drift_count' },
];

interface ScoreArtifact {
	// benchmark / benchmark_parallel both produce score.json
	accuracy?: number;
	latency_p95_ms?: number;
	cost_per_query_usd?: number;
	variant_id?: string;
	// benchmark_parallel wraps multiple results
	results?: Array<{ accuracy?: number; variant_id?: string }>;
	succeeded?: string[];
}

interface DriftArtifact {
	// regression_sweep produces drift.json instead of score.json
	rerun_count?: number;
	drift_count?: number;
	any_drift?: boolean;
	rows?: unknown[];
}

interface CycleMetric {
	headline: string;
	tone: 'good' | 'warn' | 'bad' | 'default';
	missing: boolean;
}

function _statusTone(row: LoopRow): 'good' | 'warn' | 'bad' | 'default' {
	if (row.status === 'failing') return 'bad';
	if (row.status === 'stale') return 'warn';
	if (row.status === 'ok') return 'good';
	return 'default';
}

function _statusIcon(tone: 'good' | 'warn' | 'bad' | 'default') {
	if (tone === 'good') return <CheckCircle2 className="w-3 h-3 text-amber-600" />;
	if (tone === 'bad') return <AlertTriangle className="w-3 h-3 text-red-600" />;
	if (tone === 'warn') return <AlertTriangle className="w-3 h-3 text-amber-600" />;
	return <Activity className="w-3 h-3 text-indigo-600" />;
}

function _formatTs(unix: number): string {
	// Guard null/0/pre-2024 (1704067200 = 2024-01-01) → never the
	// "20000d ago" epoch artifact.
	if (!unix || unix < 1_704_067_200) return 'never';
	const d = new Date(unix * 1000);
	const diff = Math.max(0, Date.now() / 1000 - unix);
	if (diff < 90) return `${Math.round(diff)}s ago`;
	if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
	return `${Math.round(diff / 86400)}d ago`;
}

// Pulls the headline metric for one loop. Returns {headline, missing}
// so the row can render even when the artifact 404s (e.g., the loop
// has never run on this host).
function useLoopHeadline(loopName: string, lastRunTs: number, lastOk: boolean | null | undefined): CycleMetric {
	const [metric, setMetric] = useState<CycleMetric>({ headline: '—', tone: 'default', missing: false });

	useEffect(() => {
		if (!lastRunTs) {
			setMetric({ headline: '—', tone: 'default', missing: true });
			return;
		}
		// regression_sweep writes drift.json instead of score.json
		const name = loopName === 'regression_sweep' ? 'drift.json' : 'score.json';
		api
			.get(`/api/v1/admin/cycle-artifact`, {
				params: { app: APP_NAME, loop: loopName, name },
			})
			.then((r) => {
				const data = r.data as ScoreArtifact & DriftArtifact;
				if (loopName === 'regression_sweep') {
					const n = data.drift_count ?? 0;
					const total = data.rerun_count ?? 0;
					if (total === 0) {
						setMetric({ headline: 'no variants', tone: 'default', missing: false });
					} else if (n === 0) {
						setMetric({ headline: `0/${total} drifted`, tone: 'good', missing: false });
					} else {
						setMetric({ headline: `${n}/${total} drifted`, tone: 'warn', missing: false });
					}
					return;
				}
				// benchmark + benchmark_parallel both have an accuracy field
				let acc: number | undefined = data.accuracy;
				if (acc === undefined && data.results && data.results.length > 0) {
					const accs = data.results.map((r) => r.accuracy ?? 0);
					acc = Math.max(...accs);
				}
				if (acc === undefined) {
					setMetric({ headline: '—', tone: 'default', missing: false });
					return;
				}
				const pct = (acc * 100).toFixed(0) + '%';
				const tone = acc >= 0.85 ? 'good' : acc >= 0.7 ? 'default' : 'warn';
				setMetric({ headline: `${pct} acc`, tone, missing: false });
			})
			.catch((e) => {
				if (e?.response?.status === 404) {
					setMetric({ headline: '—', tone: 'default', missing: true });
				} else {
					setMetric({ headline: '?', tone: 'default', missing: false });
				}
			});
	}, [loopName, lastRunTs, lastOk]);

	return metric;
}

function LoopCard({ row }: { row: LoopRow }) {
	const tone = _statusTone(row);
	const cfg = LOOP_ORDER.find((l) => l.name === row.loop);
	const metric = useLoopHeadline(row.loop, row.last_run_ts, row.last_ok);
	const toneBorder =
		tone === 'good'
			? 'border-l-amber-500'
			: tone === 'warn'
				? 'border-l-amber-500'
				: tone === 'bad'
					? 'border-l-red-500'
					: 'border-l-indigo-500';
	return (
		<Link
			to={`/dashboard/results?app=${APP_NAME}&loop=${row.loop}`}
			className={`bg-white border border-gray-200 border-l-4 ${toneBorder} rounded p-4 hover:shadow-sm transition block`}
		>
			<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground mb-2">
				{_statusIcon(tone)}
				<span>{cfg?.label ?? row.loop}</span>
				<span className="ml-auto font-mono text-[10px] normal-case text-slate-400">{row.schedule}</span>
			</div>
			<div className="text-2xl font-semibold leading-tight">{metric.headline}</div>
			<div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
				<Clock className="w-3 h-3" />
				<span>{_formatTs(row.last_run_ts)}</span>
				{row.last_duration_s > 0 && <span>· {row.last_duration_s.toFixed(0)}s</span>}
				{row.consecutive_failures > 0 && (
					<span className="text-red-600 font-medium">
						· {row.consecutive_failures} consec fail
					</span>
				)}
			</div>
		</Link>
	);
}

interface Props {
	loops: LoopsResp | null;
}

export function SysResearchTile({ loops }: Props) {
	const rows = useMemo(() => {
		if (!loops) return [];
		// Preserve LOOP_ORDER ordering for stable layout regardless of
		// backend sort.
		const byName = new Map<string, LoopRow>();
		for (const r of loops.loops) {
			if (r.app === APP_NAME) byName.set(r.loop, r);
		}
		return LOOP_ORDER.map((cfg) => byName.get(cfg.name)).filter(
			(r): r is LoopRow => r !== undefined,
		);
	}, [loops]);

	if (!loops) {
		return (
			<div className="bg-white border border-gray-200 rounded p-4 text-sm text-muted-foreground">
				<Loader2 className="w-3 h-3 inline animate-spin mr-2" />
				Loading auto-sysresearch state…
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div className="bg-white border border-gray-200 rounded p-4 text-sm text-muted-foreground">
				<Cpu className="w-3 h-3 inline mr-2" />
				<code className="text-xs">auto-sysresearch</code> not installed on this host.{' '}
				<a
					href="https://xp.io/a3f48236-ffe9-4fb9-9548-6e044d5cd9c7/auto-sysresearch"
					target="_blank"
					rel="noopener noreferrer"
					className="underline"
				>
					Browse it on xp.io →
				</a>
			</div>
		);
	}

	return (
		<div>
			<div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
				<GitBranch className="w-3 h-3" />
				<span>
					<code>auto-sysresearch</code> — NL-to-SQL variant search.{' '}
					<Link to={`/dashboard/results?app=${APP_NAME}`} className="text-indigo-600 underline">
						all cycles →
					</Link>
				</span>
			</div>
			<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
				{rows.map((r) => (
					<LoopCard key={r.loop} row={r} />
				))}
			</div>
		</div>
	);
}

export default SysResearchTile;
