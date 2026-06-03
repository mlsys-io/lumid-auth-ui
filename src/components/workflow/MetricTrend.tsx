// MetricTrend — the "is it getting better over iterations?" view.
//
// Given a loop's metric series (from me.loopMetricSeries — one trajectory per
// metric across cycles), it features the metrics that actually MOVE: a tiny
// sparkline + current value + delta-over-window, colored by whether the change
// is an improvement (accuracy up = good; latency/cost down = good). Flat
// metrics (e.g. a plateaued running-max) are de-prioritized — there's nothing
// to show. Used on the app card (compact, top metric) and the loop panel (row).

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { me, type MeMetricSeries } from "@/api/me";

const lower = (s: string) => s.toLowerCase();
export function betterDown(label: string): boolean {
	return /latency|cost|drawdown|error|\bms\b|usd|\bfail/.test(lower(label));
}
export function fmtMetric(label: string, v: number): string {
	const l = lower(label);
	if (/latency|\bms\b/.test(l)) return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
	if (/cost|usd|\$/.test(l)) return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
	if (/accuracy|rate|score|alpha|alignment/.test(l) && v >= -1 && v <= 1) return `${Math.round(v * 100)}%`;
	if (Number.isInteger(v)) return String(v);
	return String(+v.toFixed(3));
}

export interface Trend {
	label: string;
	values: number[];
	last: number;
	first: number;
	improved: boolean | null; // true=better, false=worse, null=flat
	variance: number;
}

function toTrend(s: MeMetricSeries): Trend {
	const values = s.points.map((p) => p.v);
	const first = values[0], last = values[values.length - 1];
	const min = Math.min(...values), max = Math.max(...values);
	const delta = last - first;
	const improved = delta === 0 ? null : betterDown(s.label) ? delta < 0 : delta > 0;
	return { label: s.label, values, first, last, improved, variance: max - min };
}

// Order: tracked-metric priority first, then most-moving. Drop flat unless all flat.
export function pickTrends(series: MeMetricSeries[], tracked?: string[], max = 4): Trend[] {
	const norm = (s: string) => s.replace(/[\s_]+/g, "");
	const trackIdx = (label: string) => {
		if (!tracked) return 99;
		const i = tracked.findIndex((t) => norm(lower(t)) === norm(lower(label)) || norm(lower(t)).includes(norm(lower(label))));
		return i < 0 ? 99 : i;
	};
	const all = series.map(toTrend);
	const moving = all.filter((t) => t.variance > 0);
	const pool = moving.length ? moving : all; // if everything's flat, still show something
	pool.sort((a, b) => {
		const d = trackIdx(a.label) - trackIdx(b.label);
		return d !== 0 ? d : b.variance - a.variance;
	});
	return pool.slice(0, max);
}

