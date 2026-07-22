// LQT Strategies — read-only roster view at /studio/manage.
//
// Modeled on studio/admin.tsx (tabbed cards, useEffect fetch, StatCard,
// ErrorBox, Loading). Fetches the SAME `/lqt/strategies-roster` endpoint
// the operations status page reads, via the shared `fetchRoster()` helper
// in src/lqt/roster.ts, so the two views stay consistent.
//
// READ-ONLY: no deploy / retire / tune controls — those land in a later
// wave. A deep-link to /status/operations surfaces the full scorecard.
// SuperAdminGuard-gated at the route in App.tsx.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

import { fetchRoster, type LqtStrategiesRoster, type RosterBox } from '@/lqt/roster';
import { TONES, type ToneKey } from '@/lib/tones';

// Arm status → tone key. live=ok; high-reject on a live arm=attention;
// silent (not live)=idle.
function armTone(b: RosterBox): ToneKey {
	if (!b.live) return 'idle';
	const submitted = b.n_submitted ?? 0;
	const rejected = b.n_rejected ?? 0;
	if (rejected > 0 && rejected >= submitted) return 'attention';
	return 'ok';
}

const ARM_LABEL: Record<'ok' | 'attention' | 'idle', string> = {
	ok: 'live',
	attention: 'high reject',
	idle: 'silent',
};

