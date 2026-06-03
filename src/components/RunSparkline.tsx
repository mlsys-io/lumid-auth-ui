// RunSparkline — tiny inline state-history strip for workflow list rows.
//
// 14 squares max, oldest left → newest right. Color encodes outcome:
//   succeeded → emerald, recovered → amber, failed → rose, skipped → slate,
//   running → amber-pulse. Empty (no runs yet) → "—" text.
//
// The spec field comes from /me/workflows MeWorkflowRow.run_spark (one char
// per run, oldest→newest); we translate to colored squares.
//
// INTERACTIVE MODE: pass `runs` (MeWorkflowRow.runs_recent — same order as
// spec, each carrying the cycle dir-id) plus `app`/`loop`, and every dot
// becomes addressable: hover previews that cycle's CycleCard, click pins it
// open. Without those props it stays a plain display strip.

import { useEffect, useRef, useState } from "react";
import type { SparkRun } from "@/api/me";
import CycleCard from "@/components/workflow/CycleCard";

interface Props {
	spec: string;
	className?: string;
	// Interactive mode (all three required to enable clickable dots):
	runs?: SparkRun[];
	app?: string;
	loop?: string;
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

export function RunSparkline({ spec, className, runs, app, loop }: Props) {
	// Event motion (not load): when the spec changes — a new run landed —
	// pop the newest bar. No animation on first mount or unchanged polls.
	const prev = useRef(spec);
	const changed = prev.current !== spec;
	useEffect(() => { prev.current = spec; });

	const [hoverIdx, setHoverIdx] = useState<number | null>(null);
	const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);

	const interactive = !!(runs && runs.length && app && loop);
	const activeIdx = pinnedIdx ?? hoverIdx;

	if (!spec) {
		return <span className={["text-[10px] text-slate-300", className].filter(Boolean).join(" ")}>—</span>;
	}
	const chars = spec.split("");

	if (!interactive) {
		return (
			<div className={["inline-flex items-center gap-px", className].filter(Boolean).join(" ")} title={`${chars.length} recent runs`}>
				{chars.map((c, i) => (
					<span
						key={i}
						className={["w-1.5 h-3 rounded-sm transition-transform hover:scale-125", changed && i === chars.length - 1 ? "spark-pop" : "", SQ_CLASS[c] || "bg-slate-200"].join(" ")}
						title={STATE_LABEL[c] || c}
					/>
				))}
			</div>
		);
	}

	// Interactive: dots are buttons; a CycleCard floats above the active dot.
	const active = activeIdx !== null ? runs![activeIdx] : null;
	return (
		<div
			className={["relative inline-flex items-center gap-px", className].filter(Boolean).join(" ")}
			onMouseLeave={() => setHoverIdx(null)}
		>
			{/* click-away catcher while pinned */}
			{pinnedIdx !== null && (
				<div className="fixed inset-0 z-40" onClick={() => setPinnedIdx(null)} />
			)}
			{chars.map((c, i) => {
				const isActive = activeIdx === i;
				return (
					<button
						key={i}
						type="button"
						aria-label={`run ${i + 1}: ${STATE_LABEL[c] || c}`}
						title={STATE_LABEL[c] || c}
						onMouseEnter={() => setHoverIdx(i)}
						onClick={(e) => {
							e.stopPropagation();
							setPinnedIdx((p) => (p === i ? null : i));
						}}
						className={[
							"w-1.5 h-3 rounded-sm transition-transform cursor-pointer hover:scale-150",
							isActive ? "scale-150 ring-1 ring-slate-400 ring-offset-1" : "",
							changed && i === chars.length - 1 ? "spark-pop" : "",
							SQ_CLASS[c] || "bg-slate-200",
						].join(" ")}
					/>
				);
			})}
			{active && (
				<div className="absolute bottom-full right-0 mb-2 z-50" onClick={(e) => e.stopPropagation()}>
					<CycleCard
						app={app!}
						loop={loop!}
						ts={active.ts}
						st={active.st}
						onOpenFull={() => setPinnedIdx(null)}
					/>
				</div>
			)}
		</div>
	);
}

export default RunSparkline;
