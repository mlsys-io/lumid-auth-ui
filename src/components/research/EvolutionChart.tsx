// EvolutionChart — "how has this experiment evolved?": each version's average
// so far, over time. One line per version (chart-1… in DECLARED order, so a
// version keeps its colour whatever its rank), one y-axis, a legend plus end
// labels, and a crosshair tooltip with every version's average and count at
// that moment.
//
// Averages, not every result: real results spread far wider than the averages
// differ (kol_alpha: stdev ≈ 430k around means of 17k–122k), so raw dots would
// flatten every line into the baseline. The caption says what is drawn.

import { useId, useMemo, useRef, useState } from "react";
import { fmtMetricValue } from "@/lib/run-answer";
import { cn } from "@/lib/utils";

const STROKE = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3", "stroke-chart-4", "stroke-chart-5", "stroke-chart-6", "stroke-chart-7", "stroke-chart-8"];
const FILL = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6", "bg-chart-7", "bg-chart-8"];

export interface EvoSeries { id: string; label: string; points: Array<{ ts: string; v: number }>; inferred?: boolean }

interface Line { id: string; label: string; ci: number; pts: Array<{ t: number; avg: number; n: number }> }

const W = 640, H = 220, PAD_R = 108, PAD_T = 12, PAD_B = 26;

