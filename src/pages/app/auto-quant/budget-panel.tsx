// budget-panel.tsx — Tab 3 of /app/auto-quant — LLM budget overview.
//
// Derives a rough daily LLM spend projection from loop cadence metadata.
// A true billing API would surface actual token counts; this panel uses
// a heuristic until Wave 3 integrates live telemetry.

import { DollarSign, Cpu } from "lucide-react";
import type { BudgetProjection } from "./api";

interface BudgetPanelProps {
	budget: BudgetProjection;
	/** Optional cap from xpcloud.yaml::budget (e.g. {daily_usd: 5}) */
	cap?: { daily_usd?: number };
}

export function BudgetPanel({ budget, cap }: BudgetPanelProps) {
	const capUsd = cap?.daily_usd;
	const pctOfCap = capUsd ? Math.min((budget.estimated_daily_usd / capUsd) * 100, 100) : null;
	const overBudget = capUsd != null && budget.estimated_daily_usd > capUsd;

	return (
		<div className="space-y-6">
			{/* Summary strip */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
				<StatCard
					icon={<Cpu className="w-4 h-4" />}
					label="Est. cycles today"
					value={String(budget.estimated_daily_calls)}
				/>
				<StatCard
					icon={<DollarSign className="w-4 h-4" />}
					label="Est. spend today"
					value={`$${budget.estimated_daily_usd.toFixed(2)}`}
					tone={overBudget ? "bad" : "neutral"}
				/>
				<StatCard
					icon={<DollarSign className="w-4 h-4" />}
					label="Est. monthly"
					value={`$${(budget.estimated_daily_usd * 30).toFixed(2)}`}
					sub="×30d"
				/>
				{capUsd != null && (
					<StatCard
						icon={<DollarSign className="w-4 h-4" />}
						label="Daily cap"
						value={`$${capUsd.toFixed(2)}`}
						tone={overBudget ? "bad" : "good"}
					/>
				)}
			</div>

			{/* Cap progress bar */}
			{pctOfCap != null && (
				<div>
					<div className="flex items-center justify-between text-xs mb-1">
						<span className="text-muted-foreground">Daily budget utilisation</span>
						<span className={overBudget ? "text-red-600 font-medium" : "text-gray-600"}>
							{pctOfCap.toFixed(0)}%
						</span>
					</div>
					<div className="h-2 rounded-full bg-gray-100 overflow-hidden">
						<div
							className={`h-full rounded-full transition-all ${overBudget ? "bg-red-500" : "bg-indigo-400"}`}
							style={{ width: `${pctOfCap}%` }}
						/>
					</div>
				</div>
			)}

			{/* Per-loop breakdown */}
			<div>
				<div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
					Per-loop breakdown
				</div>
				<div className="rounded border border-gray-200 overflow-hidden">
					<table className="w-full text-xs">
						<thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-muted-foreground">
							<tr>
								<th className="text-left font-medium py-2 px-3">loop</th>
								<th className="text-right font-medium py-2 px-3">runs today (est.)</th>
								<th className="text-right font-medium py-2 px-3">est. cost today</th>
								<th className="text-right font-medium py-2 px-3">est. monthly</th>
							</tr>
						</thead>
						<tbody>
							{budget.per_loop.map((l) => (
								<tr key={l.loop} className="border-t border-gray-100">
									<td className="py-2 px-3 font-mono text-gray-700">{l.loop}</td>
									<td className="py-2 px-3 text-right text-gray-600">{l.runs_today}</td>
									<td className="py-2 px-3 text-right text-gray-600">${l.estimated_usd.toFixed(2)}</td>
									<td className="py-2 px-3 text-right text-gray-500">${(l.estimated_usd * 30).toFixed(2)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="text-[10px] text-muted-foreground mt-2">
					Cost model: ~2,000 tokens/cycle at $0.015/1k tokens. Actual spend varies by model + prompt length.
					Connect live telemetry in Wave 3 for precise accounting.
				</div>
			</div>
		</div>
	);
}

function StatCard({
	icon,
	label,
	value,
	sub,
	tone = "neutral",
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
	sub?: string;
	tone?: "neutral" | "good" | "bad";
}) {
	const valueColor = tone === "good" ? "text-green-600" : tone === "bad" ? "text-red-600" : "text-gray-800";
	return (
		<div className="rounded border border-gray-200 bg-white p-3">
			<div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase tracking-wide mb-1">
				{icon}
				{label}
			</div>
			<div className={`text-lg font-semibold ${valueColor}`}>
				{value}
				{sub && <span className="text-xs font-normal text-gray-400 ml-1">{sub}</span>}
			</div>
		</div>
	);
}
