// BestScoreChart — Novix's "how it evolved" story for an experiment whose
// versions are comparable:
//
//   BEST SO FAR  0.7146  Rewritten · 101 results          ← rolls + gold flash on change
//   ·  ·  ▪ ▪ ▪━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┊ now      ← step line: best counted version
//          - - - - - - - - - - - - - - - - - - -┊          ← dashed: leading, not confirmed
//   v1 Current version → v2 Rewritten                       ← the version chain (VersionChain)
//
// Logic in lib/evolution.ts. Colours follow the version in declared order
// (chart-1…); the step and frontier lines are ink/gold so they read as "the
// story" over the per-version dots.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Evolution } from "@/lib/evolution";
import { fmtMetricValue } from "@/lib/run-answer";
import { cn } from "@/lib/utils";
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

export default function BestScoreChart({ evo, labelOf, colorOf, metricKey, unit, higherIsBetter, minSamples, target }: {
	evo: Evolution;
	labelOf: (arm: string) => string;
	colorOf: (arm: string) => number;
	metricKey: string; unit: string; higherIsBetter: boolean; minSamples: number;
	/** The value the research is aiming for (experiment metric.target), drawn as a labelled line. */
	target?: number | null;
}) {
	const fmt = (v: number) => fmtMetricValue(v, unit, metricKey);
	const clipId = `bs-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const svgRef = useRef<SVGSVGElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const W = useMeasuredWidth(wrapRef, W0);
	const [hoverT, setHoverT] = useState<number | null>(null);

	// "now": stretch the axis to today when the last result is recent, so the
	// step line visibly reaches the present (Novix's extending cursor).
	const now = Date.now();
	const tEnd = now - evo.t1 < 7 * 86_400_000 ? Math.max(evo.t1, now) : evo.t1;
	const dom = useMemo(() => {
		// Ignore each version's first two averages for the y-range: an average
		// of one or two results swings and would set the scale for everything.
		const seen = new Map<string, number>();
		const vs: number[] = [];
		for (const p of evo.points) { const k = (seen.get(p.arm) ?? 0) + 1; seen.set(p.arm, k); if (k > 2 || p.counted) vs.push(p.mean); }
		if (!vs.length) vs.push(...evo.points.map((p) => p.mean));
		if (target != null && Number.isFinite(target)) vs.push(target);
		let v0 = Math.min(...vs), v1 = Math.max(...vs);
		const pad = (v1 - v0) * 0.15 || Math.abs(v1) * 0.1 || 1;
		v0 -= pad; v1 += pad;
		return { v0, v1, t0: evo.t0, t1: tEnd === evo.t0 ? evo.t0 + 1 : tEnd };
	}, [evo, tEnd, target]);
	const ticks = [dom.v0 + (dom.v1 - dom.v0) * 0.1, (dom.v0 + dom.v1) / 2, dom.v1 - (dom.v1 - dom.v0) * 0.1];
	const PAD_L = Math.max(40, Math.max(...ticks.map((v) => fmt(v).length)) * 6 + 10);
	const x = (t: number) => PAD_L + ((t - dom.t0) / (dom.t1 - dom.t0)) * (W - PAD_L - PAD_R);
	const y = (v: number) => PAD_T + (1 - (Math.max(dom.v0, Math.min(dom.v1, v)) - dom.v0) / (dom.v1 - dom.v0)) * (H - PAD_T - PAD_B);
	const stepPath = (pts: Array<{ t: number; value: number }>) => {
		if (!pts.length) return "";
		let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].value).toFixed(1)}`;
		for (let i = 1; i < pts.length; i++) d += `H${x(pts[i].t).toFixed(1)}V${y(pts[i].value).toFixed(1)}`;
		return d + `H${x(dom.t1).toFixed(1)}`;
	};
	// Label each moment the best counted version CHANGES (Novix's v1, v3, v5).
	// Each version is labelled once — where it FIRST took the lead. Labelling
	// every flip buried the line under "v1v2v1" when two versions trade places.
	const takeovers = evo.best.filter((s, i) => evo.best.findIndex((b) => b.arm === s.arm) === i);
	const indexOf = (arm: string) => (evo.chain.find((c) => c.arm === arm)?.index ?? 0) + 1;

	// Hover: the state of every version at that moment.
	const at = hoverT == null ? null : (() => {
		const m = new Map<string, { mean: number; n: number }>();
		for (const p of evo.points) { if (p.t > hoverT) break; m.set(p.arm, { mean: p.mean, n: p.n }); }
		let b: { arm: string; value: number } | null = null;
		for (const s of evo.best) { if (s.t > hoverT) break; b = s; }
		return { m, b };
	})();
	const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
		const r = svgRef.current?.getBoundingClientRect();
		if (!r) return;
		const px = ((e.clientX - r.left) / r.width) * W;
		setHoverT(Math.max(dom.t0, Math.min(dom.t1, dom.t0 + ((px - PAD_L) / (W - PAD_L - PAD_R)) * (dom.t1 - dom.t0))));
	};

	return (
		<figure className="space-y-2">
			<div className="flex items-start gap-3 flex-wrap">
				<figcaption className="min-w-0 flex-1">
					<div className="text-caption font-medium text-ink-800">How it evolved</div>
					<div className="text-micro text-ink-600">A version counts once it has {minSamples} result{minSamples === 1 ? "" : "s"} · {higherIsBetter ? "higher" : "lower"} is better</div>
				</figcaption>
				<div className="text-right">
					<div className="eyebrow">Best so far</div>
					<div className="font-mono text-h2 leading-none text-ink-900">
						<RollingNumber value={evo.hero?.value ?? null} format={fmt} />
					</div>
					<div className="text-micro text-ink-600 mt-0.5">
						{evo.hero ? `${labelOf(evo.hero.arm)} · ${evo.chain.find((c) => c.arm === evo.hero!.arm)?.n ?? 0} results` : `no version has ${minSamples} results yet`}
					</div>
				</div>
			</div>
			<div ref={wrapRef} className="relative">
				<svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img"
					aria-label={`Best ${metricKey} so far over time, ${evo.hero ? `now ${fmt(evo.hero.value)} by ${labelOf(evo.hero.arm)}` : "no version counted yet"}`}
					onMouseMove={onMove} onMouseLeave={() => setHoverT(null)}>
					<clipPath id={clipId}><rect x={PAD_L} y={PAD_T - 4} width={W - PAD_L - PAD_R + 4} height={H - PAD_T - PAD_B + 8} /></clipPath>
					{ticks.map((v, i) => (
						<g key={i}>
							<line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="stroke-ink-100" strokeWidth={1} />
							<text x={PAD_L - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-600 text-nano tabular-nums">{fmt(v)}</text>
						</g>
					))}
					<text x={PAD_L} y={H - 6} className="fill-ink-600 text-nano">{day(dom.t0)}</text>
					<g clipPath={`url(#${clipId})`}>
						{/* Every result moment: solid once the version counts, faint while collecting. */}
						{evo.points.map((p, i) => (
							<rect key={i} x={x(p.t) - (p.counted ? 2.5 : 2)} y={y(p.mean) - (p.counted ? 2.5 : 2)} width={p.counted ? 5 : 4} height={p.counted ? 5 : 4} rx={1}
								className={cn(FILL[colorOf(p.arm) % 8], "evo-dot-in")} style={{ opacity: p.counted ? 0.85 : 0.3, animationDelay: `${Math.min(1200, i * 4)}ms` }} />
						))}
						<path d={stepPath(evo.frontier)} fill="none" className="stroke-gold-500 evo-dot-in" strokeWidth={1.25} strokeDasharray="4 3" />
						<path d={stepPath(evo.best)} fill="none" pathLength={100} className="stroke-ink-800 evo-line-draw" strokeWidth={2} />
					</g>
					{target != null && Number.isFinite(target) && (
						<g>
							<line x1={PAD_L} x2={W - PAD_R} y1={y(target)} y2={y(target)} className="stroke-lagoon-600" strokeWidth={1.25} strokeDasharray="6 4" />
							<text x={W - PAD_R - 4} y={y(target) - 5} textAnchor="end" className="fill-lagoon-700 text-nano font-medium">target {fmt(target)}</text>
						</g>
					)}
					{takeovers.map((s, i) => (
						<text key={i} x={x(s.t) + 4} y={y(s.value) - 6} className="fill-ink-800 text-nano font-medium">v{indexOf(s.arm)}</text>
					))}
					{/* now */}
					<line x1={x(dom.t1)} x2={x(dom.t1)} y1={PAD_T} y2={H - PAD_B} className="stroke-ink-300" strokeWidth={1} strokeDasharray="2 3" />
					<text x={x(dom.t1)} y={H - 6} textAnchor="end" className="fill-ink-600 text-nano">now</text>
					{hoverT != null && <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD_T} y2={H - PAD_B} className="stroke-ink-300" strokeWidth={1} />}
				</svg>
				{at && hoverT != null && (
					<div className="pointer-events-none absolute top-1 rounded-lg border border-ink-200 bg-card px-2 py-1.5 shadow-e2 text-micro space-y-0.5"
						style={x(hoverT) / W > 0.5 ? { right: `${100 - (x(hoverT) / W) * 100 + 1}%` } : { left: `${(x(hoverT) / W) * 100 + 1}%` }}>
						<div className="font-medium text-ink-800">{day(hoverT)}</div>
						<div className="text-ink-700">Best so far: {at.b ? `${fmt(at.b.value)} · ${labelOf(at.b.arm)}` : "none counted yet"}</div>
						{evo.chain.filter((c) => at.m.has(c.arm)).map((c) => (
							<div key={c.arm} className="flex items-center gap-1.5 whitespace-nowrap">
								<span className={cn("w-2 h-2 rounded-sm", FILL[colorOf(c.arm) % 8].replace("fill-", "bg-"))} />
								<span className="text-ink-700">v{c.index + 1} {labelOf(c.arm)}</span>
								<span className="ml-auto pl-2 tabular-nums text-ink-900">{fmt(at.m.get(c.arm)!.mean)} · {at.m.get(c.arm)!.n}</span>
							</div>
						))}
					</div>
				)}
			</div>
			<ul className="flex items-center gap-x-4 gap-y-1 flex-wrap text-micro text-ink-600" aria-label="How to read it">
				<li className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5 bg-ink-800 rounded-full" /> best so far</li>
				<li className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-gold-500" /> leading, not counted yet</li>
				<li className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-[1px] bg-ink-700" /> average with enough results</li>
				<li className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-[1px] bg-ink-300" /> still collecting</li>
			</ul>
		</figure>
	);
}
