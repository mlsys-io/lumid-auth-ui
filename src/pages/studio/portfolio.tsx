// /studio/portfolio — the cross-workflow fleet view (P4).
//
// Studio's per-workflow panel frames each workflow as a Goal scored on a Data
// casebook, pursued by Runs that compound learning. This page rolls that up
// across ALL the caller's workflows and answers the portfolio question:
// "how's the fleet doing — health, cost, and learning velocity?"
//
//   • A top strip of fleet totals (workflows, healthy / needs-attention,
//     30d cost, 30d tokens, 30d memories learned).
//   • A sortable table of per-workflow rollups (health dot, last run,
//     30d runs, 30d cost, learning velocity), each row linking to that
//     workflow's detail at /studio/apps/:app?selected=:loop.
//
// Real data only, via fetchPortfolio() (GET /me/portfolio). No chart lib —
// the learning-velocity bar is a lightweight inline SVG.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronDown, ChevronUp, Boxes, Activity, DollarSign, Brain, Cpu, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchPortfolio, type Portfolio, type PortfolioWorkflow, type PortfolioHealth } from "@/api/portfolio";
import { appTitle } from "@/components/workflow/AppCard";
import { loopLabel } from "@/lib/workflow-names";
import { useCountUp } from "@/lib/use-count-up";
import { useStudioRefetch } from "@/hooks/useStudioRefetch";
import { cn } from "@/lib/utils";

// Health → dot color + label. Maps the five-state portfolio health onto the
// same gold/health palette the rest of Studio uses (tones.ts), so a healthy
// workflow reads gold, a failure reads rose, paused/never read slate.
const HEALTH: Record<PortfolioHealth, { dot: string; text: string; label: string }> = {
	healthy:         { dot: "bg-gold-500",  text: "text-gold-700",  label: "Healthy" },
	recovered:       { dot: "bg-gold-400",  text: "text-gold-600",  label: "Recovered" },
	needs_attention: { dot: "bg-rose-500",  text: "text-rose-700",  label: "Needs attention" },
	paused:          { dot: "bg-slate-300", text: "text-slate-500", label: "Paused" },
	never:           { dot: "bg-slate-300", text: "text-slate-500", label: "Never run" },
};

