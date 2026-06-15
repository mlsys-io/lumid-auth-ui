// FanoutBranches — when a run fans out into parallel sub-executions (Pattern B
// per-case work, e.g. mbb-ai's command_engine.cycle_results), show each branch
// with its status, expandable to inspect that branch's intermediate data.
// Self-hides for runs that didn't fan out.

import { useState } from "react";
import { ChevronRight, GitFork } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FanoutBranches({ summary }: { summary: Record<string, unknown> }) {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const [open, setOpen] = useState<number | null>(null);
	const ce = (summary as any)?.command_engine;
	if (!ce || typeof ce !== "object") return null;

	// The per-record result list: prefer the canonical cycle_results, else the
	// first array-of-objects field on the engine output with >1 entries.
	let rows: any[] = Array.isArray(ce.cycle_results) ? ce.cycle_results : [];
	if (rows.length < 2) {
		const arr = Object.values(ce).find((v) => Array.isArray(v) && v.length > 1 && typeof v[0] === "object");
		if (Array.isArray(arr)) rows = arr as any[];
	}
	if (rows.length < 2) return null; // not a fan-out

	const labelOf = (r: any, i: number) => String(r?.case_id || r?.id || r?.name || r?.record || r?.symbol || `branch ${i + 1}`);
	const HIDE = new Set(["transcript_html", "out_dir", "case_file", "report_md"]);

	return (
		<div className="shrink-0 rounded-xl border border-slate-200 bg-white">
			<div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-slate-400 font-semibold border-b border-slate-100 flex items-center gap-1.5">
				<GitFork className="w-3 h-3" /> Fan-out · {rows.length} branches
			</div>
			<ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
				{rows.map((r, i) => {
					const ok = r?.ok !== false;
					const isOpen = open === i;
					const fields = Object.entries(r || {}).filter(([k, v]) => !HIDE.has(k) && typeof v !== "object").slice(0, 8);
					return (
						<li key={i}>
							<button onClick={() => setOpen(isOpen ? null : i)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50">
								<ChevronRight className={cn("w-3 h-3 text-slate-400 transition-transform flex-shrink-0", isOpen && "rotate-90")} />
								<span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", ok ? "bg-gold-400" : "bg-rose-500")} />
								<span className="text-[12px] text-slate-700 truncate flex-1">{labelOf(r, i)}</span>
							</button>
							{isOpen && (
								<div className="px-3 pb-2 space-y-0.5">
									{fields.length ? fields.map(([k, v]) => (
										<div key={k} className="flex gap-2 text-[11px]">
											<span className="text-slate-400 flex-shrink-0">{k.replace(/_/g, " ")}</span>
											<span className="text-slate-700 font-mono truncate ml-auto text-right" title={String(v)}>{String(v).slice(0, 100)}</span>
										</div>
									)) : <div className="text-[11px] text-slate-400 italic">No scalar fields recorded for this branch.</div>}
								</div>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
