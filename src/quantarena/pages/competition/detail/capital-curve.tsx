import React, { useEffect, useState } from 'react';
import {
	LineChart, Line, XAxis, YAxis, CartesianGrid,
	Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { getEquityChart } from '../../../api';
import type { EquityChartSeries } from '../../../api/types';

const COLORS = [
	'#6366f1', '#10b981', '#f59e0b', '#ef4444',
	'#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];

interface Props {
	competitionId: number;
	status?: 'Upcoming' | 'Ongoing' | 'Completed';
}

function formatTs(ts: number): string {
	const d = new Date(ts * 1000);
	return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function formatDollar(v: number): string {
	if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
	if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`;
	return `$${v.toFixed(0)}`;
}

interface ChartRow {
	date: string;
	ts: number;
	[key: string]: number | string;
}

export default function CapitalCurve({ competitionId, status }: Props) {
	const [series, setSeries]     = useState<EquityChartSeries[]>([]);
	const [loading, setLoading]   = useState(true);
	const [error, setError]       = useState<string | null>(null);

	useEffect(() => {
		if (!competitionId) return;
		setLoading(true);
		setError(null);
		const nowSeconds = Math.floor(Date.now() / 1000);
		getEquityChart(competitionId, {
			start_time: nowSeconds - 10 * 24 * 3600,
			end_time:   nowSeconds,
		})
			.then((r) => setSeries(r.charts || []))
			.catch((e) => setError(e?.message || 'Failed to load chart'))
			.finally(() => setLoading(false));
	}, [competitionId]);

	// Build recharts-compatible row array, downsample to ≤ 200 pts for performance
	const { rows, keys } = React.useMemo(() => {
		if (series.length === 0) return { rows: [], keys: [] };

		// Merge all series into a map keyed by bucketed timestamp (hourly)
		const bucket = (ts: number) => Math.floor(ts / 3600) * 3600;
		const map = new Map<number, ChartRow>();

		const seriesKeys = series.slice(0, 8).map((s) => `${s.participant_id}-${s.strategy_name}`);

		for (let si = 0; si < series.length && si < 8; si++) {
			const s   = series[si];
			const key = seriesKeys[si];
			for (const pt of s.data_points) {
				const b = bucket(pt.timestamp);
				if (!map.has(b)) map.set(b, { date: formatTs(b), ts: b });
				const row = map.get(b)!;
				// keep latest within bucket
				if (!(key in row) || pt.timestamp > (row[`${key}_ts`] as number)) {
					row[key]          = pt.total_equity;
					row[`${key}_ts`]  = pt.timestamp;
				}
			}
		}

		const sorted = Array.from(map.values()).sort((a, b) => (a.ts as number) - (b.ts as number));

		// Downsample: keep ≤ 200 rows
		const step = Math.max(1, Math.ceil(sorted.length / 200));
		const rows = sorted.filter((_, i) => i % step === 0 || i === sorted.length - 1);

		return { rows, keys: seriesKeys };
	}, [series]);

	// Y-axis domain
	const { domain } = React.useMemo(() => {
		let min = Infinity, max = -Infinity;
		for (const row of rows) {
			for (const key of keys) {
				const v = row[key];
				if (typeof v === 'number') {
					if (v < min) min = v;
					if (v > max) max = v;
				}
			}
		}
		if (min === Infinity) return { domain: [90000, 110000] as [number, number] };
		const pad = (max - min) * 0.08 || 500;
		return { domain: [Math.floor(min - pad), Math.ceil(max + pad)] as [number, number] };
	}, [rows, keys]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
				Loading capital curve…
			</div>
		);
	}

	if (error || rows.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-64 gap-3">
				<TrendingUp className="w-10 h-10 text-muted-foreground/40" />
				<p className="text-sm text-muted-foreground">
					{error || 'No chart data yet — check back after the first cycle runs.'}
				</p>
			</div>
		);
	}

	return (
		<div className="p-4">
			<div className="mb-3">
				<h3 className="text-sm font-semibold">Capital Curve</h3>
				<p className="text-xs text-muted-foreground">Last 7 days · all strategies start at the same funding</p>
			</div>
			<ResponsiveContainer width="100%" height={300}>
				<LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
					<XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 11 }} />
					<YAxis
						stroke="#9ca3af"
						tick={{ fontSize: 11 }}
						tickFormatter={formatDollar}
						domain={domain}
						width={68}
					/>
					<Tooltip
						formatter={(v: number, name: string) => [
							`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
							name.split('-').slice(1).join('-'),
						]}
						labelFormatter={(label) => `Date: ${label}`}
					/>
					<Legend
						formatter={(value) => value.split('-').slice(1).join('-')}
						iconType="line"
						wrapperStyle={{ fontSize: 11 }}
					/>
					{keys.map((key, idx) => (
						<Line
							key={key}
							type="monotone"
							dataKey={key}
							name={key}
							stroke={COLORS[idx % COLORS.length]}
							strokeWidth={2}
							dot={false}
							activeDot={{ r: 3 }}
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
