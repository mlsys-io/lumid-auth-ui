// CompareRuns — overlay 2–5 runs side by side so you can see whether the
// workflow is improving cycle-over-cycle: outcome, duration, per-cycle metrics
// (with a ▲/▼ delta on the newest vs the oldest selected), step errors, and
// memories learned. Runs are shown newest → oldest (left → right).

import { useEffect, useState } from "react";
import { Loader2, X, ArrowUp, ArrowDown } from "lucide-react";
import { me, type MeCycleDetail } from "@/api/me";
import { cn } from "@/lib/utils";

function cdate(ts: string): string {
	const m = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
	if (!m) return ts;
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
		.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));

export default function CompareRuns({ app, loop, runs, onRemove }: {
	app: string; loop: string; runs: string[]; onRemove: (ts: string) => void;
}) {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	const [details, setDetails] = useState<Record<string, MeCycleDetail | null>>({});
	const [loading, setLoading] = useState(true);
	const key = runs.join(",");
	useEffect(() => {
		let live = true; setLoading(true);
		Promise.all(runs.map((ts) =>
			me.cycleDetail(app, loop, ts).then((d) => [ts, d] as const).catch(() => [ts, null] as const)))
			.then((pairs) => { if (live) { setDetails(Object.fromEntries(pairs)); setLoading(false); } });
		return () => { live = false; };
	}, [app, loop, key]); // eslint-disable-line react-hooks/exhaustive-deps

	// newest → oldest
	const ordered = [...runs].sort((a, b) => b.localeCompare(a));
	const sumOf = (ts: string) => (details[ts]?.summary ?? null) as any;
	const metricKeys = Array.from(new Set(
		ordered.flatMap((ts) => {
			const m = sumOf(ts)?.metrics;
			return m && typeof m === "object" && !Array.isArray(m)
				? Object.entries(m).filter(([, v]) => typeof v === "number").map(([k]) => k) : [];
		}),
	)).slice(0, 8);

	const cell = "px-2.5 py-1.5 text-[11.5px] border-b border-slate-100 align-top";
	const head = "px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 border-b border-slate-200 text-left";

	const countOf = (ts: string, field: string) => { const a = sumOf(ts)?.[field]; return Array.isArray(a) ? a.length : 0; };
	const learnedOf = (ts: string) => {
		const m = sumOf(ts)?.auto_publish?.memories;
		return m ? Object.values(m as Record<string, { pushed?: number }>).reduce((n, v) => n + (v?.pushed || 0), 0) : 0;
	};
	const dur = (ts: string) => details[ts]?.steps?.reduce((n, s) => n + (s.duration_s || 0), 0);

	const delta = (k: string) => {
		const newest = sumOf(ordered[0])?.metrics?.[k];
		const oldest = sumOf(ordered[ordered.length - 1])?.metrics?.[k];
		if (typeof newest !== "number" || typeof oldest !== "number" || ordered.length < 2 || newest === oldest) return null;
		return newest > oldest;
	};

	return (
		<div className="overflow-auto rounded-xl border border-slate-200 bg-white">
			{loading ? (
				<div className="flex items-center gap-2 text-xs text-slate-400 p-3"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading runs to compare…</div>
			) : (
				<table className="w-full border-collapse">
					<thead>
						<tr>
							<th className={cn(head, "text-slate-400 font-medium")}>Comparing {ordered.length} runs</th>
							{ordered.map((ts, i) => (
								<th key={ts} className={head}>
									<div className="flex items-center gap-1">
										<span>{cdate(ts)}{i === 0 ? " ·newest" : ""}</span>
										<button onClick={() => onRemove(ts)} className="text-slate-300 hover:text-rose-600"><X className="w-3 h-3" /></button>
									</div>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						<tr>
							<td className={cn(cell, "text-slate-400")}>outcome</td>
							{ordered.map((ts) => <td key={ts} className={cell}>{String(sumOf(ts)?.outcome || (details[ts]?.summary ? "ran" : "—")).replace(/_/g, " ")}</td>)}
						</tr>
						<tr>
							<td className={cn(cell, "text-slate-400")}>duration</td>
							{ordered.map((ts) => { const d = dur(ts); return <td key={ts} className={cell}>{d ? `${Math.round(d)}s` : "—"}</td>; })}
						</tr>
						{metricKeys.map((k) => {
							const up = delta(k);
							return (
								<tr key={k}>
									<td className={cn(cell, "text-slate-400")}>{k.replace(/_/g, " ")}</td>
									{ordered.map((ts, i) => {
										const v = sumOf(ts)?.metrics?.[k];
										return (
											<td key={ts} className={cn(cell, "tabular-nums")}>
												{typeof v === "number" ? num(v) : "—"}
												{i === 0 && up !== null && (
													<span className={cn("ml-1 inline-flex items-center", up ? "text-gold-600" : "text-rose-500")}>
														{up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
													</span>
												)}
											</td>
										);
									})}
								</tr>
							);
						})}
						<tr>
							<td className={cn(cell, "text-slate-400")}>step errors</td>
							{ordered.map((ts) => { const n = countOf(ts, "step_errors"); return <td key={ts} className={cn(cell, n > 0 ? "text-rose-600" : "")}>{n || "0"}</td>; })}
						</tr>
						<tr>
							<td className={cn(cell, "text-slate-400")}>awaiting review</td>
							{ordered.map((ts) => <td key={ts} className={cell}>{countOf(ts, "review_queue") || "0"}</td>)}
						</tr>
						<tr>
							<td className={cn(cell, "text-slate-400 border-b-0")}>learned</td>
							{ordered.map((ts) => <td key={ts} className={cn(cell, "border-b-0")}>{learnedOf(ts) || "0"}</td>)}
						</tr>
					</tbody>
				</table>
			)}
		</div>
	);
}
