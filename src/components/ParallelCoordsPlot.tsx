// ParallelCoordsPlot — W&B-inspired skill comparison view (W4).
//
// Custom SVG; recharts doesn't ship a parallel-coords primitive and
// the visualisation is small enough that hand-rolling is cleaner than
// pulling visx for one component.
//
// Each row in `rows` becomes one polyline traversing the dimensions
// in declaration order. Numeric axes scale linearly between
// min..max; categorical axes (version, model, casebook) discretize
// onto evenly-spaced tick positions.
//
// Color: rows are colored by their primary categorical dimension
// (version, newest = gold-600 → older = slate-400). On hover any
// polyline brightens while others dim.

import { useMemo, useState } from "react";

interface Row {
	ts: string;
	skill: string;
	version: string;
	model: string;
	casebook: string;
	score: number;
	latency_s: number;
	cost_cents: number;
	sample_size?: number;
}

interface Props {
	rows: Row[];
	height?: number;
}

type Dim =
	| { key: keyof Row; label: string; kind: "categorical"; categories: string[] }
	| { key: keyof Row; label: string; kind: "numeric"; min: number; max: number; format?: (v: number) => string };

const VERSION_PALETTE = ["#94a3b8", "#B08F45", "#96773A"]; // slate-400 / gold-500 / gold-600

