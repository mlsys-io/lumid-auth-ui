// RunTimeline — "what did this run do, in what order, and where did it break?"
//
//   OBSERVE    HYPOTHESIZE   ACT          LEARN
//   ■ ■        ■             ■ ✕          ■            ← one cell per step
//   Failed at Act — Submit: Server error (HTTP 500)
//   +0:00  Read tape        tool      4s
//   +0:04  Pick signal      model call 6s
//   +0:10  Submit  ✕        tool      1m 02s   Server error (HTTP 500)
//
// Novix's step grid with its meaning fixed: cells sit under stage LABELS, a
// failed cell is brick with its reason written under the grid, and clicking a
// cell scrolls the timeline to that step and highlights it. Data: the
// runner's self-reported events (identity v0.5.476+); logic in
// lib/run-timeline.ts.

import { useRef, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import type { MeRunStepEvent } from "@/api/me";
import { buildTimeline } from "@/lib/run-timeline";
import { cn } from "@/lib/utils";

export default function RunTimeline({ events, app, running }: { events: MeRunStepEvent[]; app?: string; running?: boolean }) {
	const t = buildTimeline(events, { app, running });
	const [hl, setHl] = useState<number | null>(null);
	const rowEls = useRef(new Map<number, HTMLLIElement>());
	const jump = (i: number) => {
		setHl(i);
		rowEls.current.get(i)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		window.setTimeout(() => setHl((cur) => (cur === i ? null : cur)), 2400);
	};

	return (
		<section aria-label="What this run did, step by step" className="space-y-2 px-1">
			<div className="flex items-baseline gap-2">
				<h3 className="text-micro uppercase tracking-wide font-semibold text-ink-600">Step by step</h3>
				<span className="text-micro text-ink-600">{t.rows.length} steps{t.total ? ` · ${t.total}` : ""}</span>
			</div>

			{/* The grid: one cell per step, under its stage's label. */}
			<div className="flex flex-wrap gap-x-4 gap-y-2" role="list" aria-label="Steps by stage">
				{t.groups.map((g, gi) => (
					<div key={gi} className="space-y-1" role="listitem">
						<div className="text-nano uppercase tracking-wide text-ink-600">{g.stage || "Steps"}</div>
						<div className="flex flex-wrap gap-1">
							{g.rows.map((r) => (
								<button key={r.i} type="button" onClick={() => jump(r.i)}
									title={`${r.name}${r.duration ? ` · ${r.duration}` : ""}${r.ok ? "" : " · failed"}`}
									aria-label={`${r.name}, ${r.running ? "running" : r.ok ? "done" : "failed"}`}
									className={cn("w-3.5 h-3.5 rounded-[3px] transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
										r.running ? "bg-lagoon-400 animate-lumen-breathe" : r.ok ? "bg-gold-400" : "bg-brick-500",
										hl === r.i && "ring-2 ring-gold-500 ring-offset-1")} />
							))}
						</div>
					</div>
				))}
			</div>
			{t.failure && (
				<div className="flex items-start gap-1.5 text-caption text-brick-700">
					<AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden /> {t.failure}
				</div>
			)}

			{/* The timeline: mono offsets from the run's start, faded scroll edges. */}
			<ol className="max-h-72 overflow-y-auto space-y-0.5 [mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-12px),transparent)] py-1">
				{t.rows.map((r) => (
					<li key={r.i} ref={(el) => { if (el) rowEls.current.set(r.i, el); else rowEls.current.delete(r.i); }}
						className={cn("grid grid-cols-[3.25rem_1rem_1fr_auto] items-baseline gap-x-2 rounded-md px-1.5 py-1 transition-colors duration-500",
							hl === r.i ? "bg-gold-50" : "bg-transparent")}>
						<span className="font-mono text-nano text-ink-600 tabular-nums">{r.offset}</span>
						<span className="self-start pt-1" aria-hidden>
							{r.running ? <span className="block w-2 h-2 rounded-full bg-lagoon-500 animate-lumen-breathe" />
								: r.ok ? <Check className="w-3 h-3 text-gold-600" /> : <X className="w-3 h-3 text-brick-600" />}
						</span>
						<span className="min-w-0">
							<span className="text-caption font-medium text-ink-900">{r.name}</span>
							{r.kind && <span className="ml-1.5 text-nano text-ink-600">{r.kind}</span>}
							{!r.ok && <span className="sr-only"> failed</span>}
							{r.summary && <span className={cn("block text-micro leading-snug line-clamp-2", r.ok ? "text-ink-600" : "text-brick-700")} title={r.summary}>{r.summary}</span>}
						</span>
						<span className="text-micro text-ink-600 tabular-nums">{r.running ? "running" : r.duration}</span>
					</li>
				))}
			</ol>
		</section>
	);
}
