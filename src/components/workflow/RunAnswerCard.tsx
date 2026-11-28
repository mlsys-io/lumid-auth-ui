// RunAnswerCard — the top of the run page: did it work, what did it find, and
// if not, why — before any step, log or JSON.
//
//   Succeeded in 4s · Meets every performance constraint
//   [Goodput 22.4 tok/s  +12% vs usual] [TTFT p99 709.7 ms] [VRAM peak 12.49 GiB] …
//
//   Failed after 1m 02s · Server error (HTTP 500)       [Diagnose in chat]
//   › Show the raw error
//
// Replaces the "Outcome: backend_unavailable" strip and the generic "Run
// failed — the last run failed and hasn't recovered yet" card. Pure logic in
// lib/run-answer.ts (tested against real cycles).

import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, CircleDashed, MessagesSquare } from "lucide-react";
import type { MeCycleDetail, MeCycleListItem } from "@/api/me";
import { runAnswer, runMetrics, primaryMetricKey, vsUsual, fmtMetricValue, runLimits, measuredOn } from "@/lib/run-answer";
import MetricReveal from "@/components/workflow/MetricReveal";
import { triageFailure } from "@/lib/failure-triage";
import { runAgreement, runUsage } from "@/lib/run-agreement";
import { runDiscardTarget } from "@/lib/discard";
import { DiscardRun } from "@/components/research/DiscardResults";
import { cn } from "@/lib/utils";
import { WorkingDots } from "@/components/activity/ActivityView";

function keyMetricOf(c: MeCycleListItem, name: string): number | undefined {
	const km = c.key_metric;
	if (typeof km === "number") return km;
	if (km && typeof km === "object" && typeof km.value === "number" && (!km.name || km.name === name || km.name === "objective")) return km.value;
	return undefined;
}

