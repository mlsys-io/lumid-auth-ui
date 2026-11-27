// ProgressDots — the two meanings a dot may have, and only these two (round 9,
// principle 5). The caller always labels which one it is showing:
//
//   <RunDots runs={…} />      "Last 20 runs"  ●●●○●●   a dot is a RUN
//   <StepDots steps={…} />    "Steps"         ■■■□□    a dot is a STEP
//
// One cell everywhere (8px, 2px corners, 3px apart) and one set of colours:
// done gold · failed brick (the only alarm colour) · running lagoon, breathing
// (the only thing that moves) · waiting an ink outline, so what is left shows
// · skipped faint ink. Every dot says its state in words (tooltip and
// accessible name) — colour is never the only signal. Words come from
// lib/progress-dots.ts.
//
// <StepList> is the timestamped list under the step dots (Novix's process
// log): `+m:ss`, a glyph per state, plain words; older rows quieter, the
// running row shines. <StepProgress> links the two both ways — hovering or
// clicking a dot scrolls to and tints its row, hovering a row outlines its
// dot. <RunSteps> reads one run (me.cycleDetail) and shows its StepProgress.

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Circle, Minus, X } from "lucide-react";
import { me, type MeCycleDetail, type MeRunStepEvent } from "@/api/me";
import {
	runDotWords, stepDotWords, windowDots, runDotsLabel, stepsSummary, stepsSpan, stepRows, stepsFromCycle,
	type RunDot, type StepDot, type StepState,
} from "@/lib/progress-dots";
import { cn } from "@/lib/utils";

export type { RunDot, StepDot, StepState } from "@/lib/progress-dots";
export { stepsFromCycle } from "@/lib/progress-dots";

// rounded-[2px], not rounded-sm: under the Studio surface `sm` is 6px, which
// turns an 8px cell into a circle.
const CELL = "w-2 h-2 rounded-[2px] flex-shrink-0 transition-shadow";
const STEP_CLS: Record<StepState, string> = {
	done: "bg-gold-500",
	failed: "bg-brick-500",
	running: "bg-lagoon-500 animate-lumen-breathe",
	waiting: "border border-ink-300 bg-transparent",
	skipped: "bg-ink-200",
};
const runCls = (r: RunDot): string => (r.running ? STEP_CLS.running : r.ok ? STEP_CLS.done : STEP_CLS.failed);
const OUTLINE = "ring-2 ring-ink-700 ring-offset-1 ring-offset-card";

function Dot({ cls, words, onClick, outlined, onHover, dataId }: {
	cls: string; words: string; onClick?: () => void; outlined?: boolean; onHover?: (on: boolean) => void; dataId?: string;
}) {
	const common = {
		title: words,
		"aria-label": words,
		"data-dot": dataId,
		onMouseEnter: onHover ? () => onHover(true) : undefined,
		onMouseLeave: onHover ? () => onHover(false) : undefined,
	};
	if (onClick) {
		return (
			<button type="button" {...common} onClick={onClick}
				onFocus={onHover ? () => onHover(true) : undefined} onBlur={onHover ? () => onHover(false) : undefined}
				className={cn(CELL, cls, "hover:scale-125 focus-visible:outline-none", outlined && OUTLINE, "focus-visible:ring-2 focus-visible:ring-ring/60")} />
		);
	}
	return <span role="img" {...common} className={cn(CELL, cls, outlined && OUTLINE)} />;
}

/**
 * A dot is a RUN. `runs` oldest first (newest on the right); the newest
 * `max` are drawn and the rest counted ("+12 earlier"). `label` defaults to
 * "Last N runs"; pass `false` when the caller labels the line itself.
 */