// Relative time from epoch-seconds ("5m ago"); "" when 0. Same idiom as
// apps.tsx / runs.tsx.
function relSec(tsSec?: number): string {
	if (!tsSec) return "";
	const diff = Date.now() / 1000 - tsSec;
	if (diff < 60) return "just now";
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

function fmtUSD(v: number): string {
	if (!v) return "$0";
	if (v < 0.01) return "<$0.01";
	if (v < 100) return `$${v.toFixed(2)}`;
	return `$${Math.round(v).toLocaleString()}`;
}

function fmtCompact(v: number): string {
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
	if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
	return `${Math.round(v)}`;
}

type SortKey = "cost" | "runs" | "learned" | "last_run" | "name";

export default function StudioPortfolio({ embedded = false }: { embedded?: boolean }) {
	const [data, setData] = useState<Portfolio | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [sortKey, setSortKey] = useState<SortKey>("cost");
	const [sortDesc, setSortDesc] = useState(true);

	const load = async () => {
		try {
			const p = await fetchPortfolio();
			setData(p);
			setErr(null);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		}
	};
	useEffect(() => { load(); }, []);
	// Chat→page bus: a run/loop change from chat should refresh the rollup.
	useStudioRefetch(["workflows", "loops", "cycles", "runs"], load);

	const totals = data?.totals;
	const capped = (data?.workflows || []).some((w) => w.scan_capped);

	// Max learning velocity across the fleet → normalizes the inline bars so the
	// busiest learner fills the bar and the rest read proportionally.
	const maxLearned = useMemo(
		() => Math.max(1, ...(data?.workflows || []).map((w) => w.learned_30d)),
		[data],
	);

	const sorted = useMemo(() => {
		const ws = [...(data?.workflows || [])];
		const dir = sortDesc ? -1 : 1;
		ws.sort((a, b) => {
			switch (sortKey) {
				case "cost":     return dir * (a.cost_usd_30d - b.cost_usd_30d);
				case "runs":     return dir * (a.runs_30d - b.runs_30d);
				case "learned":  return dir * (a.learned_30d - b.learned_30d);
				case "last_run": return dir * ((a.last_run_ts || 0) - (b.last_run_ts || 0));
				case "name":     return dir * (`${a.app}${a.loop}`).localeCompare(`${b.app}${b.loop}`);
				default:         return 0;
			}
		});
		return ws;
	}, [data, sortKey, sortDesc]);

	const setSort = (k: SortKey) => {
		if (k === sortKey) setSortDesc((d) => !d);
		else { setSortKey(k); setSortDesc(true); }
	};

	const refresh = () => {
		load();
		toast.success("Fleet refreshed");
	};

	if (data === null && !err) {
		return (
			<div className={cn("w-full space-y-4", !embedded && "max-w-5xl mx-auto px-1 py-2")}>
				<div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
				<div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
			</div>
		);
	}

	return (
		<div className={cn("w-full space-y-5", !embedded && "max-w-5xl mx-auto px-1 py-2")}>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					{embedded ? (
						<div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Boxes className="w-4 h-4 text-gold-500" /> Fleet</div>
					) : (
						<>
							<Link to="/studio/apps" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 gap-1">
								<ChevronLeft className="w-4 h-4" /> My Apps
							</Link>
							<h1 className="text-lg font-semibold text-slate-900 mt-1">Fleet</h1>
						</>
					)}
					<p className="text-[12px] text-slate-400">
						How your workflows are doing across the board — health, cost, and learning over the last 30 days.
					</p>
				</div>
				<button
					type="button" onClick={refresh}
					className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
				>
					<RefreshCw className="w-3.5 h-3.5" /> Refresh
				</button>
			</div>

			{err && (
				<div className="rounded-xl border border-rose-200 bg-rose-50/50 px-4 py-3 text-[12px] text-rose-700 flex items-center gap-2">
					<AlertTriangle className="w-4 h-4 shrink-0" /> Couldn't load the fleet: {err}
				</div>
			)}

			{/* Fleet totals strip */}
			{totals && (
				<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
					<TotalCard icon={Boxes}    value={totals.workflows}        label="workflows" />
					<TotalCard icon={Activity} value={totals.healthy}          label="healthy" tone="text-gold-600" />
					<TotalCard icon={AlertTriangle} value={totals.needs_attention} label="need attention" tone={totals.needs_attention > 0 ? "text-rose-600" : "text-slate-400"} />
					<TotalCard icon={DollarSign} value={totals.cost_usd_30d}   label="30d cost" money />
					<TotalCard icon={Cpu}      value={totals.total_tokens_30d} label="30d tokens" compact />
					<TotalCard icon={Brain}    value={totals.learned_30d}      label="learned" tone="text-indigo-600" />
				</div>
			)}

			{/* Per-workflow rollup table */}
			{sorted.length === 0 ? (
				<div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center">
					<Boxes className="w-7 h-7 text-slate-300 mx-auto mb-2" />
					<div className="text-[13px] font-medium text-slate-700">No workflows yet</div>
					<p className="text-[12px] text-slate-400 mt-1">
						Set up an app and its workflows will roll up here.
					</p>
					<Link to="/studio/apps" className="inline-block mt-3 text-[12px] font-medium text-gold-700 hover:underline">
						Go to My Apps →
					</Link>
				</div>
			) : (
				<div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
					<table className="w-full text-left">
						<thead>
							<tr className="text-[11px] uppercase tracking-[0.06em] text-slate-400 border-b border-slate-100">
								<th className="px-3 py-2.5 font-medium">
									<SortBtn label="Workflow" active={sortKey === "name"} desc={sortDesc} onClick={() => setSort("name")} />
								</th>
								<th className="px-3 py-2.5 font-medium hidden sm:table-cell">
									<SortBtn label="Last run" active={sortKey === "last_run"} desc={sortDesc} onClick={() => setSort("last_run")} />
								</th>
								<th className="px-3 py-2.5 font-medium text-right">
									<SortBtn label="30d runs" active={sortKey === "runs"} desc={sortDesc} onClick={() => setSort("runs")} right />
								</th>
								<th className="px-3 py-2.5 font-medium text-right">
									<SortBtn label="30d cost" active={sortKey === "cost"} desc={sortDesc} onClick={() => setSort("cost")} right />
								</th>
								<th className="px-3 py-2.5 font-medium">
									<SortBtn label="Learning velocity" active={sortKey === "learned"} desc={sortDesc} onClick={() => setSort("learned")} />
								</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((w) => (
								<WorkflowRow key={`${w.app}:${w.loop}`} w={w} maxLearned={maxLearned} />
							))}
						</tbody>
					</table>
				</div>
			)}

			{capped && (
				<p className="text-[11px] text-slate-400">
					Some very high-frequency workflows scan only their {data?.cycle_scan_cap ?? 30} most-recent
					runs, so their 30-day windows may slightly undercount.
				</p>
			)}
		</div>
	);
}

