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
import { useMeasuredWidth } from "@/hooks/useMeasuredWidth";

const STROKE = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3", "stroke-chart-4", "stroke-chart-5", "stroke-chart-6", "stroke-chart-7", "stroke-chart-8"];
const TEXT = ["text-chart-1", "text-chart-2", "text-chart-3", "text-chart-4", "text-chart-5", "text-chart-6", "text-chart-7", "text-chart-8"];

/** A smooth line through the points that never overshoots them (monotone
 *  cubic, Fritsch–Carlson): curves like Novix's, honest about every value. */
export function smoothPath(pts: Array<[number, number]>): string {
	const n = pts.length;
	if (n === 0) return "";
	if (n < 3) return pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
	const dx: number[] = [], m: number[] = [];
	for (let i = 0; i < n - 1; i++) { dx.push(pts[i + 1][0] - pts[i][0] || 1e-6); m.push((pts[i + 1][1] - pts[i][1]) / dx[i]); }
	const t: number[] = [m[0]];
	for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
	t.push(m[n - 2]);
	let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
	for (let i = 0; i < n - 1; i++) {
		const h = dx[i] / 3;
		d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
	}
	return d;
}
const FILL = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6", "bg-chart-7", "bg-chart-8"];

export interface EvoSeries { id: string; label: string; points: Array<{ ts: string; v: number; n?: number }>; inferred?: boolean }

interface Line { id: string; label: string; ci: number; pts: Array<{ t: number; avg: number; n: number }> }

const W0 = 640, H_DEFAULT = 220, PAD_R = 108, PAD_T = 12, PAD_B = 26;

/** Raw results → running averages; or, when the server already sent running
 *  means (series_kind "running_mean", the scheduler's own state.history),
 *  take them as they are — averaging a mean again would bend the line. */
