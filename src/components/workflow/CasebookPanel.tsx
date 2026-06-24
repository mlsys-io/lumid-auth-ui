// CasebookPanel — the Data tab as a first-class evolving CASEBOOK.
//
// A workflow's Goal (its metrics) is scored on a Data casebook — the eval-set.
// For command-driven (Pattern B) apps like mbb-ai the casebook isn't a bundled
// static file (DatasetExplorer's world); it's a roster of per-case files whose
// scores are mined from each cycle's experiments. This panel renders that
// roster: each case with its latest score + a tiny per-case score-history
// sparkline, plus an "evolution" section (cases added over time / how the
// casebook's metrics moved). Read-only; GET /me/apps/:app/casebook?loop=.
//
// House style mirrors GoalTrend.Sparkline (gold accent, inline-SVG polyline).

import { useEffect, useState } from "react";
import { Layers, TrendingUp, History, Loader2, MoreHorizontal, ArrowUp, ArrowDown, ArrowRight } from "lucide-react";
import {
	fetchCasebook,
	type Casebook,
	type CasebookCase,
	type CasebookMetricEvolution,
} from "@/api/casebook";
import { cn } from "@/lib/utils";

const COLOR = { up: "#B08F45", down: "#e11d48", flat: "#94a3b8" };

const lower = (s: string) => s.toLowerCase();
// Lower-is-better metrics (cost/latency/error) flip the "good" direction.
function betterDown(label: string): boolean {
	return /latency|cost|error|\bms\b|usd|\bfail|regress/.test(lower(label));
}
// Format a score for the chip. Scores in [0,1] read as percentages.
function fmtScore(v: number): string {
	if (v >= -1 && v <= 1) return `${Math.round(v * 100)}%`;
	if (Number.isInteger(v)) return String(v);
	return String(+v.toFixed(3));
}

// Tiny inline-SVG sparkline (mirrors GoalTrend.Sparkline).
function Sparkline({ values, color, w = 56, h = 16 }: { values: number[]; color: string; w?: number; h?: number }) {
	if (values.length < 2) return null;
	const min = Math.min(...values),
		max = Math.max(...values),
		rng = max - min || 1;
	const pts = values.map(
		(v, i) => `${(i / (values.length - 1)) * w},${h - 1 - ((v - min) / rng) * (h - 2)}`,
	);
	const last = pts[pts.length - 1].split(",");
	return (
		<svg width={w} height={h} className="overflow-visible flex-shrink-0" aria-hidden>
			<polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
			<circle cx={last[0]} cy={last[1]} r="1.6" fill={color} />
		</svg>
	);
}

// One case row: label + field chips + latest score + score-history sparkline.
const tsDigits = (s?: string) => (s || "").replace(/\D/g, "");

