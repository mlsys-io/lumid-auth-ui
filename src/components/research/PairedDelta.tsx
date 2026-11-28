// PairedDelta — "is this version really better than the baseline, on the same items?"
//
//   Compared on the same questions · Dev
//   ✓ 1 of 3 versions is a real gain at Dev; best Communication: claim first, +3.1
//   Communication: claim first   ├──●──┤        +3.1   Better on 21, worse on 6, same on 72
//   Issue tree: objective     ├───●───┤          +0.8   Not distinguishable from the current harness yet
//   Self-review once      ├──●──┤                −1.9   Worse than the current harness
//                               0
//
// Generic: reads the paired_* metrics a step row carries (lib/paired.ts) —
// questions for a consulting app, workloads for a serving app, windows for a
// backtest. Renders nothing unless some step reports paired_delta.

import { useMemo } from "react";
import type { MeExperimentRow } from "@/api/me";
import type { EvidenceStepSpec } from "@/lib/evidence";
import { pairedHeadline, pairedSteps, pairedWords, type PairedStep } from "@/lib/paired";
import { TONES } from "@/lib/tones";
import { cn } from "@/lib/utils";

const fmt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.abs(v).toFixed(0)}`;

function Forest({ s, label, against }: { s: PairedStep; label: (v: string) => string; against: string }) {
	const span = s.span * 1.1;
	const pos = (v: number) => `${((v + span) / (2 * span)) * 100}%`;
	return (
		<ul className="space-y-2" aria-label={`Change against ${against} at ${s.label}, one row per version`}>
			{s.results.map((r) => {
				const tone = r.verdict === "gain" ? TONES.ok : r.verdict === "loss" ? TONES.failing : TONES.idle;
				const lo = r.low ?? r.delta, hi = r.high ?? r.delta;
				return (
					<li key={r.version} className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(8rem,14rem)_1fr_3.5rem] sm:items-center sm:gap-3">
						<div className="flex min-w-0 items-center gap-1.5 text-caption text-ink-800">
							<tone.Icon className={cn("h-3.5 w-3.5 shrink-0", tone.icon)} aria-hidden />
							<span className="truncate" title={label(r.version)}>{label(r.version)}</span>
						</div>
						<div className="relative h-5" aria-hidden>
							<div className="absolute inset-x-0 top-1/2 h-px bg-ink-100" />
							<div className="absolute top-0 h-5 w-px bg-ink-300" style={{ left: pos(0) }} />
							<div className={cn("absolute top-1/2 h-1 -translate-y-1/2 rounded-full",
								r.verdict === "gain" ? "bg-gold-500" : r.verdict === "loss" ? "bg-brick-500" : "bg-ink-300")}
								style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} />
							<div className={cn("absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card",
								r.verdict === "gain" ? "bg-gold-700" : r.verdict === "loss" ? "bg-brick-700" : "bg-ink-600")}
								style={{ left: pos(r.delta) }} />
						</div>
						<div className={cn("text-caption font-medium tabular-nums sm:text-right", tone.text)}>{fmt(r.delta)}</div>
						<p className="text-micro text-ink-600 sm:col-span-3">{pairedWords(r, against)}</p>
					</li>
				);
			})}
		</ul>
	);
}

export default function PairedDelta({ steps, rows, baseline, label, stepLabel }: {
	steps: EvidenceStepSpec[];
	rows: MeExperimentRow[] | null;
	/** The version everything is compared against (the experiment's baseline). */
	baseline?: string | null;
	/** A version id in words. */
	label: (v: string) => string;
	/** A step id in words; defaults to the id. */
	stepLabel?: (step: string) => string;
}) {
	const all = useMemo(() => (rows ? pairedSteps({ steps, rows, baseline, stepLabel }) : []), [rows, steps, baseline, stepLabel]);
	if (!all.length) return null;
	const against = baseline ? label(baseline) : "the baseline";
	return (
		<section className="space-y-5" aria-label="Compared on the same items" data-testid="paired-delta">
			{all.map((s) => {
				const head = pairedHeadline(s, label, against);
				const tone = TONES[head.tone];
				return (
					<div key={s.step} className="space-y-2">
						<div className="eyebrow">Compared with {against} on the same items · {s.label}</div>
						<p className={cn("flex items-start gap-1.5 text-caption font-medium", tone.text)}>
							<tone.Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone.icon)} aria-hidden />
							{head.text}
						</p>
						<Forest s={s} label={label} against={against} />
						<p className="text-nano text-ink-600">
							The dot is the average change per item; the bar is the range it could plausibly be. A bar that crosses the line at 0 can't be told apart from {against} yet.
						</p>
					</div>
				);
			})}
		</section>
	);
}
