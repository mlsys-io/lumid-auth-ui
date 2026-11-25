// WorkflowInsights — the "insights" half of a workflow's observability.
//
// Reads me.mindWorkflow(slug): a big-number reliability metric + plain-
// English month-over-month deltas (success rate, latency, draft quality)
// computed from the tenant's own run history. Deltas double as the first
// feed of "suggested improvements" ("Reliability up 85%→92%, consider…").
//
// Self-contained (DeltaRow + MiniStat live here) so the workflow panel can
// drop it in without coupling to the /studio/mind page.

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { me, type MeMindStats } from "@/api/me";

type Delta = { headline: string; detail?: string; trend: "up" | "down" | "flat" };
type Report = {
	this_month: MeMindStats;
	prev_month: MeMindStats;
	deltas: Delta[];
};

// Cache mind reports per slug so re-opening a workflow shows insights
// instantly while revalidating in the background.
const mindCache = new Map<string, Report>();

export default function WorkflowInsights({ slug }: { slug: string }) {
	const [state, setState] = useState<Report | "loading" | "error">(() => mindCache.get(slug) ?? "loading");

	useEffect(() => {
		let live = true;
		if (!mindCache.has(slug)) setState("loading");
		me.mindWorkflow(slug)
			.then((r) => { mindCache.set(slug, r as unknown as Report); if (live) setState(r as unknown as Report); })
			.catch(() => { if (live && !mindCache.has(slug)) setState("error"); });
		return () => { live = false; };
	}, [slug]);

	if (state === "loading") {
		return <div className="h-8 rounded-lg lumen-skeleton" />;
	}
	if (state === "error") return null;

	const tm = state.this_month;
	const hasRuns = (tm?.run_count ?? 0) > 0;
	// Nothing to say yet — say nothing (the panel shows its own empty state).
	if (!hasRuns && state.deltas.length === 0) return null;

	// Breakdown that EXPLAINS the headline %: a low rate usually means many
	// no-op cycles (loop ran fine, nothing to do), NOT failures.
	const ok = tm.success_count ?? 0;
	const failed = tm.failure_count ?? 0;
	const skipped = tm.skipped_count ?? Math.max(0, tm.run_count - ok - failed);
	// One scannable sentence instead of a dashboard: the count-up numeral
	// and dot-breakdown were "hard to extract insights" (operator, 2026-06).
	const bits: string[] = [];
	if (hasRuns) {
		bits.push(`${ok} of ${tm.run_count} run${tm.run_count === 1 ? "" : "s"} produced output this month`);
		if (tm.avg_duration_s > 0) bits.push(`avg ${tm.avg_duration_s >= 90 ? Math.round(tm.avg_duration_s / 60) + "m" : tm.avg_duration_s.toFixed(0) + "s"}`);
		if (skipped > 0) bits.push(`${skipped} no-op`);
		if (failed > 0) bits.push(`${failed} failed`);
		if ((tm.drafts_created ?? 0) > 0 && tm.draft_accept_rate != null)
			bits.push(`${Math.round((tm.draft_accept_rate || 0) * 100)}% of ${tm.drafts_created} drafts accepted`);
	}
	return (
		<div className="space-y-2">
			{hasRuns && (
				<div className="text-caption text-ink-600">
					{bits.join(" · ")}
				</div>
			)}
			{state.deltas.length > 0 && (
				<div className="space-y-1.5">
					{state.deltas.slice(0, 3).map((d, i) => <DeltaRow key={i} delta={d} index={i} />)}
				</div>
			)}
		</div>
	);
}

export function DeltaRow({ delta, index = 0 }: { delta: Delta; index?: number }) {
	const Icon = delta.trend === "up" ? TrendingUp : delta.trend === "down" ? TrendingDown : Minus;
	const wrap =
		delta.trend === "up" ? "bg-gold-50/60 border-gold-100 text-gold-900" :
		delta.trend === "down" ? "bg-brick-50 border-brick-100 text-brick-800" :
		"bg-ink-50 border-ink-100 text-ink-700";
	const ic =
		delta.trend === "up" ? "text-gold-600" :
		delta.trend === "down" ? "text-brick-700" :
		"text-ink-600";
	return (
		<div
			className={`flex items-start gap-2 text-xs leading-relaxed rounded-lg px-2.5 py-1.5 border animate-in fade-in slide-in-from-left-2 duration-300 ${wrap}`}
			style={{ animationDelay: `${index * 90}ms`, animationFillMode: "both" }}
		>
			<Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${ic} ${delta.trend === "up" ? "arrow-rise" : ""}`} />
			<div className="min-w-0 flex-1">
				<div>{delta.headline}</div>
				{delta.detail && <div className="text-micro text-ink-600 mt-0.5">{delta.detail}</div>}
			</div>
		</div>
	);
}

function MiniStat({
	label, cur, prev, format, betterIsHigher = true,
}: {
	label: string; cur: number; prev: number;
	format: (v: number) => string; betterIsHigher?: boolean;
}) {
	const diff = cur - prev;
	const sig = Math.abs(diff) > 0.001;
	const better = sig && (betterIsHigher ? diff > 0 : diff < 0);
	const worse = sig && (betterIsHigher ? diff < 0 : diff > 0);
	const trendClass = better ? "text-gold-700" : worse ? "text-brick-700" : "text-ink-600";
	const trendSign = better ? "↑" : worse ? "↓" : "•";
	return (
		<div>
			<div className="text-nano tracking-wider text-ink-600 font-medium">{label}</div>
			<div className="flex items-baseline gap-1.5 mt-0.5">
				<span className="font-mono text-meta text-ink-900 tabular-nums">{format(cur)}</span>
				<span className={`text-nano font-medium ${trendClass}`}>{trendSign} {format(Math.abs(diff))}</span>
			</div>
			<div className="text-nano text-ink-600">was {format(prev)}</div>
		</div>
	);
}

function pct(v: number): string {
	return `${Math.round(v * 100)}%`;
}