function CaseRow({ c, atTs, onSelect, onViewData, onContextMenu, selected }: { c: CasebookCase; atTs?: string; onSelect?: () => void; onViewData?: () => void; onContextMenu?: (e: React.MouseEvent) => void; selected?: boolean }) {
	const fullHist = c.score_history ?? [];
	const cut = atTs ? tsDigits(atTs) : "";
	const hist = cut ? fullHist.filter((p) => tsDigits(p.ts) <= cut) : fullHist;
	const values = hist.map((p) => p.score);
	const last = values[values.length - 1];
	// The score AT the selected run (exact ts). When a run didn't score this case
	// we show "not this run" rather than silently repeating the previous run's
	// number — that carry-forward made adjacent runs (e.g. v4/v5) look identical.
	const exact = cut ? fullHist.find((p) => tsDigits(p.ts) === cut)?.score : undefined;
	const runScore = cut ? exact : (typeof c.latest_score === "number" ? c.latest_score : undefined);
	const hasAny = values.length > 0 || typeof c.latest_score === "number";
	const first = values[0];
	const delta = values.length >= 2 ? last - first : 0;
	const good = betterDown(c.label) ? delta < 0 : delta > 0;
	const color = delta === 0 ? COLOR.flat : good ? COLOR.up : COLOR.down;

	// Tone dot — gold above baseline / rose below / slate flat; hollow when this
	// case carries no score, muted-flat when it has history but not for THIS run.
	const dotColor = !hasAny ? "transparent" : runScore === undefined ? COLOR.flat : color;

	return (
		<li
			onClick={onSelect}
			onContextMenu={onContextMenu}
			title="View this case's label → metric mapping log · right-click for actions"
			className={cn(
				"rounded-lg border px-2.5 py-1.5 cursor-pointer transition-colors",
				selected ? "border-gold-300 bg-gold-50/60 ring-1 ring-gold-200" : "border-slate-200/70 bg-white hover:border-gold-200 hover:bg-gold-50/30",
			)}
		>
			<div className="flex items-center gap-2">
				<span
					className={cn("w-2 h-2 rounded-full flex-shrink-0", !hasAny && "border border-slate-300")}
					style={{ background: dotColor }}
					title={!hasAny ? "not yet scored" : runScore === undefined ? "not scored in the selected run" : good ? "above baseline" : delta < 0 ? "below baseline" : "flat"}
				/>
				<span className="text-[12px] font-medium text-slate-700 truncate flex-1" title={c.id}>
					{c.label}
				</span>
				{hasAny ? (
					<>
						{(() => {
							// Trend ARROW (no curve): ↑ value rose · ↓ fell · → flat. Color
							// encodes good/bad (gold/rose), direction encodes the raw move.
							const A = delta > 1e-6 ? ArrowUp : delta < -1e-6 ? ArrowDown : ArrowRight;
							return <A className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} aria-hidden />;
						})()}
						{runScore !== undefined ? (
							/* Scored in the selected run — prominent, clicks through to the
							   per-question provenance (how this % is computed). */
							<button
								type="button"
								onClick={onViewData ? (e) => { e.stopPropagation(); onViewData(); } : undefined}
								title="See how this score is computed (per-question breakdown)"
								className="text-[12px] font-semibold tabular-nums hover:underline decoration-dotted"
								style={{ color }}
							>
								{fmtScore(runScore)}
							</button>
						) : last !== undefined ? (
							/* NOT scored in this run — show its last known score MUTED with a
							   ·prev marker, so adjacent runs stay distinguishable without a
							   wall of "not this run". */
							<span className="flex-shrink-0 tabular-nums text-slate-400" title="carried from a previous run — this case wasn't scored in the selected run">
								<span className="text-[11px]">{fmtScore(last)}</span>
								<span className="text-[9px] ml-0.5">·prev</span>
							</span>
						) : (
							<span className="text-[10px] text-slate-400 italic flex-shrink-0">not yet scored</span>
						)}
					</>
				) : (
					<span className="text-[10px] text-slate-400 italic flex-shrink-0">not yet scored</span>
				)}
				{/* The redundant "view this case's data" icon was removed — the case
				    detail (open it by clicking the score, or ⋯ → View data) already
				    shows the raw case data alongside the trajectory + provenance. */}
				{/* WS-3 — a VISIBLE ⋯ opens the same actions menu as right-click. */}
				{onContextMenu && (
					<button
						type="button"
						onClick={(e) => { e.stopPropagation(); onContextMenu(e); }}
						title="More actions"
						className="flex-shrink-0 text-slate-300 hover:text-slate-700 transition-colors"
					>
						<MoreHorizontal className="w-3.5 h-3.5" />
					</button>
				)}
			</div>
		</li>
	);
}