export function Sparkline({ values, color, w = 64, h = 20 }: { values: number[]; color: string; w?: number; h?: number }) {
	if (values.length < 2) return null;
	const min = Math.min(...values), max = Math.max(...values), rng = max - min || 1;
	const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 1 - ((v - min) / rng) * (h - 2)}`);
	const last = pts[pts.length - 1].split(",");
	return (
		<svg width={w} height={h} className="overflow-visible flex-shrink-0" aria-hidden>
			<polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
			<circle cx={last[0]} cy={last[1]} r="1.6" fill={color} />
		</svg>
	);
}

const COLOR = { up: "#10b981", down: "#e11d48", flat: "#94a3b8" };
function trendColor(t: Trend) { return t.improved === null ? COLOR.flat : t.improved ? COLOR.up : COLOR.down; }

// One metric as a featured cell: value + delta + sparkline.
export function MetricTrendCell({ t, n }: { t: Trend; n: number }) {
	const Icon = t.improved === null ? Minus : t.improved ? TrendingUp : TrendingDown;
	const col = trendColor(t);
	const deltaTxt = t.improved === null ? "steady" : `${t.last - t.first > 0 ? "+" : ""}${fmtMetric(t.label, t.last - t.first)}`;
	return (
		<div className="min-w-0">
			<div className="flex items-baseline gap-1.5">
				<span className="text-[15px] font-semibold text-slate-900 tabular-nums leading-none">{fmtMetric(t.label, t.last)}</span>
				<span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color: col }}>
					<Icon className="w-3 h-3" />{deltaTxt}
				</span>
			</div>
			<div className="flex items-center gap-1.5 mt-1">
				<Sparkline values={t.values} color={col} />
				<span className="text-[9px] text-slate-400">{n}×</span>
			</div>
			<div className="text-[10px] text-slate-400 mt-0.5 truncate" title={t.label}>{t.label}</div>
		</div>
	);
}

// Panel goal-header row: up to N moving metrics as trend cells.
export function TrendRow({ series, tracked }: { series: MeMetricSeries[]; tracked?: string[] }) {
	const trends = pickTrends(series, tracked, 4);
	if (!trends.length) return null;
	return (
		<div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
			{trends.map((t) => {
				const n = series.find((s) => s.label === t.label)?.points.length ?? t.values.length;
				return <MetricTrendCell key={t.label} t={t} n={n} />;
			})}
		</div>
	);
}

// Dashboard app-card metrics: the top 2 moving metrics as compact curves +
// a one-line plain-English insight. Renders null when the loop has no series.
export function CardMetrics({ app, loop }: { app: string; loop: string }) {
	const [series, setSeries] = useState<MeMetricSeries[] | null>(null);
	useEffect(() => {
		let live = true;
		me.loopMetricSeries(app, loop)
			.then((r) => { if (live) setSeries(r.series || []); })
			.catch(() => { if (live) setSeries([]); });
		return () => { live = false; };
	}, [app, loop]);
	if (!series) return null;
	const trends = pickTrends(series, undefined, 2);
	if (!trends.length) return null;
	const n = series.reduce((m, s) => Math.max(m, s.points.length), 0);
	const imp = trends.filter((t) => t.improved === true).sort((a, b) => Math.abs(b.last - b.first) - Math.abs(a.last - a.first))[0];
	const insight = imp ? `${imp.label} improving over ${n} runs` : `${trends[0].label} steady over ${n} runs`;
	return (
		<div className="pt-2 mt-1 border-t border-slate-100">
			<div className="flex gap-5">
				{trends.map((t) => {
					const cnt = series.find((s) => s.label === t.label)?.points.length ?? t.values.length;
					return <MetricTrendCell key={t.label} t={t} n={cnt} />;
				})}
			</div>
			<div className="text-[10px] text-emerald-700/80 mt-1.5 flex items-center gap-1"><Sparkles className="w-3 h-3" />{insight}</div>
		</div>
	);
}

// Compact single-line trend for the dashboard app card: top moving metric only.
export function CardMetricTrend({ app, loop }: { app: string; loop: string }) {
	const [trend, setTrend] = useState<Trend | null>(null);
	const [count, setCount] = useState(0);
	useEffect(() => {
		let live = true;
		me.loopMetricSeries(app, loop)
			.then((r) => {
				if (!live) return;
				const picked = pickTrends(r.series || [], undefined, 1);
				if (picked.length) { setTrend(picked[0]); setCount(r.series.find((s) => s.label === picked[0].label)?.points.length ?? 0); }
			})
			.catch(() => { /* no trend → render nothing */ });
		return () => { live = false; };
	}, [app, loop]);

	if (!trend) return null;
	const Icon = trend.improved === null ? Minus : trend.improved ? TrendingUp : TrendingDown;
	const col = trendColor(trend);
	const deltaTxt = trend.improved === null ? "steady" : `${trend.last - trend.first > 0 ? "+" : ""}${fmtMetric(trend.label, trend.last - trend.first)}`;
	return (
		<div className="flex items-center gap-1.5" title={`${trend.label} over ${count} runs`}>
			<span className="text-[10px] text-slate-400 truncate max-w-[72px]">{trend.label}</span>
			<Sparkline values={trend.values} color={col} w={44} h={14} />
			<span className="text-[11px] font-semibold text-slate-700 tabular-nums">{fmtMetric(trend.label, trend.last)}</span>
			<span className="inline-flex items-center gap-0.5 text-[9px]" style={{ color: col }}><Icon className="w-2.5 h-2.5" />{deltaTxt}</span>
		</div>
	);
}
