// BestScoreChart — Novix's "how it evolved" story for an experiment whose
// versions are comparable:
//
//   BEST SO FAR  0.7146  Rewritten · 101 results          ← rolls + gold flash on change
//   ·  ·  ▪ ▪ ▪━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┊ now      ← step line: best counted version
//          - - - - - - - - - - - - - - - - - - -┊          ← dashed: leading, not confirmed
//   v1 Current version → v2 Rewritten                       ← the version chain (VersionChain)
//
// The x axis is time, or the order tried when the versions ran in one batch;
// takeover marks carry the version's name; y ticks always show the lowest and
// highest result and 0; target and pass mark are labelled lines. Those layout
// rules are pure, in lib/evolution-axis.ts.
//
// Logic in lib/evolution.ts. Colours follow the version in declared order
// (chart-1…); the step and frontier lines are ink/gold so they read as "the
// story" over the per-version dots.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Evolution, StepPoint } from "@/lib/evolution";
import { dodge, gateLineWords, newBestIndices, niceTicks, ordinal, placeLabels, targetLineWords, xAxis, yDomain, yTicks, zeroLine, type GateOp } from "@/lib/evolution-axis";
import { fmtMetricValue } from "@/lib/run-answer";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/activity";
import { useMeasuredWidth } from "@/hooks/useMeasuredWidth";

const FILL = ["fill-chart-1", "fill-chart-2", "fill-chart-3", "fill-chart-4", "fill-chart-5", "fill-chart-6", "fill-chart-7", "fill-chart-8"];
const W0 = 640, H = 220, PAD_R = 40, PAD_T = 14, PAD_B = 26;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** A number that rolls to its new value (600 ms) and flashes gold when it
 *  changes; instant under reduced motion. */