// The evolution strip: one mini sparkline per metric trajectory.
function MetricEvolution({ series }: { series: CasebookMetricEvolution[] }) {
	if (series.length === 0) return null;
	return (
		<div>
			<div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5 mb-1.5">
				<TrendingUp className="w-3 h-3 text-slate-400" />
				Metric trend
			</div>
			<div className="space-y-1">
				{series.map((s) => {
					const vals = s.points.map((p) => p.v);
					const delta = vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0;
					const good = betterDown(s.metric) ? delta < 0 : delta > 0;
					const color = delta === 0 ? COLOR.flat : good ? COLOR.up : COLOR.down;
					return (
						<div key={s.metric} className="flex items-center gap-2">
							<span className="text-[11px] text-slate-600 flex-1 truncate" title={s.metric}>
								{s.metric}
							</span>
							<Sparkline values={vals} color={color} />
							<span className="text-[11px] tabular-nums" style={{ color }}>
								{fmtScore(vals[vals.length - 1])}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export default function CasebookPanel({ app, loop, atTs, onSelectCase, onViewData, onContextMenuCase, selectedCaseId, onSelectMetrics, metricsSelected, showMetrics = true }: {
	app: string; loop: string; atTs?: string;
	onSelectCase?: (c: { id: string; label: string }) => void;
	onViewData?: (c: { id: string; label: string }) => void;
	// #17 — right-click a case row → the shared run/case context menu (handled
	// by the host, which positions the menu at the cursor).
	onContextMenuCase?: (c: { id: string; label: string }, e: React.MouseEvent) => void;
	selectedCaseId?: string;
	onSelectMetrics?: () => void;
	metricsSelected?: boolean;
	// Hide the in-panel metrics section (the Data tab drops it — metrics live in
	// the panel header chip, not duplicated under the cases).
	showMetrics?: boolean;
}) {
	const [book, setBook] = useState<Casebook | null>(null);

	useEffect(() => {
		let live = true;
		setBook(null);
		fetchCasebook(app, loop)
			.then((b) => { if (live) setBook(b); })
			.catch(() => { if (live) setBook({ app, loop, cases: [], version_history: [], metrics_evolution: [] }); });
		return () => { live = false; };
	}, [app, loop]);

	if (book === null) return <div className="h-16 rounded-lg bg-slate-100 animate-pulse" />;

	const cases = book.cases ?? [];
	const evo = book.metrics_evolution ?? [];
	const versions = (book.version_history ?? []).filter((v) => v.ts || v.note);

	// Empty casebook: the workflow scores on live/external data, not a bundled
	// eval-set — point the user at the trajectory on the right.
	if (cases.length === 0 && evo.length === 0) {
		return (
			<div className="text-xs text-slate-500 leading-relaxed">
				No fixed eval-set — this workflow reads{" "}
				<span className="font-medium text-slate-700">live / external data</span> (market feeds,
				a mailbox, a warehouse). Its metrics are scored on each run's outputs; pick a run in the
				trajectory to see what it produced.
			</div>
		);
	}

	const scored = cases.filter((c) => typeof c.latest_score === "number").length;

	return (
		<div className="space-y-3">
			{/* Roster — the case rows are the table; no section header needed. */}
			<div>
				{/* Denominator header: a partial run scores only some cases, so show
				    "N of <casebook total>" — total is the full casebook size (every
				    case row from the casebook endpoint), scored = rows with a score.
				    Without it, a partial run reads as "nothing". */}
				{cases.length > 0 && (
					<div className="text-[11px] text-slate-400 mb-1.5">
						{scored} of {cases.length} case{cases.length === 1 ? "" : "s"} scored
					</div>
				)}
				{cases.length === 0 ? (
					<div className="flex items-center gap-2 text-[11px] text-slate-400">
						<Loader2 className="w-3.5 h-3.5" />
						No cases on disk yet — scores below come from past runs.
					</div>
				) : (
					<ul className="space-y-1">
						{cases.map((c) => (
							<CaseRow key={c.id} c={c} atTs={atTs} selected={selectedCaseId === c.id}
								onSelect={onSelectCase ? () => onSelectCase({ id: c.id, label: c.label }) : undefined}
								onViewData={onViewData ? () => onViewData({ id: c.id, label: c.label }) : undefined}
								onContextMenu={onContextMenuCase ? (e) => onContextMenuCase({ id: c.id, label: c.label }, e) : undefined} />
						))}
					</ul>
				)}
			</div>

			{/* Metrics — one data entry; opens its curves in the right canvas. */}
			{showMetrics && evo.length > 0 && (
				onSelectMetrics ? (
					<button
						onClick={onSelectMetrics}
						title="View metric trends"
						className={cn(
							"w-full text-left rounded-lg border px-2.5 py-2 cursor-pointer transition-colors flex items-center gap-2",
							metricsSelected ? "border-gold-300 bg-gold-50/60 ring-1 ring-gold-200" : "border-slate-200/70 bg-white hover:border-gold-200 hover:bg-gold-50/30",
						)}
					>
						<TrendingUp className="w-3.5 h-3.5 text-gold-500 flex-shrink-0" />
						<span className="text-[12px] font-medium text-slate-700 flex-1">Metrics</span>
						<span className="text-[10px] text-slate-400">{evo.length} tracked →</span>
					</button>
				) : (
					<MetricEvolution series={evo} />
				)
			)}
		</div>
	);
}
