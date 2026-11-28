// StepAgreement — "Does <cheap step> predict <expensive step>?"
//
//   ⚠ Simulator roughly predicts Sandbox — confirm its top picks at Sandbox
//     Goodput: ranks 6 versions roughly like Sandbox (ρ 0.71); same top pick
//     Simulator reads TTFT p99 1.7× high
//     Meets constraints: 1 said no at Simulator but yes at Sandbox (C16)
//   [scatter: cheap (x) vs expensive (y), one dot per version, y = x line]
//   ▸ The numbers (table)
//
// For any two feedback steps of one experiment that report the same metric.
// Generic: simulator → GPU, backtest → out-of-sample. Logic and words in
// lib/step-agreement.ts; renders nothing until a version reached both steps.

import { useMemo, useRef, useState } from "react";
import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { fmtMetricValue } from "@/lib/run-answer";
import { agreementBasis, agreementHeadline, agreementLines, agreementRows, stepAgreements, type MetricAgreement, type StepAgreement as Agreement } from "@/lib/step-agreement";
import { TONES } from "@/lib/tones";
import { useMeasuredWidth } from "@/hooks/useMeasuredWidth";
import { cn } from "@/lib/utils";

const H = 200, PAD = { l: 74, r: 12, t: 22, b: 36 };

function Scatter({ m, a, label }: { m: MetricAgreement; a: Agreement; label: (v: string) => string }) {
	const wrap = useRef<HTMLDivElement>(null);
	const W = Math.min(420, useMeasuredWidth(wrap, 360));
	const [hover, setHover] = useState<number | null>(null);
	const xs = m.pairs.map((p) => p.cheap), ys = m.pairs.map((p) => p.expensive);
	const lo = Math.min(...xs, ...ys), hi = Math.max(...xs, ...ys);
	const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1;
	const step = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, hi - lo + 2 * pad)))) / 2;
	const d0 = Math.max(lo >= 0 ? 0 : -Infinity, Math.floor((lo - pad) / step) * step), d1 = Math.ceil((hi + pad) / step) * step;
	const x = (v: number) => PAD.l + ((v - d0) / (d1 - d0)) * (W - PAD.l - PAD.r);
	const y = (v: number) => PAD.t + (1 - (v - d0) / (d1 - d0)) * (H - PAD.t - PAD.b);
	const fmt = (v: number) => fmtMetricValue(v, m.unit, m.metric);
	const h = hover == null ? null : m.pairs[hover];
	return (
		<div ref={wrap} className="relative">
			<svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img"
				aria-label={`${m.label} at ${a.cheap.label} (across) against ${a.expensive.label} (up), one dot per version; on the diagonal the two agree`}>
				<line x1={x(d0)} y1={y(d0)} x2={x(d1)} y2={y(d1)} className="stroke-ink-200" strokeDasharray="4 3" />
				<text x={x(d1) - 4} y={y(d1) + 12} textAnchor="end" className="fill-ink-500 text-nano">agree</text>
				<line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="stroke-ink-200" />
				<line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="stroke-ink-200" />
				<text x={PAD.l} y={H - PAD.b + 13} className="fill-ink-600 text-nano tabular-nums">{fmt(d0)}</text>
				<text x={W - PAD.r} y={H - PAD.b + 13} textAnchor="end" className="fill-ink-600 text-nano tabular-nums">{fmt(d1)}</text>
				<text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" className="fill-ink-700 text-nano font-medium">{a.cheap.label} →</text>
				<text x={PAD.l - 6} y={PAD.t + 4} textAnchor="end" className="fill-ink-600 text-nano tabular-nums">{fmt(d1)}</text>
				<text x={PAD.l - 6} y={H - PAD.b} textAnchor="end" className="fill-ink-600 text-nano tabular-nums">{fmt(d0)}</text>
				<text x={PAD.l} y={10} className="fill-ink-700 text-nano font-medium">↑ {a.expensive.label}</text>
				{m.pairs.map((p, i) => (
					<circle key={p.version} cx={x(p.cheap)} cy={y(p.expensive)} r={hover === i ? 6 : 4.5}
						className={cn("fill-chart-1 stroke-card cursor-default transition-[r]", hover != null && hover !== i && "opacity-40")} strokeWidth={1.5}
						onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
						<title>{`${label(p.version)}: ${fmt(p.cheap)} at ${a.cheap.label}, ${fmt(p.expensive)} at ${a.expensive.label}`}</title>
					</circle>
				))}
			</svg>
			{h && (
				<div className="pointer-events-none absolute left-14 top-1 rounded-lg border border-ink-200 bg-card px-2 py-1 shadow-e2 text-micro">
					<div className="font-medium text-ink-800">{label(h.version)}</div>
					<div className="text-ink-700">{a.cheap.label}: {fmt(h.cheap)} · {a.expensive.label}: {fmt(h.expensive)}</div>
				</div>
			)}
		</div>
	);
}