function fmtAge(secs?: number): string {
	if (secs == null) return '—';
	const s = Math.max(0, Math.floor(secs));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

function fmtMetric(v: number): string {
	if (v == null || Number.isNaN(v)) return '—';
	if (Number.isInteger(v)) return String(v);
	const abs = Math.abs(v);
	if (abs !== 0 && abs < 0.01) return v.toExponential(2);
	return v.toFixed(abs < 1 ? 4 : 2);
}

export default function StudioManage() {
	const [data, setData] = useState<LqtStrategiesRoster | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = () => {
		setLoading(true);
		fetchRoster()
			.then((r) => {
				setData(r);
				setError(null);
			})
			.catch((e) => setError(String(e?.message || e)))
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div className="space-y-4">
			<header className="flex items-baseline justify-between">
				<div>
					<h1 className="text-lg font-medium flex items-center gap-2">
						<Activity className="w-5 h-5 text-gold-600" />
						LQT Strategies
					</h1>
					<p className="text-sm text-slate-500 mt-0.5">
						Read-only roster of live &amp; silent strategy arms across the
						fleet. Full scorecard + venue health at
						<Link
							to="/status/operations"
							className="ml-1 text-gold-700 hover:underline"
						>
							/status/operations <ExternalLink className="inline w-3 h-3" />
						</Link>
					</p>
				</div>
				<button
					onClick={load}
					className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-gold-700 transition"
				>
					<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
					refresh
				</button>
			</header>

			{error ? (
				<ErrorBox>{error}</ErrorBox>
			) : !data ? (
				<Loading />
			) : (
				<RosterView data={data} />
			)}

			<div className="text-xs text-slate-400 italic">
				Controls (deploy / retire / tune) coming soon — this view is read-only.
			</div>
		</div>
	);
}

// ── Roster view ────────────────────────────────────────────────────

function RosterView({ data }: { data: LqtStrategiesRoster }) {
	const { boxes, summary } = data;
	if (!boxes || boxes.length === 0) {
		return (
			<div className="text-sm text-slate-500 italic py-6 text-center">
				No strategy arms reported.
			</div>
		);
	}

	const byBox = new Map<string, RosterBox[]>();
	for (const b of boxes) {
		const list = byBox.get(b.box_id) ?? [];
		list.push(b);
		byBox.set(b.box_id, list);
	}
	const groups = Array.from(byBox.entries()).sort((a, b) => a[0].localeCompare(b[0]));
	const familyEntries = Object.entries(summary?.families ?? {}).sort(
		(a, b) => b[1] - a[1],
	);

	return (
		<div className="space-y-4">
			{/* summary header */}
			<div className="grid grid-cols-3 gap-3">
				<StatCard label="Live arms" value={String(summary?.live_arms ?? 0)} tone="good" />
				<StatCard label="Silent arms" value={String(summary?.silent_arms ?? 0)} />
				<StatCard
					label="Total arms"
					value={String(summary?.total_arms ?? boxes.length)}
				/>
			</div>
			{familyEntries.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5 text-xs">
					<span className="text-slate-500">Families:</span>
					{familyEntries.map(([fam, n]) => (
						<span
							key={fam}
							className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700"
						>
							{fam}: {n}
						</span>
					))}
				</div>
			)}

			{/* per-box tables */}
			{groups.map(([boxId, rows]) => (
				<div
					key={boxId}
					className="rounded-lg border border-slate-200 bg-white overflow-x-auto"
				>
					<div className="px-3 py-2 border-b border-slate-100 text-xs uppercase tracking-wide font-medium text-slate-700">
						{boxId}
						<span className="ml-2 text-slate-400 normal-case tracking-normal">
							{rows.length} arm{rows.length === 1 ? '' : 's'}
						</span>
					</div>
					<table className="w-full text-sm">
						<thead className="bg-slate-50 text-left text-xs text-slate-600 tracking-wide">
							<tr>
								<th className="px-3 py-2 font-medium">Family</th>
								<th className="px-3 py-2 font-medium w-28">Mode</th>
								<th className="px-3 py-2 font-medium w-32">State</th>
								<th className="px-3 py-2 font-medium w-24">Age</th>
								<th className="px-3 py-2 font-medium w-20 text-right">Cycles</th>
								<th className="px-3 py-2 font-medium">Key metric</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{rows
								.slice()
								.sort(
									(a, b) =>
										Number(b.live) - Number(a.live) ||
										(a.age_secs ?? 0) - (b.age_secs ?? 0),
								)
								.map((b) => {
									const tone = armTone(b);
									return (
										<tr key={`${b.box_id}:${b.family}:${b.mode}`} className="hover:bg-slate-50/60">
											<td className="px-3 py-1.5 font-mono text-xs">{b.family}</td>
											<td className="px-3 py-1.5 text-xs">
												<span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
													{b.mode}
												</span>
											</td>
											<td className="px-3 py-1.5 text-xs">
												<span className="inline-flex items-center gap-1.5">
													<span
														className={`inline-block w-2 h-2 rounded-full ${TONES[tone].dot}`}
													/>
													<span className="text-[10px] uppercase tracking-wide text-slate-500">
														{ARM_LABEL[tone as 'ok' | 'attention' | 'idle']}
													</span>
												</span>
											</td>
											<td className="px-3 py-1.5 text-xs text-slate-500 font-mono">
												{fmtAge(b.age_secs)}
											</td>
											<td className="px-3 py-1.5 text-xs text-right tabular-nums">
												{b.cycles ?? 0}
											</td>
											<td className="px-3 py-1.5 text-xs">
												{b.key_metric ? (
													<span className="font-mono">
														<span className="text-slate-500">{b.key_metric.name}:</span>{' '}
														{fmtMetric(b.key_metric.value)}
													</span>
												) : (
													<span className="text-slate-400">—</span>
												)}
											</td>
										</tr>
									);
								})}
						</tbody>
					</table>
				</div>
			))}
		</div>
	);
}

// ── Shared (mirrors studio/admin.tsx) ──────────────────────────────

function StatCard({
	label,
	value,
	hint,
	tone = 'default',
}: {
	label: string;
	value: string;
	hint?: string;
	tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
	const toneCls = {
		default: '',
		good: 'text-gold-700',
		warn: 'text-gold-700',
		bad: 'text-rose-700',
	}[tone];
	return (
		<div className="rounded-lg border border-slate-200 bg-white p-4">
			<div className="text-xs tracking-wide text-slate-500">{label}</div>
			<div className={['text-2xl font-medium mt-1', toneCls].join(' ')}>{value}</div>
			{hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
		</div>
	);
}

function ErrorBox({ children }: { children: React.ReactNode }) {
	return (
		<div className="text-sm rounded border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2">
			{children}
		</div>
	);
}

function Loading() {
	return (
		<div className="text-sm text-slate-500 italic flex items-center gap-2">
			<Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
		</div>
	);
}
