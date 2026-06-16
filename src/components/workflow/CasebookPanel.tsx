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
import { Layers, TrendingUp, History, Loader2 } from "lucide-react";
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

function CaseRow({ c, atTs, onSelect, selected }: { c: CasebookCase; atTs?: string; onSelect?: () => void; selected?: boolean }) {
	const fullHist = c.score_history ?? [];
	// Version-aware: when a trajectory node is selected, show this case's score
	// AS OF that cycle (the latest history point at/before it).
	const cut = atTs ? tsDigits(atTs) : "";
	const hist = cut ? fullHist.filter((p) => tsDigits(p.ts) <= cut) : fullHist;
	const values = hist.map((p) => p.score);
	const last = values[values.length - 1];
	const hasScore = cut ? values.length > 0 : typeof c.latest_score === "number";
	const first = values[0];
	const delta = values.length >= 2 ? last - first : 0;
	const good = betterDown(c.label) ? delta < 0 : delta > 0;
	const color = delta === 0 ? COLOR.flat : good ? COLOR.up : COLOR.down;

	// Succinct tags: drop redundant/noisy keys (title duplicates the label),
	// show the value only (key in the tooltip), cap at 3.
	const HIDE_FIELDS = new Set(["title", "case_id", "id", "version", "year", "q_id", "topic", "question", "name"]);
	const chips = Object.entries(c.fields ?? {})
		.filter(([k, v]) => !HIDE_FIELDS.has(k) && String(v).trim().length > 0 && String(v).length <= 40)
		.slice(0, 3);

	return (
		<li
			onClick={onSelect}
			title="View this case's label → metric mapping log"
			className={cn(
				"rounded-lg border px-2.5 py-2 cursor-pointer transition-colors",
				selected ? "border-gold-300 bg-gold-50/60 ring-1 ring-gold-200" : "border-slate-200/70 bg-white hover:border-gold-200 hover:bg-gold-50/30",
			)}
		>
			<div className="flex items-center gap-2">
				<span className="text-[12px] font-medium text-slate-700 truncate flex-1" title={c.id}>
					{c.label}
				</span>
				{hasScore ? (
					<>
						<Sparkline values={values} color={color} />
						<span className="text-[12px] font-semibold tabular-nums" style={{ color }}>
							{fmtScore((cut ? last : c.latest_score) as number)}
						</span>
					</>
				) : (
					<span className="text-[10px] text-slate-400 italic flex-shrink-0">not yet scored</span>
				)}
			</div>
			{chips.length > 0 && (
				<div className="mt-1 flex flex-nowrap gap-1 overflow-hidden">
					{chips.map(([k, v]) => (
						<span
							key={k}
							className="text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 truncate max-w-[9rem]"
							title={`${k}: ${String(v)}`}
						>
							{String(v).replace(/_/g, " ")}
						</span>
					))}
				</div>
			)}
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

export default function CasebookPanel({ app, loop, atTs, onSelectCase, selectedCaseId }: {
	app: string; loop: string; atTs?: string;
	onSelectCase?: (c: { id: string; label: string }) => void;
	selectedCaseId?: string;
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

	// Empty casebook → the same teaching empty-state as DatasetExplorer (kept in
	// sync deliberately): the workflow scores on live/external data, not a
	// bundled eval-set, so point the user at the Runs tab.
	if (cases.length === 0 && evo.length === 0) {
		return (
			<div className="text-xs text-slate-500 leading-relaxed">
				No static casebook is bundled with this workflow — it reads{" "}
				<span className="font-medium text-slate-700">live / external data</span> (e.g. market
				feeds, your mailbox, a warehouse). Its goal metrics are scored on each run's outputs; open
				the <span className="font-medium text-slate-700">Runs</span> tab to inspect what each run
				saw.
			</div>
		);
	}

	const scored = cases.filter((c) => typeof c.latest_score === "number").length;

	return (
		<div className="space-y-3">
			{/* Roster — the case rows are the table; no section header needed. */}
			<div>
				{cases.length === 0 ? (
					<div className="flex items-center gap-2 text-[11px] text-slate-400">
						<Loader2 className="w-3.5 h-3.5" />
						No cases on disk yet — scores below come from past runs.
					</div>
				) : (
					<ul className="space-y-1">
						{cases.map((c) => (
							<CaseRow key={c.id} c={c} atTs={atTs} selected={selectedCaseId === c.id} onSelect={onSelectCase ? () => onSelectCase({ id: c.id, label: c.label }) : undefined} />
						))}
					</ul>
				)}
			</div>

			{/* Metric evolution */}
			<MetricEvolution series={evo} />

			{/* Version / evolution history */}
			{versions.length > 0 && (
				<div>
					<div className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5 mb-1.5">
						<History className="w-3 h-3 text-slate-400" />
						Evolution
					</div>
					<ul className="space-y-0.5">
						{versions.map((v, i) => (
							<li key={`${v.ts}-${i}`} className="flex items-center gap-2 text-[11px]">
								<span className={cn("text-slate-400 font-mono flex-shrink-0", !v.ts && "italic")}>
									{v.ts ? v.ts.slice(0, 8) : "declared"}
								</span>
								<span className="text-slate-600 flex-1 truncate" title={v.note}>{v.note}</span>
								{v.n_cases > 0 && (
									<span className="text-slate-400 tabular-nums flex-shrink-0">{v.n_cases} cases</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
