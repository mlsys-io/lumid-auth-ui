// CaseMapping — the explicit view of the data↔metric MAPPING for one case.
//
// A workflow's run produces a labeling/scoring of a case (e.g. an AI labels
// the case, then a metric is computed on that labeling). This shows the LOG of
// those mappings for the selected case — every record the loop wrote for it,
// newest first, with the metric values and the run it came from. The record
// matching the currently-pinned version is highlighted. Shown in the right
// canvas when a case is clicked; Back returns to the trajectory.

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, FileText, Clock } from "lucide-react";
import { fetchCaseLog, type CaseLogRecord } from "@/api/casebook";
import { cn } from "@/lib/utils";

function fmtWhen(ts?: string): string {
	if (!ts) return "—";
	let m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
	m = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
	if (m) return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
	return ts;
}
const tsDigits = (s?: string) => (s || "").replace(/\D/g, "");
const numFmt = (v: unknown) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(+v.toFixed(3))) : String(v));

export default function CaseMapping({ app, loop, caseId, caseLabel, atTs, onBack }: {
	app: string; loop: string; caseId: string; caseLabel: string; atTs?: string; onBack: () => void;
}) {
	const [records, setRecords] = useState<CaseLogRecord[] | null>(null);
	useEffect(() => {
		let live = true;
		setRecords(null);
		fetchCaseLog(app, loop, caseId).then((r) => { if (live) setRecords(r); }).catch(() => { if (live) setRecords([]); });
		return () => { live = false; };
	}, [app, loop, caseId]);

	const cut = atTs ? tsDigits(atTs) : "";

	return (
		<div className="h-full flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden animate-in fade-in duration-200">
			<div className="flex items-start gap-2 px-3 py-2.5 border-b border-slate-100">
				<button onClick={onBack} className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 px-2 py-1 -ml-1 rounded-lg hover:bg-slate-100 transition-colors"><ArrowLeft className="w-3.5 h-3.5" /> Trajectory</button>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
						<span className="text-sm font-medium text-slate-900 truncate">{caseLabel}</span>
					</div>
					<div className="text-[11px] text-slate-400 mt-0.5">data → metric mapping log · how this case was labeled &amp; scored over runs</div>
				</div>
			</div>

			<div className="flex-1 min-h-0 overflow-y-auto p-3">
				{records === null ? (
					<div className="h-full flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading mapping log…</div>
				) : records.length === 0 ? (
					<div className="h-full flex flex-col items-center justify-center gap-2 text-center text-slate-400">
						<FileText className="w-6 h-6 text-slate-300" />
						<div className="text-sm text-slate-500">No mapping records yet.</div>
						<div className="text-xs max-w-xs">When this workflow labels and scores this case, each run's mapping (label → metric) shows here.</div>
					</div>
				) : (
					<ul className="space-y-2">
						{records.map((r, i) => {
							const onVersion = cut && tsDigits(r.cycle_ts || r.ts) === cut;
							const metrics = Object.entries(r.metrics || {});
							const dims = Object.entries(r.dims || {}).filter(([k]) => k !== "case_id");
							return (
								<li key={`${r.ts}-${i}`} className={cn("rounded-lg border px-3 py-2", onVersion ? "border-gold-300 bg-gold-50/50 ring-1 ring-gold-200" : "border-slate-200/70 bg-white")}>
									<div className="flex items-center gap-2 text-[11px]">
										<Clock className="w-3 h-3 text-slate-400 flex-shrink-0" />
										<span className="text-slate-600 tabular-nums">{fmtWhen(r.cycle_ts || r.ts)}</span>
										{onVersion && <span className="text-[9px] uppercase tracking-wide text-gold-600 font-semibold">selected version</span>}
										{dims.map(([k, v]) => (
											<span key={k} className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">{k.replace(/_/g, " ")} {String(v)}</span>
										))}
									</div>
									{metrics.length > 0 ? (
										<div className="mt-1.5 flex flex-wrap gap-1.5">
											{metrics.map(([k, v]) => (
												<span key={k} className="inline-flex items-center gap-1 text-[11px] rounded-md bg-slate-50 border border-slate-200 px-2 py-0.5">
													<span className="text-slate-400">{k.replace(/_/g, " ")}</span>
													<span className="text-slate-800 font-semibold tabular-nums">{numFmt(v)}</span>
												</span>
											))}
										</div>
									) : (
										<div className="mt-1 text-[11px] text-slate-400 italic">labeled, not yet scored</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
