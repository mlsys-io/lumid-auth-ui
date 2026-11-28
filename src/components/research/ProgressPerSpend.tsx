// ProgressPerSpend — "is spending more still buying improvement?"
//
//   BEST SO FAR 24 tok/s · after 14 GPU-min
//   ▲ goodput                         ●━━━━━━━━━━━━━━━  ← best at the step that counts
//   │          ●━━━━━━━━━━━━━━━━━━━━━┛
//   │  ·  ●━━━┛   ·                    ○             ← light: cheap step · hollow: reused
//   └──────────────────────────────────────────▶ GPU-minutes spent
//   "Best Goodput: 24 tok/s (C4), reached after 14 GPU-min. The 7 GPU-min since then bought no improvement"
//
// x is cumulative real spend (GPU-min, else CPU-min, else notional $, else
// run time — the axis says which), y the experiment's metric at the step that
// counts (the last one reached). Logic and words: lib/progress-per-spend.ts.

import { useMemo, useRef, useState } from "react";
import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { progressPerSpend, progressWords, spendAt } from "@/lib/progress-per-spend";
import type { MeUsage } from "@/lib/spend";
import { fmtMetricValue } from "@/lib/run-answer";
import { useMeasuredWidth } from "@/hooks/useMeasuredWidth";
import { cn } from "@/lib/utils";
import { RollingNumber } from "./BestScoreChart";

/** 3–6 round ticks (1, 2, 2.5 or 5 × 10^k) inside [lo, hi]. */
export function roundTicks(lo: number, hi: number): number[] {
	if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
	for (const parts of [4, 5, 3, 6]) {
		const raw = (hi - lo) / parts;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
		const out: number[] = [];
		for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
		if (out.length >= 3) return out;
	}
	return [lo, hi];
}

const H = 200, PAD_R = 16, PAD_T = 12, PAD_B = 30;

