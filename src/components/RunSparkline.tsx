// RunSparkline — tiny inline state-history strip for workflow list rows.
//
// 14 squares max, oldest left → newest right. Color encodes outcome:
//   succeeded → emerald, failed → rose, skipped → slate, running → amber.
// Empty (no runs yet) → "—" text.
//
// The spec field comes from /me/workflows MeWorkflowRow.run_spark
// (one char per run, oldest→newest); we just translate.

import { useEffect, useRef } from "react";

interface Props {
	spec: string;
	className?: string;
}

const SQ_CLASS: Record<string, string> = {
	o: "bg-emerald-400",
	r: "bg-amber-400",   // recovered: succeeded only via retry/fallback (self-healed)
	x: "bg-rose-500",
	_: "bg-slate-300",
	".": "bg-amber-400 animate-pulse",
};

const STATE_LABEL: Record<string, string> = {
	o: "succeeded",
	r: "recovered (self-healed via retry)",
	x: "failed",
	_: "skipped",
	".": "running",
};

export function RunSparkline({ spec, className }: Props) {
	// Event motion (not load): when the spec changes — a new run landed —
	// pop the newest bar. No animation on first mount or unchanged polls.
	const prev = useRef(spec);
	const changed = prev.current !== spec;
	useEffect(() => { prev.current = spec; });

	if (!spec) {
		return <span className={["text-[10px] text-slate-300", className].filter(Boolean).join(" ")}>—</span>;
	}
	const chars = spec.split("");
	return (
		<div className={["inline-flex items-center gap-px", className].filter(Boolean).join(" ")} title={`${chars.length} recent runs`}>
			{chars.map((c, i) => {
				const newest = i === chars.length - 1;
				return (
					<span
						key={i}
						className={["w-1.5 h-3 rounded-sm transition-transform hover:scale-125", changed && newest ? "spark-pop" : "", SQ_CLASS[c] || "bg-slate-200"].join(" ")}
						title={STATE_LABEL[c] || c}
					/>
				);
			})}
		</div>
	);
}

export default RunSparkline;