export function RunDots({ runs, max = 20, label, onPick, now, className }: {
	runs: RunDot[];
	max?: number;
	label?: string | false;
	onPick?: (id: string) => void;
	now?: number;
	className?: string;
}) {
	const w = windowDots(runs, max);
	const text = label === false ? null : label ?? runDotsLabel(runs.length, max);
	return (
		<div className={cn("inline-flex items-center gap-2 min-w-0", className)}>
			{text && <span className="text-micro text-ink-600 whitespace-nowrap">{text}</span>}
			{w.earlier > 0 && <span className="text-nano text-ink-600 whitespace-nowrap tabular-nums">{w.earlierText}</span>}
			<span role="list" aria-label={text || runDotsLabel(runs.length, max)} className="inline-flex flex-wrap items-center gap-[3px]">
				{w.shown.map((r) => (
					<span role="listitem" key={r.id} className="inline-flex">
						<Dot cls={runCls(r)} words={runDotWords(r, now)} onClick={onPick ? () => onPick(r.id) : undefined} dataId={r.id} />
					</span>
				))}
			</span>
		</div>
	);
}

/**
 * A dot is a STEP, in run order. The header says "Steps", how far it got and
 * the span ("took 44s" / "+0:00 — +35:52") so the size is clear without
 * counting. `activeId` outlines a dot (the row being pointed at).
 */
export function StepDots({ steps, onPick, onHover, activeId, max = 80, label = "Steps", className }: {
	steps: StepDot[];
	onPick?: (id: string) => void;
	onHover?: (id: string | null) => void;
	activeId?: string | null;
	max?: number;
	label?: string | false;
	className?: string;
}) {
	const w = windowDots(steps, max);
	const span = stepsSpan(steps);
	return (
		<div className={cn("space-y-1.5 min-w-0", className)}>
			{label !== false && (
				<div className="flex items-baseline gap-2 flex-wrap">
					<span className="text-micro font-semibold text-ink-700">{label}</span>
					<span className="text-micro text-ink-600">{stepsSummary(steps)}</span>
					{span && <span className="ml-auto font-mono text-nano text-ink-600 tabular-nums">{span}</span>}
				</div>
			)}
			<div role="list" aria-label={label || "Steps"} className="flex flex-wrap items-center gap-[3px]">
				{w.earlier > 0 && <span className="mr-1 text-nano text-ink-600 tabular-nums">{w.earlierText}</span>}
				{w.shown.map((s) => (
					<span role="listitem" key={s.id} className="inline-flex">
						<Dot cls={STEP_CLS[s.state]} words={stepDotWords(s)} dataId={s.id}
							outlined={activeId === s.id}
							onClick={onPick ? () => onPick(s.id) : undefined}
							onHover={onHover ? (on) => onHover(on ? s.id : null) : undefined} />
					</span>
				))}
			</div>
		</div>
	);
}

function StateGlyph({ state }: { state: StepState }) {
	switch (state) {
		case "done": return <Check className="w-3 h-3 text-gold-600" />;
		case "failed": return <X className="w-3 h-3 text-brick-600" />;
		case "running": return <span className="block w-2 h-2 m-0.5 rounded-full bg-lagoon-500 animate-lumen-breathe" />;
		case "skipped": return <Minus className="w-3 h-3 text-ink-500" />;
		default: return <Circle className="w-3 h-3 text-ink-400" />;
	}
}

const QUIET = ["text-ink-900", "text-ink-700", "text-ink-600"] as const;

/**
 * The timestamped step list. `activeId` tints its row and scrolls it into
 * view; hovering a row reports it (`onHover`) so the caller can outline its
 * dot. Failures show their cause; other notes fold behind a ▸.
 */