export default function ProgressPerSpend({ steps, rows, metric, higherIsBetter, label, usage }: {
	steps: EvidenceStepSpec[];
	rows: MeExperimentRow[] | null;
	metric: string;
	higherIsBetter?: boolean;
	label: (v: string) => string;
	/** The app's /me/usage: a bill there (model calls) puts the axis in dollars. */
	usage?: MeUsage | null;
}) {
	const p = useMemo(() => (rows ? progressPerSpend({ steps, rows, metric, higherIsBetter, usage }) : null), [rows, steps, metric, higherIsBetter, usage]);
	const wrap = useRef<HTMLDivElement>(null);
	const W = useMeasuredWidth(wrap, 560);
	const [hover, setHover] = useState<number | null>(null);
	if (!p || !p.points.some((q) => q.value != null)) return null;
	const fmt = (v: number) => fmtMetricValue(v, p.metricUnit, p.metric);
	const vals = p.points.map((q) => q.value).filter((v): v is number => v != null);
	let v0 = Math.min(...vals), v1 = Math.max(...vals);
	const padv = (v1 - v0) * 0.15 || Math.abs(v1) * 0.1 || 1;
	v0 -= padv; v1 += padv;
	const ticks = roundTicks(v0, v1);
	const PAD_L = Math.max(40, Math.max(...ticks.map((v) => fmt(v).length)) * 6 + 10);
	const xMax = p.total > 0 ? p.total * 1.04 : 1;
	const x = (s: number) => PAD_L + (s / xMax) * (W - PAD_L - PAD_R);
	const y = (v: number) => PAD_T + (1 - (Math.max(v0, Math.min(v1, v)) - v0) / (v1 - v0)) * (H - PAD_T - PAD_B);
	// The best-so-far step line, from the first point that set it.
	let d = "";
	for (const q of p.points) {
		if (q.best == null) continue;
		d += d ? `H${x(q.x).toFixed(1)}V${y(q.best).toFixed(1)}` : `M${x(q.x).toFixed(1)},${y(q.best).toFixed(1)}`;
	}
	if (d) d += `H${x(xMax).toFixed(1)}`;
	const xticks = roundTicks(0, xMax).filter((t) => t >= 0 && t <= xMax);
	const h = hover == null ? null : p.points[hover];
	return (
		<figure className="space-y-2" data-testid="progress-per-spend">
			<div className="flex items-start gap-3 flex-wrap">
				<figcaption className="min-w-0 flex-1">
					<div className="text-caption font-medium text-ink-800">Results for what it cost</div>
					<div className="text-micro text-ink-600">Best {p.metricLabel.toLowerCase()} at {p.countingLabel} against {p.unitLabel} spent · {p.higherIsBetter ? "higher" : "lower"} is better</div>
				</figcaption>
				<div className="text-right">
					<div className="eyebrow">Best so far</div>
					<div className="font-mono text-h3 leading-none text-ink-900"><RollingNumber value={p.best?.value ?? null} format={fmt} /></div>
					<div className="text-micro text-ink-600 mt-0.5">{p.best ? `after ${spendAt(p, p.best.at)}` : "nothing passed yet"}</div>
				</div>
			</div>
			<div ref={wrap} className="relative">
				<svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={progressWords(p, label)}>
					{ticks.map((v, i) => (
						<g key={i}>
							<line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="stroke-ink-100" />
							<text x={PAD_L - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-600 text-nano tabular-nums">{fmt(v)}</text>
						</g>
					))}
					{xticks.map((t, i) => (
						<text key={i} x={x(t)} y={H - 14} textAnchor={i === 0 ? "start" : "middle"} className="fill-ink-600 text-nano tabular-nums">
							{p.unit === "usd" ? `$${+t.toPrecision(3)}` : +t.toPrecision(3)}
						</text>
					))}
					<text x={W - PAD_R} y={H - 2} textAnchor="end" className="fill-ink-600 text-nano">{p.unitLabel} spent →</text>
					{p.points.map((q, i) => q.value == null ? null : (
						<circle key={i} cx={x(q.x)} cy={y(q.value)} r={q.counts ? 4 : 3}
							className={cn(
								q.reused ? "fill-card stroke-ink-400" : q.counts ? (q.passed ? "fill-chart-1" : "fill-brick-500") : "fill-ink-300",
								"evo-dot-in", hover != null && hover !== i && "opacity-40",
							)}
							strokeWidth={q.reused ? 1.25 : 0} style={{ animationDelay: `${Math.min(900, i * 12)}ms` }}
							onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
					))}
					{d && <path d={d} fill="none" pathLength={100} className="stroke-ink-800 evo-line-draw" strokeWidth={2} />}
				</svg>
				{h && h.value != null && (
					<div className="pointer-events-none absolute top-1 rounded-lg border border-ink-200 bg-card px-2 py-1.5 shadow-e2 text-micro"
						style={x(h.x) / W > 0.5 ? { right: `${100 - (x(h.x) / W) * 100 + 2}%` } : { left: `${(x(h.x) / W) * 100 + 2}%` }}>
						<div className="font-medium text-ink-800">{label(h.version)} · {h.step ? h.step.replace(/_/g, " ") : "result"}</div>
						<div className="text-ink-700">{fmt(h.value)}{h.reused ? " · reused, free" : ""}{h.counts && !h.passed ? " · didn't pass" : ""}</div>
						<div className="text-ink-600">{spendAt(p, h.x)} spent by then</div>
					</div>
				)}
			</div>
			<p className="text-micro text-ink-700">{progressWords(p, label)}</p>
			<ul className="flex items-center gap-x-4 gap-y-1 flex-wrap text-micro text-ink-600" aria-label="How to read it">
				<li className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5 bg-ink-800 rounded-full" /> best so far</li>
				<li className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-chart-1" /> at {p.countingLabel}</li>
				{p.points.some((q) => !q.counts && q.value != null) && <li className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-ink-300" /> earlier step</li>}
				{p.points.some((q) => q.reused) && <li className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full border border-ink-400" /> reused, free</li>}
			</ul>
		</figure>
	);
}