function TotalCard({
	icon: Icon, value, label, tone = "text-slate-400", money, compact,
}: {
	icon: React.ComponentType<{ className?: string }>;
	value: number; label: string; tone?: string; money?: boolean; compact?: boolean;
}) {
	// Count-up only the raw integer-ish stats; money/compact render formatted.
	const shown = useCountUp(value);
	const display = money ? fmtUSD(value) : compact ? fmtCompact(value) : `${Math.round(shown)}`;
	return (
		<div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
			<div className="flex items-center gap-1.5 text-[11px] text-slate-400">
				<Icon className={cn("w-3.5 h-3.5", tone)} />
				<span className="truncate">{label}</span>
			</div>
			<div className="text-[18px] font-semibold text-slate-900 tabular-nums mt-0.5">{display}</div>
		</div>
	);
}

function SortBtn({
	label, active, desc, onClick, right,
}: {
	label: string; active: boolean; desc: boolean; onClick: () => void; right?: boolean;
}) {
	return (
		<button
			type="button" onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1 hover:text-slate-700 transition-colors",
				right && "flex-row-reverse",
				active && "text-slate-700",
			)}
		>
			{label}
			{active && (desc ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
		</button>
	);
}

function WorkflowRow({ w, maxLearned }: { w: PortfolioWorkflow; maxLearned: number }) {
	const h = HEALTH[w.health] ?? HEALTH.never;
	const href = `/studio/apps/${encodeURIComponent(w.app)}?selected=${encodeURIComponent(w.loop)}`;
	const pct = Math.round((w.learned_30d / maxLearned) * 100);
	return (
		<tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors">
			<td className="px-3 py-2.5">
				<Link to={href} className="group flex items-start gap-2.5 min-w-0">
					<span className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", h.dot)} title={h.label} />
					<span className="min-w-0">
						<span className="block text-[13px] font-medium text-slate-800 group-hover:text-gold-700 truncate transition-colors">
							{loopLabel(undefined, w.loop)}
						</span>
						<span className="block text-[11px] text-slate-400 truncate">
							{appTitle(w.app)}
							{w.label ? ` · ${w.label}` : ""}
						</span>
					</span>
				</Link>
			</td>
			<td className="px-3 py-2.5 hidden sm:table-cell">
				<span className={cn("text-[12px]", w.health === "needs_attention" ? "text-rose-600" : "text-slate-500")}>
					{relSec(w.last_run_ts) || "—"}
				</span>
			</td>
			<td className="px-3 py-2.5 text-right tabular-nums text-[12px] text-slate-600">
				{w.runs_30d || "—"}
			</td>
			<td className="px-3 py-2.5 text-right tabular-nums text-[12px] text-slate-600">
				{w.cost_usd_30d ? fmtUSD(w.cost_usd_30d) : "—"}
			</td>
			<td className="px-3 py-2.5">
				<LearningBar value={w.learned_30d} pct={pct} />
			</td>
		</tr>
	);
}

// LearningBar — a lightweight inline-SVG velocity bar (no chart lib). The fill
// is gold-on-indigo-tinted track to read as "knowledge banked"; the count sits
// to the right.
function LearningBar({ value, pct }: { value: number; pct: number }) {
	return (
		<div className="flex items-center gap-2">
			<svg width="80" height="8" viewBox="0 0 80 8" className="shrink-0" aria-hidden>
				<rect x="0" y="0" width="80" height="8" rx="4" className="fill-indigo-50" />
				{value > 0 && (
					<rect x="0" y="0" width={Math.max(4, (pct / 100) * 80)} height="8" rx="4" className="fill-indigo-400" />
				)}
			</svg>
			<span className="text-[11px] tabular-nums text-slate-500 w-14">
				{value ? `${value} learned` : "—"}
			</span>
		</div>
	);
}