export function StepList({ steps, activeId, onHover, className }: {
	steps: StepDot[];
	activeId?: string | null;
	onHover?: (id: string | null) => void;
	className?: string;
}) {
	const rows = stepRows(steps);
	const [open, setOpen] = useState<Set<string>>(new Set());
	const els = useRef(new Map<string, HTMLLIElement>());
	useEffect(() => {
		if (activeId) els.current.get(activeId)?.scrollIntoView({ block: "nearest" });
	}, [activeId]);
	if (!rows.length) return null;
	return (
		<ol aria-label="Steps, in order" className={cn("max-h-72 overflow-y-auto space-y-0.5 py-1", className)}>
			{rows.map((r) => {
				const expanded = r.open || open.has(r.id);
				const foldable = !!r.note && !r.open;
				return (
					<li key={r.id} data-step={r.id}
						ref={(el) => { if (el) els.current.set(r.id, el); else els.current.delete(r.id); }}
						onMouseEnter={onHover ? () => onHover(r.id) : undefined}
						onMouseLeave={onHover ? () => onHover(null) : undefined}
						className={cn("grid grid-cols-[3.25rem_1rem_1fr_auto] items-baseline gap-x-2 rounded-md px-1.5 py-1 transition-colors duration-300",
							activeId === r.id ? (r.state === "failed" ? "bg-brick-50" : "bg-ink-100") : "bg-transparent")}>
						<span className="font-mono text-nano text-ink-600 tabular-nums">{r.offset}</span>
						<span className="self-start pt-0.5" aria-hidden><StateGlyph state={r.state} /></span>
						<span className="min-w-0">
							<span className="sr-only">{r.words}</span>
							<span aria-hidden className={cn("text-caption", r.state === "running" ? "lumen-shine font-medium" : cn(QUIET[r.quiet], r.quiet === 0 && "font-medium"))}>
								{r.label}
							</span>
							{r.state === "waiting" && <span aria-hidden className="ml-1.5 text-nano text-ink-600">not started yet</span>}
							{r.state === "skipped" && <span aria-hidden className="ml-1.5 text-nano text-ink-600">skipped</span>}
							{foldable && (
								<button type="button" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
									aria-expanded={expanded} aria-label={expanded ? "Hide the note" : "Show the note"}
									className="ml-1 inline-flex align-middle text-ink-600 hover:text-ink-900">
									<ChevronRight className={cn("w-3 h-3 transition-transform", expanded && "rotate-90")} />
								</button>
							)}
							{r.note && expanded && (
								<span className={cn("block text-micro leading-snug", r.state === "failed" ? "text-brick-700" : "text-ink-600")}>{r.note}</span>
							)}
						</span>
						<span className="text-micro text-ink-600 tabular-nums">{r.took}</span>
					</li>
				);
			})}
		</ol>
	);
}

/** Step dots over the step list, linked both ways. */
export function StepProgress({ steps, label = "Steps", onPick, className }: {
	steps: StepDot[];
	label?: string;
	onPick?: (id: string) => void;
	className?: string;
}) {
	const [picked, setPicked] = useState<string | null>(null);
	const [hover, setHover] = useState<string | null>(null);
	const timer = useRef<number | null>(null);
	useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
	const pick = (id: string) => {
		setPicked(id);
		onPick?.(id);
		if (timer.current) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setPicked((cur) => (cur === id ? null : cur)), 2400);
	};
	const active = hover ?? picked;
	if (!steps.length) return null;
	return (
		<section aria-label={label} className={cn("space-y-1.5 min-w-0", className)}>
			<StepDots steps={steps} label={label} onPick={pick} onHover={setHover} activeId={active} />
			<StepList steps={steps} activeId={active} onHover={setHover} />
		</section>
	);
}

/**
 * One run's steps, read from me.cycleDetail. `template` (the last run's
 * events) lets a running run show the steps it has not reached as waiting
 * dots; `startedAt` (epoch s) places a run that has reported nothing yet.
 */
export function RunSteps({ app, loop, ts, running, template, startedAt, label = "Steps", className }: {
	app: string; loop: string; ts: string;
	running?: boolean;
	template?: MeRunStepEvent[] | null;
	startedAt?: number;
	label?: string;
	className?: string;
}) {
	const [detail, setDetail] = useState<MeCycleDetail | null | undefined>(undefined);
	useEffect(() => {
		let live = true;
		setDetail(undefined);
		me.cycleDetail(app, loop, ts).then((d) => { if (live) setDetail(d); }).catch(() => { if (live) setDetail(null); });
		return () => { live = false; };
	}, [app, loop, ts]);
	if (detail === undefined) return <div role="status" aria-label="Loading the steps" className={cn("h-3 w-40 rounded-sm lumen-skeleton", className)} />;
	const steps = stepsFromCycle(detail, {
		app: loop, running, template,
		elapsedS: startedAt != null ? Math.max(0, Date.now() / 1000 - startedAt) : undefined,
	});
	if (!steps.length) return <p className={cn("text-micro text-ink-600", className)}>{detail ? "This run reported no steps." : "Couldn't read this run's steps."}</p>;
	return <StepProgress steps={steps} label={label} className={className} />;
}

export default StepProgress;
