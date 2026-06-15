// GoalTrend — does the Goal's scoreboard move run-over-run?
//
// A workflow's Goal is scored by the numeric KPIs each cycle writes into
// summary.metrics (a flat dict). This pulls the last N runs (oldest→newest),
// builds one series per metric, and renders a compact inline-SVG sparkline per
// metric with the latest value + a ▲/▼ delta vs the first point — so you can
// see at a glance whether the Goal is being met better over time. Matches the
// MetricTrend.Sparkline house style (gold accent, tiny polyline). Self-hides
// when no run carries numeric metrics.

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Minus, Target } from "lucide-react";
import { me, type MeCycleDetail } from "@/api/me";
import { cn } from "@/lib/utils";

// How many of the most recent runs to chart. Kept small — this is a glance,
// not the full EventCurve drill-in, and each run is one cycleDetail fetch.
const MAX_RUNS = 12;

const lower = (s: string) => s.toLowerCase();
// Lower-is-better metrics (cost/latency/drawdown/error) flip the good color.
function betterDown(label: string): boolean {
	return /latency|cost|drawdown|error|\bms\b|usd|\bfail/.test(lower(label));
}
function fmtMetric(label: string, v: number): string {
	const l = lower(label);
	if (/latency|\bms\b/.test(l)) return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
	if (/cost|usd|\$/.test(l)) return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
	if (/accuracy|rate|score|alpha|alignment/.test(l) && v >= -1 && v <= 1) return `${Math.round(v * 100)}%`;
	if (Number.isInteger(v)) return String(v);
	return String(+v.toFixed(3));
}

const COLOR = { up: "#B08F45", down: "#e11d48", flat: "#94a3b8" };

// Tiny inline-SVG sparkline (mirrors MetricTrend.Sparkline).
function Sparkline({ values, color, w = 60, h = 18 }: { values: number[]; color: string; w?: number; h?: number }) {
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

interface Series { label: string; values: number[] }

export default function GoalTrend({ app, loop, runs }: { app: string; loop: string; runs: string[] }) {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const [details, setDetails] = useState<Record<string, MeCycleDetail | null> | null>(null);
	// Newest-first in; chart the most recent MAX_RUNS.
	const sel = [...runs].filter(Boolean).slice(0, MAX_RUNS);
	const key = sel.join(",");

	useEffect(() => {
		let live = true;
		setDetails(null);
		if (!sel.length) { setDetails({}); return; }
		Promise.all(sel.map((ts) =>
			me.cycleDetail(app, loop, ts).then((d) => [ts, d] as const).catch(() => [ts, null] as const)))
			.then((pairs) => { if (live) setDetails(Object.fromEntries(pairs)); });
		return () => { live = false; };
	}, [app, loop, key]); // eslint-disable-line react-hooks/exhaustive-deps

	if (details === null) return <div className="h-12 rounded-lg bg-slate-100 animate-pulse" />;

	// oldest → newest for the curve direction.
	const ordered = [...sel].sort((a, b) => a.localeCompare(b));
	const metricsAt = (ts: string): Record<string, unknown> => {
		const m = (details[ts]?.summary as any)?.metrics;
		return m && typeof m === "object" && !Array.isArray(m) ? m : {};
	};
	// Union of numeric metric keys across the window.
	const labels = Array.from(new Set(
		ordered.flatMap((ts) => Object.entries(metricsAt(ts))
			.filter(([, v]) => typeof v === "number" && Number.isFinite(v as number))
			.map(([k]) => k)),
	));

	// Build a per-metric series, keeping only runs where that metric is present.
	const series: Series[] = labels
		.map((label) => ({
			label,
			values: ordered.map((ts) => metricsAt(ts)[label]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)),
		}))
		.filter((s) => s.values.length >= 2)
		.slice(0, 6);

	if (!series.length) return null; // no numeric metrics → self-hide

	return (
		<div className="rounded-xl border border-slate-200 bg-white">
			<div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-semibold border-b border-slate-100 flex items-center gap-1.5">
				<Target className="w-3 h-3" /> Goal trend · last {ordered.length} runs
			</div>
			<ul className="divide-y divide-slate-100">
				{series.map((s) => {
					const first = s.values[0], last = s.values[s.values.length - 1];
					const delta = last - first;
					const flat = delta === 0;
					const up = delta > 0;
					const good = flat ? null : betterDown(s.label) ? !up : up;
					const col = good === null ? COLOR.flat : good ? COLOR.up : COLOR.down;
					const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
					const deltaTxt = flat ? "steady" : `${delta > 0 ? "+" : ""}${fmtMetric(s.label, delta)}`;
					return (
						<li key={s.label} className="flex items-center gap-2 px-2.5 py-1.5">
							<span className="text-[11px] text-slate-400 truncate flex-1 min-w-0" title={s.label}>{s.label.replace(/_/g, " ")}</span>
							<Sparkline values={s.values} color={col} />
							<span className="text-[12px] font-semibold text-slate-800 tabular-nums w-12 text-right">{fmtMetric(s.label, last)}</span>
							<span className="inline-flex items-center justify-end gap-0.5 text-[10px] w-[54px]" style={{ color: col }}>
								<Icon className="w-3 h-3 flex-shrink-0" />{deltaTxt}
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
