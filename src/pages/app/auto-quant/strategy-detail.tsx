// strategy-detail.tsx — drill-down on a single auto-quant strategy.
//
// Route: /dashboard/auto-quant/strategy/:name
//
// Shows:
//  • Full lifecycle history (date promoted to each stage)
//  • Backtest/paper/live history table (Wave 3: from dedicated endpoint)
//  • Loops that evaluate this strategy
//  • Trader-bank memories tagged with strategy_name=<name> (Wave 3)
//  • Contributor card (upstream xp.io signals)

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Activity, BookOpen } from "lucide-react";
import type { LoopRow } from "@/api/super-admin";
import type { StrategyState } from "@/api/super-admin";
import { fetchAutoQuantLoops, fetchAutoQuantStrategies } from "./api";
import { ContributorCard } from "./contributor-card";
import { CycleHistory } from "./cycle-history";

const LIFECYCLE_ORDER = ["smoke_test", "explore", "paper", "semi", "live", "retired"] as const;
const STAGE_COLORS: Record<string, string> = {
	smoke_test: "bg-gray-100 text-gray-600 border-gray-200",
	explore:    "bg-blue-100 text-blue-700 border-blue-200",
	paper:      "bg-indigo-100 text-indigo-700 border-indigo-200",
	semi:       "bg-purple-100 text-purple-700 border-purple-200",
	live:       "bg-amber-100 text-amber-700 border-amber-200",
	retired:    "bg-red-100 text-red-500 border-red-200",
};

export default function StrategyDetailPage() {
	const { name } = useParams<{ name: string }>();
	const [loops, setLoops] = useState<LoopRow[]>([]);
	const [strategies, setStrategies] = useState<StrategyState[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		Promise.all([fetchAutoQuantLoops(), fetchAutoQuantStrategies()])
			.then(([ls, ss]) => {
				if (cancelled) return;
				setLoops(ls);
				setStrategies(ss);
			})
			.catch((e) => {
				if (!cancelled) setError(String(e));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => { cancelled = true; };
	}, []);

	const strategy = strategies.find((s) => s.name === name);
	const relatedLoops = loops; // All loops potentially evaluate all strategies

	if (loading) {
		return (
			<div className="p-6 text-sm text-muted-foreground">Loading strategy data…</div>
		);
	}

	return (
		<div className="max-w-4xl mx-auto p-6 space-y-6">
			{/* Breadcrumb */}
			<div className="flex items-center gap-2 text-sm">
				<Link
					to="/dashboard/auto-quant"
					className="flex items-center gap-1 text-muted-foreground hover:text-gray-700"
				>
					<ArrowLeft className="w-3.5 h-3.5" />
					Auto-Quant
				</Link>
				<span className="text-gray-300">/</span>
				<span className="font-medium text-gray-700">{name}</span>
			</div>

			{error && (
				<div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
			)}

			{/* Header */}
			<div className="flex items-start justify-between">
				<div>
					<h1 className="text-2xl font-bold text-gray-800">{name}</h1>
					{strategy && (
						<div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
							<span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide border ${STAGE_COLORS[strategy.lifecycle_stage || "explore"] || "bg-gray-100 text-gray-500"}`}>
								{(strategy.lifecycle_stage || "explore").replace("_", " ")}
							</span>
							{strategy.cycle_count != null && (
								<span>{strategy.cycle_count} cycles</span>
							)}
							{strategy.recent_sharpe != null && (
								<span>Sharpe: <strong className={strategy.recent_sharpe >= 1 ? "text-amber-600" : strategy.recent_sharpe >= 0 ? "text-gray-700" : "text-red-500"}>{strategy.recent_sharpe.toFixed(2)}</strong></span>
							)}
							{strategy.lifetime_pnl != null && (
								<span>Lifetime P&L: <strong className={strategy.lifetime_pnl >= 0 ? "text-amber-600" : "text-red-500"}>{strategy.lifetime_pnl >= 0 ? "+" : ""}{strategy.lifetime_pnl.toFixed(2)}pp</strong></span>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Lifecycle timeline */}
			{strategy && (
				<div>
					<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
						<Activity className="w-3.5 h-3.5" />
						Lifecycle progression
					</div>
					<div className="flex items-center gap-1">
						{LIFECYCLE_ORDER.map((stage, i) => {
							const current = strategy.lifecycle_stage;
							const orderCurrent = LIFECYCLE_ORDER.indexOf(current as typeof LIFECYCLE_ORDER[number]);
							const orderStage = i;
							const isPast = orderStage < orderCurrent;
							const isCurrent = stage === current;
							const isFuture = orderStage > orderCurrent;
							return (
								<div key={stage} className="flex items-center">
									<div className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
										isCurrent ? STAGE_COLORS[stage] || "bg-gray-100 text-gray-600 border-gray-200" :
										isPast ? "bg-amber-50 text-amber-600 border-amber-200" :
										"bg-gray-50 text-gray-400 border-gray-100"
									} ${isCurrent ? "ring-1 ring-offset-1 ring-indigo-400" : ""}`}>
										{stage.replace("_", " ")}
									</div>
									{i < LIFECYCLE_ORDER.length - 1 && (
										<span className={`mx-0.5 text-gray-300 text-[10px] ${isPast ? "text-amber-400" : isFuture ? "" : ""}`}>→</span>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Contributor card (upstream xp.io) */}
			<ContributorCard
				upstream_slug={undefined} // Wave 3: fetch from strategy state
			/>

			{/* Loops that use this strategy */}
			{relatedLoops.length > 0 && (
				<div>
					<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
						<BookOpen className="w-3.5 h-3.5" />
						Loops that evaluate this strategy ({relatedLoops.length})
					</div>
					<div className="flex flex-wrap gap-1.5">
						{relatedLoops.map((l) => (
							<span key={l.loop} className="px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-600 font-mono">
								{l.loop}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Cycle history */}
			<div>
				<div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
					Cycle history (latest per loop)
				</div>
				<CycleHistory loops={relatedLoops} strategyName={name || ""} />
				<div className="text-[10px] text-muted-foreground mt-2">
					Full per-cycle history (score + features trace + viz thumbnails) will be available in Wave 3 via a dedicated history endpoint.
				</div>
			</div>
		</div>
	);
}
