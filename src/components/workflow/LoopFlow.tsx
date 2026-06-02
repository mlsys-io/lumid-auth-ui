// LoopFlow — the autoresearch loop, visibly turning.
//
// Five canonical stages (observe → hypothesize → act → analyze → learn)
// with a light that travels through them on repeat + a curl that spins to
// signal "loops back to start". Mode drives the energy:
//   running — fast, bright, glowing: a cycle is firing right now.
//   idle    — slow, gentle breathing: armed, waiting for its next run.
//   paused  — still + dim.
// So the surface is always alive for an enabled loop, but a real run reads
// as distinctly more energetic than waiting.

import { Fragment } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = ["Observe", "Hypothesize", "Act", "Analyze", "Learn"];

export type LoopMode = "running" | "idle" | "paused";

export default function LoopFlow({ mode }: { mode: LoopMode }) {
	const animated = mode !== "paused";
	const period = mode === "running" ? 1.6 : 3.6; // seconds
	const dotColor = mode === "paused" ? "bg-slate-300" : "bg-emerald-500";
	const labelColor = mode === "paused" ? "text-slate-400" : "text-slate-600";

	return (
		<div
			className="flex items-center gap-1.5 flex-wrap"
			title={mode === "running" ? "A cycle is running" : mode === "idle" ? "Armed — waiting for the next run" : "Loop paused"}
		>
			{STAGES.map((s, i) => (
				<Fragment key={s}>
					<span className="inline-flex items-center gap-1">
						<span
							className={cn("w-1.5 h-1.5 rounded-full transition-colors", dotColor, animated && "loop-stage")}
							style={animated ? { animationDelay: `${(i * period) / STAGES.length}s`, animationDuration: `${period}s` } : undefined}
						/>
						<span className={cn("text-[10px]", labelColor)}>{s}</span>
					</span>
					{i < STAGES.length - 1 && <span className="text-slate-300 text-[10px]">→</span>}
				</Fragment>
			))}
			<RotateCw
				className={cn("w-3 h-3 ml-0.5", mode === "paused" ? "text-slate-300" : "text-emerald-500", animated && "loop-spin")}
				style={animated ? { animationDuration: `${period * 2}s` } : undefined}
			/>
		</div>
	);
}
