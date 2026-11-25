// MetricReveal — this run's key number against the workflow's recent runs:
// a small line of the last runs (oldest → newest), the workflow's usual value
// dashed, this run's point marked; the line draws in, then "+12% vs usual"
// pops (Novix's paired curves → "×4.2"). Static under reduced motion.

import { cn } from "@/lib/utils";

const W = 260, H = 56, P = 6;

export default function MetricReveal({ values, currentTs, usual, delta, better, format }: {
	values: Array<{ ts: string; v: number }>;
	currentTs: string;
	usual: number;
	delta: string;
	better: boolean;
	format: (v: number) => string;
}) {
	if (values.length < 3) return null;
	const vs = values.map((p) => p.v).concat(usual);
	let lo = Math.min(...vs), hi = Math.max(...vs);
	if (lo === hi) { lo -= 1; hi += 1; }
	const x = (i: number) => P + (i / (values.length - 1)) * (W - 2 * P);
	const y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
	const d = values.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
	const ci = values.findIndex((p) => p.ts === currentTs);
	return (
		<div className="flex items-center gap-3 flex-wrap" aria-label={`This run against the last ${values.length} runs: ${delta}`}>
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[16rem] h-auto" role="img" aria-hidden>
				<line x1={P} x2={W - P} y1={y(usual)} y2={y(usual)} className="stroke-ink-300" strokeWidth={1} strokeDasharray="3 3" />
				<path d={d} fill="none" pathLength={100} strokeWidth={1.5} className="stroke-ink-600 evo-line-draw" strokeLinejoin="round" />
				{ci >= 0 && (
					<circle cx={x(ci)} cy={y(values[ci].v)} r={4} strokeWidth={2}
						className={cn("fill-card evo-dot-in", better ? "stroke-gold-600" : "stroke-brick-600")} style={{ animationDelay: "650ms" }} />
				)}
			</svg>
			<div className="text-micro text-ink-600 leading-tight">
				<div>this run (○) among the last {values.length} runs</div>
				<div><span className="inline-block w-3 border-t border-dashed border-ink-400 align-middle mr-1" />usual {format(usual)}</div>
				<div className={cn("font-medium value-pop-late", better ? "text-gold-700" : "text-brick-700")}>{delta}</div>
			</div>
		</div>
	);
}
