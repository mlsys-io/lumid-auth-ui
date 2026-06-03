// MetricTrend — the "is it getting better over iterations?" view.
//
// Given a loop's metric series (from me.loopMetricSeries — one trajectory per
// metric across cycles), it features the metrics that actually MOVE: a tiny
// sparkline + current value + delta-over-window, colored by whether the change
// is an improvement (accuracy up = good; latency/cost down = good). Flat
// metrics (e.g. a plateaued running-max) are de-prioritized — there's nothing
// to show. Used on the app card (compact, top metric) and the loop panel (row).

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Sparkles } from "lucide-react";
import { me, type MeMetricSeries } from "@/api/me";

// Discrete events overlaid on the trajectory.
export const EVENT_META: Record<string, { color: string; label: string }> = {
	learn: { color: "#10b981", label: "learned" },
	fix: { color: "#f59e0b", label: "self-healed" },
	bug: { color: "#e11d48", label: "error" },
	analyze: { color: "#6366f1", label: "analysis" },
};

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
	points: Array<{ ts: string; v: number }>;
	last: number;
	first: number;
	drift: number; // robust trend: last-third avg − first-third avg
	improved: boolean | null; // true=better, false=worse, null=steady
	variance: number;
}

// Direction from a NOISE-ROBUST measure: average of the last third minus the
// first third (raw first→last flips on a noisy endpoint). "steady" only when
// that drift is small relative to the metric's own range.
function toTrend(s: MeMetricSeries): Trend {
	const values = s.points.map((p) => p.v);
	const n = values.length;
	const first = values[0], last = values[n - 1];
	const min = Math.min(...values), max = Math.max(...values), range = max - min;
	const k = Math.max(1, Math.floor(n / 3));
	const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
	const drift = avg(values.slice(n - k)) - avg(values.slice(0, k));
	const flat = range === 0 || Math.abs(drift) < range * 0.12;
	const improved = flat ? null : betterDown(s.label) ? drift < 0 : drift > 0;
	return { label: s.label, values, points: s.points, first, last, drift, improved, variance: range };
}

// Trend amount as text: "+12%" / "−1.2s" / "steady".
export function deltaLabel(t: Trend): string {
	if (t.improved === null) return "steady";
	return `${t.drift > 0 ? "+" : ""}${fmtMetric(t.label, t.drift)}`;
}
// Plain-English verb for an insight sentence.
function trendVerb(t: Trend): string {
	return t.improved === null ? "holding steady" : t.improved ? "improving" : "slipping";
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
	const deltaTxt = deltaLabel(t);
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

function cycleDate(ts: string): string {
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return ts;
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// A width-measuring hook so the curve fills its column crisply (no distortion).
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
	const ref = useRef<HTMLDivElement>(null);
	// Default to a sane width so the curve ALWAYS renders on first paint; the
	// ResizeObserver then snaps it to the real container width. (A 0 default
	// hid the curve whenever the initial measure raced layout.)
	const [w, setW] = useState(320);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const apply = () => { const cw = el.clientWidth; if (cw > 0) setW(cw); };
		const ro = new ResizeObserver(apply);
		ro.observe(el);
		apply();
		return () => ro.disconnect();
	}, []);
	return [ref, w];
}