function runningAverages(points: Array<{ ts: string; v: number; n?: number }>, alreadyMeans: boolean): Array<{ t: number; avg: number; n: number }> {
	const sorted = points.map((p) => ({ t: Date.parse(p.ts), v: p.v, n: p.n })).filter((p) => isFinite(p.t) && isFinite(p.v)).sort((a, b) => a.t - b.t);
	if (alreadyMeans) return sorted.map((p, i) => ({ t: p.t, avg: p.v, n: p.n ?? i + 1 }));
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

type ChartProps = {
	series: EvoSeries[]; metricKey: string; unit: string; higherIsBetter?: boolean;
	/** The points are already each version's average so far (series_kind "running_mean"). */
	alreadyMeans?: boolean;
	/** false = the versions were measured differently; the lines are drawn but must not be read against each other. */
	comparable?: boolean;
	/** Results whose run named no version — left off the chart, and said so. */
	unlabelledRuns?: number;
	/** Each version's state, shown beside its name in the small charts ("trying"). */
	tagOf?: (id: string) => { text: string; className: string } | null;
};

/** Versions measured differently get ONE SMALL CHART EACH, on its own scale:
 *  two lines on one axis invite the comparison the caption then forbids
 *  (first-glance test, 2026-11-25). Comparable versions share one chart. */
export default function EvolutionChart(props: ChartProps) {
	const drawn = props.series.filter((s) => s.points.length > 0);
	if (props.comparable === false && drawn.length > 1) {
		// One time axis for all of them, so the small charts line up vertically.
		const ts = drawn.flatMap((s) => s.points.map((p) => Date.parse(p.ts))).filter((t) => isFinite(t));
		const xRange: [number, number] = [Math.min(...ts), Math.max(...ts)];
		return (
			<div className="space-y-2">
				<div className="flex items-baseline gap-2 flex-wrap">
					<span className="text-caption font-medium text-ink-800">How each version evolved</span>
					<span className="text-micro text-ink-600">each line is a version&apos;s average so far, on its own scale (measured differently) · {props.higherIsBetter === false ? "lower" : "higher"} is better</span>
				</div>
				<SparkRows {...props} series={drawn} xRange={xRange} />
				{props.unlabelledRuns ? <div className="text-nano text-ink-600">{props.unlabelledRuns.toLocaleString()} result{props.unlabelledRuns === 1 ? "" : "s"} from runs that didn&apos;t say which version they ran aren&apos;t drawn.</div> : null}
			</div>
		);
	}
	return <OneChart {...props} />;
}

function OneChart({ series, metricKey, unit, higherIsBetter = true, comparable = true, unlabelledRuns = 0, alreadyMeans = false, heading, height, colorIndex, xRange }: ChartProps & {
	/** A shared time axis (small multiples). */
	xRange?: [number, number];
	/** A small-multiple's own title (replaces the caption and legend). */
	heading?: string;
	height?: number;
	/** Keep a version's colour when it is drawn alone. */
	colorIndex?: number;
}) {
	const H = height ?? H_DEFAULT;
	const wrapRef = useRef<HTMLDivElement>(null);
	const W = useMeasuredWidth(wrapRef, W0);
	const lines: Line[] = useMemo(() => series
		.map((s, i) => ({ id: s.id, label: s.label, ci: (colorIndex ?? i) % 8, pts: runningAverages(s.points, alreadyMeans) }))
		.filter((l) => l.pts.length > 0), [series, alreadyMeans, colorIndex]);
	const [hoverT, setHoverT] = useState<number | null>(null);
	const clipId = `evo-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const svgRef = useRef<SVGSVGElement>(null);

	const dom = useMemo(() => {
		const ts = lines.flatMap((l) => l.pts.map((p) => p.t));
		// Skip each line's first few points for the y-range: an average of one
		// or two results swings wildly and would set the scale for everything.
		const vs = lines.flatMap((l) => l.pts.slice(Math.min(3, l.pts.length - 1)).map((p) => p.avg));
		const t0 = xRange ? xRange[0] : Math.min(...ts), t1 = xRange ? xRange[1] : Math.max(...ts);
		let v0 = Math.min(...vs), v1 = Math.max(...vs);
		const pad = (v1 - v0) * 0.12 || Math.abs(v1) * 0.1 || 1;
		v0 -= pad; v1 += pad;
		return { t0, t1: t1 === t0 ? t0 + 1 : t1, v0, v1 };
	}, [lines, xRange]);
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
			{heading ? (
				<figcaption className="flex items-center gap-1.5 text-micro text-ink-700">
					<span className={cn("w-3 h-0.5 rounded-full", FILL[lines[0]?.ci ?? 0])} />{heading}
					<span className="text-ink-600">· average so far</span>
				</figcaption>
			) : (
				<figcaption className="flex items-baseline gap-2 flex-wrap">
					<span className="text-caption font-medium text-ink-800">How it evolved</span>
					<span className="text-micro text-ink-600">each line is a version&apos;s average so far · {higherIsBetter ? "higher" : "lower"} is better</span>
				</figcaption>
			)}
			{lines.length >= 2 && (
				<ul className="flex items-center gap-3 flex-wrap text-micro text-ink-700" aria-label="Versions">
					{lines.map((l) => (
						<li key={l.id} className="inline-flex items-center gap-1.5"><span className={cn("w-3 h-0.5 rounded-full", FILL[l.ci])} />{l.label}</li>
					))}
				</ul>
			)}
			<div ref={wrapRef} className="relative">
				<svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img"
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
						const xy = l.pts.map((p) => [x(p.t), y(p.avg)] as [number, number]);
						const d = smoothPath(xy);
						const end = l.pts[l.pts.length - 1];
						const base = H - PAD.b;
						const area = xy.length > 1 ? `${d}L${xy[xy.length - 1][0].toFixed(1)},${base}L${xy[0][0].toFixed(1)},${base}Z` : "";
						const gid = `${clipId}-g${l.ci}`;
						return (
							<g key={l.id} className={TEXT[l.ci]}>
								{/* A faint wash under a lone line (Novix's soft curves); none when lines overlap. */}
								{lines.length === 1 && area && (
									<>
										<defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity={0.16} /><stop offset="100%" stopColor="currentColor" stopOpacity={0} /></linearGradient></defs>
										<path d={area} fill={`url(#${gid})`} clipPath={`url(#${clipId})`} className="evo-area-in" />
									</>
								)}
								<path d={d} fill="none" pathLength={100} clipPath={`url(#${clipId})`} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" className={cn(STROKE[l.ci], "evo-line-draw")} />
								{/* The latest value: a dot with a halo. */}
								<circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={6} fill="currentColor" opacity={0.15} className="evo-area-in" />
								<circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={3} fill="currentColor" stroke="rgb(var(--card-rgb))" strokeWidth={1.5} className="evo-area-in" />
								{/* Direct label at the line's end (≤4 versions; the legend covers more). */}
								{lines.length <= 4 && (
									<text x={x(end.t) + 10} y={endY.get(l.id)} dy="0.32em" className="fill-ink-700 text-nano">{l.label.length > 16 ? `${l.label.slice(0, 15)}…` : l.label}</text>
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

/** Versions measured differently, one compact row each on its own scale:
 *  name, where it stands now, and its average so far as a smooth line drawn at
 *  real pixels. The rows share one time axis (labelled once, under the last). */
function SparkRows({ series, metricKey, unit, alreadyMeans = false, xRange, tagOf }: ChartProps & { xRange: [number, number] }) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const W = useMeasuredWidth(wrapRef, 360);
	// The high and low labels get their own bands above and below the line, so
	// the line never runs through them.
	const RH = 56, BAND = 12, PL = 2, PR = 8;
	const fmt = (v: number) => fmtMetricValue(v, unit, metricKey);
	const rows = useMemo(() => series.map((s, i) => ({ id: s.id, label: s.label, ci: i % 8, pts: runningAverages(s.points, alreadyMeans) })).filter((l) => l.pts.length > 0), [series, alreadyMeans]);
	const span = Math.max(1, xRange[1] - xRange[0]);
	const x = (t: number) => PL + ((t - xRange[0]) / span) * (W - PL - PR);
	return (
		<div ref={wrapRef} className="space-y-3">
			{rows.map((l) => {
				const vs = l.pts.slice(Math.min(3, l.pts.length - 1)).map((p) => p.avg);
				const lo = Math.min(...vs), hi = Math.max(...vs);
				const v0 = lo, v1 = hi > lo ? hi : lo + (Math.abs(lo) * 0.1 || 1);
				const y = (v: number) => BAND + (1 - (Math.max(v0, Math.min(v1, v)) - v0) / (v1 - v0)) * (RH - 2 * BAND);
				const xy = l.pts.map((p) => [x(p.t), y(p.avg)] as [number, number]);
				const d = smoothPath(xy);
				const last = l.pts[l.pts.length - 1];
				const floor = RH - BAND + 2;
				const area = xy.length > 1 ? `${d}L${xy[xy.length - 1][0].toFixed(1)},${floor}L${xy[0][0].toFixed(1)},${floor}Z` : "";
				const gid = `spark-${l.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
				const tag = tagOf?.(l.id);
				return (
					<figure key={l.id} className="space-y-0.5">
						<figcaption className="flex items-center gap-1.5 text-micro">
							<span className={cn("h-0.5 w-3 flex-shrink-0 rounded-full", FILL[l.ci])} aria-hidden />
							<span className="min-w-0 truncate font-medium text-ink-800">{l.label}</span>
							{tag && <span className={cn("flex-shrink-0 rounded-full border px-1.5 text-nano font-medium", tag.className)}>{tag.text}</span>}
							<span className="ml-auto whitespace-nowrap font-mono tabular-nums text-ink-900">{fmt(last.avg)}</span>
						</figcaption>
						<svg width={W} height={RH} viewBox={`0 0 ${W} ${RH}`} className={cn("block max-w-full", TEXT[l.ci])} role="img"
							aria-label={`${l.label}: average ${metricKey} over time, now ${fmt(last.avg)}; between ${fmt(lo)} and ${fmt(hi)}`}>
							<defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity={0.14} /><stop offset="100%" stopColor="currentColor" stopOpacity={0} /></linearGradient></defs>
							{area && <path d={area} fill={`url(#${gid})`} className="evo-area-in" />}
							<path d={d} fill="none" pathLength={100} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" stroke="currentColor" className="evo-line-draw" />
							<circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={2.5} fill="currentColor" stroke="rgb(var(--card-rgb))" strokeWidth={1.25} className="evo-area-in" />
							<text x={PL} y={BAND - 3} className="fill-ink-600 text-nano tabular-nums">high {fmt(hi)}</text>
							<text x={PL} y={RH - 1} className="fill-ink-600 text-nano tabular-nums">low {fmt(lo)}</text>
							<text x={W - PR} y={RH - 1} textAnchor="end" className="fill-ink-600 text-nano tabular-nums">avg of {last.n.toLocaleString()}</text>
						</svg>
					</figure>
				);
			})}
			<div className="flex justify-between text-nano text-ink-600"><span>{day(xRange[0])}</span><span>{day(xRange[1])}</span></div>
		</div>
	);
}
