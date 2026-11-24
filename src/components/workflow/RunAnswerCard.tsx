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
import { runAnswer, runMetrics, primaryMetricKey, vsUsual } from "@/lib/run-answer";
import { triageFailure } from "@/lib/failure-triage";
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