// EventCurve — the good-looking trajectory: area-filled line with discrete
// event markers (learned / self-healed / error / analysis) at the cycles where
// they happened, hover for detail, legend below.
export function EventCurve({ t, events, height = 60 }: { t: Trend; events: Record<string, string>; height?: number }) {
	const [box, w] = useWidth();
	const [hover, setHover] = useState<number | null>(null);
	const H = height, padX = 6, padY = 8;
	const W = Math.max(w, 80);
	const vals = t.values, n = vals.length;
	const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
	const x = (i: number) => padX + (n === 1 ? 0 : (i / (n - 1)) * (W - 2 * padX));
	const y = (v: number) => H - padY - ((v - min) / rng) * (H - 2 * padY);
	const line = vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
	const area = `${padX},${H - padY} ${line} ${x(n - 1)},${H - padY}`;
	const col = t.improved === null ? COLOR.flat : t.improved ? COLOR.up : COLOR.down;
	const marks = t.points.map((p, i) => ({ i, kind: events[p.ts], p })).filter((m) => m.kind);
	const kindsPresent = Array.from(new Set(marks.map((m) => m.kind)));
	const gid = `cg-${t.label.replace(/\W/g, "")}`;

	return (
		<div className="w-full">
			<div ref={box} className="relative w-full" style={{ height: H }}>
				{w > 0 && (
					<svg width={W} height={H} className="block">
						<defs>
							<linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor={col} stopOpacity="0.18" />
								<stop offset="100%" stopColor={col} stopOpacity="0" />
							</linearGradient>
						</defs>
						<polygon points={area} fill={`url(#${gid})`} />
						<polyline points={line} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
						{marks.map((m) => (
							<g key={m.i} onMouseEnter={() => setHover(m.i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
								<circle cx={x(m.i)} cy={y(m.p.v)} r="6" fill="transparent" />
								<circle cx={x(m.i)} cy={y(m.p.v)} r="3" fill={EVENT_META[m.kind!]?.color || COLOR.flat} stroke="white" strokeWidth="1.5" />
							</g>
						))}
					</svg>
				)}
				{hover !== null && (() => {
					const m = marks.find((mm) => mm.i === hover);
					if (!m) return null;
					const left = Math.min(Math.max(x(m.i), 40), W - 40);
					return (
						<div className="absolute z-10 -translate-x-1/2 pointer-events-none rounded-md bg-slate-900 text-white text-[10px] px-2 py-1 shadow-lg whitespace-nowrap"
							style={{ left, top: Math.max(0, y(m.p.v) - 34) }}>
							<span className="font-medium" style={{ color: EVENT_META[m.kind!]?.color }}>{EVENT_META[m.kind!]?.label}</span>
							{" · "}{fmtMetric(t.label, m.p.v)}{" · "}{cycleDate(m.p.ts)}
						</div>
					);
				})()}
			</div>
			{kindsPresent.length > 0 && (
				<div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
					{kindsPresent.map((k) => (
						<span key={k} className="inline-flex items-center gap-1 text-[9px] text-slate-400">
							<span className="w-1.5 h-1.5 rounded-full" style={{ background: EVENT_META[k!]?.color }} />{EVENT_META[k!]?.label}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

// The featured metric: headline value + delta + the annotated EventCurve.
function FeaturedMetric({ t, events, n }: { t: Trend; events: Record<string, string>; n: number }) {
	const Icon = t.improved === null ? Minus : t.improved ? TrendingUp : TrendingDown;
	const col = trendColor(t);
	const deltaTxt = deltaLabel(t);
	return (
		<div className="w-full">
			<div className="flex items-baseline gap-2">
				<span className="text-[20px] font-semibold text-slate-900 tabular-nums leading-none">{fmtMetric(t.label, t.last)}</span>
				<span className="inline-flex items-center gap-0.5 text-[11px]" style={{ color: col }}><Icon className="w-3.5 h-3.5" />{deltaTxt}</span>
				<span className="text-[11px] text-slate-400">{t.label} · {n} runs</span>
			</div>
			<div className="mt-1.5"><EventCurve t={t} events={events} /></div>
		</div>
	);
}

// Panel goal-header: the primary metric as the big annotated curve, the next
// few as compact trend cells.
export function TrendRow({ series, events, tracked }: { series: MeMetricSeries[]; events: Record<string, string>; tracked?: string[] }) {
	const trends = pickTrends(series, tracked, 4);
	if (!trends.length) return null;
	const [primary, ...rest] = trends;
	const countOf = (t: Trend) => series.find((s) => s.label === t.label)?.points.length ?? t.values.length;
	return (
		<div className="mt-2 space-y-3">
			<FeaturedMetric t={primary} events={events} n={countOf(primary)} />
			{rest.length > 0 && (
				<div className="flex flex-wrap gap-x-5 gap-y-2">
					{rest.map((t) => <MetricTrendCell key={t.label} t={t} n={countOf(t)} />)}
				</div>
			)}
		</div>
	);
}

// Dashboard app-card metrics: the top 2 moving metrics as compact curves with
// the one-line insight to their RIGHT (saves vertical space). Tries the app's
// loops and features whichever actually has a moving series; null if none do.
export function CardMetrics({ app, loops, tracked }: { app: string; loops: string[]; tracked?: string[] }) {
	const [best, setBest] = useState<MeMetricSeries[] | null>(null);
	useEffect(() => {
		let live = true;
		const cands = loops.slice(0, 2);
		if (!cands.length) { setBest([]); return; }
		Promise.all(cands.map((lp) => me.loopMetricSeries(app, lp).then((r) => r.series || []).catch(() => [] as MeMetricSeries[])))
			.then((lists) => {
				if (!live) return;
				let pick: MeMetricSeries[] = [];
				let score = -1;
				for (const s of lists) {
					const moving = pickTrends(s, tracked, 9).length;
					if (moving > score) { score = moving; pick = s; }
				}
				setBest(pick);
			});
		return () => { live = false; };
	}, [app, loops.join(","), (tracked || []).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

	if (!best) return null;
	const trends = pickTrends(best, tracked, 2);
	if (!trends.length) return null;
	const n = best.reduce((m, s) => Math.max(m, s.points.length), 0);
	// Insight leads with the primary (tracked-ordered) metric and tells its trend.
	const lead = trends[0];
	const insight = `${lead.label} ${trendVerb(lead)} over ${n} runs`;
	return (
		<div className="pt-2 mt-1 border-t border-slate-100 flex items-center gap-3">
			{/* column-aligned metric rows: label · curve · value · delta */}
			<div className="flex-shrink-0 space-y-1">
				{trends.map((t) => {
					const col = trendColor(t);
					const Icon = t.improved === null ? Minus : t.improved ? TrendingUp : TrendingDown;
					return (
						<div key={t.label} className="flex items-center gap-2">
							<span className="text-[10px] text-slate-400 w-[84px] truncate flex-shrink-0 text-right">{t.label}</span>
							<Sparkline values={t.values} color={col} w={52} h={15} />
							<span className="text-[12px] font-semibold text-slate-800 tabular-nums w-11 text-right">{fmtMetric(t.label, t.last)}</span>
							<span className="inline-flex items-center justify-end gap-0.5 text-[10px] w-[52px]" style={{ color: col }}><Icon className="w-3 h-3 flex-shrink-0" />{deltaLabel(t)}</span>
						</div>
					);
				})}
			</div>
			{/* insight, beside the block, vertically centered */}
			<div className="text-[10px] text-emerald-700/80 flex items-center gap-1 min-w-0 border-l border-slate-100 pl-3 self-stretch">
				<Sparkles className="w-3 h-3 flex-shrink-0" /><span className="line-clamp-3">{insight}</span>
			</div>
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
