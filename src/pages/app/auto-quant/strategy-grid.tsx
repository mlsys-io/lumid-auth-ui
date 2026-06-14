// strategy-grid.tsx — Theme I strategy-grid-first layout for /app/auto-quant
//
// Renders a card grid of auto-quant strategies. Each card shows:
//   • Name + lifecycle stage badge
//   • 30-cycle perf sparkline (SVG)
//   • Last-cycle outcome (α / sharpe)
//   • Promote + Drill-down buttons

import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { StrategyState } from "@/api/super-admin";

// Lifecycle stage ordering for "Promote" gating.
const LIFECYCLE_ORDER = [
	"smoke_test",
	"explore",
	"paper",
	"semi",
	"live",
	"retired",
] as const;
type LifecycleStage = (typeof LIFECYCLE_ORDER)[number] | string;

const STAGE_COLORS: Record<string, string> = {
	smoke_test: "bg-gray-100 text-gray-600",
	explore:    "bg-blue-100 text-blue-700",
	paper:      "bg-indigo-100 text-indigo-700",
	semi:       "bg-purple-100 text-purple-700",
	live:       "bg-gold-100 text-gold-700",
	retired:    "bg-red-100 text-red-500",
};

function StageBadge({ stage }: { stage: LifecycleStage }) {
	const color = STAGE_COLORS[stage] || "bg-gray-100 text-gray-500";
	return (
		<span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${color}`}>
			{stage.replace("_", " ")}
		</span>
	);
}

// Micro sparkline — 30 data points rendered as an SVG path.
// In the current implementation we synthesise a placeholder trace using the
// Sharpe as a hint (real per-cycle history requires a separate Wave 3 endpoint).
function Sparkline({ sharpe }: { sharpe?: number }) {
	const w = 80;
	const h = 24;
	const pts = 30;
	// Generate a synthetic path biased by sharpe for visual hint.
	const seed = (sharpe ?? 0) * 7;
	const ys = Array.from({ length: pts }, (_, i) => {
		const trend = (sharpe ?? 0) * i * 0.5;
		const noise = Math.sin(i * 1.3 + seed) * 3 + Math.cos(i * 2.1 + seed * 0.7) * 2;
		return 12 - trend / pts - noise;
	});
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const rangeY = Math.max(maxY - minY, 1);
	const norm = (y: number) => ((y - minY) / rangeY) * (h - 4) + 2;
	const xStep = w / (pts - 1);
	const d = ys
		.map((y, i) => `${i === 0 ? "M" : "L"}${(i * xStep).toFixed(1)},${norm(y).toFixed(1)}`)
		.join(" ");
	const isPositive = (sharpe ?? 0) >= 0;
	return (
		<svg width={w} height={h} className="overflow-visible">
			<path d={d} fill="none" stroke={isPositive ? "#96773A" : "#ef4444"} strokeWidth={1.5} />
		</svg>
	);
}

function nextStage(stage: LifecycleStage): LifecycleStage | null {
	const idx = LIFECYCLE_ORDER.indexOf(stage as (typeof LIFECYCLE_ORDER)[number]);
	if (idx < 0 || idx >= LIFECYCLE_ORDER.length - 2) return null; // -2: don't promote to "retired"
	return LIFECYCLE_ORDER[idx + 1];
}

export interface StrategyGridProps {
	strategies: StrategyState[];
	onPromote?: (name: string, toStage: string) => void;
}

export function StrategyGrid({ strategies, onPromote }: StrategyGridProps) {
	const navigate = useNavigate();

	if (strategies.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-gray-200 p-12 text-center">
				<p className="text-sm text-muted-foreground mb-1 font-medium">No strategies yet</p>
				<p className="text-xs text-muted-foreground">
					Declare strategies in <code className="bg-gray-100 px-1 rounded">xpcloud.yaml::strategies[]</code> and run a cycle.
				</p>
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
			{strategies.map((s) => {
				const next = nextStage(s.lifecycle_stage || "explore");
				const alpha = s.recent_sharpe;
				const pnl = s.lifetime_pnl;
				return (
					<div
						key={s.name}
						className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-3 hover:border-gray-300 hover:shadow-sm transition-all"
					>
						{/* Header */}
						<div className="flex items-start justify-between gap-2">
							<div>
								<div className="font-semibold text-sm text-gray-800 truncate max-w-[140px]">{s.name}</div>
								<div className="mt-0.5">
									<StageBadge stage={s.lifecycle_stage || "explore"} />
								</div>
							</div>
							{pnl != null && (
								<div className={`text-xs font-medium ${pnl >= 0 ? "text-gold-600" : "text-red-500"} flex items-center gap-0.5 mt-0.5`}>
									{pnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
									{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}pp
								</div>
							)}
						</div>

						{/* Sparkline */}
						<div className="flex items-center justify-between">
							<Sparkline sharpe={s.recent_sharpe} />
							<div className="text-right text-[10px] text-muted-foreground space-y-0.5">
								{s.recent_sharpe != null && (
									<div>
										<span className="text-gray-400">Sharpe </span>
										<span className={`font-mono font-medium ${s.recent_sharpe >= 1 ? "text-gold-600" : s.recent_sharpe >= 0 ? "text-gray-600" : "text-red-500"}`}>
											{s.recent_sharpe.toFixed(2)}
										</span>
									</div>
								)}
								{s.cycle_count != null && (
									<div className="text-gray-400">{s.cycle_count} cycles</div>
								)}
							</div>
						</div>

						{/* No-sharpe empty state */}
						{s.recent_sharpe == null && s.lifetime_pnl == null && (
							<div className="flex items-center gap-1 text-[10px] text-gray-400">
								<Minus className="w-3 h-3" /> No performance data yet
							</div>
						)}

						{/* Actions */}
						<div className="flex gap-2 mt-auto pt-1">
							<Button
								size="sm"
								variant="outline"
								className="flex-1 h-7 text-xs"
								onClick={() => navigate(`/dashboard/auto-quant/strategy/${encodeURIComponent(s.name)}`)}
							>
								Drill down
							</Button>
							{next && (
								<Button
									size="sm"
									className="flex-1 h-7 text-xs"
									onClick={() => onPromote?.(s.name, next)}
								>
									Promote → {next.replace("_", " ")}
								</Button>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