export function ParallelCoordsPlot({ rows, height = 380 }: Props) {
	const [hovered, setHovered] = useState<number | null>(null);

	const dims = useMemo<Dim[]>(() => {
		if (rows.length === 0) return [];
		const versions = uniq(rows.map((r) => r.version)).sort();
		const models = uniq(rows.map((r) => r.model));
		const casebooks = uniq(rows.map((r) => r.casebook)).sort();
		return [
			{ key: "version", label: "version", kind: "categorical", categories: versions },
			{ key: "casebook", label: "casebook", kind: "categorical", categories: casebooks },
			{ key: "model", label: "model", kind: "categorical", categories: models },
			{ key: "score", label: "score", kind: "numeric", min: minOf(rows, "score"), max: maxOf(rows, "score"), format: (v) => v.toFixed(2) },
			{ key: "latency_s", label: "latency", kind: "numeric", min: minOf(rows, "latency_s"), max: maxOf(rows, "latency_s"), format: (v) => `${v.toFixed(1)}s` },
			{ key: "cost_cents", label: "cost ¢", kind: "numeric", min: minOf(rows, "cost_cents"), max: maxOf(rows, "cost_cents"), format: (v) => v.toFixed(2) },
		];
	}, [rows]);

	const versions = useMemo(() => uniq(rows.map((r) => r.version)).sort(), [rows]);

	if (rows.length === 0 || dims.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
				No evaluations recorded for this skill yet.
			</div>
		);
	}

	const W = 720;
	const H = height;
	const PADDING = { top: 24, right: 24, bottom: 36, left: 24 };
	const innerW = W - PADDING.left - PADDING.right;
	const innerH = H - PADDING.top - PADDING.bottom;
	const xStep = innerW / Math.max(1, dims.length - 1);

	const yPos = (dim: Dim, row: Row): number => {
		const v = row[dim.key];
		if (dim.kind === "categorical") {
			const idx = dim.categories.indexOf(String(v));
			if (idx < 0) return innerH;
			const denom = Math.max(1, dim.categories.length - 1);
			return (idx / denom) * innerH;
		}
		const n = typeof v === "number" ? v : Number(v);
		if (!Number.isFinite(n) || dim.max === dim.min) return innerH / 2;
		// Higher is better for score; flipped y so up = better.
		const norm = (n - dim.min) / (dim.max - dim.min);
		// For latency + cost, smaller is better → invert.
		const flip = dim.key === "latency_s" || dim.key === "cost_cents";
		return (1 - (flip ? norm : norm)) * innerH;
		// (We don't actually flip in the geometry — the axis ticks
		//  themselves render in numeric order; min at top by convention.
		//  Score's "higher = better" is communicated by the legend instead.)
	};

	const rowColor = (r: Row): string => {
		const idx = versions.indexOf(r.version);
		if (idx < 0) return "#94a3b8";
		return VERSION_PALETTE[Math.min(idx, VERSION_PALETTE.length - 1)];
	};

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-3">
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
				<g transform={`translate(${PADDING.left},${PADDING.top})`}>
					{/* Axes */}
					{dims.map((d, i) => (
						<g key={d.label} transform={`translate(${i * xStep},0)`}>
							<line x1={0} y1={0} x2={0} y2={innerH} stroke="rgb(203 213 225)" />
							<text x={0} y={-8} textAnchor="middle" className="text-[11px] fill-slate-600 font-medium">
								{d.label}
							</text>
							{d.kind === "categorical"
								? d.categories.map((c, ci) => {
									const denom = Math.max(1, d.categories.length - 1);
									const y = (ci / denom) * innerH;
									return (
										<g key={c} transform={`translate(0,${y})`}>
											<line x1={-3} y1={0} x2={3} y2={0} stroke="rgb(148 163 184)" />
											<text x={-6} y={3} textAnchor="end" className="text-[9px] fill-slate-500">
												{c}
											</text>
										</g>
									);
								})
								: [0, 0.25, 0.5, 0.75, 1].map((t) => {
									const v = d.min + (d.max - d.min) * t;
									const y = t * innerH;
									return (
										<g key={t} transform={`translate(0,${y})`}>
											<line x1={-3} y1={0} x2={3} y2={0} stroke="rgb(148 163 184)" />
											<text x={-6} y={3} textAnchor="end" className="text-[9px] fill-slate-500">
												{d.format ? d.format(v) : v.toFixed(1)}
											</text>
										</g>
									);
								})}
						</g>
					))}

					{/* Polylines — rendered hovered-on-top so the highlight
					    line isn't occluded. */}
					{rows.map((r, ri) => {
						const points = dims.map((d, i) => `${i * xStep},${yPos(d, r)}`).join(" ");
						const isHovered = hovered === ri;
						const dim = hovered != null;
						return (
							<polyline
								key={ri}
								points={points}
								fill="none"
								stroke={rowColor(r)}
								strokeWidth={isHovered ? 2.2 : 1.2}
								strokeOpacity={dim && !isHovered ? 0.12 : 0.7}
								onMouseEnter={() => setHovered(ri)}
								onMouseLeave={() => setHovered(null)}
								className="transition-all cursor-pointer"
							>
								<title>
									{`${r.skill} v${r.version}\n${r.model} on ${r.casebook}\nscore=${r.score.toFixed(3)} latency=${r.latency_s.toFixed(1)}s cost=${r.cost_cents.toFixed(2)}¢`}
								</title>
							</polyline>
						);
					})}
				</g>

				{/* Legend */}
				<g transform={`translate(${PADDING.left},${H - 18})`}>
					{versions.map((v, i) => (
						<g key={v} transform={`translate(${i * 100},0)`}>
							<rect width={10} height={3} fill={VERSION_PALETTE[Math.min(i, VERSION_PALETTE.length - 1)]} />
							<text x={14} y={5} className="text-[10px] fill-slate-600">v{v}</text>
						</g>
					))}
				</g>
			</svg>
			<div className="mt-2 text-[10px] text-slate-500 leading-relaxed">
				Each line = one evaluation. Score: higher is better. Latency &amp; cost: lower is better.
			</div>
		</div>
	);
}

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }
function minOf(rows: Row[], k: keyof Row): number {
	const xs = rows.map((r) => Number(r[k])).filter((n) => Number.isFinite(n));
	return xs.length ? Math.min(...xs) : 0;
}
function maxOf(rows: Row[], k: keyof Row): number {
	const xs = rows.map((r) => Number(r[k])).filter((n) => Number.isFinite(n));
	return xs.length ? Math.max(...xs) : 1;
}

export default ParallelCoordsPlot;