function runningAverages(points: Array<{ ts: string; v: number }>): Array<{ t: number; avg: number; n: number }> {
	const sorted = points.map((p) => ({ t: Date.parse(p.ts), v: p.v })).filter((p) => isFinite(p.t) && isFinite(p.v)).sort((a, b) => a.t - b.t);
	let sum = 0;
	return sorted.map((p, i) => { sum += p.v; return { t: p.t, avg: sum / (i + 1), n: i + 1 }; });
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
	if (lo === hi) return [lo];
	const step0 = (hi - lo) / n;
	const mag = Math.pow(10, Math.floor(Math.log10(step0)));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
	const out: number[] = [];
	for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(12));
	return out;
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export default function EvolutionChart({ series, metricKey, unit, higherIsBetter = true, comparable = true, unlabelledRuns = 0 }: {
	series: EvoSeries[]; metricKey: string; unit: string; higherIsBetter?: boolean;
	/** false = the versions were measured differently; the lines are drawn but must not be read against each other. */
	comparable?: boolean;
	/** Results whose run named no version — left off the chart, and said so. */
	unlabelledRuns?: number;
}) {
	const lines: Line[] = useMemo(() => series
		.map((s, i) => ({ id: s.id, label: s.label, ci: i % 8, pts: runningAverages(s.points) }))
		.filter((l) => l.pts.length > 0), [series]);
	const [hoverT, setHoverT] = useState<number | null>(null);
	const clipId = `evo-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const svgRef = useRef<SVGSVGElement>(null);

	const dom = useMemo(() => {
		const ts = lines.flatMap((l) => l.pts.map((p) => p.t));
		// Skip each line's first few points for the y-range: an average of one
		// or two results swings wildly and would set the scale for everything.
		const vs = lines.flatMap((l) => l.pts.slice(Math.min(3, l.pts.length - 1)).map((p) => p.avg));
		const t0 = Math.min(...ts), t1 = Math.max(...ts);
		let v0 = Math.min(...vs), v1 = Math.max(...vs);
		const pad = (v1 - v0) * 0.12 || Math.abs(v1) * 0.1 || 1;
		v0 -= pad; v1 += pad;
		return { t0, t1: t1 === t0 ? t0 + 1 : t1, v0, v1 };
	}, [lines]);
	if (lines.length === 0) return null;

	const fmt = (v: number) => fmtMetricValue(v, unit, metricKey);
	const yTicks = niceTicks(dom.v0, dom.v1);
	// Room for the widest tick label (~6 units per character at text-nano).
	const PAD = { l: Math.max(36, Math.max(...yTicks.map((v) => fmt(v).length)) * 6 + 10), r: PAD_R, t: PAD_T, b: PAD_B };
	const x = (t: number) => PAD.l + ((t - dom.t0) / (dom.t1 - dom.t0)) * (W - PAD.l - PAD.r);
	const y = (v: number) => PAD.t + (1 - (Math.max(dom.v0, Math.min(dom.v1, v)) - dom.v0) / (dom.v1 - dom.v0)) * (H - PAD.t - PAD.b);
	const xTicks = [dom.t0, (dom.t0 + dom.t1) / 2, dom.t1];
	// End labels, nudged apart so two lines ending close together stay legible.
	const ends = lines.map((l) => ({ id: l.id, y: y(l.pts[l.pts.length - 1].avg), x: x(l.pts[l.pts.length - 1].t) })).sort((a, b) => a.y - b.y);
	for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
	const endY = new Map(ends.map((e) => [e.id, e.y]));

	// The crosshair's reading: each version's latest average at or before hoverT.
	const at = hoverT == null ? null : lines.map((l) => {
		let last: Line["pts"][number] | undefined;
		for (const p of l.pts) { if (p.t <= hoverT) last = p; else break; }
		return { l, p: last };
	});
	const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
		const r = svgRef.current?.getBoundingClientRect();
		if (!r) return;
		const px = ((e.clientX - r.left) / r.width) * W;
		const t = dom.t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (dom.t1 - dom.t0);
		setHoverT(Math.max(dom.t0, Math.min(dom.t1, t)));
	};
	const inferred = series.some((s) => s.inferred);

	return (
		<figure className="space-y-1.5">
			<figcaption className="flex items-baseline gap-2 flex-wrap">
				<span className="text-caption font-medium text-ink-800">How it evolved</span>
				<span className="text-micro text-ink-600">each line is a version&apos;s average so far · {higherIsBetter ? "higher" : "lower"} is better</span>
			</figcaption>
			{lines.length >= 2 && (
				<ul className="flex items-center gap-3 flex-wrap text-micro text-ink-700" aria-label="Versions">
					{lines.map((l) => (
						<li key={l.id} className="inline-flex items-center gap-1.5"><span className={cn("w-3 h-0.5 rounded-full", FILL[l.ci])} />{l.label}</li>
					))}
				</ul>
			)}
			<div className="relative">
				<svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
					aria-label={`Average ${metricKey} per version over time`}
					onMouseMove={onMove} onMouseLeave={() => setHoverT(null)}>
					{yTicks.map((v) => (
						<g key={v}>
							<line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-ink-100" strokeWidth={1} />
							<text x={PAD.l - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-600 text-nano tabular-nums">{fmt(v)}</text>
						</g>
					))}
					{xTicks.map((t, i) => (
						<text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="fill-ink-600 text-nano">{day(t)}</text>
					))}
					{/* Early averages (one or two results) can sit outside the range the
					    axis was fitted to: clip them to the plot, not over the tick labels. */}
					<clipPath id={clipId}><rect x={PAD.l} y={PAD.t - 2} width={W - PAD.l - PAD.r + 2} height={H - PAD.t - PAD.b + 4} /></clipPath>
					{lines.map((l) => {
						const d = l.pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`).join("");
						const end = l.pts[l.pts.length - 1];
						return (
							<g key={l.id}>
								<path d={d} fill="none" pathLength={100} clipPath={`url(#${clipId})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={cn(STROKE[l.ci], "evo-line-draw")} />
								{/* Direct label at the line's end (≤4 versions; the legend covers more). */}
								{lines.length <= 4 && (
									<text x={x(end.t) + 6} y={endY.get(l.id)} dy="0.32em" className="fill-ink-700 text-nano">{l.label.length > 16 ? `${l.label.slice(0, 15)}…` : l.label}</text>
								)}
							</g>
						);
					})}
					{hoverT != null && <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.t} y2={H - PAD.b} className="stroke-ink-300" strokeWidth={1} strokeDasharray="3 3" />}
					{at?.map(({ l, p }) => p && (
						<circle key={l.id} cx={x(p.t)} cy={y(p.avg)} r={4} className={cn(STROKE[l.ci], "fill-card")} strokeWidth={2} />
					))}
				</svg>
				{at && hoverT != null && (
					<div className="pointer-events-none absolute top-1 rounded-lg border border-ink-200 bg-card px-2 py-1.5 shadow-e2 text-micro space-y-0.5"
						style={x(hoverT) / W > 0.5 ? { right: `${100 - (x(hoverT) / W) * 100 + 1}%` } : { left: `${(x(hoverT) / W) * 100 + 1}%` }}>
						<div className="font-medium text-ink-800">{day(hoverT)}</div>
						{at.map(({ l, p }) => (
							<div key={l.id} className="flex items-center gap-1.5 whitespace-nowrap">
								<span className={cn("w-2 h-2 rounded-full", FILL[l.ci])} />
								<span className="text-ink-700">{l.label}</span>
								<span className="ml-auto pl-2 tabular-nums text-ink-900">{p ? `${fmt(p.avg)} · ${p.n} result${p.n === 1 ? "" : "s"}` : "no results yet"}</span>
							</div>
						))}
					</div>
				)}
			</div>
			{!comparable && lines.length > 1 && (
				<div className="text-micro text-ember-700">The versions were measured differently, so don&apos;t read these lines against each other — each one only shows its own trend.</div>
			)}
			{(inferred || unlabelledRuns > 0) && (
				<div className="text-nano text-ink-600">{unlabelledRuns > 0 ? `${unlabelledRuns.toLocaleString()} result${unlabelledRuns === 1 ? "" : "s"} from runs that didn't say which version they ran aren't drawn.` : "Runs that named no version are counted as the current one."}</div>
			)}
		</figure>
	);
}
