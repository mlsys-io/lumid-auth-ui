// cycle-history.tsx — embedded in strategy-detail.
//
// Lists the last N cycles for a strategy with insight head and viz thumbnails.
// Data sourced from the loop rows' latest_cycle_dir (Wave 3 will add a
// dedicated /api/v1/auto-quant/strategy/:name/history endpoint).

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { LoopRow } from "@/api/super-admin";
import type { StepEditorStep } from "./step-instructions-editor";
import { StepInstructionsEditor } from "./step-instructions-editor";

export interface CycleEntry {
	ts: string;
	loop: string;
	alpha_pp?: number;
	sharpe?: number;
	insight_head?: string;
	cycle_dir?: string;
}

interface CycleHistoryProps {
	/** Derived from the latest loop row — in Wave 3 this will be a richer list. */
	loops: LoopRow[];
	strategyName: string;
}

export function CycleHistory({ loops, strategyName }: CycleHistoryProps) {
	const [openCycle, setOpenCycle] = useState<string | null>(null);

	// Derive cycles from loop outcome data (placeholder until Wave 3 history API)
	const cycles: CycleEntry[] = loops
		.filter((l) => l.latest_cycle_ts)
		.map((l) => ({
			ts: l.latest_cycle_ts!,
			loop: l.loop,
			alpha_pp: l.outcome?.alpha_pp,
			sharpe: l.outcome?.sharpe,
			insight_head: l.outcome?.insight_head,
			cycle_dir: l.latest_cycle_dir,
		}))
		.sort((a, b) => b.ts.localeCompare(a.ts));

	// Build step list from loop steps for the editor
	const stepsByLoop: Record<string, StepEditorStep[]> = {};
	for (const l of loops) {
		stepsByLoop[l.loop] = (l.steps || []).map((s) => ({
			step_id: s.id,
			skill: s.skill,
		}));
	}

	if (cycles.length === 0) {
		return (
			<div className="rounded border border-dashed border-gray-200 p-6 text-center text-xs text-muted-foreground">
				No cycle history yet for strategy <strong>{strategyName}</strong>. Run a cycle first.
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{cycles.map((c) => {
				const key = `${c.loop}:${c.ts}`;
				const isOpen = openCycle === key;
				return (
					<div key={key} className="rounded border border-gray-200 overflow-hidden">
						<button
							type="button"
							className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-left hover:bg-gray-50 transition-colors"
							onClick={() => setOpenCycle(isOpen ? null : key)}
						>
							{isOpen ? (
								<ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
							) : (
								<ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
							)}
							<span className="font-mono text-gray-500 text-[10px]">{c.ts}</span>
							<span className="text-gray-600 font-medium">{c.loop}</span>
							<span className="ml-auto flex items-center gap-3">
								{c.alpha_pp != null && (
									<span className={c.alpha_pp >= 0 ? "text-green-600" : "text-red-500"}>
										{c.alpha_pp >= 0 ? "+" : ""}{c.alpha_pp.toFixed(2)}pp
									</span>
								)}
								{c.sharpe != null && (
									<span className="text-gray-500">S:{c.sharpe.toFixed(2)}</span>
								)}
								{c.cycle_dir && (
									<a
										href={`/dashboard/super-admin/cycle-transcript?dir=${encodeURIComponent(c.cycle_dir)}`}
										target="_blank"
										rel="noreferrer"
										onClick={(e) => e.stopPropagation()}
										className="text-indigo-500 hover:underline flex items-center gap-0.5 text-[10px]"
									>
										<FileText className="w-3 h-3" />
										Transcript
									</a>
								)}
							</span>
						</button>
						{isOpen && (
							<div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-3">
								{c.insight_head && (
									<div>
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
											Insight
										</div>
										<div className="text-xs text-gray-700 italic whitespace-pre-line border-l-2 border-gray-300 pl-2">
											{c.insight_head}
										</div>
									</div>
								)}
								{stepsByLoop[c.loop] && stepsByLoop[c.loop].length > 0 && (
									<div>
										<div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
											Step instructions for next run
										</div>
										<StepInstructionsEditor
											app="auto-quant"
											loop={c.loop}
											steps={stepsByLoop[c.loop]}
										/>
									</div>
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