export function RollingNumber({ value, format, className }: { value: number | null; format: (v: number) => string; className?: string }) {
	const [shown, setShown] = useState<number | null>(value);
	const [flash, setFlash] = useState(false);
	const prev = useRef<number | null>(value);
	useEffect(() => {
		const from = prev.current, to = value;
		prev.current = value;
		if (to == null || from == null || from === to) { setShown(to); return; }
		const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		setFlash(true);
		const off = window.setTimeout(() => setFlash(false), 900);
		if (reduce) { setShown(to); return () => window.clearTimeout(off); }
		let raf = 0; const t0 = performance.now();
		const step = (now: number) => {
			const k = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - k, 3);
			setShown(from + (to - from) * e);
			if (k < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => { cancelAnimationFrame(raf); window.clearTimeout(off); };
	}, [value]);
	return <span className={cn("tabular-nums transition-colors duration-700", flash && "text-gold-600", className)}>{shown == null ? "—" : format(shown)}</span>;
}

export default function BestScoreChart({ evo, labelOf, colorOf, metricKey, unit, higherIsBetter, minSamples, target, gate, failedAt }: {
	evo: Evolution;
	labelOf: (arm: string) => string;
	colorOf: (arm: string) => number;
	metricKey: string; unit: string; higherIsBetter: boolean; minSamples: number;
	/** The value the research is aiming for (experiment metric.target), drawn as a labelled line. */
	target?: number | null;
	/** The pass mark a gate sets on this metric at the story's step (`gateLine`), drawn as a labelled line. */
	gate?: { op: GateOp; value: number; step: string } | null;
	/** A gated chain where the top number came from a step its version did NOT
	 *  pass: it is the furthest result, not a "best" (2026-11-28 audit). */
	failedAt?: string | null;
}) {
	const fmt = (v: number) => fmtMetricValue(v, unit, metricKey);
	const clipId = `bs-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const svgRef = useRef<SVGSVGElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const W = useMeasuredWidth(wrapRef, W0);
	const [hoverP, setHoverP] = useState<number | null>(null);

	// x: time, or — when most versions ran in one batch — the order tried
	// (lib/evolution-axis). On a time axis a batch is one x: a stack of dots.
	const ax = useMemo(() => xAxis(evo, Date.now(), day), [evo]);
	const tgt = target != null && Number.isFinite(target) ? target : null;
	const dom = useMemo(() => yDomain(evo.points, [tgt, gate?.value]), [evo, tgt, gate?.value]);
	// The lowest and highest result drawn, 0 when the range crosses it, then
	// round values where they fit (the axis once read only "1.66", 2026-11-28).
	const ticks = yTicks(dom, 16 / (H - PAD_T - PAD_B));
	const PAD_L = Math.max(40, Math.max(...ticks.map((t) => fmt(t.value).length)) * 6 + 10);
	const x = (p: number) => PAD_L + ((p - ax.p0) / (ax.p1 - ax.p0)) * (W - PAD_L - PAD_R);
	const y = (v: number) => PAD_T + (1 - (Math.max(dom.v0, Math.min(dom.v1, v)) - dom.v0) / (dom.v1 - dom.v0)) * (H - PAD_T - PAD_B);
	const stepPath = (pts: StepPoint[]) => {
		if (!pts.length) return "";
		let d = `M${x(ax.stepPos(pts[0])).toFixed(1)},${y(pts[0].value).toFixed(1)}`;
		for (let i = 1; i < pts.length; i++) d += `H${x(ax.stepPos(pts[i])).toFixed(1)}V${y(pts[i].value).toFixed(1)}`;
		return d + `H${x(ax.p1).toFixed(1)}`;
	};
	// Each version is named once — where it FIRST took the lead. Labelling
	// every flip buried the line under "v1v2v1" when two versions trade places;
	// "v1 / v2 / v3" never said what they were (2026-11-28).
	const takeovers = evo.best.filter((s, i) => evo.best.findIndex((b) => b.arm === s.arm) === i);
	const labels = placeLabels(takeovers.map((s) => ({ x: x(ax.stepPos(s)), y: y(s.value), text: labelOf(s.arm) })),
		{ left: PAD_L, right: W - PAD_R, top: PAD_T, bottom: H - PAD_B });
	// Results that made a new best are marks; the rest stay visible but quiet,
	// nudged sideways where they would hide one another.
	const lead = newBestIndices(evo.best);
	const dx = dodge(evo.points.map((p, i) => ({ x: x(ax.pointPos[i]), y: y(p.mean) })));

	// Hover: the state of every version at that moment (or after that result).
	const at = hoverP == null ? null : (() => {
		const m = new Map<string, { mean: number; n: number }>();
		evo.points.forEach((p, i) => { if (ax.pointPos[i] <= hoverP) m.set(p.arm, { mean: p.mean, n: p.n }); });
		let b: StepPoint | null = null;
		for (const s of evo.best) { if (ax.stepPos(s) > hoverP) break; b = s; }
		return { m, b };
	})();
	const hoverHead = hoverP == null ? "" : ax.mode === "order"
		? (() => { const i = Math.max(0, Math.min(evo.points.length - 1, Math.round(hoverP))); return `${ordinal(i + 1)} result · ${labelOf(evo.points[i].arm)}`; })()
		: day(hoverP);
	const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
		const r = svgRef.current?.getBoundingClientRect();
		if (!r) return;
		const px = ((e.clientX - r.left) / r.width) * W;
		const p = ax.p0 + ((px - PAD_L) / (W - PAD_L - PAD_R)) * (ax.p1 - ax.p0);
		setHoverP(ax.mode === "order" ? Math.max(0, Math.min(evo.points.length - 1, Math.round(p))) : Math.max(ax.p0, Math.min(ax.p1, p)));
	};

	return (
		<figure className="space-y-2">
			<div className="flex items-start gap-3 flex-wrap">
				<figcaption className="min-w-0 flex-1">
					<div className="text-caption font-medium text-ink-800">How it evolved</div>
					<div className="text-micro text-ink-600">A version counts once it has {minSamples} result{minSamples === 1 ? "" : "s"} · {higherIsBetter ? "higher" : "lower"} is better{ax.caption ? ` · ${ax.caption}` : ""}</div>
				</figcaption>
				<div className="text-right">
					{/* A tie nobody decided has no single "best": say how many share it. */}
					<div className="eyebrow">{failedAt ? "Top result" : evo.tie && !evo.tie.decidedBy ? "Tied for best" : "Best so far"}</div>
					<div className="font-mono text-h2 leading-none text-ink-900">
						<RollingNumber value={evo.hero?.value ?? null} format={fmt} />
					</div>
					<div className="text-micro text-ink-600 mt-0.5">
						{!evo.hero ? `no version has ${plural(minSamples, "result")} yet`
							: evo.tie && !evo.tie.decidedBy ? `${evo.tie.arms.length} versions`
							: `${labelOf(evo.hero.arm)} · ${plural(evo.chain.find((c) => c.arm === evo.hero!.arm)?.n ?? 0, "result")}`}
						{evo.hero && evo.stepLabel ? ` · ${evo.stepLabel}` : ""}
					</div>
					{failedAt && <div className="text-micro text-ember-700 mt-0.5">didn&apos;t pass {failedAt}</div>}
				</div>
			</div>
			<div ref={wrapRef} className="relative">
				<svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img"
					aria-label={`Best ${metricKey} so far ${ax.mode === "order" ? "in the order tried" : "over time"}, ${evo.hero ? `now ${fmt(evo.hero.value)} by ${labelOf(evo.hero.arm)}` : "no version counted yet"}`}
					onMouseMove={onMove} onMouseLeave={() => setHoverP(null)}>
					<clipPath id={clipId}><rect x={PAD_L - 6} y={PAD_T - 4} width={W - PAD_L - PAD_R + 12} height={H - PAD_T - PAD_B + 8} /></clipPath>
					{ticks.map((t) => (
						<g key={`${t.kind}-${t.value}`}>
							{t.kind !== "zero" && <line x1={PAD_L} x2={W - PAD_R} y1={y(t.value)} y2={y(t.value)} className="stroke-ink-100" strokeWidth={1} />}
							<text x={PAD_L - 6} y={y(t.value)} dy="0.32em" textAnchor="end" className={cn("text-nano tabular-nums", t.kind === "round" ? "fill-ink-600" : "fill-ink-800")}>{fmt(t.value)}</text>
						</g>
					))}
					{zeroLine(dom) && <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} className="stroke-ink-400" strokeWidth={1} />}
					<text x={PAD_L} y={H - 6} className="fill-ink-600 text-nano">{ax.start}</text>
					{!ax.showNow && ax.end && <text x={x(ax.p1)} y={H - 6} textAnchor="end" className="fill-ink-600 text-nano">{ax.end}</text>}
					{/* Reference lines under the marks; their words go on top (below). */}
					{gate && <line x1={PAD_L} x2={W - PAD_R} y1={y(gate.value)} y2={y(gate.value)} className="stroke-ember-600" strokeWidth={1.25} strokeDasharray="3 3" />}
					{tgt != null && <line x1={PAD_L} x2={W - PAD_R} y1={y(tgt)} y2={y(tgt)} className="stroke-lagoon-600" strokeWidth={1.25} strokeDasharray="6 4" />}
					<g clipPath={`url(#${clipId})`}>
						{/* Every result: a new best is a full mark; the rest are quieter,
						    solid once the version counts, faint while collecting. */}
						{evo.points.map((p, i) => {
							const r = lead.has(i) ? 2.75 : p.counted ? 2.25 : 2;
							return (
								<rect key={i} x={x(ax.pointPos[i]) + dx[i] - r} y={y(p.mean) - r} width={r * 2} height={r * 2} rx={1}
									className={cn(FILL[colorOf(p.arm) % 8], "evo-dot-in")} style={{ opacity: lead.has(i) ? 0.95 : p.counted ? 0.55 : 0.3, animationDelay: `${Math.min(1200, i * 4)}ms` }} />
							);
						})}
						<path d={stepPath(evo.frontier)} fill="none" className="stroke-gold-500 evo-dot-in" strokeWidth={1.25} strokeDasharray="4 3" />
						<path d={stepPath(evo.best)} fill="none" pathLength={100} className="stroke-ink-800 evo-line-draw" strokeWidth={2} />
					</g>
					{gate && <text x={PAD_L + 4} y={y(gate.value) + 11} className="fill-ember-700 text-nano font-medium" stroke="rgb(var(--card-rgb))" strokeWidth={3} paintOrder="stroke">{gateLineWords(gate, fmt(gate.value))}</text>}
					{tgt != null && <text x={W - PAD_R - 4} y={y(tgt) - 5} textAnchor="end" className="fill-lagoon-700 text-nano font-medium" stroke="rgb(var(--card-rgb))" strokeWidth={3} paintOrder="stroke">{targetLineWords(fmt(tgt))}</text>}
					{/* Where each version first took the lead: a mark on the line and its
					    NAME beside it, haloed so the line never cuts through it, cut with
					    an ellipsis when it won't fit (the full name is the tooltip). */}
					{takeovers.map((s, i) => (
						<g key={i}>
							<circle cx={x(ax.stepPos(s))} cy={y(s.value)} r={2.5} className="fill-ink-800" />
							<text x={labels[i].x} y={labels[i].y} textAnchor={labels[i].anchor} className="fill-ink-900 text-nano font-semibold" stroke="rgb(var(--card-rgb))" strokeWidth={3} paintOrder="stroke">
								<title>{labels[i].full}</title>{labels[i].text}
							</text>
						</g>
					))}
					{ax.showNow && (
						<>
							<line x1={x(ax.p1)} x2={x(ax.p1)} y1={PAD_T} y2={H - PAD_B} className="stroke-ink-300" strokeWidth={1} strokeDasharray="2 3" />
							<text x={x(ax.p1)} y={H - 6} textAnchor="end" className="fill-ink-600 text-nano">{ax.end}</text>
						</>
					)}
					{hoverP != null && <line x1={x(hoverP)} x2={x(hoverP)} y1={PAD_T} y2={H - PAD_B} className="stroke-ink-300" strokeWidth={1} />}
				</svg>
				{at && hoverP != null && (
					<div className="pointer-events-none absolute top-1 rounded-lg border border-ink-200 bg-card px-2 py-1.5 shadow-e2 text-micro space-y-0.5"
						style={x(hoverP) / W > 0.5 ? { right: `${100 - (x(hoverP) / W) * 100 + 1}%` } : { left: `${(x(hoverP) / W) * 100 + 1}%` }}>
						<div className="font-medium text-ink-800">{hoverHead}</div>
						<div className="text-ink-700">Best so far: {at.b ? `${fmt(at.b.value)} · ${labelOf(at.b.arm)}` : "none counted yet"}</div>
						{evo.chain.filter((c) => at.m.has(c.arm)).map((c) => (
							<div key={c.arm} className="flex items-center gap-1.5 whitespace-nowrap">
								<span className={cn("w-2 h-2 rounded-sm", FILL[colorOf(c.arm) % 8].replace("fill-", "bg-"))} />
								<span className="text-ink-700">{labelOf(c.arm)}</span>
								<span className="ml-auto pl-2 tabular-nums text-ink-900">{fmt(at.m.get(c.arm)!.mean)} · {at.m.get(c.arm)!.n}</span>
							</div>
						))}
					</div>
				)}
			</div>
			<ul className="flex items-center gap-x-4 gap-y-1 flex-wrap text-micro text-ink-600" aria-label="How to read it">
				<li className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5 bg-ink-800 rounded-full" /> best so far</li>
				<li className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-gold-500" /> leading, not counted yet</li>
				<li className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-[1px] bg-ink-700" /> a new best</li>
				<li className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-[1px] bg-ink-300" /> other results</li>
			</ul>
		</figure>
	);
}

// Kept here for existing importers; the axis rules live in lib/evolution-axis.
export { niceTicks };