export default function StepAgreement({ steps, rows, sameAs, label }: {
	steps: EvidenceStepSpec[];
	rows: MeExperimentRow[] | null;
	sameAs?: Record<string, string>;
	/** A version id in words (the experiment's labels). */
	label: (v: string) => string;
}) {
	const all = useMemo(() => (rows ? stepAgreements({ steps, rows, sameAs }) : []), [rows, steps, sameAs]);
	const [open, setOpen] = useState(false);
	if (!all.length) return null;
	return (
		<section className="space-y-4" aria-label="Does the cheap step predict the next one?" data-testid="step-agreement">
			{all.map((a) => {
				const head = agreementHeadline(a);
				const tone = TONES[head.tone === "ok" ? "ok" : head.tone === "attention" ? "attention" : "idle"];
				// The scatter and the numbers only from 3 shared versions; below that the
				// headline asks for more, and no ratio is listed beside the ask —
				// either the readings or the ask (lib agreementLines). The basis is
				// always said: "from 2 versions measured at both steps".
				const ranked = a.metrics.find((m) => !m.binary && m.pairs.length >= 3);
				const { lines } = agreementLines(a, label);
				return (
					<div key={`${a.cheap.step}>${a.expensive.step}`} className="space-y-2">
						<div className="eyebrow">Does {a.cheap.label} predict {a.expensive.label}?</div>
						<p className={cn("flex items-start gap-1.5 text-caption font-medium", tone.text)}>
							<tone.Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone.icon)} aria-hidden />
							<span>{head.text} <span className="font-normal text-ink-600">({agreementBasis(a)})</span></span>
						</p>
						{!!lines.length && (
							<ul className="space-y-0.5 text-micro text-ink-700">
								{lines.map((l, i) => <li key={i}>{l}</li>)}
							</ul>
						)}
						{ranked && <Scatter m={ranked} a={a} label={label} />}
						{ranked && (
							<div>
								<button type="button" className="text-micro text-ink-600 underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
									{open ? "Hide the numbers" : `Show the numbers (${ranked.n} ${ranked.n === 1 ? "version" : "versions"})`}
								</button>
								{open && (
									<table className="mt-1.5 w-full text-micro tabular-nums">
										<thead>
											<tr className="text-left text-ink-600">
												<th className="py-1 pr-2 font-medium">Version</th>
												<th className="py-1 pr-2 font-medium">{a.cheap.label}</th>
												<th className="py-1 pr-2 font-medium">{a.expensive.label}</th>
												<th className="py-1 font-medium">Gap</th>
											</tr>
										</thead>
										<tbody>
											{agreementRows(ranked, label).map((r) => (
												<tr key={r.version} className="border-t border-ink-100 text-ink-800">
													<td className="py-1 pr-2">{r.version}</td><td className="py-1 pr-2">{r.cheap}</td><td className="py-1 pr-2">{r.expensive}</td><td className="py-1">{r.gap}</td>
												</tr>
											))}
										</tbody>
									</table>
								)}
							</div>
						)}
					</div>
				);
			})}
		</section>
	);
}
