// loops-table.tsx — Tab 2 of /app/auto-quant — loop overview table.
//
// Columns: name, cadence, mode, status, outcome, last fire.

import type { LoopRow } from "@/api/super-admin";

const statusColor = (s: string) => ({
	ok:      "text-green-600",
	never:   "text-gray-400",
	failing: "text-red-600 font-medium",
	stale:   "text-amber-600",
	manual:  "text-gray-500",
}[s] || "text-gray-500");

function fmtAge(ts: number) {
	if (!ts) return "—";
	const age = Math.max(0, Math.floor(Date.now() / 1000 - ts));
	if (age < 60) return `${age}s ago`;
	if (age < 3600) return `${Math.floor(age / 60)}m ago`;
	if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
	return `${Math.floor(age / 86400)}d ago`;
}

export function LoopsTable({ loops }: { loops: LoopRow[] }) {
	if (loops.length === 0) {
		return (
			<div className="rounded border border-dashed border-gray-200 p-8 text-center text-sm text-muted-foreground">
				No loops found for auto-quant. Check that the app is installed and xpcloud.yaml::loops[] is declared.
			</div>
		);
	}
	return (
		<div className="overflow-x-auto rounded border border-gray-200">
			<table className="w-full text-xs">
				<thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-muted-foreground">
					<tr>
						<th className="text-left font-medium py-2 px-3">loop</th>
						<th className="text-left font-medium py-2 px-3">schedule</th>
						<th className="text-left font-medium py-2 px-3">mode</th>
						<th className="text-left font-medium py-2 px-3">status</th>
						<th className="text-left font-medium py-2 px-3">outcome (α / sharpe)</th>
						<th className="text-left font-medium py-2 px-3">last run</th>
					</tr>
				</thead>
				<tbody>
					{loops.map((r) => {
						const alpha = r.outcome?.alpha_pp;
						const sharpe = r.outcome?.sharpe;
						return (
							<tr key={r.loop} className="border-t border-gray-100 hover:bg-gray-50">
								<td className="py-2 px-3 font-mono text-gray-800">{r.loop}</td>
								<td className="py-2 px-3 text-gray-500">{r.schedule || "—"}</td>
								<td className="py-2 px-3 text-gray-500">{r.mode || "—"}</td>
								<td className={`py-2 px-3 ${statusColor(r.status)}`}>
									{r.status}
									{r.consecutive_failures > 0 && (
										<span className="ml-1 text-[10px] text-red-500">
											(×{r.consecutive_failures})
										</span>
									)}
								</td>
								<td className="py-2 px-3">
									{alpha != null ? (
										<span className={alpha >= 0 ? "text-green-600" : "text-red-500"}>
											{alpha >= 0 ? "+" : ""}{alpha.toFixed(2)}pp
											{r.outcome?.benchmark && (
												<span className="text-gray-400 ml-1 text-[10px]">
													vs {r.outcome.benchmark}
												</span>
											)}
										</span>
									) : "—"}
									{sharpe != null && (
										<span className="ml-2 text-gray-500">S:{sharpe.toFixed(2)}</span>
									)}
								</td>
								<td className="py-2 px-3 text-gray-500">{fmtAge(r.last_run_ts)}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
