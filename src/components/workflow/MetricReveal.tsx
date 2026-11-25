// MetricReveal — this run's key number against the workflow's recent runs.
//
//   +12% vs usual                         this run against its last 7 runs
//   24.1 ┤                     ● 25.0      ← this run, labelled
//        ┤   •───•       •───/
//        ┤╌╌╌╌╌╌╌╌╌•╌╌╌•╌╌╌╌╌╌╌╌ usual 22.4
//   20.3 ┤
//        earlier runs ─────────── this run
//
// One dot per run (hover names it), the usual value dashed and labelled at
// its end, this run larger and labelled; the line draws in, then the change
// pops (Novix's paired curves → "×4.2"). Static under reduced motion.

import { cn } from "@/lib/utils";

/** "25 Nov, 0:06" from a run id (20261125T000600Z…); the id itself otherwise. */
function when(ts: string): string {
	const m = ts.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
	if (!m) return ts;
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const W = 340, H = 92, R = 92, T = 16, B = 18;

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
	if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
	const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
	// The range labels' column is as wide as its longest label (~5.6px a char).
	const ends = [format(hi - pad), format(lo + pad)];
	const L = 10 + Math.max(...ends.map((t) => t.length)) * 5.6;
	const x = (i: number) => L + (i / (values.length - 1)) * (W - L - R);
	const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
	const d = values.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
	const ci = values.findIndex((p) => p.ts === currentTs);
	const tone = better ? "gold" : "brick";
	const same = /^same/i.test(delta);
	return (
		<figure className="space-y-1" aria-label={`This run against its last ${values.length} runs: ${delta}`}>
			<figcaption className="flex items-baseline gap-2">
				<span className={cn("text-caption font-semibold value-pop-late", same ? "text-ink-800" : tone === "gold" ? "text-gold-700" : "text-brick-700")}>{delta}</span>
				<span className="text-micro text-ink-600">this run against its last {values.length} runs</span>
			</figcaption>
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[24rem] h-auto overflow-visible" role="img" aria-hidden>
				{/* y range: the two ends only — enough to read the scale, no grid noise */}
				{[hi - pad, lo + pad].map((v, i) => (
					<g key={i}>
						<line x1={L - 4} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-ink-100" strokeWidth={1} />
						<text x={L - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-600 text-nano tabular-nums">{ends[i]}</text>
					</g>
				))}
				<line x1={L} x2={W - R} y1={y(usual)} y2={y(usual)} className="stroke-ink-400" strokeWidth={1} strokeDasharray="3 3" />
				<text x={W - R + 14} y={y(usual)} dy="0.32em" className="fill-ink-600 text-nano">usual {format(usual)}</text>
				<path d={d} fill="none" pathLength={100} strokeWidth={2} className="stroke-ink-500 evo-line-draw" strokeLinejoin="round" strokeLinecap="round" />
				{values.map((p, i) => i === ci ? null : (
					<circle key={p.ts} cx={x(i)} cy={y(p.v)} r={3} strokeWidth={2} className="fill-ink-500 stroke-card evo-dot-in" style={{ animationDelay: `${120 + i * 60}ms` }}>
						<title>{`${when(p.ts)}: ${format(p.v)}`}</title>
					</circle>
				))}
				{ci >= 0 && (
					<g className="evo-dot-in" style={{ animationDelay: "650ms" }}>
						<circle cx={x(ci)} cy={y(values[ci].v)} r={5.5} strokeWidth={2.5}
							className={cn("fill-card", tone === "gold" ? "stroke-gold-600" : "stroke-brick-600")}>
							<title>{`This run: ${format(values[ci].v)}`}</title>
						</circle>
						<text x={x(ci)} y={y(values[ci].v) - 10} textAnchor={ci === values.length - 1 ? "end" : "middle"}
							className="fill-ink-900 text-nano font-semibold tabular-nums">{format(values[ci].v)}</text>
					</g>
				)}
				<text x={L} y={H - 3} className="fill-ink-600 text-nano">earlier runs</text>
				<text x={W - R} y={H - 3} textAnchor="end" className="fill-ink-600 text-nano">latest</text>
			</svg>
		</figure>
	);
}
