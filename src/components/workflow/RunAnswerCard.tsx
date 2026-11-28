// RunAnswerCard — the top of the run page: did it work, what did it find, and
// if not, why — before any step, log or JSON. ONE verdict per run page: the
// header chip, this card and the step timeline all say the same outcome.
//
//   Succeeded in 4s · Meets every performance constraint
//   [Energy 0.37 J per token] [TTFT p99 364.5 ms] [Completion rate 100%] …
//
//   Didn't run · Not measured on a GPU: your daily budget … · Try again after 4:24 PM
//   Stopped after Simulate · Missed TTFT p99 (2,173.1 ms > 2,000 ms); Sandbox held (not run)
//   Failed after 1m 02s · Server error (HTTP 500)       [Diagnose in chat]
//
// Pure logic in lib/run-answer.ts, lib/run-agreement.ts and lib/run-tables.ts
// (tested against real cycles).

import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Ban, CheckCircle2, ChevronRight, CircleDashed, MessagesSquare, PauseCircle } from "lucide-react";
import type { MeCycleDetail, MeCycleListItem } from "@/api/me";
import {
	runAnswer, runMetrics, primaryMetricKey, primaryHigherIsBetter, runExperiment, vsUsual, fmtMetricValue, runLimits, measuredOn,
	runGate, gateBasis, gateWords, gateMissing, beforeAfter, isCountKey, sameVersionRuns,
} from "@/lib/run-answer";
import { runTables, visibleRows, type RunTable } from "@/lib/run-tables";
import { humanId } from "@/lib/research-map";
import MetricReveal from "@/components/workflow/MetricReveal";
import { triageFailure } from "@/lib/failure-triage";
import { runAgreement, runUsage, nothingMeasured } from "@/lib/run-agreement";
import { runDiscardTarget } from "@/lib/discard";
import { DiscardRun } from "@/components/research/DiscardResults";
import { useRunContext, type RunContext } from "@/hooks/useRunContext";
import { cn } from "@/lib/utils";
import { WorkingDots } from "@/components/activity/ActivityView";

function keyMetricOf(c: MeCycleListItem, name: string): number | undefined {
	const km = c.key_metric;
	if (typeof km === "number") return km;
	if (km && typeof km === "object" && typeof km.value === "number" && (!km.name || km.name === name || km.name === "objective")) return km.value;
	return undefined;
}

function ShowAll({ hidden, total, open, onToggle }: { hidden: number; total: number; open: boolean; onToggle: () => void }) {
	if (!hidden && !open) return null;
	return (
		<button type="button" onClick={onToggle} aria-expanded={open}
			className="mt-1 text-micro text-ink-700 hover:text-ink-900 underline decoration-dotted">
			{open ? "Show fewer" : `Show all ${total}`}
		</button>
	);
}