export default function RunAnswerCard({ app, loop, runId, detail, listRow, cycles, durationS }: {
	app: string; loop: string; runId: string;
	detail: MeCycleDetail | null;
	listRow?: MeCycleListItem | null;
	cycles: MeCycleListItem[];
	durationS?: number;
}) {
	const [showRaw, setShowRaw] = useState(false);
	const a = runAnswer(detail, { ok: listRow?.ok, running: listRow?.running, durationS });
	const limits = a.tone === "running" ? [] : runLimits(detail);
	const where = measuredOn(detail);
	const cost = a.tone === "running" ? null : runUsage(detail);
	const agree = a.tone === "ok" ? runAgreement(detail) : null;
	const metrics = a.tone === "ok" ? runMetrics(detail, 6) : a.tone === "failed" ? runMetrics(detail, 6).filter((m) => m.value !== 0) : [];
	const primary = primaryMetricKey(detail);
	const hib = ((detail?.summary as Record<string, unknown> | undefined)?.assets_used as { metric?: { higher_is_better?: boolean } } | undefined)?.metric?.higher_is_better !== false;
	const usual = (() => {
		if (!primary || a.tone !== "ok") return null;
		const p = metrics.find((m) => m.key === primary);
		if (!p) return null;
		const others = cycles.filter((c) => c.ts !== runId && c.ok).map((c) => keyMetricOf(c, primary)).filter((v): v is number => v != null);
		return vsUsual(p.value, others, hib);
	})();
	const reveal = (() => {
		if (!primary || !usual || a.tone !== "ok") return null;
		const p = metrics.find((m) => m.key === primary);
		if (!p) return null;
		const values = [...cycles].reverse()
			.map((c) => ({ ts: c.ts, v: c.ts === runId ? p.value : (c.ok ? keyMetricOf(c, primary) : undefined) }))
			.filter((x): x is { ts: string; v: number } => x.v != null)
			.slice(-24);
		const sorted = values.filter((x) => x.ts !== runId).map((x) => x.v).sort((a2, b2) => a2 - b2);
		if (sorted.length < 3) return null;
		return { values, currentTs: runId, usual: sorted[Math.floor(sorted.length / 2)], delta: usual.text, better: usual.better,
			format: (v: number) => fmtMetricValue(v, p.unit, p.key) };
	})();
	const t = a.tone === "failed" ? triageFailure(a.raw || a.sentence, app, loop) : null;
	// The generic triage ("Run failed — hasn't recovered yet") repeats the
	// headline; only a SPECIFIC triage (Connect Google, quota…) adds a fact.
	const triageAddsFact = t && t.kind !== "unknown";

	if (a.tone === "unknown" && !detail) return null;
	const Icon = a.tone === "failed" ? AlertTriangle : a.tone === "ok" ? CheckCircle2 : CircleDashed;

	return (
		<section aria-label="What this run did"
			className={cn("rounded-lg border px-3 py-2.5 space-y-2",
				a.tone === "failed" ? "border-brick-200 bg-brick-50/60" : a.tone === "ok" ? "border-gold-200 bg-gold-50/50" : "border-lagoon-200 bg-lagoon-50/50")}>
			<div className="flex items-start gap-2">
				<Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", a.tone === "failed" ? "text-brick-600" : a.tone === "ok" ? "text-gold-600" : "text-lagoon-600")} aria-hidden />
				<div className="min-w-0 flex-1">
					<div className="text-body font-semibold text-ink-900">
						{a.tone === "running" ? <><span className="lumen-shine">Running</span><WorkingDots /></> : a.headline}
					</div>
					{a.sentence && (
						<div className={cn("text-meta leading-snug", a.tone === "failed" ? "text-brick-800" : "text-ink-700")}>{a.sentence}</div>
					)}
					{triageAddsFact && <div className="text-caption text-ink-700 mt-0.5">{t!.explanation}</div>}
				</div>
				{t?.cta && (t.cta.to ? (
					<Link to={t.cta.to} className="inline-flex items-center gap-1 px-2.5 py-1 text-micro font-medium rounded-lg bg-brick-600 text-white hover:bg-brick-700 flex-shrink-0">
						{t.cta.label} <ArrowRight className="w-3 h-3" />
					</Link>
				) : (
					<button type="button"
						onClick={() => window.dispatchEvent(new CustomEvent("studio:ask", { detail: { prompt: t.cta!.ask, context: { app, loop, cycle: { app, loop, ts: runId } } } }))}
						className="inline-flex items-center gap-1 px-2.5 py-1 text-micro font-medium rounded-lg bg-brick-600 text-white hover:bg-brick-700 flex-shrink-0">
						<MessagesSquare className="w-3 h-3" /> {t.cta.label}
					</button>
				))}
			</div>

			{/* What it was held to comes before the numbers: the limits, met or missed. */}
			{limits.length > 0 && (
				<div>
					<div className="eyebrow text-ink-600 mb-1">Limits</div>
					<ul className="space-y-0.5">
						{limits.map((l) => (
							<li key={l.label} className="flex items-center gap-2 text-caption">
								<span className="font-medium text-ink-900">{l.label}</span>
								<span className="text-ink-600">{l.rule}</span>
								<span className="ml-auto tabular-nums text-ink-800">{l.observed}</span>
								<span className={cn("w-14 text-right text-micro font-medium", l.met === true ? "text-gold-700" : l.met === false ? "text-brick-700" : "text-ink-600")}>
									{l.met === true ? "met" : l.met === false ? "missed" : "—"}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
			{where && <div className="text-caption text-ink-700"><span className="text-ink-600">Measured on: </span>{where}</div>}
			{cost && <div className="text-caption text-ink-700" data-testid="run-cost"><span className="text-ink-600">What it cost: </span>{cost.words}</div>}
			{agree && (
				<div data-testid="run-agreement">
					<div className="eyebrow text-ink-600 mb-1">{agree.firstLabel} vs {agree.secondLabel.toLowerCase()}</div>
					<div className="text-caption text-ink-700 mb-1">{agree.headline}</div>
					<div className="overflow-x-auto">
						<table className="w-full text-caption tabular-nums">
							<thead>
								<tr className="text-left text-micro text-ink-600">
									<th className="py-0.5 pr-2 font-medium">Number</th>
									<th className="py-0.5 pr-2 font-medium">{agree.firstLabel}</th>
									<th className="py-0.5 pr-2 font-medium">{agree.secondLabel}</th>
									<th className="py-0.5 font-medium text-right">Gap</th>
								</tr>
							</thead>
							<tbody>
								{agree.rows.slice(0, 8).map((r) => (
									<tr key={r.metric} className="border-t border-ink-100 text-ink-800">
										<td className="py-0.5 pr-2">{r.metric}</td><td className="py-0.5 pr-2">{r.first}</td>
										<td className="py-0.5 pr-2 font-medium text-ink-900">{r.second}</td><td className="py-0.5 text-right">{r.gap}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{metrics.length > 0 && (
				<dl className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
					{metrics.map((m) => {
						const isPrimary = m.key === primary;
						return (
							<div key={m.key} title={m.key}
								className={cn("rounded-md border bg-card px-2 py-1.5 min-w-0", isPrimary ? "border-gold-300" : "border-ink-200")}>
								<dt className="text-micro text-ink-600 leading-tight">{m.label}</dt>
								<dd className={cn("tabular-nums text-ink-900 break-words", isPrimary ? "text-read font-semibold" : "text-meta font-medium")}>{m.text}</dd>
								{isPrimary && usual && (
									<dd className={cn("text-micro font-medium value-pop", usual.better ? "text-gold-700" : "text-brick-700")}>{usual.text}</dd>
								)}
							</div>
						);
					})}
				</dl>
			)}
			{/* The key number against the last runs: draws in, then the delta pops. */}
			{reveal && <MetricReveal {...reveal} />}
			{/* Last, on its own row: a quiet control, not part of the result. */}
			{a.tone !== "running" && (() => { const tgt = runDiscardTarget(detail); return tgt ? <div className="border-t border-ink-100 pt-2"><DiscardRun app={app} target={tgt} /></div> : null; })()}

			{a.raw && (
				<div>
					<button type="button" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw}
						className="inline-flex items-center gap-1 text-micro text-ink-600 hover:text-ink-900">
						<ChevronRight className={cn("w-3 h-3 transition-transform", showRaw && "rotate-90")} /> {showRaw ? "Hide" : "Show"} the raw error
					</button>
					{showRaw && (
						<pre className="mt-1 max-h-40 overflow-auto rounded-md border border-brick-200 bg-card p-2 text-micro font-mono text-ink-800 whitespace-pre-wrap break-all">{a.raw}</pre>
					)}
				</div>
			)}
		</section>
	);
}
