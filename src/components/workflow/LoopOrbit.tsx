// LoopOrbit — the autoresearch loop as the centerpiece.
//
// Five stage nodes (observe → hypothesize → act → analyze → learn). Honest
// motion: the light TRAVELS only while a cycle is actually running; idle is
// armed-but-still; paused is dim. A discrete loop event ripples a node via
// `pulse`. When `onStageClick` is supplied the nodes become buttons — click
// one to drill into that stage's observability.

import { Fragment } from "react";
import { Eye, Lightbulb, Zap, BarChart3, Sparkles, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export const LOOP_STAGES = [
	{ key: "observe", label: "Observe", Icon: Eye },
	{ key: "hypothesize", label: "Hypothesize", Icon: Lightbulb },
	{ key: "act", label: "Act", Icon: Zap },
	{ key: "analyze", label: "Analyze", Icon: BarChart3 },
	{ key: "learn", label: "Learn", Icon: Sparkles },
] as const;

export type LoopStageKey = (typeof LOOP_STAGES)[number]["key"];
export type LoopMode = "running" | "idle" | "paused";

export default function LoopOrbit({
	mode, pulse, caption, onStageClick, selected,
}: {
	mode: LoopMode;
	pulse?: LoopStageKey | null;
	caption?: React.ReactNode;
	onStageClick?: (key: LoopStageKey) => void;
	selected?: LoopStageKey | null;
}) {
	const animated = mode === "running";
	const period = 2.0;
	const delayFor = (i: number) => `${(i * period) / LOOP_STAGES.length}s`;
	const nodeCls =
		mode === "paused" ? "bg-slate-100 text-slate-400"
		: mode === "running" ? "bg-emerald-100 text-emerald-700"
		: "bg-emerald-50 text-emerald-600"; // idle = armed, static
	const clickable = !!onStageClick;

	return (
		<div className={cn(
			"rounded-xl border p-3 transition-colors",
			mode === "running" ? "border-emerald-200 bg-emerald-50/50"
			: mode === "paused" ? "border-slate-200 bg-slate-50/60"
			: "border-slate-200 bg-white",
		)}>
			<div className="flex items-center">
				{LOOP_STAGES.map((s, i) => {
					const Icon = s.Icon;
					const pulsing = pulse === s.key;
					const isSel = selected === s.key;
					const node = (
						<span className="relative inline-flex flex-shrink-0">
							{pulsing && <span className="absolute -inset-1 rounded-full bg-emerald-400/50 animate-ping" />}
							<span
								className={cn(
									"relative w-9 h-9 rounded-full flex items-center justify-center transition-all",
									nodeCls,
									isSel && "ring-2 ring-emerald-500 ring-offset-1",
									pulsing && "ring-2 ring-emerald-400",
									clickable && "group-hover/stage:scale-110 group-hover/stage:shadow-sm",
									animated && "loop-stage",
								)}
								style={animated ? { animationDelay: delayFor(i), animationDuration: `${period}s` } : undefined}
							>
								<Icon className="w-4 h-4" />
							</span>
						</span>
					);
					return (
						<Fragment key={s.key}>
							{clickable ? (
								<button type="button" onClick={() => onStageClick!(s.key)} className="group/stage inline-flex" title={`Inspect the ${s.label.toLowerCase()} stage`}>
									{node}
								</button>
							) : node}
							{i < LOOP_STAGES.length - 1 && (
								<div className="flex-1 h-0.5 bg-slate-200 relative overflow-hidden mx-1">
									{animated && (
										<span
											className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-emerald-400 to-transparent loop-sweep"
											style={{ animationDelay: delayFor(i), animationDuration: `${period}s` }}
										/>
									)}
								</div>
							)}
						</Fragment>
					);
				})}
				<RotateCw
					className={cn("w-3.5 h-3.5 ml-1 flex-shrink-0", mode === "paused" ? "text-slate-300" : "text-emerald-500", animated && "loop-spin")}
					style={animated ? { animationDuration: `${period * 2}s` } : undefined}
				/>
			</div>

			<div className="flex items-start mt-1.5">
				{LOOP_STAGES.map((s, i) => (
					<Fragment key={s.key}>
						<span className={cn("w-9 text-center text-[9px] leading-tight tracking-tight transition-colors",
							selected === s.key ? "text-emerald-700 font-medium" : mode === "paused" ? "text-slate-400" : "text-slate-600")}>
							{s.label}
						</span>
						{i < LOOP_STAGES.length - 1 && <span className="flex-1 mx-1" />}
					</Fragment>
				))}
				<span className="w-3.5 ml-1" />
			</div>

			{caption && <div className="text-center text-[11px] text-slate-500 mt-2">{caption}</div>}
		</div>
	);
}