function RowsTable({ t }: { t: RunTable }) {
	const [all, setAll] = useState(false);
	const v = visibleRows(t.rows, all);
	return (
		<div data-testid="run-table" data-key={t.key}>
			<div className="eyebrow text-ink-600 mb-1">{t.title}</div>
			<div className="overflow-x-auto">
				{/* As wide as its columns need; the card scrolls it sideways rather
				    than squeezing every cell into a word per line. */}
				<table className="min-w-full w-max text-caption tabular-nums">
					<thead>
						<tr className="text-left text-micro text-ink-600">
							{t.columns.map((c) => <th key={c.key} title={c.key} className={cn("py-0.5 pr-3 font-medium whitespace-nowrap", c.numeric && "text-right")}>{c.label}</th>)}
						</tr>
					</thead>
					<tbody>
						{v.rows.map((r, i) => (
							<tr key={i} className="border-t border-ink-100 text-ink-800">
								{r.map((cell, j) => <td key={j} className={cn("py-0.5 pr-3 align-top", t.columns[j].numeric && "text-right", cell.length > 28 ? "min-w-[12rem] max-w-[18rem]" : "whitespace-nowrap", j === 0 && "font-medium text-ink-900")}>{cell}</td>)}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<ShowAll hidden={v.hidden} total={t.rows.length} open={all} onToggle={() => setAll((x) => !x)} />
		</div>
	);
}

export default function RunAnswerCard({ app, loop, runId, detail, listRow, cycles, durationS, context }: {
	app: string; loop: string; runId: string;
	detail: MeCycleDetail | null;
	listRow?: MeCycleListItem | null;
	cycles: MeCycleListItem[];
	durationS?: number;
	/** The app's experiments and gates; fetched when not given (the gallery gives it). */
	context?: RunContext | null;
}) {
	const [showRaw, setShowRaw] = useState(false);
	const [allAgree, setAllAgree] = useState(false);
	const fetched = useRunContext(app, context !== undefined);
	const ctx = context !== undefined ? context : fetched;
	const specGate = ctx?.gates[loop] ?? null;
	const a = runAnswer(detail, { ok: listRow?.ok, running: listRow?.running, durationS, specGate });
	const done = a.tone === "ok" || a.tone === "stopped";
	const experiment = runExperiment(detail, ctx?.experiments);
	const limits = a.tone === "running" ? [] : runLimits(detail);
	const hasCalibrated = limits.some((l) => l.calibrated);
	const gate = runGate(detail, specGate);
	const basis = gateBasis(gate);
	const gateGap = a.tone === "stopped" ? gateMissing(detail) : null;
	const where = measuredOn(detail);
	const cost = a.tone === "running" ? null : runUsage(detail);
	const agreeRaw = done || a.tone === "not_run" ? runAgreement(detail) : null;
	// A table where every measured cell says "not measured" repeats the headline.
	const agree = agreeRaw && !nothingMeasured(agreeRaw) ? agreeRaw : null;
	const agreeRows = agree ? visibleRows(agree.rows, allAgree) : null;
	const metrics = done ? runMetrics(detail, 6, experiment) : a.tone === "failed" || a.tone === "not_run" ? runMetrics(detail, 6, experiment).filter((m) => m.value !== 0) : [];
	const pairs = a.tone === "running" || a.tone === "failed" ? [] : beforeAfter(detail);
	// A run that didn't run measured nothing: its per-item rows are predictions only.
	const tables = a.tone === "running" || a.tone === "not_run" ? [] : runTables(detail);
	const primary = primaryMetricKey(detail, experiment);
	const hib = primaryHigherIsBetter(detail, experiment);
	// History is the same version's runs (a version's own story, not every
	// version's mix), and never for a count: "+133% vs usual" on "N designs"
	// says nothing about how the run did.
	const history = sameVersionRuns(cycles, listRow?.branch_label);
	const usual = (() => {
		if (!primary || !done || isCountKey(primary)) return null;
		const p = metrics.find((m) => m.key === primary);
		if (!p) return null;
		const others = history.filter((c) => c.ts !== runId && c.ok).map((c) => keyMetricOf(c, primary)).filter((v): v is number => v != null);
		return vsUsual(p.value, others, hib);
	})();
	const reveal = (() => {
		if (!primary || !usual || !done) return null;
		const p = metrics.find((m) => m.key === primary);
		if (!p) return null;
		const values = [...history].reverse()
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
	const warn = a.tone === "not_run" || a.tone === "stopped";
	const Icon = a.tone === "failed" ? AlertTriangle : a.tone === "ok" ? CheckCircle2 : a.tone === "not_run" ? Ban : a.tone === "stopped" ? PauseCircle : CircleDashed;
	const expName = experiment ? (experiment.title || humanId(experiment.id)) : null;

	return (
		<section aria-label="What this run did" data-tone={a.tone}
			className={cn("rounded-lg border px-3 py-2.5 space-y-2",
				a.tone === "failed" ? "border-brick-200 bg-brick-50/60" : a.tone === "ok" ? "border-gold-200 bg-gold-50/50" : warn ? "border-ember-200 bg-ember-50/50" : "border-lagoon-200 bg-lagoon-50/50")}>
			<div className="flex items-start gap-2">
				<Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", a.tone === "failed" ? "text-brick-600" : a.tone === "ok" ? "text-gold-600" : warn ? "text-ember-600" : "text-lagoon-600")} aria-hidden />
				<div className="min-w-0 flex-1">
					<div className="text-body font-semibold text-ink-900">
						{a.tone === "running" ? <><span className="lumen-shine">Running</span><WorkingDots /></> : a.headline}
					</div>
					{a.sentence && (
						<div className={cn("text-meta leading-snug", a.tone === "failed" ? "text-brick-800" : "text-ink-700")}>{a.sentence}</div>
					)}
					{a.retry && <div className="text-caption font-medium text-ember-700 mt-0.5" data-testid="run-retry">{a.retry}</div>}
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

			{/* What it was held to comes before the numbers: the limits, met or missed —
			    raw and calibrated side by side when the run reports both. */}
			{limits.length > 0 && (
				<div data-testid="run-limits">
					<div className="eyebrow text-ink-600 mb-1">Limits</div>
					{hasCalibrated ? (
						<div className="overflow-x-auto">
							<table className="w-full text-caption tabular-nums">
								<thead>
									<tr className="text-left text-micro text-ink-600">
										<th className="py-0.5 pr-2 font-medium">Limit</th>
										<th className="py-0.5 pr-2 font-medium text-right">Raw{basis === "raw" ? " (gate)" : ""}</th>
										<th className="py-0.5 font-medium text-right">Calibrated{basis === "calibrated" ? " (gate)" : ""}</th>
									</tr>
								</thead>
								<tbody>
									{limits.map((l) => (
										<tr key={l.label} className="border-t border-ink-100">
											<td className="py-0.5 pr-2"><span className="font-medium text-ink-900">{l.label}</span> <span className="text-ink-600">{l.rule}</span></td>
											<td className={cn("py-0.5 pr-2 text-right whitespace-nowrap", basis === "calibrated" ? "text-ink-600" : "text-ink-800")}>
												{l.observed} <MetWord met={l.met} />
											</td>
											<td className={cn("py-0.5 text-right whitespace-nowrap", basis === "raw" ? "text-ink-600" : "text-ink-800")}>
												{l.calibrated ? <>{l.calibrated.observed} <MetWord met={l.calibrated.met} /></> : "—"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<ul className="space-y-0.5">
							{limits.map((l) => (
								<li key={l.label} className="flex items-center gap-2 text-caption">
									<span className="font-medium text-ink-900">{l.label}</span>
									<span className="text-ink-600">{l.rule}</span>
									<span className="ml-auto tabular-nums text-ink-800">{l.observed}</span>
									<span className="w-14 text-right"><MetWord met={l.met} /></span>
								</li>
							))}
						</ul>
					)}
					{gate && (
						<div className="text-micro text-ink-600 mt-1" data-testid="run-gate">
							Gate: {gateWords(gate)}{hasCalibrated && basis ? ` — it checks the ${basis} numbers` : ""}
							{gateGap && <span className="block text-ember-700">{gateGap.words}.</span>}
						</div>
					)}
				</div>
			)}
			{where && <div className="text-caption text-ink-700"><span className="text-ink-600">Measured on: </span>{where}</div>}
			{cost && <div className="text-caption text-ink-700" data-testid="run-cost"><span className="text-ink-600">What it cost: </span>{cost.words}</div>}
			{pairs.length > 0 && (
				<ul className="space-y-0.5" data-testid="run-before-after">
					{pairs.map((p) => (
						<li key={p.key} className="text-caption">
							<span className="font-medium text-ink-900">{p.label}</span>{" "}
							<span className={cn("tabular-nums", p.better === false ? "text-brick-700" : p.better ? "text-gold-700" : "text-ink-700")}>{p.text}</span>
						</li>
					))}
				</ul>
			)}
			{agree && agreeRows && (
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
								{agreeRows.rows.map((r) => (
									<tr key={r.metric} className="border-t border-ink-100 text-ink-800">
										<td className="py-0.5 pr-2">{r.metric}</td><td className="py-0.5 pr-2">{r.first}</td>
										<td className="py-0.5 pr-2 font-medium text-ink-900">{r.second}</td><td className="py-0.5 text-right">{r.gap}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<ShowAll hidden={agreeRows.hidden} total={agree.rows.length} open={allAgree} onToggle={() => setAllAgree((x) => !x)} />
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
								{isPrimary && expName && m.key === experiment?.metric?.name && (
									<dd className="text-micro text-ink-600 leading-tight" data-testid="run-experiment-metric">Experiment: {expName} · {hib ? "higher" : "lower"} is better</dd>
								)}
								{isPrimary && usual && (
									<dd className={cn("text-micro font-medium value-pop", usual.better ? "text-gold-700" : "text-brick-700")}>{usual.text}</dd>
								)}
							</div>
						);
					})}
				</dl>
			)}
			{/* The key number against this version's last runs: draws in, then the delta pops. */}
			{reveal && <MetricReveal {...reveal} />}
			{/* Every per-item list the run returned (workloads, resamples, models, factors). */}
			{tables.map((tb) => <RowsTable key={tb.key} t={tb} />)}
			{/* Last, on its own row: a quiet control, not part of the result. A run
			    that didn't run has no results to discard. */}
			{a.tone !== "running" && a.tone !== "not_run" && (() => { const tgt = runDiscardTarget(detail); return tgt ? <div className="border-t border-ink-100 pt-2"><DiscardRun app={app} target={tgt} /></div> : null; })()}

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

function MetWord({ met }: { met: boolean | null }) {
	return (
		<span className={cn("text-micro font-medium", met === true ? "text-gold-700" : met === false ? "text-brick-700" : "text-ink-600")}>
			{met === true ? "met" : met === false ? "missed" : "—"}
		</span>
	);
}
